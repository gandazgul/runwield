/**
 * @module shared/session/agent-switching
 * Adapter-neutral active Agent switch transaction.
 */

import { createAgentHandler } from "./agent-handler.js";
import {
    ensureRootAgentSession,
    getConfiguredAgentModel,
    getRootSessionSwitchState,
    runRootTurn,
    shouldReuseExistingRootSession,
} from "./session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";

/** @type {WeakMap<import('./hosted-session.js').HostedSession, { agentName: string, model?: string, allowReturnToRouter?: boolean, cwd?: string }>} */
const switchMetadata = new WeakMap();

/** @type {WeakMap<Function, { agentName: string, allowReturnToRouter?: boolean }>} */
const handlerMetadata = new WeakMap();

/**
 * @typedef {Object} AgentSwitchOptions
 * @property {string} agentName
 * @property {string} [model]
 * @property {boolean} [allowReturnToRouter]
 * @property {string} [cwd]
 * @property {boolean} [forceRebuild]
 * @property {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @property {import('../../tools/plan-written.ts').TriageMeta} [triageMeta]
 * @property {{ id: import('./subagent-definitions.ts').SubAgentDefinitionId, options?: import('./subagent-definitions.ts').LoadSubAgentDefinitionOptions }} [subAgentDefinition]
 * @property {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [customTools]
 * @property {string[]} [toolNames]
 * @property {string} [projectStateContext]
 * @property {boolean} [includeEditFallback]
 * @property {string} [debugLogPath]
 * @property {import('./managed-operation.ts').ManagedOperationCapability} [managedOperationCapability]
 */

/**
 * Switch a HostedSession's root Agent as one completed transaction.
 * The target root Agent Session is built before the active handler is replaced,
 * so construction failures leave the previous root/handler pair intact.
 *
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {AgentSwitchOptions} options
 * @returns {Promise<{ ok: true, agentName: string, model?: string, changed: boolean }>}
 */
export async function switchActiveAgent(hostedSession, options) {
    if (!hostedSession) throw new Error("switchActiveAgent requires a HostedSession");
    hostedSession.assertActive();
    const managedOperationCapability = options.managedOperationCapability ||
        hostedSession.getManagedOperationCapability?.() || undefined;
    const agentName = String(options?.agentName || "").trim();
    if (!agentName) throw new Error("switchActiveAgent requires an agentName");

    const previousAgentName = hostedSession.getRootAgentName();
    const previousHandler = hostedSession.getActiveOnMessage();
    const previousRootSession = hostedSession.getRootAgentSession();
    const activeModelState = hostedSession.getActiveModelState?.() || { model: "" };
    const rootSwitchState = getRootSessionSwitchState(hostedSession);
    const previousSwitch = switchMetadata.get(hostedSession);
    const effectiveModel = rootSwitchState?.model ?? previousSwitch?.model ?? activeModelState.model;
    const modelOverride = options.model;
    const configuredModel = modelOverride === undefined
        ? getConfiguredAgentModel(agentName, hostedSession.cwd)
        : undefined;
    const requestedModel = modelOverride ?? configuredModel;
    const modelChanged = requestedModel !== undefined && requestedModel !== effectiveModel;
    const allowReturnToRouterProvided = Object.hasOwn(options, "allowReturnToRouter");
    const effectiveAllowReturnToRouter = rootSwitchState?.allowReturnToRouter ?? previousSwitch?.allowReturnToRouter;
    const allowReturnToRouterChanged = allowReturnToRouterProvided &&
        (effectiveAllowReturnToRouter === undefined || options.allowReturnToRouter !== effectiveAllowReturnToRouter);
    const cwdProvided = Object.hasOwn(options, "cwd") && typeof options.cwd === "string" && options.cwd.length > 0;
    const effectiveCwd = rootSwitchState?.cwd ?? previousSwitch?.cwd ?? hostedSession.cwd;
    const cwdChanged = cwdProvided && options.cwd !== effectiveCwd;
    const customRootConfigurationProvided = Boolean(
        options.subAgentDefinition || options.customTools || options.toolNames || options.triageMeta ||
            options.projectStateContext !== undefined || options.includeEditFallback !== undefined ||
            options.debugLogPath,
    );
    const rootOptions = {
        agentName,
        modelOverride: options.model,
        allowReturnToRouter: allowReturnToRouterProvided ? options.allowReturnToRouter : effectiveAllowReturnToRouter,
        cwd: cwdProvided ? options.cwd : effectiveCwd,
        sessionManager: options.sessionManager,
        triageMeta: options.triageMeta,
        subAgentDefinition: options.subAgentDefinition,
        customTools: options.customTools,
        toolNames: options.toolNames,
        projectStateContext: options.projectStateContext,
        includeEditFallback: options.includeEditFallback,
        debugLogPath: options.debugLogPath,
        managedOperationCapability,
    };
    const canReuseRoot = previousRootSession && !options.forceRebuild && !modelChanged &&
        !allowReturnToRouterChanged && !cwdChanged && !customRootConfigurationProvided &&
        shouldReuseExistingRootSession({ agentName }, previousAgentName);
    const shouldRebuildRoot = !canReuseRoot;
    const nextMetadata = {
        agentName,
        model: requestedModel ?? effectiveModel,
        allowReturnToRouter: allowReturnToRouterProvided ? options.allowReturnToRouter : effectiveAllowReturnToRouter,
        cwd: cwdProvided ? options.cwd : effectiveCwd,
    };
    const previousHandlerMetadata = typeof previousHandler === "function" ? handlerMetadata.get(previousHandler) : null;
    const canReuseHandler = Boolean(
        previousHandler && previousHandlerMetadata &&
            previousHandlerMetadata.agentName === agentName &&
            previousHandlerMetadata.allowReturnToRouter === nextMetadata.allowReturnToRouter &&
            !customRootConfigurationProvided,
    );

    if (!shouldRebuildRoot && canReuseHandler) {
        return { ok: true, agentName, model: options.model, changed: false };
    }

    // Stage the matching handler before the root builder can commit a
    // replacement. A handler-factory failure therefore leaves the previous
    // root/handler pair untouched.
    const handler = createAgentHandler(agentName, {
        hostedSession,
        customTools: options.customTools,
    });
    handlerMetadata.set(handler, {
        agentName,
        allowReturnToRouter: nextMetadata.allowReturnToRouter,
    });

    if (shouldRebuildRoot) {
        await ensureRootAgentSession({
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
 * @property {import('../../tools/plan-written.ts').TriageMeta} [triageMeta]
 * @property {string} [model]
 * @property {boolean} [allowReturnToRouter]
 * @property {string} [cwd]
 * @property {boolean} [forceRebuild]
 * @property {{ id: import('./subagent-definitions.ts').SubAgentDefinitionId, options?: import('./subagent-definitions.ts').LoadSubAgentDefinitionOptions }} [subAgentDefinition]
 * @property {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [customTools]
 * @property {string[]} [toolNames]
 * @property {string} [projectStateContext]
 * @property {boolean} [includeEditFallback]
 * @property {string} [debugLogPath]
 * @property {import('./request-dispatch.ts').RequestDispatchKind} [dispatchKind]
 */

/**
 * Activate an Agent and run its root turn without exposing a state where the
 * root session and interactive handler belong to different Agents.
 *
 * @param {ActiveAgentTurnOptions} options
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runActiveAgentTurn(options) {
    const {
        hostedSession,
        agentName,
        userRequest,
        images,
        sessionManager,
        triageMeta,
        model,
        allowReturnToRouter,
        cwd,
        forceRebuild,
        subAgentDefinition,
        customTools,
        toolNames,
        projectStateContext,
        includeEditFallback,
        debugLogPath,
        dispatchKind,
    } = options;

    const switchOptions = {
        agentName,
        ...(model !== undefined ? { model } : {}),
        ...(allowReturnToRouter !== undefined ? { allowReturnToRouter } : {}),
        ...(cwd ? { cwd } : {}),
        ...(forceRebuild ? { forceRebuild } : {}),
        ...(sessionManager ? { sessionManager } : {}),
        ...(triageMeta ? { triageMeta } : {}),
        ...(subAgentDefinition ? { subAgentDefinition } : {}),
        ...(customTools ? { customTools } : {}),
        ...(toolNames ? { toolNames } : {}),
        ...(projectStateContext !== undefined ? { projectStateContext } : {}),
        ...(includeEditFallback !== undefined ? { includeEditFallback } : {}),
        ...(debugLogPath ? { debugLogPath } : {}),
    };
    await switchActiveAgent(hostedSession, switchOptions);
    return await runRootTurn({
        hostedSession,
        agentName,
        userRequest,
        images,
        dispatchKind,
    });
}
