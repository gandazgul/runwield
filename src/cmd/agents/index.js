/**
 * @module cmd/agents
 * Agent command — list available agents or start a direct agent session.
 */

import { parseArgs } from "@std/cli/parse-args";
import { printCommandHelp } from "../../shared/help-text.js";
import { setActiveAgent, startInteractiveSession } from "../../shared/chat-session.js";
import { listAvailableAgents } from "../../shared/agents.js";
import { createDirectAgentHandler } from "../../shared/direct-agent.js";
export { getAgentCompletions } from "./getArgumentCompletions.js";

/**
 * Handle the agents command.
 *
 * - `hns --agent` / `hns agents` → list available agents
 * - `hns --agent <name>` → start TUI with that agent
 * - `hns --agent <name> "<prompt>"` → start TUI with agent + initial prompt
 *
 * Inside the TUI (`/agent`):
 * - `/agent router` → reset to default router flow
 * - `/agent <name>` → direct switch agent
 * - `/agent` → show interactive selection
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runAgentsCommand(argv, options = {}) {
    const parsedArgs = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsedArgs.help) {
        printCommandHelp("agents");
        return;
    }

    const agents = await listAvailableAgents();
    const [agentName, ...rest] = parsedArgs._.map(String);

    // Is this called from TUI?
    if (options.uiAPI && options.editor && options.tui) {
        options.editor.setText("");
        const targetName = agentName?.trim();
        const { tui, uiAPI } = options;

        if (targetName === "router") {
            // Reset to default router flow
            const { routerCmdOnMessage } = await import("../router/index.js");
            setActiveAgent("Router", routerCmdOnMessage, uiAPI);
            tui.setFocus(
                /** @type {import('@mariozechner/pi-tui').Component} */ (/** @type {unknown} */ (options.editor)),
            );
            return;
        }

        if (targetName && targetName !== "undefined") {
            // Direct switch: /agent <name>
            const match = agents.find((agent) => agent.name === targetName);
            if (!match) {
                uiAPI.appendSystemMessage(
                    `Unknown agent: "${targetName}". Use /agent to see available agents.`,
                );
                tui.setFocus(
                    /** @type {import('@mariozechner/pi-tui').Component} */ (/** @type {unknown} */ (options.editor)),
                );
                return;
            }
            const handler = createDirectAgentHandler(targetName);
            setActiveAgent(match.displayName, handler, uiAPI, match.model);
            tui.setFocus(
                /** @type {import('@mariozechner/pi-tui').Component} */ (/** @type {unknown} */ (options.editor)),
            );
            return;
        }

        // No args: show interactive selection
        const agentOptions = [
            { value: "router", label: "router", description: "Reset to default router (triage flow)" },
            ...agents
                .sort((agentA, agentB) => agentA.name.localeCompare(agentB.name))
                .map((agent) => ({
                    value: agent.name,
                    label: agent.name,
                    description: agent.description,
                })),
        ];

        const chosen = await uiAPI.promptSelect("Switch agent:", agentOptions);
        if (!chosen) {
            tui.setFocus(
                /** @type {import('@mariozechner/pi-tui').Component} */ (/** @type {unknown} */ (options.editor)),
            );
            return; // cancelled
        }

        if (chosen === "router") {
            const { routerCmdOnMessage } = await import("../router/index.js");
            setActiveAgent("Router", routerCmdOnMessage, uiAPI);
        } else {
            const handler = createDirectAgentHandler(chosen);
            const match = agents.find((agent) => agent.name === chosen);
            setActiveAgent(match?.displayName || chosen, handler, uiAPI, match?.model);
        }
        tui.setFocus(/** @type {import('@mariozechner/pi-tui').Component} */ (/** @type {unknown} */ (options.editor)));
        return;
    }

    // Standard CLI flow
    // No agent name: list all and exit
    if (!agentName || agentName === "undefined") {
        console.log("\nAvailable agents:\n");
        for (const agent of agents) {
            console.log(`  ${agent.name.padEnd(14)} ${agent.description}`);
        }
        console.log(`\nUsage: hns --agent <name> ["<prompt>"]\n`);
        return;
    }

    const match = agents.find((agent) => agent.name === agentName);

    if (!match) {
        console.error(`\nUnknown agent: "${agentName}"\n`);
        console.log("Available agents:");
        for (const agent of agents) {
            console.log(`  ${agent.name.padEnd(14)} ${agent.description}`);
        }
        Deno.exit(1);
    }

    const handler = createDirectAgentHandler(agentName);
    const userRequest = rest.join(" ").trim();

    setActiveAgent(match.displayName, handler);
    await startInteractiveSession(userRequest || null, handler);
}
