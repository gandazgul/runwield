/**
 * @module shared/session/agent-switching
 * Adapter-neutral active Agent switch transaction.
 */

import { createAgentHandler } from "./agent-handler.js";
import { getAgentDisplayName } from "./agents.js";
import { ensureRootAgentSession } from "./session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";

/**
 * @typedef {Object} AgentSwitchOptions
 * @property {string} agentName
 * @property {string} [model]
 * @property {boolean} [allowReturnToRouter]
 */

/**
 * @typedef {Object} SwitchActiveAgentDependencies
 * @property {typeof ensureRootAgentSession} [ensureRootAgentSession]
 * @property {typeof createAgentHandler} [createAgentHandler]
 */

/**
 * Switch a HostedSession's root Agent as one completed transaction.
 * The target root Agent Session is built before the active handler is replaced,
 * so construction failures leave the previous root/handler pair intact.
 *
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {AgentSwitchOptions} options
 * @param {import('../types.js').SessionUiPort | undefined} uiAPI
 * @param {SwitchActiveAgentDependencies} [dependencies]
 * @returns {Promise<{ ok: true, agentName: string, model?: string, changed: boolean }>}
 */
export async function switchActiveAgent(hostedSession, options, uiAPI, dependencies = {}) {
    if (!hostedSession) throw new Error("switchActiveAgent requires a HostedSession");
    hostedSession.assertActive();
    const agentName = String(options?.agentName || "").trim();
    if (!agentName) throw new Error("switchActiveAgent requires an agentName");

    const previousAgentName = hostedSession.getRootAgentName();
    const previousHandler = hostedSession.getActiveOnMessage();
    const ensureRootAgentSessionImpl = dependencies.ensureRootAgentSession || ensureRootAgentSession;
    const createAgentHandlerImpl = dependencies.createAgentHandler || createAgentHandler;

    await ensureRootAgentSessionImpl({
        hostedSession,
        agentName,
        modelOverride: options.model,
        uiAPI,
        allowReturnToRouter: options.allowReturnToRouter,
    });

    if (hostedSession.disposed) return { ok: true, agentName, model: options.model, changed: false };
    const handler = createAgentHandlerImpl(agentName, {
        hostedSession,
        allowReturnToRouter: options.allowReturnToRouter,
    });
    hostedSession.setActiveOnMessage(handler);
    const changed = previousAgentName !== agentName || previousHandler !== handler;
    emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.AGENT_CHANGED,
        agentName,
        model: options.model,
    });
    uiAPI?.appendSystemMessage?.(`Switched to ${getAgentDisplayName(agentName, hostedSession.cwd)}.`);
    uiAPI?.requestRender?.();
    return { ok: true, agentName, model: options.model, changed };
}

/**
 * Compatibility adapter for older command/test injections. Production code should
 * prefer switchActiveAgent/SessionRuntime.switchAgent.
 *
 * @param {any} hostedSessionOrAgentName
 * @param {any} agentNameOrHandler
 * @param {any} handlerOrUiAPI
 * @param {any} uiAPIOrAgentModel
 * @param {any} agentModelOrOptions
 * @param {any} agentOptions
 */
export function setActiveAgent(
    hostedSessionOrAgentName,
    agentNameOrHandler,
    handlerOrUiAPI,
    uiAPIOrAgentModel = undefined,
    agentModelOrOptions = undefined,
    agentOptions = undefined,
) {
    const hasExplicitSession = hostedSessionOrAgentName && typeof hostedSessionOrAgentName === "object" &&
        typeof hostedSessionOrAgentName.setActiveOnMessage === "function";
    if (!hasExplicitSession) {
        handlerOrUiAPI?.requestRender?.();
        return;
    }

    const hostedSession = hostedSessionOrAgentName;
    const agentName = String(agentNameOrHandler || "").trim();
    const handler = handlerOrUiAPI;
    const uiAPI = uiAPIOrAgentModel;
    const model = typeof agentModelOrOptions === "string" ? agentModelOrOptions : undefined;
    const options = typeof agentModelOrOptions === "object" ? agentModelOrOptions : agentOptions;
    hostedSession.setActiveOnMessage(handler);
    if (agentName && typeof hostedSession.setPendingRootSwap === "function") {
        if (hostedSession.getRootAgentName?.() === agentName) {
            hostedSession.setPendingRootSwap(null);
        } else {
            hostedSession.setPendingRootSwap({
                agentName,
                displayName: getAgentDisplayName(agentName, hostedSession.cwd),
                ...(model ? { model } : {}),
                ...(options?.allowReturnToRouter ? { allowReturnToRouter: true } : {}),
            });
        }
    }
    uiAPI?.requestRender?.();
}

/**
 * Compatibility bridge for callers/tests that still queue HostedSession root swaps.
 *
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {import('../types.js').SessionUiPort | undefined} uiAPI
 * @param {SwitchActiveAgentDependencies} [dependencies]
 */
export async function applyPendingRootSwap(hostedSession, uiAPI, dependencies = {}) {
    const pending = hostedSession?.getPendingRootSwap?.();
    if (!pending) return;
    if (hostedSession.getRootAgentName?.() === pending.agentName) {
        hostedSession.setPendingRootSwap(null);
        return;
    }
    try {
        await switchActiveAgent(
            hostedSession,
            {
                agentName: pending.agentName,
                model: pending.model,
                allowReturnToRouter: pending.allowReturnToRouter,
            },
            uiAPI,
            dependencies,
        );
        hostedSession.setPendingRootSwap(null);
    } catch (error) {
        if (hostedSession.disposed) return;
        throw error;
    }
}
