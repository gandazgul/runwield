/**
 * @module cmd/load-plan
 * Load-plan command implementation. Loads a saved plan from disk and continues
 * work on it (review/edit/execute), distinct from /resume which restores a
 * previous chat session.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { AGENTS, CLI_BIN, CWD } from "../../constants.js";
import { injectFrontMatter, loadPlan as loadPlanFn, resolvePlan as resolvePlanFn } from "../../plan-store.js";
import {
    askApprovalWithTasks as askApprovalWithTasksFn,
    askPostApproval as askPostApprovalFn,
    ensureSlicerTasks as ensureSlicerTasksFn,
    executePlan as executePlanFn,
    runPlanningAgent as runPlanningAgentFn,
} from "../../shared/workflow/workflow.js";
import { isExecutablePlanStatus, recordPlanEvent as recordPlanEventFn } from "../../shared/workflow/plan-lifecycle.js";
import {
    getWorkflowDiff as getWorkflowDiffFn,
    restoreWorktreeTree as restoreWorktreeTreeFn,
} from "../../shared/workflow/git-snapshot.js";
import { runValidationLoop as runValidationLoopFn } from "../../shared/workflow/validation.js";
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
 * @property {typeof submitPlanForReviewFn} [submitPlanForReview]
 * @property {typeof askPostApprovalFn} [askPostApproval]
 * @property {typeof askApprovalWithTasksFn} [askApprovalWithTasks]
 * @property {typeof ensureSlicerTasksFn} [ensureSlicerTasks]
 * @property {typeof runValidationLoopFn} [runValidationLoop]
 * @property {typeof loadPlanFn} [loadPlan]
 * @property {typeof getWorkflowDiffFn} [getWorkflowDiff]
 * @property {typeof restoreWorktreeTreeFn} [restoreWorktreeTree]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof createDirectAgentHandlerFn} [createDirectAgentHandler]
 * @property {typeof resetTuiStateFn} [resetTuiState]
 * @property {typeof getRootAgentNameFn} [getRootAgentName]
 * @property {(cwd: string) => Promise<Array<{name: string, attrs: {classification: string, status: string}}>>} [listPlans]
 * @property {typeof recordPlanEventFn} [recordPlanEvent]
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
 * @param {unknown} executionResult
 * @param {string} planName
 * @param {string} fallbackPlanContent
 * @param {import('../../plan-store.js').PlanFrontMatter} triageMeta
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof runValidationLoopFn} runValidationLoop
 * @param {typeof loadPlanFn} loadPlan
 */
async function validateCompletedExecution(
    executionResult,
    planName,
    fallbackPlanContent,
    triageMeta,
    uiAPI,
    runValidationLoop,
    loadPlan,
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
        setActiveExecutionWorkflow({
            planName,
            triageMeta,
            baselineTree: triageMeta.executionBaselineTree,
        });
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
 * Run the Readiness Gate for an approved Plan.
 *
 * @param {{ planName: string, path: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof ensureSlicerTasksFn} ensureSlicerTasks
 * @param {typeof recordPlanEventFn} recordPlanEvent
 * @returns {Promise<boolean>}
 */
async function prepareApprovedPlanForWork(plan, uiAPI, ensureSlicerTasks, recordPlanEvent) {
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
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
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
    runValidationLoop,
    loadPlan,
    setActiveAgent,
    createDirectAgentHandler,
}) {
    const MAX_REPAIR_ATTEMPTS = 2;
    let currentPlanName = plan.planName;
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    let currentMeta = plan.attrs;
    /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }> | undefined} */
    let currentTasks = undefined;

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
        const execRes = await executePlan(currentPlanName, currentMeta, uiAPI, currentTasks);
        if (!execRes || !execRes.repairRequired) {
            await validateCompletedExecution(
                execRes,
                currentPlanName,
                plan.markdown || plan.body || "",
                /** @type {import('../../plan-store.js').PlanFrontMatter} */ (currentMeta),
                uiAPI,
                runValidationLoop,
                loadPlan,
            );
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
                    execRes.error || "Unknown task table error"
                }.`,
                "",
                "Fix the markdown Tasks table to follow:",
                "",
                "| Task | Assignee | Dependencies | Write Scope | Description |",
                "",
                "Use numeric task IDs, valid assignees, numeric dependency IDs or `none`, narrow repo-relative write scopes, and a final tester verification task that depends on every prior task.",
                "Then call plan_written again with the plan name.",
            ].join("\n"),
            triageMeta: currentMeta,
            uiAPI,
        });
        if (repairOutcome.outcome !== "approved_execute" || !repairOutcome.planName) {
            uiAPI.appendSystemMessage(
                "Repair did not produce an approved plan. Aborting.",
                false,
                "Harns",
            );
            break;
        }
        currentPlanName = repairOutcome.planName;
        currentMeta = repairOutcome.triageMeta || currentMeta;
        currentTasks = repairOutcome.tasks;
    }
}

/**
 * Append recovery context for a partially executed Plan.
 *
 * @param {{ attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown: string }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof getWorkflowDiffFn} getWorkflowDiff
 * @returns {Promise<void>}
 */
async function appendRecoveryReport(plan, uiAPI, getWorkflowDiff) {
    const lines = [buildPlanSummary(plan)];
    if (plan.attrs.failureReason) {
        lines.push(`Failure reason:\n${plan.attrs.failureReason}`);
    }
    if (plan.attrs.executionBaselineTree) {
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
 * Handle Plan Recovery menus for in-progress, failed, and implemented plans.
 *
 * @param {Object} opts
 * @param {{ planName: string, path: string, markdown: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof executePlanFn} opts.executePlan
 * @param {typeof runPlanningAgentFn} opts.runPlanningAgent
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof getWorkflowDiffFn} opts.getWorkflowDiff
 * @param {typeof restoreWorktreeTreeFn} opts.restoreWorktreeTree
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
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
    runValidationLoop,
    loadPlan,
    getWorkflowDiff,
    restoreWorktreeTree,
    recordPlanEvent,
    setActiveAgent,
    createDirectAgentHandler,
}) {
    while (true) {
        const options = plan.attrs.status === "implemented"
            ? [
                { value: "validate", label: "Retry Workflow Validation" },
                { value: "inspect", label: "Inspect and report current state" },
                { value: "reset", label: "Reset tree and start over" },
                { value: "review", label: "Re-open for review" },
                { value: "cancel", label: "Cancel" },
            ]
            : [
                { value: "inspect", label: "Inspect and report current state" },
                { value: "continue", label: "Continue execution from current worktree" },
                { value: "reset", label: "Reset tree and start over" },
                { value: "review", label: "Re-open for review" },
                { value: "cancel", label: "Cancel" },
            ];

        const answer = await uiAPI.promptSelect(`Plan recovery (${plan.attrs.status}):`, options);
        if (!answer || answer === "cancel") return "handled";

        if (answer === "inspect") {
            await appendRecoveryReport(plan, uiAPI, getWorkflowDiff);
            continue;
        }

        if (answer === "validate") {
            await validateCompletedExecution(
                { executionComplete: true },
                plan.planName,
                plan.markdown || plan.body || "",
                plan.attrs,
                uiAPI,
                runValidationLoop,
                loadPlan,
            );
            return "handled";
        }

        if (answer === "continue") {
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
                runValidationLoop,
                loadPlan,
                setActiveAgent,
                createDirectAgentHandler,
            });
            return "handled";
        }

        if (answer === "reset") {
            if (!plan.attrs.executionBaselineTree) {
                uiAPI.appendSystemMessage(
                    "Cannot reset this plan because no execution baseline tree is recorded.",
                    true,
                    "Harns",
                );
                continue;
            }
            if (!(await confirmBaselineReset(plan.planName, uiAPI))) continue;
            await restoreWorktreeTree(CWD, plan.attrs.executionBaselineTree);
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
                runValidationLoop,
                loadPlan,
                setActiveAgent,
                createDirectAgentHandler,
            });
            return "handled";
        }

        if (answer === "review") {
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
        submitPlanForReview: submitPlanForReviewDep,
        askPostApproval: askPostApprovalDep,
        askApprovalWithTasks: askApprovalWithTasksDep,
        ensureSlicerTasks: ensureSlicerTasksDep,
        runValidationLoop: runValidationLoopDep,
        loadPlan: loadPlanDep,
        getWorkflowDiff: getWorkflowDiffDep,
        restoreWorktreeTree: restoreWorktreeTreeDep,
        setActiveAgent: setActiveAgentDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
        getRootAgentName: getRootAgentNameDep,
        listPlans: listPlansDep,
        recordPlanEvent: recordPlanEventDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const resolvePlan = resolvePlanDep || resolvePlanFn;
    const executePlan = executePlanDep || executePlanFn;
    const runPlanningAgent = runPlanningAgentDep || runPlanningAgentFn;
    const submitPlanForReview = submitPlanForReviewDep || submitPlanForReviewFn;
    const askPostApproval = askPostApprovalDep || askPostApprovalFn;
    const askApprovalWithTasks = askApprovalWithTasksDep || askApprovalWithTasksFn;
    const ensureSlicerTasks = ensureSlicerTasksDep || ensureSlicerTasksFn;
    const runValidationLoop = runValidationLoopDep || runValidationLoopFn;
    const loadPlan = loadPlanDep || loadPlanFn;
    const getWorkflowDiff = getWorkflowDiffDep || getWorkflowDiffFn;
    const restoreWorktreeTree = restoreWorktreeTreeDep || restoreWorktreeTreeFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;
    const getRootAgentName = getRootAgentNameDep || getRootAgentNameFn;
    const recordPlanEvent = recordPlanEventDep || recordPlanEventFn;

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
                runValidationLoop,
                loadPlan,
                getWorkflowDiff,
                restoreWorktreeTree,
                recordPlanEvent,
                setActiveAgent,
                createDirectAgentHandler,
            });
            if (result === "handled") return;
        }

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
                        runValidationLoop,
                        loadPlan,
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
                            const execRes = await executePlan(plan.planName, plan.attrs, uiAPI);
                            await validateCompletedExecution(
                                execRes,
                                plan.planName,
                                plan.markdown || plan.body || "",
                                plan.attrs,
                                uiAPI,
                                runValidationLoop,
                                loadPlan,
                            );
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

                    if (outcome.outcome === "approved_execute" && outcome.planName) {
                        const execRes = await executePlan(
                            outcome.planName,
                            outcome.triageMeta || plan.attrs,
                            uiAPI,
                            outcome.tasks,
                        );
                        await validateCompletedExecution(
                            execRes,
                            outcome.planName,
                            plan.markdown || plan.body || "",
                            /** @type {import('../../plan-store.js').PlanFrontMatter} */ (outcome.triageMeta ||
                                plan.attrs),
                            uiAPI,
                            runValidationLoop,
                            loadPlan,
                        );
                    } else if (
                        outcome.outcome === "canceled" || outcome.outcome === "no_call" ||
                        outcome.outcome === "feedback" || outcome.outcome === "repair_required"
                    ) {
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

        if (outcome.outcome === "approved_execute" && outcome.planName) {
            const execRes = await executePlan(
                outcome.planName,
                outcome.triageMeta || plan.attrs,
                uiAPI,
                outcome.tasks,
            );
            await validateCompletedExecution(
                execRes,
                outcome.planName,
                plan.markdown || plan.body || "",
                /** @type {import('../../plan-store.js').PlanFrontMatter} */ (outcome.triageMeta || plan.attrs),
                uiAPI,
                runValidationLoop,
                loadPlan,
            );
        } else if (
            outcome.outcome === "canceled" || outcome.outcome === "no_call" ||
            outcome.outcome === "feedback" || outcome.outcome === "repair_required"
        ) {
            skipRouterRestore = true;
        }
    } finally {
        if (!skipRouterRestore) {
            restorePreviousAgentFlow(uiAPI, initialAgentName, deps);
        }
    }
}
