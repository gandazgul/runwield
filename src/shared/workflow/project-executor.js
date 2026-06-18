/**
 * @module shared/workflow/project-executor
 * Legacy parallel PROJECT task execution against transient sub-sessions.
 *
 * Retained as import-safe reference code for possible future multi-role FEATURE
 * orchestration. New Epic/PROJECT flows must not dispatch through this module.
 */

import { dirname, join } from "@std/path";
import { AGENTS, MAX_PARALLEL_TASKS } from "../../constants.js";
import { runAgentSession } from "../session/session.js";
import { getAgentDisplayName } from "../session/agents.js";
import { createFooterOnlyUiApi } from "../ui/api.js";
import { selectNonConflictingTasks } from "./task-scheduling.js";
import { extractAssistantOutput, readLatestTaskCompletedOutcome } from "./workflow-results.js";
import { buildTaskAssignmentRequest, buildTaskResultDisplay } from "./workflow-prompts.js";

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeLogPathPart(value) {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || "agent";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatDebugJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/**
 * @param {string} path
 * @param {string} text
 */
function appendDebugLog(path, text) {
    try {
        Deno.mkdirSync(dirname(path), { recursive: true });
        Deno.writeTextFileSync(path, text.endsWith("\n") ? text : `${text}\n`, { append: true });
    } catch (_e) {
        // Debug logging must never fail task execution.
    }
}

/**
 * @param {string} root
 * @param {{ task: number }} task
 * @param {string} agentName
 * @returns {string}
 */
function getTaskDebugLogPath(root, task, agentName) {
    return join(root, "debug-agents", `task-${task.task}-${sanitizeLogPathPart(agentName)}.log`);
}

/**
 * @param {{ executionCwd?: string, debugRoot?: string }} options
 * @returns {string | undefined}
 */
function resolveTaskDebugRoot(options) {
    if (options.executionCwd) return options.executionCwd;
    if (options.debugRoot) return options.debugRoot;
    if (Deno.env.get("DEBUG") === "1") return join(Deno.cwd(), ".hns", "debug");
    return undefined;
}

/**
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {string}
 */
function formatAgentTranscript(messages) {
    return messages.map((message, index) =>
        [
            `--- Message ${index + 1} ---`,
            formatDebugJson(message),
        ].join("\n")
    ).join("\n\n");
}

/**
 * Execute project tasks in parallel against in-memory sub-sessions. Each task
 * runs on a transient SessionManager.inMemory() and appends one custom message
 * entry to the root session manager when it finishes.
 *
 * @param {string} planName
 * @param {string} planBody
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} tasks
 * @param {import('../ui/types.js').UiAPI} uiAPI
 * @param {number[]} [seedFailedTasks]
 * @param {(runningTasks: Array<{task: number, assignee: string, description: string}>) => void} [onRunningTasksChange]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @param {Map<number, import('./types.js').TaskExecutionResult>} [seedResults]
 * @param {typeof runAgentSession} [agentSessionRunner]
 * @param {{ executionCwd?: string, debugRoot?: string }} [options]
 */
export async function executeProjectTasks(
    planName,
    planBody,
    tasks,
    uiAPI,
    seedFailedTasks = [],
    onRunningTasksChange,
    sessionManager,
    seedResults = new Map(),
    agentSessionRunner = runAgentSession,
    options = {},
) {
    /** @type {Map<number, import('./types.js').TaskExecutionResult>} */
    const results = new Map();
    const retryTaskIds = new Set(seedFailedTasks);
    const pending = new Set(seedFailedTasks.length > 0 ? seedFailedTasks : tasks.map((task) => task.task));
    const running = new Set();

    if (seedFailedTasks.length > 0) {
        const processed = tasks.filter((task) => !retryTaskIds.has(task.task)).map((task) => task.task);
        processed.forEach((id) => {
            const seedResult = seedResults.get(id);
            results.set(id, seedResult?.status === "success" ? seedResult : { status: "success" });
        });
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
            const debugRoot = resolveTaskDebugRoot(options);
            const taskDebugLogPath = debugRoot ? getTaskDebugLogPath(debugRoot, task, agentName) : undefined;

            const taskHeader = `--- Task ${task.task}: ${task.description} (→ ${getAgentDisplayName(agentName)}) ---`;
            uiAPI.appendSystemMessage(taskHeader, false, "Harns");

            try {
                if (taskDebugLogPath) {
                    appendDebugLog(
                        taskDebugLogPath,
                        [
                            `Event: HEADLESS TASK START`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Plan: ${planName}`,
                            `Task: ${task.task}`,
                            `Assignee: ${agentName}`,
                            `Display Name: ${getAgentDisplayName(agentName)}`,
                            `Description: ${task.description}`,
                            `Dependencies: ${task.dependencies || "none"}`,
                            `Write Scope: ${task.writeScope || "unknown"}`,
                            `Execution CWD: ${options.executionCwd || Deno.cwd()}`,
                            "",
                        ].join("\n"),
                    );
                    appendDebugLog(
                        join(/** @type {string} */ (debugRoot), "debug.log"),
                        [
                            `Event: HEADLESS TASK LOG`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Task: ${task.task}`,
                            `Assignee: ${agentName}`,
                            `Log: ${taskDebugLogPath}`,
                            "",
                        ].join("\n"),
                    );
                }

                const sessionMessages = await agentSessionRunner({
                    agentName,
                    userRequest: buildTaskAssignmentRequest(planName, planBody, task, results),
                    uiAPI: createFooterOnlyUiApi(uiAPI),
                    cwd: options.executionCwd,
                    debugLogPath: taskDebugLogPath,
                });

                const outputText = extractAssistantOutput(sessionMessages);
                const completed = readLatestTaskCompletedOutcome(sessionMessages);

                if (taskDebugLogPath) {
                    const debugEntry = [
                        `Event: HEADLESS TASK RESULT`,
                        `Timestamp: ${new Date().toISOString()}`,
                        `Status: ${completed ? "COMPLETED" : "MISSING task_completed"}`,
                        `Output Text:`,
                        outputText || "(empty)",
                        `Total Messages: ${sessionMessages.length}`,
                        `Assistant Messages: ${
                            sessionMessages.filter((message) => "role" in message && message.role === "assistant")
                                .length
                        }`,
                        `Transcript:`,
                        formatAgentTranscript(sessionMessages),
                        "",
                    ].join("\n");
                    appendDebugLog(taskDebugLogPath, debugEntry);
                }

                const block = uiAPI.appendAgentMessageStart(
                    `${getAgentDisplayName(agentName)} (Task ${task.task} Output)`,
                );
                block.appendText(outputText || "_no output received_");

                if (!completed) {
                    const error = "Task ended without calling task_completed.";
                    if (taskDebugLogPath) {
                        appendDebugLog(
                            taskDebugLogPath,
                            [
                                `Event: HEADLESS TASK INCOMPLETE`,
                                `Timestamp: ${new Date().toISOString()}`,
                                `Error: ${error}`,
                                "",
                            ].join("\n"),
                        );
                    }
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

                const display = buildTaskResultDisplay(task, agentName, outputText);
                results.set(task.task, {
                    status: "success",
                    messages: sessionMessages,
                    output: outputText || "",
                    display,
                });

                if (sessionManager?.appendCustomMessageEntry) {
                    sessionManager.appendCustomMessageEntry(
                        "task_result",
                        display,
                        true,
                        { taskId: task.task, agentName, status: "success", output: outputText || "" },
                    );
                }
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                if (taskDebugLogPath) {
                    appendDebugLog(
                        taskDebugLogPath,
                        [
                            `Event: HEADLESS TASK ERROR`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Error: ${error.message}`,
                            `Stack:`,
                            error.stack || "(no stack)",
                            "",
                        ].join("\n"),
                    );
                }
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
