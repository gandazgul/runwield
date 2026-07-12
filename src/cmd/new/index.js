/**
 * @module cmd/new
 * Command to start a new session.
 */

import { AGENTS } from "../../constants.js";
import { createRootSessionManager } from "../../shared/session/root-session.js";
import { createAgentHandler as createAgentHandlerFn } from "../../shared/session/agent-handler.js";
import { switchActiveAgent as switchActiveAgentFn } from "../../shared/session/agent-switching.js";
import { disposeRootAgentSessionForNewSession } from "../../shared/session/session.js";
import { setTerminalTitleForSession } from "../../ui/tui/terminal-title.js";

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

    if (options.sessionRuntime && options.replaceHostedSession) {
        const projectRoot = options.hostedSession?.cwd || Deno.cwd();
        const nextHostedSession = await options.sessionRuntime.createPromptReadySession({
            cwd: projectRoot,
            agentName: AGENTS.ROUTER,
        });
        if (sessionName) options.sessionRuntime.renameSession(nextHostedSession, sessionName);
        options.replaceHostedSession(nextHostedSession);
        const nextManager = nextHostedSession.getRootSessionManager();
        if (nextManager) setTitle(nextManager, projectRoot);
        uiAPI.clearMessages?.();
        uiAPI.appendSystemMessage(`Started new session: ${nextManager?.getSessionId?.() || nextHostedSession.id}`);
        return;
    }

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
        nextHostedSession.setActiveUiAPI(uiAPI);
        nextHostedSession.setEventSink(uiAPI);
    }

    if (nextHostedSession && options.replaceHostedSession) {
        options.replaceHostedSession(nextHostedSession);
    }

    if (nextHostedSession) {
        if (options.switchActiveAgent) {
            await options.switchActiveAgent(nextHostedSession, { agentName: AGENTS.ROUTER }, uiAPI);
        } else if (options.setActiveAgent) {
            options.setActiveAgent(
                nextHostedSession,
                AGENTS.ROUTER,
                createAgentHandler(AGENTS.ROUTER, { hostedSession: nextHostedSession }),
                uiAPI,
            );
            const applyPendingRootSwap = /** @type {any} */ (options).applyPendingRootSwap;
            if (applyPendingRootSwap) {
                await applyPendingRootSwap(nextHostedSession, uiAPI);
            } else {
                await switchActiveAgentFn(nextHostedSession, { agentName: AGENTS.ROUTER }, uiAPI);
            }
        }
    }

    setTitle(rootSessionManager, Deno.cwd());

    if (uiAPI.clearMessages) {
        uiAPI.clearMessages();
    }
    uiAPI.appendSystemMessage(`Started new session: ${rootSessionManager.getSessionId()}`);
}
