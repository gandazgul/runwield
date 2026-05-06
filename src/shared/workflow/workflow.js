/**
 * @module shared/workflow
 * Shared review-loop and execution helpers reused by router/resume commands.
 */

import { join } from "@std/path";
import { CLI_BIN, CWD, MAX_PARALLEL_TASKS, PLANS_DIR_NAME } from "../../constants.js";
import { submitPlanForReview } from "./submit-plan.js";
import { loadPlan, updatePlanStatus } from "../../plan-store.js";
import { runAgentSession } from "../session/session.js";
import { confirm, select } from "../prompts.js";
import { extractPlanWritten } from "../../cmd/router/triage.js";

/**
 * @param {string} planName
 * @param {string} error
 * @returns {string}
 */
export function buildRepairPrompt(planName, error) {
    return `The previously approved plan "${planName}" had a malformed Tasks table: ${error}.\n\nPlease fix the table to ensure it follows the required format (Task ID | Assignee | Dependencies | Description). If any requirement is unclear, use user_interview (1-3 focused questions) before finalizing, then call plan_written again.`;
}

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
 * @typedef {import('../ui/types.js').UiAPI} UiAPI
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
 * Build the planner/architect revision request after a denied plan review.
 *
 * @param {Object} opts
 * @param {number} opts.round
 * @param {string} opts.planName
 * @param {string | undefined} opts.feedback
 * @returns {string}
 */
export function buildDeniedFeedbackRequest({ round, planName, feedback }) {
    return [
        `## Previous Plan Feedback (Round ${round})`,
        "",
        "Your plan was denied. Here is the structured feedback from the user:",
        "",
        feedback || "(no specific feedback provided)",
        "",
        `Please revise your plan in plans/${planName}.md based on this feedback.`,
        "Use the `edit` tool to make targeted revisions — do NOT rewrite the entire plan.",
        "Address each piece of feedback specifically.",
        "After saving revisions, call the plan_written tool again with the same plan name.",
    ].join("\n");
}

/**
 * Run the planning review loop until approved/canceled/failed.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames]
 * @param {string} opts.initialRequest - The initial user request to send to the planning agent
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {number} [opts.maxRevisions=Infinity]
 * @param {UiAPI} [opts.uiAPI]
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @returns {Promise<{ planName: string, planPath: string, approved: true, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> } | { canceled: true } | null>}
 */
export async function reviewLoop({
    agentName,
    toolNames,
    initialRequest,
    customTools,
    triageMeta,
    maxRevisions = Number.POSITIVE_INFINITY,
    uiAPI,
    sessionManager,
}) {
    let currentRequest = initialRequest;
    let revision = 0;

    while (revision < maxRevisions) {
        if (revision === 0) {
            if (uiAPI) {
                uiAPI.appendSystemMessage(`[Harns] === Running ${agentName} ===`);
            } else console.log(`\n[Harns] === Running ${agentName} ===\n`);
        } else {
            const attemptSuffix = Number.isFinite(maxRevisions)
                ? ` (attempt ${revision + 1}/${maxRevisions})`
                : ` (attempt ${revision + 1})`;
            const msg = `[Harns] === Revising plan${attemptSuffix} ===`;
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.log(`\n${msg}\n`);
        }

        const planningMessages = await runAgentSession({
            agentName,
            toolNames,
            customTools,
            userRequest: currentRequest,
            uiAPI,
            sessionManager,
        });

        const planInfo = await resolveDeclaredPlan(planningMessages);
        if (!planInfo) {
            const msg = "[Harns] ERROR: Agent did not declare a valid plan via plan_written.";
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.error(`\n${msg}`);
            return null;
        }

        // Enforce PROJECT-only validation: if classification is PROJECT, tasks must be present and non-empty.
        if (triageMeta?.classification === "PROJECT" && (!planInfo.tasks || planInfo.tasks.length === 0)) {
            const msg = "[Harns] ERROR: Project plans must include a non-empty tasks array in the plan_written tool call.";
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

        if (result.canceled) {
            if (uiAPI) uiAPI.appendSystemMessage("[Harns] Plan review canceled. Returning to interactive mode.");
            else console.log("\n[Harns] Plan review canceled. Returning to interactive mode.\n");
            return { canceled: true };
        }

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
        } else {
            console.log(
                `\n[Harns] Plan denied. Feeding feedback back to ${agentName}...`,
            );
        }

        currentRequest = buildDeniedFeedbackRequest({
            round: revision,
            planName: planInfo.name,
            feedback: result.feedback,
        });
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
/**
 * Re-open an existing plan in a denial-feedback revision loop until approved,
 * canceled (Esc), or failure.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames]
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {string} opts.planName
 * @param {string} opts.planPath
 * @param {UiAPI} [opts.uiAPI]
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @returns {Promise<{ planName: string, planPath: string, approved: true, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> } | { canceled: true } | null>}
 */
export async function reReviewLoop({
    agentName,
    toolNames,
    customTools,
    triageMeta,
    planName,
    planPath,
    uiAPI,
    sessionManager,
}) {
    let revision = 0;
    const currentPlanName = planName;
    let currentPlanPath = planPath;
    /** @type {Array<{task: number, assignee: string, dependencies: string, description: string}> | undefined} */
    let currentTasks;

    while (true) {
        const result = await submitPlanForReview({
            cwd: CWD,
            planName: currentPlanName,
            planPath: currentPlanPath,
            triageMeta,
            uiAPI,
        });

        if (result.canceled) {
            if (uiAPI) uiAPI.appendSystemMessage("[Harns] Plan review canceled. Returning to interactive mode.");
            else console.log("\n[Harns] Plan review canceled. Returning to interactive mode.\n");
            return { canceled: true };
        }

        if (result.approved) {
            return {
                planName: currentPlanName,
                planPath: currentPlanPath,
                approved: true,
                tasks: currentTasks,
            };
        }

        revision++;
        if (uiAPI) {
            uiAPI.appendSystemMessage(
                `[Harns] Plan denied. Feeding feedback back to ${agentName}...`,
            );
        } else {
            console.log(`\n[Harns] Plan denied. Feeding feedback back to ${agentName}...`);
        }

        const currentRequest = buildDeniedFeedbackRequest({
            round: revision,
            planName: currentPlanName,
            feedback: result.feedback,
        });

        const planningMessages = await runAgentSession({
            agentName,
            toolNames,
            customTools,
            userRequest: currentRequest,
            uiAPI,
            sessionManager,
        });

        const planInfo = await resolveDeclaredPlan(planningMessages);
        if (!planInfo) {
            const msg = "[Harns] ERROR: Agent did not declare a valid plan via plan_written.";
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.error(`\n${msg}`);
            return null;
        }

        // Enforce PROJECT-only validation: if classification is PROJECT, tasks must be present and non-empty.
        if (triageMeta?.classification === "PROJECT" && (!planInfo.tasks || planInfo.tasks.length === 0)) {
            const msg = "[Harns] ERROR: Project plans must include a non-empty tasks array in the plan_written tool call.";
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.error(`\n${msg}`);
            return null;
        }

        if (planInfo.name !== currentPlanName) {
            const msg = `[Harns] ERROR: Expected revised plan '${currentPlanName}' but got '${planInfo.name}'.`;
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.error(`\n${msg}`);
            return null;
        }

        currentPlanPath = planInfo.path;
        currentTasks = planInfo.tasks;
    }
}

/**
 * Unified planning lifecycle used by Router and Resume.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string[]} [opts.toolNames]
 * @param {string} [opts.initialRequest]
 * @param {{ planName: string, planPath: string, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> }} [opts.existingPlan]
 * @param {UiAPI} [opts.uiAPI]
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {(planName: string, error: string) => string} [opts.buildRepairPrompt]
 * @returns {Promise<{ status: "executed" | "saved" | "canceled" | "failed", planName?: string, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> }>}
 */
export async function runPlanLifecycle({
    agentName,
    triageMeta,
    customTools,
    toolNames,
    initialRequest,
    existingPlan,
    uiAPI,
    sessionManager,
    buildRepairPrompt,
}) {
    let reviewResult;

    if (existingPlan) {
        reviewResult = await reReviewLoop({
            agentName,
            toolNames,
            customTools,
            triageMeta,
            planName: existingPlan.planName,
            planPath: existingPlan.planPath,
            uiAPI,
            sessionManager,
        });
    } else {
        if (!initialRequest) {
            const msg = "[Harns] ERROR: runPlanLifecycle requires initialRequest when existingPlan is not provided.";
            if (uiAPI) uiAPI.appendSystemMessage(msg, true);
            else console.error(msg);
            return { status: "failed" };
        }

        reviewResult = await reviewLoop({
            agentName,
            toolNames,
            initialRequest,
            customTools,
            triageMeta,
            uiAPI,
            sessionManager,
        });
    }

    if (!reviewResult) return { status: "failed" };
    if ("canceled" in reviewResult && reviewResult.canceled) return { status: "canceled" };

    const approvedResult =
        /** @type {{ planName: string, planPath: string, approved: true, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> }} */ (reviewResult);

    const action = triageMeta.classification === "PROJECT"
        ? await askApprovalWithTasks(approvedResult.planName, uiAPI, approvedResult.tasks)
        : await askPostApproval(approvedResult.planName, uiAPI);

    if (action !== "proceed") {
        if (uiAPI) {
            uiAPI.appendSystemMessage(
                `[Harns] Plan saved. Resume later with: ${CLI_BIN} resume ${approvedResult.planName}`,
            );
        }
        return {
            status: "saved",
            planName: approvedResult.planName,
            tasks: approvedResult.tasks,
        };
    }

    const execRes = await executePlan(approvedResult.planName, triageMeta, uiAPI, approvedResult.tasks, sessionManager);
    if (execRes && execRes.repairRequired && buildRepairPrompt) {
        uiAPI?.appendSystemMessage(
            `[Harns] Execution failed due to task table error. Rerouting to ${agentName} for repair...`,
        );
        await reviewLoop({
            agentName,
            customTools,
            initialRequest: buildRepairPrompt(
                approvedResult.planName,
                execRes.error || "Unknown task table error",
            ),
            triageMeta,
            uiAPI,
            sessionManager,
        });
    }

    return {
        status: "executed",
        planName: approvedResult.planName,
        tasks: approvedResult.tasks,
    };
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
                await runEngineerWithPlan(planName, plan.body, uiAPI, sessionManager);
            }
        } catch (e) {
            // spinnerInterval is local to the try block, but we should only clear if it exists.
            // However, it is defined inside the try block, so we can't access it here unless it's hoisted.
            // Let's move the declaration to the upper scope.
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

    // If we are retrying, seed the state
    if (seedFailedTasks.length > 0) {
        const processed = tasks.filter((task) => !seedFailedTasks.includes(task.task)).map((task) => task.task);
        processed.forEach((id) => results.set(id, { status: "success" }));
        seedFailedTasks.forEach((id) => pending.add(id));
    }

    while (results.size < tasks.length) {
        // Ready tasks are those still pending whose dependencies have completed successfully.
        const ready = tasks.filter((task) => {
            if (!pending.has(task.task)) return false;
            const deps = (task.dependencies || "").split(",").map((dependency) => dependency.trim()).filter((
                dependency,
            ) => dependency && dependency.toLowerCase() !== "none");
            return deps.every((dependency) => {
                const depId = parseInt(dependency);
                if (isNaN(depId)) return true; // permissive for non-numeric deps
                return results.has(depId) && results.get(depId)?.status === "success";
            });
        });

        // Cap launches to available worker slots to respect MAX_PARALLEL_TASKS.
        const toLaunch = ready.slice(0, MAX_PARALLEL_TASKS - running.size);

        if (toLaunch.length === 0 && running.size === 0 && pending.size > 0) {
            // No ready work and nothing running: remaining tasks are blocked/deadlocked.
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
                    onRunningTasksChange(tasks.filter((runningTask) => running.has(runningTask.task)));
                }
            }
        });

        // Wait for first completion, then recompute readiness/dependencies.
        // If nothing launched but tasks are still running, poll briefly and loop.
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
            // Remaining pending tasks can no longer become ready due to blocked dependencies.
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
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [sessionManager]
 */
async function runEngineerWithPlan(planName, planBody, uiAPI, sessionManager) {
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
        sessionManager,
    });
}
