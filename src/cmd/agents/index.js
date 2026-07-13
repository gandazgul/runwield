/**
 * @module cmd/agents
 * Agent command — list available Agents or start with a chosen active Agent.
 */

import { basename } from "@std/path";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import { startInteractiveSession as startInteractiveSessionFn } from "../../ui/tui/chat-session.js";
import { switchActiveAgent as switchActiveAgentFn } from "../../shared/session/agent-switching.js";
import { listAvailableAgents as listAvailableAgentsFn } from "../../shared/session/agents.js";
import { AGENTS } from "../../constants.js";
import { COMMAND_NAMES } from "../registry.js";
import { createAgentHandler as createAgentHandlerFn } from "../../shared/session/agent-handler.js";
import { setTerminalTitleForName } from "../../ui/tui/terminal-title.js";

export { getAgentCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof listAvailableAgentsFn} [listAvailableAgents]
 * @property {typeof createAgentHandlerFn} [createAgentHandler]
 * @property {typeof switchActiveAgentFn} [switchActiveAgent]
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
        switchActiveAgent: switchActiveAgentDep,
        startInteractiveSession: startInteractiveSessionDep,
        exit: exitDep,
    } = deps;

    const listAvailableAgents = listAvailableAgentsDep || listAvailableAgentsFn;
    const createAgentHandler = createAgentHandlerDep || createAgentHandlerFn;
    const switchActiveAgent = switchActiveAgentDep || switchActiveAgentFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    void createAgentHandler;
    void switchActiveAgent;
    const exit = exitDep || Deno.exit;

    const agents = await listAvailableAgents(Deno.cwd());

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
 *   tui: import('../../ui/tui/types.js').TuiAPI,
 *   uiAPI: import('../../ui/tui/types.js').UiAPI,
 *   editor: import('../../ui/tui/types.js').EditorAPI,
 *   hostedSession?: import('../../shared/session/hosted-session.js').HostedSession,
 *   switchActiveAgent?: (hostedSession: import('../../shared/session/hosted-session.js').HostedSession | undefined, options: { agentName: string, model?: string, allowReturnToRouter?: boolean }, uiAPI?: import('../../ui/tui/types.js').UiAPI) => Promise<unknown>,
 * }} options
 * @param {CommandDependencies} [deps]
 * @return {Promise<void>}
 */
async function runAgentsCommandTUI(agentName, _rest, options, deps = {}) {
    const {
        listAvailableAgents: listAvailableAgentsDep,
        createAgentHandler: createAgentHandlerDep,
        switchActiveAgent: switchActiveAgentDep,
    } = deps;

    const listAvailableAgents = listAvailableAgentsDep || listAvailableAgentsFn;
    const createAgentHandler = createAgentHandlerDep || createAgentHandlerFn;
    const switchActiveAgent = options.switchActiveAgent || switchActiveAgentDep || switchActiveAgentFn;

    const { tui, uiAPI, editor, hostedSession } = options;
    const agents = await listAvailableAgents(hostedSession?.cwd);
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

        const selected = await uiAPI.promptSelect("Switch agent:", agentOptions, { persistResult: false });
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

    void handler;
    if (hostedSession) await switchActiveAgent(hostedSession, { agentName: match.name }, uiAPI);

    // Update terminal title with chosen agent name
    const rootSessionManager = /** @type {any} */ (hostedSession?.getRootSessionManager?.());
    if (rootSessionManager && !rootSessionManager.getSessionName?.()) {
        const folder = basename(Deno.cwd());
        setTerminalTitleForName(`${folder} - ${match.name}`);
    }

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
            switchActiveAgent: options.switchActiveAgent,
        }, deps);
    }

    // Standard CLI flow
    return await runAgentsCommandCli(agentName, rest, deps);
}
