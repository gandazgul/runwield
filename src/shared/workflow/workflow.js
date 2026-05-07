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
import { CWD, MAX_PARALLEL_TASKS } from "../../constants.js";
import { loadPlan, updatePlanStatus } from "../../plan-store.js";
import { runAgentSession } from "../session/session.js";
import { confirm, select } from "../prompts.js";

/**
 * Extract the last text output from the agent's assistant messages.
 * Scans messages in reverse, checking ALL content blocks (not just [0])
 * to handle cases where tool_use blocks appear alongside text.
 *
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
 * @returns {string | null}
 */
function extractAssistantOutput(messages) {
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
 * @property {Array<{ task: number, assignee: string, dependencies: string, description: string }>} [tasks]
 * @property {import('../../tools/plan-written.js').TriageMeta} [triageMeta]
 */

/**
 * Read the latest plan_written tool result's outcome from a message stream.
 *
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
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
 * Run a planning agent (planner/architect) once and return the lifecycle outcome
 * captured by plan_written. Does NOT execute the plan — call `executePlan`
 * afterwards if the outcome is `approved_execute`.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string} opts.initialRequest
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {UiAPI} [opts.uiAPI]
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @returns {Promise<PlanOutcomeResult>}
 */
export async function runPlanningAgent({ agentName, initialRequest, triageMeta, uiAPI, sessionManager }) {
    if (uiAPI) uiAPI.appendSystemMessage(`=== Running ${agentName} ===`, false, "Harns");
    else console.log(`\n[Harns] === Running ${agentName} ===\n`);

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
 * Ask user what to do after plan approval.
 *
 * @param {string} planName
 * @param {UiAPI} [uiAPI]
 * @returns {Promise<"proceed" | "save">}
 */
export async function askPostApproval(planName, uiAPI) {
    const title = `Plan "${planName}" approved! What next?`;
    const options = [
        { value: "proceed", label: "Proceed with execution" },
        { value: "save", label: "Save for later" },
    ];
    const choice = uiAPI && uiAPI.promptSelect
        ? await uiAPI.promptSelect(title, options)
        : await select(title, options);
    return choice === "proceed" ? "proceed" : "save";
}

/**
 * Parse PROJECT task table from plan markdown body with validation.
 *
 * @param {string} planContent
 * @returns {Array<{ task: number, assignee: string, dependencies: string, description: string }>}
 * @throws {Error} If task table is malformed for a PROJECT plan.
 */
export function extractTasks(planContent) {
    const tasks =
        /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string }>} */ ([]);
    const taskSection = planContent.match(
        /### Tasks\s*\n([\s\S]*?)(?=\n(?:###|##)[^\n]*|\n*$)/,
    );

    if (!taskSection) {
        throw new Error(
            "Tasks table not found. PROJECT plans must include a '### Tasks' section with a formatted table.",
        );
    }

    const rows = taskSection[1].matchAll(
        /\|\s*(\d+)\s*\|\s*(\w[\w-]*)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*(?:\|)?\s*$/gm,
    );

    for (const match of rows) {
        tasks.push({
            task: parseInt(match[1]),
            assignee: match[2].trim(),
            dependencies: match[3].trim(),
            description: match[4].trim(),
        });
    }

    if (tasks.length === 0) {
        throw new Error("Tasks table found but contains no valid task rows.");
    }

    return tasks;
}

/**
 * Execute an approved plan.
 *
 * @param {string} planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} triageMeta
 * @param {UiAPI} [uiAPI]
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string }>} [structuredTasks]
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [sessionManager]
 */
export async function executePlan(planName, triageMeta, uiAPI, structuredTasks, sessionManager) {
    const plan = await loadPlan(CWD, planName);
    if (!plan) {
        if (uiAPI) {
            uiAPI.appendSystemMessage(`ERROR: Could not load plan ${planName}`, true, "Harns");
            return;
        }
        console.error(`[Harns] ERROR: Could not load plan ${planName}`);
        Deno.exit(1);
    }

    if (uiAPI) {
        uiAPI.appendSystemMessage(`=== Executing Plan: ${planName} ===`, false, "Harns");
    } else console.log(`\n[Harns] === Executing Plan: ${planName} ===\n`);

    if (triageMeta.classification === "PROJECT") {
        try {
            const tasks = structuredTasks && structuredTasks.length > 0 ? structuredTasks : extractTasks(plan.markdown);

            if (tasks.length > 0) {
                if (uiAPI) {
                    uiAPI.appendSystemMessage(
                        `Found ${tasks.length} tasks in plan. Executing in parallel where possible.`,
                        false,
                        "Harns",
                    );
                } else {console.log(
                        `[Harns] Found ${tasks.length} tasks in plan. Executing in parallel where possible.\n`,
                    );}

                let localActiveTasks = 0;
                let spinnerInterval;

                if (uiAPI && uiAPI.advanceSpinner && typeof setInterval !== "undefined") {
                    spinnerInterval = setInterval(() => {
                        if (localActiveTasks > 0) {
                            if (uiAPI.advanceSpinner) uiAPI.advanceSpinner();
                        }
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
                        if (uiAPI && uiAPI.setRunningTasks) uiAPI.setRunningTasks(runningTasks);
                    },
                );

                if (spinnerInterval) clearInterval(spinnerInterval);

                if (executionResult.failedTasks.length > 0) {
                    const retry = await askRetryFailedTasks(executionResult, uiAPI);
                    if (retry) {
                        localActiveTasks = 0;
                        if (uiAPI && uiAPI.advanceSpinner && typeof setInterval !== "undefined") {
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
                                if (uiAPI && uiAPI.setRunningTasks) uiAPI.setRunningTasks(runningTasks);
                            },
                        );
                        if (spinnerInterval) clearInterval(spinnerInterval);
                        if (finalResult.failedTasks.length > 0) {
                            await reportExecutionSummary(finalResult, uiAPI);
                        } else {
                            uiAPI && uiAPI.appendSystemMessage(`✅ All tasks eventually completed.`, false, "Harns");
                        }
                    } else {
                        await reportExecutionSummary(executionResult, uiAPI);
                    }
                } else {
                    uiAPI && uiAPI.appendSystemMessage(`✅ All tasks completed successfully.`, false, "Harns");
                }
            } else {
                await runEngineerWithPlan(planName, plan.body, uiAPI, sessionManager);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            if (uiAPI) uiAPI.appendSystemMessage(`TASK TABLE ERROR: ${error.message}`, true, "Harns");
            else console.error(`\n[Harns] TASK TABLE ERROR: ${error.message}`);

            return { repairRequired: true, error: error.message };
        }
    } else {
        await runEngineerWithPlan(planName, plan.body, uiAPI);
    }

    if (uiAPI) {
        uiAPI.appendSystemMessage(
            `✅ Plan execution complete: ${planName}`,
            false,
            "Harns",
        );
    } else console.log(`\n[Harns] ✅ Plan execution complete: ${planName}`);
    await updatePlanStatus(CWD, planName, "completed", triageMeta);
    return { repairRequired: false };
}

/**
 * @param {string} planName
 * @param {string} planBody
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string }>} tasks
 * @param {UiAPI} [uiAPI]
 * @param {number[]} [seedFailedTasks]
 * @param {(runningTasks: Array<{task: number, assignee: string, description: string}>) => void} [onRunningTasksChange]
 */
async function executeProjectTasks(
    planName,
    planBody,
    tasks,
    uiAPI,
    seedFailedTasks = [],
    onRunningTasksChange,
) {
    /** @type {Map<number, import('./types.js').TaskExecutionResult>} */
    const results = new Map();
    const pending = new Set(tasks.map((task) => task.task));
    const running = new Set();
    const failed = new Set();

    if (seedFailedTasks.length > 0) {
        const processed = tasks.filter((task) => !seedFailedTasks.includes(task.task)).map((task) => task.task);
        processed.forEach((id) => results.set(id, { status: "success" }));
        seedFailedTasks.forEach((id) => pending.add(id));
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

        const toLaunch = ready.slice(0, MAX_PARALLEL_TASKS - running.size);

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

            const agentName = task.assignee || "engineer";

            const taskHeader = `--- Task ${task.task}: ${task.description} (→ ${agentName}) ---`;
            if (uiAPI) uiAPI.appendSystemMessage(taskHeader, false, "Harns");
            else console.log(`\n[Harns] ${taskHeader}\n`);

            const taskRequest = [
                "## Task Assignment",
                `You are assigned Task ${task.task} from the plan "${planName}". This is a PROJECT plan, only execute the assigned task then halt.`,
                "### Task Description",
                task.description,
                "### Dependencies",
                task.dependencies || "None",
                "### Full Plan Context",
                planBody,
            ].filter(Boolean).join("\n\n");

            const taskTools = undefined;

            try {
                const mockUiAPI = uiAPI
                    ? {
                        appendUserMessage: () => {},
                        appendAgentMessageStart: () => ({ appendText: () => {} }),
                        appendSystemMessage: () => {},
                        startToolExecution: () => ({
                            appendOutput: () => {},
                            endExecution: () => {},
                            startTime: Date.now(),
                        }),
                        getActiveToolBlock: () => undefined,
                        setBusy: () => {},
                        advanceSpinner: () => {},
                        requestRender: () => {},
                        promptSelect: () => Promise.resolve(null),
                        promptText: () => Promise.resolve(null),
                    }
                    : undefined;

                const sessionMessages = await runAgentSession({
                    agentName,
                    toolNames: taskTools,
                    userRequest: taskRequest,
                    uiAPI: mockUiAPI,
                });

                const outputText = extractAssistantOutput(sessionMessages);

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

                if (uiAPI) {
                    const block = uiAPI.appendAgentMessageStart(`${agentName} (Task ${task.task} Output)`);
                    block.appendText(outputText || "_no output received_");
                } else if (outputText) {
                    console.log(`\n${agentName} (Task ${task.task} Output):\n${outputText}\n`);
                } else {
                    console.log(`\n${agentName} (Task ${task.task} Output): no output received\n`);
                }
                results.set(task.task, { status: "success", messages: sessionMessages });
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                if (uiAPI) {
                    uiAPI.appendSystemMessage(
                        `❌ Task ${task.task} failed (${agentName}): ${error.message}`,
                        false,
                        "Harns",
                    );
                }
                results.set(task.task, { status: "failed", error: error.message });
                failed.add(task.task);
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

    const failedTasks = tasks.filter((task) => results.get(task.task)?.status === "failed").map((task) => task.task);
    return { failedTasks, results };
}

/**
 * @param {{ failedTasks: number[], results: Map<number, { status: string, error?: string }> }} executionResult
 * @param {UiAPI} [uiAPI]
 */
async function askRetryFailedTasks(executionResult, uiAPI) {
    const { failedTasks } = executionResult;
    const msg = `[Harns] ${failedTasks.length} task(s) failed. Would you like to retry the failed tasks?`;
    if (uiAPI && uiAPI.promptSelect) {
        return await uiAPI.promptSelect(msg, [
            { value: "yes", label: "Yes, retry failed tasks" },
            { value: "no", label: "No, finalize execution" },
        ]) === "yes";
    }
    return await confirm(msg);
}

/**
 * @param {{ results: Map<number, { status: string, error?: string }> }} result
 * @param {UiAPI} [uiAPI]
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
    if (uiAPI) uiAPI.appendSystemMessage(summary, false, "Harns");
    else console.log(`\n[Harns] ${summary}\n`);
}

/**
 * Project-specific post-approval selection that also prints task list.
 *
 * @param {string} planName
 * @param {UiAPI} [uiAPI]
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string }>} [structuredTasks]
 * @returns {Promise<"proceed" | "save">}
 */
export async function askApprovalWithTasks(planName, uiAPI, structuredTasks) {
    const plan = await loadPlan(CWD, planName);

    let tasks = structuredTasks || [];
    if (tasks.length === 0 && plan) {
        try {
            tasks = extractTasks(plan.markdown);
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

    const choice = uiAPI && uiAPI.promptSelect
        ? await uiAPI.promptSelect(`${title}\nWhat next?`, options)
        : await select(`${title}\nWhat next?`, options);
    return choice === "proceed" ? "proceed" : "save";
}

/**
 * Run engineer against the full approved plan body.
 *
 * @param {string} planName
 * @param {string} planBody
 * @param {UiAPI} [uiAPI]
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [sessionManager]
 */
async function runEngineerWithPlan(planName, planBody, uiAPI, sessionManager) {
    if (uiAPI) uiAPI.appendSystemMessage("=== Running Engineer ===", false, "Harns");
    else console.log("[Harns] === Running Engineer ===\n");

    const engineerRequest = [
        `## Approved Plan: ${planName}`,
        "",
        "Execute the following plan step by step. This is a FEATURE request. Complete all Implementation Steps and the Verification Plan before halting.",
        "",
        planBody,
    ].join("\n");

    await runAgentSession({
        agentName: "engineer",
        userRequest: engineerRequest,
        uiAPI,
        sessionManager,
    });
}
