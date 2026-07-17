/**
 * @module shared/session/agent-switching
 * Adapter-neutral active Agent switch transaction.
 */

import { createAgentHandler } from "./agent-handler.js";
import {
    ensureRootAgentSession,
    getRootSessionSwitchState,
    runRootTurn,
    shouldReuseExistingRootSession,
} from "./session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";

/** @type {WeakMap<import('./hosted-session.js').HostedSession, { agentName: string, model?: string, allowReturnToRouter?: boolean, cwd?: string }>} */
const switchMetadata = new WeakMap();

/** @type {WeakMap<Function, { agentName: string, allowReturnToRouter?: boolean, usesDefaultFactory: boolean }>} */
const handlerMetadata = new WeakMap();

/**
 * @typedef {Object} AgentSwitchOptions
 * @property {string} agentName
 * @property {string} [model]
 * @property {boolean} [allowReturnToRouter]
 * @property {string} [cwd]
 * @property {boolean} [forceRebuild]
 * @property {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @property {import('./types.js').AgentDefinition} [agentDef]
 * @property {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [customTools]
 * @property {string[]} [toolNames]
 * @property {string} [projectStateContext]
 * @property {boolean} [includeEditFallback]
 * @property {string} [debugLogPath]
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
 * @param {SwitchActiveAgentDependencies} [dependencies]
 * @returns {Promise<{ ok: true, agentName: string, model?: string, changed: boolean }>}
 */
export async function switchActiveAgent(hostedSession, options, dependencies = {}) {
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
    const cwdProvided = Object.hasOwn(options, "cwd") && typeof options.cwd === "string" && options.cwd.length > 0;
    const effectiveCwd = rootSwitchState?.cwd ?? previousSwitch?.cwd ?? hostedSession.cwd;
    const cwdChanged = cwdProvided && options.cwd !== effectiveCwd;
    const customRootConfigurationProvided = Boolean(
        options.agentDef || options.customTools || options.toolNames || options.projectStateContext !== undefined ||
            options.includeEditFallback !== undefined || options.debugLogPath,
    );
    const rootOptions = {
        agentName,
        modelOverride: options.model,
        allowReturnToRouter: allowReturnToRouterProvided ? options.allowReturnToRouter : effectiveAllowReturnToRouter,
        cwd: cwdProvided ? options.cwd : effectiveCwd,
        sessionManager: options.sessionManager,
        _agentDefOverride: options.agentDef,
        customTools: options.customTools,
        toolNames: options.toolNames,
        projectStateContext: options.projectStateContext,
        includeEditFallback: options.includeEditFallback,
        debugLogPath: options.debugLogPath,
    };
    const canReuseRoot = previousRootSession && !options.forceRebuild && !modelChanged &&
        !allowReturnToRouterChanged && !cwdChanged && !customRootConfigurationProvided &&
        shouldReuseExistingRootSession({ agentName }, previousAgentName);
    const shouldRebuildRoot = !canReuseRoot;
    const createAgentHandlerProvided = Object.hasOwn(dependencies, "createAgentHandler");
    const nextMetadata = {
        agentName,
        model: options.model ?? effectiveModel,
        allowReturnToRouter: allowReturnToRouterProvided ? options.allowReturnToRouter : effectiveAllowReturnToRouter,
        cwd: cwdProvided ? options.cwd : effectiveCwd,
    };
    const previousHandlerMetadata = typeof previousHandler === "function" ? handlerMetadata.get(previousHandler) : null;
    const canReuseHandler = Boolean(
        previousHandler && previousHandlerMetadata &&
            previousHandlerMetadata.agentName === agentName &&
            previousHandlerMetadata.allowReturnToRouter === nextMetadata.allowReturnToRouter &&
            previousHandlerMetadata.usesDefaultFactory === !createAgentHandlerProvided &&
            !customRootConfigurationProvided,
    );

    if (!shouldRebuildRoot && canReuseHandler) {
        return { ok: true, agentName, model: options.model, changed: false };
    }

    // Stage the matching handler before the root builder can commit a
    // replacement. A handler-factory failure therefore leaves the previous
    // root/handler pair untouched.
    const handler = createAgentHandlerImpl(agentName, {
        hostedSession,
        allowReturnToRouter: nextMetadata.allowReturnToRouter,
        _agentDefOverride: options.agentDef,
        customTools: options.customTools,
    });
    handlerMetadata.set(handler, {
        agentName,
        allowReturnToRouter: nextMetadata.allowReturnToRouter,
        usesDefaultFactory: !createAgentHandlerProvided,
    });

    if (shouldRebuildRoot) {
        await ensureRootAgentSessionImpl({
            hostedSession,
            ...rootOptions,
            activeHandler: handler,
        });
        if (hostedSession.getActiveOnMessage() !== handler) {
            throw new Error("switchActiveAgent: root builder did not atomically commit the staged Agent handler");
        }
    } else {
        hostedSession.setActiveOnMessage(handler);
    }
    hostedSession.assertActive();
    switchMetadata.set(hostedSession, nextMetadata);
    const changed = shouldRebuildRoot || previousAgentName !== agentName || !canReuseHandler;
    if (changed) {
        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.AGENT_CHANGED,
            agentName,
            model: options.model,
        });
    }
    return { ok: true, agentName, model: options.model, changed };
}

/**
 * @typedef {Object} ActiveAgentTurnOptions
 * @property {import('./hosted-session.js').HostedSession} hostedSession
 * @property {string} agentName
 * @property {string} userRequest
 * @property {Array<{base64: string, mimeType: string}>} [images]
 * @property {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @property {string} [model]
 * @property {boolean} [allowReturnToRouter]
 * @property {string} [cwd]
 * @property {boolean} [forceRebuild]
 * @property {import('./types.js').AgentDefinition} [agentDef]
 * @property {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [customTools]
 * @property {string[]} [toolNames]
 * @property {string} [projectStateContext]
 * @property {boolean} [includeEditFallback]
 * @property {string} [debugLogPath]
 */

/**
 * Activate an Agent and run its root turn without exposing a state where the
 * root session and interactive handler belong to different Agents.
 *
 * @param {ActiveAgentTurnOptions} options
 * @param {{
 *   switchActiveAgent?: typeof switchActiveAgent,
 *   runRootTurn?: typeof runRootTurn,
 * }} [dependencies]
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runActiveAgentTurn(options, dependencies = {}) {
    const switchActiveAgentImpl = dependencies.switchActiveAgent || switchActiveAgent;
    const runRootTurnImpl = dependencies.runRootTurn || runRootTurn;
    const {
        hostedSession,
        agentName,
        userRequest,
        images,
        sessionManager,
        model,
        allowReturnToRouter,
        cwd,
        forceRebuild,
        agentDef,
        customTools,
        toolNames,
        projectStateContext,
        includeEditFallback,
        debugLogPath,
    } = options;

    const switchOptions = {
        agentName,
        ...(model !== undefined ? { model } : {}),
        ...(allowReturnToRouter !== undefined ? { allowReturnToRouter } : {}),
        ...(cwd ? { cwd } : {}),
        ...(forceRebuild ? { forceRebuild } : {}),
        ...(sessionManager ? { sessionManager } : {}),
        ...(agentDef ? { agentDef } : {}),
        ...(customTools ? { customTools } : {}),
        ...(toolNames ? { toolNames } : {}),
        ...(projectStateContext !== undefined ? { projectStateContext } : {}),
        ...(includeEditFallback !== undefined ? { includeEditFallback } : {}),
        ...(debugLogPath ? { debugLogPath } : {}),
    };
    await switchActiveAgentImpl(hostedSession, switchOptions);
    return await runRootTurnImpl({
        hostedSession,
        agentName,
        userRequest,
        images,
    });
}
