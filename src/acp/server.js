/**
 * @module acp/server
 * RunWield ACP stdio server.
 */

import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import { isAbsolute } from "@std/path";
import { SessionRuntime, SessionTurnInProgressError } from "../shared/session/session-runtime.js";
import { AcpSessionMap, normalizeAcpSessionIdForLoad } from "./session-map.js";
import { mapRuntimeEventToAcpSessionNotification } from "./event-mapper.js";
import { createAcpInteractionAdapter } from "./interaction-mapper.js";

const ACP_NOT_IMPLEMENTED = -32004;
const ACP_INVALID_PARAMS = -32602;
const ACP_NOT_FOUND = -32001;
const ACP_INVALID_STATE = -32002;

/** @typedef {import('@agentclientprotocol/sdk').AgentApp} AgentApp */
/** @typedef {import('@agentclientprotocol/sdk').AgentConnection} AgentConnection */

/**
 * @typedef {Object} RunWieldAcpServerOptions
 * @property {(message: string) => void | Promise<void>} [diagnostic]
 * @property {SessionRuntime} [runtime]
 * @property {AcpSessionMap} [sessionMap]
 */

/**
 * Build the stable initialize response for the ACP MVP.
 *
 * @param {import('@agentclientprotocol/sdk').InitializeRequest | undefined} request
 * @returns {import('@agentclientprotocol/sdk').InitializeResponse}
 */
export function createInitializeResponse(request) {
    return {
        protocolVersion: request?.protocolVersion || PROTOCOL_VERSION,
        agentCapabilities: {
            loadSession: true,
            promptCapabilities: {
                _meta: { runwield: { contentTypes: ["text", "resource_link"] } },
            },
            sessionCapabilities: {
                close: {},
                _meta: {
                    runwield: {
                        implementedMethods: [
                            "session/new",
                            "session/load",
                            "session/prompt",
                            "session/cancel",
                            "session/close",
                        ],
                        updateNotifications: ["session/update"],
                    },
                },
            },
        },
        authMethods: [],
        agentInfo: { name: "RunWield", version: "0.0.0-acp-mvp" },
    };
}

/**
 * @param {string} method
 * @returns {never}
 */
function throwUnimplemented(method) {
    throw new RequestError(ACP_NOT_IMPLEMENTED, `RunWield ACP method is not implemented yet: ${method}`, {
        method,
        phase: "session-runtime-acp-mvp",
    });
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 * @returns {never}
 */
function throwInvalidParams(message, data = {}) {
    throw new RequestError(ACP_INVALID_PARAMS, message, data);
}

/**
 * @param {string} sessionId
 * @returns {never}
 */
function throwUnknownSession(sessionId) {
    throw new RequestError(ACP_NOT_FOUND, `Unknown ACP session: ${sessionId}`, { sessionId });
}

/**
 * @param {{ client?: { notify?: Function }, notify?: Function }} context
 * @param {import('@agentclientprotocol/sdk').ClientNotificationMethod} method
 * @param {unknown} params
 * @returns {Promise<void>}
 */
function notifyClient(context, method, params) {
    const maybeContextNotify = /** @type {{ notify?: Function }} */ (context).notify;
    if (typeof maybeContextNotify === "function") {
        return maybeContextNotify.call(context, method, params);
    }
    const clientContext = context.client;
    if (clientContext && typeof clientContext.notify === "function") {
        return clientContext.notify(method, /** @type {any} */ (params));
    }
    return Promise.resolve();
}

/**
 * @param {AgentApp} app
 * @param {import('@agentclientprotocol/sdk').AgentRequestMethod} method
 */
function registerUnimplementedRequest(app, method) {
    app.onRequest(method, () => throwUnimplemented(method));
}

/** @param {unknown} value */
function isNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/**
 * @param {Array<Record<string, any>>} blocks
 * @returns {string}
 */
export function convertAcpPromptToText(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
        throwInvalidParams("session/prompt requires at least one prompt content block");
    }
    /** @type {string[]} */
    const parts = [];
    for (const block of blocks) {
        if (!block || typeof block !== "object") throwInvalidParams("Invalid prompt content block");
        if (block.type === "text") {
            parts.push(String(block.text || ""));
            continue;
        }
        if (block.type === "resource_link") {
            const label = block.title || block.name || block.uri;
            parts.push(`[Resource: ${label} <${block.uri}>]`);
            continue;
        }
        throwInvalidParams(`Unsupported prompt content block type for RunWield ACP MVP: ${block.type}`, {
            contentType: block.type,
        });
    }
    return parts.join("\n").trim();
}

/**
 * @param {unknown} params
 */
export function validateNewSessionParams(params) {
    const request = /** @type {import('@agentclientprotocol/sdk').NewSessionRequest} */ (params || {});
    if (!request.cwd || typeof request.cwd !== "string" || !isAbsolute(request.cwd)) {
        throwInvalidParams("session/new requires an absolute cwd", { cwd: request.cwd });
    }
    if (
        isNonEmptyArray(request.mcpServers) ||
        (request.mcpServers && typeof request.mcpServers === "object" && Object.keys(request.mcpServers).length > 0)
    ) {
        throwInvalidParams("RunWield ACP MVP does not support MCP servers yet", { field: "mcpServers" });
    }
    if (
        isNonEmptyArray(request.additionalDirectories) ||
        (request.additionalDirectories && typeof request.additionalDirectories === "object" &&
            Object.keys(request.additionalDirectories).length > 0)
    ) {
        throwInvalidParams("RunWield ACP MVP does not support additionalDirectories yet", {
            field: "additionalDirectories",
        });
    }
    return request;
}

/** @param {unknown} params */
function validateLoadSessionParams(params) {
    const request = /** @type {import('@agentclientprotocol/sdk').LoadSessionRequest & { _meta?: { runwield?: { sessionPath?: unknown } } }} */
        (params || {});
    validateNewSessionParams(request);
    if (!request.sessionId || typeof request.sessionId !== "string") {
        throwInvalidParams("session/load requires sessionId", { sessionId: request.sessionId });
    }
    const sessionPath = request._meta?.runwield?.sessionPath;
    if (sessionPath !== undefined && typeof sessionPath !== "string") {
        throwInvalidParams("session/load _meta.runwield.sessionPath must be a string", { field: "sessionPath" });
    }
    return { ...request, sessionPath };
}

/** @param {unknown} params */
function validateCloseSessionParams(params) {
    const request = /** @type {import('@agentclientprotocol/sdk').CloseSessionRequest} */ (params || {});
    if (!request.sessionId || typeof request.sessionId !== "string") {
        throwInvalidParams("session/close requires sessionId", { sessionId: request.sessionId });
    }
    return request;
}

/**
 * @param {SessionRuntime} runtime
 * @param {AcpSessionMap} sessionMap
 * @param {string} acpSessionId
 */
async function closeMappedSession(runtime, sessionMap, acpSessionId) {
    const record = sessionMap.getRecord(acpSessionId);
    if (!record) return { ok: false, closed: false, error: "not_found" };
    const hostedSession = sessionMap.getHostedSession(acpSessionId, runtime);
    sessionMap.markCancelled(acpSessionId);
    if (hostedSession) {
        if (runtime.closeSessionWhenIdle) {
            await runtime.closeSessionWhenIdle(hostedSession);
        } else {
            try {
                runtime.cancelSession(hostedSession);
            } catch {
                // Close should still dispose mapping if cancellation fails.
            }
            runtime.closeSession(hostedSession.id);
        }
    }
    sessionMap.deleteRecord(acpSessionId);
    return { ok: true, closed: Boolean(hostedSession), record };
}

/** @param {SessionRuntime} runtime @param {AcpSessionMap} sessionMap */
async function closeAllMappedSessions(runtime, sessionMap) {
    for (const record of sessionMap.listRecords()) await closeMappedSession(runtime, sessionMap, record.acpSessionId);
    if (runtime.closeAllSessionsWhenIdle) await runtime.closeAllSessionsWhenIdle();
    else runtime.closeAllSessions?.();
}

/**
 * Create the RunWield ACP agent app.
 *
 * @param {RunWieldAcpServerOptions} [options]
 * @returns {AgentApp}
 */
export function createRunWieldAcpServer(options = {}) {
    const app = agent({ name: "RunWield ACP MVP" });
    const runtime = options.runtime || new SessionRuntime();
    const sessionMap = options.sessionMap || new AcpSessionMap();
    /** @type {unknown} */
    let clientCapabilities = null;

    app.onRequest(methods.agent.initialize, (context) => {
        clientCapabilities = context.params?.clientCapabilities || null;
        return createInitializeResponse(context.params);
    });

    app.onRequest(methods.agent.session.new, async (context) => {
        const request = validateNewSessionParams(context.params);
        const hostedSession = await runtime.createPromptReadySession({ cwd: request.cwd });
        const record = sessionMap.createRecord(hostedSession);
        return {
            sessionId: record.acpSessionId,
            _meta: {
                runwield: {
                    hostedSessionId: hostedSession.id,
                    persistedSessionId: hostedSession.id,
                    cwd: hostedSession.cwd,
                },
            },
        };
    });

    app.onRequest(methods.agent.session.load, async (context) => {
        const request = validateLoadSessionParams(context.params);
        const persistedSessionId = normalizeAcpSessionIdForLoad(request.sessionId);
        try {
            const result = await runtime.loadSession({
                cwd: request.cwd,
                sessionId: persistedSessionId,
                sessionPath: request.sessionPath,
            });
            const record = sessionMap.createRecord(result.hostedSession, {
                acpSessionId: request.sessionId,
                loaded: true,
                persistedSessionId: result.sessionManagerId,
                sessionPath: result.sessionPath,
            });
            const notifications = result.replayEvents
                .map((event) => mapRuntimeEventToAcpSessionNotification(record.acpSessionId, event))
                .filter(Boolean)
                .map((notification) => notifyClient(context, methods.client.session.update, notification));
            await Promise.allSettled(notifications);
            return {
                _meta: {
                    runwield: {
                        hostedSessionId: result.hostedSession.id,
                        persistedSessionId: result.sessionManagerId,
                        sessionPath: result.sessionPath,
                        cwd: result.hostedSession.cwd,
                        replayedUpdates: notifications.length,
                    },
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || "session/load failed");
            if (message.includes("already exists")) {
                throw new RequestError(ACP_INVALID_STATE, message, { sessionId: request.sessionId });
            }
            throw new RequestError(ACP_NOT_FOUND, `Unable to load ACP session: ${request.sessionId}`, {
                sessionId: request.sessionId,
                cwd: request.cwd,
            });
        }
    });

    app.onRequest(methods.agent.session.prompt, async (context) => {
        const request = /** @type {import('@agentclientprotocol/sdk').PromptRequest} */ (context.params || {});
        const acpSessionId = request.sessionId;
        if (!acpSessionId || typeof acpSessionId !== "string") {
            throwInvalidParams("session/prompt requires sessionId");
        }
        const hostedSession = sessionMap.getHostedSession(acpSessionId, runtime);
        if (!hostedSession) throwUnknownSession(acpSessionId);
        const promptText = convertAcpPromptToText(request.prompt);

        /** @type {Promise<void>[]} */
        const pendingNotifications = [];
        /** @type {import('./session-map.js').AcpPromptRecord | null} */
        let activePrompt = null;
        /** @returns {import('./session-map.js').AcpPromptRecord | null} */
        const getActivePrompt = () => activePrompt;
        /** @type {() => void} */
        let unsubscribe = () => {};
        let promptStarted = false;
        let deferCleanupUntilRuntimeSettles = false;
        let cleanupStarted = false;

        const cleanupPrompt = () => {
            if (!promptStarted || cleanupStarted) return;
            cleanupStarted = true;
            try {
                unsubscribe();
            } finally {
                try {
                    if (activePrompt && sessionMap.isCurrentPrompt(acpSessionId, activePrompt)) {
                        runtime.setInteractionAdapter?.(hostedSession, null, null);
                    }
                } finally {
                    if (activePrompt) sessionMap.endPrompt(acpSessionId, activePrompt);
                }
            }
        };

        try {
            const runtimePrompt = runtime.promptSession(hostedSession, {
                initialRequest: promptText,
                initialImages: [],
                onTurnStarted: ({ turnId }) => {
                    activePrompt = sessionMap.beginPrompt(
                        acpSessionId,
                        turnId,
                        context.requestId ? String(context.requestId) : undefined,
                    );
                    if (!activePrompt) throwUnknownSession(acpSessionId);
                    promptStarted = true;
                    try {
                        runtime.setInteractionAdapter?.(
                            hostedSession,
                            createAcpInteractionAdapter({
                                context,
                                acpSessionId,
                                clientCapabilities,
                            }),
                            {
                                kind: "acp",
                                acpSessionId,
                                capabilities: /** @type {Record<string, unknown>} */ (clientCapabilities || {}),
                            },
                        );
                        unsubscribe = runtime.subscribeSessionEvents(hostedSession, (event) => {
                            const notification = mapRuntimeEventToAcpSessionNotification(acpSessionId, event);
                            if (!notification) return;
                            const pending = notifyClient(context, methods.client.session.update, notification);
                            pendingNotifications.push(pending);
                            return pending;
                        });
                    } catch (error) {
                        cleanupPrompt();
                        throw error;
                    }
                    return cleanupPrompt;
                },
            });
            const startedPrompt = getActivePrompt();
            const result = /** @type {any} */ (
                await (startedPrompt ? Promise.race([runtimePrompt, startedPrompt.cancellation]) : runtimePrompt)
            );
            await Promise.allSettled(pendingNotifications);
            if (getActivePrompt()?.cancelled) {
                deferCleanupUntilRuntimeSettles = true;
                void runtimePrompt.then(cleanupPrompt, cleanupPrompt);
                return { stopReason: "cancelled" };
            }
            if (result?.stopReason === "cancelled") return result;
            if (!result.ok) return { stopReason: "refusal" };
            return { stopReason: "end_turn" };
        } catch (error) {
            await Promise.allSettled(pendingNotifications);
            if (getActivePrompt()?.cancelled) return { stopReason: "cancelled" };
            if (error instanceof SessionTurnInProgressError) {
                throw new RequestError(
                    ACP_INVALID_STATE,
                    `ACP session already has an active prompt: ${acpSessionId}`,
                    { sessionId: acpSessionId },
                );
            }
            throw error;
        } finally {
            if (!deferCleanupUntilRuntimeSettles) cleanupPrompt();
        }
    });

    app.onRequest(methods.agent.session.close, async (context) => {
        const request = validateCloseSessionParams(context.params);
        const record = sessionMap.getRecord(request.sessionId);
        if (!record) throwUnknownSession(request.sessionId);
        const result = await closeMappedSession(runtime, sessionMap, request.sessionId);
        if (!result.ok) throwUnknownSession(request.sessionId);
        return { _meta: { runwield: { sessionId: request.sessionId, closed: result.closed } } };
    });

    app.onNotification(methods.agent.session.cancel, async (context) => {
        const sessionId = context.params?.sessionId;
        if (!sessionId || typeof sessionId !== "string") return;
        const hostedSession = sessionMap.getHostedSession(sessionId, runtime);
        if (!hostedSession) return;
        sessionMap.markCancelled(sessionId);
        try {
            runtime.cancelSession(hostedSession);
        } catch (_error) {
            // Preserve protocol feedback when an injected/runtime abort fails before
            // it can publish the normal cancellation event. This is fallback-only,
            // so successful cancellation still has a single event path.
            const notification = mapRuntimeEventToAcpSessionNotification(sessionId, {
                type: "cancellation",
                sessionId: hostedSession.id,
                timestamp: new Date().toISOString(),
                reason: "session_cancel",
                aborted: false,
            });
            if (notification) await notifyClient(context, methods.client.session.update, notification);
        }
    });

    registerUnimplementedRequest(app, methods.agent.authenticate);
    registerUnimplementedRequest(app, methods.agent.logout);
    registerUnimplementedRequest(app, methods.agent.providers.list);
    registerUnimplementedRequest(app, methods.agent.providers.set);
    registerUnimplementedRequest(app, methods.agent.providers.disable);
    registerUnimplementedRequest(app, methods.agent.session.list);
    registerUnimplementedRequest(app, methods.agent.session.delete);
    registerUnimplementedRequest(app, methods.agent.session.fork);
    registerUnimplementedRequest(app, methods.agent.session.resume);
    registerUnimplementedRequest(app, methods.agent.session.setMode);
    registerUnimplementedRequest(app, methods.agent.session.setConfigOption);
    registerUnimplementedRequest(app, methods.agent.nes.start);
    registerUnimplementedRequest(app, methods.agent.nes.suggest);
    registerUnimplementedRequest(app, methods.agent.nes.close);

    return app;
}

/**
 * Start the RunWield ACP server on newline-delimited JSON streams.
 *
 * @param {ReadableStream<Uint8Array>} input
 * @param {WritableStream<Uint8Array>} output
 * @param {RunWieldAcpServerOptions} [options]
 * @returns {AgentConnection}
 */
export function startRunWieldAcpServer(input, output, options = {}) {
    const stream = ndJsonStream(output, input);
    const runtime = options.runtime || new SessionRuntime();
    const sessionMap = options.sessionMap || new AcpSessionMap();
    const connection = createRunWieldAcpServer({ ...options, runtime, sessionMap }).connect(stream);
    connection.closed.then(
        () => void closeAllMappedSessions(runtime, sessionMap),
        () => void closeAllMappedSessions(runtime, sessionMap),
    );
    const diagnostics = options.diagnostic;
    if (diagnostics) diagnostics("RunWield ACP stdio server started");
    return connection;
}
