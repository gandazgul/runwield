/**
 * @module shared/workflow
 * Shared review-loop and execution helpers reused by router/resume commands.
 */

import { join } from "@std/path";
import { CWD, MAX_PARALLEL_TASKS, PLANS_DIR_NAME } from "../constants.js";
import { submitPlanForReview } from "../tools/submit-plan.js";
import { loadPlan } from "../plan-store.js";
import { runAgentSession } from "./session.js";
import { confirm, select } from "./prompts.js";
import { extractPlanWritten } from "./triage.js";

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
        // Scan all content blocks for a text block
        for (const block of msg.content) {
            if (block && typeof block === "object" && "type" in block && block.type === "text" && block.text?.trim()) {
                return block.text.trim();
            }
        }
    }
    return null;
}

/**
 * @typedef {Object} UiAPI
 * @property {(text: string, isError?: boolean) => void} appendSystemMessage
 * @property {(agentName: string) => {appendText: (delta: string) => void}} appendAgentMessageStart
 * @property {(text: string) => void} [appendUserMessage]
 * @property {(base64: string, mimeType: string) => void} [appendImage]
 * @property {() => void} requestRender
 * @property {() => void} [advanceSpinner]
 * @property {(busy: boolean) => void} [setBusy]
 * @property {(tasks: Array<{task: number, assignee: string, description: string}>) => void} [setRunningTasks]
 * @property {(title: string, options: Array<{value: string, label: string}>) => Promise<string | null>} promptSelect
 * @property {(agentName: string, agentModel: string) => void} [setAgentInfo]
 * @property {() => void} [disableInput]
 * @property {() => void} [enableInput]
 * @property {(id: string, name: string, argsStr: string) => any} [startToolExecution]
 * @property {(id: string) => any} [getActiveToolBlock]
 * @property {() => void} [toggleToolOutputsExpanded]
 */

/**
 * Resolve the declared plan path from planner/architect tool output.
 *
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
 * @returns {Promise<{ name: string, path: string, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> } | null>}
 */
async function resolveDeclaredPlan(messages) {
    const declared = extractPlanWritten(messages);
    if (!declared) return null;

    const planName = declared.planName.replace(/\.md$/i, "");
    if (!planName) return null;

    const planPath = join(CWD, PLANS_DIR_NAME, `${planName}.md`);
    try {
        const stat = await Deno.stat(planPath);
        if (!stat.isFile) return null;
    } catch {
        return null;
    }

    return { name: planName, path: planPath, tasks: declared.tasks };
}

/**
 * Run the planning review loop until approved/failed.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames]
 * @param {string} opts.initialRequest - The initial user request to send to the planning agent
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {Partial<import('../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {number} [opts.maxRevisions=5]
 * @param {UiAPI} [opts.uiAPI]
 * @returns {Promise<{ planName: string, planPath: string, approved: true, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> } | null>}
 */
export async function reviewLoop({
    agentName,
    toolNames,
    initialRequest,
    customTools,
    triageMeta,
    maxRevisions = 5,
    uiAPI,
}) {
    let currentRequest = initialRequest;
    let revision = 0;

    while (revision < maxRevisions) {
        if (revision === 0) {
            if (uiAPI) {
                uiAPI.appendSystemMessage(`[Harns] === Running ${agentName} ===`);
            } else console.log(`\n[Harns] === Running ${agentName} ===\n`);
        } else {
            const msg = `[Harns] === Revising plan (attempt ${revision + 1}/${maxRevisions}) ===`;
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.log(`\n${msg}\n`);
        }

        const planningMessages = await runAgentSession({
            agentName,
            toolNames,
            customTools,
            userRequest: currentRequest,
            uiAPI,
        });

        const planInfo = await resolveDeclaredPlan(planningMessages);
        if (!planInfo) {
            const msg = "[Harns] ERROR: Agent did not declare a valid plan via plan_written.";
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.error(`\n${msg}`);
            return null;
        }

        if (uiAPI) {
            uiAPI.appendSystemMessage(
                `[Harns] Plan created: plans/${planInfo.name}.md`,
            );
        } else console.log(`\n[Harns] Plan created: plans/${planInfo.name}.md`);

        const result = await submitPlanForReview({
            cwd: CWD,
            planName: planInfo.name,
            planPath: planInfo.path,
            triageMeta,
            uiAPI,
        });

        if (result.approved) {
            return {
                planName: planInfo.name,
                planPath: planInfo.path,
                approved: true,
                tasks: planInfo.tasks,
            };
        }

        revision++;
        if (uiAPI) {
            uiAPI.appendSystemMessage(
                `[Harns] Plan denied. Feeding feedback back to ${agentName}...`,
            );
        } else {console.log(
                `\n[Harns] Plan denied. Feeding feedback back to ${agentName}...`,
            );}

        currentRequest = [
            `## Previous Plan Feedback (Round ${revision})`,
            "",
            "Your plan was denied. Here is the structured feedback from the user:",
            "",
            result.feedback || "(no specific feedback provided)",
            "",
            `Please revise your plan in plans/${planInfo.name}.md based on this feedback.`,
            "Use the `edit` tool to make targeted revisions — do NOT rewrite the entire plan.",
            "Address each piece of feedback specifically.",
            "After saving revisions, call the plan_written tool again with the same plan name.",
        ].join("\n");
    }

    const msg = `[Harns] Max revisions (${maxRevisions}) reached. Plan not approved.`;
    if (uiAPI) uiAPI.appendSystemMessage(msg);
    else console.error(`\n${msg}`);
    return null;
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
        /\|\s*(\d+)\s*\|\s*(\w[\w-]*)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|/g,
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
 * @param {Partial<import('../plan-store.js').PlanFrontMatter>} triageMeta
 * @param {UiAPI} [uiAPI]
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string }>} [structuredTasks]
 */
export async function executePlan(planName, triageMeta, uiAPI, structuredTasks) {
    const plan = await loadPlan(CWD, planName);
    if (!plan) {
        const err = `[Harns] ERROR: Could not load plan ${planName}`;
        if (uiAPI) {
            uiAPI.appendSystemMessage(err);
            return;
        }
        console.error(err);
        Deno.exit(1);
    }

    if (uiAPI) {
        uiAPI.appendSystemMessage(`[Harns] === Executing Plan: ${planName} ===`);
    } else console.log(`\n[Harns] === Executing Plan: ${planName} ===\n`);

    if (triageMeta.classification === "PROJECT") {
        try {
            const tasks = structuredTasks && structuredTasks.length > 0 ? structuredTasks : extractTasks(plan.markdown);

            if (tasks.length > 0) {
                if (uiAPI) {
                    uiAPI.appendSystemMessage(
                        `[Harns] Found ${tasks.length} tasks in plan. Executing in parallel where possible.`,
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
                            uiAPI && uiAPI.appendSystemMessage(`[Harns] ✅ All tasks eventually completed.`);
                        }
                    } else {
                        await reportExecutionSummary(executionResult, uiAPI);
                    }
                } else {
                    uiAPI && uiAPI.appendSystemMessage(`[Harns] ✅ All tasks completed successfully.`);
                }
            } else {
                await runEngineerWithPlan(planName, plan.body, uiAPI);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            const msg = `[Harns] TASK TABLE ERROR: ${error.message}`;
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.error(`\n${msg}`);

            // Return status that triggers repair loop in the caller (Router/Resume)
            return { repairRequired: true, error: error.message };
        }
    } else {
        await runEngineerWithPlan(planName, plan.body, uiAPI);
    }

    if (uiAPI) {
        uiAPI.appendSystemMessage(
            `[Harns] ✅ Plan execution complete: ${planName}`,
        );
    } else console.log(`\n[Harns] ✅ Plan execution complete: ${planName}`);
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
    /** @type {Map<number, { status: "success" | "failed" | "blocked", error?: string, messages?: any[] }>} */
    const results = new Map();
    const pending = new Set(tasks.map((t) => t.task));
    const running = new Set();
    const failed = new Set();

    // If we are retrying, seed the state
    if (seedFailedTasks.length > 0) {
        const processed = tasks.filter((t) => !seedFailedTasks.includes(t.task)).map((t) => t.task);
        processed.forEach((id) => results.set(id, { status: "success" }));
        seedFailedTasks.forEach((id) => pending.add(id));
    }

    while (results.size < tasks.length) {
        // 1. Identify ready tasks (pending, dependencies satisfied, not running)
        const ready = tasks.filter((t) => {
            if (!pending.has(t.task)) return false;
            const deps = (t.dependencies || "").split(",").map((d) => d.trim()).filter((d) =>
                d && d.toLowerCase() !== "none"
            );
            return deps.every((d) => {
                const depId = parseInt(d);
                if (isNaN(depId)) return true; // permissive for non-numeric deps
                return results.has(depId) && results.get(depId)?.status === "success";
            });
        });

        // 2. Launch up to MAX_PARALLEL_TASKS
        const toLaunch = ready.slice(0, MAX_PARALLEL_TASKS - running.size);

        if (toLaunch.length === 0 && running.size === 0 && pending.size > 0) {
            // Deadlock or all remaining are blocked by failures
            const remaining = Array.from(pending);
            remaining.forEach((id) => {
                results.set(id, { status: "blocked" });
            });
            break;
        }

        const launches = toLaunch.map(async (task) => {
            running.add(task.task);
            if (onRunningTasksChange) {
                onRunningTasksChange(tasks.filter((t) => running.has(t.task)));
            }
            pending.delete(task.task);

            const agentName = task.assignee === "engineer"
                ? "engineer"
                : task.assignee === "tester"
                ? "tester"
                : task.assignee === "doc-writer"
                ? "doc-writer"
                : "engineer";

            const header = `[Harns] --- Task ${task.task}: ${task.description} (→ ${agentName}) ---`;
            if (uiAPI) uiAPI.appendSystemMessage(header);
            else console.log(`\n${header}\n`);

            const taskRequest = [
                "## Task Assignment",
                `You are assigned Task ${task.task} from the plan "${planName}".`,
                "### Task Description",
                task.description,
                "### Dependencies",
                task.dependencies || "None",
                "### Full Plan Context",
                planBody,
            ].filter(Boolean).join("\n\n");

            const taskTools = undefined;

            try {
                // We do NOT use uiAPI directly for rendering text chunks for concurrent tasks
                // because multiple agents printing simultaneously to the main TUI
                // would corrupt the markdown/text block UI. Instead, we use a mock/proxy uiAPI
                // that buffers or handles the progress animation internally, and only append
                // exactly when the task completes.

                // For now, we will notify that the task is starting, but we won't pass uiAPI
                // so that session text output is redirected/supressed until we have a better way
                // to visualize it.
                const mockUiAPI = uiAPI
                    ? {
                        appendUserMessage: () => {},
                        appendAgentMessageStart: () => ({ appendText: () => {} }),
                        appendSystemMessage: () => {},
                        startToolExecution: () => ({ appendOutput: () => {}, endExecution: () => {} }),
                        getActiveToolBlock: () => undefined,
                        setBusy: () => {},
                        advanceSpinner: () => {},
                        requestRender: () => {},
                        promptSelect: () => Promise.resolve(null),
                    }
                    : undefined;

                const sessionMessages = await runAgentSession({
                    agentName,
                    toolNames: taskTools,
                    userRequest: taskRequest,
                    uiAPI: mockUiAPI, // Avoid concurrent TUI text writes and silence terminal
                });

                // Extract text from last assistant message, scanning all content blocks
                const outputText = extractAssistantOutput(sessionMessages);

                if (Deno.env.get("DEBUG") === "1") {
                    const debugEntry = [
                        `=== TASK ${task.task} (${agentName}) AGENT RESPONSE ===`,
                        `=== Output text: ${outputText ? outputText.slice(0, 500) : "(empty)"} ===`,
                        `=== Total messages: ${sessionMessages.length} ===`,
                        `=== Assistant messages: ${
                            sessionMessages.filter((m) => "role" in m && m.role === "assistant").length
                        } ===`,
                        `===========================================`,
                        "",
                    ].join("\n");
                    try {
                        Deno.writeTextFileSync(join(Deno.cwd(), "debug.log"), debugEntry, { append: true });
                    } catch (_e) { /* ignore */ }
                }

                // Always show the output block, even if empty
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
                    uiAPI.appendSystemMessage(`[Harns] ❌ Task ${task.task} failed (${agentName}): ${error.message}`);
                }
                results.set(task.task, { status: "failed", error: error.message });
                failed.add(task.task);
            } finally {
                running.delete(task.task);
                if (onRunningTasksChange) {
                    onRunningTasksChange(tasks.filter((t) => running.has(t.task)));
                }
            }
        });

        // Wait for at least one to finish to re-evaluate readiness
        if (launches.length > 0) {
            await Promise.race(launches);
        } else if (running.size > 0) {
            // Fallback to wait for all running if none ready
            // We use a small delay and continue looping while jobs run
            await new Promise((r) => setTimeout(r, 100)); // check again soon
            continue;
        } else if (pending.size === 0) {
            break;
        } else {
            // Blocked dependencies
            tasks.filter((t) => pending.has(t.task)).forEach((t) => {
                results.set(t.task, { status: "blocked" });
            });
            break;
        }
    }

    const failedTasks = tasks.filter((t) => results.get(t.task)?.status === "failed").map((t) => t.task);
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

    results.forEach((res) => {
        if (res.status === "success") successCount++;
        else if (res.status === "failed") failedCount++;
        else if (res.status === "blocked") blockedCount++;
    });

    const summary =
        `[Harns] Execution Summary: ${successCount} success, ${failedCount} failed, ${blockedCount} blocked.`;
    if (uiAPI) uiAPI.appendSystemMessage(summary);
    else console.log(`\n${summary}\n`);
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
            // we'll proceed with 0 tasks and perhaps fail during execute if markdown also parsing fails
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
 */
async function runEngineerWithPlan(planName, planBody, uiAPI) {
    if (uiAPI) uiAPI.appendSystemMessage("[Harns] === Running Engineer ===");
    else console.log("[Harns] === Running Engineer ===\n");

    const engineerRequest = [
        `## Approved Plan: ${planName}`,
        "",
        "Execute the following plan step by step. Implement each step, verify the result, then move on.",
        "",
        planBody,
    ].join("\n");

    await runAgentSession({
        agentName: "engineer",
        userRequest: engineerRequest,
        uiAPI,
    });
}
