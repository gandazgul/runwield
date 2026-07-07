/**
 * @module shared/session/agent-switching
 * Adapter-neutral active Agent switching helpers for HostedSession roots.
 */

import { getAgentDisplayName } from "./agents.js";
import { ensureRootAgentSession } from "./session.js";

/**
 * Update the active agent and its message handler.
 *
 * Footer/display state is updated only when the root session is rebuilt for the
 * new agent via `ensureRootAgentSession()` and the adapter's UI API.
 *
 * @param {any} hostedSession
 * @param {any} agentName
 * @param {any} [handler]
 * @param {any} [uiAPI]
 * @param {any} [agentModel]
 * @param {any} [options]
 */
export function setActiveAgent(hostedSession, agentName, handler, uiAPI, agentModel, options = {}) {
    if (!hostedSession || typeof hostedSession !== "object" || typeof hostedSession.setActiveOnMessage !== "function") {
        uiAPI?.appendSystemMessage?.("Cannot switch agents before a HostedSession is available.");
        uiAPI?.requestRender?.();
        return;
    }
    hostedSession.setActiveOnMessage(/** @type {import('./types.js').AgentMessageHandler} */ (handler));

    if (uiAPI) {
        hostedSession.setActiveUiAPI(uiAPI);
    }

    if (agentName === hostedSession.getRootAgentName()) {
        uiAPI?.requestRender?.();
        return;
    }

    /** @type {import('./hosted-session.js').PendingRootSwap} */
    const pendingSwap = {
        agentName,
        displayName: getAgentDisplayName(agentName),
        model: agentModel,
    };
    if (options.allowReturnToRouter !== undefined) {
        pendingSwap.allowReturnToRouter = options.allowReturnToRouter;
    }
    hostedSession.setPendingRootSwap(pendingSwap);

    uiAPI?.requestRender?.();
}

/**
 * Apply a pending root swap, if one is queued for the HostedSession.
 *
 * @param {import('./hosted-session.js').HostedSession | null | undefined} hostedSession
 * @param {any} [uiAPI]
 * @returns {Promise<void>}
 */
export async function applyPendingRootSwap(hostedSession, uiAPI) {
    if (!hostedSession || typeof hostedSession !== "object" || typeof hostedSession.getPendingRootSwap !== "function") {
        return;
    }
    const pending = hostedSession.getPendingRootSwap();
    if (!pending) return;
    if (pending.agentName === hostedSession.getRootAgentName()) {
        hostedSession.setPendingRootSwap(null);
        return;
    }
    hostedSession.setPendingRootSwap(null);
    try {
        hostedSession.clearUserModelOverride();
        await ensureRootAgentSession({
            hostedSession,
            agentName: pending.agentName,
            modelOverride: pending.model,
            uiAPI,
            sessionManager: /** @type {any} */ (hostedSession.getRootSessionManager() || undefined),
            allowReturnToRouter: pending.allowReturnToRouter,
        });
        uiAPI?.requestRender?.();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        uiAPI?.appendSystemMessage?.(`Failed to switch root agent to "${pending.agentName}": ${msg}`);
    }
}
