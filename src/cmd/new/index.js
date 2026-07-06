/**
 * @module cmd/new
 * Command to start a new session.
 */

import { AGENTS } from "../../constants.js";
import { createRootSessionManager } from "../../shared/session/root-session.js";
import { createAgentHandler as createAgentHandlerFn } from "../../shared/session/agent-handler.js";
import { disposeRootAgentSessionForNewSession } from "../../shared/session/session.js";
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
        createAgentHandler?: typeof createAgentHandlerFn,
        disposeRootAgentSessionForNewSession?: typeof disposeRootAgentSessionForNewSession,
        setTerminalTitleForSession?: typeof setTerminalTitleForSession,
    }} */
        (options.__testDeps || {});
    const createRoot = deps.createRootSessionManager || createRootSessionManager;
    const createAgentHandler = deps.createAgentHandler || createAgentHandlerFn;
    const disposeRoot = deps.disposeRootAgentSessionForNewSession || disposeRootAgentSessionForNewSession;
    const setTitle = deps.setTerminalTitleForSession || setTerminalTitleForSession;
    const { uiAPI } = options;
    const sessionName = argv.join(" ").trim();

    if (options.hostedSession) {
        disposeRoot(options.hostedSession);
    }
    const rootSessionManager = await createRoot("new", Deno.cwd());
    if (sessionName) {
        rootSessionManager.appendSessionInfo(sessionName);
    }

    let nextHostedSession = options.hostedSession;
    if (options.sessionHost) {
        nextHostedSession = options.sessionHost.createSession({
            sessionManager: rootSessionManager,
            cwd: Deno.cwd(),
            uiAPI,
            eventSink: uiAPI,
        });
    } else if (nextHostedSession) {
        nextHostedSession.setRootSessionManager(rootSessionManager);
        nextHostedSession.setRootAgentSession(null);
        nextHostedSession.setRootAgentName(null);
        nextHostedSession.resetAgentInfoStack("Router");
        nextHostedSession.clearUserModelOverride();
        nextHostedSession.setPendingRootSwap(null);
        nextHostedSession.setPendingSwitchHandoff(null);
        nextHostedSession.setActiveUiAPI(uiAPI);
        nextHostedSession.setEventSink(uiAPI);
    }

    if (nextHostedSession && options.replaceHostedSession) {
        options.replaceHostedSession(nextHostedSession);
    }

    if (options.setActiveAgent) {
        options.setActiveAgent(
            nextHostedSession,
            AGENTS.ROUTER,
            createAgentHandler(AGENTS.ROUTER, nextHostedSession ? { hostedSession: nextHostedSession } : undefined),
            uiAPI,
        );
        await options.applyPendingRootSwap?.(nextHostedSession, uiAPI);
    }

    setTitle(rootSessionManager, Deno.cwd());

    if (uiAPI.clearMessages) {
        uiAPI.clearMessages();
    }
    uiAPI.appendSystemMessage(`Started new session: ${rootSessionManager.getSessionId()}`);
}
