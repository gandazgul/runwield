/**
 * @module shared/workflow
 * Plan-execution facade used by the plan_written tool, resume command, and
 * router triage flow.
 */

import { AGENTS } from "../../constants.js";
import {
    loadPlan,
    normalizeCollaborationMode,
    normalizeExecutionAgent,
    updatePlanFrontMatter,
} from "../../plan-store.js";
import { hasNonGitExecutionConsent, probeGitRepository, rememberNonGitExecutionConsent } from "../git.js";
import { getAgentDisplayName } from "../session/agents.js";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "../session/session-runtime-interactions.js";
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
export {
    askPostApproval,
    askProjectDecompositionApproval,
    buildEngineerRequest,
    buildSlicerRequest,
} from "./workflow-prompts.js";
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
    return normalizeExecutionAgent(meta.executionAgent) || (meta.frontend === true ? "frontend-engineer" : "engineer");
}

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} meta
 */
async function resolveCollaborationMode(hostedSession, meta) {
    if (resolveExecutionOwner(meta) !== AGENTS.FRONTEND_ENGINEER) return undefined;
    const adapter = hostedSession.getInteractionAdapter?.();
    const pairCapable = adapter?.supportsInteraction?.(RuntimeInteractionTypes.PAIR_CHECKPOINT) === true;
    const stored = normalizeCollaborationMode(meta.collaborationMode);
    if (stored) return pairCapable ? stored : "autonomous";
    if (!pairCapable) return "autonomous";
    const recommendation = normalizeCollaborationMode(meta.collaborationRecommendation) || "autonomous";
    const response = await requestHostedSessionInteraction(hostedSession, {
        type: RuntimeInteractionTypes.SELECT,
        prompt: "Choose how Frontend Engineer should execute this Plan in the interactive host.",
        defaultValue: recommendation,
        options: [
            { value: "pair", label: "Pair interactively", description: "Review coherent visible increments." },
            { value: "autonomous", label: "Run autonomously", description: "Review only after implementation." },
        ],
    });
    return response.outcome === "selected" && response.value === "pair" ? "pair" : "autonomous";
}

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @returns {boolean}
 */
function isPairCapableHost(hostedSession) {
    return hostedSession.getInteractionAdapter?.()?.supportsInteraction?.(RuntimeInteractionTypes.PAIR_CHECKPOINT) ===
        true;
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
 *   updatePlanFrontMatter?: typeof updatePlanFrontMatter,
 *   runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn,
 *   }
 * }} options
 * @returns {Promise<PlanExecutionResult>}
 */
export async function executePlan({
    planName,
    triageMeta,
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
    const updatePlanFrontMatterFn = __deps.updatePlanFrontMatter || updatePlanFrontMatter;

    await recordWorkflowMetricFn({
        category: "execution",
        event: "plan_execution_started",
        planName,
        details: { classification: triageMeta?.classification, status: triageMeta?.status },
    }, { cwd: projectRoot });
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

    const effectiveMeta = { ...plan.attrs, ...(triageMeta || {}) };
    effectiveMeta.executionAgent = resolveExecutionOwner(effectiveMeta);

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

    const hasLegacyFrontend = typeof plan.attrs.frontend === "boolean";
    if (hasLegacyFrontend) {
        if (plan.attrs.frontend === true) {
            /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
            const updates = {
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "autonomous",
                frontend: undefined,
            };
            await updatePlanFrontMatterFn(projectRoot, planName, updates);
        } else {
            /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
            const updates = { frontend: undefined };
            await updatePlanFrontMatterFn(projectRoot, planName, updates);
        }
    }

    const storedCollaborationMode = normalizeCollaborationMode(effectiveMeta.collaborationMode);
    const pairCapableHost = isPairCapableHost(hostedSession);
    effectiveMeta.collaborationMode = await resolveCollaborationMode(hostedSession, effectiveMeta);
    if (
        effectiveMeta.executionAgent === AGENTS.FRONTEND_ENGINEER && !storedCollaborationMode && pairCapableHost
    ) {
        await updatePlanFrontMatterFn(projectRoot, planName, {
            executionAgent: effectiveMeta.executionAgent,
            collaborationMode: effectiveMeta.collaborationMode,
        });
    }

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
            __deps,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
        triageMeta.executionAgent || AGENTS.ENGINEER,
        triageMeta.collaborationMode,
        __deps,
    );
    if (!engineerResult.completed) {
        return { repairRequired: false, executionComplete: false, error: engineerResult.error };
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
 * @param {"pair"|"autonomous"} [collaborationMode]
 * @param {{ runActiveAgentTurn?: typeof import('../session/agent-switching.js').runActiveAgentTurn }} [__deps]
 * @returns {Promise<{ completed: boolean, messages: import('@earendil-works/pi-agent-core').AgentMessage[], error?: string, completionReport?: string }>}
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
    collaborationMode,
    __deps,
) {
    if (!hostedSession) throw new Error("runEngineerWithPlan: hostedSession is required");
    const runActiveAgentTurn = __deps?.runActiveAgentTurn ||
        (await import("../session/agent-switching.js")).runActiveAgentTurn;
    let messages;
    try {
        messages = await runActiveAgentTurn({
            hostedSession,
            agentName: executionAgent,
            userRequest: `${
                buildEngineerRequest(planName, planBody, reviewFeedback)
            }\n\nExecution owner: ${executionAgent}. Collaboration mode: ${collaborationMode || "autonomous"}.`,
            images: reviewImages,
            sessionManager,
            cwd: executionCwd,
            allowReturnToRouter: false,
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

    const pairStopped = hostedSession.getActiveExecutionWorkflow?.()?.pairStopRequested === true;
    const completed = !pairStopped && readLatestTaskCompletedOutcome(messages);
    const completionReport = readLatestTaskCompletedMessage(messages) || undefined;
    if (!completed) {
        emitSystemStatus(
            hostedSession,
            buildEngineerPausedMessage(undefined, projectRoot || hostedSession?.cwd, executionAgent),
            { header: "RunWield" },
        );
    }

    return { completed, messages, completionReport };
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
 * @returns {Promise<{ projectRoot: string, executionCwd: string, baselineTree?: string, worktreeId?: string, worktreeBranch?: string, worktreeBaseBranch?: string, nonGitInPlace?: boolean }>}
 */
export async function startActiveExecutionWorkflow(
    { planName, triageMeta, currentStatus, hostedSession, __deps },
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
            executionAgent: resolveExecutionOwner(triageMeta),
            collaborationMode: normalizeCollaborationMode(triageMeta.collaborationMode),
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
        await recordWorkflowMetricFn({
            category: "execution",
            event: "non_git_in_place_execution_started",
            planName,
            details: { gitState: gitProbe.state },
        }, { cwd: projectRoot });
        return workflow;
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
        executionAgent: resolveExecutionOwner(triageMeta),
        collaborationMode: normalizeCollaborationMode(triageMeta.collaborationMode),
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
    return workflow;
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
