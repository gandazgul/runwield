/**
 * @module cmd/new
 * Command to start a new session.
 */

import { createRootSessionManager } from "../../shared/session/root-session.js";
import { setRootSessionManager } from "../../shared/session/session-state.js";

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
    const sessionName = argv.join(" ").trim();

    const rootSessionManager = await createRootSessionManager("new", Deno.cwd());
    if (sessionName) {
        rootSessionManager.appendSessionInfo(sessionName);
    }
    setRootSessionManager(rootSessionManager);

    if (uiAPI.clearMessages) {
        uiAPI.clearMessages();
    }
    uiAPI.appendSystemMessage(`Started new session: ${rootSessionManager.getSessionId()}`);
}
