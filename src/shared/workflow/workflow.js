/**
 * @module shared/workflow
 * Plan-execution facade used by the plan_written tool, resume command, and
 * router triage flow.
 */

import { AGENTS, CWD } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
import { getAgentDisplayName } from "../session/agents.js";
import { runAgentSession } from "../session/session.js";
import {
    createExecutionWorktree,
    findReusableWorktree,
    prepareTargetBranchRef,
    resolveTargetBranchName,
} from "../worktree.js";
import { updateEntry as updateWorktreeRegistryEntry } from "../worktree-registry.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { isEpicPlan, isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";
import { recordWorkflowMetric } from "./metrics.js";
import { buildEngineerRequest } from "./workflow-prompts.js";
import { readLatestPlanOutcome, readLatestTaskCompletedOutcome } from "./workflow-results.js";

export { executeProjectTasks } from "./project-executor.js";
export {
    extractTasks,
    parseTaskDependencies,
    parseTaskWriteScope,
    selectNonConflictingTasks,
    taskWriteScopesOverlap,
    validateProjectTasks,
} from "./task-scheduling.js";
// Slicer-facing helpers are re-exported from the workflow facade for callers that should not import submodules.
export {
    createSlicerFinalizeTool,
    ensureSlicerTasks,
    materializeSlicerDraft,
    runSlicerAgent,
} from "./workflow-slicer.js";
export {
    askApprovalWithTasks,
    askPostApproval,
    askProjectDecompositionApproval,
    askRetryFailedTasks,
    buildDependencyOutputsContext,
    buildEngineerRequest,
    buildSlicerRequest,
    buildTaskAssignmentRequest,
    buildTaskResultDisplay,
    reportExecutionSummary,
} from "./workflow-prompts.js";
export { extractAssistantOutput, readLatestPlanOutcome, readLatestTaskCompletedOutcome } from "./workflow-results.js";

/**
 * @typedef {import('../../ui/tui/types.js').UiAPI} UiAPI
 */

/**
 * @typedef {"approved_execute" | "saved" | "feedback" | "canceled" | "repair_required" | "no_call"} PlanOutcome
 */

/**
 * @typedef {Object} PlanOutcomeResult
 * @property {PlanOutcome} outcome
 * @property {string} [planName]
 * @property {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} [tasks]
 * @property {import('../../tools/plan-written.js').TriageMeta} [triageMeta]
 */

/**
 * @typedef {Object} PlanExecutionResult
 * @property {boolean} repairRequired
 * @property {boolean} executionComplete
 * @property {string} [error]
 * @property {number[]} [failedTasks]
 */

/**
 * Run a planning agent once and return the lifecycle outcome captured by
 * plan_written. Does not execute the plan.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string} opts.initialRequest
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {UiAPI} opts.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {import('../session/hosted-session.js').HostedSession} [opts.hostedSession]
 * @returns {Promise<PlanOutcomeResult>}
 */
export async function runPlanningAgent(
    { agentName, initialRequest, triageMeta, uiAPI, sessionManager, hostedSession },
) {
    if (!uiAPI) throw new Error("runPlanningAgent: uiAPI is required");
    const messages = await runAgentSession({
        hostedSession,
        agentName,
        userRequest: initialRequest,
        triageMeta,
        uiAPI,
        sessionManager,
        useRootSession: true,
    });

    const result = readLatestPlanOutcome(messages);
    return result || { outcome: "no_call" };
}

/**
 * Execute an approved plan.
 *
 * @param {string} planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} triageMeta
 * @param {UiAPI} uiAPI
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} [structuredTasks]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @param {{
 *   loadPlan?: typeof loadPlan,
 *   executeStructuredProjectPlan?: () => Promise<PlanExecutionResult>,
 *   executeSingleEngineerPlan?: typeof executeSingleEngineerPlan,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   hostedSession?: import('../session/hosted-session.js').HostedSession,
 * }} [__deps]
 * @returns {Promise<PlanExecutionResult>}
 */
export async function executePlan(planName, triageMeta, uiAPI, structuredTasks, sessionManager, __deps = {}) {
    if (!uiAPI) throw new Error("executePlan: uiAPI is required");

    const loadPlanFn = __deps.loadPlan || loadPlan;
    const hostedSession = __deps.hostedSession;
    void structuredTasks;
    const executeSingleEngineerPlanFn = __deps.executeSingleEngineerPlan || executeSingleEngineerPlan;
    const recordPlanEventFn = __deps.recordPlanEvent || recordPlanEvent;
    const markActiveWorktreeStatusFn = __deps.markActiveWorktreeStatus || markActiveWorktreeStatus;
    const recordWorkflowMetricFn = __deps.recordWorkflowMetric || recordWorkflowMetric;

    await recordWorkflowMetricFn({
        category: "execution",
        event: "plan_execution_started",
        planName,
        details: { classification: triageMeta?.classification, status: triageMeta?.status },
    });
    const plan = await loadPlanFn(CWD, planName);
    if (!plan) {
        uiAPI.appendSystemMessage(`ERROR: Could not load plan ${planName}`, true, "RunWield");
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: "plan_not_found" },
        });
        return { repairRequired: false, executionComplete: false, error: `Could not load plan ${planName}` };
    }

    const effectiveMeta = { ...plan.attrs, ...(triageMeta || {}) };

    if (isEpicPlan(plan.attrs)) {
        const error = `Plan ${planName} is a PROJECT Epic container and cannot be executed directly.`;
        uiAPI.appendSystemMessage(`ERROR: ${error}`, true, "RunWield");
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: "epic_container", classification: effectiveMeta.classification },
        });
        return { repairRequired: false, executionComplete: false, error };
    }

    if (!isExecutablePlanStatus(plan.attrs.status)) {
        const error = `Plan ${planName} is not ready for work (status: ${plan.attrs.status}).`;
        uiAPI.appendSystemMessage(`ERROR: ${error}`, true, "RunWield");
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_rejected",
            planName,
            details: { reason: "not_ready_for_work", status: plan.attrs.status },
        });
        return { repairRequired: false, executionComplete: false, error };
    }

    uiAPI.appendSystemMessage(`=== Executing Plan: ${planName} ===`, false, "RunWield");

    // New Epic-era execution never dispatches PROJECT task DAGs from this facade.
    // Epics are containers handled above; child FEATURE plans and any legacy
    // non-Epic plan that reaches this path use the normal single-plan execution path.
    const result = await executeSingleEngineerPlanFn({
        planName,
        planBody: plan.body,
        triageMeta: effectiveMeta,
        uiAPI,
        sessionManager,
        currentStatus: plan.attrs.status,
        hostedSession,
        __deps: { recordWorkflowMetric: recordWorkflowMetricFn },
    });
    if (!result.executionComplete) {
        await recordWorkflowMetricFn({
            category: "execution",
            event: "plan_execution_result",
            planName,
            details: {
                executionComplete: false,
                repairRequired: result.repairRequired,
                failedTaskCount: Array.isArray(result.failedTasks) ? result.failedTasks.length : undefined,
                hasError: Boolean(result.error),
            },
        });
        return result;
    }

    await recordWorkflowMetricFn({
        category: "execution",
        event: "plan_execution_result",
        planName,
        details: { executionComplete: true, repairRequired: false },
    });

    uiAPI.appendSystemMessage(
        `✅ Plan implementation complete: ${planName}`,
        false,
        "RunWield",
    );
    await recordPlanEventFn({
        cwd: CWD,
        planName,
        event: "implementation_finished",
        currentStatus: "in_progress",
        details: { triageMeta: effectiveMeta },
    });
    await recordWorkflowMetricFn({
        category: "execution",
        event: "implementation_finished",
        planName,
        details: { classification: effectiveMeta.classification },
    });
    await markActiveWorktreeStatusFn("completed", { hostedSession });
    return { repairRequired: false, executionComplete: true };
}

/**
 * @param {{
 *     planName: string,
 *     planBody: string,
 *     triageMeta: Partial<import('../../plan-store.js').PlanFrontMatter>,
 *     uiAPI: UiAPI,
 *     sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager,
 *     currentStatus: import('./plan-lifecycle.js').PlanStatus,
 *     hostedSession?: import('../session/hosted-session.js').HostedSession,
 *     __deps?: { recordWorkflowMetric?: typeof recordWorkflowMetric },
 * }} opts
 * @returns {Promise<PlanExecutionResult>}
 */
async function executeSingleEngineerPlan(
    { planName, planBody, triageMeta, uiAPI, sessionManager, currentStatus, hostedSession, __deps },
) {
    const executionContext = await startActiveExecutionWorkflow({
        planName,
        triageMeta,
        currentStatus,
        hostedSession,
        __deps,
    });
    const engineerResult = await runEngineerWithPlan(
        planName,
        planBody,
        uiAPI,
        sessionManager,
        executionContext.executionCwd,
        hostedSession,
    );
    if (!engineerResult.completed) {
        return { repairRequired: false, executionComplete: false, error: engineerResult.error };
    }
    return { repairRequired: false, executionComplete: true };
}

/**
 * Run engineer against the full approved plan body.
 *
 * @param {string} planName
 * @param {string} planBody
 * @param {UiAPI} uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @param {string} [executionCwd]
 * @param {import('../session/hosted-session.js').HostedSession} [hostedSession]
 * @returns {Promise<{ completed: boolean, messages: import('@earendil-works/pi-agent-core').AgentMessage[], error?: string }>}
 */
async function runEngineerWithPlan(planName, planBody, uiAPI, sessionManager, executionCwd, hostedSession) {
    let messages;
    try {
        messages = await runAgentSession({
            hostedSession,
            agentName: AGENTS.ENGINEER,
            userRequest: buildEngineerRequest(planName, planBody),
            uiAPI,
            sessionManager,
            cwd: executionCwd,
            useRootSession: true,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const hostedRootSession = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
        const rootMessages = hostedRootSession?.agent?.state?.messages || [];
        uiAPI.appendSystemMessage(
            buildEngineerPausedMessage(errorMessage),
            true,
            "RunWield",
        );
        return { completed: false, messages: rootMessages, error: errorMessage };
    }

    const completed = readLatestTaskCompletedOutcome(messages);
    if (!completed) {
        uiAPI.appendSystemMessage(
            buildEngineerPausedMessage(),
            false,
            "RunWield",
        );
    }

    return { completed, messages };
}

/**
 * @param {string} [reason]
 */
function buildEngineerPausedMessage(reason) {
    const base = `${
        getAgentDisplayName(AGENTS.ENGINEER)
    } stopped without task_completed; execution is paused. Say "continue" to resume with the Engineer.`;
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
 *     resolveTargetBranchName?: typeof resolveTargetBranchName,
 *     captureWorktreeTree?: typeof captureWorktreeTree,
 *     updateWorktreeRegistryEntry?: typeof updateWorktreeRegistryEntry,
 *     recordPlanEvent?: typeof recordPlanEvent,
 *     recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   },
 * }} opts
 * @returns {Promise<{ projectRoot: string, executionCwd: string, baselineTree: string, worktreeId: string, worktreeBranch: string, worktreeBaseBranch?: string }>}
 */
export async function startActiveExecutionWorkflow({ planName, triageMeta, currentStatus, hostedSession, __deps }) {
    if (!hostedSession) throw new Error("startActiveExecutionWorkflow: hostedSession is required");
    const createWorktree = __deps?.createExecutionWorktree || createExecutionWorktree;
    const findReusable = __deps?.findReusableWorktree || findReusableWorktree;
    const prepareTarget = __deps?.prepareTargetBranchRef || prepareTargetBranchRef;
    const resolveTarget = __deps?.resolveTargetBranchName || resolveTargetBranchName;
    const captureTree = __deps?.captureWorktreeTree || captureWorktreeTree;
    const updateRegistry = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const recordEvent = __deps?.recordPlanEvent || recordPlanEvent;
    const recordWorkflowMetricFn = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const targetBranch = normalizeExecutionTargetBranch(triageMeta.worktreeBaseBranch);
    const existing = hostedSession.getActiveExecutionWorkflow();
    const reusable =
        existing?.planName === planName && existing.executionCwd && existing.worktreeId && existing.worktreeBranch
            ? {
                id: existing.worktreeId,
                path: existing.executionCwd,
                branch: existing.worktreeBranch,
                baseBranch: existing.worktreeBaseBranch,
            }
            : await findReusable({ projectRoot: CWD, planName });
    const resolvedTargetBranch = reusable && targetBranch ? await resolveTarget(CWD, targetBranch) : targetBranch;
    if (reusable) assertReusableWorktreeTargetMatches(reusable.baseBranch, resolvedTargetBranch);
    const reusedWorktree = Boolean(reusable);
    const worktree = reusable || await createWorktree({
        projectRoot: CWD,
        planName,
        ...(targetBranch ? await prepareTarget(CWD, targetBranch) : { baseRef: "HEAD" }),
    });
    const worktreeBaseBranch = worktree.baseBranch === "HEAD" ? undefined : worktree.baseBranch;
    const baselineTree =
        existing?.planName === planName && existing.executionCwd === worktree.path && existing.baselineTree
            ? existing.baselineTree
            : await captureTree(worktree.path);
    const workflow = {
        planName,
        triageMeta,
        baselineTree,
        projectRoot: CWD,
        executionCwd: worktree.path,
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
        worktreeBaseBranch,
    };
    hostedSession.setActiveExecutionWorkflow(workflow);
    if (worktree.id) {
        await updateRegistry(CWD, worktree.id, { status: "active" });
    }
    await recordEvent({
        cwd: CWD,
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
    });
    return workflow;
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatter['worktreeStatus']} status
 * @param {{ hostedSession?: import('../session/hosted-session.js').HostedSession }} [opts]
 */
async function markActiveWorktreeStatus(status, opts = {}) {
    const workflow = opts.hostedSession?.getActiveExecutionWorkflow();
    if (!workflow?.worktreeId || !status || status === "none") return;
    await updateWorktreeRegistryEntry(workflow.projectRoot || CWD, workflow.worktreeId, { status });
}
