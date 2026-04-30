/**
 * @module tools/switch-agent
 * Tool for agents to request a hand-off to another agent.
 */

import { setActiveAgent } from "../shared/chat-session.js";
import { createDirectAgentHandler } from "../shared/direct-agent.js";
import { listAvailableAgents } from "../shared/agents.js";

/**
 * Tool for switching the active agent in the interactive session.
 *
 * @param {string} _toolCallId
 * @param {Object} params
 * @param {string} params.agentName - The name of the agent to switch to (e.g., "planner", "architect", "operator", "router").
 * @param {string} params.reason - A brief explanation of why the switch is being requested.
 * @param {AbortSignal | undefined} _signal
 * @param {Function | undefined} _onUpdate
 * @param {any} context
 */
export async function switchAgentTool(_toolCallId, params, _signal, _onUpdate, context) {
    const { agentName, reason } = params;
    const { uiAPI } = context;

    if (!uiAPI) {
        return {
            content: [/** @type {import('@mariozechner/pi-coding-agent').TextContent} */ {
                type: "text",
                text: "Error: This tool requires a UI API context to perform the switch.",
            }],
            isError: true,
            details: null,
        };
    }

    const target = agentName.toLowerCase().trim();

    if (target === "router") {
        const { routerCmdOnMessage } = await import("../cmd/router/index.js");
        setActiveAgent("Router", routerCmdOnMessage, uiAPI);
        uiAPI.appendSystemMessage(`Agent hand-off: User requested return to Router. Reason: ${reason}`);
        return {
            content: [/** @type {import('@mariozechner/pi-coding-agent').TextContent} */ {
                type: "text",
                text: `Switched back to Router. Reason: ${reason}`,
            }],
            details: null,
        };
    }

    const agents = await listAvailableAgents();
    const match = agents.find((a) => a.name === target);

    if (!match) {
        return {
            content: [/** @type {import('@mariozechner/pi-coding-agent').TextContent} */ {
                type: "text",
                text: `Error: Unknown agent "${agentName}". Available agents: ${agents.map((a) => a.name).join(", ")}`,
            }],
            isError: true,
            details: null,
        };
    }

    const handler = createDirectAgentHandler(target);
    setActiveAgent(match.displayName, handler, uiAPI, match.model);
    uiAPI.appendSystemMessage(`Agent hand-off: Switching to ${match.displayName}. Reason: ${reason}`);

    return {
        content: [/** @type {import('@mariozechner/pi-coding-agent').TextContent} */ {
            type: "text",
            text: `Successfully switched to ${match.displayName}. Reason: ${reason}`,
        }],
        details: null,
    };
}

export const switchAgentToolDef = {
    name: "switch_agent",
    label: "Switch Agent",
    description:
        "Switch the active agent to another agent (e.g., 'planner', 'architect', 'operator', 'router') when the current task is better suited for a different role.",
    parameters: {
        type: "object",
        properties: {
            agentName: {
                type: "string",
                description:
                    "The identifier of the agent to switch to (e.g., 'planner', 'architect', 'operator', 'router').",
            },
            reason: {
                type: "string",
                description:
                    "The reason for switching agents, explaining why the target agent is more appropriate for the current state of the conversation.",
            },
        },
        required: ["agentName", "reason"],
    },
};
