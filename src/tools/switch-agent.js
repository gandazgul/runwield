/**
 * @module tools/switch-agent
 * Tool for agents to request a hand-off to another agent.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { getActiveUiAPI, setActiveAgent } from "../shared/interactive/chat-session.js";
import { createDirectAgentHandler } from "../shared/session/direct-agent.js";
import { listAvailableAgents } from "../shared/session/agents.js";

/**
 * Trigger the target agent with the given reason.
 * @param {string} target
 * @param {string} reason
 * @param {import('../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 */
export async function triggerAgent(target, reason, uiAPI, sessionManager) {
    const { runAgentSession } = await import("../shared/session/session.js");
    await runAgentSession({
        agentName: target,
        userRequest: reason,
        uiAPI,
        sessionManager,
    });
}

/** @type {(target: string, reason: string, uiAPI: import('../shared/workflow/workflow.js').UiAPI, sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager) => Promise<void>} */
const noOpTrigger = async () => {};

/**
 * Core logic for switching the active agent.
 *
 * @param {Object} params
 * @param {string} params.agentName
 * @param {string} params.reason
 * @param {import('../shared/workflow/workflow.js').UiAPI | null | undefined} uiAPI
 * @param {import('@earendil-works/pi-coding-agent').ExtensionContext | undefined} context
 * @param {(target: string, reason: string, uiAPI: import('../shared/workflow/workflow.js').UiAPI, sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager) => Promise<void>} [triggerFn]
 * @returns {Promise<import('@earendil-works/pi-coding-agent').AgentToolResult<null>>}
 */
export async function executeSwitchAgent(params, uiAPI, context, triggerFn = noOpTrigger) {
    const { agentName, reason } = params;

    if (!uiAPI) {
        return {
            content: [{
                type: "text",
                text:
                    "Error: This tool requires an active UI session to perform the switch. Please ensure you're running in interactive mode.",
            }],
            details: null,
        };
    }

    const target = agentName.toLowerCase().trim();

    const agents = await listAvailableAgents();
    const match = agents.find((agent) => agent.name === target);

    if (!match) {
        return {
            content: [{
                type: "text",
                text: `Error: Unknown agent "${agentName}". Available agents: ${
                    agents.map((agent) => agent.name).join(", ")
                }`,
            }],
            details: null,
        };
    }

    const handler = createDirectAgentHandler(target);
    setActiveAgent(match.displayName, handler, uiAPI, match.model);
    uiAPI.appendSystemMessage(`Agent hand-off: Switching to ${match.displayName}. Reason: ${reason}`);

    // Immediately trigger the new agent with the reason
    await triggerFn(
        target,
        reason,
        uiAPI,
        /** @type {import('@earendil-works/pi-coding-agent').SessionManager | undefined} */ (
            /** @type {unknown} */ (context?.sessionManager)
        ),
    );

    return {
        content: [{
            type: "text",
            text: `Switched to ${match.displayName}. Reason: ${reason}`,
        }],
        details: null,
    };
}

/**
 * Tool for switching the active agent in the interactive session.
 */
export const switchAgentTool = defineTool({
    name: "switch_agent",
    label: "Switch Agent",
    description:
        "Switch the active agent to another agent (e.g., 'planner', 'architect', 'operator', 'router') when the current task is better suited for a different role.",
    parameters: Type.Object({
        agentName: Type.String({
            description:
                "The identifier of the agent to switch to (e.g., 'planner', 'architect', 'operator', 'router').",
        }),
        reason: Type.String({
            description:
                "The reason for switching agents, explaining why the target agent is more appropriate for the current state of the conversation.",
        }),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, context) {
        return executeSwitchAgent(params, getActiveUiAPI(), context);
    },
});
