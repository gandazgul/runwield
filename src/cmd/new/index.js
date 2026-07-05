/**
 * @module cmd/new
 * Command to start a new session.
 */

import { createRootSessionManager } from "../../shared/session/root-session.js";
import { disposeRootAgentSessionForNewSession } from "../../shared/session/session.js";
import { setRootSessionManager } from "../../shared/session/session-state.js";
import { setTerminalTitleForSession } from "../../shared/ui/terminal-title.js";

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

    const deps = /** @type {{
        createRootSessionManager?: typeof createRootSessionManager,
        disposeRootAgentSessionForNewSession?: typeof disposeRootAgentSessionForNewSession,
        setRootSessionManager?: typeof setRootSessionManager,
        setTerminalTitleForSession?: typeof setTerminalTitleForSession,
    }} */
        (options.__testDeps || {});
    const createRoot = deps.createRootSessionManager || createRootSessionManager;
    const disposeRoot = deps.disposeRootAgentSessionForNewSession || disposeRootAgentSessionForNewSession;
    const setRoot = deps.setRootSessionManager || setRootSessionManager;
    const setTitle = deps.setTerminalTitleForSession || setTerminalTitleForSession;
    const { uiAPI } = options;
    const sessionName = argv.join(" ").trim();

    disposeRoot();
    const rootSessionManager = await createRoot("new", Deno.cwd());
    if (sessionName) {
        rootSessionManager.appendSessionInfo(sessionName);
    }
    setRoot(rootSessionManager);
    setTitle(rootSessionManager, Deno.cwd());

    if (uiAPI.clearMessages) {
        uiAPI.clearMessages();
    }
    uiAPI.appendSystemMessage(`Started new session: ${rootSessionManager.getSessionId()}`);
}
