/**
 * @module shared/workflow
 * Plan-execution facade used by the plan_written tool, resume command, and
 * router triage flow.
 */

import { AGENTS, CLI_BIN, PLANS_DIR_NAME } from "../../constants.js";
import { loadPlan, resolvePlanExecutionPolicy } from "../../plan-store.js";
import { join } from "@std/path";
import { hasNonGitExecutionConsent, probeGitRepository, rememberNonGitExecutionConsent } from "../git.js";
import { getAgentDisplayName } from "../session/agents.js";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
    supportsHostedSessionInteraction,
} from "../session/session-runtime-interactions.js";
import {
    checkpointExecutionWorktree,
    createExecutionWorktree,
    findReusableWorktree,
    prepareTargetBranchRef,
    removeExecutionWorktree,
    resolveCurrentCheckoutBranch,
    resolveTargetBranchName,
} from "../worktree.js";
import {
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { ensureExecutionPlanFile, loadCanonicalExecutionPlanSource } from "./execution-plan-file.js";
import { isEpicPlan, isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";
import { normalizePlanApprovalAction, PLAN_APPROVAL_ACTIONS } from "./plan-approval.js";
import {
    appendSessionCompleteGuidance,
    requestPlanReviewRetryConfirmation,
    requestRecoverablePlanReview,
    SESSION_COMPLETE_GUIDANCE,
} from "./plan-review-recovery.js";
import { createPairCheckpointTool } from "../../tools/pair-checkpoint.js";
import { recordWorkflowMetric } from "./metrics.js";
import { buildEngineerRequest } from "./workflow-prompts.js";
import {
    readLatestPlanOutcome,
    readLatestTaskCompletedMessage,
    readLatestTaskCompletedOutcome,
} from "./workflow-results.js";

// Slicer-facing helpers are re-exported from the workflow facade for callers that should not import submodules.
export {
    beginSlicerContextPhase,
    createSlicerFinalizeTool,
    materializeSlicerDraft,
    openSlicerDecomposition,
    runSlicerAgent,
} from "./workflow-slicer.js";
export { buildEngineerRequest, buildSlicerRequest } from "./workflow-prompts.js";
export {
    extractAssistantOutput,
    readLatestPlanOutcome,
    readLatestReviewOutcome,
    readLatestTaskCompletedOutcome,
} from "./workflow-results.js";

/**
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} meta
 * @returns {"engineer"|"frontend-engineer"}
 */
export function resolveExecutionOwner(meta) {
    const policy = resolvePlanExecutionPolicy(meta);
    if (policy.ok) return policy.policy.executionAgent;
    if (policy.reason === "project_epic") return /** @type {"engineer"} */ (AGENTS.ENGINEER);
    throw new Error(policy.error);
}

export const CollaborationStyles = Object.freeze({
    AUTONOMOUS: "autonomous",
    PAIR: "pair",
});

export const PairCheckpointDecisions = Object.freeze({
    CONTINUE: "continue",
    REVISE: "revise",
    SWITCH_TO_AUTONOMOUS: "switch_to_autonomous",
    STOP: "stop",
});

export const PairPauseReasons = Object.freeze({
    STOP: "stop",
    CANCELED: "canceled",
});

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @returns {boolean}
 */
export function supportsPairExecution(hostedSession) {
    return supportsHostedSessionInteraction(hostedSession, RuntimeInteractionTypes.PAIR_CHECKPOINT);
}

/**
 * @typedef {Object} RuntimeCollaborationSelection
 * @property {"autonomous"|"pair"} style
 * @property {"autonomous"|"pair"} recommendation
 * @property {boolean} pairCapable
 * @property {"canonical_pair_capable"|"canonical_pair_unavailable"|"canonical_autonomous"|"legacy_autonomous"} resolutionReason
 */

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {{ executionAgent: "engineer"|"frontend-engineer", collaborationRecommendation: "autonomous"|"pair", source: "canonical"|"legacy_frontend"|"legacy_frontend_false"|"absent" }} policy
 * @returns {RuntimeCollaborationSelection}
 */
function selectRuntimeCollaborationStyle(hostedSession, policy) {
    const recommendation = policy.collaborationRecommendation || CollaborationStyles.AUTONOMOUS;
    const pairCapable = supportsPairExecution(hostedSession);
    if (policy.executionAgent !== AGENTS.FRONTEND_ENGINEER || policy.source !== "canonical") {
        return {
            style: CollaborationStyles.AUTONOMOUS,
            recommendation,
            pairCapable,
            resolutionReason: "legacy_autonomous",
        };
    }
    if (recommendation !== CollaborationStyles.PAIR) {
        return {
            style: CollaborationStyles.AUTONOMOUS,
            recommendation,
            pairCapable,
            resolutionReason: "canonical_autonomous",
        };
    }
    if (!pairCapable) {
        emitSystemStatus(
            hostedSession,
            "Pair Execution is recommended by the Plan but unavailable in this host; continuing with autonomous Frontend Engineer execution.",
            { header: "RunWield" },
        );
        return {
            style: CollaborationStyles.AUTONOMOUS,
            recommendation,
            pairCapable,
            resolutionReason: "canonical_pair_unavailable",
        };
    }
    return { style: CollaborationStyles.PAIR, recommendation, pairCapable, resolutionReason: "canonical_pair_capable" };
}

/** @param {any} response */
function isPlanReviewRetryAccepted(response) {
    if (!response || typeof response !== "object") return false;
    if (response.outcome === RuntimeInteractionOutcomes.ACCEPTED) return true;
    if (response.value === true) return true;
    const value = String(response.value || "").trim().toLowerCase();
    return value === "yes" || value === "review_again" || value === "review";
}

/**
 * @typedef {"approved_execute" | "approved_decompose" | "saved" | "feedback" | "canceled" | "repair_required" | "no_call"} PlanOutcome
 */

/**
 * @typedef {Object} PlanOutcomeResult
 * @property {PlanOutcome} outcome
 * @property {string} [planName]
 * @property {import('../../tools/plan-written.js').TriageMeta} [triageMeta]
 * @property {string} [feedback]
 * @property {Array<{base64: string, mimeType: string}>} [images]
 */

/**
 * @typedef {Object} PlanExecutionResult
 * @property {boolean} repairRequired
 * @property {boolean} executionComplete
 * @property {boolean} [paused]
 * @property {boolean} [canceled]
 * @property {boolean} [intentionalComplete]
 * @property {string} [intentionalCompleteReason]
 * @property {string} [message]
 * @property {"stop"|"canceled"} [pauseReason]
 * @property {string} [error]
 * @property {string} [completionReport]
 * @property {import('../session/hosted-session.js').ActiveExecutionWorkflow} [executionContext]
 */

/**
 * @typedef {Object} FinalizePlanImplementationOptions
 * @property {string} projectRoot
 * @property {string} planName
 * @property {Partial<import('../../plan-store.js').PlanFrontMatter>} [triageMeta]
 * @property {import('../session/hosted-session.js').ActiveExecutionWorkflow | null | undefined} executionContext
 * @property {string} [executionReport]
 * @property {import('../session/hosted-session.js').HostedSession} [hostedSession]
 * @property {{
 *   checkpointExecutionWorktree?: typeof checkpointExecutionWorktree,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [__deps]
 */

/**
 * Commit all execution-worktree changes before Plan or registry state can say
 * implementation is complete. The returned context is authoritative; this
 * boundary must not depend on volatile Hosted Session state being retained.
 *
 * @param {FinalizePlanImplementationOptions} options
 * @returns {Promise<{ implementationCommit?: string }>}
 */
export async function finalizePlanImplementation({
    projectRoot,
    planName,
    triageMeta = {},
    executionContext,
    executionReport,
    hostedSession,
    __deps = {},
}) {
    if (!executionContext) {
        throw new Error(`Cannot complete ${planName}: durable execution context is missing.`);
    }

    const checkpointExecutionWorktreeFn = __deps.checkpointExecutionWorktree || checkpointExecutionWorktree;
    const recordPlanEventImpl = __deps.recordPlanEvent || recordPlanEvent;
    const markActiveWorktreeStatusImpl = __deps.markActiveWorktreeStatus || markActiveWorktreeStatus;
    const recordWorkflowMetricImpl = __deps.recordWorkflowMetric || recordWorkflowMetric;
    /** @type {string | undefined} */
    let implementationCommit;

    if (executionContext.executionMode === "worktree") {
        if (!executionContext.executionCwd || !executionContext.worktreeBranch) {
            throw new Error(
                `Cannot complete ${planName}: worktree execution context is missing its path or branch.`,
            );
        }
        const checkpoint = await checkpointExecutionWorktreeFn({
            worktreePath: executionContext.executionCwd,
            branch: executionContext.worktreeBranch,
            planName,
            planDescription: typeof triageMeta.summary === "string" ? triageMeta.summary : undefined,
        });
        implementationCommit = checkpoint.executionCommit;
    } else if (
        executionContext.executionMode !== "non_git_in_place" &&
        executionContext.nonGitInPlace !== true
    ) {
        throw new Error(`Cannot complete ${planName}: execution mode is missing or unknown.`);
    }

    await recordPlanEventImpl({
        cwd: projectRoot,
        planName,
        event: "implementation_finished",
        currentStatus: "in_progress",
        details: {
            triageMeta,
            nonGitInPlace: executionContext.nonGitInPlace === true,
            executionMode: executionContext.executionMode,
            executionBaselineTree: executionContext.baselineTree,
            worktreeId: executionContext.worktreeId,
            worktreePath: executionContext.executionCwd,
            worktreeBranch: executionContext.worktreeBranch,
            worktreeBaseBranch: executionContext.worktreeBaseBranch,
            executionReport,
        },
    });
    await markActiveWorktreeStatusImpl("completed", { hostedSession, workflow: executionContext });
    await recordWorkflowMetricImpl({
        category: "execution",
        event: "implementation_finished",
        planName,
        details: {
            classification: triageMeta.classification,
            executionMode: executionContext.executionMode,
            checkpointCommitted: Boolean(implementationCommit),
        },
    }, { cwd: projectRoot });
    return implementationCommit ? { implementationCommit } : {};
}

/**
 * Run a planning agent once and return the lifecycle outcome captured by
 * plan_written. Does not execute the plan.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string} opts.initialRequest
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {import('../session/hosted-session.js').HostedSession} [opts.hostedSession]
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {{ runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn }} [opts.__deps]
 * @returns {Promise<PlanOutcomeResult>}
 */
export async function runPlanningAgent(
    { agentName, initialRequest, triageMeta: _triageMeta, sessionManager, hostedSession, images, __deps },
) {
    const runActiveAgentTurn = __deps?.runActiveAgentTurn ||
        (await import("../session/agent-switching.js")).runActiveAgentTurn;
    if (!hostedSession) throw new Error("runPlanningAgent: hostedSession is required");

    const messages = await runActiveAgentTurn({
        hostedSession,
        agentName,
        userRequest: initialRequest,
        images,
        sessionManager,
        allowReturnToRouter: false,
    });

    const result = readLatestPlanOutcome(messages);
    return result || { outcome: "no_call" };
}

/**
 * Execute an approved plan.
 *
 * @param {{
 *   planName: string,
 *   triageMeta: Partial<import('../../plan-store.js').PlanFrontMatter>,
 *   sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager,
 *   hostedSession: import('../session/hosted-session.js').HostedSession,
 *   reviewFeedback?: string,
 *   reviewImages?: Array<{base64: string, mimeType: string}>,
 *   __deps?: {
 *   loadPlan?: typeof loadPlan,
 *   executeSingleEngineerPlan?: typeof executeSingleEngineerPlan,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
 *   checkpointExecutionWorktree?: typeof checkpointExecutionWorktree,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   requestPlanReview?: typeof requestHostedSessionInteraction,
 *   runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn,
 *   probeGitRepository?: typeof probeGitRepository,
 *   hasNonGitExecutionConsent?: typeof hasNonGitExecutionConsent,
 *   confirmNonGitFeaturePlanExecution?: typeof confirmNonGitFeaturePlanExecution,
 *   now?: () => number,
 *   }
 * }} options
 * @returns {Promise<PlanExecutionResult>}
 */
export async function executePlan({
    planName,
    triageMeta: _triageMeta,
    sessionManager,
    hostedSession,
    reviewFeedback,
    reviewImages,
    __deps = {},
}) {
    const loadPlanFn = __deps.loadPlan || loadPlan;
    if (!hostedSession) throw new Error("executePlan: hostedSession is required");
    const projectRoot = hostedSession.cwd;
    const executeSingleEngineerPlanFn = __deps.executeSingleEngineerPlan || executeSingleEngineerPlan;
    const recordPlanEventFn = __deps.recordPlanEvent || recordPlanEvent;
    const markActiveWorktreeStatusFn = __deps.markActiveWorktreeStatus || markActiveWorktreeStatus;
    const recordWorkflowMetricFn = __deps.recordWorkflowMetric || recordWorkflowMetric;
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

        const requestPlanReview = __deps.requestPlanReview || requestHostedSessionInteraction;
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
                        "The user provided feedback while recovering a Plan that could not be loaded for execution:",
                        "",
                        reviewMeta.feedback || "(no specific feedback provided)",
                        "",
                        `Revise plans/${planName}.md based on this feedback, then call plan_written again.`,
                    ].join("\n"),
                    triageMeta: _triageMeta,
                    images: Array.isArray(reviewMeta.images) ? reviewMeta.images : undefined,
                    sessionManager,
                    hostedSession,
                    __deps: { runActiveAgentTurn: __deps.runActiveAgentTurn },
                });
                if (revisionOutcome.outcome === "approved_execute") {
                    return await executePlan({
                        planName: revisionOutcome.planName || planName,
                        triageMeta: revisionOutcome.triageMeta || _triageMeta,
                        sessionManager,
                        hostedSession,
                        reviewFeedback: revisionOutcome.feedback,
                        reviewImages: revisionOutcome.images,
                        __deps,
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
                const readinessMeta = await recordPlanEventFn({
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
        reviewFeedback: effectiveReviewFeedback,
        reviewImages: effectiveReviewImages,
        collaborationStyle: collaboration.style,
        collaborationRecommendation: collaboration.recommendation,
        __deps: { ...__deps, recordWorkflowMetric: recordWorkflowMetricFn },
    });
    if (!result.executionComplete) {
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
            __deps: {
                checkpointExecutionWorktree: __deps.checkpointExecutionWorktree,
                recordPlanEvent: recordPlanEventFn,
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

    emitSystemStatus(
        hostedSession,
        `✅ Plan implementation complete and checkpointed: ${planName}`,
        { header: "RunWield" },
    );
    return {
        repairRequired: false,
        executionComplete: true,
        ...(executionContext ? { executionContext } : {}),
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
 *     reviewFeedback?: string,
 *     reviewImages?: Array<{base64: string, mimeType: string}>,
 *     collaborationStyle?: "autonomous"|"pair",
 *     collaborationRecommendation?: "autonomous"|"pair",
 *     __deps?: {
 *       recordWorkflowMetric?: typeof recordWorkflowMetric,
 *       runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn,
 *     },
 * }} opts
 * @returns {Promise<PlanExecutionResult>}
 */
async function executeSingleEngineerPlan(
    {
        planName,
        planBody,
        triageMeta,
        sessionManager,
        currentStatus,
        hostedSession,
        reviewFeedback,
        reviewImages,
        collaborationStyle = CollaborationStyles.AUTONOMOUS,
        collaborationRecommendation = CollaborationStyles.AUTONOMOUS,
        __deps,
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
            __deps,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
    const engineerResult = await runEngineerWithPlan(
        planName,
        planBody,
        sessionManager,
        executionContext.executionCwd,
        hostedSession,
        executionContext.projectRoot,
        reviewFeedback,
        reviewImages,
        executionContext.executionAgent,
        __deps,
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

/**
 * Run engineer against the full approved plan body.
 *
 * @param {string} planName
 * @param {string} planBody
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @param {string} [executionCwd]
 * @param {import('../session/hosted-session.js').HostedSession} [hostedSession]
 * @param {string} [projectRoot]
 * @param {string} [reviewFeedback]
 * @param {Array<{base64: string, mimeType: string}>} [reviewImages]
 * @param {string} [executionAgent]
 * @param {{
 *   runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [__deps]
 * @returns {Promise<{ completed: boolean, messages: import('@earendil-works/pi-agent-core').AgentMessage[], paused?: boolean, pauseReason?: "stop"|"canceled", error?: string, completionReport?: string }>}
 */
async function runEngineerWithPlan(
    planName,
    planBody,
    sessionManager,
    executionCwd,
    hostedSession,
    projectRoot,
    reviewFeedback,
    reviewImages,
    executionAgent = AGENTS.ENGINEER,
    __deps,
) {
    if (!hostedSession) throw new Error("runEngineerWithPlan: hostedSession is required");
    const runActiveAgentTurn = __deps?.runActiveAgentTurn ||
        (await import("../session/agent-switching.js")).runActiveAgentTurn;
    const workflow = hostedSession.getActiveExecutionWorkflow?.();
    const collaborationStyle = workflow?.collaborationStyle || CollaborationStyles.AUTONOMOUS;
    const customTools = executionAgent === AGENTS.FRONTEND_ENGINEER && collaborationStyle === CollaborationStyles.PAIR
        ? [createPairCheckpointTool({
            hostedSession,
            recordWorkflowMetric: __deps?.recordWorkflowMetric || recordWorkflowMetric,
        })]
        : undefined;
    let messages;
    try {
        messages = await runActiveAgentTurn({
            hostedSession,
            agentName: executionAgent,
            userRequest: `${
                buildEngineerRequest(planName, planBody, reviewFeedback, {
                    collaborationStyle,
                    workKind: workflow?.triageMeta?.workKind,
                })
            }\n\nExecution owner: ${executionAgent}.`,
            images: reviewImages,
            sessionManager,
            cwd: executionCwd,
            allowReturnToRouter: false,
            ...(customTools ? { customTools } : {}),
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const hostedRootSession = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
        const rootMessages = hostedRootSession?.agent?.state?.messages || [];
        emitSystemStatus(
            hostedSession,
            buildEngineerPausedMessage(errorMessage, projectRoot || hostedSession?.cwd, executionAgent),
            { level: "error", header: "RunWield" },
        );
        return { completed: false, messages: rootMessages, error: errorMessage };
    }

    const pauseReason = hostedSession.getActiveExecutionWorkflow?.()?.pairPauseReason;
    const completed = !pauseReason && readLatestTaskCompletedOutcome(messages);
    const completionReport = completed ? readLatestTaskCompletedMessage(messages) || undefined : undefined;
    if (!completed) {
        emitSystemStatus(
            hostedSession,
            pauseReason
                ? buildPairPausedMessage(pauseReason, projectRoot || hostedSession?.cwd)
                : buildEngineerPausedMessage(undefined, projectRoot || hostedSession?.cwd, executionAgent),
            { header: "RunWield" },
        );
    }

    return {
        completed,
        messages,
        ...(pauseReason ? { paused: true, pauseReason } : {}),
        ...(completionReport ? { completionReport } : {}),
    };
}

/**
 * @param {string} [reason]
 * @param {string} [projectRoot]
 */
function buildEngineerPausedMessage(reason, projectRoot, executionAgent = AGENTS.ENGINEER) {
    const base = `${
        getAgentDisplayName(executionAgent, projectRoot)
    } stopped without task_completed; execution is paused. Say "continue" to resume with the execution owner.`;
    return reason ? `${base}\nReason: ${reason}` : base;
}

/**
 * @param {"stop"|"canceled"} pauseReason
 * @param {string} [projectRoot]
 */
function buildPairPausedMessage(pauseReason, projectRoot) {
    const owner = getAgentDisplayName(AGENTS.FRONTEND_ENGINEER, projectRoot);
    return pauseReason === PairPauseReasons.STOP
        ? `${owner} stopped Pair Execution at your checkpoint direction. The Plan remains In Progress; say "continue" to resume Pair Execution.`
        : `${owner} paused because the Pair checkpoint interaction was canceled. No approval or Task Completion was recorded; say "continue" to resume.`;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function normalizeExecutionTargetBranch(value) {
    if (typeof value !== "string") return undefined;
    const target = value.trim();
    return target && target !== "HEAD" ? target : undefined;
}

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
async function confirmNonGitFeaturePlanExecution(hostedSession, projectRoot) {
    const response = await requestHostedSessionInteraction(hostedSession, {
        type: RuntimeInteractionTypes.SELECT,
        prompt:
            "Git is not available for this project. RunWield recommends using Git so Plan execution can run in an isolated Worktree with diff-based review and merge-back. Proceeding will modify the current files directly and skip Git-only isolation/recovery.",
        options: [
            { value: "proceed", label: "Proceed in current files and remember for planned Plan work" },
            { value: "cancel", label: "Cancel execution" },
        ],
    });
    if (response.outcome !== "selected" || response.value !== "proceed") return false;
    await rememberNonGitExecutionConsent("featurePlan", projectRoot);
    return true;
}

/**
 * @param {string | undefined} reusableBaseBranch
 * @param {string | undefined} targetBranch
 */
export function assertReusableWorktreeTargetMatches(reusableBaseBranch, targetBranch) {
    const reusableTarget = normalizeExecutionTargetBranch(reusableBaseBranch);
    const planTarget = normalizeExecutionTargetBranch(targetBranch);
    if (reusableTarget !== planTarget) {
        throw new Error(
            `Existing execution worktree targets ${reusableTarget || "HEAD/current checkout"}, but plan targets ${
                planTarget || "HEAD/current checkout"
            }. Aborting before Engineer starts.`,
        );
    }
}

/**
 * @param {{
 *   planName: string,
 *   triageMeta: Partial<import('../../plan-store.js').PlanFrontMatter>,
 *   currentStatus: import('./plan-lifecycle.js').PlanStatus,
 *   hostedSession?: import('../session/hosted-session.js').HostedSession,
 *   collaborationStyle?: "autonomous"|"pair",
 *   collaborationRecommendation?: "autonomous"|"pair",
 *   __deps?: {
 *     createExecutionWorktree?: typeof createExecutionWorktree,
 *     findReusableWorktree?: typeof findReusableWorktree,
 *     prepareTargetBranchRef?: typeof prepareTargetBranchRef,
 *     resolveCurrentCheckoutBranch?: typeof resolveCurrentCheckoutBranch,
 *     resolveTargetBranchName?: typeof resolveTargetBranchName,
 *     captureWorktreeTree?: typeof captureWorktreeTree,
 *     loadCanonicalExecutionPlanSource?: typeof loadCanonicalExecutionPlanSource,
 *     ensureExecutionPlanFile?: typeof ensureExecutionPlanFile,
 *     removeExecutionWorktree?: typeof removeExecutionWorktree,
 *     removeWorktreeRegistryEntry?: typeof removeWorktreeRegistryEntry,
 *     updateWorktreeRegistryEntry?: typeof updateWorktreeRegistryEntry,
 *     recordPlanEvent?: typeof recordPlanEvent,
 *     recordWorkflowMetric?: typeof recordWorkflowMetric,
 *     probeGitRepository?: typeof probeGitRepository,
 *     hasNonGitExecutionConsent?: typeof hasNonGitExecutionConsent,
 *     confirmNonGitFeaturePlanExecution?: typeof confirmNonGitFeaturePlanExecution,
 *     now?: () => number,
 *   },
 * }} opts
 * @returns {Promise<import('../session/hosted-session.js').ActiveExecutionWorkflow>}
 */
export async function startActiveExecutionWorkflow(
    {
        planName,
        triageMeta,
        currentStatus,
        hostedSession,
        collaborationStyle = CollaborationStyles.AUTONOMOUS,
        collaborationRecommendation = CollaborationStyles.AUTONOMOUS,
        __deps,
    },
) {
    if (!hostedSession) throw new Error("startActiveExecutionWorkflow: hostedSession is required");
    const projectRoot = hostedSession.cwd;
    const createWorktree = __deps?.createExecutionWorktree || createExecutionWorktree;
    const findReusable = __deps?.findReusableWorktree || findReusableWorktree;
    const prepareTarget = __deps?.prepareTargetBranchRef || prepareTargetBranchRef;
    const resolveCurrentBranch = __deps?.resolveCurrentCheckoutBranch || resolveCurrentCheckoutBranch;
    const resolveTarget = __deps?.resolveTargetBranchName || resolveTargetBranchName;
    const captureTree = __deps?.captureWorktreeTree || captureWorktreeTree;
    const loadCanonicalPlanSource = __deps?.loadCanonicalExecutionPlanSource || loadCanonicalExecutionPlanSource;
    const ensurePlanFile = __deps?.ensureExecutionPlanFile || ensureExecutionPlanFile;
    const removeWorktree = __deps?.removeExecutionWorktree || removeExecutionWorktree;
    const removeRegistryEntry = __deps?.removeWorktreeRegistryEntry || removeWorktreeRegistryEntry;
    const updateRegistry = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const recordEvent = __deps?.recordPlanEvent || recordPlanEvent;
    const recordWorkflowMetricFn = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const probeGit = __deps?.probeGitRepository || probeGitRepository;
    const hasConsent = __deps?.hasNonGitExecutionConsent || hasNonGitExecutionConsent;
    const confirmNonGit = __deps?.confirmNonGitFeaturePlanExecution || confirmNonGitFeaturePlanExecution;
    const now = __deps?.now || (() => Date.now());
    const executionAgent = resolveExecutionOwner(triageMeta);
    const collaborationState = {
        collaborationStyle,
        collaborationRecommendation,
        pairCheckpointCount: 0,
    };
    const initialWorkflow = hostedSession.getActiveExecutionWorkflow();
    if (initialWorkflow?.planName !== planName) {
        hostedSession.setActiveExecutionWorkflow({
            planName,
            triageMeta,
            executionAgent,
            executionStarted: false,
            ...collaborationState,
            projectRoot,
            executionCwd: projectRoot,
        });
    }
    const gitProbe = await probeGit(projectRoot);
    if (!gitProbe.ok) {
        if (!hasConsent("featurePlan", projectRoot) && !(await confirmNonGit(hostedSession, projectRoot))) {
            throw new Error(
                "Plan execution canceled because Git is not available and in-place execution was not approved.",
            );
        }
        const workflow = {
            planName,
            triageMeta,
            executionAgent,
            executionStarted: false,
            ...collaborationState,
            projectRoot,
            executionCwd: projectRoot,
            executionMode: /** @type {const} */ ("non_git_in_place"),
            nonGitInPlace: true,
        };
        hostedSession.setActiveExecutionWorkflow(workflow);
        await recordEvent({
            cwd: projectRoot,
            planName,
            event: "execution_started",
            currentStatus,
            details: { triageMeta, nonGitInPlace: true, executionMode: "non_git_in_place" },
        });
        const activeWorkflow = { ...workflow, executionStarted: true, executionAttemptStartedAtMs: now() };
        hostedSession.setActiveExecutionWorkflow(activeWorkflow);
        await recordWorkflowMetricFn({
            category: "execution",
            event: "non_git_in_place_execution_started",
            planName,
            details: { gitState: gitProbe.state },
        }, { cwd: projectRoot });
        return activeWorkflow;
    }
    const canonicalPlanSource = await loadCanonicalPlanSource(projectRoot, planName);
    if (canonicalPlanSource.kind !== "loaded") {
        throw new Error(
            `Cannot load canonical Project Plan ${canonicalPlanSource.relativePath}: ${
                canonicalPlanSource.reason || canonicalPlanSource.kind
            }`,
        );
    }
    const targetBranch = normalizeExecutionTargetBranch(triageMeta.worktreeBaseBranch);
    const hasRecordedWorktree = Boolean(
        triageMeta.worktreeId || triageMeta.worktreePath || triageMeta.worktreeBranch ||
            triageMeta.executionBaselineTree,
    );
    const startsFresh = triageMeta.worktreeStatus === "abandoned" && !hasRecordedWorktree;
    const existing = startsFresh ? null : hostedSession.getActiveExecutionWorkflow();
    const reusable =
        existing?.planName === planName && existing.executionCwd && existing.worktreeId && existing.worktreeBranch
            ? {
                id: existing.worktreeId,
                path: existing.executionCwd,
                branch: existing.worktreeBranch,
                baseBranch: existing.worktreeBaseBranch,
            }
            : hasRecordedWorktree
            ? await findReusable({ projectRoot, planName, worktreeId: triageMeta.worktreeId || undefined })
            : null;
    const resolvedTargetBranch = reusable
        ? targetBranch ? await resolveTarget(projectRoot, targetBranch) : await resolveCurrentBranch(projectRoot)
        : targetBranch;
    if (reusable) assertReusableWorktreeTargetMatches(reusable.baseBranch, resolvedTargetBranch);
    const reusedWorktree = Boolean(reusable);
    const worktree = reusable || await createWorktree({
        projectRoot,
        planName,
        ...(targetBranch ? await prepareTarget(projectRoot, targetBranch) : { baseRef: "HEAD" }),
    });
    const worktreeBaseBranch = worktree.baseBranch === "HEAD" ? undefined : worktree.baseBranch;
    const planFile = await ensurePlanFile({
        executionCwd: worktree.path,
        planName,
        canonicalSource: canonicalPlanSource,
    });
    if (planFile.kind !== "present" && planFile.kind !== "restored") {
        const preparationError = new Error(
            `Cannot prepare execution worktree Plan file ${planFile.relativePath}: ${planFile.reason || planFile.kind}`,
        );
        if (!reusedWorktree) {
            try {
                await removeWorktree({ projectRoot, path: worktree.path, branch: worktree.branch, force: true });
                if (worktree.id) await removeRegistryEntry(projectRoot, worktree.id);
            } catch (cleanupError) {
                let worktreeStillExists = true;
                try {
                    await Deno.lstat(worktree.path);
                } catch (pathError) {
                    if (pathError instanceof Deno.errors.NotFound) worktreeStillExists = false;
                }
                if (!worktreeStillExists && worktree.id) await removeRegistryEntry(projectRoot, worktree.id);
                const cleanupReason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                throw new Error(`${preparationError.message}; cleanup failed: ${cleanupReason}`);
            }
        }
        throw preparationError;
    }
    const baselineTree =
        existing?.planName === planName && existing.executionCwd === worktree.path && existing.baselineTree &&
            planFile.kind !== "restored"
            ? existing.baselineTree
            : await captureTree(worktree.path);
    const workflow = {
        planName,
        triageMeta,
        executionAgent,
        executionStarted: false,
        ...collaborationState,
        executionMode: /** @type {const} */ ("worktree"),
        baselineTree,
        projectRoot,
        executionCwd: worktree.path,
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
        worktreeBaseBranch,
        worktreeBaseRef: "baseRef" in worktree && typeof worktree.baseRef === "string" ? worktree.baseRef : undefined,
        worktreeBaseCommit: "baseCommit" in worktree && typeof worktree.baseCommit === "string"
            ? worktree.baseCommit
            : undefined,
    };
    hostedSession.setActiveExecutionWorkflow(workflow);
    if (worktree.id) {
        await updateRegistry(projectRoot, worktree.id, {
            status: "active",
            executionBaselineTree: baselineTree,
        });
    }
    await recordEvent({
        cwd: projectRoot,
        planName,
        event: "execution_started",
        currentStatus,
        details: {
            triageMeta,
            executionBaselineTree: baselineTree,
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch,
            worktreeStatus: "active",
        },
    });
    const activeWorkflow = { ...workflow, executionStarted: true, executionAttemptStartedAtMs: now() };
    hostedSession.setActiveExecutionWorkflow(activeWorkflow);
    await recordWorkflowMetricFn({
        category: "execution",
        event: "worktree_prepared",
        planName,
        details: {
            reusedWorktree,
            worktreeStatus: "active",
            hasBranch: Boolean(worktree.branch),
            hasBaseBranch: Boolean(worktreeBaseBranch),
            hasBaselineTree: Boolean(baselineTree),
            planFileMaterialized: planFile.kind === "restored",
        },
    }, { cwd: projectRoot });
    return activeWorkflow;
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatter['worktreeStatus']} status
 * @param {{
 *   hostedSession?: import('../session/hosted-session.js').HostedSession,
 *   workflow?: import('../session/hosted-session.js').ActiveExecutionWorkflow,
 * }} [opts]
 * @param {{
 *   hostedSession?: import('../session/hosted-session.js').HostedSession,
 *   workflow?: import('../session/hosted-session.js').ActiveExecutionWorkflow,
 * }} [opts]
 */
async function markActiveWorktreeStatus(status, opts = {}) {
    const workflow = opts.workflow || opts.hostedSession?.getActiveExecutionWorkflow();
    if (!workflow?.worktreeId || !status || status === "none") return;
    if (!workflow.projectRoot) throw new Error("markActiveWorktreeStatus: workflow projectRoot is required");
    await updateWorktreeRegistryEntry(workflow.projectRoot, workflow.worktreeId, { status });
}
