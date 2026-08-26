/** Controller-owned state. None of these fields belongs in a Plan document. */
import type { ValidationCheckpoint } from "./validation-checkpoint.ts";

export type WorktreeDeliveryEvidence = {
    version: 1;
    mode: "worktree_merge";
    executionCommit: string;
    targetBranch: string;
    targetHeadBeforeMerge: string;
};

export type NonGitDeliveryEvidence = {
    version: 1;
    mode: "non_git_in_place";
};

export type WorkflowControllerState = {
    updatedAt?: string;
    /** Document location may outlive execution, e.g. while revising a retired attempt. */
    documentWorktreeId?: string | null;
    executionMode?: "worktree" | "non_git_in_place" | null;
    validationCheckpoint?: ValidationCheckpoint | null;
    validationCiAttempts?: number;
    validationSemanticRounds?: number;
    failureReason?: string | null;
    failedAt?: string | null;
    implementedAt?: string | null;
    validatedAt?: string | null;
    verifiedAt?: string | null;
    executionReport?: string | null;
    humanReviewMode?: "none" | "ask" | "always" | null;
    humanReviewDecision?: "not_required" | "skipped" | "approved" | "changes_requested" | null;
    humanReviewedAt?: string | null;
    deliveryEvidence?: WorktreeDeliveryEvidence | NonGitDeliveryEvidence | null;
    holdStalenessBaseline?: string | null;
    collaborationState?: string;
    collaborationServerUrl?: string;
    collaborationSpaceId?: string;
    collaborationRevision?: number;
    collaborationBodyHash?: string;
    collaborationSyncedAt?: string;
};

export const CONTROLLER_STATE_FIELDS = [
    "updatedAt",
    "documentWorktreeId",
    "executionMode",
    "validationCheckpoint",
    "validationCiAttempts",
    "validationSemanticRounds",
    "failureReason",
    "failedAt",
    "implementedAt",
    "validatedAt",
    "verifiedAt",
    "executionReport",
    "humanReviewMode",
    "humanReviewDecision",
    "humanReviewedAt",
    "deliveryEvidence",
    "holdStalenessBaseline",
    "collaborationState",
    "collaborationServerUrl",
    "collaborationSpaceId",
    "collaborationRevision",
    "collaborationBodyHash",
    "collaborationSyncedAt",
] as const satisfies readonly (keyof WorkflowControllerState)[];

/** These are a read-only view of the existing worktree registry, never another copy. */
export type WorkflowWorktreeContext = {
    worktreeId?: string | null;
    worktreePath?: string | null;
    worktreeBranch?: string | null;
    worktreeBaseBranch?: string | null;
    worktreeStatus?:
        | "none"
        | "active"
        | "completed"
        | "execution_failed"
        | "validation_failed"
        | "merge_conflict"
        | "merged"
        | "abandoned"
        | null;
    executionBaselineTree?: string | null;
};

export const WORKTREE_CONTEXT_FIELDS = [
    "worktreeId",
    "worktreePath",
    "worktreeBranch",
    "worktreeBaseBranch",
    "worktreeStatus",
    "executionBaselineTree",
] as const satisfies readonly (keyof WorkflowWorktreeContext)[];

export const PLAN_RUNTIME_FIELDS = [...CONTROLLER_STATE_FIELDS, ...WORKTREE_CONTEXT_FIELDS] as const;

export function pickControllerState(source: Partial<WorkflowControllerState>): WorkflowControllerState {
    const result: WorkflowControllerState = {};
    for (const key of CONTROLLER_STATE_FIELDS) {
        if (!Object.hasOwn(source, key)) continue;
        const value = source[key] === null && ![
                "validationCheckpoint",
                "humanReviewMode",
                "humanReviewDecision",
                "humanReviewedAt",
            ].includes(key)
            ? undefined
            : source[key];
        Object.assign(result, { [key]: value });
    }
    return result;
}

export function stripRuntimeFields<T extends WorkflowControllerState & WorkflowWorktreeContext>(source: T): T {
    const result = { ...source };
    for (const key of PLAN_RUNTIME_FIELDS) delete result[key];
    return result;
}
