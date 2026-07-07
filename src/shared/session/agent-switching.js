/**
 * @module shared/session/agent-switching
 * Helpers for updating the active agent handler and applying pending root-agent swaps.
 */

import { getAgentDisplayName } from "./agents.js";
import { ensureRootAgentSession } from "./session.js";

/**
 * @typedef {Object} AgentSwitchOptions
 * @property {boolean} [allowReturnToRouter]
 */

/**
 * @param {any} hostedSessionOrAgentName
 * @param {any} agentNameOrHandler
 * @param {any} handlerOrUiAPI
 * @param {any} uiAPIOrAgentModel
 * @param {any} agentModelOrOptions
 * @param {any} optionsArg
 */
export function setActiveAgent(
    hostedSessionOrAgentName,
    agentNameOrHandler,
    handlerOrUiAPI,
    uiAPIOrAgentModel = undefined,
    agentModelOrOptions = undefined,
    optionsArg = undefined,
) {
    const hasExplicitSession = hostedSessionOrAgentName && typeof hostedSessionOrAgentName === "object" &&
        typeof hostedSessionOrAgentName.setActiveOnMessage === "function";
    if (!hasExplicitSession) {
        // Legacy injection shape used by tests and wrappers that bind their own HostedSession.
        handlerOrUiAPI?.requestRender?.();
        return;
    }

    const hostedSession = hostedSessionOrAgentName;
    const agentName = String(agentNameOrHandler || "");
    const handler = handlerOrUiAPI;
    const uiAPI = uiAPIOrAgentModel;
    const agentModel = typeof agentModelOrOptions === "string" ? agentModelOrOptions : undefined;
    const options = typeof agentModelOrOptions === "object" && agentModelOrOptions
        ? agentModelOrOptions
        : (optionsArg || {});

    hostedSession.setActiveOnMessage(handler);

    if (hostedSession.getRootAgentName() !== agentName) {
        hostedSession.setPendingRootSwap({
            agentName,
            displayName: getAgentDisplayName(agentName),
            ...(agentModel ? { model: agentModel } : {}),
            ...(options.allowReturnToRouter !== undefined ? { allowReturnToRouter: options.allowReturnToRouter } : {}),
        });
    }

    uiAPI?.requestRender?.();
}

/**
 * @param {import('./hosted-session.js').HostedSession | undefined} hostedSession
 * @param {import('../../ui/tui/types.js').UiAPI | undefined} uiAPI
 */
export async function applyPendingRootSwap(hostedSession, uiAPI) {
    if (!hostedSession) return;
    const pending = hostedSession.getPendingRootSwap();
    if (!pending) return;

    if (hostedSession.getRootAgentName() === pending.agentName) {
        hostedSession.setPendingRootSwap(null);
        return;
    }

    await ensureRootAgentSession({
        hostedSession,
        agentName: pending.agentName,
        modelOverride: pending.model,
        uiAPI,
        allowReturnToRouter: pending.allowReturnToRouter,
    });

    hostedSession.setPendingRootSwap(null);
    uiAPI?.appendSystemMessage?.(`Switched to ${pending.displayName}.`);
    uiAPI?.requestRender?.();
}
