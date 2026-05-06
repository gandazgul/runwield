/**
 * @module cmd/router
 * Router command implementation (also used as default command).
 *
 * The router is just another agent — its special triage_report tool handles all
 * routing logic when called. No custom onMessage handling needed here.
 */

import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import { startInteractiveSession as startInteractiveSessionFn } from "../../shared/chat-session.js";
import { COMMAND_NAMES } from "../../constants.js";
import { createDirectAgentHandler as createDirectAgentHandlerFn } from "../../shared/direct-agent.js";

/**
 * @typedef {Object} RunRouterCommandDeps
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof createDirectAgentHandlerFn} [createDirectAgentHandler]
 */

/**
 * Handle router/default command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: RunRouterCommandDeps }} [options]
 */
export async function runRouterCommand(argv, options = {}) {
    const deps = /** @type {RunRouterCommandDeps} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        printCommandHelp: printCommandHelpDep,
        startInteractiveSession: startInteractiveSessionDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
    } = deps;

    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;

    const userRequest = argv.join(" ").trim();

    if (userRequest === "help") {
        printCommandHelp(COMMAND_NAMES.ROUTER);
        return;
    }

    const handler = createDirectAgentHandler("router");
    await startInteractiveSession(userRequest || null, handler, {
        sessionStartMode: options.sessionStartMode || "new",
    });
}
