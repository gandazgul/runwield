/**
 * Storage boundary for the durable publication state machine.
 *
 * The worktree registry entry is the only mutable publication authority. Plan
 * front matter remains validation truth, and Git refs/commits are the evidence
 * used to prove each transition.
 */

import { join } from "@std/path";
import { getRunWieldRuntimeDir, PLAN_STAGING_DIR_NAME } from "../../constants.js";
import { findById, pruneEntry, updatePublication } from "../worktree-registry.js";
import {
    deleteMergedWorktreeBranch,
    deleteRemotelyPublishedWorktreeBranch,
    removeWorktreeGitArtifacts,
} from "../worktree.js";
import {
    advancePublicationAttempt,
    assertPublicationAttempt,
    createPublicationAttempt,
    type PublicationAttempt,
    type PublicationFailure,
    type PublicationPhase,
    publicationPhaseAtLeast,
    type PublicationPhaseEvidence,
    recordPublicationFailure,
} from "./publication-attempt.ts";

type GitResult = { code: number; stdout: string; stderr: string };

async function git(cwd: string, args: string[]): Promise<GitResult> {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    const decoder = new TextDecoder();
    return {
        code: output.code,
        stdout: decoder.decode(output.stdout).trim(),
        stderr: decoder.decode(output.stderr).trim(),
    };
}

async function gitAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
    return (await git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant])).code === 0;
}

async function resolveRemoteTarget(
    projectRoot: string,
    targetBranch: string,
): Promise<{ remote: string; branch: string; url: string } | null> {
    const configuredRemote = await git(projectRoot, ["config", "--get", `branch.${targetBranch}.remote`]);
    const remote = configuredRemote.code === 0 && configuredRemote.stdout ? configuredRemote.stdout : "origin";
    if (remote === ".") return null;
    const url = await git(projectRoot, ["remote", "get-url", remote]);
    if (url.code !== 0 || !url.stdout) return null;
    const configuredMerge = await git(projectRoot, ["config", "--get", `branch.${targetBranch}.merge`]);
    const branch = configuredMerge.code === 0 && configuredMerge.stdout.startsWith("refs/heads/")
        ? configuredMerge.stdout.slice("refs/heads/".length)
        : targetBranch;
    return { remote, branch, url: url.stdout };
}

async function integratedEvidence(attempt: PublicationAttempt): Promise<PublicationPhaseEvidence | null> {
    const stat = await Deno.stat(attempt.publicationRoot).catch(() => null);
    if (!stat?.isDirectory) return null;
    if ((await git(attempt.publicationRoot, ["rev-parse", "--verify", "MERGE_HEAD"])).code === 0) return null;
    const head = await git(attempt.publicationRoot, ["rev-parse", "HEAD"]);
    if (head.code !== 0 || !head.stdout) return null;
    if (!(await gitAncestor(attempt.publicationRoot, attempt.artifactCommit || "", head.stdout))) return null;
    const merges = await git(attempt.publicationRoot, ["rev-list", "--merges", "--first-parent", "HEAD"]);
    for (const merge of merges.stdout.split("\n").filter(Boolean)) {
        const parents = await git(attempt.publicationRoot, ["rev-parse", `${merge}^1`, `${merge}^2`]);
        if (parents.code !== 0) continue;
        const [firstParent, secondParent] = parents.stdout.split("\n");
        if (!firstParent || !secondParent) continue;
        if (
            secondParent === attempt.artifactCommit || await gitAncestor(
                attempt.publicationRoot,
                attempt.artifactCommit || "",
                secondParent,
            )
        ) {
            return { targetBaseCommit: firstParent, integrationCommit: head.stdout };
        }
    }
    return null;
}

async function publishedEvidence(
    projectRoot: string,
    attempt: PublicationAttempt,
): Promise<PublicationPhaseEvidence | null> {
    const integrationCommit = attempt.integrationCommit;
    const targetBaseCommit = attempt.targetBaseCommit;
    if (!integrationCommit || !targetBaseCommit) return null;
    const remote = await resolveRemoteTarget(projectRoot, attempt.targetBranch);
    if (!remote) {
        const target = `refs/heads/${attempt.targetBranch}`;
        if (!(await gitAncestor(projectRoot, integrationCommit, target))) return null;
        return {
            targetBaseCommit,
            integrationCommit,
            publicationMode: "local",
            publishedCommit: integrationCommit,
        };
    }
    const remoteHead = await git(projectRoot, ["ls-remote", "--heads", remote.url, `refs/heads/${remote.branch}`]);
    if (remoteHead.code !== 0) return null;
    const head = remoteHead.stdout.split(/\s+/)[0] || "";
    if (!head || head !== integrationCommit) return null;
    return {
        targetBaseCommit,
        integrationCommit,
        publicationMode: "remote",
        publishedCommit: head,
        upstreamRemote: remote.remote,
        upstreamBranch: remote.branch,
    };
}

export function publicationRootForAttempt(projectRoot: string, attemptId: string): string {
    return join(getRunWieldRuntimeDir(projectRoot), PLAN_STAGING_DIR_NAME, attemptId);
}

export async function loadPublicationAttempt(
    projectRoot: string,
    attemptId: string,
): Promise<PublicationAttempt | null> {
    const entry = await findById(projectRoot, attemptId, { migrate: false });
    if (!entry?.publication) return null;
    assertPublicationAttempt(entry.publication);
    return entry.publication;
}

export async function startPublicationAttempt(args: {
    projectRoot: string;
    attemptId: string;
    planName: string;
    targetBranch: string;
    executionBranch: string;
    executionCwd: string;
    validatedCommit: string;
    targetHeadAtSeal: string;
}): Promise<PublicationAttempt> {
    const entry = await findById(args.projectRoot, args.attemptId, { migrate: false });
    if (!entry) throw new Error(`Worktree registry entry not found: ${args.attemptId}`);
    if (!entry.planId) throw new Error(`Worktree registry entry ${args.attemptId} has no Plan identity.`);
    if (entry.publication) {
        assertPublicationAttempt(entry.publication);
        const current = entry.publication;
        const identities = [
            ["planName", current.planName, args.planName],
            ["targetBranch", current.targetBranch, args.targetBranch],
            ["executionBranch", current.executionBranch, args.executionBranch],
            ["executionCwd", current.executionCwd, args.executionCwd],
        ];
        const mismatch = identities.find(([, currentValue, expectedValue]) => currentValue !== expectedValue);
        if (mismatch) {
            throw new Error(
                `Publication attempt ${args.attemptId} changed ${mismatch[0]} from ${mismatch[1]} to ${mismatch[2]}.`,
            );
        }
        return current;
    }
    const publication = createPublicationAttempt({
        attemptId: args.attemptId,
        planId: entry.planId,
        planName: args.planName,
        targetBranch: args.targetBranch,
        executionBranch: args.executionBranch,
        executionCwd: args.executionCwd,
        publicationRoot: publicationRootForAttempt(args.projectRoot, args.attemptId),
        validatedCommit: args.validatedCommit,
        targetHeadAtSeal: args.targetHeadAtSeal,
    });
    await updatePublication(args.projectRoot, args.attemptId, null, publication);
    return publication;
}

export async function advanceStoredPublication(
    projectRoot: string,
    current: PublicationAttempt,
    phase: PublicationPhase,
    evidence: PublicationPhaseEvidence,
): Promise<PublicationAttempt> {
    if (publicationPhaseAtLeast(current.phase, phase)) {
        for (const [field, expected] of Object.entries(evidence)) {
            if (expected === undefined) continue;
            const actual = current[field as keyof PublicationAttempt];
            if (actual !== expected) {
                throw new Error(
                    `Publication ${current.attemptId} has conflicting ${field}: ${String(actual)} != ${
                        String(expected)
                    }.`,
                );
            }
        }
        return current;
    }
    const next = advancePublicationAttempt(current, phase, evidence);
    await updatePublication(projectRoot, current.attemptId, current.revision, next);
    return next;
}

export async function failStoredPublication(
    projectRoot: string,
    current: PublicationAttempt,
    failure: Omit<PublicationFailure, "phase" | "recordedAt"> & { phase?: PublicationPhase },
): Promise<PublicationAttempt> {
    const next = recordPublicationFailure(current, failure);
    await updatePublication(projectRoot, current.attemptId, current.revision, next);
    return next;
}

/**
 * Advance a restarted publication only when current Git facts prove an external
 * effect completed before its registry write. No Plan status or prior error text
 * participates in this decision.
 */
export async function reconcileStoredPublication(
    projectRoot: string,
    initial: PublicationAttempt,
): Promise<PublicationAttempt> {
    let current = initial;
    if (current.phase === "artifacts_committed") {
        const evidence = await integratedEvidence(current);
        if (evidence) {
            current = await advanceStoredPublication(projectRoot, current, "target_integrated", evidence);
        }
    }
    if (current.phase === "target_integrated") {
        const evidence = await publishedEvidence(projectRoot, current);
        if (evidence) current = await advanceStoredPublication(projectRoot, current, "target_published", evidence);
    }
    if (current.phase === "target_published") {
        const evidence = await publishedEvidence(projectRoot, current);
        if (evidence) {
            current = await advanceStoredPublication(projectRoot, current, "publication_verified", {
                verifiedAt: new Date().toISOString(),
            });
        }
    }
    return current;
}

export type PublicationCleanupResult = {
    complete: boolean;
    attempt: PublicationAttempt;
    worktreeKept: boolean;
    branchKept: boolean;
    details: string[];
};

/**
 * Finish verified publication cleanup without requiring the execution worktree
 * to still exist. This is the restart path for a process that died after deleting
 * Git artifacts but before writing the final receipt.
 */
export async function cleanupStoredPublication(
    projectRoot: string,
    initial: PublicationAttempt,
): Promise<PublicationCleanupResult> {
    let attempt = await reconcileStoredPublication(projectRoot, initial);
    if (attempt.phase === "cleanup_complete") {
        await pruneEntry(projectRoot, attempt.attemptId);
        return { complete: true, attempt, worktreeKept: false, branchKept: false, details: [] };
    }
    if (attempt.phase !== "publication_verified") {
        throw new Error(`Publication cleanup requires verified publication, found ${attempt.phase}.`);
    }
    const details: string[] = [];
    let worktreeKept = false;
    let branchKept = false;
    try {
        const worktreeExists = await Deno.stat(attempt.executionCwd).then((value) => value.isDirectory).catch(() =>
            false
        );
        if (worktreeExists) {
            await removeWorktreeGitArtifacts({ projectRoot, path: attempt.executionCwd, force: false });
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            worktreeKept = true;
            details.push(
                `Git kept worktree ${attempt.executionCwd}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
    try {
        const branchExists = (await git(projectRoot, [
            "show-ref",
            "--verify",
            "--quiet",
            `refs/heads/${attempt.executionBranch}`,
        ])).code === 0;
        if (branchExists) {
            const branchCleanup =
                attempt.publicationMode === "remote" && attempt.upstreamRemote && attempt.upstreamBranch
                    ? await deleteRemotelyPublishedWorktreeBranch({
                        projectRoot,
                        branch: attempt.executionBranch,
                        remote: attempt.upstreamRemote,
                        upstreamBranch: attempt.upstreamBranch,
                        publicationCommit: attempt.publishedCommit || "",
                    })
                    : await deleteMergedWorktreeBranch({ projectRoot, branch: attempt.executionBranch });
            if (!branchCleanup.deleted) {
                branchKept = true;
                details.push(branchCleanup.reason);
            }
        }
    } catch (error) {
        branchKept = true;
        details.push(
            `Git kept branch ${attempt.executionBranch}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    await Deno.remove(attempt.publicationRoot, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) {
            details.push(`RunWield kept publication checkout ${attempt.publicationRoot}: ${String(error)}`);
        }
    });
    if (worktreeKept || branchKept || details.length > 0) {
        return { complete: false, attempt, worktreeKept, branchKept, details };
    }
    attempt = await advanceStoredPublication(projectRoot, attempt, "cleanup_complete", {
        cleanedAt: new Date().toISOString(),
    });
    await pruneEntry(projectRoot, attempt.attemptId);
    return { complete: true, attempt, worktreeKept: false, branchKept: false, details: [] };
}
