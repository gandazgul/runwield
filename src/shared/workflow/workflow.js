/**
 * @module shared/workflow
 * Plan-execution helpers used by the plan_written tool, the resume command,
 * and the router triage flow.
 *
 * The lifecycle (review → save/execute) lives inside the plan_written tool
 * itself (see `src/tools/plan-written.js`). This module exports the executor
 * and post-approval prompts that the tool calls, plus a thin helper for
 * kicking off a planning agent without an outer review loop.
 */

import { join } from "@std/path";
// @ts-ignore — quikdown/ast .d.ts uses export= but ESM runtime has default export
import quikdownAst from "quikdown/ast";
import { AGENTS, CWD, MAX_PARALLEL_TASKS } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
import { runAgentSession } from "../session/session.js";
import { getAgentDisplayName } from "../session/agents.js";
import { createSilentUiApi } from "../ui/api.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { getActiveExecutionWorkflow, setActiveExecutionWorkflow } from "../session/session-state.js";
import { isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";

/**
 * Extract the last text output from the agent's assistant messages.
 * Scans messages in reverse, checking ALL content blocks (not just [0])
 * to handle cases where tool_use blocks appear alongside text.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {string | null}
 */
export function extractAssistantOutput(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!("role" in msg) || msg.role !== "assistant") continue;
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (block && typeof block === "object" && "type" in block && block.type === "text" && block.text?.trim()) {
                return block.text.trim();
            }
        }
    }

    return null;
}

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
 * Read the latest plan_written tool result's outcome from a message stream.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {PlanOutcomeResult | null}
 */
export function readLatestPlanOutcome(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "plan_written"
        ) {
            // @ts-ignore details set by tool implementation
            const details = msg.details || {};
            const outcome = details.outcome;
            if (outcome) {
                return {
                    outcome,
                    planName: details.planName,
                    tasks: details.tasks,
                    triageMeta: details.triageMeta,
                };
            }
        }
    }
    return null;
}

/**
 * Read the latest task_completed tool result's outcome from a message stream.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {boolean}
 */
export function readLatestTaskCompletedOutcome(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "task_completed"
        ) {
            // @ts-ignore details set by tool implementation
            const details = msg.details || {};
            if (details.outcome === "task_completed") {
                return true;
            }
        }
    }
    return false;
}

/**
 * Run a planning agent (planner/architect) once and return the lifecycle outcome
 * captured by plan_written. Does NOT execute the plan — call `executePlan`
 * afterwards if the outcome is `approved_execute`.
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
    uiAPI.appendSystemMessage(`=== Running ${getAgentDisplayName(agentName)} ===`, false, "Harns");

    const messages = await runAgentSession({
        agentName,
        userRequest: initialRequest,
        triageMeta,
        uiAPI,
        sessionManager,
    });

    const result = readLatestPlanOutcome(messages);
    return result || { outcome: "no_call" };
}

/**
 * Build the user-request text handed to the slicer agent. Exported for tests.
 *
 * @param {string} planName
 * @param {import('../../tools/plan-written.js').TriageMeta | undefined} triageMeta
 * @returns {string}
 */
export function buildSlicerRequest(planName, triageMeta) {
    const lines = [
        `## Slice Plan: ${planName}`,
        "",
        `The architect has finished a design-only plan at plans/${planName}.md. The user approved the design.`,
        "Your job: read the plan, then append a Tasks section and per-slice detail blocks using the edit tool.",
        "Follow the slicer tasks format file referenced in your system prompt exactly.",
        "",
    ];
    if (triageMeta) {
        lines.push("## Triage Report");
        if (triageMeta.classification) lines.push(`- Classification: ${triageMeta.classification}`);
        if (triageMeta.complexity) lines.push(`- Complexity: ${triageMeta.complexity}`);
        if (triageMeta.summary) lines.push(`- Summary: ${triageMeta.summary}`);
        if (triageMeta.affectedPaths?.length) {
            lines.push(`- Affected paths: ${triageMeta.affectedPaths.join(", ")}`);
        }
        lines.push("");
    }
    lines.push(
        "Apply the self-check rules in your system prompt before editing. End your turn after the edit — do not " +
            "generate further text.",
    );
    return lines.join("\n");
}

/**
 * Run the slicer agent against an approved design-only plan. Slicer reads the
 * plan, decides how to break it into vertical slices, and appends a Tasks
 * section + per-slice detail blocks via the edit tool. Returns a result the
 * caller uses to validate the new task table and transition status.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {UiAPI} opts.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {{ runAgentSession?: typeof runAgentSession }} [opts.__deps] - Test-only injection point.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runSlicerAgent({ planName, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("runSlicerAgent: uiAPI is required");
    const session = __deps?.runAgentSession || runAgentSession;

    const slicerDisplay = getAgentDisplayName(AGENTS.SLICER);
    uiAPI.appendSystemMessage(`=== Running ${slicerDisplay} ===`, false, "Harns");

    try {
        await session({
            agentName: AGENTS.SLICER,
            userRequest: buildSlicerRequest(planName, triageMeta),
            triageMeta,
            uiAPI,
            sessionManager,
        });
        return { ok: true };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        uiAPI.appendSystemMessage(`${slicerDisplay} failed: ${error}`, true, "Harns");
        return { ok: false, error };
    }
}

/**
 * Ensure a PROJECT plan has a parseable Tasks table. If one already exists
 * (resumed plan), no-op and return ok. Otherwise invoke the slicer agent,
 * then validate that it produced a parseable Tasks table. Used by plan_written
 * after the user approves the architect's design.
 *
 * Returns `{ ok: true, slicerInvoked }` on success, `{ ok: false, error, stage }`
 * when the slicer fails or its output is unparseable. On failure, the plan
 * file itself is unchanged and status is left at `approved` so the caller can
 * surface the error and let the user retry.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} opts.planPath - Absolute path to the plan markdown file.
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {UiAPI} opts.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {{
 *   runSlicerAgent?: typeof runSlicerAgent,
 *   readTextFile?: (path: string) => Promise<string>,
 *   extractTasks?: typeof extractTasks,
 *   validateProjectTasks?: typeof validateProjectTasks,
 * }} [opts.__deps] - Test-only injection point.
 * @returns {Promise<{ ok: true, slicerInvoked: boolean } | { ok: false, error: string, stage: "slicer" | "validation" }>}
 */
export async function ensureSlicerTasks({ planName, planPath, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("ensureSlicerTasks: uiAPI is required");
    const slicer = __deps?.runSlicerAgent || runSlicerAgent;
    const readTextFile = __deps?.readTextFile || Deno.readTextFile.bind(Deno);
    const parseTasks = __deps?.extractTasks || extractTasks;
    const validateTasks = __deps?.validateProjectTasks || validateProjectTasks;

    // If the plan already has a parseable Tasks section (resumed plan), skip the slicer.
    try {
        const currentMd = await readTextFile(planPath);
        validateTasks(parseTasks(currentMd));
        return { ok: true, slicerInvoked: false };
    } catch {
        // Tasks missing or unparseable — slicer must run.
    }

    const slicerResult = await slicer({ planName, triageMeta, uiAPI, sessionManager });
    if (!slicerResult.ok) {
        return { ok: false, error: slicerResult.error || "slicer failed", stage: "slicer" };
    }

    // Validate that the slicer's output is parseable.
    try {
        const slicedMd = await readTextFile(planPath);
        validateTasks(parseTasks(slicedMd));
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return { ok: false, error, stage: "validation" };
    }

    return { ok: true, slicerInvoked: true };
}

/**
 * Ask user what to do after plan approval.
 *
 * @param {string} planName
 * @param {UiAPI} uiAPI
 * @returns {Promise<"proceed" | "save">}
 */
export async function askPostApproval(planName, uiAPI) {
    const title = `Plan "${planName}" approved! What next?`;
    const options = [
        { value: "proceed", label: "Proceed with execution" },
        { value: "save", label: "Save for later" },
    ];
    const choice = await uiAPI.promptSelect(title, options);
    return choice === "proceed" ? "proceed" : "save";
}

/**
 * Flatten a quikdown inline-node array into a plain string. Preserves text and
 * inline code; ignores formatting wrappers we don't care about for tasks.
 *
 * @param {Array<{ type: string, value?: string, children?: any[] }>} nodes
 * @returns {string}
 */
function inlineNodesToText(nodes) {
    if (!Array.isArray(nodes)) return "";
    return nodes.map((n) => {
        if (typeof n?.value === "string") return n.value;
        if (Array.isArray(n?.children)) return inlineNodesToText(n.children);
        return "";
    }).join("").trim();
}

/**
 * Parse the PROJECT Tasks table from a plan's markdown using a forgiving AST
 * parser. The plan must contain a `## Tasks` heading followed by a table with
 * columns: Task | Assignee | Dependencies | Write Scope | Description.
 *
 * @param {string} planContent
 * @returns {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope: string }>}
 * @throws {Error} If a Tasks section + table can't be located or parsed.
 */
export function extractTasks(planContent) {
    /** @type {{ type: string, children?: any[], level?: number, headers?: any[][], rows?: any[][][] }} */
    const ast = quikdownAst(planContent);
    const children = Array.isArray(ast.children) ? ast.children : [];

    let tasksHeadingIdx = -1;
    for (let i = 0; i < children.length; i++) {
        const n = children[i];
        if (n.type === "heading" && /^tasks$/i.test(inlineNodesToText(n.children || []))) {
            tasksHeadingIdx = i;
            break;
        }
    }

    if (tasksHeadingIdx === -1) {
        throw new Error(
            "Tasks section not found. PROJECT plans must include a '## Tasks' heading followed by a markdown table.",
        );
    }

    /** @type {{ type: string, headers?: any[][], rows?: any[][][] } | null} */
    let tableNode = null;
    for (let i = tasksHeadingIdx + 1; i < children.length; i++) {
        const n = children[i];
        if (n.type === "table") {
            tableNode = n;
            break;
        }
        if (n.type === "heading") break;
    }

    if (!tableNode || !Array.isArray(tableNode.rows)) {
        throw new Error("Tasks section found but no markdown table follows the heading.");
    }

    const headers = Array.isArray(tableNode.headers)
        ? tableNode.headers.map((header) => inlineNodesToText(header).toLowerCase().replace(/[^a-z]/g, ""))
        : [];
    const findHeader = (/** @type {string[]} */ names, /** @type {number} */ fallback) => {
        for (const name of names) {
            const idx = headers.indexOf(name);
            if (idx !== -1) return idx;
        }
        return fallback;
    };
    const taskIdx = findHeader(["task", "id"], 0);
    const assigneeIdx = findHeader(["assignee"], 1);
    const dependenciesIdx = findHeader(["dependencies", "deps"], 2);
    const writeScopeIdx = findHeader(["writescope", "writescopepaths", "paths", "files", "scope"], -1);
    const descriptionIdx = findHeader(["description"], writeScopeIdx === -1 ? 3 : 4);

    const tasks = [];
    for (const row of tableNode.rows) {
        if (!Array.isArray(row) || row.length < 4) continue;
        const taskCell = inlineNodesToText(row[taskIdx]);
        const taskId = parseInt(taskCell, 10);
        if (Number.isNaN(taskId)) continue; // skip non-numeric rows (e.g. separator-style)
        tasks.push({
            task: taskId,
            assignee: inlineNodesToText(row[assigneeIdx]),
            dependencies: inlineNodesToText(row[dependenciesIdx]),
            writeScope: writeScopeIdx === -1 ? "unknown" : inlineNodesToText(row[writeScopeIdx]),
            description: inlineNodesToText(row[descriptionIdx]),
        });
    }

    if (tasks.length === 0) {
        throw new Error("Tasks table found but contains no valid task rows.");
    }

    return tasks;
}

const PROJECT_TASK_ASSIGNEES = new Set([AGENTS.ENGINEER, AGENTS.TESTER, AGENTS.DOC_WRITER]);
const BROAD_WRITE_SCOPES = new Set(["*", "**", "all", "repo", "repository", "unknown", "tbd", "any"]);
const NO_WRITE_SCOPES = new Set(["none", "no", "readonly", "read-only", "n/a", "na"]);

/**
 * @param {string} dependencies
 * @returns {number[]}
 */
function parseTaskDependencies(dependencies) {
    return (dependencies || "").split(",").map((dependency) => dependency.trim()).filter((dependency) =>
        dependency && dependency.toLowerCase() !== "none"
    ).map((dependency) => {
        const depId = Number.parseInt(dependency, 10);
        if (!/^\d+$/.test(dependency) || Number.isNaN(depId)) {
            throw new Error(`Task dependency "${dependency}" is not a numeric task ID.`);
        }
        return depId;
    });
}

/**
 * Parse a task write scope into normalized path-ish tokens. Missing or unknown
 * scope is intentionally broad so the scheduler serializes it conservatively.
 *
 * @param {string | undefined} writeScope
 * @returns {{ broad: boolean, paths: string[] }}
 */
export function parseTaskWriteScope(writeScope) {
    const raw = String(writeScope || "").trim();
    if (!raw) return { broad: true, paths: [] };

    const parts = raw.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return { broad: true, paths: [] };

    /** @type {string[]} */
    const paths = [];
    for (const part of parts) {
        const normalized = part.replace(/^`|`$/g, "").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
        if (!normalized) continue;
        if (NO_WRITE_SCOPES.has(normalized)) continue;
        if (BROAD_WRITE_SCOPES.has(normalized) || normalized.includes("*")) {
            return { broad: true, paths: [] };
        }
        paths.push(normalized);
    }

    return { broad: false, paths };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function pathsOverlap(a, b) {
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * @param {{ writeScope?: string }} a
 * @param {{ writeScope?: string }} b
 * @returns {boolean}
 */
export function taskWriteScopesOverlap(a, b) {
    const aScope = parseTaskWriteScope(a.writeScope);
    const bScope = parseTaskWriteScope(b.writeScope);
    if (aScope.paths.length === 0 && !aScope.broad) return false;
    if (bScope.paths.length === 0 && !bScope.broad) return false;
    if (aScope.broad || bScope.broad) return true;

    return aScope.paths.some((aPath) => bScope.paths.some((bPath) => pathsOverlap(aPath, bPath)));
}

/**
 * Select tasks that are dependency-ready and safe to launch together in the
 * shared worktree. The DAG controls semantic readiness; write scope controls
 * concurrent launch safety.
 *
 * @template {{ task: number, writeScope?: string }} T
 * @param {T[]} readyTasks
 * @param {T[]} runningTasks
 * @param {number} maxToLaunch
 * @returns {T[]}
 */
export function selectNonConflictingTasks(readyTasks, runningTasks, maxToLaunch) {
    /** @type {T[]} */
    const selected = [];
    for (const task of readyTasks) {
        if (selected.length >= maxToLaunch) break;
        const conflictsWithRunning = runningTasks.some((runningTask) => taskWriteScopesOverlap(task, runningTask));
        const conflictsWithSelected = selected.some((selectedTask) => taskWriteScopesOverlap(task, selectedTask));
        if (conflictsWithRunning || conflictsWithSelected) continue;
        selected.push(task);
    }
    return selected;
}

/**
 * Validate the PROJECT task graph contract before showing or executing tasks.
 *
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} tasks
 * @returns {void}
 */
export function validateProjectTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Error("PROJECT plans must include at least one task.");
    }

    const ids = new Set();
    for (const task of tasks) {
        if (!Number.isInteger(task.task) || task.task <= 0) {
            throw new Error(`Task ID "${task.task}" must be a positive integer.`);
        }
        if (ids.has(task.task)) {
            throw new Error(`Duplicate task ID ${task.task}.`);
        }
        ids.add(task.task);

        if (!PROJECT_TASK_ASSIGNEES.has(task.assignee)) {
            throw new Error(
                `Task ${task.task} has invalid assignee "${task.assignee}". ` +
                    "Allowed assignees are engineer, tester, and doc-writer.",
            );
        }
    }

    /** @type {Map<number, number[]>} */
    const dependencyMap = new Map();
    for (const task of tasks) {
        const dependencies = parseTaskDependencies(task.dependencies);
        dependencyMap.set(task.task, dependencies);
        for (const depId of dependencies) {
            if (!ids.has(depId)) {
                throw new Error(`Task ${task.task} depends on unknown task ${depId}.`);
            }
            if (depId === task.task) {
                throw new Error(`Task ${task.task} cannot depend on itself.`);
            }
        }
    }

    /** @type {Set<number>} */
    const visiting = new Set();
    /** @type {Set<number>} */
    const visited = new Set();
    /**
     * @param {number} taskId
     */
    function visit(taskId) {
        if (visited.has(taskId)) return;
        if (visiting.has(taskId)) {
            throw new Error(`Task dependency graph contains a cycle at task ${taskId}.`);
        }
        visiting.add(taskId);
        for (const depId of dependencyMap.get(taskId) || []) visit(depId);
        visiting.delete(taskId);
        visited.add(taskId);
    }
    for (const task of tasks) visit(task.task);

    const finalTask = tasks[tasks.length - 1];
    if (finalTask.assignee !== AGENTS.TESTER) {
        throw new Error("The final PROJECT task must be assigned to tester for cross-slice verification.");
    }
    if (!/verification/i.test(finalTask.description || "")) {
        throw new Error("The final tester task description must direct the tester to run verification.");
    }

    const finalDependencies = new Set(dependencyMap.get(finalTask.task) || []);
    const priorTaskIds = tasks.slice(0, -1).map((task) => task.task);
    for (const taskId of priorTaskIds) {
        if (!finalDependencies.has(taskId)) {
            throw new Error(`The final tester task must depend on prior task ${taskId}.`);
        }
    }
}

/**
 * Execute an approved plan.
 *
 * @param {string} planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} triageMeta
 * @param {UiAPI} uiAPI
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} [structuredTasks]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @returns {Promise<PlanExecutionResult>}
 */
export async function executePlan(planName, triageMeta, uiAPI, structuredTasks, sessionManager) {
    if (!uiAPI) throw new Error("executePlan: uiAPI is required");

    const plan = await loadPlan(CWD, planName);
    if (!plan) {
        uiAPI.appendSystemMessage(`ERROR: Could not load plan ${planName}`, true, "Harns");
        return { repairRequired: false, executionComplete: false, error: `Could not load plan ${planName}` };
    }

    if (!isExecutablePlanStatus(plan.attrs.status)) {
        const error = `Plan ${planName} is not ready for work (status: ${plan.attrs.status}).`;
        uiAPI.appendSystemMessage(`ERROR: ${error}`, true, "Harns");
        return { repairRequired: false, executionComplete: false, error };
    }

    uiAPI.appendSystemMessage(`=== Executing Plan: ${planName} ===`, false, "Harns");
    let executionStarted = false;

    if (triageMeta.classification === "PROJECT") {
        try {
            const tasks = structuredTasks && structuredTasks.length > 0 ? structuredTasks : extractTasks(plan.markdown);
            validateProjectTasks(tasks);

            if (tasks.length > 0) {
                await startActiveExecutionWorkflow(planName, triageMeta, plan.attrs.status);
                executionStarted = true;
                uiAPI.appendSystemMessage(
                    `Found ${tasks.length} tasks in plan. Executing in parallel where possible.`,
                    false,
                    "Harns",
                );

                let localActiveTasks = 0;
                let spinnerInterval;

                if (uiAPI.advanceSpinner && typeof setInterval !== "undefined") {
                    spinnerInterval = setInterval(() => {
                        if (localActiveTasks > 0 && uiAPI.advanceSpinner) uiAPI.advanceSpinner();
                    }, 100);
                }

                const executionResult = await executeProjectTasks(
                    planName,
                    plan.body,
                    tasks,
                    uiAPI,
                    [],
                    (runningTasks) => {
                        localActiveTasks = runningTasks.length;
                        if (uiAPI.setRunningTasks) uiAPI.setRunningTasks(runningTasks);
                    },
                    sessionManager,
                );

                if (spinnerInterval) clearInterval(spinnerInterval);

                if (executionResult.failedTasks.length > 0) {
                    const retry = await askRetryFailedTasks(executionResult, uiAPI);
                    if (retry) {
                        localActiveTasks = 0;
                        if (uiAPI.advanceSpinner && typeof setInterval !== "undefined") {
                            spinnerInterval = setInterval(() => {
                                if (localActiveTasks > 0 && uiAPI.advanceSpinner) uiAPI.advanceSpinner();
                            }, 100);
                        }
                        const finalResult = await executeProjectTasks(
                            planName,
                            plan.body,
                            tasks,
                            uiAPI,
                            executionResult.failedTasks,
                            (runningTasks) => {
                                localActiveTasks = runningTasks.length;
                                if (uiAPI.setRunningTasks) uiAPI.setRunningTasks(runningTasks);
                            },
                            sessionManager,
                        );
                        if (spinnerInterval) clearInterval(spinnerInterval);
                        if (finalResult.failedTasks.length > 0) {
                            reportExecutionSummary(finalResult, uiAPI);
                            await recordPlanEvent({
                                cwd: CWD,
                                planName,
                                event: "execution_failed",
                                currentStatus: "in_progress",
                                details: {
                                    triageMeta,
                                    failureReason: `Failed tasks after retry: ${finalResult.failedTasks.join(", ")}`,
                                },
                            });
                            return {
                                repairRequired: false,
                                executionComplete: false,
                                failedTasks: finalResult.failedTasks,
                            };
                        } else {
                            uiAPI.appendSystemMessage(`✅ All tasks eventually completed.`, false, "Harns");
                        }
                    } else {
                        reportExecutionSummary(executionResult, uiAPI);
                        await recordPlanEvent({
                            cwd: CWD,
                            planName,
                            event: "execution_failed",
                            currentStatus: "in_progress",
                            details: {
                                triageMeta,
                                failureReason: `Failed tasks: ${executionResult.failedTasks.join(", ")}`,
                            },
                        });
                        return {
                            repairRequired: false,
                            executionComplete: false,
                            failedTasks: executionResult.failedTasks,
                        };
                    }
                } else {
                    uiAPI.appendSystemMessage(`✅ All tasks completed successfully.`, false, "Harns");
                }
            } else {
                await startActiveExecutionWorkflow(planName, triageMeta, plan.attrs.status);
                executionStarted = true;
                const engineerResult = await runEngineerWithPlan(
                    planName,
                    plan.body,
                    uiAPI,
                    sessionManager,
                    triageMeta,
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
                    return { repairRequired: false, executionComplete: false };
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            uiAPI.appendSystemMessage(`TASK TABLE ERROR: ${error.message}`, true, "Harns");
            if (executionStarted) {
                await recordPlanEvent({
                    cwd: CWD,
                    planName,
                    event: "execution_failed",
                    currentStatus: "in_progress",
                    details: { triageMeta, failureReason: error.message },
                });
            }
            return { repairRequired: true, executionComplete: false, error: error.message };
        }
    } else {
        await startActiveExecutionWorkflow(planName, triageMeta, plan.attrs.status);
        executionStarted = true;
        const engineerResult = await runEngineerWithPlan(planName, plan.body, uiAPI, sessionManager, triageMeta);
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
            return { repairRequired: false, executionComplete: false };
        }
    }

    uiAPI.appendSystemMessage(
        `✅ Plan implementation complete: ${planName}`,
        false,
        "Harns",
    );
    await recordPlanEvent({
        cwd: CWD,
        planName,
        event: "implementation_finished",
        currentStatus: "in_progress",
        details: { triageMeta },
    });
    return { repairRequired: false, executionComplete: true };
}

/**
 * Execute project tasks in parallel against in-memory sub-sessions. Each task
 * runs on a transient SessionManager.inMemory() (intentional — keeps the root
 * session focused and avoids interleaved tool calls from many concurrent
 * agents). When a task finishes, we append a single custom_message entry to
 * the root session manager summarizing what it did, so the rootSession remains
 * a single continuous thread that includes a record of every sub-task.
 *
 * @param {string} planName
 * @param {string} planBody
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} tasks
 * @param {UiAPI} uiAPI
 * @param {number[]} [seedFailedTasks]
 * @param {(runningTasks: Array<{task: number, assignee: string, description: string}>) => void} [onRunningTasksChange]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 *   Root session manager; receives a custom_message per finished task. Tasks
 *   themselves still run in-memory.
 */
async function executeProjectTasks(
    planName,
    planBody,
    tasks,
    uiAPI,
    seedFailedTasks = [],
    onRunningTasksChange,
    sessionManager,
) {
    /** @type {Map<number, import('./types.js').TaskExecutionResult>} */
    const results = new Map();
    const retryTaskIds = new Set(seedFailedTasks);
    const pending = new Set(seedFailedTasks.length > 0 ? seedFailedTasks : tasks.map((task) => task.task));
    const running = new Set();

    if (seedFailedTasks.length > 0) {
        const processed = tasks.filter((task) => !retryTaskIds.has(task.task)).map((task) => task.task);
        processed.forEach((id) => results.set(id, { status: "success" }));
    }

    while (results.size < tasks.length) {
        const ready = tasks.filter((task) => {
            if (!pending.has(task.task)) return false;
            const deps = (task.dependencies || "").split(",").map((dependency) => dependency.trim()).filter((
                dependency,
            ) => dependency && dependency.toLowerCase() !== "none");
            return deps.every((dependency) => {
                const depId = parseInt(dependency);
                if (isNaN(depId)) return true;
                return results.has(depId) && results.get(depId)?.status === "success";
            });
        });

        const runningTasks = tasks.filter((task) => running.has(task.task));
        const toLaunch = selectNonConflictingTasks(ready, runningTasks, MAX_PARALLEL_TASKS - running.size);

        if (toLaunch.length === 0 && running.size === 0 && pending.size > 0) {
            const remaining = Array.from(pending);
            remaining.forEach((id) => {
                results.set(id, { status: "blocked" });
            });
            break;
        }

        const launches = toLaunch.map(async (task) => {
            running.add(task.task);
            if (onRunningTasksChange) {
                onRunningTasksChange(tasks.filter((runningTask) => running.has(runningTask.task)));
            }
            pending.delete(task.task);

            const agentName = task.assignee || AGENTS.ENGINEER;

            const taskHeader = `--- Task ${task.task}: ${task.description} (→ ${getAgentDisplayName(agentName)}) ---`;
            uiAPI.appendSystemMessage(taskHeader, false, "Harns");

            const taskRequest = [
                "## Task Assignment",
                `You are assigned Task ${task.task} from the plan "${planName}". This is a PROJECT plan, only execute the assigned task then halt.`,
                "### Task Description",
                task.description,
                "### Dependencies",
                task.dependencies || "None",
                "### Write Scope",
                task.writeScope || "unknown",
                "### Full Plan Context",
                planBody,
            ].filter(Boolean).join("\n\n");

            try {
                const sessionMessages = await runAgentSession({
                    agentName,
                    userRequest: taskRequest,
                    uiAPI: createSilentUiApi(),
                });

                const outputText = extractAssistantOutput(sessionMessages);
                const completed = readLatestTaskCompletedOutcome(sessionMessages);

                if (Deno.env.get("DEBUG") === "1") {
                    const debugEntry = [
                        `=== TASK ${task.task} (${agentName}) AGENT RESPONSE ===`,
                        `=== Output text: ${outputText ? outputText.slice(0, 500) : "(empty)"} ===`,
                        `=== Total messages: ${sessionMessages.length} ===`,
                        `=== Assistant messages: ${
                            sessionMessages.filter((message) => "role" in message && message.role === "assistant")
                                .length
                        } ===`,
                        `===========================================`,
                        "",
                    ].join("\n");
                    try {
                        Deno.writeTextFileSync(join(Deno.cwd(), "debug.log"), debugEntry, { append: true });
                    } catch (_e) { /* ignore */ }
                }

                const block = uiAPI.appendAgentMessageStart(
                    `${getAgentDisplayName(agentName)} (Task ${task.task} Output)`,
                );
                block.appendText(outputText || "_no output received_");

                if (!completed) {
                    const error = "Task ended without calling task_completed.";
                    uiAPI.appendSystemMessage(
                        `Task ${task.task} incomplete (${getAgentDisplayName(agentName)}): ${error}`,
                        false,
                        "Harns",
                    );
                    results.set(task.task, { status: "failed", error, messages: sessionMessages });

                    if (sessionManager?.appendCustomMessageEntry) {
                        sessionManager.appendCustomMessageEntry(
                            "task_result",
                            `Task ${task.task} (${getAgentDisplayName(agentName)}) INCOMPLETE: ${error}\n\n${
                                outputText || "(no output)"
                            }`,
                            true,
                            { taskId: task.task, agentName, status: "failed", error, output: outputText || "" },
                        );
                    }
                    return;
                }

                results.set(task.task, { status: "success", messages: sessionMessages });

                // Append a single record of the task's final assistant output to the root
                // session, so /resume can replay a complete picture of what each parallel
                // sub-agent did. The transient in-memory session itself is discarded.
                if (sessionManager?.appendCustomMessageEntry) {
                    const display = `Task ${task.task} (${getAgentDisplayName(agentName)}) — ${task.description}\n\n` +
                        (outputText || "(no output)");
                    sessionManager.appendCustomMessageEntry(
                        "task_result",
                        display,
                        true,
                        { taskId: task.task, agentName, status: "success", output: outputText || "" },
                    );
                }
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                uiAPI.appendSystemMessage(
                    `❌ Task ${task.task} failed (${getAgentDisplayName(agentName)}): ${error.message}`,
                    false,
                    "Harns",
                );
                results.set(task.task, { status: "failed", error: error.message });

                if (sessionManager?.appendCustomMessageEntry) {
                    sessionManager.appendCustomMessageEntry(
                        "task_result",
                        `Task ${task.task} (${getAgentDisplayName(agentName)}) FAILED: ${error.message}`,
                        true,
                        { taskId: task.task, agentName, status: "failed", error: error.message },
                    );
                }
            } finally {
                running.delete(task.task);
                if (onRunningTasksChange) {
                    onRunningTasksChange(tasks.filter((runningTask) => running.has(runningTask.task)));
                }
            }
        });

        if (launches.length > 0) {
            await Promise.race(launches);
        } else if (running.size > 0) {
            await new Promise((r) => setTimeout(r, 100));
            continue;
        } else if (pending.size === 0) {
            break;
        } else {
            tasks.filter((task) => pending.has(task.task)).forEach((task) => {
                results.set(task.task, { status: "blocked" });
            });
            break;
        }
    }

    const failedTasks = tasks
        .filter((task) => {
            const status = results.get(task.task)?.status;
            return status === "failed" || status === "blocked";
        })
        .map((task) => task.task);
    return { failedTasks, results };
}

/**
 * @param {{ failedTasks: number[], results: Map<number, { status: string, error?: string }> }} executionResult
 * @param {UiAPI} uiAPI
 */
async function askRetryFailedTasks(executionResult, uiAPI) {
    const { failedTasks } = executionResult;
    const msg = `[Harns] ${failedTasks.length} task(s) failed. Would you like to retry the failed tasks?`;
    return await uiAPI.promptSelect(msg, [
        { value: "yes", label: "Yes, retry failed tasks" },
        { value: "no", label: "No, finalize execution" },
    ]) === "yes";
}

/**
 * @param {{ results: Map<number, { status: string, error?: string }> }} result
 * @param {UiAPI} uiAPI
 */
function reportExecutionSummary(result, uiAPI) {
    const { results } = result;
    let successCount = 0, failedCount = 0, blockedCount = 0;

    results.forEach((result) => {
        if (result.status === "success") successCount++;
        else if (result.status === "failed") failedCount++;
        else if (result.status === "blocked") blockedCount++;
    });

    const summary = `Execution Summary: ${successCount} success, ${failedCount} failed, ${blockedCount} blocked.`;
    uiAPI.appendSystemMessage(summary, false, "Harns");
}

/**
 * Project-specific post-approval selection that also prints task list.
 *
 * @param {string} planName
 * @param {UiAPI} uiAPI
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} [structuredTasks]
 * @returns {Promise<"proceed" | "save">}
 */
export async function askApprovalWithTasks(planName, uiAPI, structuredTasks) {
    const plan = await loadPlan(CWD, planName);

    let tasks = structuredTasks || [];
    if (tasks.length === 0 && plan) {
        try {
            tasks = extractTasks(plan.markdown);
            validateProjectTasks(tasks);
        } catch {
            // proceed with 0 tasks; execution will report repair needed if markdown also fails
        }
    }

    let title = `Project plan "${planName}" approved!`;
    if (tasks.length > 0) {
        title += `\nTasks:\n` +
            tasks.map((t) => `  ${t.task}. [${t.assignee}] ${t.description}`).join(
                "\n",
            );
    }

    const options = [
        {
            value: "proceed",
            label: "Proceed with execution (tasks run in dependency order)",
        },
        { value: "save", label: "Save for later" },
    ];

    const choice = await uiAPI.promptSelect(`${title}\nWhat next?`, options);
    return choice === "proceed" ? "proceed" : "save";
}

/**
 * Run engineer against the full approved plan body.
 *
 * @param {string} planName
 * @param {string} planBody
 * @param {UiAPI} uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [_sessionManager]
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} [_triageMeta]
 * @returns {Promise<{ completed: boolean, messages: import('@earendil-works/pi-agent-core').AgentMessage[] }>}
 */
async function runEngineerWithPlan(planName, planBody, uiAPI, _sessionManager, _triageMeta = {}) {
    uiAPI.appendSystemMessage(
        `=== Running ${getAgentDisplayName(AGENTS.ENGINEER)} ===`,
        false,
        "Harns",
    );

    const engineerRequest = [
        `## Approved Plan: ${planName}`,
        "",
        "Execute the following plan step by step. This is a FEATURE request. Complete all Implementation Steps and the Verification Plan before halting.",
        "",
        planBody,
    ].join("\n");

    const { setActiveAgent, applyPendingRootSwap } = await import("../interactive/chat-session.js");
    const { createDirectAgentHandler } = await import("../session/direct-agent.js");
    setActiveAgent(AGENTS.ENGINEER, createDirectAgentHandler(AGENTS.ENGINEER), uiAPI);
    await applyPendingRootSwap(uiAPI);

    const { runRootTurn } = await import("../session/session.js");
    const messages = await runRootTurn({
        agentName: AGENTS.ENGINEER,
        userRequest: engineerRequest,
        uiAPI,
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
 * @returns {Promise<void>}
 */
async function startActiveExecutionWorkflow(planName, triageMeta, currentStatus) {
    const existing = getActiveExecutionWorkflow();
    if (existing?.planName === planName && existing.baselineTree) {
        setActiveExecutionWorkflow({ ...existing, triageMeta });
        return;
    }

    const baselineTree = await captureWorktreeTree(CWD);
    setActiveExecutionWorkflow({ planName, triageMeta, baselineTree });
    await recordPlanEvent({
        cwd: CWD,
        planName,
        event: "execution_started",
        currentStatus,
        details: { triageMeta, executionBaselineTree: baselineTree },
    });
}
