/**
 * Assemble Direct Delivery in a temporary clone and push the result to the
 * Plan target branch's upstream. The user's checkout is read-only throughout.
 */

import { basename } from "@std/path";
import { assertPreMergeCandidateUnchanged, checkpointExecutionWorktree, mergeExecutionWorktree } from "./worktree.js";

interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface IsolatedPublicationArgs {
    projectRoot: string;
    executionCwd: string;
    executionBranch: string;
    targetBranch: string;
    planName: string;
    planDescription?: string;
    sealedExecutionCommit: string;
    allowedPlanPaths: string[];
    repairedPublicationRoot?: string;
}

export interface IsolatedPublicationResult {
    updatedPrimaryCheckout: false;
    executionMetadataCommit: string;
    targetHeadBeforeMerge: string;
    deliveryCommit: string;
    publicationCommit: string;
    upstreamRemote: string;
    upstreamBranch: string;
}

interface UpstreamTarget {
    remote: string;
    branch: string;
    url: string;
}

export class IsolatedPublicationError extends Error {
    repairCwd?: string;
    mergeWorktreePath?: string;
    mergeFailureKind?: string;

    constructor(message: string, details: Partial<IsolatedPublicationError> = {}) {
        super(message);
        this.name = "IsolatedPublicationError";
        Object.assign(this, details);
    }
}

async function runGitResult(cwd: string, args: string[]): Promise<CommandResult> {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout).trim(),
        stderr: new TextDecoder().decode(output.stderr).trim(),
    };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const result = await runGitResult(cwd, args);
    if (result.code === 0) return result.stdout;
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
}

async function resolveUpstream(projectRoot: string, targetBranch: string): Promise<UpstreamTarget> {
    const configuredRemote = await runGitResult(projectRoot, ["config", "--get", `branch.${targetBranch}.remote`]);
    const remote = configuredRemote.code === 0 && configuredRemote.stdout ? configuredRemote.stdout : "origin";
    if (remote === ".") {
        throw new IsolatedPublicationError(
            `The target branch ${targetBranch} has no publishable upstream. Configure a remote upstream and retry.`,
            { mergeFailureKind: "upstream_unavailable" },
        );
    }
    const configuredMerge = await runGitResult(projectRoot, ["config", "--get", `branch.${targetBranch}.merge`]);
    const branch = configuredMerge.code === 0 && configuredMerge.stdout.startsWith("refs/heads/")
        ? configuredMerge.stdout.slice("refs/heads/".length)
        : targetBranch;
    const remoteUrl = await runGitResult(projectRoot, ["remote", "get-url", remote]);
    if (remoteUrl.code !== 0 || !remoteUrl.stdout) {
        throw new IsolatedPublicationError(
            `The target branch ${targetBranch} has no publishable upstream. Configure one and retry.`,
            { mergeFailureKind: "upstream_unavailable" },
        );
    }
    return { remote, branch, url: remoteUrl.stdout };
}

async function remoteHead(cwd: string, remote: string, branch: string): Promise<string | null> {
    const result = await runGitResult(cwd, ["ls-remote", "--heads", remote, `refs/heads/${branch}`]);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `Could not read ${remote}/${branch}.`);
    const hash = result.stdout.split(/\s+/)[0];
    return /^[0-9a-f]{40}$/i.test(hash || "") ? hash : null;
}

async function commitPublicationMetadata(publicationRoot: string, planName: string): Promise<string> {
    await runGit(publicationRoot, ["add", "-A"]);
    const staged = await runGit(publicationRoot, ["diff", "--cached", "--name-only"]);
    if (staged) {
        await runGit(publicationRoot, [
            "commit",
            "-m",
            `Record delivery for ${planName}`,
            "-m",
            "Record the delivered commit and generated Work Record after isolated publication assembly.",
        ]);
    }
    return await runGit(publicationRoot, ["rev-parse", "HEAD"]);
}

/**
 * Publish without checking out, resetting, staging, or updating a ref in the
 * user's primary project directory.
 */
export async function publishExecutionWorktreeIsolated(
    args: IsolatedPublicationArgs,
): Promise<IsolatedPublicationResult> {
    await assertPreMergeCandidateUnchanged({
        worktreePath: args.executionCwd,
        sealedExecutionCommit: args.sealedExecutionCommit,
        allowedPlanPaths: args.allowedPlanPaths,
    });
    const checkpoint = await checkpointExecutionWorktree({
        worktreePath: args.executionCwd,
        branch: args.executionBranch,
        planName: args.planName,
        planDescription: args.planDescription,
    });
    const upstream = await resolveUpstream(args.projectRoot, args.targetBranch);
    const publicationRoot = args.repairedPublicationRoot ||
        await Deno.makeTempDir({ prefix: `runwield-publish-${basename(args.projectRoot)}-` });
    let preserveForRecovery = Boolean(args.repairedPublicationRoot);
    try {
        if (args.repairedPublicationRoot) {
            const expectedRemoteHead = await remoteHead(publicationRoot, upstream.url, upstream.branch);
            const targetHeadBeforeMerge = await runGit(publicationRoot, ["rev-parse", "HEAD^1"]);
            const containsExecutionHead = await runGitResult(publicationRoot, [
                "merge-base",
                "--is-ancestor",
                args.sealedExecutionCommit,
                "HEAD",
            ]);
            if (containsExecutionHead.code !== 0) {
                await runGit(publicationRoot, [
                    "merge",
                    "--no-ff",
                    args.sealedExecutionCommit,
                    "-m",
                    `Include final validated state for ${args.planName}`,
                ]);
            }
            const deliveryCommit = await runGit(publicationRoot, ["rev-parse", "HEAD"]);
            const publicationCommit = await commitPublicationMetadata(publicationRoot, args.planName);
            const lease = expectedRemoteHead || "";
            await runGit(publicationRoot, [
                "push",
                `--force-with-lease=refs/heads/${upstream.branch}:${lease}`,
                upstream.url,
                `HEAD:refs/heads/${upstream.branch}`,
            ]).catch((error) => {
                throw new IsolatedPublicationError(
                    error instanceof Error ? error.message : String(error),
                    { mergeFailureKind: "publication_push_failed", repairCwd: publicationRoot },
                );
            });
            const confirmedRemoteHead = await remoteHead(publicationRoot, upstream.url, upstream.branch);
            if (confirmedRemoteHead !== publicationCommit) {
                throw new IsolatedPublicationError(
                    `The upstream target did not retain the completed publication for ${args.planName}.`,
                    { mergeFailureKind: "publication_verification_failed", repairCwd: publicationRoot },
                );
            }
            preserveForRecovery = false;
            return {
                updatedPrimaryCheckout: false,
                executionMetadataCommit: checkpoint.executionCommit,
                targetHeadBeforeMerge,
                deliveryCommit,
                publicationCommit,
                upstreamRemote: upstream.remote,
                upstreamBranch: upstream.branch,
            };
        }
        await runGit(args.projectRoot, ["clone", "--no-hardlinks", args.projectRoot, publicationRoot]);
        await runGit(publicationRoot, ["remote", "rename", "origin", "runwield-source"]);
        await runGit(publicationRoot, ["remote", "add", "publication", upstream.url]);
        for (const key of ["user.name", "user.email"]) {
            const value = await runGitResult(args.projectRoot, ["config", "--get", key]);
            if (value.code === 0 && value.stdout) await runGit(publicationRoot, ["config", key, value.stdout]);
        }
        const expectedRemoteHead = await remoteHead(publicationRoot, "publication", upstream.branch);
        if (expectedRemoteHead) {
            await runGit(publicationRoot, [
                "fetch",
                "publication",
                `+refs/heads/${upstream.branch}:refs/remotes/publication/${upstream.branch}`,
            ]);
        }
        await runGit(publicationRoot, [
            "fetch",
            "runwield-source",
            `+refs/heads/${args.targetBranch}:refs/remotes/runwield-source/${args.targetBranch}`,
            `+refs/heads/${args.executionBranch}:refs/remotes/runwield-source/${args.executionBranch}`,
        ]);
        await runGit(publicationRoot, [
            "checkout",
            "-B",
            args.targetBranch,
            `refs/remotes/runwield-source/${args.targetBranch}`,
        ]);

        if (expectedRemoteHead) {
            const containsRemote = await runGitResult(publicationRoot, [
                "merge-base",
                "--is-ancestor",
                expectedRemoteHead,
                "HEAD",
            ]);
            if (containsRemote.code !== 0) {
                try {
                    await runGit(publicationRoot, [
                        "merge",
                        "--no-ff",
                        `refs/remotes/publication/${upstream.branch}`,
                        "-m",
                        `Integrate ${upstream.remote}/${upstream.branch} before RunWield publication`,
                    ]);
                } catch (error) {
                    preserveForRecovery = true;
                    throw new IsolatedPublicationError(
                        error instanceof Error ? error.message : String(error),
                        {
                            repairCwd: publicationRoot,
                            mergeWorktreePath: publicationRoot,
                            mergeFailureKind: "target_sync_conflict",
                        },
                    );
                }
            }
        }
        const targetHeadBeforeMerge = await runGit(publicationRoot, ["rev-parse", "HEAD"]);
        await runGit(publicationRoot, [
            "branch",
            "-f",
            args.executionBranch,
            `refs/remotes/runwield-source/${args.executionBranch}`,
        ]);
        try {
            await mergeExecutionWorktree({
                projectRoot: publicationRoot,
                branch: args.executionBranch,
                targetBranch: args.targetBranch,
                preservePlanPaths: args.allowedPlanPaths,
            });
        } catch (error) {
            preserveForRecovery = true;
            const mergeError = error instanceof Error ? error : new Error(String(error));
            const classified = mergeError as IsolatedPublicationError;
            classified.repairCwd = publicationRoot;
            classified.mergeWorktreePath = publicationRoot;
            classified.mergeFailureKind ||= "isolated_publication_conflict";
            throw classified;
        }
        const deliveryCommit = await runGit(publicationRoot, ["rev-parse", "HEAD"]);
        const publicationCommit = await commitPublicationMetadata(publicationRoot, args.planName);
        const lease = expectedRemoteHead || "";
        try {
            await runGit(publicationRoot, [
                "push",
                `--force-with-lease=refs/heads/${upstream.branch}:${lease}`,
                "publication",
                `HEAD:refs/heads/${upstream.branch}`,
            ]);
        } catch (error) {
            throw new IsolatedPublicationError(
                error instanceof Error ? error.message : String(error),
                { mergeFailureKind: "publication_push_failed" },
            );
        }
        const confirmedRemoteHead = await remoteHead(publicationRoot, "publication", upstream.branch);
        if (confirmedRemoteHead !== publicationCommit) {
            throw new IsolatedPublicationError(
                `The upstream target did not retain the completed publication for ${args.planName}.`,
                { mergeFailureKind: "publication_verification_failed" },
            );
        }
        return {
            updatedPrimaryCheckout: false,
            executionMetadataCommit: checkpoint.executionCommit,
            targetHeadBeforeMerge,
            deliveryCommit,
            publicationCommit,
            upstreamRemote: upstream.remote,
            upstreamBranch: upstream.branch,
        };
    } finally {
        if (!preserveForRecovery) await Deno.remove(publicationRoot, { recursive: true }).catch(() => {});
    }
}
