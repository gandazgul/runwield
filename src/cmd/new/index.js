/**
 * @module cmd/new
 * Command to start a new session.
 */

import { AGENTS } from "../../constants.js";
import { setTerminalTitleForName } from "../../ui/tui/terminal-title.js";

/**
 * Handle new session command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runNewCommand(argv, options = {}) {
    if (!options?.uiAPI) {
        console.error("The /new command is only available inside an interactive session.");
        return;
    }

    const { uiAPI } = options;
    const deps = /** @type {{ setTerminalTitleForName?: typeof setTerminalTitleForName }} */ (options.__testDeps || {});
    const setTitle = deps.setTerminalTitleForName || setTerminalTitleForName;
    const sessionName = argv.join(" ").trim();

    if (!options.sessionRuntime || !options.replaceRuntimeSession) {
        throw new Error("/new requires the SessionRuntime surface.");
    }
    const projectRoot = options.sessionId
        ? options.sessionRuntime.getSessionSnapshot(options.sessionId)?.cwd || Deno.cwd()
        : Deno.cwd();
    const nextSessionId = await options.sessionRuntime.createPromptReadySession({
        cwd: projectRoot,
        agentName: AGENTS.ROUTER,
    });
    if (sessionName) options.sessionRuntime.renameSession(nextSessionId, sessionName);
    options.replaceRuntimeSession(nextSessionId);
    setTitle(sessionName || projectRoot);
    uiAPI.clearMessages?.();
}
