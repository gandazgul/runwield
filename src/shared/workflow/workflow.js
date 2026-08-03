/**
 * @module shared/workflow
 * Plan-execution facade used by the plan_written tool, resume command, and
 * router triage flow.
 */

import { AGENTS, CLI_BIN, PLANS_DIR_NAME } from "../../constants.js";
import {
    ensurePlanIdentity,
    getPlanFrontMatterRevisionForText,
    loadPlan,
    resolvePlanExecutionPolicy,
} from "../../plan-store.js";
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
    createWorktreeGitArtifacts,
    deleteMergedWorktreeBranch,
    findReusableWorktree,
    prepareTargetBranchRef,
    removeWorktreeGitArtifacts,
    resolveCurrentCheckoutBranch,
    resolveTargetBranchName,
    settleWorktreeAttempt,
} from "../worktree.js";
import {
    findById as findWorktreeRegistryEntryById,
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { ensureExecutionPlanFile, loadCanonicalExecutionPlanSource } from "./execution-plan-file.js";
import {
    emitCreatedExecutionWorktree,
    emitCreatingExecutionWorktree,
    emitLaunchingExecutionAgent,
    emitMaterializingPlanInExecutionWorktree,
    emitPreparingExecutionTarget,
    emitPreparingInPlaceExecution,
    emitReconciledPlanInExecutionWorktree,
    emitRestoredPlanInExecutionWorktree,
    emitReusingExecutionWorktree,
    emitRunningObjectiveChecksBaseline,
    emitUpdatingPlanStatusToInProgress,
} from "./execution-preparation-progress.ts";
import { isEpicPlan, isExecutablePlanStatus, isInValidation, recordPlanEvent } from "./plan-lifecycle.js";
import { normalizePlanApprovalAction, PLAN_APPROVAL_ACTIONS } from "./plan-approval.js";
import {
    appendSessionCompleteGuidance,
    requestPlanReviewRetryConfirmation,
    requestRecoverablePlanReview,
    SESSION_COMPLETE_GUIDANCE,
} from "./plan-review-recovery.js";
import { createPairCheckpointTool } from "../../tools/pair-checkpoint.js";
import { recordWorkflowMetric } from "./metrics.js";
import {
    classifyObjectiveChecksBaseline,
    objectiveChecksBaselineMatches,
    runObjectiveChecks,
    summarizeObjectiveChecks,
} from "./objective-checks.ts";
import {
    runExecutionPreparationTransition,
    runImplementationCheckpointTransition,
    runPlanFrontMatterTransition,
} from "./state-transition.ts";
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
    readLatestTaskCompletedReport,
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

class ObjectiveChecksBaselineRejectionError extends Error {
    /**
     * @param {{ kind: "already_met"|"broken", checkIds: string[], feedback: string }} options
     */
    constructor(options) {
        super(options.feedback);
        this.name = "ObjectiveChecksBaselineRejectionError";
        this.kind = options.kind;
        this.checkIds = options.checkIds;
        this.feedback = options.feedback;
    }
}

/**
 * @param {string} planName
 * @param {import('./objective-checks.ts').ObjectiveCheckResult[]} results
 * @param {"already_met"|"broken"} kind
 * @returns {string}
 */
function buildObjectiveChecksBaselineFeedback(planName, results, kind) {
    const ids = results.map((result) => result.id).join(", ");
    const summary = summarizeObjectiveChecks(results).block;
    const reason = kind === "already_met"
        ? `The following Objective-Failing Check(s) are already satisfied before implementation: ${ids}. An already-green check cannot discriminate whether Plan ${planName}'s objective was achieved. Revise the check(s) so they fail against the unmodified tree and pass only after the objective is implemented.`
        : `The following Objective-Failing Check(s) could not run cleanly before implementation: ${ids}. A broken check cannot prove the objective is unmet, so revise the command(s) before execution starts.`;
    return `${reason}\n\n${summary}`;
}

/**
 * @param {string} planName
 * @param {import('./objective-checks.ts').ObjectiveCheckResult[]} results
 * @param {"already_met"|"broken"} kind
 * @throws {ObjectiveChecksBaselineRejectionError}
 */
function throwObjectiveChecksBaselineRejection(planName, results, kind) {
    throw new ObjectiveChecksBaselineRejectionError({
        kind,
        checkIds: results.map((result) => result.id),
        feedback: buildObjectiveChecksBaselineFeedback(planName, results, kind),
    });
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatter} attrs
 * @param {import('./objective-checks.ts').ObjectiveCheck[]} checks
 * @param {string|undefined} head
 * @returns {import('./objective-checks.ts').ObjectiveCheckResult[]|undefined}
 */
function trustedObjectiveChecksBaselineResults(attrs, checks, head) {
    if (!objectiveChecksBaselineMatches(attrs.objectiveChecksBaseline, checks, head)) return undefined;
    return attrs.objectiveChecksBaseline?.results;
}

/**
 * @param {{ projectRoot: string, planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, revision: string|undefined, checks: import('./objective-checks.ts').ObjectiveCheck[], cwd: string, head?: string }} options
 * @returns {Promise<void>}
 */
async function ensureObjectiveChecksBaseline(options) {
    if (options.checks.length === 0) return;
    const trustedResults = trustedObjectiveChecksBaselineResults(options.attrs, options.checks, options.head);
    const results = trustedResults || await runObjectiveChecks({ checks: options.checks, cwd: options.cwd });
    const classification = classifyObjectiveChecksBaseline(results);
    if (classification.status === "already_met") {
        throwObjectiveChecksBaselineRejection(options.planName, classification.offendingResults, "already_met");
    }
    if (classification.status === "broken") {
        throwObjectiveChecksBaselineRejection(options.planName, classification.offendingResults, "broken");
    }
    if (!trustedResults) {
        const transition = await runPlanFrontMatterTransition({
            projectRoot: options.projectRoot,
            planName: options.planName,
            operation: "objective_checks_baseline_record",
            updates: {
                objectiveChecksBaseline: {
                    recordedAt: new Date().toISOString(),
                    ...(options.head ? { head: options.head } : {}),
                    results,
                },
            },
            expectedRevision: options.revision,
        });
        if (transition.status !== "committed") {
            throw new Error(
                transition.message || `Could not persist Objective-Failing Check baseline for ${options.planName}.`,
            );
        }
    }
}

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
 * @property {string} [feedback]
 * @property {boolean} [baselineRejected]
 * @property {"already_met"|"broken"} [baselineRejectionKind]
 * @property {string[]} [baselineRejectedCheckIds]
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
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   loadPlan?: typeof loadPlan,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   runImplementationCheckpointTransition?: typeof runImplementationCheckpointTransition,
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

    const loadPlanImpl = __deps.loadPlan || loadPlan;
    const markActiveWorktreeStatusImpl = __deps.markActiveWorktreeStatus || markActiveWorktreeStatus;
    const recordWorkflowMetricImpl = __deps.recordWorkflowMetric || recordWorkflowMetric;
    // The real transaction runs in tests too. This used to swap itself for a fake
    // "committed" result whenever certain dependencies happened to be injected, which
    // left the implementation checkpoint — the thing that keeps committed work and the
    // Plan's claim about it in step — with no coverage at all, and made production
    // behavior depend on which seams a caller passed.
    const runImplementationCheckpointTransitionImpl = __deps.runImplementationCheckpointTransition ||
        runImplementationCheckpointTransition;
    // Older tests and partial recovery paths may not provide a loadable primary
    // Plan; keep the legacy in_progress assumption in that case.
    const currentPlan = await (async () => {
        try {
            return await loadPlanImpl(projectRoot, planName);
        } catch {
            return null;
        }
    })();
    const primaryStatus = currentPlan?.attrs?.status;
    if (isInValidation(primaryStatus) || primaryStatus === "verified" || primaryStatus === "user_verified") {
        return {};
    }
    if (primaryStatus && primaryStatus !== "in_progress" && primaryStatus !== "ready_for_work") {
        throw new Error(
            `Cannot complete ${planName}: primary Plan status is "${primaryStatus}", expected "in_progress" or "ready_for_work".`,
        );
    }
    const transition = await runImplementationCheckpointTransitionImpl({
        projectRoot,
        planName,
        planId: typeof triageMeta.planId === "string" ? triageMeta.planId : undefined,
        worktreeId: executionContext.worktreeId,
        expectedRevision: currentPlan?.revision,
        checkpoint: async ({ markEffect }) => {
            /** @type {string | undefined} */
            let implementationCommit;
            if (executionContext.executionMode === "worktree") {
                if (!executionContext.executionCwd || !executionContext.worktreeBranch) {
                    throw new Error(
                        `Cannot complete ${planName}: worktree execution context is missing its path or branch.`,
                    );
                }
                const checkpoint = await checkpointExecutionWorktree({
                    worktreePath: executionContext.executionCwd,
                    branch: executionContext.worktreeBranch,
                    planName,
                    planDescription: typeof triageMeta.summary === "string" ? triageMeta.summary : undefined,
                });
                implementationCommit = checkpoint.executionCommit;
                await markEffect("implementation_checkpoint_settled", {
                    implementationCommit,
                    worktreeId: executionContext.worktreeId,
                    worktreeBranch: executionContext.worktreeBranch,
                });
            } else if (
                executionContext.executionMode !== "non_git_in_place" &&
                executionContext.nonGitInPlace !== true
            ) {
                throw new Error(`Cannot complete ${planName}: execution mode is missing or unknown.`);
            }
            if (primaryStatus === "ready_for_work") {
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName,
                    event: "execution_started",
                    currentStatus: "ready_for_work",
                    details: {
                        triageMeta,
                        nonGitInPlace: executionContext.nonGitInPlace === true,
                        executionMode: executionContext.executionMode,
                        executionBaselineTree: executionContext.baselineTree,
                        worktreeId: executionContext.worktreeId,
                        worktreePath: executionContext.executionCwd,
                        worktreeBranch: executionContext.worktreeBranch,
                        worktreeBaseBranch: executionContext.worktreeBaseBranch,
                        worktreeStatus: executionContext.executionMode === "worktree" ? "active" : undefined,
                    },
                });
            }
            await recordPlanEvent({
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
            return implementationCommit ? { implementationCommit } : {};
        },
    });
    if (transition.status !== "committed") {
        throw new Error(transition.message || `Implementation checkpoint did not commit for ${planName}.`);
    }
    const transitionValue = /** @type {{ value?: { implementationCommit?: string } }} */ (transition.value);
    const implementationCommit = transitionValue.value?.implementationCommit;
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
    { agentName, initialRequest, triageMeta, sessionManager, hostedSession, images, __deps },
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
        triageMeta,
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
 *   routerMessage?: string,
 *   reviewFeedback?: string,
 *   reviewImages?: Array<{base64: string, mimeType: string}>,
 *   __deps?: {
 *   loadPlan?: typeof loadPlan,
 *   executeSingleEngineerPlan?: typeof executeSingleEngineerPlan,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
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
    routerMessage,
    reviewFeedback,
    reviewImages,
    __deps = {},
}) {
    const loadPlanFn = __deps.loadPlan || loadPlan;
    if (!hostedSession) throw new Error("executePlan: hostedSession is required");
    const projectRoot = hostedSession.cwd;
    const executeSingleEngineerPlanFn = __deps.executeSingleEngineerPlan || executeSingleEngineerPlan;
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
                        `plans/${planName}.md could not be loaded for execution. The user provided this feedback while`,
                        "recovering it:",
                        "",
                        reviewMeta.feedback || "(no specific feedback provided)",
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
                        routerMessage,
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
        __deps: { ...__deps, recordWorkflowMetric: recordWorkflowMetricFn },
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
                __deps: { runActiveAgentTurn: __deps.runActiveAgentTurn },
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
                    __deps,
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
            __deps: {
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
        routerMessage,
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
 * @param {string} [routerMessage]
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
    routerMessage,
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
                    triageMeta: workflow?.triageMeta,
                    routerMessage,
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
 *     findReusableWorktree?: typeof findReusableWorktree,
 *     prepareTargetBranchRef?: typeof prepareTargetBranchRef,
 *     resolveCurrentCheckoutBranch?: typeof resolveCurrentCheckoutBranch,
 *     resolveTargetBranchName?: typeof resolveTargetBranchName,
 *     captureWorktreeTree?: typeof captureWorktreeTree,
 *     loadCanonicalExecutionPlanSource?: typeof loadCanonicalExecutionPlanSource,
 *     ensureExecutionPlanFile?: typeof ensureExecutionPlanFile,
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
    const findReusable = __deps?.findReusableWorktree || findReusableWorktree;
    const prepareTarget = __deps?.prepareTargetBranchRef || prepareTargetBranchRef;
    const resolveCurrentBranch = __deps?.resolveCurrentCheckoutBranch || resolveCurrentCheckoutBranch;
    const resolveTarget = __deps?.resolveTargetBranchName || resolveTargetBranchName;
    const captureTree = __deps?.captureWorktreeTree || captureWorktreeTree;
    const loadCanonicalPlanSource = __deps?.loadCanonicalExecutionPlanSource || loadCanonicalExecutionPlanSource;
    const ensurePlanFile = __deps?.ensureExecutionPlanFile || ensureExecutionPlanFile;
    const recordWorkflowMetricFn = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const probeGit = __deps?.probeGitRepository || probeGitRepository;
    const hasConsent = __deps?.hasNonGitExecutionConsent || hasNonGitExecutionConsent;
    const confirmNonGit = __deps?.confirmNonGitFeaturePlanExecution || confirmNonGitFeaturePlanExecution;
    const now = __deps?.now || (() => Date.now());
    // Plan identity is durable state, so it is never sourced from an injected seam.
    // This used to fall back to a synthetic `test-plan:<name>` id whenever `__deps`
    // was non-empty, which any production caller passing a single real dep tripped:
    // the Plan got `test-plan:<name>` as its durable id, ensurePlanIdentity() never
    // ran, and the backfill the Plan still needed happened later inside the
    // execution transaction — rewriting Front Matter the transaction had already
    // snapshotted, then aborting the run. Tests that need a fixed id pass
    // `triageMeta.planId`; everything else gets the real one.
    const planIdentity = typeof triageMeta.planId === "string" && triageMeta.planId
        ? { id: triageMeta.planId }
        : await ensurePlanIdentity(projectRoot, planName);
    const stablePlanId = "planId" in planIdentity ? planIdentity.planId : planIdentity.id;
    const effectiveTriageMeta = { ...triageMeta, planId: stablePlanId };
    hostedSession.setWorkflowExecutionContext?.({ planName, triageMeta: effectiveTriageMeta });
    const executionAgent = resolveExecutionOwner(effectiveTriageMeta);
    const collaborationState = {
        collaborationStyle,
        collaborationRecommendation,
        pairCheckpointCount: 0,
    };
    emitPreparingExecutionTarget(hostedSession);
    const gitProbe = await probeGit(projectRoot);
    if (!gitProbe.ok) {
        if (!hasConsent("featurePlan", projectRoot) && !(await confirmNonGit(hostedSession, projectRoot))) {
            throw new Error(
                "Plan execution canceled because Git is not available and in-place execution was not approved.",
            );
        }
        emitPreparingInPlaceExecution(hostedSession);
        const attemptId = triageMeta.worktreeId || `non-git-${crypto.randomUUID().slice(0, 8)}`;
        const canonicalPlan = await loadPlan(projectRoot, planName);
        if (!canonicalPlan) throw new Error(`Plan not found: ${planName}`);
        const transition = await runExecutionPreparationTransition({
            projectRoot,
            planName,
            planId: stablePlanId,
            worktreeId: attemptId,
            expectedRevision: canonicalPlan?.revision,
            recordMetric: () => Promise.resolve(null),
            prepare: async ({ beforePlan, markEffect }) => {
                const workflow = {
                    planName,
                    triageMeta: effectiveTriageMeta,
                    executionAgent,
                    executionStarted: false,
                    ...collaborationState,
                    projectRoot,
                    executionCwd: projectRoot,
                    executionMode: /** @type {const} */ ("non_git_in_place"),
                    nonGitInPlace: true,
                };
                const objectiveChecks = beforePlan?.attrs.objectiveChecks || canonicalPlan.attrs.objectiveChecks || [];
                if (objectiveChecks.length > 0) emitRunningObjectiveChecksBaseline(hostedSession);
                await ensureObjectiveChecksBaseline({
                    projectRoot,
                    planName,
                    attrs: beforePlan?.attrs || canonicalPlan.attrs,
                    revision: beforePlan?.revision || canonicalPlan?.revision,
                    checks: objectiveChecks,
                    cwd: projectRoot,
                    head: undefined,
                });
                emitUpdatingPlanStatusToInProgress(hostedSession);
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName,
                    event: "execution_started",
                    currentStatus,
                    details: {
                        triageMeta: effectiveTriageMeta,
                        nonGitInPlace: true,
                        executionMode: "non_git_in_place",
                    },
                });
                await markEffect("plan_event_recorded", { planName, event: "execution_started" });
                const activeWorkflow = { ...workflow, executionStarted: true, executionAttemptStartedAtMs: now() };
                await recordWorkflowMetricFn({
                    category: "execution",
                    event: "non_git_in_place_execution_started",
                    planName,
                    details: { gitState: gitProbe.state },
                }, { cwd: projectRoot });
                return activeWorkflow;
            },
            verifyPreparation: (workflow) => {
                if (!workflow || typeof workflow !== "object") {
                    throw new Error(`Non-Git execution preparation for ${planName} did not return workflow evidence.`);
                }
                if (workflow.planName !== planName || workflow.executionMode !== "non_git_in_place") {
                    throw new Error(
                        `Non-Git execution preparation returned incompatible workflow evidence for ${planName}.`,
                    );
                }
                if (workflow.executionCwd !== projectRoot || workflow.projectRoot !== projectRoot) {
                    throw new Error(
                        `Non-Git execution preparation returned an unexpected execution context for ${planName}.`,
                    );
                }
                return { planName, executionMode: "non_git_in_place", projectRoot };
            },
        });
        if (transition.status !== "committed") {
            if (transition.cause instanceof ObjectiveChecksBaselineRejectionError) throw transition.cause;
            throw new Error(transition.message || `Non-Git execution preparation did not commit for ${planName}.`);
        }
        const activeWorkflow =
            /** @type {import('../session/hosted-session.js').ActiveExecutionWorkflow} */ (transition.value);
        hostedSession.setActiveExecutionWorkflow(activeWorkflow);
        return activeWorkflow;
    }
    const preflightCanonicalPlanSource = await loadCanonicalPlanSource(projectRoot, planName);
    const canonicalPlanForRevision = await loadPlan(projectRoot, planName).catch(() => null);
    if (preflightCanonicalPlanSource.kind !== "loaded") {
        throw new Error(
            `Cannot load canonical Project Plan ${preflightCanonicalPlanSource.relativePath}: ${
                preflightCanonicalPlanSource.reason || preflightCanonicalPlanSource.kind
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
                baseCommit: existing.worktreeBaseCommit,
            }
            : hasRecordedWorktree
            ? await findReusable({
                projectRoot,
                planName,
                planId: stablePlanId,
                worktreeId: triageMeta.worktreeId || undefined,
            })
            : null;
    const resolvedTargetBranch = reusable
        ? targetBranch ? await resolveTarget(projectRoot, targetBranch) : await resolveCurrentBranch(projectRoot)
        : targetBranch;
    if (reusable) assertReusableWorktreeTargetMatches(reusable.baseBranch, resolvedTargetBranch);
    const attemptId = reusable?.id || triageMeta.worktreeId || crypto.randomUUID().slice(0, 8);
    /** @type {Extract<Awaited<ReturnType<typeof loadCanonicalExecutionPlanSource>>, {kind:"loaded"}> | undefined} */
    let lockedCanonicalPlanSource;
    const transition = await runExecutionPreparationTransition({
        projectRoot,
        planName,
        planId: stablePlanId,
        worktreeId: attemptId,
        targetRef: resolvedTargetBranch || targetBranch || undefined,
        expectedRevision: canonicalPlanForRevision?.revision,
        recordMetric: () => Promise.resolve(null),
        prepare: async ({ beforePlan, markEffect, registerRollback }) => {
            const canonicalPlanSource = await loadCanonicalPlanSource(projectRoot, planName);
            if (canonicalPlanSource.kind !== "loaded") {
                throw new Error(
                    `Cannot load canonical Project Plan ${canonicalPlanSource.relativePath}: ${
                        canonicalPlanSource.reason || canonicalPlanSource.kind
                    }`,
                );
            }
            // The Plan is read twice under the same lock: once as the transition's
            // locked snapshot, once here as the source that will be materialized into
            // the worktree. Those must agree, or execution runs against metadata the
            // lifecycle checks never saw.
            //
            // Compare Front Matter, not whole-file bytes: RunWield owns Front Matter
            // and the user owns the body, so a body edit between the two reads is
            // legitimate and must not abort a valid run. This is the same
            // ownership-scoped comparison the transition layer uses for its
            // preconditions — one primitive, not a second list of fields to keep in
            // sync with the first.
            const canonicalFrontMatterRevision = await getPlanFrontMatterRevisionForText(
                canonicalPlanSource.markdown,
            );
            if (
                beforePlan && beforePlan.frontMatterRevision &&
                beforePlan.frontMatterRevision !== canonicalFrontMatterRevision
            ) {
                throw new Error(
                    `Plan ${planName} had its front matter change while preparing execution; reload the Plan and start execution again.`,
                );
            }
            lockedCanonicalPlanSource = canonicalPlanSource;
            const reusedWorktree = Boolean(reusable);
            /** @type {any} */
            let worktree;
            let objectiveChecksBaselined = false;
            if (reusable) {
                worktree = reusable;
                emitReusingExecutionWorktree(hostedSession, {
                    worktreeBranch: worktree.branch,
                    baseBranch: worktree.baseBranch,
                });
                await markEffect("git_worktree_reused", {
                    worktreeId: worktree.id,
                    path: worktree.path,
                    branch: worktree.branch,
                });
            } else {
                const targetPreparation = targetBranch
                    ? await prepareTarget(projectRoot, targetBranch)
                    : { baseRef: "HEAD", baseBranch: await resolveCurrentBranch(projectRoot) || "HEAD" };
                emitCreatingExecutionWorktree(hostedSession, targetPreparation.baseBranch || targetPreparation.baseRef);
                const worktreeOptions = {
                    projectRoot,
                    planName,
                    planId: stablePlanId,
                    attemptId,
                    ...targetPreparation,
                };
                const worktreeArtifacts = await createWorktreeGitArtifacts(worktreeOptions);
                emitCreatedExecutionWorktree(hostedSession, {
                    worktreeBranch: worktreeArtifacts.branch,
                    baseBranch: worktreeArtifacts.baseBranch || worktreeArtifacts.baseRef,
                });
                await markEffect("git_worktree_created", {
                    worktreeId: worktreeArtifacts.id,
                    path: worktreeArtifacts.path,
                    branch: worktreeArtifacts.branch,
                    baseRef: worktreeArtifacts.baseRef,
                    baseCommit: worktreeArtifacts.baseCommit,
                });
                registerRollback("remove_clean_created_worktree", async () => {
                    await removeWorktreeGitArtifacts({
                        projectRoot,
                        path: worktreeArtifacts.path,
                        force: false,
                    });
                    // Deleting the branch is irreversible, so it is its own proven step.
                    if (worktreeArtifacts.branch) {
                        await deleteMergedWorktreeBranch({
                            projectRoot,
                            branch: worktreeArtifacts.branch,
                            baseCommit: worktreeArtifacts.baseCommit,
                        });
                    }
                });
                const objectiveChecks = beforePlan?.attrs.objectiveChecks ||
                    canonicalPlanSource.attrs.objectiveChecks || [];
                if (objectiveChecks.length > 0) emitRunningObjectiveChecksBaseline(hostedSession);
                await ensureObjectiveChecksBaseline({
                    projectRoot,
                    planName,
                    attrs: beforePlan?.attrs || canonicalPlanSource.attrs,
                    revision: beforePlan?.revision,
                    checks: objectiveChecks,
                    cwd: worktreeArtifacts.path,
                    head: worktreeArtifacts.baseCommit,
                });
                objectiveChecksBaselined = true;
                worktree = await settleWorktreeAttempt(projectRoot, {
                    ...worktreeArtifacts,
                    planName: worktreeArtifacts.planName || planName,
                    planId: worktreeArtifacts.planId || stablePlanId,
                });
                await markEffect("worktree_registry_settled", {
                    worktreeId: worktree.id,
                    path: worktree.path,
                    branch: worktree.branch,
                    status: worktree.status,
                });
                registerRollback("remove_created_registry_entry", async () => {
                    await removeWorktreeRegistryEntry(projectRoot, worktree.id);
                });
            }
            const worktreeBaseBranch = worktree.baseBranch === "HEAD" ? undefined : worktree.baseBranch;
            if (!objectiveChecksBaselined) {
                const objectiveChecksHead = "baseCommit" in worktree && typeof worktree.baseCommit === "string"
                    ? worktree.baseCommit
                    : undefined;
                const objectiveChecks = beforePlan?.attrs.objectiveChecks ||
                    canonicalPlanSource.attrs.objectiveChecks || [];
                if (objectiveChecks.length > 0) emitRunningObjectiveChecksBaseline(hostedSession);
                await ensureObjectiveChecksBaseline({
                    projectRoot,
                    planName,
                    attrs: beforePlan?.attrs || canonicalPlanSource.attrs,
                    revision: beforePlan?.revision,
                    checks: objectiveChecks,
                    cwd: worktree.path,
                    head: objectiveChecksHead,
                });
            }
            emitMaterializingPlanInExecutionWorktree(hostedSession);
            const planFile = await ensurePlanFile({
                executionCwd: worktree.path,
                planName,
                canonicalSource: canonicalPlanSource,
            });
            if (planFile.kind === "restored") emitRestoredPlanInExecutionWorktree(hostedSession);
            if (planFile.kind === "reconciled") emitReconciledPlanInExecutionWorktree(hostedSession);
            if (planFile.kind !== "present" && planFile.kind !== "restored" && planFile.kind !== "reconciled") {
                const preparationError = new Error(
                    `Cannot prepare execution worktree Plan file ${planFile.relativePath}: ${
                        planFile.reason || planFile.kind
                    }`,
                );
                if (!reusedWorktree && worktree.id) {
                    await updateWorktreeRegistryEntry(projectRoot, worktree.id, {
                        status: "execution_failed",
                    }).catch(() => null);
                }
                throw new Error(
                    `${preparationError.message}; execution worktree evidence was preserved at ${worktree.path} on branch ${worktree.branch}.`,
                );
            }
            const baselineTree =
                existing?.planName === planName && existing.executionCwd === worktree.path && existing.baselineTree &&
                    planFile.kind === "present"
                    ? existing.baselineTree
                    : await captureTree(worktree.path);
            const workflow = {
                planName,
                triageMeta: effectiveTriageMeta,
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
                worktreeBaseRef: "baseRef" in worktree && typeof worktree.baseRef === "string"
                    ? worktree.baseRef
                    : undefined,
                worktreeBaseCommit: "baseCommit" in worktree && typeof worktree.baseCommit === "string"
                    ? worktree.baseCommit
                    : undefined,
            };
            if (worktree.id) {
                await updateWorktreeRegistryEntry(projectRoot, worktree.id, {
                    status: "active",
                    executionBaselineTree: baselineTree,
                });
                await markEffect("worktree_registry_updated", {
                    worktreeId: worktree.id,
                    status: "active",
                    executionBaselineTree: baselineTree,
                });
            }
            emitUpdatingPlanStatusToInProgress(hostedSession);
            await recordPlanEvent({
                cwd: projectRoot,
                planName,
                event: "execution_started",
                currentStatus,
                details: {
                    triageMeta: effectiveTriageMeta,
                    executionBaselineTree: baselineTree,
                    worktreeId: worktree.id,
                    worktreePath: worktree.path,
                    worktreeBranch: worktree.branch,
                    worktreeBaseBranch,
                    worktreeStatus: "active",
                },
            });
            await markEffect("plan_event_recorded", { planName, event: "execution_started", worktreeId: worktree.id });
            const activeWorkflow = { ...workflow, executionStarted: true, executionAttemptStartedAtMs: now() };
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
                    planFileReconciled: planFile.kind === "reconciled",
                },
            }, { cwd: projectRoot });
            return activeWorkflow;
        },
        verifyPreparation: async (workflow) => {
            if (!workflow || typeof workflow !== "object") {
                throw new Error(`Execution preparation for ${planName} did not return workflow evidence.`);
            }
            if (workflow.planName !== planName || workflow.executionMode !== "worktree") {
                throw new Error(`Execution preparation returned incompatible workflow evidence for ${planName}.`);
            }
            if (workflow.worktreeId !== attemptId) {
                throw new Error(
                    `Execution preparation attempt mismatch for ${planName}: expected ${attemptId}, found ${workflow.worktreeId}.`,
                );
            }
            if (!workflow.executionCwd || !workflow.worktreeBranch || !workflow.baselineTree) {
                throw new Error(
                    `Execution preparation for ${planName} is missing worktree, branch, or baseline proof.`,
                );
            }
            {
                const worktreeStat = await Deno.stat(workflow.executionCwd).catch(() => null);
                if (!worktreeStat?.isDirectory) {
                    throw new Error(
                        `Execution preparation worktree is not attached for ${planName}: ${workflow.executionCwd}`,
                    );
                }
            }
            {
                const registryEntry = await findWorktreeRegistryEntryById(projectRoot, workflow.worktreeId);
                if (!registryEntry) {
                    throw new Error(
                        `Execution preparation registry entry is missing for attempt ${workflow.worktreeId}.`,
                    );
                }
                if (
                    registryEntry.planName !== planName || registryEntry.path !== workflow.executionCwd ||
                    registryEntry.branch !== workflow.worktreeBranch || registryEntry.status !== "active" ||
                    registryEntry.executionBaselineTree !== workflow.baselineTree
                ) {
                    throw new Error(
                        `Execution preparation registry entry does not match prepared workflow ${workflow.worktreeId}.`,
                    );
                }
            }
            {
                const worktreePlan = await loadPlan(workflow.executionCwd, planName);
                if (!worktreePlan) {
                    throw new Error(`Execution preparation did not materialize Plan file for ${planName}.`);
                }
                if (worktreePlan.attrs.planId && worktreePlan.attrs.planId !== stablePlanId) {
                    throw new Error(`Execution preparation Plan ID mismatch for ${planName}.`);
                }
                if (!lockedCanonicalPlanSource) {
                    throw new Error(
                        `Execution preparation did not retain locked canonical Plan evidence for ${planName}.`,
                    );
                }
                if (
                    worktreePlan.attrs.classification !== lockedCanonicalPlanSource.attrs.classification ||
                    worktreePlan.attrs.status !== lockedCanonicalPlanSource.attrs.status
                ) {
                    throw new Error(
                        `RunWield could not synchronize the execution copy of Plan "${planName}". ` +
                            `Your Plan and worktree were preserved. Retry with \`${CLI_BIN} load-plan ${planName}\`; ` +
                            `if it still cannot start, run \`${CLI_BIN} plans doctor --repair\` and retry.`,
                    );
                }
            }
            return {
                planName,
                worktreeId: workflow.worktreeId,
                worktreeBranch: workflow.worktreeBranch,
                worktreeBaseBranch: workflow.worktreeBaseBranch,
                baselineTree: workflow.baselineTree,
                planRevision: (await loadPlan(workflow.executionCwd, planName))?.revision,
            };
        },
    });
    if (transition.status !== "committed") {
        if (transition.cause instanceof ObjectiveChecksBaselineRejectionError) throw transition.cause;
        throw new Error(transition.message || `Execution preparation did not commit for ${planName}.`);
    }
    const activeWorkflow =
        /** @type {import('../session/hosted-session.js').ActiveExecutionWorkflow} */ (transition.value);
    hostedSession.setActiveExecutionWorkflow(activeWorkflow);
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
    if (status === "merged") {
        await removeWorktreeRegistryEntry(workflow.projectRoot, workflow.worktreeId);
        return;
    }
    await updateWorktreeRegistryEntry(workflow.projectRoot, workflow.worktreeId, { status });
}
