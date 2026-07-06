/**
 * @module cmd/router
 * Router command (also used as the default command).
 *
 * The router command starts an interactive session with the Router as the
 * initial active Agent. Workflow tool outcomes are handled by the normal Agent
 * handler; Router is not a special runtime mode.
 */

import { COMMAND_NAMES } from "../registry.js";
import { startInteractiveSession as startInteractiveSessionFn } from "../../shared/interactive/chat-session.js";
import { createAgentHandler as createAgentHandlerFn } from "../../shared/session/agent-handler.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";

/**
 * @typedef {Object} RunRouterCommandDeps
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof createAgentHandlerFn} [createAgentHandler]
 * @property {() => import('../../shared/session/types.js').AgentMessageHandler} [createHandler]
 */

/**
 * Handle router/default command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: RunRouterCommandDeps }} [options]
 */
export async function runRouterCommand(argv, options = {}) {
    const deps = /** @type {RunRouterCommandDeps} */ ((/** @type {any} */ (options)).__testDeps || {});
    const printCommandHelp = deps.printCommandHelp || printCommandHelpFn;
    const startInteractiveSession = deps.startInteractiveSession || startInteractiveSessionFn;
    const createAgentHandler = deps.createAgentHandler || createAgentHandlerFn;
    const createHandler = deps.createHandler || (() => null);
    void createAgentHandler;

    const userRequest = argv.join(" ").trim();

    if (userRequest === "help") {
        printCommandHelp(COMMAND_NAMES.ROUTER);
        return;
    }

    await startInteractiveSession(userRequest || null, createHandler(), {
        sessionStartMode: options.sessionStartMode || "new",
    });
}
