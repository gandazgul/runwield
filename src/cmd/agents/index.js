/**
 * @module cmd/agents
 * Agent command — list available agents or start a direct agent session.
 */

import { parseArgs } from "@std/cli/parse-args";
import { printCommandHelp } from "../../shared/help-text.js";
import { setActiveAgent, startInteractiveSession } from "../../shared/chat-session.js";
import { listAvailableAgents } from "../../shared/agents.js";
import { createDirectAgentHandler } from "../../shared/direct-agent.js";

/**
 * Handle the agents command.
 *
 * - `hns --agent` / `hns agents` → list available agents
 * - `hns --agent <name>` → start TUI with that agent
 * - `hns --agent <name> "<prompt>"` → start TUI with agent + initial prompt
 *
 * @param {string[]} argv
 */
export async function runAgentsCommand(argv) {
    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp("agents");
        return;
    }

    const agents = await listAvailableAgents();
    const [agentName, ...rest] = parsed._.map(String);

    // No agent name: list all and exit
    if (!agentName || agentName === "undefined") {
        console.log("\nAvailable agents:\n");
        for (const a of agents) {
            console.log(`  ${a.name.padEnd(14)} ${a.description}`);
        }
        console.log(`\nUsage: hns --agent <name> ["<prompt>"]\n`);
        return;
    }

    const match = agents.find((a) => a.name === agentName);

    if (!match) {
        console.error(`\nUnknown agent: "${agentName}"\n`);
        console.log("Available agents:");
        for (const a of agents) {
            console.log(`  ${a.name.padEnd(14)} ${a.description}`);
        }
        Deno.exit(1);
    }

    const handler = createDirectAgentHandler(agentName);
    const userRequest = rest.join(" ").trim();

    setActiveAgent(match.displayName, handler);
    await startInteractiveSession(userRequest || null, handler);
}
