/**
 * @module cmd/agents
 * Agent command — list available agents or start a direct agent session.
 */

import { printCommandHelp } from "../help/index.js";
import { routerCmdOnMessage } from "../router/index.js";
import { setActiveAgent, startInteractiveSession } from "../../shared/chat-session.js";
import { listAvailableAgents } from "../../shared/agents.js";
import { COMMAND_NAMES } from "../../constants.js";
import { createDirectAgentHandler } from "../../shared/direct-agent.js";

export { getAgentCompletions } from "./getArgumentCompletions.js";

/**
 * Run the agents command in CLI mode.
 *
 * @param {string} agentName
 * @param {string[]} rest
 *
 * @returns {Promise<void>}
 */
async function runAgentsCommandCli(agentName, rest) {
    const agents = await listAvailableAgents();

    // No agent name: list all and exit
    if (!agentName) {
        console.log("\nAvailable agents:\n");
        for (const agent of agents) {
            console.log(`  ${agent.name.padEnd(14)} ${agent.description}`);
        }
        console.log(`\nUsage: hns agent <name> ["<prompt>"]\n`);
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

/**
 * Run the agents command in TUI mode.
 *
 * @param {string} agentName
 * @param {string[]} _rest
 * @param {{
 *   tui: import('../../shared/ui/types.js').TuiAPI,
 *   uiAPI: import('../../shared/ui/types.js').UiAPI,
 *   editor: import('../../shared/ui/types.js').EditorAPI,
 * }} options
 *
 * @return {Promise<void>}
 */
async function runAgentsCommandTUI(agentName, _rest, options) {
    const agents = await listAvailableAgents();
    const { tui, uiAPI, editor } = options;
    editor.setText("");

    /** @type {string|null} */
    let chosenAgent = agentName;

    // if none was passed let the user choose
    if (!chosenAgent) {
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

        const selected = await uiAPI.promptSelect("Switch agent:", agentOptions);
        chosenAgent = selected;
    }

    const match = agents.find((agent) => agent.name === chosenAgent);
    if (!match) {
        uiAPI.appendSystemMessage(`Agent "${chosenAgent}" not found`);
        return;
    }

    const handler = match.name == "router" ? routerCmdOnMessage : createDirectAgentHandler(match.name);

    setActiveAgent(match.displayName, handler, uiAPI, match.model);
    tui.setFocus(/** @type {import('@mariozechner/pi-tui').Component} */ (/** @type {unknown} */ (editor)));

    return;
}

/**
 * Handle the agents command.
 *
 * - `hns agent` / `hns agents` → list available agents
 * - `hns agent <name>` → start TUI with that agent
 * - `hns agent <name> "<prompt>"` → start TUI with agent + initial prompt
 *
 * Inside the TUI (`/agent`):
 * - `/agent router` → reset to default router flow
 * - `/agent <name>` → direct switch agent
 * - `/agent` → show interactive selection
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 *
 * @return {Promise<void>}
 */
export async function runAgentsCommand(argv, options = {}) {
    const [agentName, ...rest] = argv;

    if (agentName === "help") {
        printCommandHelp(COMMAND_NAMES.AGENT);
        return;
    }

    // Is this called from TUI?
    if (options.uiAPI && options.editor && options.tui) {
        return await runAgentsCommandTUI(agentName, rest, {
            uiAPI: options.uiAPI,
            editor: options.editor,
            tui: options.tui,
        });
    }

    // Standard CLI flow
    return await runAgentsCommandCli(agentName, rest);
}
