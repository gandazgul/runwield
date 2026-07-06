/**
 * @module task-completed
 * Custom tool for execution agents to declare they have finished their current
 * task. This returns a terminal outcome that lets the orchestrator advance the
 * active workflow.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { appendTaskCompletedMessage } from "../ui/tui/task-completed-message.js";

const TOOL_PARAMS = Type.Object({
    message: Type.Optional(Type.String({
        description: "Concise success, failure, or blocked summary for the completed task.",
    })),
});

/**
 * Create the task_completed tool.
 *
 * @param {{
 *   uiAPI: import('../shared/workflow/workflow.js').UiAPI,
 *   agentName?: string,
 * }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createTaskCompletedTool({ uiAPI, agentName = "agent" } = /** @type {any} */ ({})) {
    if (!uiAPI) throw new Error("createTaskCompletedTool: uiAPI is required");
    return defineTool({
        name: "task_completed",
        label: "Task Completed",
        description: "Declare that you have finished your assigned execution task, whether it succeeded, failed, " +
            "or is blocked. " +
            "For FEATURE and PROJECT workflows, this signals the orchestrator to begin saved-plan validation. " +
            "For OPERATION work, the Operator must self-verify before calling this tool and no RunWield validation loop runs afterward. " +
            "For QUICK_FIX work, the Engineer must verify before calling this tool; RunWield then runs no-plan Mechanical Validation. " +
            "For frontend UI/UX work, include the dev server URL, headed browser checks performed, and visible " +
            "evidence; if browser verification was blocked, state the exact blocker and what remains unverified. " +
            "Call this exactly once when you are completely finished with your assigned work and include a concise " +
            "summary in the message. " +
            "If you need to ask the user a clarifying question before finishing, DO NOT call this tool — " +
            "just output the question in text.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            await Promise.resolve();
            appendTaskCompletedMessage(uiAPI, agentName, params.message);

            return {
                content: [],
                details: { outcome: "task_completed", message: params.message },
                terminate: true,
            };
        },
    });
}
