/**
 * @module shared/workflow/plan-lifecycle
 *
 * Central Plan Lifecycle state machine. Workflow callers should record Plan
 * Events here instead of mutating Plan Status directly.
 *
 * See docs/plan-lifecycle.md for the human-readable workflow.
 */

import { isPlannedChangeClassification } from "../../constants.js";
import {
    findPlansByParent,
    isPlanDependencySatisfiedStatus,
    loadPlan,
    normalizeDeliveryEvidence,
    normalizeExecutionMode,
    updatePlanFrontMatter,
} from "../../plan-store.js";
import { SHARED_PLAN_LOCK_REPAIR, SharedPlanLockError } from "../collaboration/lock.js";
import { runPlanLifecycleEventTransition } from "./state-transition.ts";

export class PlanLifecycleTransitionError extends Error {
    /**
     * @param {import('./state-transition.ts').TransitionResult} transition
     * @param {string} [message]
     */
    constructor(transition, message) {
        super(message || transition.message || `Plan Lifecycle transition ${transition.operation} did not commit.`);
        this.name = "PlanLifecycleTransitionError";
        this.transition = transition;
        this.status = transition.status;
        this.recoveryActions = transition.recoveryActions || [];
    }
}

/**
 * @typedef {"draft"|"feedback"|"approved"|"ready_for_decomposition"|"ready_for_work"|"in_progress"|"failed"|"implemented"|"validated_ci"|"validated_reviewer"|"validated"|"verified"|"user_verified"|"closed_without_verification"|"on_hold"} PlanStatus
 */

/** @type {Record<PlanStatus, string>} */
const PLAN_STATUS_HELP_TEXT = {
    draft: "it is still a draft",
    feedback: "it needs changes",
    approved: "it is approved",
    ready_for_decomposition: "it is ready to split into smaller work",
    ready_for_work: "it is ready for work",
    in_progress: "work has started",
    failed: "it failed",
    implemented: "the work is done",
    validated_ci: "the checks passed",
    validated_reviewer: "code review passed",
    validated: "all validation passed and publication is pending",
    verified: "it was delivered under the legacy lifecycle",
    user_verified: "you approved it",
    closed_without_verification: "it was closed without validation",
    on_hold: "it is on hold",
};

/**
 * @param {PlanStatus} status
 * @returns {string}
 */
function describePlanStatus(status) {
    return PLAN_STATUS_HELP_TEXT[status] || status;
}

/**
 * @param {string} planName
 * @param {PlanStatus} currentStatus
 * @param {PlanStatus} canonicalStatus
 * @returns {string}
 */
function buildStalePlanStatusMessage(planName, currentStatus, canonicalStatus) {
    return [
        `RunWield had old status data for Plan ${planName}.`,
        `It thought the Plan was at ${currentStatus} (${
            describePlanStatus(currentStatus)
        }), but the saved Plan is at ${canonicalStatus} (${describePlanStatus(canonicalStatus)}).`,
        "What to do: run validation again for this Plan. RunWield will read the saved Plan and keep going.",
        "Do not reset your worktree.",
    ].join(" ");
}

/**
 * @typedef {"review_feedback"|"review_approved"|"readiness_passed"|"epic_readiness_passed"|"decomposition_finalized"|"execution_started"|"execution_failed"|"implementation_finished"|"mechanical_validation_failed"|"mechanical_validation_passed"|"semantic_review_feedback"|"semantic_review_passed"|"validation_failed"|"validation_passed"|"worktree_merge_failed"|"recovery_continue"|"recovery_reset"|"review_reopened"|"epic_done_enough"|"manual_status_change"|"manual_closed_without_verification"|"manual_user_verified"|"plan_held"|"hold_resumed"|"hold_reset_to_draft"} PlanEvent
 */

/**
 * @typedef {Object} PlanEventDetails
 * @property {Partial<import('../../plan-store.js').PlanFrontMatter>} [triageMeta]
 * @property {string} [failureReason]
 * @property {string} [executionBaselineTree]
 * @property {string} [worktreeId]
 * @property {string} [worktreePath]
 * @property {string} [worktreeBranch]
 * @property {string} [worktreeBaseBranch]
 * @property {import('../../plan-store.js').PlanFrontMatter['worktreeStatus']} [worktreeStatus]
 * @property {boolean} [nonGitInPlace]
 * @property {boolean} [cleanupMergedWorktrees]
 * @property {string} [executionReport]
 * @property {import('../../plan-store.js').PlanFrontMatter['humanReviewMode']} [humanReviewMode]
 * @property {import('../../plan-store.js').PlanFrontMatter['humanReviewDecision']} [humanReviewDecision]
 * @property {string|null} [humanReviewedAt]
 * @property {number} [validationCiAttempts]
 * @property {number} [validationObjectiveCheckAttempts]
 * @property {number} [validationSemanticRounds]
 * @property {"ci"|"objective_check"} [mechanicalFailureKind]
 * @property {import('./validation-checkpoint.ts').ValidationCheckpoint|null} [validationCheckpoint]
 * @property {string} [epicDoneEnoughSummary]
 * @property {import('../../plan-store.js').ExecutionMode} [executionMode]
 * @property {import('../../plan-store.js').DeliveryEvidence} [deliveryEvidence]
 * @property {PlanStatus} [manualTargetStatus]
 * @property {string} [holdReason]
 * @property {string} [closedWithoutVerificationReason]
 * @property {string} [userVerificationNote]
 * @property {string} [holdStalenessBaseline]
 * @property {PlanStatus} [heldFromStatus]
 * @property {() => Date} [now]
 */

/** @type {PlanStatus[]} */
const MANUAL_BOARD_STATUSES = [
    "draft",
    "feedback",
    "approved",
    "ready_for_work",
];

/** @type {PlanStatus[]} */
const MANUAL_BOARD_SOURCE_STATUSES = [
    ...MANUAL_BOARD_STATUSES,
    "in_progress",
    "implemented",
];

/** @type {PlanStatus[]} */
export const PLAN_STATUSES = [
    "draft",
    "feedback",
    "approved",
    "ready_for_decomposition",
    "ready_for_work",
    "in_progress",
    "failed",
    "implemented",
    "validated_ci",
    "validated_reviewer",
    "validated",
    "verified",
    "user_verified",
    "closed_without_verification",
    "on_hold",
];

/** @type {PlanStatus[]} */
export const ACTIVE_PLAN_STATUSES = [
    "draft",
    "feedback",
    "approved",
    "ready_for_decomposition",
    "ready_for_work",
    "in_progress",
    "failed",
    "implemented",
    "validated_ci",
    "validated_reviewer",
];

/** @type {PlanStatus[]} */
export const VALIDATION_PLAN_STATUSES = ["implemented", "validated_ci", "validated_reviewer", "validated"];

/** @param {string | undefined | null} status */
export function isInValidation(status) {
    return VALIDATION_PLAN_STATUSES.includes(/** @type {PlanStatus} */ (status));
}

/** @type {PlanStatus[]} */
export const CLOSED_PLAN_STATUSES = ["validated", "verified", "user_verified", "closed_without_verification"];

/** @type {PlanStatus[]} */
export const ON_HOLD_PLAN_STATUSES = ["on_hold"];

/** @param {string | undefined | null} status */
export function isRunWieldVerifiedPlanStatus(status) {
    return status === "validated" || status === "verified";
}

/** @param {string | undefined | null} status */
export function isUserVerifiedPlanStatus(status) {
    return status === "user_verified";
}

/** @param {string | undefined | null} status */
export function isTerminalPlanStatus(status) {
    return CLOSED_PLAN_STATUSES.includes(/** @type {any} */ (status));
}

/** @param {string | undefined | null} status */
export function isArchiveEligiblePlanStatus(status) {
    return isTerminalPlanStatus(status);
}

/** @param {string | undefined | null} status */
export function isDependencySatisfiedPlanStatus(status) {
    return status === "validated" || status === "verified" || status === "user_verified";
}

const ALL_KNOWN_STATUSES = PLAN_STATUSES;

/** @type {Record<PlanEvent, PlanStatus[]>} */
const ALLOWED_FROM = {
    review_feedback: ["draft", "feedback", "approved"],
    review_approved: ["draft", "feedback", "approved"],
    readiness_passed: ["approved"],
    epic_readiness_passed: ["approved"],
    decomposition_finalized: ["approved", "ready_for_decomposition"],
    execution_started: ["ready_for_work"],
    execution_failed: ["in_progress"],
    implementation_finished: ["in_progress"],
    mechanical_validation_failed: ["implemented"],
    mechanical_validation_passed: ["implemented"],
    semantic_review_feedback: ["validated_ci"],
    semantic_review_passed: ["validated_ci"],
    validation_failed: ["implemented", "validated_ci", "validated_reviewer"],
    validation_passed: ["validated_reviewer"],
    worktree_merge_failed: ["validated_reviewer"],
    recovery_continue: ["in_progress", "failed"],
    recovery_reset: ["in_progress", "failed", "implemented"],
    review_reopened: [
        "ready_for_decomposition",
        "ready_for_work",
        "in_progress",
        "failed",
        "implemented",
        "validated",
        "verified",
        "user_verified",
    ],
    epic_done_enough: ["ready_for_work", "validated", "verified"],
    manual_status_change: ALL_KNOWN_STATUSES,
    manual_closed_without_verification: ALL_KNOWN_STATUSES,
    manual_user_verified: ALL_KNOWN_STATUSES,
    plan_held: ALL_KNOWN_STATUSES,
    hold_resumed: ["on_hold"],
    hold_reset_to_draft: ["on_hold"],
};

/** @type {Record<PlanEvent, PlanStatus>} */
const EVENT_STATUS = {
    review_feedback: "feedback",
    review_approved: "approved",
    readiness_passed: "ready_for_work",
    epic_readiness_passed: "ready_for_decomposition",
    decomposition_finalized: "ready_for_work",
    execution_started: "in_progress",
    execution_failed: "failed",
    implementation_finished: "implemented",
    mechanical_validation_failed: "implemented",
    mechanical_validation_passed: "validated_ci",
    semantic_review_feedback: "implemented",
    semantic_review_passed: "validated_reviewer",
    validation_failed: "implemented",
    validation_passed: "validated",
    worktree_merge_failed: "implemented",
    recovery_continue: "ready_for_work",
    recovery_reset: "ready_for_work",
    review_reopened: "feedback",
    epic_done_enough: "validated",
    manual_status_change: "draft",
    manual_closed_without_verification: "closed_without_verification",
    manual_user_verified: "user_verified",
    plan_held: "on_hold",
    hold_resumed: "draft",
    hold_reset_to_draft: "draft",
};

/**
 * @param {Date} date
 * @returns {string}
 */
function iso(date) {
    return date.toISOString();
}

/**
 * @param {string} status
 * @returns {status is PlanStatus}
 */
function isKnownPlanStatus(status) {
    return ALL_KNOWN_STATUSES.includes(/** @type {PlanStatus} */ (status));
}

/**
 * @param {PlanStatus} status
 * @param {import('../../plan-store.js').PlanFrontMatterInput | undefined} attrs
 * @returns {boolean}
 */
function isManualBoardStatus(status, attrs) {
    return MANUAL_BOARD_SOURCE_STATUSES.includes(status) || (status === "ready_for_decomposition" && isEpicPlan(attrs));
}

/**
 * User attestation may close an ordinary board Plan or an already-partially-
 * validated Plan. It never converts RunWield validation history into proof:
 * `manual_user_verified` keeps that history and does not synthesize Delivery
 * Evidence or `verifiedAt`.
 *
 * @param {PlanStatus} status
 * @param {import('../../plan-store.js').PlanFrontMatterInput | undefined} attrs
 * @returns {boolean}
 */
function isManualUserVerificationStatus(status, attrs) {
    return isManualBoardStatus(status, attrs) || status === "validated_ci" || status === "validated_reviewer";
}

/**
 * @param {PlanStatus} status
 * @param {import('../../plan-store.js').PlanFrontMatterInput | undefined} attrs
 * @returns {boolean}
 */
function isManualBoardTargetStatus(status, attrs) {
    return MANUAL_BOARD_STATUSES.includes(status) || (status === "ready_for_decomposition" && isEpicPlan(attrs));
}

/**
 * @param {PlanStatus} event
 */
function assertKnownHoldResumeStatus(event) {
    if (
        event === "on_hold" || event === "verified" || event === "user_verified" ||
        event === "closed_without_verification"
    ) {
        throw new Error(
            `Invalid Plan Lifecycle transition: hold_resumed cannot restore terminal/protected status "${event}".`,
        );
    }
}

/**
 * @param {PlanEvent} event
 * @param {PlanStatus} currentStatus
 */
function assertAllowedTransition(event, currentStatus) {
    const allowed = ALLOWED_FROM[event];
    if (!allowed.includes(currentStatus)) {
        throw new Error(
            `Invalid Plan Lifecycle transition: ${event} cannot apply to status "${currentStatus}". ` +
                `Allowed from: ${allowed.join(", ")}.`,
        );
    }
}

/**
 * @param {PlanStatus} currentStatus
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter> | undefined} attrs
 * @returns {PlanStatus[]}
 */
export function getAllowedManualPlanStatuses(currentStatus, attrs = {}) {
    if (!isManualBoardStatus(currentStatus, attrs)) return [];
    return isEpicPlan(attrs) ? [...MANUAL_BOARD_STATUSES, "ready_for_decomposition"] : [...MANUAL_BOARD_STATUSES];
}

/**
 * @param {PlanStatus} currentStatus
 * @param {PlanStatus} targetStatus
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter> | undefined} attrs
 * @returns {boolean}
 */
export function isManualBoardStatusChangeAllowed(currentStatus, targetStatus, attrs = {}) {
    return isManualBoardStatus(currentStatus, attrs) && isManualBoardTargetStatus(targetStatus, attrs);
}

/**
 * @param {PlanStatus} currentStatus
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter> | undefined} attrs
 * @returns {{ canCloseWithoutVerification: boolean, canUserVerify: boolean, canPutOnHold: boolean, canResumeFromHold: boolean, canResetToDraft: boolean, allowedManualTargetStatuses: PlanStatus[], blockedReasons: Record<string, string> }}
 */
export function getPlanLifecycleActionMetadata(currentStatus, attrs = {}) {
    /** @type {Record<string, string>} */
    const blockedReasons = {};
    const allowedManualTargetStatuses = getAllowedManualPlanStatuses(currentStatus, attrs).filter((status) =>
        status !== currentStatus
    );
    const canCloseWithoutVerification = isManualBoardStatus(currentStatus, attrs);
    const canUserVerify = isManualUserVerificationStatus(currentStatus, attrs);
    const canPutOnHold = currentStatus !== "verified" && currentStatus !== "user_verified" &&
        currentStatus !== "closed_without_verification" &&
        currentStatus !== "on_hold";
    const canResumeFromHold = currentStatus === "on_hold" && Boolean(attrs?.heldFromStatus);
    const canResetToDraft = currentStatus === "on_hold";

    if (!allowedManualTargetStatuses.length) {
        blockedReasons.move_status = currentStatus === "failed"
            ? "Failed Plans leave recovery through dedicated recovery workflow actions, not manual board movement."
            : "This status cannot be moved through generic board controls.";
    }
    if (!canCloseWithoutVerification) {
        blockedReasons.close_without_verification =
            "Only active manual board statuses can be closed without Workflow Validation.";
    }
    if (!canUserVerify) {
        blockedReasons.user_verify = "Only active or partially validated Plans can be marked User Verified.";
    }
    if (!canPutOnHold) {
        blockedReasons.put_on_hold = "Verified, closed, and already held Plans cannot be put on hold.";
    }
    if (currentStatus === "on_hold" && !attrs?.heldFromStatus) {
        blockedReasons.resume_from_hold = "This held Plan is missing heldFromStatus metadata.";
    } else if (!canResumeFromHold) {
        blockedReasons.resume_from_hold = "Only held Plans can be resumed.";
    }
    if (!canResetToDraft) blockedReasons.reset_to_draft = "Only held Plans can be reset to draft.";

    return {
        allowedManualTargetStatuses,
        canCloseWithoutVerification,
        canUserVerify,
        canPutOnHold,
        canResumeFromHold,
        canResetToDraft,
        blockedReasons,
    };
}

/**
 * @param {PlanStatus} currentStatus
 * @param {PlanEventDetails} details
 * @returns {PlanStatus}
 */
function getManualTargetStatus(currentStatus, details) {
    const target = details.manualTargetStatus;
    if (!target) {
        throw new Error("Invalid Plan Lifecycle transition: manual_status_change requires manualTargetStatus.");
    }
    if (!isKnownPlanStatus(target)) {
        throw new Error(`Invalid Plan Lifecycle transition: unknown manual target status "${target}".`);
    }
    if (!isManualBoardStatusChangeAllowed(currentStatus, target, details.triageMeta)) {
        throw new Error(
            `Invalid Plan Lifecycle transition: manual_status_change cannot move from "${currentStatus}" to "${target}".`,
        );
    }
    return target;
}

/**
 * @param {PlanEvent} event
 * @param {PlanStatus} currentStatus
 * @param {PlanEventDetails} details
 * @returns {Partial<import('../../plan-store.js').PlanFrontMatter>}
 */
export function buildPlanEventUpdates(event, currentStatus, details = {}) {
    assertAllowedTransition(event, currentStatus);
    if (event === "epic_done_enough" && !isEpicPlan(details.triageMeta)) {
        throw new Error("Invalid Plan Lifecycle transition: epic_done_enough can only apply to PROJECT Epic plans.");
    }

    const now = iso(details.now ? details.now() : new Date());
    const targetStatus = event === "manual_status_change"
        ? getManualTargetStatus(currentStatus, details)
        : EVENT_STATUS[event];
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    const updates = {
        ...(details.triageMeta || {}),
        status: targetStatus,
        updatedAt: now,
    };
    const clearsValidationMergeRepairWorktree = event === "validation_passed" || targetStatus === "implemented" ||
        event === "execution_started" || event === "recovery_reset" || event === "recovery_continue" ||
        event === "review_reopened" || event === "hold_reset_to_draft" || event === "manual_user_verified" ||
        event === "manual_closed_without_verification" || event === "epic_done_enough" ||
        (event === "manual_status_change" && isTerminalPlanStatus(targetStatus));
    if (clearsValidationMergeRepairWorktree) {
        updates.validationMergeRepairWorktree = null;
        updates.validationCheckpoint = null;
    }

    if (
        targetStatus === "implemented" && event !== "mechanical_validation_failed" &&
        event !== "semantic_review_feedback"
    ) {
        updates.validationCiAttempts = 0;
        updates.validationObjectiveCheckAttempts = 0;
        updates.validationSemanticRounds = 0;
    }

    if (event === "mechanical_validation_failed") {
        if (details.mechanicalFailureKind === "objective_check") {
            const currentAttempts = typeof details.triageMeta?.validationObjectiveCheckAttempts === "number"
                ? details.triageMeta.validationObjectiveCheckAttempts
                : 0;
            updates.validationObjectiveCheckAttempts = currentAttempts + 1;
        } else {
            const currentAttempts = typeof details.triageMeta?.validationCiAttempts === "number"
                ? details.triageMeta.validationCiAttempts
                : 0;
            updates.validationCiAttempts = currentAttempts + 1;
        }
        updates.validationSemanticRounds = 0;
        updates.failureReason = details.failureReason || "Mechanical Validation failed.";
        if (details.validationCheckpoint !== undefined) {
            updates.validationCheckpoint = details.validationCheckpoint;
        }
    }

    if (event === "mechanical_validation_passed") {
        updates.validationCiAttempts = 0;
        updates.validationObjectiveCheckAttempts = 0;
        updates.failureReason = null;
        updates.failedAt = null;
    }

    if (event === "semantic_review_feedback") {
        const currentRounds = typeof details.triageMeta?.validationSemanticRounds === "number"
            ? details.triageMeta.validationSemanticRounds
            : 0;
        updates.validationSemanticRounds = currentRounds + 1;
        updates.validationCiAttempts = 0;
        updates.validationObjectiveCheckAttempts = 0;
        updates.failureReason = details.failureReason || "Semantic Code Review requested changes.";
        // The open Review Issues and repair identity must commit with the status
        // move back to implemented. A later Session projection cannot fill this
        // in safely after the fact: the process may stop between these writes.
        if (details.validationCheckpoint !== undefined) {
            updates.validationCheckpoint = details.validationCheckpoint;
        }
    }

    if (event === "semantic_review_passed") {
        updates.failureReason = null;
        updates.failedAt = null;
        updates.validationCheckpoint = null;
    }

    if (event === "manual_closed_without_verification") {
        if (!isManualBoardStatus(currentStatus, details.triageMeta)) {
            throw new Error(
                `Invalid Plan Lifecycle transition: manual_closed_without_verification cannot apply to status "${currentStatus}".`,
            );
        }
        const reason = typeof details.closedWithoutVerificationReason === "string"
            ? details.closedWithoutVerificationReason.trim()
            : "";
        if (!reason) {
            throw new Error(
                "Invalid Plan Lifecycle transition: manual_closed_without_verification requires closedWithoutVerificationReason.",
            );
        }
        updates.status = "closed_without_verification";
        updates.closedWithoutVerificationReason = reason;
    }

    if (event === "manual_user_verified") {
        if (!isManualUserVerificationStatus(currentStatus, details.triageMeta)) {
            throw new Error(
                `Invalid Plan Lifecycle transition: manual_user_verified cannot apply to status "${currentStatus}".`,
            );
        }
        const note = typeof details.userVerificationNote === "string" ? details.userVerificationNote.trim() : "";
        if (!note) {
            throw new Error("Invalid Plan Lifecycle transition: manual_user_verified requires userVerificationNote.");
        }
        updates.status = "user_verified";
        updates.userVerifiedAt = now;
        updates.userVerificationNote = note;
        updates.objectiveChecksBaseline = undefined;
    }

    if (event === "plan_held") {
        if (
            currentStatus === "validated" || currentStatus === "verified" || currentStatus === "user_verified" ||
            currentStatus === "closed_without_verification" ||
            currentStatus === "on_hold"
        ) {
            throw new Error(`Invalid Plan Lifecycle transition: plan_held cannot apply to status "${currentStatus}".`);
        }
        updates.heldFromStatus = currentStatus;
        updates.heldAt = now;
        updates.holdReason = details.holdReason;
        updates.holdStalenessBaseline = details.holdStalenessBaseline;
    }

    if (event === "hold_resumed") {
        const heldFromStatus = details.heldFromStatus;
        if (!heldFromStatus) {
            throw new Error("Invalid Plan Lifecycle transition: hold_resumed requires heldFromStatus.");
        }
        if (!isKnownPlanStatus(heldFromStatus)) {
            throw new Error(`Invalid Plan Lifecycle transition: unknown heldFromStatus "${heldFromStatus}".`);
        }
        assertKnownHoldResumeStatus(heldFromStatus);
        updates.status = heldFromStatus;
        updates.heldFromStatus = null;
        updates.heldAt = null;
        updates.holdReason = null;
        updates.holdStalenessBaseline = null;
    }

    if (event === "hold_reset_to_draft") {
        updates.heldFromStatus = null;
        updates.heldAt = null;
        updates.holdReason = null;
        updates.holdStalenessBaseline = null;
        updates.executionMode = null;
        updates.deliveryEvidence = null;
        updates.executionBaselineTree = null;
        updates.worktreeId = null;
        updates.worktreePath = null;
        updates.worktreeBranch = null;
        updates.worktreeBaseBranch = null;
        updates.worktreeStatus = null;
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.validatedAt = null;
        updates.verifiedAt = null;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
    }

    if (event === "manual_status_change") {
        if (targetStatus !== "implemented") {
            updates.implementedAt = null;
            updates.validatedAt = null;
            updates.verifiedAt = null;
            updates.userVerifiedAt = null;
            updates.userVerificationNote = null;
            updates.deliveryEvidence = null;
            updates.humanReviewMode = null;
            updates.humanReviewDecision = null;
            updates.humanReviewedAt = null;
        }

        if (
            targetStatus === "draft" || targetStatus === "feedback" || targetStatus === "approved" ||
            targetStatus === "ready_for_decomposition"
        ) {
            updates.failureReason = null;
            updates.failedAt = null;
        }
    }

    if (event === "review_feedback") {
        updates.failureReason = null;
    }

    if (event === "review_approved") {
        updates.failureReason = null;
        updates.failedAt = null;
    }

    if (event === "readiness_passed" || event === "epic_readiness_passed" || event === "decomposition_finalized") {
        updates.failureReason = null;
        updates.failedAt = null;
        updates.verifiedAt = null;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
    }

    if (event === "execution_started") {
        updates.executionMode = details.nonGitInPlace ? "non_git_in_place" : "worktree";
        updates.deliveryEvidence = null;
        if (details.nonGitInPlace) {
            updates.executionBaselineTree = null;
            updates.worktreeId = null;
            updates.worktreePath = null;
            updates.worktreeBranch = null;
            updates.worktreeBaseBranch = null;
            updates.worktreeStatus = null;
        } else {
            updates.executionBaselineTree = details.executionBaselineTree;
            updates.worktreeId = details.worktreeId;
            updates.worktreePath = details.worktreePath;
            updates.worktreeBranch = details.worktreeBranch;
            updates.worktreeBaseBranch = details.worktreeBaseBranch;
            updates.worktreeStatus = details.worktreeStatus || "active";
        }
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.validatedAt = null;
        updates.verifiedAt = null;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
        updates.executionReport = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
    }

    if (event === "execution_failed") {
        updates.worktreeStatus = "execution_failed";
        updates.failureReason = details.failureReason || "Execution failed before implementation finished.";
        updates.failedAt = now;
    }

    if (event === "implementation_finished") {
        updates.executionMode = details.nonGitInPlace ? "non_git_in_place" : details.executionMode || "worktree";
        if (!details.nonGitInPlace) {
            updates.executionBaselineTree = details.executionBaselineTree || updates.executionBaselineTree;
            updates.worktreeId = details.worktreeId || updates.worktreeId;
            updates.worktreePath = details.worktreePath || updates.worktreePath;
            updates.worktreeBranch = details.worktreeBranch || updates.worktreeBranch;
            updates.worktreeBaseBranch = details.worktreeBaseBranch || updates.worktreeBaseBranch;
            updates.worktreeStatus = "completed";
        }
        updates.implementedAt = now;
        updates.failedAt = null;
        updates.executionReport = typeof details.executionReport === "string" && details.executionReport.trim()
            ? details.executionReport.trim()
            : undefined;
    }

    if (event === "validation_failed") {
        if (!details.nonGitInPlace) updates.worktreeStatus = "validation_failed";
        updates.failureReason = details.failureReason || "Workflow Validation failed.";
    }

    if (event === "worktree_merge_failed") {
        updates.worktreeId = details.worktreeId || updates.worktreeId;
        updates.worktreePath = details.worktreePath || updates.worktreePath;
        updates.worktreeBranch = details.worktreeBranch || updates.worktreeBranch;
        updates.worktreeBaseBranch = details.worktreeBaseBranch || updates.worktreeBaseBranch;
        updates.deliveryEvidence = details.deliveryEvidence || updates.deliveryEvidence;
        updates.worktreeStatus = "merge_conflict";
        updates.failureReason = details.failureReason || "Worktree merge failed.";
    }

    if (event === "epic_done_enough") {
        updates.validatedAt = now;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
        updates.objectiveChecksBaseline = undefined;
        updates.epicCompletionMode = "done_enough";
        updates.epicDoneEnoughAt = now;
        updates.epicDoneEnoughSummary = details.epicDoneEnoughSummary || "Epic marked done enough for now.";
        updates.failureReason = null;
        updates.failedAt = null;
    }

    if (event === "validation_passed") {
        const executionMode = normalizeExecutionMode(details.executionMode ?? updates.executionMode);
        const deliveryEvidence = normalizeDeliveryEvidence(details.deliveryEvidence);
        if (isPlannedChangeClassification(updates.classification)) {
            if (!executionMode) {
                throw new Error(
                    "Invalid Plan Lifecycle transition: planned change validation_passed requires executionMode.",
                );
            }
            if (!deliveryEvidence) {
                throw new Error(
                    "Invalid Plan Lifecycle transition: planned change validation_passed requires deliveryEvidence.",
                );
            }
            if (executionMode === "worktree" && deliveryEvidence.mode !== "worktree_merge") {
                throw new Error(
                    "Invalid Plan Lifecycle transition: worktree validation requires worktree Delivery Evidence.",
                );
            }
            if (executionMode === "non_git_in_place" && deliveryEvidence.mode !== "non_git_in_place") {
                throw new Error(
                    "Invalid Plan Lifecycle transition: non-Git validation requires non-Git Delivery Evidence.",
                );
            }
        }
        updates.executionMode = executionMode;
        updates.deliveryEvidence = deliveryEvidence;
        // The registry remains the publication/recovery authority until the push is
        // confirmed. The validated Plan is immutable and must not retain a pointer
        // that would require another front-matter rewrite after publication.
        updates.executionBaselineTree = null;
        updates.worktreeId = null;
        updates.worktreePath = null;
        updates.worktreeBranch = null;
        updates.worktreeBaseBranch = null;
        updates.worktreeStatus = null;
        updates.validatedAt = now;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
        updates.objectiveChecksBaseline = undefined;
        if (Object.hasOwn(details, "humanReviewMode")) updates.humanReviewMode = details.humanReviewMode;
        if (Object.hasOwn(details, "humanReviewDecision")) updates.humanReviewDecision = details.humanReviewDecision;
        if (Object.hasOwn(details, "humanReviewedAt")) updates.humanReviewedAt = details.humanReviewedAt ?? null;
        updates.failureReason = null;
        updates.failedAt = null;
    }

    if (event === "recovery_reset") {
        updates.executionMode = details.nonGitInPlace ? "non_git_in_place" : details.executionMode ?? null;
        updates.deliveryEvidence = null;
        updates.worktreeId = details.worktreeId || updates.worktreeId;
        updates.worktreePath = details.worktreePath || updates.worktreePath;
        updates.worktreeBranch = details.worktreeBranch || updates.worktreeBranch;
        updates.worktreeBaseBranch = details.worktreeBaseBranch || updates.worktreeBaseBranch;
        updates.executionBaselineTree = details.executionBaselineTree || updates.executionBaselineTree;
        updates.worktreeStatus = details.worktreeStatus || updates.worktreeStatus || "abandoned";
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.validatedAt = null;
        updates.verifiedAt = null;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
    }

    if (event === "recovery_continue") {
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.verifiedAt = null;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
        updates.deliveryEvidence = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
    }

    if (event === "review_reopened") {
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.verifiedAt = null;
        updates.userVerifiedAt = null;
        updates.userVerificationNote = null;
        updates.executionMode = null;
        updates.deliveryEvidence = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
        updates.executionBaselineTree = null;
        updates.worktreeId = null;
        updates.worktreePath = null;
        updates.worktreeBranch = null;
        updates.worktreeBaseBranch = null;
        updates.worktreeStatus = "abandoned";
    }

    return updates;
}

/** @param {import('../../plan-store.js').PlanFrontMatter} attrs */
function hasModeAppropriateDeliveryEvidence(attrs) {
    if (!isPlannedChangeClassification(attrs.classification)) return true;
    const executionMode = normalizeExecutionMode(attrs.executionMode);
    const deliveryEvidence = normalizeDeliveryEvidence(attrs.deliveryEvidence);
    if (!executionMode || !deliveryEvidence) return false;
    if (executionMode === "worktree") return deliveryEvidence.mode === "worktree_merge";
    if (executionMode === "non_git_in_place") return deliveryEvidence.mode === "non_git_in_place";
    return false;
}

/**
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} opts.planName
 * @param {PlanEvent} opts.event
 * @param {import('../../plan-store.js').PlanFrontMatter} opts.updatedAttrs
 * @param {PlanEventDetails} [opts.details]
 * @returns {Promise<void>}
 */
async function advanceParentEpicWhenAllChildrenVerified({ cwd, planName, event, updatedAttrs, details = {} }) {
    if (event !== "validation_passed" && event !== "manual_user_verified") return;
    if (isEpicPlan(updatedAttrs)) return;

    const parentPlanName = typeof updatedAttrs.parentPlan === "string" ? updatedAttrs.parentPlan : "";
    if (!parentPlanName) return;

    const parent = await loadPlan(cwd, parentPlanName);
    if (!parent || !isEpicPlan(parent.attrs)) return;
    if (isPlanDependencySatisfiedStatus(parent.attrs.status)) return;
    if (parent.attrs.status !== "ready_for_work") return;

    const children = await findPlansByParent(cwd, parentPlanName);
    if (!children.length) return;
    if (
        children.some((child) =>
            !isPlanDependencySatisfiedStatus(child.attrs.status) ||
            (child.attrs.status === "verified" && !hasModeAppropriateDeliveryEvidence(child.attrs))
        )
    ) return;

    await recordPlanEvent({
        cwd,
        planName: parentPlanName,
        event: "epic_done_enough",
        currentStatus: "ready_for_work",
        details: {
            triageMeta: parent.attrs,
            epicDoneEnoughSummary: `All ${children.length} child plans are completed after ${planName}.`,
            now: details.now,
        },
    });
}

/**
 * Record a Plan Event and persist the resulting Plan Front Matter.
 *
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} opts.planName
 * @param {PlanEvent} opts.event
 * @param {PlanStatus} opts.currentStatus
 * @param {PlanEventDetails} [opts.details]
 * @param {string} [opts.expectedRevision]
 * @returns {Promise<import('../../plan-store.js').PlanFrontMatter>}
 */
export async function recordPlanEvent({ cwd, planName, event, currentStatus, details = {}, expectedRevision }) {
    /**
     * @param {Awaited<ReturnType<typeof loadPlan>>} beforePlan
     * @returns {Promise<{ attrs: import('../../plan-store.js').PlanFrontMatter, details: Record<string, unknown> }>}
     */
    const applyChildEvent = async (beforePlan) => {
        if (!beforePlan) throw new Error(`Plan not found: ${planName}`);
        const canonicalStatus = beforePlan.attrs.status;
        if (currentStatus && currentStatus !== canonicalStatus) {
            throw new Error(buildStalePlanStatusMessage(planName, currentStatus, canonicalStatus));
        }
        const canonicalDetails = {
            ...details,
            // Authority-sensitive lifecycle facts (status, classification,
            // hierarchy, identity, worktree attempt, target ref) come from the
            // canonical Plan bytes read under the Plan lock. Caller metadata may
            // carry auxiliary fields such as timestamps or reports, but must not
            // override locked Plan front matter.
            triageMeta: { ...(details.triageMeta || {}), ...beforePlan.attrs },
        };
        const updates = buildPlanEventUpdates(event, canonicalStatus, canonicalDetails);
        const attrs = await updatePlanFrontMatter(cwd, planName, updates, canonicalDetails.triageMeta, {
            expectedRevision: beforePlan.revision,
        });
        return { attrs, details: canonicalDetails };
    };
    const run = async () => {
        const transition = await runPlanLifecycleEventTransition({
            projectRoot: cwd,
            planName,
            event,
            expectedRevision,
            record: async ({ beforePlan }) => await applyChildEvent(beforePlan),
        });
        if (transition.status !== "committed") {
            throw new PlanLifecycleTransitionError(
                transition,
                transition.message || `Plan Lifecycle transition ${event} did not commit for ${planName}.`,
            );
        }
        const value = /** @type {{ attrs: import('../../plan-store.js').PlanFrontMatter, details: Record<string, unknown> }} */
            (transition.value);
        await advanceParentEpicWhenAllChildrenVerified({
            cwd,
            planName,
            event,
            updatedAttrs: value.attrs,
            details: /** @type {any} */ (value.details),
        });
        return value.attrs;
    };
    try {
        if (event === "validation_passed" || event === "manual_user_verified") {
            const preflightPlan = await loadPlan(cwd, planName);
            const parentPlanName = preflightPlan && !isEpicPlan(preflightPlan.attrs) &&
                    typeof preflightPlan.attrs.parentPlan === "string"
                ? preflightPlan.attrs.parentPlan
                : "";
            const siblingNames = parentPlanName
                ? (await findPlansByParent(cwd, parentPlanName)).map((child) => child.name).sort()
                : [];
            /** @type {import('./state-transition.ts').TransitionResource[]} */
            const resources = [
                { kind: "catalog" },
                { kind: "plan", id: planName },
                ...(parentPlanName ? [{ kind: /** @type {const} */ ("plan"), id: parentPlanName }] : []),
                ...siblingNames.filter((name) => name !== planName).map((name) => ({
                    kind: /** @type {const} */ ("plan"),
                    id: name,
                })),
            ];
            const transition = await runPlanLifecycleEventTransition({
                projectRoot: cwd,
                planName,
                event,
                resources,
                expectedRevision,
                record: async ({ beforePlan }) => {
                    if (!beforePlan) throw new Error(`Plan not found: ${planName}`);
                    const canonicalStatus = beforePlan.attrs.status;
                    if (currentStatus && currentStatus !== canonicalStatus) {
                        throw new Error(buildStalePlanStatusMessage(planName, currentStatus, canonicalStatus));
                    }
                    const canonicalDetails = {
                        ...details,
                        triageMeta: { ...(details.triageMeta || {}), ...beforePlan.attrs },
                    };
                    const childUpdates = buildPlanEventUpdates(event, canonicalStatus, canonicalDetails);
                    const childParentPlanName = typeof beforePlan.attrs.parentPlan === "string"
                        ? beforePlan.attrs.parentPlan
                        : "";
                    if (childParentPlanName !== parentPlanName) {
                        throw new Error(`Plan hierarchy changed while applying ${event} for ${planName}.`);
                    }

                    /** @type {{ name: string, revision: string | undefined, attrs: import('../../plan-store.js').PlanFrontMatter }[]} */
                    let childrenBeforeWrite = [];
                    /** @type {Awaited<ReturnType<typeof loadPlan>>} */
                    let lockedParent = null;
                    /** @type {Record<string, unknown> | null} */
                    let parentUpdates = null;
                    if (parentPlanName && !isEpicPlan(beforePlan.attrs)) {
                        const lockedSiblingNames = (await findPlansByParent(cwd, parentPlanName)).map((child) =>
                            child.name
                        ).sort();
                        if (lockedSiblingNames.join("\n") !== siblingNames.join("\n")) {
                            throw new Error(`Child Plan set changed while applying ${event} for ${planName}.`);
                        }
                        lockedParent = await loadPlan(cwd, parentPlanName);
                        childrenBeforeWrite = await Promise.all(
                            (await findPlansByParent(cwd, parentPlanName)).map(async (child) => {
                                if (child.name === planName) {
                                    return { name: planName, revision: beforePlan.revision, attrs: beforePlan.attrs };
                                }
                                const lockedChild = await loadPlan(cwd, child.name);
                                if (!lockedChild) throw new Error(`Child Plan disappeared: ${child.name}`);
                                return { name: child.name, revision: lockedChild.revision, attrs: lockedChild.attrs };
                            }),
                        );
                        if (
                            lockedParent && isEpicPlan(lockedParent.attrs) &&
                            lockedParent.attrs.status === "ready_for_work"
                        ) {
                            const projectedChildren = childrenBeforeWrite.map((child) =>
                                child.name === planName
                                    ? { ...child, attrs: { ...child.attrs, ...childUpdates } }
                                    : child
                            );
                            const allChildrenDone = projectedChildren.length > 0 &&
                                projectedChildren.every((child) =>
                                    isPlanDependencySatisfiedStatus(child.attrs.status) &&
                                    (child.attrs.status !== "verified" ||
                                        hasModeAppropriateDeliveryEvidence(child.attrs))
                                );
                            if (allChildrenDone) {
                                const parentDetails = {
                                    triageMeta: lockedParent.attrs,
                                    epicDoneEnoughSummary:
                                        `All ${projectedChildren.length} child plans are completed after ${planName}.`,
                                    now: details.now,
                                };
                                parentUpdates = buildPlanEventUpdates(
                                    "epic_done_enough",
                                    "ready_for_work",
                                    parentDetails,
                                );
                            }
                        }
                    }

                    let childAttrs;
                    try {
                        childAttrs = await updatePlanFrontMatter(
                            cwd,
                            planName,
                            childUpdates,
                            canonicalDetails.triageMeta,
                            {
                                expectedRevision: beforePlan.revision,
                            },
                        );
                        if (parentUpdates && lockedParent) {
                            await updatePlanFrontMatter(cwd, parentPlanName, parentUpdates, lockedParent.attrs, {
                                expectedRevision: lockedParent.revision,
                            });
                        }
                    } catch (error) {
                        // Do not blindly restore the child bytes after a parent-write
                        // failure. The child write is CAS-protected, but a later read
                        // of the current child revision does not prove no unmanaged
                        // editor/Git change happened after our write. Leave the
                        // semantic transition journal to drive explicit recovery.
                        void childAttrs;
                        throw error;
                    }
                    return { attrs: childAttrs, details: canonicalDetails };
                },
            });
            if (transition.status !== "committed") {
                throw new PlanLifecycleTransitionError(
                    transition,
                    transition.message || `Plan Lifecycle transition ${event} did not commit for ${planName}.`,
                );
            }
            return /** @type {{ attrs: import('../../plan-store.js').PlanFrontMatter }} */ (transition.value).attrs;
        }
        return await run();
    } catch (error) {
        if (error instanceof SharedPlanLockError) {
            throw new SharedPlanLockError(error.collaboration, {
                reason: "Lifecycle status changes must use the collaboration workflow.",
                repair: SHARED_PLAN_LOCK_REPAIR,
            });
        }
        throw error;
    }
}

/**
 * @typedef {Object} ValidationPassedStagingResult
 * @property {import('../../plan-store.js').PlanFrontMatter} attrs
 * @property {string[]} planPaths
 */

/**
 * Record validation_passed in the authoritative execution-worktree Plan. A
 * previously validated copy is returned unchanged so publication retries keep
 * its original evidence and never dirty the Plan again.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.executionCwd
 * @param {string} opts.planName
 * @param {PlanEventDetails} [opts.details]
 * @returns {Promise<ValidationPassedStagingResult>}
 */
export async function stageValidationPassedInExecutionWorktree({
    projectRoot: _projectRoot,
    executionCwd,
    planName,
    details = {},
}) {
    const planPath = `docs/plans/${planName}.md`;
    const executionPlan = await loadPlan(executionCwd, planName);
    if (!executionPlan) throw new Error(`Plan not found in its execution worktree: ${planName}`);
    if (executionPlan.attrs.status === "validated") {
        return { attrs: executionPlan.attrs, planPaths: [planPath] };
    }
    if (executionPlan.attrs.status !== "validated_reviewer") {
        throw new Error(
            `Cannot record completed validation for ${planName}: the execution Plan is at ` +
                `"${executionPlan.attrs.status}" instead of "validated_reviewer".`,
        );
    }
    const attrs = await recordPlanEvent({
        cwd: executionCwd,
        planName,
        event: "validation_passed",
        currentStatus: "validated_reviewer",
        details: { ...details, triageMeta: executionPlan.attrs, cleanupMergedWorktrees: false },
    });
    return { attrs, planPaths: [planPath] };
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatterInput | undefined} attrs
 * @returns {boolean}
 */
export function isEpicPlan(attrs) {
    return attrs?.classification === "PROJECT";
}

/**
 * @param {string} status
 * @returns {boolean}
 */
export function isExecutablePlanStatus(status) {
    return status === "ready_for_work";
}

/**
 * Whether a review decision can be recorded from `status` as-is.
 *
 * Any other status means the Plan has already passed readiness or execution, so
 * recording a decision requires first detaching it from that generation — a
 * `review_reopened` transition covering both the Plan and its worktree registry
 * entry. This lives here, beside `ALLOWED_FROM`, because it is the same rule:
 * `review_approved` and `review_feedback` are legal only from these statuses,
 * and two modules keeping private copies of it is how the reopen came to run
 * twice, once against a stale status.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function isPlanReviewableWithoutReopen(status) {
    return /** @type {readonly string[]} */ (ALLOWED_FROM.review_approved).includes(status);
}
