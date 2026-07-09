/**
 * @module shared/workflow/plan-lifecycle
 *
 * Central Plan Lifecycle state machine. Workflow callers should record Plan
 * Events here instead of mutating Plan Status directly.
 *
 * See docs/plan-lifecycle.md for the human-readable workflow.
 */

import { updatePlanFrontMatter } from "../../plan-store.js";
import { SHARED_PLAN_LOCK_REPAIR, SharedPlanLockError } from "../collaboration/lock.js";

/**
 * @typedef {"draft"|"feedback"|"approved"|"ready_for_decomposition"|"ready_for_work"|"in_progress"|"failed"|"implemented"|"verified"|"closed_without_verification"|"on_hold"} PlanStatus
 */

/**
 * @typedef {"review_feedback"|"review_approved"|"readiness_passed"|"epic_readiness_passed"|"decomposition_finalized"|"execution_started"|"execution_failed"|"implementation_finished"|"validation_failed"|"validation_passed"|"worktree_merge_failed"|"recovery_continue"|"recovery_reset"|"review_reopened"|"epic_done_enough"|"manual_status_change"|"manual_closed_without_verification"|"plan_held"|"hold_resumed"|"hold_reset_to_draft"} PlanEvent
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
 * @property {import('../../plan-store.js').PlanFrontMatter['humanReviewMode']} [humanReviewMode]
 * @property {import('../../plan-store.js').PlanFrontMatter['humanReviewDecision']} [humanReviewDecision]
 * @property {string|null} [humanReviewedAt]
 * @property {string} [epicDoneEnoughSummary]
 * @property {PlanStatus} [manualTargetStatus]
 * @property {string} [holdReason]
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
    "verified",
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
];

/** @type {PlanStatus[]} */
export const CLOSED_PLAN_STATUSES = ["verified", "closed_without_verification"];

/** @type {PlanStatus[]} */
export const ON_HOLD_PLAN_STATUSES = ["on_hold"];

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
    validation_failed: ["implemented"],
    validation_passed: ["implemented"],
    worktree_merge_failed: ["implemented"],
    recovery_continue: ["in_progress", "failed"],
    recovery_reset: ["in_progress", "failed", "implemented"],
    review_reopened: ["ready_for_decomposition", "ready_for_work", "in_progress", "failed", "implemented", "verified"],
    epic_done_enough: ["ready_for_work", "verified"],
    manual_status_change: ALL_KNOWN_STATUSES,
    manual_closed_without_verification: ALL_KNOWN_STATUSES,
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
    validation_failed: "implemented",
    validation_passed: "verified",
    worktree_merge_failed: "implemented",
    recovery_continue: "ready_for_work",
    recovery_reset: "ready_for_work",
    review_reopened: "feedback",
    epic_done_enough: "verified",
    manual_status_change: "draft",
    manual_closed_without_verification: "closed_without_verification",
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
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter> | undefined} attrs
 * @returns {boolean}
 */
function isManualBoardStatus(status, attrs) {
    return MANUAL_BOARD_STATUSES.includes(status) || (status === "ready_for_decomposition" && isEpicPlan(attrs));
}

/**
 * @param {PlanStatus} event
 */
function assertKnownHoldResumeStatus(event) {
    if (event === "on_hold" || event === "verified" || event === "closed_without_verification") {
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
    return isManualBoardStatus(currentStatus, attrs) && isManualBoardStatus(targetStatus, attrs);
}

/**
 * @param {PlanStatus} currentStatus
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter> | undefined} attrs
 * @returns {{ canCloseWithoutVerification: boolean, canPutOnHold: boolean, canResumeFromHold: boolean, canResetToDraft: boolean, allowedManualTargetStatuses: PlanStatus[], blockedReasons: Record<string, string> }}
 */
export function getPlanLifecycleActionMetadata(currentStatus, attrs = {}) {
    /** @type {Record<string, string>} */
    const blockedReasons = {};
    const allowedManualTargetStatuses = getAllowedManualPlanStatuses(currentStatus, attrs).filter((status) =>
        status !== currentStatus
    );
    const canCloseWithoutVerification = isManualBoardStatus(currentStatus, attrs);
    const canPutOnHold = currentStatus !== "verified" && currentStatus !== "closed_without_verification" &&
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

    if (event === "manual_closed_without_verification") {
        if (!isManualBoardStatus(currentStatus, details.triageMeta)) {
            throw new Error(
                `Invalid Plan Lifecycle transition: manual_closed_without_verification cannot apply to status "${currentStatus}".`,
            );
        }
        updates.status = "closed_without_verification";
    }

    if (event === "plan_held") {
        if (
            currentStatus === "verified" || currentStatus === "closed_without_verification" ||
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
        updates.executionBaselineTree = null;
        updates.worktreeId = null;
        updates.worktreePath = null;
        updates.worktreeBranch = null;
        updates.worktreeBaseBranch = null;
        updates.worktreeStatus = null;
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.verifiedAt = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
    }

    if (event === "manual_status_change") {
        if (targetStatus !== "implemented") {
            updates.implementedAt = null;
            updates.verifiedAt = null;
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
    }

    if (event === "execution_started") {
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
        updates.verifiedAt = null;
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
        if (!details.nonGitInPlace) updates.worktreeStatus = "completed";
        updates.implementedAt = now;
        updates.failedAt = null;
    }

    if (event === "validation_failed") {
        if (!details.nonGitInPlace) updates.worktreeStatus = "validation_failed";
        updates.failureReason = details.failureReason || "Workflow Validation failed.";
    }

    if (event === "worktree_merge_failed") {
        updates.worktreePath = details.worktreePath || updates.worktreePath;
        updates.worktreeBranch = details.worktreeBranch || updates.worktreeBranch;
        updates.worktreeBaseBranch = details.worktreeBaseBranch || updates.worktreeBaseBranch;
        updates.worktreeStatus = "merge_conflict";
        updates.failureReason = details.failureReason || "Worktree merge failed.";
    }

    if (event === "epic_done_enough") {
        updates.verifiedAt = now;
        updates.epicCompletionMode = "done_enough";
        updates.epicDoneEnoughAt = now;
        updates.epicDoneEnoughSummary = details.epicDoneEnoughSummary || "Epic marked done enough for now.";
        updates.failureReason = null;
        updates.failedAt = null;
    }

    if (event === "validation_passed") {
        updates.worktreeStatus = details.worktreeStatus || "merged";
        if (details.cleanupMergedWorktrees !== false) {
            updates.executionBaselineTree = null;
            updates.worktreeId = null;
            updates.worktreePath = null;
            updates.worktreeBranch = null;
            updates.worktreeBaseBranch = null;
            updates.worktreeStatus = null;
        }
        updates.verifiedAt = now;
        updates.humanReviewMode = details.humanReviewMode;
        updates.humanReviewDecision = details.humanReviewDecision;
        updates.humanReviewedAt = details.humanReviewedAt ?? null;
        updates.failureReason = null;
        updates.failedAt = null;
    }

    if (event === "recovery_reset") {
        updates.worktreeId = details.worktreeId || updates.worktreeId;
        updates.worktreePath = details.worktreePath || updates.worktreePath;
        updates.worktreeBranch = details.worktreeBranch || updates.worktreeBranch;
        updates.worktreeBaseBranch = details.worktreeBaseBranch || updates.worktreeBaseBranch;
        updates.executionBaselineTree = details.executionBaselineTree || updates.executionBaselineTree;
        updates.worktreeStatus = details.worktreeStatus || updates.worktreeStatus || "abandoned";
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.verifiedAt = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
    }

    if (event === "recovery_continue") {
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.verifiedAt = null;
        updates.humanReviewMode = null;
        updates.humanReviewDecision = null;
        updates.humanReviewedAt = null;
    }

    if (event === "review_reopened") {
        updates.failureReason = null;
        updates.failedAt = null;
        updates.implementedAt = null;
        updates.verifiedAt = null;
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

/**
 * Record a Plan Event and persist the resulting Plan Front Matter.
 *
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} opts.planName
 * @param {PlanEvent} opts.event
 * @param {PlanStatus} opts.currentStatus
 * @param {PlanEventDetails} [opts.details]
 * @returns {Promise<import('../../plan-store.js').PlanFrontMatter>}
 */
export async function recordPlanEvent({ cwd, planName, event, currentStatus, details = {} }) {
    const updates = buildPlanEventUpdates(event, currentStatus, details);
    try {
        return await updatePlanFrontMatter(cwd, planName, updates, details.triageMeta);
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
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter> | undefined} attrs
 * @returns {boolean}
 */
export function isEpicPlan(attrs) {
    return attrs?.classification === "PROJECT" && attrs?.type === "epic";
}

/**
 * @param {string} status
 * @returns {boolean}
 */
export function isExecutablePlanStatus(status) {
    return status === "ready_for_work";
}
