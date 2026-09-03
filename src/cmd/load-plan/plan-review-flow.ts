/**
 * @module cmd/load-plan/plan-review-flow
 * Direct Plan Review handling for Plans loaded from disk.
 *
 * This module owns the shortcut that opens Plannotator without first running
 * Planner or Architect. The review decision still routes through the normal
 * lifecycle, planning, execution, and Slicer handoffs.
 */

import { AGENTS, CLI_BIN } from "../../constants.js";
import { type PlanFrontMatter, resolvePlanExecutionPolicy } from "../../plan-store.js";
import { decidePostExecution, decidePostPlanning } from "../../shared/workflow/decisions.js";
import { isEpicPlan, isPlanReviewableWithoutReopen, recordPlanEvent } from "../../shared/workflow/plan-lifecycle.js";
import { resolveWorkflowPlanLocation } from "../../shared/workflow/plan-location.ts";
import { normalizePlanApprovalAction, PLAN_APPROVAL_ACTIONS } from "../../shared/workflow/plan-approval.js";
import {
    appendSessionCompleteGuidance,
    requestRecoverablePlanReview,
    SESSION_COMPLETE_GUIDANCE,
} from "../../shared/workflow/plan-review-recovery.js";
import { RuntimeInteractionOutcomes } from "../../shared/session/session-runtime-interactions.js";
import type { UiAPI } from "../../ui/tui/types.js";
import { buildReReviewRevisionRequest } from "./plan-presentation.ts";
import {
    confirmAffectedPathChangesBeforeExecution,
    executePostPlanningDecision,
    prepareApprovedPlanForWork,
    shouldKeepPlanningAgentActive,
    validatePlanExecutionPolicyForReadiness,
    validatePostExecutionDecision,
} from "./plan-execution.ts";
import { assertRecoveryWorktreeIsManaged, resolveRecoveryWorktree } from "./plan-recovery-worktree.ts";
import type { PlanSessionSurface } from "./plan-session-types.ts";

interface ReviewableLoadedPlan {
    planName: string;
    path: string;
    attrs: PlanFrontMatter;
    body?: string;
    markdown?: string;
}

interface DirectReviewOptions {
    projectRoot: string;
    plan: ReviewableLoadedPlan;
    agentName: string;
    uiAPI: UiAPI;
    executePlan: PlanSessionSurface["executePlan"];
    continueWorkflowValidation: PlanSessionSurface["runValidation"];
    runPlanningAgent: PlanSessionSurface["runPlanningAgent"];
    runSlicerAgent: PlanSessionSurface["runSlicerAgent"];
    session: PlanSessionSurface;
}

export interface DirectPlanReviewEligibility {
    eligible: boolean;
    reason?: "unsupported_status" | "invalid_execution_policy" | "missing_objective_failing_check";
    message?: string;
}

export interface DirectPlanReviewResult {
    keepPlanAgentActive: boolean;
}

const DIRECT_REVIEW_STATUSES = new Set(["draft", "feedback", "approved", "ready_for_work"]);

function fieldHasValue(line: string, fieldName: string): boolean {
    const match = new RegExp(`\\b${fieldName}:\\s*(.*)$`).exec(line);
    return Boolean(match?.[1]?.trim());
}

function hasValidObjectiveFailingCheck(plan: { markdown?: string; body?: string }): boolean {
    const markdown = plan.markdown || "";
    const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
    if (!frontMatter) return false;

    let inObjectiveChecks = false;
    let currentCheckHasId = false;
    let currentCheckHasCommand = false;
    const checkComplete = () => currentCheckHasId && currentCheckHasCommand;

    for (const line of frontMatter.split(/\r?\n/)) {
        if (!inObjectiveChecks) {
            const start = /^objectiveChecks:\s*(.*)$/.exec(line);
            if (!start) continue;
            inObjectiveChecks = true;
            if (start[1].trim() && start[1].trim() !== "[]") {
                return /\bid:\s*[^,}\]]+/.test(start[1]) && /\bcommand:\s*[^,}\]]+/.test(start[1]);
            }
            continue;
        }

        if (/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(line)) break;
        if (/^\s*-\s*/.test(line)) {
            if (checkComplete()) return true;
            currentCheckHasId = false;
            currentCheckHasCommand = false;
        }
        currentCheckHasId = currentCheckHasId || fieldHasValue(line, "id");
        currentCheckHasCommand = currentCheckHasCommand || fieldHasValue(line, "command");
    }

    return checkComplete();
}

export function getDirectPlanReviewEligibility(
    plan: { attrs: PlanFrontMatter; markdown?: string; body?: string },
): DirectPlanReviewEligibility {
    if (!DIRECT_REVIEW_STATUSES.has(plan.attrs.status || "")) {
        return { eligible: false, reason: "unsupported_status" };
    }
    if (isEpicPlan(plan.attrs)) return { eligible: true };

    if (!hasValidObjectiveFailingCheck(plan)) {
        return { eligible: false, reason: "missing_objective_failing_check" };
    }

    const policy = resolvePlanExecutionPolicy(plan.attrs);
    if (!policy.ok) {
        return { eligible: false, reason: "invalid_execution_policy", message: policy.error };
    }

    return { eligible: true };
}

export async function reviewLoadedPlanDirectly({
    projectRoot,
    plan,
    agentName,
    uiAPI,
    executePlan,
    continueWorkflowValidation,
    runPlanningAgent,
    runSlicerAgent,
    session,
}: DirectReviewOptions): Promise<DirectPlanReviewResult> {
    assertRecoveryWorktreeIsManaged(
        plan.planName,
        await resolveRecoveryWorktree(projectRoot, plan),
    );

    await session.switchAgent(agentName);

    const recoverableReview = await requestRecoverablePlanReview({
        requestReview: () =>
            session.reviewPlan({
                planName: plan.planName,
                planPath: plan.path,
                triageMeta: plan.attrs,
            }),
        requestRetry: async ({ response }) => {
            if (response?.cancellationReason === "runtime_cancel") {
                return { outcome: RuntimeInteractionOutcomes.CANCELED, value: false };
            }
            const value = await uiAPI.promptSelect("Review the Plan again?", [
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
            ]);
            return value === "yes"
                ? { outcome: RuntimeInteractionOutcomes.ACCEPTED, value: true }
                : { outcome: RuntimeInteractionOutcomes.CANCELED, value: false };
        },
        onUnanswered: ({ reason }) => {
            uiAPI.appendSystemMessage(
                `Plan review ended without an answer (${reason}).`,
                false,
                "RunWield",
            );
        },
    });

    if (recoverableReview.kind === "complete") {
        uiAPI.appendSystemMessage(SESSION_COMPLETE_GUIDANCE, false, "RunWield");
        return { keepPlanAgentActive: true };
    }

    const reviewResult = recoverableReview.response;

    if (reviewResult.remoteReview) {
        uiAPI.appendSystemMessage(
            reviewResult.message || `Plan saved for remote review: ${plan.planName}`,
            false,
            "RunWield",
        );
        return { keepPlanAgentActive: true };
    }

    if (!isPlanReviewableWithoutReopen(plan.attrs.status)) {
        await session.clearActiveExecutionWorkflow();
    }

    if (reviewResult.approved) {
        let reloadedAfterReview = false;
        try {
            const { plan: latestPlan } = await resolveWorkflowPlanLocation(projectRoot, plan.planName);
            if (latestPlan) {
                plan.attrs = reviewResult.planAttrs
                    ? { ...latestPlan.attrs, ...reviewResult.planAttrs }
                    : latestPlan.attrs;
                plan.body = latestPlan.body;
                plan.markdown = latestPlan.markdown || latestPlan.body || plan.markdown;
                plan.path = latestPlan.path;
                reloadedAfterReview = true;
            }
        } catch {
            // Keep the in-memory Plan if a test fake does not support reloading after review.
        }
        if (!reloadedAfterReview && reviewResult.planAttrs) {
            plan.attrs = { ...plan.attrs, ...reviewResult.planAttrs };
        }
        const approvalAction = normalizePlanApprovalAction({
            classification: plan.attrs.classification,
            action: reviewResult.approvalAction,
        });
        if (isEpicPlan(plan.attrs)) {
            if (!validatePlanExecutionPolicyForReadiness(plan, uiAPI)) {
                return { keepPlanAgentActive: true };
            }
            await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "epic_readiness_passed",
                currentStatus: "approved",
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "ready_for_decomposition";
            uiAPI.appendSystemMessage(
                `PROJECT Epic ready for decomposition or child plan selection: ${plan.planName}`,
                false,
                "RunWield",
            );
            if (approvalAction === PLAN_APPROVAL_ACTIONS.DECOMPOSE) {
                await runSlicerAgent({
                    planName: plan.planName,
                    triageMeta: plan.attrs,
                    reviewFeedback: reviewResult.feedback,
                    reviewImages: reviewResult.images,
                });
            } else {
                uiAPI.appendSystemMessage(
                    appendSessionCompleteGuidance(
                        `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                    ),
                    false,
                    "RunWield",
                );
            }
            return { keepPlanAgentActive: true };
        }

        const ready = await prepareApprovedPlanForWork(
            projectRoot,
            plan,
            uiAPI,
        );
        if (!ready) {
            return { keepPlanAgentActive: true };
        }
        if (approvalAction === PLAN_APPROVAL_ACTIONS.RUN) {
            const confirmed = await confirmAffectedPathChangesBeforeExecution({
                projectRoot,
                planName: plan.planName,
                triageMeta: plan.attrs,
                uiAPI,
            });
            if (!confirmed) return { keepPlanAgentActive: false };

            const execRes = await executePlan({
                planName: plan.planName,
                triageMeta: plan.attrs,
                reviewFeedback: reviewResult.feedback,
                reviewImages: reviewResult.images,
            });
            const policy = resolvePlanExecutionPolicy(plan.attrs);
            const executionDecision = decidePostExecution(execRes, {
                planName: plan.planName,
                triageMeta: plan.attrs,
                executionAgentName: policy.ok ? policy.policy.executionAgent : AGENTS.ENGINEER,
            });
            await validatePostExecutionDecision({
                executionDecision,
                executionResult: execRes,
                fallbackPlanContent: plan.markdown || plan.body || "",
                continueWorkflowValidation,
                session,
                uiAPI,
            });
        } else {
            uiAPI.appendSystemMessage(
                appendSessionCompleteGuidance(
                    `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                ),
                false,
                "RunWield",
            );
            return { keepPlanAgentActive: true };
        }
        return { keepPlanAgentActive: false };
    }

    const outcome = await runPlanningAgent({
        agentName,
        initialRequest: buildReReviewRevisionRequest(plan.planName, reviewResult.feedback),
        triageMeta: plan.attrs,
        images: reviewResult.images,
        planName: plan.planName,
        associationPurpose: "review",
    });

    const planningDecision = decidePostPlanning(outcome, {
        planningAgentName: agentName,
        fallbackTriageMeta: plan.attrs,
    });
    await executePostPlanningDecision({
        decision: planningDecision,
        fallbackPlanContent: plan.markdown || plan.body || "",
        uiAPI,
        executePlan,
        continueWorkflowValidation,
        runSlicerAgent,
        session,
    });
    return { keepPlanAgentActive: shouldKeepPlanningAgentActive(planningDecision) };
}
