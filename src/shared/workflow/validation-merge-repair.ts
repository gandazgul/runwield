/**
 * @module shared/workflow/validation-merge-repair
 * Merge failure classification and repair dispatch for the publication
 * dispatch for the publication phase.
 */

import { AGENTS } from "../../constants.js";
import type { PhaseContext, UserActionPause, ValidationLoopArgs } from "./validation-types.ts";
import { emitStatus } from "./validation-emit.ts";
import { buildValidationUserMessage, validationMergeRepairMessage } from "./validation-user-messages.ts";
import { buildValidationRepairPrompt } from "./validation-repair-prompt.ts";

type GitCommandResult = { code: number; stdout: string; stderr: string };

type AnnotatedPublicationError = Error & {
    repairCwd?: string;
    mergeWorktreePath?: string;
    mergeFailureKind?: string;
    blockingPaths?: string[];
    publicationStage?: PublicationStage;
};

export type PublicationStage =
    | "artifact_preparation"
    | "candidate_checkpoint"
    | "lifecycle_staging"
    | "candidate_sealing"
    | "git_publication";

export type PublicationFailure = {
    reason: string;
    repairCwd?: string;
    mergeWorktreePath?: string;
    mergeFailureKind?: string;
    blockingPaths: string[];
    publicationStage?: PublicationStage;
};

export function normalizePublicationFailure(error: Error): PublicationFailure {
    const annotated = error as AnnotatedPublicationError;
    return {
        reason: error.message,
        repairCwd: annotated.repairCwd,
        mergeWorktreePath: annotated.mergeWorktreePath,
        mergeFailureKind: annotated.mergeFailureKind,
        blockingPaths: annotated.blockingPaths || [],
        publicationStage: annotated.publicationStage,
    };
}

export function annotatePublicationStage(error: Error, publicationStage: PublicationStage): Error {
    const annotated = error as AnnotatedPublicationError;
    annotated.publicationStage ||= publicationStage;
    return annotated;
}

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
export function getMergeRepairCwd(failure: PublicationFailure): string | undefined {
    return failure.repairCwd;
}

/** What RunWield tells the user, and what it asks them to do about it. */
export function getMergeFailureKind(failure: PublicationFailure): string | undefined {
    return failure.mergeFailureKind;
}

/**
 * The merge worktree a repair happened in, so publication can finish that tree.
 */
export function getMergeWorktreePath(failure: PublicationFailure): string | undefined {
    return failure.mergeWorktreePath;
}

export function getBlockingPaths(failure: PublicationFailure): string[] {
    return failure.blockingPaths;
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
    failure: PublicationFailure,
    context: PhaseContext,
): UserActionPause {
    const kind = getMergeFailureKind(failure);
    if (kind === "primary_checkout_dirty") {
        return {
            whatHappened:
                `RunWield finished "${planName}" but could not add it to your ${targetBranch} branch, because your project folder has changes you have not saved to git yet — in the same files this work changes. Merging now would wipe them out.`,
            doThis:
                "Commit or stash these files, then pick Retry. Nothing was lost. The commits are still on the worktree branch.",
            details: getBlockingPaths(failure),
        };
    }
    if (kind === "target_checked_out") {
        return {
            whatHappened:
                `RunWield finished "${planName}" but could not add it to your ${targetBranch} branch, because that branch is checked out somewhere else.`,
            doThis: `Switch that other checkout off ${targetBranch}, then pick Retry.`,
        };
    }
    if (kind === "permission_denied") {
        return {
            whatHappened:
                `Git refused permission to update the upstream ${targetBranch} branch. The validated commits remain on the worktree branch.`,
            doThis:
                "Restore the remote credentials or write permission, confirm with `git push --dry-run`, then pick Retry.",
        };
    }
    if (kind === "policy_violation" || kind === "publication_target_changed") {
        return {
            whatHappened:
                `Git refused to update the upstream ${targetBranch} branch because its branch rules or configured publication target changed. The validated commits remain on the worktree branch.`,
            doThis:
                `Inspect the remote and branch settings with \`git remote -v\` and \`git branch -vv\`, resolve the reported rule or target change, then pick Retry.`,
        };
    }
    if (kind === "publication_push_failed" || kind === "publication_verification_failed") {
        return {
            whatHappened:
                `RunWield finished and validated "${planName}", but the ${targetBranch} branch could not be updated upstream.`,
            doThis:
                "The validated commits are safe on the worktree branch. Fix the upstream connection or branch rule, then pick Retry.",
        };
    }
    const repairCwd = getMergeRepairCwd(failure) || context.executionCwd;
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
    return {
        whatHappened:
            `Publication stopped because the saved publication copy for "${planName}" is incomplete. Your validated work is safe.`,
        doThis: "Update RunWield, then load this Plan again to resume publication.",
    };
}

export function publicationFailureNeedsUserAction(failure: PublicationFailure): boolean {
    const kind = getMergeFailureKind(failure);
    return kind === "primary_checkout_dirty" || kind === "target_checked_out" ||
        kind === "permission_denied" || kind === "policy_violation" || kind === "publication_target_changed" ||
        kind === "publication_push_failed" || kind === "publication_verification_failed" ||
        kind === "detached_merge_conflict" || kind === "current_checkout_merge_conflict" ||
        kind === "isolated_publication_conflict" || kind === "target_sync_conflict" || kind === "content_conflict";
}

/** @returns whether the repair agent reported completion. */
export async function dispatchMergeRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    reason: string,
    failure: PublicationFailure,
): Promise<boolean> {
    const repairCwd = getMergeRepairCwd(failure) || context.executionCwd;
    // Say what happened before the agent starts. An Engineer turn appearing with no
    // explanation reads as RunWield doing something unprompted: the user sees tool
    // calls about merge conflicts they were never told about, in a directory they did
    // not choose.
    console.error("[RunWield] merge_repair_started", { planName: args.planName });
    const problem = getMergeFailureKind(failure) === "target_sync_conflict" ? "target_update" : "work_combination";
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
