/**
 * @module shared/workflow
 * Plan-execution facade used by the plan_written tool, resume command, and
 * router triage flow.
 */

import { AGENTS, CWD } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
import { getAgentDisplayName } from "../session/agents.js";
import { runAgentSession } from "../session/session.js";
import { getActiveExecutionWorkflow, setActiveExecutionWorkflow } from "../session/session-state.js";
import { createExecutionWorktree, findReusableWorktree } from "../worktree.js";
import { updateEntry as updateWorktreeRegistryEntry } from "../worktree-registry.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { isEpicPlan, isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";
import { executeProjectTasks } from "./project-executor.js";
import { extractTasks, validateProjectTasks } from "./task-scheduling.js";
import { askRetryFailedTasks, buildEngineerRequest, reportExecutionSummary } from "./workflow-prompts.js";
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
    createSlicerMessageHandler,
    ensureSlicerTasks,
    materializeSlicerDraft,
    runSlicerAgent,
} from "./workflow-slicer.js";
export {
    askApprovalWithTasks,
    askPostApproval,
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
 * @typedef {import('../ui/types.js').UiAPI} UiAPI
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
 * @returns {Promise<PlanOutcomeResult>}
 */
export async function runPlanningAgent({ agentName, initialRequest, triageMeta, uiAPI, sessionManager }) {
    if (!uiAPI) throw new Error("runPlanningAgent: uiAPI is required");
    const messages = await runAgentSession({
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
 *   executeStructuredProjectPlan?: typeof executeStructuredProjectPlan,
 *   executeSingleEngineerPlan?: typeof executeSingleEngineerPlan,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
 * }} [__deps]
 * @returns {Promise<PlanExecutionResult>}
 */
export async function executePlan(planName, triageMeta, uiAPI, structuredTasks, sessionManager, __deps = {}) {
    if (!uiAPI) throw new Error("executePlan: uiAPI is required");

    const loadPlanFn = __deps.loadPlan || loadPlan;
    const executeStructuredProjectPlanFn = __deps.executeStructuredProjectPlan || executeStructuredProjectPlan;
    const executeSingleEngineerPlanFn = __deps.executeSingleEngineerPlan || executeSingleEngineerPlan;
    const recordPlanEventFn = __deps.recordPlanEvent || recordPlanEvent;
    const markActiveWorktreeStatusFn = __deps.markActiveWorktreeStatus || markActiveWorktreeStatus;

    const plan = await loadPlanFn(CWD, planName);
    if (!plan) {
        uiAPI.appendSystemMessage(`ERROR: Could not load plan ${planName}`, true, "Harns");
        return { repairRequired: false, executionComplete: false, error: `Could not load plan ${planName}` };
    }

    const effectiveMeta = { ...plan.attrs, ...(triageMeta || {}) };

    if (isEpicPlan(plan.attrs)) {
        const error = `Plan ${planName} is a PROJECT Epic container and cannot be executed directly.`;
        uiAPI.appendSystemMessage(`ERROR: ${error}`, true, "Harns");
        return { repairRequired: false, executionComplete: false, error };
    }

    if (!isExecutablePlanStatus(plan.attrs.status)) {
        const error = `Plan ${planName} is not ready for work (status: ${plan.attrs.status}).`;
        uiAPI.appendSystemMessage(`ERROR: ${error}`, true, "Harns");
        return { repairRequired: false, executionComplete: false, error };
    }

    uiAPI.appendSystemMessage(`=== Executing Plan: ${planName} ===`, false, "Harns");
    let executionStarted = false;

    if (effectiveMeta.classification === "PROJECT") {
        try {
            const tasks = structuredTasks && structuredTasks.length > 0 ? structuredTasks : extractTasks(plan.markdown);
            validateProjectTasks(tasks);

            if (tasks.length > 0) {
                executionStarted = true;
                const result = await executeStructuredProjectPlanFn({
                    planName,
                    planBody: plan.body,
                    tasks,
                    triageMeta: effectiveMeta,
                    uiAPI,
                    sessionManager,
                    currentStatus: plan.attrs.status,
                });
                if (!result.executionComplete) return result;
            } else {
                executionStarted = true;
                const result = await executeSingleEngineerPlanFn({
                    planName,
                    planBody: plan.body,
                    triageMeta: effectiveMeta,
                    uiAPI,
                    sessionManager,
                    currentStatus: plan.attrs.status,
                });
                if (!result.executionComplete) return result;
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            uiAPI.appendSystemMessage(`TASK TABLE ERROR: ${error.message}`, true, "Harns");
            if (executionStarted) {
                await recordPlanEventFn({
                    cwd: CWD,
                    planName,
                    event: "execution_failed",
                    currentStatus: "in_progress",
                    details: { triageMeta: effectiveMeta, failureReason: error.message },
                });
                await markActiveWorktreeStatusFn("execution_failed");
            }
            return { repairRequired: true, executionComplete: false, error: error.message };
        }
    } else {
        const result = await executeSingleEngineerPlanFn({
            planName,
            planBody: plan.body,
            triageMeta: effectiveMeta,
            uiAPI,
            sessionManager,
            currentStatus: plan.attrs.status,
        });
        if (!result.executionComplete) return result;
    }

    uiAPI.appendSystemMessage(
        `✅ Plan implementation complete: ${planName}`,
        false,
        "Harns",
    );
    await recordPlanEventFn({
        cwd: CWD,
        planName,
        event: "implementation_finished",
        currentStatus: "in_progress",
        details: { triageMeta: effectiveMeta },
    });
    await markActiveWorktreeStatusFn("completed");
    return { repairRequired: false, executionComplete: true };
}

/**
 * @param {{
 *     planName: string,
 *     planBody: string,
 *     tasks: Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>,
 *     triageMeta: Partial<import('../../plan-store.js').PlanFrontMatter>,
 *     uiAPI: UiAPI,
 *     sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager,
 *     currentStatus: import('./plan-lifecycle.js').PlanStatus,
 * }} opts
 * @returns {Promise<PlanExecutionResult>}
 */
async function executeStructuredProjectPlan({
    planName,
    planBody,
    tasks,
    triageMeta,
    uiAPI,
    sessionManager,
    currentStatus,
}) {
    const executionContext = await startActiveExecutionWorkflow(planName, triageMeta, currentStatus);
    uiAPI.appendSystemMessage(
        `Found ${tasks.length} tasks in plan. Executing in parallel where possible.`,
        false,
        "Harns",
    );

    let localActiveTasks = 0;
    let spinnerInterval = startTaskSpinner(uiAPI, () => localActiveTasks);

    const executionResult = await executeProjectTasks(
        planName,
        planBody,
        tasks,
        uiAPI,
        [],
        (runningTasks) => {
            localActiveTasks = runningTasks.length;
            if (uiAPI.setRunningTasks) uiAPI.setRunningTasks(runningTasks);
        },
        sessionManager,
        new Map(),
        runAgentSession,
        { executionCwd: executionContext.executionCwd },
    );

    if (spinnerInterval) clearInterval(spinnerInterval);

    if (executionResult.failedTasks.length > 0) {
        const retry = await askRetryFailedTasks(executionResult, uiAPI);
        if (retry) {
            localActiveTasks = 0;
            spinnerInterval = startTaskSpinner(uiAPI, () => localActiveTasks);
            const finalResult = await executeProjectTasks(
                planName,
                planBody,
                tasks,
                uiAPI,
                executionResult.failedTasks,
                (runningTasks) => {
                    localActiveTasks = runningTasks.length;
                    if (uiAPI.setRunningTasks) uiAPI.setRunningTasks(runningTasks);
                },
                sessionManager,
                executionResult.results,
                runAgentSession,
                { executionCwd: executionContext.executionCwd },
            );
            if (spinnerInterval) clearInterval(spinnerInterval);
            if (finalResult.failedTasks.length > 0) {
                await recordFailedProjectExecution(planName, triageMeta, finalResult.failedTasks, finalResult, uiAPI, {
                    afterRetry: true,
                });
                return {
                    repairRequired: false,
                    executionComplete: false,
                    failedTasks: finalResult.failedTasks,
                };
            }
            uiAPI.appendSystemMessage(`✅ All tasks eventually completed.`, false, "Harns");
        } else {
            await recordFailedProjectExecution(
                planName,
                triageMeta,
                executionResult.failedTasks,
                executionResult,
                uiAPI,
            );
            return {
                repairRequired: false,
                executionComplete: false,
                failedTasks: executionResult.failedTasks,
            };
        }
    } else {
        uiAPI.appendSystemMessage(`✅ All tasks completed successfully.`, false, "Harns");
    }

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
 * }} opts
 * @returns {Promise<PlanExecutionResult>}
 */
async function executeSingleEngineerPlan({ planName, planBody, triageMeta, uiAPI, sessionManager, currentStatus }) {
    const executionContext = await startActiveExecutionWorkflow(planName, triageMeta, currentStatus);
    const engineerResult = await runEngineerWithPlan(
        planName,
        planBody,
        uiAPI,
        sessionManager,
        executionContext.executionCwd,
    );
    if (!engineerResult.completed) {
        await recordPlanEvent({
            cwd: CWD,
            planName,
            event: "execution_failed",
            currentStatus: "in_progress",
            details: {
                triageMeta,
                failureReason: `${getAgentDisplayName(AGENTS.ENGINEER)} stopped without task_completed.`,
            },
        });
        await markActiveWorktreeStatus("execution_failed");
        return { repairRequired: false, executionComplete: false };
    }
    return { repairRequired: false, executionComplete: true };
}

/**
 * @param {UiAPI} uiAPI
 * @param {() => number} activeTaskCount
 * @returns {ReturnType<typeof setInterval> | undefined}
 */
function startTaskSpinner(uiAPI, activeTaskCount) {
    if (uiAPI.advanceSpinner && typeof setInterval !== "undefined") {
        return setInterval(() => {
            if (activeTaskCount() > 0 && uiAPI.advanceSpinner) uiAPI.advanceSpinner();
        }, 100);
    }
    return undefined;
}

/**
 * @param {string} planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} triageMeta
 * @param {number[]} failedTasks
 * @param {{ results: Map<number, { status: string, error?: string }> }} result
 * @param {UiAPI} uiAPI
 * @param {{ afterRetry?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function recordFailedProjectExecution(planName, triageMeta, failedTasks, result, uiAPI, options = {}) {
    reportExecutionSummary(result, uiAPI);
    await recordPlanEvent({
        cwd: CWD,
        planName,
        event: "execution_failed",
        currentStatus: "in_progress",
        details: {
            triageMeta,
            failureReason: `${options.afterRetry ? "Failed tasks after retry" : "Failed tasks"}: ${
                failedTasks.join(", ")
            }`,
        },
    });
    await markActiveWorktreeStatus("execution_failed");
}

/**
 * Run engineer against the full approved plan body.
 *
 * @param {string} planName
 * @param {string} planBody
 * @param {UiAPI} uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @param {string} [executionCwd]
 * @returns {Promise<{ completed: boolean, messages: import('@earendil-works/pi-agent-core').AgentMessage[] }>}
 */
async function runEngineerWithPlan(planName, planBody, uiAPI, sessionManager, executionCwd) {
    const messages = await runAgentSession({
        agentName: AGENTS.ENGINEER,
        userRequest: buildEngineerRequest(planName, planBody),
        uiAPI,
        sessionManager,
        cwd: executionCwd,
        useRootSession: true,
    });

    const completed = readLatestTaskCompletedOutcome(messages);
    if (!completed) {
        uiAPI.appendSystemMessage(
            `${
                getAgentDisplayName(AGENTS.ENGINEER)
            } stopped without task_completed; validation is waiting for a completion signal.`,
            false,
            "Harns",
        );
    }

    return { completed, messages };
}

/**
 * @param {string} planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} triageMeta
 * @param {import('./plan-lifecycle.js').PlanStatus} currentStatus
 * @returns {Promise<{ projectRoot: string, executionCwd: string, baselineTree: string, worktreeId: string, worktreeBranch: string }>}
 */
async function startActiveExecutionWorkflow(planName, triageMeta, currentStatus) {
    const existing = getActiveExecutionWorkflow();
    const reusable =
        existing?.planName === planName && existing.executionCwd && existing.worktreeId && existing.worktreeBranch
            ? {
                id: existing.worktreeId,
                path: existing.executionCwd,
                branch: existing.worktreeBranch,
            }
            : await findReusableWorktree({ projectRoot: CWD, planName });
    const worktree = reusable || await createExecutionWorktree({ projectRoot: CWD, planName, baseRef: "HEAD" });
    const baselineTree =
        existing?.planName === planName && existing.executionCwd === worktree.path && existing.baselineTree
            ? existing.baselineTree
            : await captureWorktreeTree(worktree.path);
    const workflow = {
        planName,
        triageMeta,
        baselineTree,
        projectRoot: CWD,
        executionCwd: worktree.path,
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
    };
    setActiveExecutionWorkflow(workflow);
    if (worktree.id) {
        await updateWorktreeRegistryEntry(CWD, worktree.id, { status: "active" });
    }
    await recordPlanEvent({
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
            worktreeStatus: "active",
        },
    });
    return workflow;
}

/** @param {import('../../plan-store.js').PlanFrontMatter['worktreeStatus']} status */
async function markActiveWorktreeStatus(status) {
    const workflow = getActiveExecutionWorkflow();
    if (!workflow?.worktreeId || !status || status === "none") return;
    await updateWorktreeRegistryEntry(workflow.projectRoot || CWD, workflow.worktreeId, { status });
}
