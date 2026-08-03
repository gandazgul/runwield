// @ts-nocheck: extracted from checked JSDoc workflow.js; tightening types is out of scope for this structural split.
import { AGENTS, CLI_BIN, PLANS_DIR_NAME } from "../../constants.js";
import { loadPlan, resolvePlanExecutionPolicy } from "../../plan-store.js";
import { join } from "@std/path";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import { getAgentDisplayName } from "../session/agents.js";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../session/session-runtime-interactions.js";
import { isEpicPlan, isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";
import { normalizePlanApprovalAction, PLAN_APPROVAL_ACTIONS } from "./plan-approval.js";
import {
    appendSessionCompleteGuidance,
    requestPlanReviewRetryConfirmation,
    requestRecoverablePlanReview,
    SESSION_COMPLETE_GUIDANCE,
} from "./plan-review-recovery.js";
import { recordWorkflowMetric } from "./metrics.js";
import { CollaborationStyles, selectRuntimeCollaborationStyle } from "./execution-collaboration.ts";
import { ObjectiveChecksBaselineRejectionError } from "./objective-checks-baseline.ts";
import { finalizePlanImplementation, markActiveWorktreeStatus } from "./implementation-checkpoint.ts";
import { runPlanningAgent } from "./planning-agent.ts";
import { runEngineerWithPlan } from "./engineer-runner.ts";
import { startActiveExecutionWorkflow } from "./execution-start.ts";
import { emitLaunchingExecutionAgent } from "./execution-preparation-progress.ts";

function isPlanReviewRetryAccepted(response) {
    if (!response || typeof response !== "object") return false;
    if (response.outcome === RuntimeInteractionOutcomes.ACCEPTED) return true;
    if (response.value === true) return true;
    const value = String(response.value || "").trim().toLowerCase();
    return value === "yes" || value === "review_again" || value === "review";
}

/**
 * @typedef {Object} PlanExecutionResult
 * @property {boolean} repairRequired
 * @property {boolean} executionComplete
 * @property {boolean} [paused]
 * @property {boolean} [canceled]
 * @property {boolean} [intentionalComplete]
 * @property {string} [intentionalCompleteReason]
 * @property {string} [message]
 * @property {string} [feedback]
 * @property {boolean} [baselineRejected]
 * @property {"already_met"|"broken"} [baselineRejectionKind]
 * @property {string[]} [baselineRejectedCheckIds]
 * @property {"stop"|"canceled"} [pauseReason]
 * @property {string} [error]
 * @property {string} [completionReport]
 * @property {import('../session/hosted-session.js').ActiveExecutionWorkflow} [executionContext]
 */

export async function executePlan({
    planName,
    triageMeta: _triageMeta,
    sessionManager,
    hostedSession,
    routerMessage,
    reviewFeedback,
    reviewImages,
    ports = {},
}) {
    const loadPlanFn = ports.loadPlan || loadPlan;
    if (!hostedSession) throw new Error("executePlan: hostedSession is required");
    const projectRoot = hostedSession.cwd;
    const executeSingleEngineerPlanFn = ports.executeSingleEngineerPlan || executeSingleEngineerPlan;
    const markActiveWorktreeStatusFn = ports.markActiveWorktreeStatus || markActiveWorktreeStatus;
    const recordWorkflowMetricFn = ports.recordWorkflowMetric || recordWorkflowMetric;
    let effectiveReviewFeedback = reviewFeedback;
    let effectiveReviewImages = reviewImages;

    async function tryLoadPlanForExecution() {
        try {
            return { plan: await loadPlanFn(projectRoot, planName), error: null };
        } catch (error) {
            return { plan: null, error };
        }
    }

    const initialLoad = await tryLoadPlanForExecution();
    let plan = initialLoad.plan;
    if (!plan) {
        emitSystemStatus(hostedSession, `ERROR: Could not load plan ${planName}`, {
            level: "error",
            header: "RunWield",
        });
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: initialLoad.error ? "plan_load_failed" : "plan_not_found" },
        }, { cwd: projectRoot });

        const requestPlanReview = ports.requestPlanReview || requestHostedSessionInteraction;
        const planPath = join(projectRoot, PLANS_DIR_NAME, `${planName}.md`);
        let recoveryAttempt = 0;
        let recoveryReason = initialLoad.error ? "plan_load_failed" : "plan_not_found";
        let recoveryResponse = { outcome: RuntimeInteractionOutcomes.UNSUPPORTED, message: recoveryReason };
        while (!plan) {
            recoveryAttempt += 1;
            const retryResponse = await requestPlanReviewRetryConfirmation(hostedSession, requestPlanReview, {
                attempt: recoveryAttempt,
                reason: recoveryReason,
                response: recoveryResponse,
            }).catch(() => ({ outcome: RuntimeInteractionOutcomes.CANCELED, value: false }));
            if (!isPlanReviewRetryAccepted(retryResponse)) {
                emitSystemStatus(hostedSession, SESSION_COMPLETE_GUIDANCE, { header: "RunWield" });
                return {
                    repairRequired: false,
                    executionComplete: false,
                    intentionalComplete: true,
                    intentionalCompleteReason: recoveryReason,
                    message: SESSION_COMPLETE_GUIDANCE,
                };
            }

            const recoverableReview = await requestRecoverablePlanReview({
                requestReview: () =>
                    requestPlanReview(hostedSession, {
                        type: RuntimeInteractionTypes.PLAN_REVIEW,
                        prompt: `Review plan "${planName}"`,
                        _meta: { cwd: projectRoot, planName, planPath, triageMeta: _triageMeta || {} },
                    }),
                requestRetry: (details) =>
                    requestPlanReviewRetryConfirmation(hostedSession, requestPlanReview, details),
                onUnanswered: ({ reason }) => {
                    emitSystemStatus(
                        hostedSession,
                        `Plan review ended without an answer (${reason}).`,
                        { header: "RunWield" },
                    );
                },
            });
            if (recoverableReview.kind === "complete") {
                emitSystemStatus(hostedSession, SESSION_COMPLETE_GUIDANCE, { header: "RunWield" });
                return {
                    repairRequired: false,
                    executionComplete: false,
                    intentionalComplete: true,
                    intentionalCompleteReason: recoverableReview.reason,
                    message: SESSION_COMPLETE_GUIDANCE,
                };
            }

            const reviewResponse = recoverableReview.response || {};
            const reviewMeta = /** @type {any} */ (reviewResponse._meta || reviewResponse || {});
            if (reviewMeta.remoteReview === true) {
                const message = reviewResponse.message || `Plan "${planName}" saved for remote review.`;
                emitSystemStatus(hostedSession, message, { header: "RunWield" });
                return {
                    repairRequired: false,
                    executionComplete: false,
                    intentionalComplete: true,
                    intentionalCompleteReason: "remote_review",
                    message,
                };
            }
            if (!reviewMeta.approved) {
                const planningAgentName = _triageMeta?.classification === "PROJECT" ? AGENTS.ARCHITECT : AGENTS.PLANNER;
                const revisionOutcome = await runPlanningAgent({
                    agentName: planningAgentName,
                    initialRequest: [
                        `## Plan Review Re-opened: ${planName}`,
                        "",
                        `plans/${planName}.md could not be loaded for execution. The user provided this feedback while`,
                        "recovering it:",
                        "",
                        reviewMeta.feedback || "(no specific feedback provided)",
                    ].join("\n"),
                    triageMeta: _triageMeta,
                    images: Array.isArray(reviewMeta.images) ? reviewMeta.images : undefined,
                    sessionManager,
                    hostedSession,
                    ports: { runActiveAgentTurn: ports.runActiveAgentTurn },
                });
                if (revisionOutcome.outcome === "approved_execute") {
                    return await executePlan({
                        planName: revisionOutcome.planName || planName,
                        triageMeta: revisionOutcome.triageMeta || _triageMeta,
                        sessionManager,
                        hostedSession,
                        routerMessage,
                        reviewFeedback: revisionOutcome.feedback,
                        reviewImages: revisionOutcome.images,
                        ports,
                    });
                }
                return {
                    repairRequired: false,
                    executionComplete: false,
                    intentionalComplete: revisionOutcome.outcome === "saved" || revisionOutcome.outcome === "canceled",
                    intentionalCompleteReason: `review_${revisionOutcome.outcome}`,
                    message: revisionOutcome.outcome === "saved" || revisionOutcome.outcome === "canceled"
                        ? SESSION_COMPLETE_GUIDANCE
                        : undefined,
                };
            }

            if (typeof reviewMeta.feedback === "string" && reviewMeta.feedback.trim()) {
                effectiveReviewFeedback = reviewMeta.feedback;
            }
            if (Array.isArray(reviewMeta.images) && reviewMeta.images.length > 0) {
                effectiveReviewImages = reviewMeta.images;
            }
            const approvedMeta = /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */ (
                reviewMeta.planAttrs || _triageMeta || {}
            );
            const approvalAction = normalizePlanApprovalAction({
                classification: approvedMeta.classification,
                action: reviewMeta.approvalAction,
            });
            const recoveredLoad = await tryLoadPlanForExecution();
            plan = recoveredLoad.plan;
            if (!plan) {
                emitSystemStatus(
                    hostedSession,
                    `Plan could not be loaded after recovered review (${
                        recoveredLoad.error ? "load_failed" : "not_found"
                    }).`,
                    { header: "RunWield" },
                );
                recoveryReason = recoveredLoad.error ? "plan_load_failed" : "plan_not_found";
                recoveryResponse = reviewResponse;
                continue;
            }

            const currentStatus = plan.attrs?.status || "approved";
            if (currentStatus !== "ready_for_work" && currentStatus !== "ready_for_decomposition") {
                const readinessEvent = approvedMeta.classification === "PROJECT"
                    ? "epic_readiness_passed"
                    : "readiness_passed";
                const readinessMeta = await recordPlanEvent({
                    cwd: projectRoot,
                    planName,
                    event: readinessEvent,
                    currentStatus,
                    details: { triageMeta: { ...plan.attrs, ...approvedMeta } },
                });
                const latestLoad = await tryLoadPlanForExecution();
                const latestPlan = latestLoad.plan;
                if (latestPlan) {
                    plan = latestPlan;
                    if (readinessMeta) {
                        plan.attrs = { ...plan.attrs, ...readinessMeta };
                    } else if (plan.attrs.status === currentStatus) {
                        plan.attrs = {
                            ...plan.attrs,
                            status: readinessEvent === "epic_readiness_passed"
                                ? "ready_for_decomposition"
                                : "ready_for_work",
                        };
                    }
                } else if (readinessMeta) {
                    plan.attrs = { ...plan.attrs, ...readinessMeta };
                } else {
                    plan.attrs = {
                        ...plan.attrs,
                        status: readinessEvent === "epic_readiness_passed"
                            ? "ready_for_decomposition"
                            : "ready_for_work",
                    };
                }
            }

            if (approvalAction !== PLAN_APPROVAL_ACTIONS.RUN) {
                emitSystemStatus(
                    hostedSession,
                    appendSessionCompleteGuidance(`Plan saved. Resume later with: ${CLI_BIN} load-plan ${planName}`),
                    { header: "RunWield" },
                );
                return {
                    repairRequired: false,
                    executionComplete: false,
                    intentionalComplete: true,
                    intentionalCompleteReason: "saved_for_later",
                    message: SESSION_COMPLETE_GUIDANCE,
                };
            }
        }
    }

    const effectiveMeta = { ...plan.attrs };
    const policy = resolvePlanExecutionPolicy(effectiveMeta);
    if (!policy.ok && policy.reason !== "project_epic") {
        emitSystemStatus(hostedSession, `ERROR: ${policy.error}`, { level: "error", header: "RunWield" });
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: policy.reason },
        }, { cwd: projectRoot });
        return { repairRequired: false, executionComplete: false, error: policy.error };
    }
    if (policy.ok) {
        effectiveMeta.executionAgent = policy.policy.executionAgent;
        effectiveMeta.collaborationRecommendation = policy.policy.collaborationRecommendation;
    }

    if (isEpicPlan(plan.attrs)) {
        const error = `Plan ${planName} is a PROJECT Epic container and cannot be executed directly.`;
        emitSystemStatus(hostedSession, `ERROR: ${error}`, { level: "error", header: "RunWield" });
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: "epic_container", classification: effectiveMeta.classification },
        }, { cwd: projectRoot });
        return { repairRequired: false, executionComplete: false, error };
    }

    if (!isExecutablePlanStatus(plan.attrs.status)) {
        const error = `Plan ${planName} is not ready for work (status: ${plan.attrs.status}).`;
        emitSystemStatus(hostedSession, `ERROR: ${error}`, { level: "error", header: "RunWield" });
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: "not_ready_for_work", status: plan.attrs.status },
        }, { cwd: projectRoot });
        return { repairRequired: false, executionComplete: false, error };
    }

    const collaboration = policy.ok ? selectRuntimeCollaborationStyle(hostedSession, policy.policy) : {
        style: CollaborationStyles.AUTONOMOUS,
        recommendation: CollaborationStyles.AUTONOMOUS,
        pairCapable: false,
        resolutionReason: "legacy_autonomous",
    };
    if (policy.ok && policy.policy.executionAgent === AGENTS.FRONTEND_ENGINEER) {
        await recordWorkflowMetricFn({
            category: "execution",
            event: "frontend_runtime_style_resolved",
            details: {
                policySource: policy.policy.source,
                recommendation: collaboration.recommendation,
                runtimeStyle: collaboration.style,
                pairCapable: collaboration.pairCapable,
                resolutionReason: collaboration.resolutionReason,
            },
        }, { cwd: projectRoot });
    }

    await recordWorkflowMetricFn({
        category: "execution",
        event: "plan_execution_started",
        planName,
        details: { classification: effectiveMeta.classification, status: effectiveMeta.status },
    }, { cwd: projectRoot });

    emitSystemStatus(hostedSession, `=== Executing Plan: ${planName} ===`, { header: "RunWield" });

    // PROJECT Epics are containers handled above; executable child planned-change plans use the normal single-plan execution path.
    const result = await executeSingleEngineerPlanFn({
        planName,
        planBody: plan.body,
        triageMeta: effectiveMeta,
        sessionManager,
        currentStatus: plan.attrs.status,
        hostedSession,
        routerMessage,
        reviewFeedback: effectiveReviewFeedback,
        reviewImages: effectiveReviewImages,
        collaborationStyle: collaboration.style,
        collaborationRecommendation: collaboration.recommendation,
        ports: { ...ports, recordWorkflowMetric: recordWorkflowMetricFn },
    });
    if (!result.executionComplete) {
        if (result.baselineRejected) {
            const feedback = result.feedback || result.error || "Objective-Failing Check baseline rejected execution.";
            await recordPlanEvent({
                cwd: projectRoot,
                planName,
                event: "review_reopened",
                currentStatus: plan.attrs.status,
                details: /** @type {any} */ ({
                    triageMeta: effectiveMeta,
                    reason: "objective_checks_baseline_rejected",
                    feedback,
                }),
            });
            await recordWorkflowMetricFn({
                category: "execution",
                event: "plan_execution_rejected",
                planName,
                details: {
                    reason: "objective_checks_baseline_rejected",
                    kind: result.baselineRejectionKind,
                    checkIds: result.baselineRejectedCheckIds,
                },
            }, { cwd: projectRoot });
            const planningAgentName = effectiveMeta.classification === "PROJECT" ? AGENTS.ARCHITECT : AGENTS.PLANNER;
            const revisionOutcome = await runPlanningAgent({
                agentName: planningAgentName,
                initialRequest: [
                    `## Plan Objective-Failing Check Baseline Rejected: ${planName}`,
                    "",
                    feedback,
                    "",
                    "Revise the Plan's Objective-Failing Checks so every check fails against the unmodified execution tree before implementation starts.",
                ].join("\n"),
                triageMeta: effectiveMeta,
                sessionManager,
                hostedSession,
                ports: { runActiveAgentTurn: ports.runActiveAgentTurn },
            });
            if (revisionOutcome.outcome === "approved_execute") {
                return await executePlan({
                    planName: revisionOutcome.planName || planName,
                    triageMeta: revisionOutcome.triageMeta || effectiveMeta,
                    sessionManager,
                    hostedSession,
                    routerMessage,
                    reviewFeedback: revisionOutcome.feedback,
                    reviewImages: revisionOutcome.images,
                    ports,
                });
            }
            return {
                repairRequired: false,
                executionComplete: false,
                intentionalComplete: revisionOutcome.outcome === "saved" || revisionOutcome.outcome === "canceled",
                intentionalCompleteReason: `baseline_${revisionOutcome.outcome}`,
                message: revisionOutcome.outcome === "saved" || revisionOutcome.outcome === "canceled"
                    ? SESSION_COMPLETE_GUIDANCE
                    : undefined,
                feedback,
            };
        }
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_result",
            planName,
            details: {
                executionComplete: false,
                repairRequired: result.repairRequired,
                hasError: Boolean(result.error),
            },
        }, { cwd: projectRoot });
        return result;
    }

    const executionContext = result.executionContext || hostedSession?.getActiveExecutionWorkflow?.();
    try {
        await finalizePlanImplementation({
            projectRoot,
            planName,
            triageMeta: effectiveMeta,
            executionContext,
            executionReport: result.completionReport,
            hostedSession,
            ports: {
                recordPlanEvent,
                markActiveWorktreeStatus: markActiveWorktreeStatusFn,
                recordWorkflowMetric: recordWorkflowMetricFn,
            },
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        try {
            await recordWorkflowMetricFn({
                category: "execution",
                event: "implementation_checkpoint_failed",
                planName,
                details: {
                    executionMode: executionContext?.executionMode,
                    hasExecutionContext: Boolean(executionContext),
                },
            }, { cwd: projectRoot });
        } catch {
            // The checkpoint failure remains the authoritative error.
        }
        emitSystemStatus(
            hostedSession,
            `Implementation remains recoverable but was not marked complete because its worktree checkpoint failed: ${reason}`,
            { level: "error", header: "RunWield" },
        );
        return {
            repairRequired: true,
            executionComplete: false,
            error: reason,
            ...(executionContext ? { executionContext } : {}),
            ...(result.completionReport ? { completionReport: result.completionReport } : {}),
        };
    }
    await recordWorkflowMetricFn({
        category: "execution",
        event: "plan_execution_result",
        planName,
        details: { executionComplete: true, repairRequired: false },
    }, { cwd: projectRoot });

    emitSystemStatus(
        hostedSession,
        `✅ Plan implementation complete and checkpointed: ${planName}`,
        { header: "RunWield" },
    );
    return {
        repairRequired: false,
        executionComplete: true,
        ...(executionContext ? { executionContext } : {}),
        ...(result.completionReport ? { completionReport: result.completionReport } : {}),
    };
}

/**
 * @param {{
 *     planName: string,
 *     planBody: string,
 *     triageMeta: Partial<import('../../plan-store.js').PlanFrontMatter>,
 *     sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager,
 *     currentStatus: import('./plan-lifecycle.js').PlanStatus,
 *     hostedSession?: import('../session/hosted-session.js').HostedSession,
 *     routerMessage?: string,
 *     reviewFeedback?: string,
 *     reviewImages?: Array<{base64: string, mimeType: string}>,
 *     collaborationStyle?: "autonomous"|"pair",
 *     collaborationRecommendation?: "autonomous"|"pair",
 *     ports?: {
 *       recordWorkflowMetric?: typeof recordWorkflowMetric,
 *       runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn,
 *     },
 * }} opts
 * @returns {Promise<PlanExecutionResult>}
 */
export async function executeSingleEngineerPlan(
    {
        planName,
        planBody,
        triageMeta,
        sessionManager,
        currentStatus,
        hostedSession,
        routerMessage,
        reviewFeedback,
        reviewImages,
        collaborationStyle = CollaborationStyles.AUTONOMOUS,
        collaborationRecommendation = CollaborationStyles.AUTONOMOUS,
        ports,
    },
) {
    let executionContext;
    try {
        executionContext = await startActiveExecutionWorkflow({
            planName,
            triageMeta,
            currentStatus,
            hostedSession,
            collaborationStyle,
            collaborationRecommendation,
            ports,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof ObjectiveChecksBaselineRejectionError) {
            emitSystemStatus(hostedSession, `Execution did not start: ${message}`, {
                level: "error",
                header: "RunWield",
            });
            return {
                repairRequired: false,
                executionComplete: false,
                baselineRejected: true,
                baselineRejectionKind: error.kind,
                baselineRejectedCheckIds: error.checkIds,
                feedback: error.feedback,
                error: message,
            };
        }
        const failedWorkflow = hostedSession?.getActiveExecutionWorkflow?.();
        if (failedWorkflow?.planName === planName && failedWorkflow.collaborationStyle === CollaborationStyles.PAIR) {
            hostedSession?.setActiveExecutionWorkflow({
                ...failedWorkflow,
                collaborationStyle: CollaborationStyles.AUTONOMOUS,
            });
        }
        emitSystemStatus(hostedSession, `Execution did not start: ${message}`, {
            level: "error",
            header: "RunWield",
        });
        return { repairRequired: false, executionComplete: false, error: message };
    }
    emitLaunchingExecutionAgent(
        hostedSession,
        getAgentDisplayName(executionContext.executionAgent, executionContext.projectRoot || hostedSession?.cwd),
    );
    const engineerResult = await runEngineerWithPlan(
        planName,
        planBody,
        sessionManager,
        executionContext.executionCwd,
        hostedSession,
        executionContext.projectRoot,
        routerMessage,
        reviewFeedback,
        reviewImages,
        executionContext.executionAgent,
        ports,
    );
    if (!engineerResult.completed) {
        return {
            repairRequired: false,
            executionComplete: false,
            ...(executionContext ? { executionContext } : {}),
            ...(engineerResult.paused ? { paused: true, pauseReason: engineerResult.pauseReason } : {}),
            ...(engineerResult.error ? { error: engineerResult.error } : {}),
        };
    }
    return {
        repairRequired: false,
        executionComplete: true,
        ...(executionContext ? { executionContext } : {}),
        ...(engineerResult.completionReport ? { completionReport: engineerResult.completionReport } : {}),
    };
}
