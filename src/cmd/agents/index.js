/**
 * @module cmd/agents
 * Agent command — list available Agents or start with a chosen active Agent.
 */

import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import {
    setActiveAgent as setActiveAgentFn,
    startInteractiveSession as startInteractiveSessionFn,
} from "../../shared/interactive/chat-session.js";
import { listAvailableAgents as listAvailableAgentsFn } from "../../shared/session/agents.js";
import { AGENTS } from "../../constants.js";
import { COMMAND_NAMES } from "../registry.js";
import { createAgentHandler as createAgentHandlerFn } from "../../shared/session/agent-handler.js";

export { getAgentCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof listAvailableAgentsFn} [listAvailableAgents]
 * @property {typeof createAgentHandlerFn} [createAgentHandler]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof Deno.exit} [exit]
 */

/**
 * Run the agents command in CLI mode.
 *
 * @param {string} agentName
 * @param {string[]} rest
 * @param {CommandDependencies} [deps]
 * @returns {Promise<void>}
 */
async function runAgentsCommandCli(agentName, rest, deps = {}) {
    const {
        listAvailableAgents: listAvailableAgentsDep,
        createAgentHandler: createAgentHandlerDep,
        setActiveAgent: setActiveAgentDep,
        startInteractiveSession: startInteractiveSessionDep,
        exit: exitDep,
    } = deps;

    const listAvailableAgents = listAvailableAgentsDep || listAvailableAgentsFn;
    const createAgentHandler = createAgentHandlerDep || createAgentHandlerFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    void createAgentHandler;
    void setActiveAgent;
    const exit = exitDep || Deno.exit;

    const agents = await listAvailableAgents();

    // No agent name: list all and exit
    if (!agentName) {
        console.log("\nAvailable agents:\n");
        for (const agent of agents) {
            console.log(`  ${agent.name.padEnd(14)} ${agent.description}`);
        }
        console.log(`\nUsage: wld agent <name> ["<prompt>"]\n`);
        return;
    }

    const match = agents.find((agent) => agent.name === agentName);

    if (!match) {
        console.error(`\nUnknown agent: "${agentName}"\n`);
        console.log("Available agents:");
        for (const agent of agents) {
            console.log(`  ${agent.name.padEnd(14)} ${agent.description}`);
        }
        exit(1);
        return;
    }

    const userRequest = rest.join(" ").trim();

    await startInteractiveSession(userRequest || null, null, {
        initialAgentName: match.name,
    });
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
 *   hostedSession?: import('../../shared/session/hosted-session.js').HostedSession,
 * }} options
 * @param {CommandDependencies} [deps]
 * @return {Promise<void>}
 */
async function runAgentsCommandTUI(agentName, _rest, options, deps = {}) {
    const {
        listAvailableAgents: listAvailableAgentsDep,
        createAgentHandler: createAgentHandlerDep,
        setActiveAgent: setActiveAgentDep,
    } = deps;

    const listAvailableAgents = listAvailableAgentsDep || listAvailableAgentsFn;
    const createAgentHandler = createAgentHandlerDep || createAgentHandlerFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;

    const agents = await listAvailableAgents();
    const { tui, uiAPI, editor, hostedSession } = options;
    editor.setText("");

    /** @type {string|null} */
    let chosenAgent = agentName;

    // if none was passed let the user choose
    if (!chosenAgent) {
        // No args: show interactive selection
        const agentOptions = agents
            .slice()
            .sort((agentA, agentB) => agentA.name.localeCompare(agentB.name))
            .map((agent) => ({
                value: agent.name,
                label: agent.name,
                description: agent.name === AGENTS.ROUTER ? "Reset to default router (triage flow)" : agent.description,
            }));

        const selected = await uiAPI.promptSelect("Switch agent:", agentOptions);
        if (!selected) {
            // User pressed Esc — silently cancel
            return;
        }
        chosenAgent = selected;
    }

    const match = agents.find((agent) => agent.name === chosenAgent);
    if (!match) {
        uiAPI.appendSystemMessage(`Agent "${chosenAgent}" not found`);
        return;
    }

    const handler = createAgentHandler(match.name, { hostedSession });

    setActiveAgent(hostedSession, match.name, handler, uiAPI);
    tui.setFocus(/** @type {import('@earendil-works/pi-tui').Component} */ (/** @type {unknown} */ (editor)));
}

/**
 * Handle the agents command.
 *
 * - `wld agent` / `wld agents` → list available agents
 * - `wld agent <name>` → start TUI with that agent
 * - `wld agent <name> "<prompt>"` → start TUI with agent + initial prompt
 *
 * Inside the TUI (`/agent`):
 * - `/agent router` → switch to the default triage Agent
 * - `/agent <name>` → switch active Agent
 * - `/agent` → show interactive selection
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 * @return {Promise<void>}
 */
export async function runAgentsCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const { printCommandHelp: printCommandHelpDep } = deps;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const [agentName, ...rest] = argv;

    if (agentName === "help" || agentName === "--help" || agentName === "-h") {
        printCommandHelp(COMMAND_NAMES.AGENT);
        return;
    }

    // Is this called from TUI?
    if (options.uiAPI && options.editor && options.tui) {
        return await runAgentsCommandTUI(agentName, rest, {
            uiAPI: options.uiAPI,
            editor: options.editor,
            tui: options.tui,
            hostedSession: /** @type {any} */ (options).hostedSession,
        }, deps);
    }

    // Standard CLI flow
    return await runAgentsCommandCli(agentName, rest, deps);
}
