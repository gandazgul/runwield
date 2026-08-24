import { resolve } from "node:path";
import {
    getStoredPlanPath,
    injectFrontMatter,
    loadPlan,
    parsePlanFrontMatter,
    StalePlanWriteError,
    writePlanMarkdownWithRevision,
} from "../../plan-store.js";
import { buildPlanEventUpdates, isPlanReviewableWithoutReopen, recordPlanEvent } from "./plan-lifecycle.js";
import { runPlanReviewDecisionTransition } from "./state-transition.ts";
import { findById as findWorktreeById, updateEntry as updateWorktreeRegistryEntry } from "../worktree-registry.js";
import { PLAN_APPROVAL_ACTIONS } from "./plan-approval.js";
import { loadPlanActionEvidence } from "./plan-actions.ts";
import type { PlanFrontMatter } from "../../plan-store.js";
import type { PlanApprovalAction } from "./plan-approval.js";
import type { PlanWorktreeExpectation } from "./plan-actions.ts";

export interface SharedPlanReviewDecision {
    approved?: boolean;
    feedback?: string;
    approvalAction?: PlanApprovalAction;
    plan?: string;
    executionAgent?: "engineer" | "frontend-engineer";
    collaborationRecommendation?: "autonomous" | "pair";
}

export interface SharedPlanReviewEvidence {
    planId: string;
    runwieldSessionId?: string;
    status: string;
    worktree: PlanWorktreeExpectation;
}

export interface SharedPlanReviewActionOptions {
    cwd: string;
    planName: string;
    planPath: string;
    planWithFrontMatter: string;
    planRevision: string;
    originalAttrs: PlanFrontMatter;
    trustedClassification?: PlanFrontMatter["classification"];
    trustedWorkKind?: PlanFrontMatter["workKind"];
    expectedSessionId?: string;
    reviewEvidence?: SharedPlanReviewEvidence;
    decision: SharedPlanReviewDecision;
}

export interface SharedPlanReviewActionResult {
    approved: boolean;
    feedback?: string;
    approvalAction?: PlanApprovalAction;
    planAttrs?: PlanFrontMatter;
    revision?: string;
    recoveryRequired?: { message: string; entryIds: string[] };
    cancellationReason?: "stale_plan_review";
}

function readApprovedExecutionPolicy(
    decision: SharedPlanReviewDecision,
): { executionAgent: "engineer" | "frontend-engineer"; collaborationRecommendation: "autonomous" | "pair" } | null {
    const executionAgent = decision.executionAgent;
    const collaborationRecommendation = decision.collaborationRecommendation;
    if (executionAgent !== "engineer" && executionAgent !== "frontend-engineer") return null;
    if (collaborationRecommendation !== "autonomous" && collaborationRecommendation !== "pair") return null;
    return { executionAgent, collaborationRecommendation };
}

function reviewRejected(message: string): SharedPlanReviewActionResult {
    return { approved: false, feedback: message, cancellationReason: "stale_plan_review" };
}

function validatedClassification(
    classification: PlanFrontMatter["classification"] | undefined,
): "PROJECT" | "PLANNED_CHANGE" | null {
    if (classification === "PROJECT") return "PROJECT";
    if (classification === "PLANNED_CHANGE" || classification === "FEATURE") return "PLANNED_CHANGE";
    return null;
}

function approvalActionAllowed(classification: "PROJECT" | "PLANNED_CHANGE", action: PlanApprovalAction | undefined) {
    if (!action) return false;
    if (action === PLAN_APPROVAL_ACTIONS.LATER) return true;
    if (classification === "PROJECT") return action === PLAN_APPROVAL_ACTIONS.DECOMPOSE;
    return action === PLAN_APPROVAL_ACTIONS.RUN;
}

function sameWorktreeEvidence(left: PlanWorktreeExpectation, right: PlanWorktreeExpectation): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function validateReviewEvidence(
    cwd: string,
    planName: string,
    planRevision: string,
    reviewEvidence?: SharedPlanReviewEvidence,
): Promise<SharedPlanReviewActionResult | null> {
    if (!reviewEvidence) return null;
    const evidence = await loadPlanActionEvidence(cwd, reviewEvidence.planId);
    if (evidence.kind === "recovery_required") {
        return {
            approved: false,
            feedback: evidence.message,
            recoveryRequired: { message: evidence.message, entryIds: evidence.entryIds },
        };
    }
    if (evidence.kind !== "success") return reviewRejected(evidence.message);
    if (evidence.evidence.planName !== planName || evidence.evidence.planId !== reviewEvidence.planId) {
        return reviewRejected("Live review Plan evidence does not match this Plan. Reload the Plan and review again.");
    }
    if (evidence.evidence.revision !== planRevision) {
        return reviewRejected("Plan changed after review opened; reload the review before applying this decision.");
    }
    if (evidence.evidence.status !== reviewEvidence.status) {
        return reviewRejected("Plan Status changed after review opened. Reload the Plan and review again.");
    }
    if (!sameWorktreeEvidence(evidence.evidence.worktree, reviewEvidence.worktree)) {
        return reviewRejected("Plan worktree evidence changed after review opened. Reload the Plan and review again.");
    }
    return null;
}

export async function applySharedPlanReviewDecision({
    cwd,
    planName,
    planPath,
    planWithFrontMatter,
    planRevision,
    originalAttrs,
    trustedClassification,
    trustedWorkKind,
    expectedSessionId,
    reviewEvidence,
    decision,
}: SharedPlanReviewActionOptions): Promise<SharedPlanReviewActionResult> {
    const approved = decision.approved === true;
    const canonicalClassification = validatedClassification(trustedClassification);
    if (!canonicalClassification) return reviewRejected("Plan review classification is not supported.");
    if (expectedSessionId && reviewEvidence?.runwieldSessionId !== expectedSessionId) {
        return reviewRejected(
            "Live review Session evidence does not match this Session. Reload the Plan and review again.",
        );
    }
    if (approved && !approvalActionAllowed(canonicalClassification, decision.approvalAction)) {
        return reviewRejected("Plan review approval action is not supported for this Plan.");
    }
    const approvedPolicy = readApprovedExecutionPolicy(decision);
    if (
        approved && decision.approvalAction === PLAN_APPROVAL_ACTIONS.RUN &&
        canonicalClassification === "PLANNED_CHANGE" && !approvedPolicy
    ) {
        return reviewRejected("Plan review execution policy is not valid.");
    }
    const evidenceIssue = await validateReviewEvidence(cwd, planName, planRevision, reviewEvidence);
    if (evidenceIssue) return evidenceIssue;

    let reviewedPlan = typeof decision.plan === "string" ? decision.plan : planWithFrontMatter;
    const canonicalReviewOverrides = {
        classification: canonicalClassification,
        ...(trustedWorkKind ? { workKind: trustedWorkKind } : {}),
    };
    if (canonicalClassification === "PROJECT") {
        Object.assign(canonicalReviewOverrides, {
            executionAgent: null,
            collaborationRecommendation: null,
            frontend: null,
        });
    } else if (approved && approvedPolicy) {
        Object.assign(canonicalReviewOverrides, {
            executionAgent: approvedPolicy.executionAgent,
            collaborationRecommendation: approvedPolicy.collaborationRecommendation,
            frontend: null,
        });
    }
    reviewedPlan = injectFrontMatter(reviewedPlan, canonicalReviewOverrides);
    const reviewedAttrs = parsePlanFrontMatter(reviewedPlan).attrs;
    const canonicalPlanPath = getStoredPlanPath(cwd, planName);
    let lifecycleMeta: PlanFrontMatter = reviewedAttrs;
    let committedRevision: string | undefined;
    if (resolve(canonicalPlanPath) === resolve(planPath)) {
        const reopenWorktreeId = isPlanReviewableWithoutReopen(originalAttrs.status)
            ? undefined
            : originalAttrs.worktreeId ?? undefined;
        const reviewTransition = await runPlanReviewDecisionTransition({
            projectRoot: cwd,
            planName,
            approved,
            worktreeId: reopenWorktreeId,
            expectedRevision: planRevision,
            decide: async ({ beforePlan, markEffect, registerRollback }) => {
                if (!beforePlan) throw new Error(`Plan not found: ${planName}`);
                if (beforePlan.revision !== planRevision) {
                    throw new Error(
                        "Plan changed after review opened; reload the review before applying this decision.",
                    );
                }
                let nextMarkdown = reviewedPlan;
                let nextAttrs = reviewedAttrs;
                let status = beforePlan.attrs.status;
                if (!isPlanReviewableWithoutReopen(status)) {
                    const reopenUpdates = buildPlanEventUpdates("review_reopened", status, {
                        triageMeta: nextAttrs,
                    });
                    nextMarkdown = injectFrontMatter(nextMarkdown, reopenUpdates);
                    nextAttrs = parsePlanFrontMatter(nextMarkdown).attrs;
                    status = "feedback";
                    if (reopenWorktreeId) {
                        const before = await findWorktreeById(cwd, reopenWorktreeId);
                        registerRollback(`restore worktree registry status for ${reopenWorktreeId}`, async () => {
                            if (before?.status) {
                                await updateWorktreeRegistryEntry(cwd, reopenWorktreeId, {
                                    status: before.status,
                                });
                            }
                        });
                        await updateWorktreeRegistryEntry(cwd, reopenWorktreeId, { status: "abandoned" });
                        await markEffect("worktree_registry_abandoned", { worktreeId: reopenWorktreeId });
                    }
                }
                const event = approved ? "review_approved" : "review_feedback";
                const eventUpdates = buildPlanEventUpdates(event, status, {
                    triageMeta: nextAttrs,
                    failureReason: decision.feedback,
                });
                nextMarkdown = injectFrontMatter(nextMarkdown, eventUpdates);
                nextAttrs = parsePlanFrontMatter(nextMarkdown).attrs;
                const revision = await writePlanMarkdownWithRevision(
                    beforePlan.path,
                    nextMarkdown,
                    beforePlan.revision,
                );
                return { attrs: nextAttrs, revision };
            },
        });
        if (reviewTransition.status !== "committed") {
            return {
                approved: false,
                feedback: reviewTransition.message ||
                    "Plan changed while review was open. Reload the Plan and review again.",
                cancellationReason: "stale_plan_review",
            };
        }
        const transitionValue = reviewTransition.value as { attrs?: PlanFrontMatter; revision?: string } | undefined;
        lifecycleMeta = transitionValue?.attrs || reviewedAttrs;
        committedRevision = transitionValue?.revision;
    } else {
        try {
            committedRevision = await writePlanMarkdownWithRevision(planPath, reviewedPlan, planRevision);
        } catch (error) {
            if (error instanceof StalePlanWriteError) {
                return {
                    approved: false,
                    feedback: "Plan changed while review was open. Reload the Plan and review again.",
                    cancellationReason: "stale_plan_review",
                };
            }
            throw error;
        }

        const statusAllowsReview = isPlanReviewableWithoutReopen(originalAttrs.status);
        if (!statusAllowsReview) {
            const reopenedMeta = await recordPlanEvent({
                cwd,
                planName,
                event: "review_reopened",
                currentStatus: originalAttrs.status,
                details: { triageMeta: lifecycleMeta },
                expectedRevision: committedRevision,
            });
            if (reopenedMeta) lifecycleMeta = { ...lifecycleMeta, ...reopenedMeta };
        }
        const postReopenStatus = statusAllowsReview ? originalAttrs.status : "feedback";
        if (approved) {
            const approvedMeta = await recordPlanEvent({
                cwd,
                planName,
                event: "review_approved",
                currentStatus: postReopenStatus,
                details: { triageMeta: lifecycleMeta },
                expectedRevision: committedRevision,
            });
            if (approvedMeta) lifecycleMeta = { ...lifecycleMeta, ...approvedMeta };
        } else {
            const feedbackMeta = await recordPlanEvent({
                cwd,
                planName,
                event: "review_feedback",
                currentStatus: postReopenStatus,
                details: { triageMeta: lifecycleMeta, failureReason: decision.feedback },
                expectedRevision: committedRevision,
            });
            if (feedbackMeta) lifecycleMeta = { ...lifecycleMeta, ...feedbackMeta };
        }
        const latestPlan = await loadPlan(cwd, planName).catch(() => null);
        if (latestPlan?.revision) committedRevision = latestPlan.revision;
    }

    return {
        approved,
        feedback: decision.feedback,
        ...(decision.approvalAction && { approvalAction: decision.approvalAction }),
        ...(approved && { planAttrs: lifecycleMeta }),
        ...(committedRevision && { revision: committedRevision }),
    };
}
