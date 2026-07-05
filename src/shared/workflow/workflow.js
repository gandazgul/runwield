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
    getActiveExecutionWorkflow,
    getRootAgentSession,
    setActiveExecutionWorkflow,
} from "../session/session-state.js";
import { createExecutionWorktree, findReusableWorktree, prepareTargetBranchRef } from "../worktree.js";
import { updateEntry as updateWorktreeRegistryEntry } from "../worktree-registry.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { isEpicPlan, isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";
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
 *   executeStructuredProjectPlan?: () => Promise<PlanExecutionResult>,
 *   executeSingleEngineerPlan?: typeof executeSingleEngineerPlan,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
 * }} [__deps]
 * @returns {Promise<PlanExecutionResult>}
 */
export async function executePlan(planName, triageMeta, uiAPI, structuredTasks, sessionManager, __deps = {}) {
    if (!uiAPI) throw new Error("executePlan: uiAPI is required");

    const loadPlanFn = __deps.loadPlan || loadPlan;
    void structuredTasks;
    const executeSingleEngineerPlanFn = __deps.executeSingleEngineerPlan || executeSingleEngineerPlan;
    const recordPlanEventFn = __deps.recordPlanEvent || recordPlanEvent;
    const markActiveWorktreeStatusFn = __deps.markActiveWorktreeStatus || markActiveWorktreeStatus;

    const plan = await loadPlanFn(CWD, planName);
    if (!plan) {
        uiAPI.appendSystemMessage(`ERROR: Could not load plan ${planName}`, true, "RunWield");
        return { repairRequired: false, executionComplete: false, error: `Could not load plan ${planName}` };
    }

    const effectiveMeta = { ...plan.attrs, ...(triageMeta || {}) };

    if (isEpicPlan(plan.attrs)) {
        const error = `Plan ${planName} is a PROJECT Epic container and cannot be executed directly.`;
        uiAPI.appendSystemMessage(`ERROR: ${error}`, true, "RunWield");
        return { repairRequired: false, executionComplete: false, error };
    }

    if (!isExecutablePlanStatus(plan.attrs.status)) {
        const error = `Plan ${planName} is not ready for work (status: ${plan.attrs.status}).`;
        uiAPI.appendSystemMessage(`ERROR: ${error}`, true, "RunWield");
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
    });
    if (!result.executionComplete) return result;

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
    await markActiveWorktreeStatusFn("completed");
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
 * @returns {Promise<{ completed: boolean, messages: import('@earendil-works/pi-agent-core').AgentMessage[], error?: string }>}
 */
async function runEngineerWithPlan(planName, planBody, uiAPI, sessionManager, executionCwd) {
    let messages;
    try {
        messages = await runAgentSession({
            agentName: AGENTS.ENGINEER,
            userRequest: buildEngineerRequest(planName, planBody),
            uiAPI,
            sessionManager,
            cwd: executionCwd,
            useRootSession: true,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const rootMessages = getRootAgentSession()?.agent?.state?.messages || [];
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
 * @param {string} planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} triageMeta
 * @param {import('./plan-lifecycle.js').PlanStatus} currentStatus
 * @returns {Promise<{ projectRoot: string, executionCwd: string, baselineTree: string, worktreeId: string, worktreeBranch: string, worktreeBaseBranch?: string }>}
 */
export async function startActiveExecutionWorkflow(planName, triageMeta, currentStatus) {
    const targetBranch = normalizeExecutionTargetBranch(triageMeta.worktreeBaseBranch);
    const existing = getActiveExecutionWorkflow();
    const reusable =
        existing?.planName === planName && existing.executionCwd && existing.worktreeId && existing.worktreeBranch
            ? {
                id: existing.worktreeId,
                path: existing.executionCwd,
                branch: existing.worktreeBranch,
                baseBranch: existing.worktreeBaseBranch,
            }
            : await findReusableWorktree({ projectRoot: CWD, planName });
    if (reusable) assertReusableWorktreeTargetMatches(reusable.baseBranch, targetBranch);
    const worktree = reusable || await createExecutionWorktree(
        targetBranch
            ? {
                projectRoot: CWD,
                planName,
                baseRef: await prepareTargetBranchRef(CWD, targetBranch),
                baseBranch: targetBranch,
            }
            : { projectRoot: CWD, planName, baseRef: "HEAD" },
    );
    const worktreeBaseBranch = worktree.baseBranch === "HEAD" ? undefined : worktree.baseBranch;
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
        worktreeBaseBranch,
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
            worktreeBaseBranch,
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
