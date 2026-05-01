/**
 * @module tools/switch-agent
 * Tool for agents to request a hand-off to another agent.
 */

import { Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { getActiveUiAPI, setActiveAgent } from "../shared/chat-session.js";
import { createDirectAgentHandler } from "../shared/direct-agent.js";
import { listAvailableAgents } from "../shared/agents.js";

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
    async execute(_toolCallId, params, _signal, _onUpdate, _context) {
        const { agentName, reason } = params;
        // Use the stored active UI API from the chat session
        const uiAPI = getActiveUiAPI();

        if (!uiAPI) {
            return {
                content: [{
                    type: "text",
                    text:
                        "Error: This tool requires an active UI session to perform the switch. Please ensure you're running in interactive mode.",
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
                content: [{
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
                content: [{
                    type: "text",
                    text: `Error: Unknown agent "${agentName}". Available agents: ${
                        agents.map((a) => a.name).join(", ")
                    }`,
                }],
                isError: true,
                details: null,
            };
        }

        const handler = createDirectAgentHandler(target);
        setActiveAgent(match.displayName, handler, uiAPI, match.model);
        uiAPI.appendSystemMessage(`Agent hand-off: Switching to ${match.displayName}. Reason: ${reason}`);

        return {
            content: [{
                type: "text",
                text: `Successfully switched to ${match.displayName}. Reason: ${reason}`,
            }],
            details: null,
        };
    },
});
