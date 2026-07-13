/**
 * @module shared/session/agent-switching
 * Adapter-neutral active Agent switch transaction.
 */

import { createAgentHandler } from "./agent-handler.js";
import { ensureRootAgentSession, getRootSessionSwitchState, shouldReuseExistingRootSession } from "./session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";

/** @type {WeakMap<import('./hosted-session.js').HostedSession, { agentName: string, model?: string, allowReturnToRouter?: boolean }>} */
const switchMetadata = new WeakMap();

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
 * @property {typeof getRootSessionSwitchState} [getRootSessionSwitchState]
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
    const previousRootSession = hostedSession.getRootAgentSession();
    const ensureRootAgentSessionImpl = dependencies.ensureRootAgentSession || ensureRootAgentSession;
    const createAgentHandlerImpl = dependencies.createAgentHandler || createAgentHandler;
    const getRootSessionSwitchStateImpl = dependencies.getRootSessionSwitchState || getRootSessionSwitchState;
    const activeModelState = hostedSession.getActiveModelState?.() || { model: "" };
    const rootSwitchState = getRootSessionSwitchStateImpl(hostedSession);
    const previousSwitch = switchMetadata.get(hostedSession);
    const effectiveModel = rootSwitchState?.model ?? previousSwitch?.model ?? activeModelState.model;
    const modelOverride = options.model;
    const modelChanged = modelOverride !== undefined && modelOverride !== effectiveModel;
    const allowReturnToRouterProvided = Object.hasOwn(options, "allowReturnToRouter");
    const effectiveAllowReturnToRouter = rootSwitchState?.allowReturnToRouter ?? previousSwitch?.allowReturnToRouter;
    const allowReturnToRouterChanged = allowReturnToRouterProvided &&
        (effectiveAllowReturnToRouter === undefined || options.allowReturnToRouter !== effectiveAllowReturnToRouter);
    const rootOptions = {
        agentName,
        modelOverride: modelChanged ? modelOverride : undefined,
        allowReturnToRouter: allowReturnToRouterChanged ? options.allowReturnToRouter : undefined,
    };
    const canReuseRoot = previousRootSession && !modelChanged && !allowReturnToRouterChanged &&
        shouldReuseExistingRootSession(rootOptions, previousAgentName);
    const shouldRebuildRoot = !canReuseRoot;

    if (shouldRebuildRoot) {
        await ensureRootAgentSessionImpl({
            hostedSession,
            agentName,
            modelOverride,
            uiAPI,
            allowReturnToRouter: options.allowReturnToRouter,
        });
    }

    if (hostedSession.disposed) return { ok: true, agentName, model: options.model, changed: false };

    const nextMetadata = {
        agentName,
        model: options.model ?? effectiveModel,
        allowReturnToRouter: allowReturnToRouterProvided ? options.allowReturnToRouter : effectiveAllowReturnToRouter,
    };
    switchMetadata.set(hostedSession, nextMetadata);

    if (!shouldRebuildRoot && previousHandler) {
        return { ok: true, agentName, model: options.model, changed: false };
    }

    const handler = createAgentHandlerImpl(agentName, {
        hostedSession,
        allowReturnToRouter: options.allowReturnToRouter,
    });
    hostedSession.setActiveOnMessage(handler);
    const changed = shouldRebuildRoot || previousAgentName !== agentName || !previousHandler;
    if (changed) {
        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.AGENT_CHANGED,
            agentName,
            model: options.model,
        });
    }
    return { ok: true, agentName, model: options.model, changed };
}
