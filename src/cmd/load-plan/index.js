/**
 * @module cmd/load-plan
 * Load-plan command implementation. Loads a saved plan from disk and continues
 * work on it (review/edit/execute), distinct from /resume which restores a
 * previous chat session.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { AGENTS, CLI_BIN, CWD } from "../../constants.js";
import {
    findPlansByParent as findPlansByParentFn,
    injectFrontMatter,
    loadPlan as loadPlanFn,
    resolvePlan as resolvePlanFn,
    resolveSiblingChildPlanDependencies as resolveSiblingChildPlanDependenciesFn,
    updatePlanFrontMatter as updatePlanFrontMatterFn,
} from "../../plan-store.js";
import {
    askApprovalWithTasks as askApprovalWithTasksFn,
    askPostApproval as askPostApprovalFn,
    ensureSlicerTasks as ensureSlicerTasksFn,
    executePlan as executePlanFn,
    runPlanningAgent as runPlanningAgentFn,
} from "../../shared/workflow/workflow.js";
import {
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
} from "../../shared/workflow/decisions.js";
import {
    isEpicPlan,
    isExecutablePlanStatus,
    recordPlanEvent as recordPlanEventFn,
} from "../../shared/workflow/plan-lifecycle.js";
import {
    getWorkflowDiff as getWorkflowDiffFn,
    listCommitsTouchingPathsSince as listCommitsTouchingPathsSinceFn,
    restoreWorktreeTree as restoreWorktreeTreeFn,
} from "../../shared/workflow/git-snapshot.js";
import {
    createExecutionWorktree as createExecutionWorktreeFn,
    getWorktreeStatus as getWorktreeStatusFn,
    mergeExecutionWorktree as mergeExecutionWorktreeFn,
    removeExecutionWorktree as removeExecutionWorktreeFn,
} from "../../shared/worktree.js";
import {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
    removeEntry as removeWorktreeRegistryEntryFn,
    updateEntry as updateWorktreeRegistryEntryFn,
} from "../../shared/worktree-registry.js";
import { runValidationLoop as runValidationLoopFn } from "../../shared/workflow/validation.js";
import { runSlicerAgent as runSlicerAgentFn } from "../../shared/workflow/workflow-slicer.js";
import { submitPlanForReview as submitPlanForReviewFn } from "../../shared/workflow/submit-plan.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import {
    setActiveAgent as setActiveAgentFn,
    startInteractiveSession as startInteractiveSessionFn,
} from "../../shared/interactive/chat-session.js";
import {
    getRootAgentName as getRootAgentNameFn,
    setActiveExecutionWorkflow,
} from "../../shared/session/session-state.js";
import { shouldCleanupMergedWorktrees as shouldCleanupMergedWorktreesFn } from "../../shared/settings.js";
import { resetTuiState as resetTuiStateFn } from "../command-helpers.js";
import { createDirectAgentHandler as createDirectAgentHandlerFn } from "../../shared/session/direct-agent.js";
export { getLoadPlanCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef LoadPlanTestDeps
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof resolvePlanFn} [resolvePlan]
 * @property {typeof executePlanFn} [executePlan]
 * @property {typeof runPlanningAgentFn} [runPlanningAgent]
 * @property {typeof decidePostPlanningFn} [decidePostPlanning]
 * @property {typeof decidePostExecutionFn} [decidePostExecution]
 * @property {typeof submitPlanForReviewFn} [submitPlanForReview]
 * @property {typeof askPostApprovalFn} [askPostApproval]
 * @property {typeof askApprovalWithTasksFn} [askApprovalWithTasks]
 * @property {typeof ensureSlicerTasksFn} [ensureSlicerTasks]
 * @property {typeof runValidationLoopFn} [runValidationLoop]
 * @property {typeof runSlicerAgentFn} [runSlicerAgent]
 * @property {typeof loadPlanFn} [loadPlan]
 * @property {typeof getWorkflowDiffFn} [getWorkflowDiff]
 * @property {typeof listCommitsTouchingPathsSinceFn} [listCommitsTouchingPathsSince]
 * @property {typeof restoreWorktreeTreeFn} [restoreWorktreeTree]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof createDirectAgentHandlerFn} [createDirectAgentHandler]
 * @property {typeof resetTuiStateFn} [resetTuiState]
 * @property {typeof getRootAgentNameFn} [getRootAgentName]
 * @property {(cwd: string) => Promise<Array<{name: string, attrs: {classification: string, status: string}}>>} [listPlans]
 * @property {typeof findPlansByParentFn} [findPlansByParent]
 * @property {typeof resolveSiblingChildPlanDependenciesFn} [resolveSiblingChildPlanDependencies]
 * @property {typeof recordPlanEventFn} [recordPlanEvent]
 * @property {typeof updatePlanFrontMatterFn} [updatePlanFrontMatter]
 * @property {typeof findWorktreeByIdFn} [findWorktreeById]
 * @property {typeof findWorktreeByPlanNameFn} [findWorktreeByPlanName]
 * @property {typeof updateWorktreeRegistryEntryFn} [updateWorktreeRegistryEntry]
 * @property {typeof getWorktreeStatusFn} [getWorktreeStatus]
 * @property {typeof createExecutionWorktreeFn} [createExecutionWorktree]
 * @property {typeof mergeExecutionWorktreeFn} [mergeExecutionWorktree]
 * @property {typeof removeExecutionWorktreeFn} [removeExecutionWorktree]
 * @property {typeof removeWorktreeRegistryEntryFn} [removeWorktreeRegistryEntry]
 * @property {typeof shouldCleanupMergedWorktreesFn} [shouldCleanupMergedWorktrees]
 */

/**
 * Restore the agent that owned the session before load-plan command work.
 *
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {string} agentName
 * @param {LoadPlanTestDeps} [deps]
 */
function restorePreviousAgentFlow(uiAPI, agentName, deps = {}) {
    const {
        resetTuiState: resetTuiStateDep,
        setActiveAgent: setActiveAgentDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
    } = deps;

    const resetTuiState = resetTuiStateDep || resetTuiStateFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;

    resetTuiState(undefined, uiAPI, undefined);
    setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);
}

/**
 * Extract a markdown section by its `## <name>` heading. Returns the body up to
 * (but not including) the next `## ` heading, or null if not found.
 *
 * @param {string} body
 * @param {string} name
 * @returns {string | null}
 */
function extractSection(body, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const match = body.match(re);
    return match ? match[2].trim() : null;
}

/**
 * Remove the `## Tasks` section (and any following `### Slice Details` block,
 * including `#### Task N` sub-blocks) from a plan body. Strips up to the next
 * `##` heading or end of file. Returns the body unchanged if no Tasks heading
 * is present.
 *
 * @param {string} body
 * @returns {string}
 */
export function stripTasksSection(body) {
    const re = /(^|\n)##\s+Tasks\s*\n[\s\S]*?(?=\n##\s|$)/i;
    if (!re.test(body)) return body;
    const stripped = body.replace(re, "$1").replace(/\n{3,}/g, "\n\n").trimEnd();
    return stripped + "\n";
}

/**
 * Strip the Tasks + Slice Details blocks from a plan file in-place and write
 * the result back. Used when the user re-opens an approved/completed plan for
 * review — slicer output must be discarded so the architect → slicer flow can
 * regenerate tasks against any revised design.
 *
 * @param {{ path: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @returns {Promise<void>}
 */
async function stripTasksFromPlanFile(plan) {
    const stripped = stripTasksSection(plan.body);
    if (stripped === plan.body) return;
    plan.body = stripped;
    const withFm = injectFrontMatter(stripped, plan.attrs);
    await Deno.writeTextFile(plan.path, withFm);
}

/**
 * Build a compact summary view of a plan: front matter highlights plus the
 * Context and Objective sections (when present).
 *
 * @param {{ attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown: string }} plan
 * @returns {string}
 */
function buildPlanSummary(plan) {
    const a = plan.attrs;
    const lines = [
        `Classification: ${a.classification}`,
        `Complexity:     ${a.complexity}`,
        `Status:         ${a.status}`,
        `Summary:        ${a.summary || "(none)"}`,
    ];
    if (a.affectedPaths?.length) {
        lines.push(`Affected paths:`);
        for (const p of a.affectedPaths) lines.push(`  - ${p}`);
    }

    const sections = [];
    const context = extractSection(plan.body, "Context");
    if (context) sections.push(`── Context ──\n${context}`);
    const objective = extractSection(plan.body, "Objective");
    if (objective) sections.push(`── Objective ──\n${objective}`);

    return [lines.join("\n"), ...sections].join("\n\n");
}

/**
 * Build the resume request handed to the planning agent.
 *
 * @param {string} planName
 * @param {{ classification: string, complexity: string, summary: string, affectedPaths?: string[], status: string }} attrs
 * @returns {string}
 */
function buildResumeRequest(planName, attrs) {
    return [
        `## Resuming Plan: ${planName}`,
        "",
        `This plan was previously saved with status: ${attrs.status}.`,
        `Continue working on it. The plan is at plans/${planName}.md.`,
        "",
        "## Triage Report",
        `- Classification: ${attrs.classification}`,
        `- Complexity: ${attrs.complexity}`,
        `- Summary: ${attrs.summary}`,
        `- Affected paths: ${(attrs.affectedPaths || []).join(", ")}`,
        "",
        "Review the current plan, make any needed updates, and finalize it.",
        "If requirements are unclear, ask clarification questions via user_interview before locking changes.",
        "When the plan is ready, call plan_written to submit it for review.",
    ].join("\n");
}

/**
 * Build the prompt that re-runs the planner after the user submits feedback on a
 * previously approved plan that was re-opened for review.
 *
 * @param {string} planName
 * @param {string | undefined} feedback
 * @returns {string}
 */
function buildReReviewRevisionRequest(planName, feedback) {
    return [
        `## Plan Review Re-opened: ${planName}`,
        "",
        "The user provided feedback on the previously approved plan:",
        "",
        feedback || "(no specific feedback provided)",
        "",
        `Revise plans/${planName}.md based on this feedback using the edit tool.`,
        "Then call plan_written again to submit the revision for review.",
    ].join("\n");
}

/**
 * @param {Array<{hash: string, date: string, subject: string}>} commits
 * @returns {string[]}
 */
function formatCommitHeadsUp(commits) {
    const maxVisible = 12;
    const visible = commits.slice(0, maxVisible).map((commit) =>
        `  - ${commit.hash} ${commit.date} ${commit.subject}`.trimEnd()
    );
    if (commits.length > maxVisible) {
        visible.push(`  - ...and ${commits.length - maxVisible} more`);
    }
    return visible;
}

/**
 * Warn when affected paths have changed after the plan timestamp, and confirm
 * before execution starts.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @returns {Promise<boolean>}
 */
async function confirmAffectedPathChangesBeforeExecution({
    planName,
    triageMeta,
    uiAPI,
    listCommitsTouchingPathsSince,
}) {
    const affectedPaths = Array.isArray(triageMeta.affectedPaths) ? triageMeta.affectedPaths : [];
    const timestamp = triageMeta.updatedAt || triageMeta.createdAt;
    if (!timestamp || affectedPaths.length === 0) return true;

    let commits = [];
    try {
        commits = await listCommitsTouchingPathsSince(CWD, timestamp, affectedPaths);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(
            `Could not check affected path history before execution: ${message}`,
            true,
            "Harns",
        );
        return true;
    }

    if (commits.length === 0) return true;

    const timestampLabel = triageMeta.updatedAt ? "updatedAt" : "createdAt";
    uiAPI.appendSystemMessage(
        [
            `Heads up: ${commits.length} commit(s) touched affected paths since this plan's ${timestampLabel} (${timestamp}).`,
            "",
            "Affected paths:",
            ...affectedPaths.map((path) => `  - ${path}`),
            "",
            "Commits:",
            ...formatCommitHeadsUp(commits),
        ].join("\n"),
        true,
        "Harns",
    );

    const answer = await uiAPI.promptSelect(`Proceed with execution for "${planName}" anyway?`, [
        { value: "proceed", label: "Proceed with execution" },
        { value: "cancel", label: "Cancel" },
    ]);
    if (answer === "proceed") return true;
    uiAPI.appendSystemMessage("Execution canceled.", false, "Harns");
    return false;
}

/**
 * @param {unknown} executionResult
 * @param {string} planName
 * @param {string} fallbackPlanContent
 * @param {import('../../plan-store.js').PlanFrontMatter} triageMeta
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof runValidationLoopFn} runValidationLoop
 * @param {typeof loadPlanFn} loadPlan
 * @param {RecoveryWorktreeContext | null} [worktreeContext]
 */
async function validateCompletedExecution(
    executionResult,
    planName,
    fallbackPlanContent,
    triageMeta,
    uiAPI,
    runValidationLoop,
    loadPlan,
    worktreeContext,
) {
    if (!(executionResult && typeof executionResult === "object" && "executionComplete" in executionResult)) return;
    if (!/** @type {{ executionComplete?: boolean }} */ (executionResult).executionComplete) return;
    let planContent = fallbackPlanContent;
    try {
        const latestPlan = await loadPlan(CWD, planName);
        planContent = latestPlan?.markdown || latestPlan?.body || fallbackPlanContent;
    } catch {
        // Keep fallback content in tests or if the plan was removed.
    }
    if (triageMeta.executionBaselineTree) {
        /** @type {{ planName: string, triageMeta: import('../../plan-store.js').PlanFrontMatter, baselineTree: string, projectRoot?: string, executionCwd?: string, worktreeId?: string, worktreeBranch?: string }} */
        const workflow = {
            planName,
            triageMeta,
            baselineTree: triageMeta.executionBaselineTree,
        };
        const executionCwd = worktreeContext?.path || triageMeta.worktreePath;
        const worktreeId = worktreeContext?.id || triageMeta.worktreeId;
        const worktreeBranch = worktreeContext?.branch || triageMeta.worktreeBranch;
        if (executionCwd || worktreeId || worktreeBranch) workflow.projectRoot = CWD;
        if (executionCwd) workflow.executionCwd = executionCwd;
        if (worktreeId) workflow.worktreeId = worktreeId;
        if (worktreeBranch) workflow.worktreeBranch = worktreeBranch;
        setActiveExecutionWorkflow(workflow);
    }
    await runValidationLoop({
        planName,
        planContent,
        triageMeta,
        uiAPI,
        sessionManager: undefined,
    });
}

/**
 * @param {Object} opts
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} opts.executionDecision
 * @param {string} opts.fallbackPlanContent
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @returns {Promise<void>}
 */
async function validatePostExecutionDecision({
    executionDecision,
    fallbackPlanContent,
    uiAPI,
    runValidationLoop,
    loadPlan,
}) {
    if (executionDecision.kind !== "run_validation") return;

    const planName = /** @type {string} */ (executionDecision.payload.planName);
    const triageMeta = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (
        executionDecision.payload.triageMeta
    );

    await validateCompletedExecution(
        { executionComplete: true },
        planName,
        fallbackPlanContent,
        triageMeta,
        uiAPI,
        runValidationLoop,
        loadPlan,
    );
}

/**
 * Execute an approved post-planning decision and run validation when execution
 * completes. Returns true when the decision was handled as execution.
 *
 * @param {Object} opts
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} opts.decision
 * @param {string} opts.fallbackPlanContent
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof executePlanFn} opts.executePlan
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @returns {Promise<boolean>}
 */
async function executePostPlanningDecision({
    decision,
    fallbackPlanContent,
    uiAPI,
    executePlan,
    decidePostExecution,
    runValidationLoop,
    loadPlan,
    listCommitsTouchingPathsSince,
}) {
    if (decision.kind !== "execute_plan") return false;

    const planName = /** @type {string} */ (decision.payload.planName);
    const triageMeta = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (decision.payload.triageMeta);
    const tasks = /** @type {import('../../shared/workflow/workflow.js').PlanOutcomeResult["tasks"]} */ (
        decision.payload.tasks
    );

    const confirmed = await confirmAffectedPathChangesBeforeExecution({
        planName,
        triageMeta,
        uiAPI,
        listCommitsTouchingPathsSince,
    });
    if (!confirmed) return true;

    const execRes = await executePlan(planName, triageMeta, uiAPI, tasks);
    const executionDecision = decidePostExecution(execRes, {
        planName,
        triageMeta,
        executionAgentName: AGENTS.ENGINEER,
    });
    await validatePostExecutionDecision({
        executionDecision,
        fallbackPlanContent,
        uiAPI,
        runValidationLoop,
        loadPlan,
    });
    return true;
}

/**
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} decision
 * @returns {boolean}
 */
function shouldKeepPlanningAgentActive(decision) {
    return decision.kind === "stay_with_agent" || decision.kind === "halt";
}

/**
 * Run the Readiness Gate for an approved Plan.
 *
 * @param {{ planName: string, path: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof ensureSlicerTasksFn} ensureSlicerTasks
 * @param {typeof recordPlanEventFn} recordPlanEvent
 * @returns {Promise<boolean>}
 */
async function prepareApprovedPlanForWork(plan, uiAPI, ensureSlicerTasks, recordPlanEvent) {
    if (isEpicPlan(plan.attrs)) {
        await recordPlanEvent({
            cwd: CWD,
            planName: plan.planName,
            event: "epic_readiness_passed",
            currentStatus: "approved",
            details: { triageMeta: plan.attrs },
        });
        plan.attrs.status = "ready_for_decomposition";
        uiAPI.appendSystemMessage(
            `PROJECT Epic ready for decomposition or child plan selection: ${plan.planName}`,
            false,
            "Harns",
        );
        return false;
    }

    if (plan.attrs.classification === "PROJECT") {
        const sliceResult = await ensureSlicerTasks({
            planName: plan.planName,
            planPath: plan.path,
            triageMeta: plan.attrs,
            uiAPI,
        });
        if (!sliceResult.ok) {
            uiAPI.appendSystemMessage(
                `Readiness Gate failed before execution: ${sliceResult.error}`,
                true,
                "Harns",
            );
            return false;
        }
    }

    await recordPlanEvent({
        cwd: CWD,
        planName: plan.planName,
        event: "readiness_passed",
        currentStatus: "approved",
        details: { triageMeta: plan.attrs },
    });
    plan.attrs.status = "ready_for_work";
    return true;
}

/**
 * Execute a ready Plan and run validation if execution completes.
 *
 * @param {Object} opts
 * @param {{ planName: string, markdown?: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof executePlanFn} opts.executePlan
 * @param {typeof runPlanningAgentFn} opts.runPlanningAgent
 * @param {typeof decidePostPlanningFn} opts.decidePostPlanning
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof setActiveAgentFn} opts.setActiveAgent
 * @param {typeof createDirectAgentHandlerFn} opts.createDirectAgentHandler
 * @returns {Promise<void>}
 */
async function executeReadyPlanWithRepair({
    plan,
    agentName,
    uiAPI,
    executePlan,
    runPlanningAgent,
    decidePostPlanning,
    decidePostExecution,
    runValidationLoop,
    loadPlan,
    listCommitsTouchingPathsSince,
    setActiveAgent,
    createDirectAgentHandler,
}) {
    const MAX_REPAIR_ATTEMPTS = 2;
    let currentPlanName = plan.planName;
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    let currentMeta = plan.attrs;
    /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }> | undefined} */
    let currentTasks = undefined;

    const confirmed = await confirmAffectedPathChangesBeforeExecution({
        planName: currentPlanName,
        triageMeta: currentMeta,
        uiAPI,
        listCommitsTouchingPathsSince,
    });
    if (!confirmed) return;

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
        const execRes = await executePlan(currentPlanName, currentMeta, uiAPI, currentTasks);
        const executionDecision = decidePostExecution(execRes, {
            planName: currentPlanName,
            triageMeta: /** @type {import('../../tools/plan-written.js').TriageMeta} */ (currentMeta),
            executionAgentName: agentName,
        });
        if (executionDecision.kind !== "repair_plan") {
            await validatePostExecutionDecision({
                executionDecision,
                fallbackPlanContent: plan.markdown || plan.body || "",
                uiAPI,
                runValidationLoop,
                loadPlan,
            });
            break;
        }

        if (attempt === MAX_REPAIR_ATTEMPTS) {
            uiAPI.appendSystemMessage(
                `Execution failed after ${MAX_REPAIR_ATTEMPTS} repair attempts. Aborting.`,
                true,
                "Harns",
            );
            break;
        }

        uiAPI.appendSystemMessage(
            `Execution failed due to task table error. Rerouting to ${agentName} for repair (attempt ${
                attempt + 1
            }/${MAX_REPAIR_ATTEMPTS})...`,
            false,
            "Harns",
        );
        setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);
        const repairOutcome = await runPlanningAgent({
            agentName,
            initialRequest: [
                `## Plan Execution Halted — Task Table Repair Required`,
                "",
                `The plan "${currentPlanName}" had a malformed Tasks table: ${
                    String(executionDecision.payload.error || "Unknown task table error")
                }.`,
                "",
                "Fix the markdown Tasks table to follow:",
                "",
                "| Task | Assignee | Dependencies | Write Scope | Description |",
                "",
                "Use numeric task IDs, valid assignees, numeric dependency IDs or `none`, narrow repo-relative write scopes, and a final tester Integration Point that depends on every prior task.",
                "Then call plan_written again with the plan name.",
            ].join("\n"),
            triageMeta: currentMeta,
            uiAPI,
        });
        const repairDecision = decidePostPlanning(repairOutcome, {
            planningAgentName: agentName,
            fallbackTriageMeta: currentMeta,
        });
        if (repairDecision.kind !== "execute_plan") {
            uiAPI.appendSystemMessage(
                "Repair did not produce an approved plan. Aborting.",
                false,
                "Harns",
            );
            break;
        }
        currentPlanName = /** @type {string} */ (repairDecision.payload.planName);
        currentMeta = /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */ (
            repairDecision.payload.triageMeta || currentMeta
        );
        currentTasks =
            /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }> | undefined} */ (
                repairDecision.payload.tasks
            );
    }
}

/**
 * @typedef {Object} RecoveryWorktreeContext
 * @property {string} [id]
 * @property {string} [path]
 * @property {string} [branch]
 * @property {string} [status]
 * @property {string} [baseRef]
 * @property {string} [baseCommit]
 * @property {string} [baseTree]
 */

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {Object} deps
 * @param {typeof findWorktreeByIdFn} deps.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} deps.findWorktreeByPlanName
 * @returns {Promise<RecoveryWorktreeContext | null>}
 */
async function resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName }) {
    let entry = null;
    if (plan.attrs.worktreeId) entry = await findWorktreeById(CWD, plan.attrs.worktreeId);
    if (!entry) entry = await findWorktreeByPlanName(CWD, plan.planName);
    const path = plan.attrs.worktreePath || entry?.path;
    const branch = plan.attrs.worktreeBranch || entry?.branch;
    const id = plan.attrs.worktreeId || entry?.id;
    if (!path && !branch && !id) return null;
    return {
        id,
        path,
        branch,
        status: plan.attrs.worktreeStatus || entry?.status,
        baseRef: entry?.baseRef,
        baseCommit: entry?.baseCommit,
        baseTree: entry?.baseTree,
    };
}

/**
 * @param {RecoveryWorktreeContext | null} context
 * @returns {boolean}
 */
function hasWorktreeContext(context) {
    return Boolean(context?.path || context?.branch || context?.id);
}

/**
 * Manual merge recovery is only safe after Workflow Validation has already
 * passed and the automatic merge-back failed.
 *
 * @param {RecoveryWorktreeContext | null} context
 * @returns {boolean}
 */
function canManuallyMergeRecoveredWorktree(context) {
    return context?.status === "merge_conflict";
}

/**
 * @param {RecoveryWorktreeContext | null} context
 * @returns {string | null}
 */
function getRecordedWorktreeRecreateBase(context) {
    return context?.baseCommit || context?.baseRef || null;
}

/** @param {string | undefined} path */
async function pathExists(path) {
    if (!path) return false;
    try {
        const stat = await Deno.stat(path);
        return stat.isDirectory;
    } catch {
        return false;
    }
}

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {RecoveryWorktreeContext | null} context
 */
function rehydrateActiveRecoveryWorkflow(plan, context) {
    const baselineTree = plan.attrs.executionBaselineTree || context?.baseTree;
    if (!baselineTree && !hasWorktreeContext(context)) return;
    /** @type {{ planName: string, triageMeta: import('../../plan-store.js').PlanFrontMatter, baselineTree?: string, projectRoot: string, executionCwd?: string, worktreeId?: string, worktreeBranch?: string }} */
    const workflow = {
        planName: plan.planName,
        triageMeta: plan.attrs,
        baselineTree,
        projectRoot: CWD,
    };
    if (context?.path) workflow.executionCwd = context.path;
    if (context?.id) workflow.worktreeId = context.id;
    if (context?.branch) workflow.worktreeBranch = context.branch;
    setActiveExecutionWorkflow(workflow);
}

/**
 * Append recovery context for a partially executed Plan.
 *
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown: string }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof getWorkflowDiffFn} getWorkflowDiff
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {typeof getWorktreeStatusFn} getWorktreeStatus
 * @returns {Promise<void>}
 */
async function appendRecoveryReport(plan, uiAPI, getWorkflowDiff, worktreeContext, getWorktreeStatus) {
    const lines = [buildPlanSummary(plan)];
    if (plan.attrs.failureReason) {
        lines.push(`Failure reason:\n${plan.attrs.failureReason}`);
    }
    if (hasWorktreeContext(worktreeContext)) {
        lines.push(
            [
                `Worktree status: ${worktreeContext?.status || "unknown"}`,
                `Worktree path:   ${worktreeContext?.path || "(unknown)"}`,
                `Worktree branch: ${worktreeContext?.branch || "(unknown)"}`,
                `Worktree base:   ${worktreeContext?.baseCommit || worktreeContext?.baseRef || "(unknown)"}`,
            ].join("\n"),
        );
        if (worktreeContext?.path) {
            try {
                const status = await getWorktreeStatus({
                    projectRoot: CWD,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    baseTree: plan.attrs.executionBaselineTree || undefined,
                });
                lines.push(
                    status.exists
                        ? `Git status:\n${status.statusText.trim() || "clean"}`
                        : "Git status: missing worktree path",
                );
                lines.push(
                    status.diff?.trim()
                        ? `Changes since execution baseline:\n${status.diff}`
                        : "No changes since baseline.",
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                lines.push(`Could not inspect worktree: ${message}`);
            }
        }
    } else if (plan.attrs.executionBaselineTree) {
        lines.push(`Execution baseline tree: ${plan.attrs.executionBaselineTree}`);
        try {
            const diff = await getWorkflowDiff(CWD, plan.attrs.executionBaselineTree);
            lines.push(diff.trim() ? `Changes since execution baseline:\n${diff}` : "No changes since baseline.");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            lines.push(`Could not compute baseline diff: ${message}`);
        }
    } else {
        lines.push("No execution baseline tree is recorded for this plan.");
    }
    uiAPI.appendSystemMessage(lines.join("\n\n"), false, "Plan Recovery");
}

/**
 * Ask for destructive baseline reset confirmation.
 *
 * @param {string} planName
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
async function confirmBaselineReset(planName, uiAPI) {
    const answer = await uiAPI.promptSelect(
        `Reset "${planName}" to its execution-start snapshot? Changes made after that snapshot, including unrelated changes, will be lost.`,
        [
            { value: "reset", label: "Yes, reset and start over" },
            { value: "cancel", label: "Cancel" },
        ],
    );
    return answer === "reset";
}

/**
 * @param {string} planName
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {string} action
 * @returns {Promise<boolean>}
 */
async function confirmWorktreeAction(planName, uiAPI, action) {
    const answer = await uiAPI.promptSelect(`${action} worktree for "${planName}"?`, [
        { value: "confirm", label: `Yes, ${action.toLowerCase()} worktree` },
        { value: "cancel", label: "Cancel" },
    ]);
    return answer === "confirm";
}

/**
 * @param {string} planName
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof getWorktreeStatusFn} getWorktreeStatus
 * @returns {Promise<boolean>}
 */
async function confirmRecoveryWorktreeAvailable(planName, worktreeContext, uiAPI, getWorktreeStatus) {
    if (!hasWorktreeContext(worktreeContext)) return true;
    if (worktreeContext?.status === "abandoned") {
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because the recorded worktree is abandoned. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "Harns",
        );
        return false;
    }
    if (!worktreeContext?.path) {
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because no worktree path is recorded. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "Harns",
        );
        return false;
    }
    if (!(await pathExists(worktreeContext.path))) {
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because the recorded worktree path is missing or stale: ${worktreeContext.path}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "Harns",
        );
        return false;
    }
    try {
        const status = await getWorktreeStatus({
            projectRoot: CWD,
            path: worktreeContext.path,
            branch: worktreeContext.branch,
            baseTree: worktreeContext.baseTree,
        });
        if (!status.exists) {
            uiAPI.appendSystemMessage(
                `Cannot continue recovery for "${planName}" because the recorded worktree is missing or stale: ${worktreeContext.path}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
                true,
                "Harns",
            );
            return false;
        }
        if (worktreeContext.branch && status.branch && status.branch !== worktreeContext.branch) {
            uiAPI.appendSystemMessage(
                `Cannot continue recovery for "${planName}" because the recorded worktree branch is stale: expected ${worktreeContext.branch}, found ${status.branch}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
                true,
                "Harns",
            );
            return false;
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because the recorded worktree could not be inspected: ${reason}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "Harns",
        );
        return false;
    }
    return true;
}

/**
 * Handle Plan Recovery menus for in-progress, failed, and implemented plans.
 *
 * @param {Object} opts
 * @param {{ planName: string, path: string, markdown: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof executePlanFn} opts.executePlan
 * @param {typeof runPlanningAgentFn} opts.runPlanningAgent
 * @param {typeof decidePostPlanningFn} opts.decidePostPlanning
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof getWorkflowDiffFn} opts.getWorkflowDiff
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof restoreWorktreeTreeFn} opts.restoreWorktreeTree
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof updatePlanFrontMatterFn} opts.updatePlanFrontMatter
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof createExecutionWorktreeFn} opts.createExecutionWorktree
 * @param {typeof mergeExecutionWorktreeFn} opts.mergeExecutionWorktree
 * @param {typeof removeExecutionWorktreeFn} opts.removeExecutionWorktree
 * @param {typeof removeWorktreeRegistryEntryFn} opts.removeWorktreeRegistryEntry
 * @param {typeof shouldCleanupMergedWorktreesFn} opts.shouldCleanupMergedWorktrees
 * @param {typeof setActiveAgentFn} opts.setActiveAgent
 * @param {typeof createDirectAgentHandlerFn} opts.createDirectAgentHandler
 * @returns {Promise<"handled" | "review">}
 */
async function handlePlanRecovery({
    plan,
    agentName,
    uiAPI,
    executePlan,
    runPlanningAgent,
    decidePostPlanning,
    decidePostExecution,
    runValidationLoop,
    loadPlan,
    getWorkflowDiff,
    listCommitsTouchingPathsSince,
    restoreWorktreeTree,
    recordPlanEvent,
    updatePlanFrontMatter,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    getWorktreeStatus,
    createExecutionWorktree,
    mergeExecutionWorktree,
    removeExecutionWorktree,
    removeWorktreeRegistryEntry,
    shouldCleanupMergedWorktrees,
    setActiveAgent,
    createDirectAgentHandler,
}) {
    let worktreeContext = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });
    while (true) {
        const hasWorktree = hasWorktreeContext(worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(worktreeContext);
        const options = plan.attrs.status === "implemented"
            ? [
                { value: "validate", label: "Retry Workflow Validation" },
                { value: "inspect", label: "Inspect and report current state" },
                ...(canMergeWorktree ? [{ value: "merge", label: "Merge validated worktree changes" }] : []),
                {
                    value: "reset",
                    label: hasWorktree ? "Delete/recreate worktree and start over" : "Reset tree and start over",
                },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                { value: "cancel", label: "Cancel" },
            ]
            : [
                { value: "inspect", label: "Inspect and report current state" },
                { value: "continue", label: "Continue execution from current worktree" },
                {
                    value: "reset",
                    label: hasWorktree ? "Delete/recreate worktree and start over" : "Reset tree and start over",
                },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                { value: "cancel", label: "Cancel" },
            ];

        const answer = await uiAPI.promptSelect(`Plan recovery (${plan.attrs.status}):`, options);
        if (!answer || answer === "cancel") return "handled";

        if (answer === "inspect") {
            worktreeContext = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });
            await appendRecoveryReport(plan, uiAPI, getWorkflowDiff, worktreeContext, getWorktreeStatus);
            continue;
        }

        if (answer === "validate") {
            worktreeContext = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });
            if (!(await confirmRecoveryWorktreeAvailable(plan.planName, worktreeContext, uiAPI, getWorktreeStatus))) {
                continue;
            }
            rehydrateActiveRecoveryWorkflow(plan, worktreeContext);
            await validateCompletedExecution(
                { executionComplete: true },
                plan.planName,
                plan.markdown || plan.body || "",
                plan.attrs,
                uiAPI,
                runValidationLoop,
                loadPlan,
                worktreeContext,
            );
            return "handled";
        }

        if (answer === "continue") {
            worktreeContext = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });
            if (!(await confirmRecoveryWorktreeAvailable(plan.planName, worktreeContext, uiAPI, getWorktreeStatus))) {
                continue;
            }
            rehydrateActiveRecoveryWorkflow(plan, worktreeContext);
            await recordPlanEvent({
                cwd: CWD,
                planName: plan.planName,
                event: "recovery_continue",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "ready_for_work";
            await executeReadyPlanWithRepair({
                plan,
                agentName,
                uiAPI,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                listCommitsTouchingPathsSince,
                setActiveAgent,
                createDirectAgentHandler,
            });
            return "handled";
        }

        if (answer === "reset") {
            const hasWorktree = hasWorktreeContext(worktreeContext);
            if (!hasWorktree && !plan.attrs.executionBaselineTree) {
                uiAPI.appendSystemMessage(
                    "Cannot reset this plan because no execution baseline tree is recorded.",
                    true,
                    "Harns",
                );
                continue;
            }
            if (hasWorktree) {
                const recreateBaseRef = getRecordedWorktreeRecreateBase(worktreeContext);
                if (!recreateBaseRef) {
                    uiAPI.appendSystemMessage(
                        "Cannot recreate this worktree because no recorded base commit or base ref is available. Retry Workflow Validation or re-open the plan for review instead of recreating from the primary checkout.",
                        true,
                        "Harns",
                    );
                    continue;
                }
                if (!(await confirmWorktreeAction(plan.planName, uiAPI, "Delete/recreate"))) continue;
                if (worktreeContext?.path) {
                    await removeExecutionWorktree({
                        projectRoot: CWD,
                        path: worktreeContext.path,
                        branch: worktreeContext.branch,
                        force: true,
                    });
                }
                if (worktreeContext?.id) {
                    await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "abandoned" });
                }
                const recreated = await createExecutionWorktree({
                    projectRoot: CWD,
                    planName: plan.planName,
                    baseRef: recreateBaseRef,
                });
                plan.attrs = await updatePlanFrontMatter(CWD, plan.planName, {
                    worktreeId: recreated.id,
                    worktreePath: recreated.path,
                    worktreeBranch: recreated.branch,
                    worktreeStatus: "active",
                    executionBaselineTree: recreated.baseTree,
                }, plan.attrs);
                worktreeContext = {
                    id: recreated.id,
                    path: recreated.path,
                    branch: recreated.branch,
                    status: recreated.status,
                    baseRef: recreated.baseRef,
                    baseCommit: recreated.baseCommit,
                    baseTree: recreated.baseTree,
                };
            } else {
                if (!(await confirmBaselineReset(plan.planName, uiAPI))) continue;
                await restoreWorktreeTree(CWD, /** @type {string} */ (plan.attrs.executionBaselineTree));
            }
            await recordPlanEvent({
                cwd: CWD,
                planName: plan.planName,
                event: "recovery_reset",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "ready_for_work";
            await executeReadyPlanWithRepair({
                plan,
                agentName,
                uiAPI,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                listCommitsTouchingPathsSince,
                setActiveAgent,
                createDirectAgentHandler,
            });
            return "handled";
        }

        if (answer === "merge") {
            worktreeContext = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });
            if (!canManuallyMergeRecoveredWorktree(worktreeContext)) {
                uiAPI.appendSystemMessage(
                    "Manual worktree merge is only available after Workflow Validation passed but merge-back failed. Retry Workflow Validation first.",
                    true,
                    "Harns",
                );
                continue;
            }
            if (!(await confirmRecoveryWorktreeAvailable(plan.planName, worktreeContext, uiAPI, getWorktreeStatus))) {
                continue;
            }
            if (!worktreeContext?.branch) {
                uiAPI.appendSystemMessage("Cannot merge because no worktree branch is recorded.", true, "Harns");
                continue;
            }
            try {
                const cleanupMergedWorktrees = shouldCleanupMergedWorktrees();
                uiAPI.appendSystemMessage(`Merging worktree branch ${worktreeContext.branch} into primary checkout.`);
                await mergeExecutionWorktree({
                    projectRoot: CWD,
                    branch: worktreeContext.branch,
                    worktreePath: worktreeContext.path,
                    allowedDirtyPaths: [
                        `plans/${plan.planName}.md`,
                        ".hns/",
                        ".hns/worktrees.json",
                        ".hns/worktrees.lock",
                    ],
                });
                if (worktreeContext.id) {
                    await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "merged" });
                }
                if (cleanupMergedWorktrees && worktreeContext.path) {
                    try {
                        await removeExecutionWorktree({
                            projectRoot: CWD,
                            path: worktreeContext.path,
                            branch: worktreeContext.branch,
                            force: true,
                        });
                        if (worktreeContext.id) {
                            await removeWorktreeRegistryEntry(CWD, worktreeContext.id);
                        }
                    } catch (cleanupError) {
                        const cleanupReason = cleanupError instanceof Error
                            ? cleanupError.message
                            : String(cleanupError);
                        uiAPI.appendSystemMessage(
                            `Worktree merged, but cleanup failed: ${cleanupReason}`,
                            true,
                            "Harns",
                        );
                    }
                }
                await recordPlanEvent({
                    cwd: CWD,
                    planName: plan.planName,
                    event: "validation_passed",
                    currentStatus: "implemented",
                    details: { triageMeta: plan.attrs, worktreeStatus: "merged", cleanupMergedWorktrees },
                });
                uiAPI.appendSystemMessage("Worktree changes merged and plan marked verified.", false, "Harns");
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                uiAPI.appendSystemMessage(`Worktree merge failed: ${reason}`, true, "Harns");
                if (worktreeContext.id) {
                    try {
                        await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "merge_conflict" });
                    } catch (metadataError) {
                        const metadataReason = metadataError instanceof Error
                            ? metadataError.message
                            : String(metadataError);
                        uiAPI.appendSystemMessage(
                            `Could not update worktree registry while merge conflict is active: ${metadataReason}`,
                            true,
                            "Harns",
                        );
                    }
                }
                try {
                    await recordPlanEvent({
                        cwd: CWD,
                        planName: plan.planName,
                        event: "worktree_merge_failed",
                        currentStatus: "implemented",
                        details: { triageMeta: plan.attrs, failureReason: reason },
                    });
                } catch (metadataError) {
                    const metadataReason = metadataError instanceof Error
                        ? metadataError.message
                        : String(metadataError);
                    uiAPI.appendSystemMessage(
                        `Could not update plan metadata while merge conflict is active: ${metadataReason}`,
                        true,
                        "Harns",
                    );
                }
            }
            return "handled";
        }

        if (answer === "abandon") {
            if (!(await confirmWorktreeAction(plan.planName, uiAPI, "Delete/abandon"))) continue;
            if (worktreeContext?.path) {
                await removeExecutionWorktree({
                    projectRoot: CWD,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    force: true,
                });
            }
            if (worktreeContext?.id) {
                await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "abandoned" });
            }
            plan.attrs = await updatePlanFrontMatter(CWD, plan.planName, {
                worktreeStatus: "abandoned",
                worktreeId: null,
                worktreePath: null,
                worktreeBranch: null,
            }, plan.attrs);
            worktreeContext = null;
            uiAPI.appendSystemMessage("Worktree abandoned and removed.", false, "Harns");
            continue;
        }

        if (answer === "review") {
            if (worktreeContext?.id) {
                await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "abandoned" });
            }
            setActiveExecutionWorkflow(null);
            await stripTasksFromPlanFile(plan);
            await recordPlanEvent({
                cwd: CWD,
                planName: plan.planName,
                event: "review_reopened",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "feedback";
            return "review";
        }
    }
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatter} attrs
 * @returns {boolean}
 */
function isDecomposedEpicStatus(attrs) {
    return attrs.status === "ready_for_decomposition" || attrs.status === "ready_for_work";
}

/**
 * @param {{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }} child
 * @returns {string}
 */
function formatChildPlanLabel(child) {
    const summary = child.attrs.summary ? ` — ${child.attrs.summary}` : "";
    return `${child.name} [${child.attrs.status}]${summary}`;
}

/**
 * @param {Array<{ dependency: string, planName?: string, status?: string, state: "verified" | "unverified" | "missing" }>} unmetDependencies
 * @returns {string}
 */
function formatDependencyWarning(unmetDependencies) {
    return [
        "This child FEATURE declares dependencies that are not verified:",
        "",
        ...unmetDependencies.map((dependency) => {
            if (dependency.state === "missing") return `  - ${dependency.dependency}: missing`;
            return `  - ${dependency.planName || dependency.dependency}: ${dependency.status || "unknown"}`;
        }),
    ].join("\n");
}

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof resolveSiblingChildPlanDependenciesFn} resolveSiblingChildPlanDependencies
 * @returns {Promise<boolean>}
 */
async function confirmChildFeatureDependencies(plan, uiAPI, resolveSiblingChildPlanDependencies) {
    if (plan.attrs.classification !== "FEATURE" || !plan.attrs.parentPlan) return true;
    const dependencies = Array.isArray(plan.attrs.dependencies) ? plan.attrs.dependencies : [];
    if (dependencies.length === 0) return true;

    const dependencyStates = await resolveSiblingChildPlanDependencies(CWD, plan.attrs.parentPlan, dependencies);
    const unmetDependencies = dependencyStates.filter((dependency) => dependency.state !== "verified");
    if (unmetDependencies.length === 0) return true;

    uiAPI.appendSystemMessage(formatDependencyWarning(unmetDependencies), true, "Harns");
    const answer = await uiAPI.promptSelect(`Proceed with "${plan.planName}" anyway?`, [
        { value: "proceed", label: "Proceed anyway" },
        { value: "cancel", label: "Cancel" },
    ]);
    if (answer === "proceed") return true;
    uiAPI.appendSystemMessage("Plan load canceled.", false, "Harns");
    return false;
}

/**
 * @param {Object} opts
 * @param {{ planName: string, body: string, markdown: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {typeof runSlicerAgentFn} opts.runSlicerAgent
 * @param {(childPlanName: string) => Promise<void>} opts.loadChildPlan
 * @returns {Promise<"handled" | "continue">}
 */
async function handleEpicPlan({ plan, uiAPI, findPlansByParent, runSlicerAgent, loadChildPlan }) {
    if (!isEpicPlan(plan.attrs)) return "continue";

    const children = (await findPlansByParent(CWD, plan.planName)).filter((child) =>
        child.attrs.classification === "FEATURE"
    );
    const hasChildren = children.length > 0;
    const canPickChild = hasChildren && isDecomposedEpicStatus(plan.attrs);

    if (plan.attrs.status === "draft" || plan.attrs.status === "approved") {
        uiAPI.appendSystemMessage(
            "This PROJECT Epic is not executable. Resume Slicer decomposition to create child FEATURE plans.",
            false,
            "Harns",
        );
    } else if (canPickChild) {
        uiAPI.appendSystemMessage(
            `PROJECT Epic has ${children.length} child FEATURE plan${children.length === 1 ? "" : "s"}.`,
            false,
            "Harns",
        );
    } else if (!hasChildren) {
        uiAPI.appendSystemMessage("This PROJECT Epic has no child FEATURE plans yet.", false, "Harns");
    }

    while (true) {
        /** @type {Array<{ value: string, label: string }>} */
        const epicOptions = [
            { value: "slicer", label: "Open or resume Slicer decomposition" },
            { value: "view", label: "View Epic details" },
            { value: "cancel", label: "Cancel" },
        ];
        if (canPickChild) {
            epicOptions.splice(1, 0, { value: "pick_child", label: "Pick a child FEATURE plan" });
        }

        const answer = await uiAPI.promptSelect("What would you like to do with this Epic?", epicOptions);
        if (!answer || answer === "cancel") return "handled";

        if (answer === "view") {
            uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
            continue;
        }

        if (answer === "slicer") {
            await runSlicerAgent({
                planName: plan.planName,
                triageMeta: plan.attrs,
                uiAPI,
            });
            return "handled";
        }

        if (answer === "pick_child") {
            const childOptions = children.map((child) => ({
                value: child.name,
                label: formatChildPlanLabel(child),
            }));
            const childPlanName = await uiAPI.promptSelect("Load child FEATURE plan:", childOptions);
            if (!childPlanName) return "handled";
            await loadChildPlan(String(childPlanName));
            return "handled";
        }
    }
}

/**
 * Handle `load-plan` command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: LoadPlanTestDeps }} [options]
 */
export async function runLoadPlanCommand(argv, options = {}) {
    const deps = /** @type {LoadPlanTestDeps} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        parseArgs: parseArgsDep,
        printCommandHelp: printCommandHelpDep,
        startInteractiveSession: startInteractiveSessionDep,
        resolvePlan: resolvePlanDep,
        executePlan: executePlanDep,
        runPlanningAgent: runPlanningAgentDep,
        decidePostPlanning: decidePostPlanningDep,
        decidePostExecution: decidePostExecutionDep,
        submitPlanForReview: submitPlanForReviewDep,
        askPostApproval: askPostApprovalDep,
        askApprovalWithTasks: askApprovalWithTasksDep,
        ensureSlicerTasks: ensureSlicerTasksDep,
        runValidationLoop: runValidationLoopDep,
        runSlicerAgent: runSlicerAgentDep,
        loadPlan: loadPlanDep,
        getWorkflowDiff: getWorkflowDiffDep,
        listCommitsTouchingPathsSince: listCommitsTouchingPathsSinceDep,
        restoreWorktreeTree: restoreWorktreeTreeDep,
        setActiveAgent: setActiveAgentDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
        getRootAgentName: getRootAgentNameDep,
        listPlans: listPlansDep,
        findPlansByParent: findPlansByParentDep,
        resolveSiblingChildPlanDependencies: resolveSiblingChildPlanDependenciesDep,
        recordPlanEvent: recordPlanEventDep,
        updatePlanFrontMatter: updatePlanFrontMatterDep,
        findWorktreeById: findWorktreeByIdDep,
        findWorktreeByPlanName: findWorktreeByPlanNameDep,
        updateWorktreeRegistryEntry: updateWorktreeRegistryEntryDep,
        getWorktreeStatus: getWorktreeStatusDep,
        createExecutionWorktree: createExecutionWorktreeDep,
        mergeExecutionWorktree: mergeExecutionWorktreeDep,
        removeExecutionWorktree: removeExecutionWorktreeDep,
        removeWorktreeRegistryEntry: removeWorktreeRegistryEntryDep,
        shouldCleanupMergedWorktrees: shouldCleanupMergedWorktreesDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const resolvePlan = resolvePlanDep || resolvePlanFn;
    const executePlan = executePlanDep || executePlanFn;
    const runPlanningAgent = runPlanningAgentDep || runPlanningAgentFn;
    const decidePostPlanning = decidePostPlanningDep || decidePostPlanningFn;
    const decidePostExecution = decidePostExecutionDep || decidePostExecutionFn;
    const submitPlanForReview = submitPlanForReviewDep || submitPlanForReviewFn;
    const askPostApproval = askPostApprovalDep || askPostApprovalFn;
    const askApprovalWithTasks = askApprovalWithTasksDep || askApprovalWithTasksFn;
    const ensureSlicerTasks = ensureSlicerTasksDep || ensureSlicerTasksFn;
    const runValidationLoop = runValidationLoopDep || runValidationLoopFn;
    const runSlicerAgent = runSlicerAgentDep || runSlicerAgentFn;
    const loadPlan = loadPlanDep || loadPlanFn;
    const getWorkflowDiff = getWorkflowDiffDep || getWorkflowDiffFn;
    const listCommitsTouchingPathsSince = listCommitsTouchingPathsSinceDep || listCommitsTouchingPathsSinceFn;
    const restoreWorktreeTree = restoreWorktreeTreeDep || restoreWorktreeTreeFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;
    const getRootAgentName = getRootAgentNameDep || getRootAgentNameFn;
    const findPlansByParent = findPlansByParentDep || findPlansByParentFn;
    const resolveSiblingChildPlanDependencies = resolveSiblingChildPlanDependenciesDep ||
        resolveSiblingChildPlanDependenciesFn;
    const recordPlanEvent = recordPlanEventDep || recordPlanEventFn;
    const updatePlanFrontMatter = updatePlanFrontMatterDep || updatePlanFrontMatterFn;
    const findWorktreeById = findWorktreeByIdDep || findWorktreeByIdFn;
    const findWorktreeByPlanName = findWorktreeByPlanNameDep || findWorktreeByPlanNameFn;
    const updateWorktreeRegistryEntry = updateWorktreeRegistryEntryDep || updateWorktreeRegistryEntryFn;
    const getWorktreeStatus = getWorktreeStatusDep || getWorktreeStatusFn;
    const createExecutionWorktree = createExecutionWorktreeDep || createExecutionWorktreeFn;
    const mergeExecutionWorktree = mergeExecutionWorktreeDep || mergeExecutionWorktreeFn;
    const removeExecutionWorktree = removeExecutionWorktreeDep || removeExecutionWorktreeFn;
    const removeWorktreeRegistryEntry = removeWorktreeRegistryEntryDep || removeWorktreeRegistryEntryFn;
    const shouldCleanupMergedWorktrees = shouldCleanupMergedWorktreesDep || shouldCleanupMergedWorktreesFn;

    const parsedArgs = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsedArgs.help) {
        printCommandHelp("load-plan");
        return;
    }

    let [planArg] = parsedArgs._.map(String);
    if (!planArg) {
        if (options.uiAPI && options.editor) {
            const listPlans = listPlansDep || (await import("../../plan-store.js")).listPlans;
            const plans = await listPlans(Deno.cwd());
            if (plans.length === 0) {
                options.uiAPI.appendSystemMessage(
                    "No plans available, start one by entering a new request",
                );
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            const planOptions = plans.map((p) => ({
                value: p.name,
                label: p.name,
                description: `${p.attrs.classification} - ${p.attrs.status}`,
            }));

            const chosen = await options.uiAPI.promptSelect("Load plan:", planOptions);
            if (!chosen) {
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            planArg = chosen;
        } else {
            console.error(`Usage: ${CLI_BIN} load-plan <plan-name-or-path>`);
            Deno.exit(1);
        }
    }

    let uiAPI = options.uiAPI;

    if (!uiAPI) {
        uiAPI = await startInteractiveSession(
            null,
            (_userRequest, _images, currentUiAPI) => {
                currentUiAPI.appendSystemMessage("Please wait for the plan to load...");
                return Promise.resolve();
            },
        );
    }

    if (!uiAPI) return;

    let skipRouterRestore = false;
    const initialAgentName = getRootAgentName() || AGENTS.ROUTER;

    try {
        uiAPI.appendSystemMessage(`Loading plan: ${planArg}`, false, "Harns");

        const plan = await resolvePlan(CWD, planArg);
        uiAPI.appendSystemMessage(`Plan loaded: ${plan.planName}`, false, "Harns");
        uiAPI.appendSystemMessage(
            `Classification: ${plan.attrs.classification}, Status: ${plan.attrs.status}`,
            false,
            "Harns",
        );

        const triageMeta = plan.attrs;
        const agentName = triageMeta.classification === "PROJECT" ? AGENTS.ARCHITECT : AGENTS.PLANNER;

        if (["in_progress", "failed", "implemented"].includes(plan.attrs.status)) {
            const result = await handlePlanRecovery({
                plan,
                agentName,
                uiAPI,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                getWorkflowDiff,
                listCommitsTouchingPathsSince,
                restoreWorktreeTree,
                recordPlanEvent,
                updatePlanFrontMatter,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                getWorktreeStatus,
                createExecutionWorktree,
                mergeExecutionWorktree,
                removeExecutionWorktree,
                removeWorktreeRegistryEntry,
                shouldCleanupMergedWorktrees,
                setActiveAgent,
                createDirectAgentHandler,
            });
            if (result === "handled") return;
        }

        const epicResult = await handleEpicPlan({
            plan,
            uiAPI,
            findPlansByParent,
            runSlicerAgent,
            loadChildPlan: async (childPlanName) => {
                skipRouterRestore = true;
                await runLoadPlanCommand([childPlanName], {
                    ...options,
                    __testDeps: {
                        ...deps,
                        parseArgs: /** @type {any} */ ((/** @type {readonly string[]} */ childArgv) => ({
                            help: false,
                            _: [...childArgv],
                        })),
                    },
                });
            },
        });
        if (epicResult === "handled") {
            skipRouterRestore = true;
            return;
        }

        const dependenciesConfirmed = await confirmChildFeatureDependencies(
            plan,
            uiAPI,
            resolveSiblingChildPlanDependencies,
        );
        if (!dependenciesConfirmed) return;

        if (plan.attrs.status === "verified") {
            uiAPI.appendSystemMessage("This plan is already verified.", false, "Harns");
            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "review", label: "Re-open for review (planner/architect)" },
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);
                if (!answer || answer === "cancel") {
                    return;
                }
                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                    continue;
                }
                // Re-opening for review: discard the slicer's tasks so the
                // architect → slicer flow regenerates them against any revisions.
                await stripTasksFromPlanFile(plan);
                await recordPlanEvent({
                    cwd: CWD,
                    planName: plan.planName,
                    event: "review_reopened",
                    currentStatus: "verified",
                    details: { triageMeta: plan.attrs },
                });
                plan.attrs.status = "feedback";
                break;
            }
        }

        if (plan.attrs.status === "approved" || isExecutablePlanStatus(plan.attrs.status)) {
            uiAPI.appendSystemMessage(
                plan.attrs.status === "approved"
                    ? "This plan has been approved but is not ready for work yet."
                    : "This plan is ready for work.",
                false,
                "Harns",
            );

            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "proceed", label: "Proceed with execution" },
                    { value: "review", label: "Re-open for review (edit/annotate)" },
                    { value: "view", label: "View plan details" },
                ]);

                if (!answer) return;

                if (answer === "proceed") {
                    if (plan.attrs.status === "approved") {
                        const ready = await prepareApprovedPlanForWork(
                            plan,
                            uiAPI,
                            ensureSlicerTasks,
                            recordPlanEvent,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                    }

                    await executeReadyPlanWithRepair({
                        plan,
                        agentName,
                        uiAPI,
                        executePlan,
                        runPlanningAgent,
                        decidePostPlanning,
                        decidePostExecution,
                        runValidationLoop,
                        loadPlan,
                        listCommitsTouchingPathsSince,
                        setActiveAgent,
                        createDirectAgentHandler,
                    });
                    return;
                }

                if (answer === "review") {
                    // Re-opening for review: discard the slicer's tasks so the
                    // architect → slicer flow regenerates them against any revisions.
                    await stripTasksFromPlanFile(plan);
                    if (isExecutablePlanStatus(plan.attrs.status)) {
                        await recordPlanEvent({
                            cwd: CWD,
                            planName: plan.planName,
                            event: "review_reopened",
                            currentStatus: plan.attrs.status,
                            details: { triageMeta: plan.attrs },
                        });
                        plan.attrs.status = "feedback";
                    }

                    setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);

                    const reviewResult = await submitPlanForReview({
                        cwd: CWD,
                        planName: plan.planName,
                        planPath: plan.path,
                        triageMeta: plan.attrs,
                        uiAPI,
                    });

                    if (reviewResult.canceled) {
                        uiAPI.appendSystemMessage("Plan review canceled.", false, "Harns");
                        skipRouterRestore = true;
                        return;
                    }

                    if (reviewResult.approved) {
                        const ready = await prepareApprovedPlanForWork(
                            plan,
                            uiAPI,
                            ensureSlicerTasks,
                            recordPlanEvent,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                        const action = plan.attrs.classification === "PROJECT"
                            ? await askApprovalWithTasks(plan.planName, uiAPI)
                            : await askPostApproval(plan.planName, uiAPI);
                        if (action === "proceed") {
                            const confirmed = await confirmAffectedPathChangesBeforeExecution({
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                uiAPI,
                                listCommitsTouchingPathsSince,
                            });
                            if (!confirmed) return;

                            const execRes = await executePlan(plan.planName, plan.attrs, uiAPI);
                            const executionDecision = decidePostExecution(execRes, {
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                executionAgentName: agentName,
                            });
                            await validatePostExecutionDecision({
                                executionDecision,
                                fallbackPlanContent: plan.markdown || plan.body || "",
                                uiAPI,
                                runValidationLoop,
                                loadPlan,
                            });
                        } else {
                            uiAPI.appendSystemMessage(
                                `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                                false,
                                "Harns",
                            );
                            skipRouterRestore = true;
                        }
                        return;
                    }

                    // User submitted feedback — kick off the planning agent to revise.
                    const outcome = await runPlanningAgent({
                        agentName,
                        initialRequest: buildReReviewRevisionRequest(plan.planName, reviewResult.feedback),
                        triageMeta: plan.attrs,
                        uiAPI,
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
                        decidePostExecution,
                        runValidationLoop,
                        loadPlan,
                        listCommitsTouchingPathsSince,
                    });
                    if (shouldKeepPlanningAgentActive(planningDecision)) {
                        skipRouterRestore = true;
                    }
                    return;
                }

                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                }
            }
        }

        // Not approved — kick off the planning agent. plan_written handles review/save/execute.
        uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
        setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);

        const outcome = await runPlanningAgent({
            agentName,
            initialRequest: buildResumeRequest(plan.planName, plan.attrs),
            triageMeta,
            uiAPI,
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
            decidePostExecution,
            runValidationLoop,
            loadPlan,
            listCommitsTouchingPathsSince,
        });
        if (shouldKeepPlanningAgentActive(planningDecision)) {
            skipRouterRestore = true;
        }
    } finally {
        if (!skipRouterRestore) {
            restorePreviousAgentFlow(uiAPI, initialAgentName, deps);
        }
    }
}
