/**
 * @module task-completed
 * Custom tool for executing agents (Engineer/Operator) to declare they have
 * finished their current execution task. This returns a terminal outcome
 * that signals the orchestrator to proceed with the validation phase.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

const TOOL_PARAMS = Type.Object({
    message: Type.Optional(Type.String({
        description: "Optional final message or summary of what was completed.",
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
        description: "Declare that you have finished your assigned execution task. " +
            "If a workflow is active, this signals the orchestrator to begin the validation phase. " +
            "Call this exactly once when you are completely finished with your work. " +
            "If you need to ask the user a clarifying question before finishing, DO NOT call this tool — " +
            "just output the question in text. Only call this tool when your code changes are done.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            await Promise.resolve();
            const msg = params.message ? `: ${params.message}` : "";
            uiAPI.appendSystemMessage(`Task declared completed by ${agentName}${msg}`, false, "Harns");

            return {
                content: [],
                details: { outcome: "task_completed", message: params.message },
                terminate: true,
            };
        },
    });
}
