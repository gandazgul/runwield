/**
 * @module shared/workflow
 * Plan-execution facade used by the plan_written tool, resume command, and
 * router triage flow.
 */

import { AGENTS } from "../../constants.js";
import { loadPlan, resolvePlanExecutionPolicy } from "../../plan-store.js";
import { hasNonGitExecutionConsent, probeGitRepository, rememberNonGitExecutionConsent } from "../git.js";
import { getAgentDisplayName } from "../session/agents.js";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionTypes,
    supportsHostedSessionInteraction,
} from "../session/session-runtime-interactions.js";
import {
    createExecutionWorktree,
    findReusableWorktree,
    prepareTargetBranchRef,
    resolveCurrentCheckoutBranch,
    resolveTargetBranchName,
} from "../worktree.js";
import { updateEntry as updateWorktreeRegistryEntry } from "../worktree-registry.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { isEpicPlan, isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";
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
 */

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {{ executionAgent: "engineer"|"frontend-engineer", collaborationRecommendation: "autonomous"|"pair", source: "canonical"|"legacy_frontend"|"legacy_frontend_false"|"absent" }} policy
 * @returns {RuntimeCollaborationSelection}
 */
function selectRuntimeCollaborationStyle(hostedSession, policy) {
    const recommendation = policy.collaborationRecommendation || CollaborationStyles.AUTONOMOUS;
    if (policy.executionAgent !== AGENTS.FRONTEND_ENGINEER || policy.source !== "canonical") {
        return { style: CollaborationStyles.AUTONOMOUS, recommendation };
    }
    if (recommendation !== CollaborationStyles.PAIR) {
        return { style: CollaborationStyles.AUTONOMOUS, recommendation };
    }
    if (!supportsPairExecution(hostedSession)) {
        emitSystemStatus(
            hostedSession,
            "Pair Execution is recommended by the Plan but unavailable in this host; continuing with autonomous Frontend Engineer execution.",
            { header: "RunWield" },
        );
        return { style: CollaborationStyles.AUTONOMOUS, recommendation };
    }
    return { style: CollaborationStyles.PAIR, recommendation };
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
 * @property {"stop"|"canceled"} [pauseReason]
 * @property {string} [error]
 * @property {string} [completionReport]
 */

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
 * @param {{ runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn }} [opts.__deps]
 * @returns {Promise<PlanOutcomeResult>}
 */
export async function runPlanningAgent(
    { agentName, initialRequest, triageMeta: _triageMeta, sessionManager, hostedSession, __deps },
) {
    const runActiveAgentTurn = __deps?.runActiveAgentTurn ||
        (await import("../session/agent-switching.js")).runActiveAgentTurn;
    if (!hostedSession) throw new Error("runPlanningAgent: hostedSession is required");

    const messages = await runActiveAgentTurn({
        hostedSession,
        agentName,
        userRequest: initialRequest,
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
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn,
 *   probeGitRepository?: typeof probeGitRepository,
 *   hasNonGitExecutionConsent?: typeof hasNonGitExecutionConsent,
 *   confirmNonGitFeaturePlanExecution?: typeof confirmNonGitFeaturePlanExecution,
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

    const plan = await loadPlanFn(projectRoot, planName);
    if (!plan) {
        emitSystemStatus(hostedSession, `ERROR: Could not load plan ${planName}`, {
            level: "error",
            header: "RunWield",
        });
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: "plan_not_found" },
        }, { cwd: projectRoot });
        return { repairRequired: false, executionComplete: false, error: `Could not load plan ${planName}` };
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

    const collaboration = policy.ok
        ? selectRuntimeCollaborationStyle(hostedSession, policy.policy)
        : { style: CollaborationStyles.AUTONOMOUS, recommendation: CollaborationStyles.AUTONOMOUS };

    await recordWorkflowMetricFn({
        category: "execution",
        event: "plan_execution_started",
        planName,
        details: { classification: effectiveMeta.classification, status: effectiveMeta.status },
    }, { cwd: projectRoot });

    emitSystemStatus(hostedSession, `=== Executing Plan: ${planName} ===`, { header: "RunWield" });

    // PROJECT Epics are containers handled above; executable child FEATURE plans use the normal single-plan execution path.
    const result = await executeSingleEngineerPlanFn({
        planName,
        planBody: plan.body,
        triageMeta: effectiveMeta,
        sessionManager,
        currentStatus: plan.attrs.status,
        hostedSession,
        reviewFeedback,
        reviewImages,
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

    await recordWorkflowMetricFn({
        category: "execution",
        event: "plan_execution_result",
        planName,
        details: { executionComplete: true, repairRequired: false },
    }, { cwd: projectRoot });

    emitSystemStatus(
        hostedSession,
        `✅ Plan implementation complete: ${planName}`,
        { header: "RunWield" },
    );
    const activeWorkflow = hostedSession?.getActiveExecutionWorkflow?.();
    await recordPlanEventFn({
        cwd: projectRoot,
        planName,
        event: "implementation_finished",
        currentStatus: "in_progress",
        details: {
            triageMeta: effectiveMeta,
            nonGitInPlace: activeWorkflow?.nonGitInPlace === true,
            executionReport: result.completionReport,
        },
    });
    await recordWorkflowMetricFn({
        category: "execution",
        event: "implementation_finished",
        planName,
        details: { classification: effectiveMeta.classification },
    }, { cwd: projectRoot });
    await markActiveWorktreeStatusFn("completed", { hostedSession });
    return {
        repairRequired: false,
        executionComplete: true,
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
            ...(engineerResult.paused ? { paused: true, pauseReason: engineerResult.pauseReason } : {}),
            ...(engineerResult.error ? { error: engineerResult.error } : {}),
        };
    }
    return {
        repairRequired: false,
        executionComplete: true,
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
 * @param {{ runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn }} [__deps]
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
        ? [createPairCheckpointTool({ hostedSession })]
        : undefined;
    let messages;
    try {
        messages = await runActiveAgentTurn({
            hostedSession,
            agentName: executionAgent,
            userRequest: `${
                buildEngineerRequest(planName, planBody, reviewFeedback, { collaborationStyle })
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
            { value: "proceed", label: "Proceed in current files and remember for FEATURE/Plan work" },
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
 *     updateWorktreeRegistryEntry?: typeof updateWorktreeRegistryEntry,
 *     recordPlanEvent?: typeof recordPlanEvent,
 *     recordWorkflowMetric?: typeof recordWorkflowMetric,
 *     probeGitRepository?: typeof probeGitRepository,
 *     hasNonGitExecutionConsent?: typeof hasNonGitExecutionConsent,
 *     confirmNonGitFeaturePlanExecution?: typeof confirmNonGitFeaturePlanExecution,
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
    const updateRegistry = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const recordEvent = __deps?.recordPlanEvent || recordPlanEvent;
    const recordWorkflowMetricFn = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const probeGit = __deps?.probeGitRepository || probeGitRepository;
    const hasConsent = __deps?.hasNonGitExecutionConsent || hasNonGitExecutionConsent;
    const confirmNonGit = __deps?.confirmNonGitFeaturePlanExecution || confirmNonGitFeaturePlanExecution;
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
            nonGitInPlace: true,
        };
        hostedSession.setActiveExecutionWorkflow(workflow);
        await recordEvent({
            cwd: projectRoot,
            planName,
            event: "execution_started",
            currentStatus,
            details: { triageMeta, nonGitInPlace: true },
        });
        const activeWorkflow = { ...workflow, executionStarted: true };
        hostedSession.setActiveExecutionWorkflow(activeWorkflow);
        await recordWorkflowMetricFn({
            category: "execution",
            event: "non_git_in_place_execution_started",
            planName,
            details: { gitState: gitProbe.state },
        }, { cwd: projectRoot });
        return activeWorkflow;
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
    const baselineTree =
        existing?.planName === planName && existing.executionCwd === worktree.path && existing.baselineTree
            ? existing.baselineTree
            : await captureTree(worktree.path);
    const workflow = {
        planName,
        triageMeta,
        executionAgent,
        executionStarted: false,
        ...collaborationState,
        baselineTree,
        projectRoot,
        executionCwd: worktree.path,
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
        worktreeBaseBranch,
    };
    hostedSession.setActiveExecutionWorkflow(workflow);
    if (worktree.id) {
        await updateRegistry(projectRoot, worktree.id, { status: "active" });
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
    const activeWorkflow = { ...workflow, executionStarted: true };
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
        },
    }, { cwd: projectRoot });
    return activeWorkflow;
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatter['worktreeStatus']} status
 * @param {{ hostedSession?: import('../session/hosted-session.js').HostedSession }} [opts]
 */
async function markActiveWorktreeStatus(status, opts = {}) {
    const workflow = opts.hostedSession?.getActiveExecutionWorkflow();
    if (!workflow?.worktreeId || !status || status === "none") return;
    if (!workflow.projectRoot) throw new Error("markActiveWorktreeStatus: workflow projectRoot is required");
    await updateWorktreeRegistryEntry(workflow.projectRoot, workflow.worktreeId, { status });
}
