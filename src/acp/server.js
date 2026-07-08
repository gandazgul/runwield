/**
 * @module acp/server
 * RunWield ACP stdio server.
 */

import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import { isAbsolute } from "@std/path";
import { SessionRuntime } from "../shared/session/session-runtime.js";
import { AcpSessionMap } from "./session-map.js";
import { mapRuntimeEventToAcpSessionNotification } from "./event-mapper.js";

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
            promptCapabilities: {
                _meta: { runwield: { contentTypes: ["text", "resource_link"] } },
            },
            sessionCapabilities: {
                _meta: {
                    runwield: {
                        implementedMethods: ["session/new", "session/prompt", "session/cancel"],
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
 * @param {SessionRuntime} runtime
 * @param {import('../shared/session/hosted-session.js').HostedSession} hostedSession
 * @returns {any}
 */
function createAcpRuntimeUi(runtime, hostedSession) {
    return {
        /** @param {unknown} message @param {boolean} [isError] */
        appendSystemMessage(message, isError = false) {
            runtime.emitSessionEvent(hostedSession, {
                type: "system_status",
                level: isError ? "error" : "info",
                message: String(message),
            });
        },
        appendAgentMessageStart() {
            return { appendText() {} };
        },
        appendThinkingStart() {
            return { appendDelta() {}, end() {} };
        },
        /** @param {string} _id @param {string} _name @param {string} _args */
        startToolExecution(_id, _name, _args) {
            return {
                bodyText: "",
                startTime: Date.now(),
                /** @param {unknown} delta */
                appendOutput(delta) {
                    this.bodyText += String(delta || "");
                },
                endExecution() {},
            };
        },
        getActiveToolBlock() {
            return null;
        },
        setBusy() {},
        requestRender() {},
        promptSelect() {
            return Promise.reject(new Error("ACP interactive select prompts are not supported in this slice"));
        },
        promptText() {
            return Promise.reject(new Error("ACP interactive text prompts are not supported in this slice"));
        },
    };
}

/**
 * @param {unknown} params
 */
function validateNewSessionParams(params) {
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

    app.onRequest(methods.agent.initialize, (context) => createInitializeResponse(context.params));

    app.onRequest(methods.agent.session.new, async (context) => {
        const request = validateNewSessionParams(context.params);
        const hostedSession = await runtime.createPromptReadySession({ cwd: request.cwd });
        const record = sessionMap.createRecord(hostedSession);
        return {
            sessionId: record.acpSessionId,
            _meta: { runwield: { hostedSessionId: hostedSession.id, cwd: hostedSession.cwd } },
        };
    });

    app.onRequest(methods.agent.session.prompt, async (context) => {
        const request = /** @type {import('@agentclientprotocol/sdk').PromptRequest} */ (context.params || {});
        const acpSessionId = request.sessionId;
        if (!acpSessionId || typeof acpSessionId !== "string") {
            throwInvalidParams("session/prompt requires sessionId");
        }
        const hostedSession = sessionMap.getHostedSession(acpSessionId, runtime);
        if (!hostedSession) throwUnknownSession(acpSessionId);
        if (sessionMap.hasActivePrompt(acpSessionId)) {
            throw new RequestError(ACP_INVALID_STATE, `ACP session already has an active prompt: ${acpSessionId}`, {
                sessionId: acpSessionId,
            });
        }
        const promptText = convertAcpPromptToText(request.prompt);
        const activePrompt = sessionMap.beginPrompt(
            acpSessionId,
            context.requestId ? String(context.requestId) : undefined,
        );
        if (!activePrompt) {
            throw new RequestError(ACP_INVALID_STATE, `ACP session already has an active prompt: ${acpSessionId}`, {
                sessionId: acpSessionId,
            });
        }

        /** @type {Promise<void>[]} */
        const pendingNotifications = [];
        const unsubscribe = runtime.subscribeSessionEvents(hostedSession, (event) => {
            const notification = mapRuntimeEventToAcpSessionNotification(acpSessionId, event);
            if (!notification) return;
            const pending = notifyClient(context, methods.client.session.update, notification);
            pendingNotifications.push(pending);
            return pending;
        });

        const runtimePrompt = runtime.promptSession(hostedSession, {
            uiAPI: createAcpRuntimeUi(runtime, hostedSession),
            initialRequest: promptText,
            initialImages: [],
        });

        try {
            const result = /** @type {any} */ (await Promise.race([runtimePrompt, activePrompt.cancellation]));
            await Promise.allSettled(pendingNotifications);
            if (sessionMap.isPromptCancelled(acpSessionId)) return { stopReason: "cancelled" };
            if (result?.stopReason === "cancelled") return result;
            if (!result.ok) return { stopReason: "refusal" };
            return { stopReason: "end_turn" };
        } catch (error) {
            await Promise.allSettled(pendingNotifications);
            if (sessionMap.isPromptCancelled(acpSessionId)) return { stopReason: "cancelled" };
            throw error;
        } finally {
            unsubscribe();
            sessionMap.endPrompt(acpSessionId);
        }
    });

    app.onNotification(methods.agent.session.cancel, async (context) => {
        const sessionId = context.params?.sessionId;
        if (!sessionId || typeof sessionId !== "string") return;
        const hostedSession = sessionMap.getHostedSession(sessionId, runtime);
        if (!hostedSession) return;
        const hasActivePrompt = sessionMap.hasActivePrompt(sessionId);
        if (hasActivePrompt) {
            const notification = mapRuntimeEventToAcpSessionNotification(sessionId, {
                type: "cancellation",
                sessionId: hostedSession.id,
                timestamp: new Date().toISOString(),
                reason: "session_cancel",
                aborted: true,
            });
            if (notification) await notifyClient(context, methods.client.session.update, notification);
        }
        sessionMap.markCancelled(sessionId);
        try {
            runtime.cancelSession(hostedSession);
        } catch (_error) {
            // ACP cancellation has already been marked and reported; abort failures must not prevent cancelled resolution.
        }
    });

    registerUnimplementedRequest(app, methods.agent.authenticate);
    registerUnimplementedRequest(app, methods.agent.logout);
    registerUnimplementedRequest(app, methods.agent.providers.list);
    registerUnimplementedRequest(app, methods.agent.providers.set);
    registerUnimplementedRequest(app, methods.agent.providers.disable);
    registerUnimplementedRequest(app, methods.agent.session.load);
    registerUnimplementedRequest(app, methods.agent.session.list);
    registerUnimplementedRequest(app, methods.agent.session.delete);
    registerUnimplementedRequest(app, methods.agent.session.fork);
    registerUnimplementedRequest(app, methods.agent.session.resume);
    registerUnimplementedRequest(app, methods.agent.session.close);
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
    const connection = createRunWieldAcpServer(options).connect(stream);
    const diagnostics = options.diagnostic;
    if (diagnostics) diagnostics("RunWield ACP stdio server started");
    return connection;
}
