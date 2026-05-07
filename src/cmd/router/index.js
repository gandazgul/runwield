/**
 * @module cmd/router
 * Router command (also used as the default command).
 *
 * The router is just the entry-point of the triage orchestrator. This file
 * launches the interactive TUI with the orchestrator handler attached;
 * dispatch logic itself lives in `shared/workflow/orchestrator.js`.
 */

import { COMMAND_NAMES } from "../../constants.js";
import { startInteractiveSession as startInteractiveSessionFn } from "../../shared/chat-session.js";
import { createRouterOrchestratorHandler as createRouterOrchestratorHandlerFn } from "../../shared/workflow/orchestrator.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";

/**
 * @typedef {Object} RunRouterCommandDeps
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof createRouterOrchestratorHandlerFn} [createHandler]
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
    const createHandler = deps.createHandler || createRouterOrchestratorHandlerFn;

    const userRequest = argv.join(" ").trim();

    if (userRequest === "help") {
        printCommandHelp(COMMAND_NAMES.ROUTER);
        return;
    }

    await startInteractiveSession(userRequest || null, createHandler(), {
        sessionStartMode: options.sessionStartMode || "new",
    });
}
