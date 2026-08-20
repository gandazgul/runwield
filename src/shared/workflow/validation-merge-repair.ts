/**
 * @module shared/workflow/validation-merge-repair
 * Merge failure classification, repair-worktree persistence, and the merge repair
 * dispatch for the publication phase.
 */

import { runPlanFrontMatterTransition } from "./state-transition.ts";
import { AGENTS } from "../../constants.js";
import type { PhaseContext, PublicationOutcome, UserActionPause, ValidationLoopArgs } from "./validation-types.ts";
import { emitStatus } from "./validation-emit.ts";
import { buildValidationUserMessage, validationMergeRepairMessage } from "./validation-user-messages.ts";
import { buildValidationRepairPrompt } from "./validation-repair-prompt.ts";
import { classifyValidationOperationalError } from "./validation-operational-errors.ts";
import { decideValidationRecovery, readValidationRetryPolicy } from "./validation-recovery.ts";

type GitCommandResult = { code: number; stdout: string; stderr: string };

async function runRepairGit(cwd: string, args: string[]): Promise<GitCommandResult> {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    const decoder = new TextDecoder();
    return {
        code: output.code,
        stdout: decoder.decode(output.stdout).trim(),
        stderr: decoder.decode(output.stderr).trim(),
    };
}

export async function finalizeMergeRepair(repairCwd: string): Promise<boolean> {
    const unresolved = await runRepairGit(repairCwd, ["diff", "--name-only", "--diff-filter=U"]);
    if (unresolved.code !== 0 || unresolved.stdout) return false;

    const mergeHead = await runRepairGit(repairCwd, ["rev-parse", "--verify", "MERGE_HEAD"]);
    if (mergeHead.code === 0) {
        const staged = await runRepairGit(repairCwd, ["add", "-A"]);
        if (staged.code !== 0) return false;
        const committed = await runRepairGit(repairCwd, ["commit", "--no-edit"]);
        if (committed.code !== 0) {
            console.error("[RunWield] merge_repair_commit_failed", committed.stderr || committed.stdout);
            return false;
        }
    }

    const mergeCommit = await runRepairGit(repairCwd, ["rev-list", "--merges", "-n", "1", "HEAD"]);
    if (mergeCommit.code !== 0 || !mergeCommit.stdout) return false;
    const staged = await runRepairGit(repairCwd, ["add", "-A"]);
    if (staged.code !== 0) return false;
    const pending = await runRepairGit(repairCwd, ["diff", "--cached", "--quiet"]);
    if (pending.code === 1) {
        const committed = await runRepairGit(repairCwd, ["commit", "-m", "Complete RunWield publication repair"]);
        if (committed.code !== 0) {
            console.error("[RunWield] merge_repair_commit_failed", committed.stderr || committed.stdout);
            return false;
        }
    } else if (pending.code !== 0) {
        return false;
    }
    return true;
}

/**
 * Where a merge failure has to be repaired.
 *
 * A merge conflict lands in whichever checkout git was merging into — usually the
 * primary one, not the execution worktree. The typed merge error carries that path,
 * so dispatching the repair agent into `executionCwd` unconditionally sends it to a
 * directory with no conflict in it, where it finds nothing to fix.
 */
export function getMergeRepairCwd(error: unknown): string | undefined {
    if (error && typeof error === "object" && "repairCwd" in error) {
        const repairCwd = (error as { repairCwd?: unknown }).repairCwd;
        return typeof repairCwd === "string" ? repairCwd : undefined;
    }
    return undefined;
}

/** What RunWield tells the user, and what it asks them to do about it. */
export function getMergeFailureKind(error: unknown): string | undefined {
    if (error && typeof error === "object" && "mergeFailureKind" in error) {
        const kind = (error as { mergeFailureKind?: unknown }).mergeFailureKind;
        return typeof kind === "string" ? kind : undefined;
    }
    return undefined;
}

/**
 * The merge worktree a repair happened in, so publication can finish that tree.
 */
export function getMergeWorktreePath(error: unknown): string | undefined {
    if (error && typeof error === "object" && "mergeWorktreePath" in error) {
        const path = (error as { mergeWorktreePath?: unknown }).mergeWorktreePath;
        return typeof path === "string" ? path : undefined;
    }
    return undefined;
}

type ValidationMergeRepairWorktreeResolution =
    | { kind: "ready"; path?: string }
    | { kind: "blocked"; outcome: PublicationOutcome };

export async function resolveStoredValidationMergeRepairWorktree(
    args: ValidationLoopArgs,
    context: PhaseContext,
): Promise<ValidationMergeRepairWorktreeResolution> {
    const path = readValidationMergeRepairWorktree(args.triageMeta);
    if (!path) return { kind: "ready" };
    if (await filesystemPathExists(path)) return { kind: "ready", path };
    const cleared = await persistValidationMergeRepairWorktree(args, context, null);
    if (cleared.kind === "blocked") return cleared;
    return { kind: "ready" };
}

export function readValidationMergeRepairWorktree(
    triageMeta: ValidationLoopArgs["triageMeta"],
): string | undefined {
    const path = triageMeta.validationMergeRepairWorktree;
    return typeof path === "string" && path ? path : undefined;
}

export async function filesystemPathExists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

export async function persistValidationMergeRepairWorktree(
    args: ValidationLoopArgs,
    context: PhaseContext,
    path: string | null,
): Promise<{ kind: "committed" } | { kind: "blocked"; outcome: PublicationOutcome }> {
    const transition = await runPlanFrontMatterTransition({
        projectRoot: context.executionCwd,
        planName: args.planName,
        operation: "validation_merge_repair_worktree",
        updates: { validationMergeRepairWorktree: path },
        recoveryAttrs: { ...args.triageMeta },
    });
    if (transition.status === "committed") return { kind: "committed" };
    const reason = transition.message || `Could not save merge repair worktree state for ${args.planName}.`;
    const failure = classifyValidationOperationalError({
        source: "validation_state",
        kind: "publication_record_missing",
        operation: "publication",
        message: reason,
    });
    const decision = decideValidationRecovery({
        failure,
        attempt: 1,
        policy: readValidationRetryPolicy(context.projectRoot),
        nextPhase: "delivery",
    });
    return {
        kind: "blocked",
        outcome: {
            recorded: false,
            result: {
                kind: decision.action === "halt" ? "failed" : "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: decision.result.message,
                recovery: decision.result,
            },
        },
    };
}

export function getBlockingPaths(error: unknown): string[] {
    if (error && typeof error === "object" && "blockingPaths" in error) {
        const paths = (error as { blockingPaths?: unknown }).blockingPaths;
        if (Array.isArray(paths)) return paths.filter((path): path is string => typeof path === "string");
    }
    return [];
}

/**
 * Turn a merge failure into something a person can act on.
 *
 * Written for someone who has never seen RunWield's internals: no status names, no
 * transition vocabulary, no worktree ids. Say what stopped, then say the one thing
 * they should do about it.
 */
export function describeMergePause(
    planName: string,
    targetBranch: string,
    error: unknown,
    reason: string,
    context: PhaseContext,
): UserActionPause {
    const kind = getMergeFailureKind(error);
    if (kind === "primary_checkout_dirty") {
        return {
            whatHappened:
                `RunWield finished "${planName}" but could not add it to your ${targetBranch} branch, because your project folder has changes you have not saved to git yet — in the same files this work changes. Merging now would wipe them out.`,
            doThis: "Commit or stash these files, then pick Retry. Nothing was lost, and the finished work is waiting.",
            details: getBlockingPaths(error),
        };
    }
    if (kind === "target_checked_out") {
        return {
            whatHappened:
                `RunWield finished "${planName}" but could not add it to your ${targetBranch} branch, because that branch is checked out somewhere else.`,
            doThis: `Switch that other checkout off ${targetBranch}, then pick Retry.`,
        };
    }
    if (kind === "publication_push_failed" || kind === "publication_verification_failed") {
        return {
            whatHappened:
                `RunWield finished and validated "${planName}", but the ${targetBranch} branch could not be updated upstream.`,
            doThis:
                "The finished work is safe on its worktree branch. Fix the upstream connection or branch rule, then pick Retry.",
        };
    }
    const repairCwd = getMergeRepairCwd(error) || context.executionCwd;
    if (
        kind === "detached_merge_conflict" || kind === "current_checkout_merge_conflict" ||
        kind === "isolated_publication_conflict" || kind === "target_sync_conflict" || kind === "content_conflict"
    ) {
        return {
            whatHappened:
                `RunWield could not combine "${planName}" with your ${targetBranch} branch: the same lines changed in both places, and the agent could not settle it.`,
            doThis:
                `Open ${repairCwd}, fix the files git marked as conflicted, run "git add" on each one, then pick Retry.`,
        };
    }
    console.error("[RunWield] merge_pause", { planName, targetBranch, error, reason });
    return {
        whatHappened:
            `RunWield could not finish publishing "${planName}" because its saved publication copy was incomplete. Your validated work is safe.`,
        doThis: "Update RunWield, then load this Plan again to resume publication.",
    };
}

/** @returns whether the repair agent reported completion. */
export async function dispatchMergeRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    reason: string,
    error?: unknown,
): Promise<boolean> {
    const repairCwd = getMergeRepairCwd(error) || context.executionCwd;
    // Say what happened before the agent starts. An Engineer turn appearing with no
    // explanation reads as RunWield doing something unprompted: the user sees tool
    // calls about merge conflicts they were never told about, in a directory they did
    // not choose.
    console.error("[RunWield] merge_repair_started", { planName: args.planName });
    const problem = getMergeFailureKind(error) === "target_sync_conflict" ? "target_update" : "work_combination";
    emitStatus(args, validationMergeRepairMessage(args.planName, problem), "warning");
    emitStatus(
        args,
        buildValidationUserMessage({ kind: "merge_dispatch" }),
    );
    args.session.setActiveWorkflow({ ...context.workflowBase });
    const outcome = await args.session.runIndependentRepairTurn({
        agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
        userRequest: buildValidationRepairPrompt({
            executionCwd: context.executionCwd,
            repairCwd,
            worktreeId: context.worktreeId,
            worktreeBranch: context.worktreeBranch,
            worktreeBaseBranch: context.worktreeBaseBranch,
            repairsNeeded:
                `Worktree merge failed while publishing ${args.planName}. Repair the merge or integration failure.\n\n${reason}`,
            authorityNote:
                "This checkout contains RunWield's in-progress publication merge. Resolve only the files Git marks as conflicted and stage each resolution. Do not commit, merge, rebase, reset, or publish; RunWield owns those steps and will continue automatically.",
            completionInstruction:
                "After all conflict resolutions are staged and no unmerged paths remain, call task_completed. Do not create a commit.",
        }),
        cwd: repairCwd,
    });
    if (!outcome.completed) return false;
    return await finalizeMergeRepair(repairCwd);
}
