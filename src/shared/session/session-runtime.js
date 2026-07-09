/**
 * @module shared/session/session-runtime
 * Prompt loop boundary for HostedSession-based interactive turns.
 */

import { AGENTS } from "../../constants.js";
import { createAgentHandler } from "./agent-handler.js";
import { resolveResumeAgentName } from "./active-agent-session.js";
import { abortActiveSession as abortActiveSessionFn, ensureRootAgentSession } from "./session.js";
import { SessionHost } from "./session-host.js";
import { createRootSessionManager, getRootSessionBranchEntries, openPersistedRootSession } from "./root-session.js";
import { createSessionRuntimeEvent, getRuntimeErrorMessage, RuntimeEventTypes } from "./session-runtime-events.js";
import { requestHostedSessionInteraction } from "./session-runtime-interactions.js";
import { isAbsolute } from "@std/path";

export const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeOptions
 * @property {SessionHost} [sessionHost]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession, uiAPI: import('../../ui/tui/types.js').UiAPI | undefined) => Promise<void> | void} [applyPendingRootSwap]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 * @property {(mode: string, cwd: string) => Promise<any>} [createRootSessionManager]
 * @property {(options: import('./root-session.js').ResolvePersistedRootSessionOptions) => Promise<{ sessionManager: any, resolved: import('./root-session.js').ResolvedPersistedRootSession }>} [openPersistedRootSession]
 * @property {(sessionManager: any) => Promise<string>} [resolveResumeAgentName]
 * @property {(agentName: string, deps: any) => Function} [createAgentHandler]
 * @property {(opts: any) => Promise<any>} [ensureRootAgentSession]
 */

/**
 * @typedef {Object} PromptReadySessionOptions
 * @property {string} cwd
 * @property {import('../../ui/tui/types.js').UiAPI} [uiAPI]
 * @property {string} [agentName]
 */

/**
 * @typedef {Object} PromptSessionOptions
 * @property {import('../../ui/tui/types.js').UiAPI} [uiAPI]
 * @property {string} initialRequest
 * @property {import('./types.js').ImageAttachment[]} [initialImages]
 */

/**
 * @typedef {Object} LoadSessionOptions
 * @property {string} cwd
 * @property {string} sessionId
 * @property {string} [sessionPath]
 * @property {import('../../ui/tui/types.js').UiAPI} [uiAPI]
 */

/**
 * @typedef {(event: import('./session-runtime-events.js').SessionRuntimeEvent) => void | Promise<void>} SessionRuntimeEventListener
 */

const MAX_CHAINED_HANDOFFS = 4;

/** @param {unknown} value */
function isHostedSessionLike(value) {
    return value && typeof value === "object" && "id" in value && typeof value.id === "string";
}

/** @param {unknown} value @returns {string} */
function toReplayText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        return value.map((block) => {
            if (!block || typeof block !== "object") return "";
            const typed = /** @type {{ type?: string, text?: string, name?: string }} */ (block);
            if (typed.type === "text") return typed.text || "";
            if (typed.type === "tool_result") return "[tool_result replayed]";
            if (typed.type === "tool_use") return `[tool_use:${typed.name || "unknown"}]`;
            return "";
        }).filter(Boolean).join("\n");
    }
    if (value === undefined || value === null) return "";
    return String(value);
}

/** @param {unknown} timestamp */
function normalizeReplayTimestamp(timestamp) {
    if (typeof timestamp === "string" && timestamp) return timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
    if (timestamp instanceof Date && !Number.isNaN(timestamp.getTime())) return timestamp.toISOString();
    return undefined;
}

/** @param {unknown} entry */
function replayMeta(entry) {
    const value = /** @type {{ id?: string, type?: string, timestamp?: unknown, message?: { role?: string } }} */
        (entry || {});
    const timestamp = normalizeReplayTimestamp(value.timestamp);
    return {
        replay: true,
        ...(value.id ? { entryId: value.id } : {}),
        ...(value.type ? { entryType: value.type } : {}),
        ...(value.message?.role ? { role: value.message.role } : {}),
        ...(timestamp ? { timestamp } : {}),
    };
}

/** @param {unknown} entry @param {string} fallback */
function entryMessageId(entry, fallback) {
    const value = /** @type {{ id?: string }} */ (entry || {});
    return value.id || fallback;
}

/**
 * @param {string} sessionId
 * @param {unknown[]} entries
 * @returns {Array<Record<string, any> & { type: string }>}
 */
function createReplayEvents(sessionId, entries) {
    /** @type {Array<Record<string, any> & { type: string }>} */
    const events = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const value = /** @type {any} */ (entry);
        const meta = replayMeta(value);
        const common = {
            timestamp: normalizeReplayTimestamp(value.timestamp),
            _meta: meta,
        };

        if (value.type === "message") {
            const role = value.message?.role || "unknown";
            const content = value.message?.content;
            const blocks = Array.isArray(content) ? content : [{ type: "text", text: toReplayText(content) }];
            let blockIndex = 0;
            for (const block of blocks) {
                const typed = /** @type {any} */ (block || {});
                const messageId = `${entryMessageId(value, `${sessionId}:replay`)}:${blockIndex++}`;
                if (typed.type === "thinking" || typed.type === "reasoning") {
                    const delta = toReplayText(typed.text || typed.thinking || typed.content || "");
                    if (delta) {
                        events.push({
                            ...common,
                            type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
                            messageId,
                            delta,
                        });
                    }
                    continue;
                }
                if (typed.type === "tool_use") {
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.TOOL_START,
                        messageId,
                        toolCallId: typed.id || messageId,
                        toolName: typed.name || "tool",
                        title: typed.name || "tool",
                    });
                    continue;
                }
                if (typed.type === "tool_result") {
                    const toolCallId = typed.tool_use_id || typed.toolUseId || messageId;
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.TOOL_END,
                        messageId,
                        toolCallId,
                        toolName: "tool",
                        text: "[tool result replayed]",
                        isError: Boolean(typed.is_error || typed.isError),
                    });
                    continue;
                }
                const text = toReplayText(typed.type === "text" ? typed.text : typed);
                if (!text) continue;
                if (role === "user") {
                    events.push({ ...common, type: RuntimeEventTypes.USER_MESSAGE, messageId, text });
                } else if (role === "assistant") {
                    events.push({ ...common, type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA, messageId, delta: text });
                } else {
                    events.push({ ...common, type: RuntimeEventTypes.SYSTEM_STATUS, messageId, message: text });
                }
            }
            if (value.message?.usage) {
                events.push({
                    ...common,
                    type: RuntimeEventTypes.USAGE,
                    messageId: `${entryMessageId(value, `${sessionId}:replay`)}:usage`,
                    raw: value.message.usage,
                });
            }
            continue;
        }

        if (value.type === "compaction" || value.type === "branch_summary") {
            const message = value.summary || `${value.type} replayed`;
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                messageId: entryMessageId(value, value.type),
                message,
            });
            continue;
        }

        if (value.type === "session_info" && value.name) {
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                messageId: entryMessageId(value, value.type),
                message: `Session name: ${value.name}`,
            });
            continue;
        }

        if (value.type === "model_change") {
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                messageId: entryMessageId(value, value.type),
                message: `Model changed: ${[value.provider, value.modelId].filter(Boolean).join("/")}`,
            });
            continue;
        }

        if (value.type === "thinking_level_change") {
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                messageId: entryMessageId(value, value.type),
                message: `Thinking level changed: ${value.thinkingLevel || "unknown"}`,
            });
            continue;
        }

        if (value.type === "custom" && value.customType) {
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                messageId: entryMessageId(value, value.type),
                message: `RunWield session marker: ${value.customType}`,
            });
            continue;
        }

        events.push({
            ...common,
            type: RuntimeEventTypes.SYSTEM_STATUS,
            messageId: entryMessageId(value, value.type || "unknown"),
            message: `Persisted session entry replayed: ${value.type || "unknown"}`,
        });
    }
    return events;
}

export class SessionRuntime {
    /** @param {SessionRuntimeOptions} [options] */
    constructor(options = {}) {
        this.sessionHost = options.sessionHost || new SessionHost();
        this.applyPendingRootSwap = options.applyPendingRootSwap || (() => {});
        this.abortActiveSession = options.abortActiveSession || abortActiveSessionFn;
        this.createRootSessionManager = options.createRootSessionManager || createRootSessionManager;
        this.openPersistedRootSession = options.openPersistedRootSession || openPersistedRootSession;
        this.resolveResumeAgentName = options.resolveResumeAgentName || resolveResumeAgentName;
        this.createAgentHandler = options.createAgentHandler || createAgentHandler;
        this.ensureRootAgentSession = options.ensureRootAgentSession || ensureRootAgentSession;
        /** @type {Map<string, Set<SessionRuntimeEventListener>>} */
        this.eventListeners = new Map();
    }

    /** @param {import('./session-host.js').CreateSessionOptions} options */
    createSession(options = {}) {
        return this.sessionHost.createSession(options);
    }

    /** @param {import('./hosted-session.js').HostedSession} session */
    adoptSession(session) {
        return this.sessionHost.adoptSession(session);
    }

    /** @param {string} id */
    getSession(id) {
        return this.sessionHost.getSession(id);
    }

    listSessions() {
        return this.sessionHost.listSessions();
    }

    /** @param {string} id */
    closeSession(id) {
        const closed = this.sessionHost.disposeSession(id);
        if (closed) {
            this.emitSessionEvent(id, { type: RuntimeEventTypes.SESSION_CLOSED });
            this.eventListeners.delete(id);
        }
        return { ok: true, closed };
    }

    closeAllSessions() {
        const sessions = this.listSessions();
        for (const session of sessions) {
            try {
                const hostedSession = this.getSession(session.id);
                if (hostedSession) this.cancelSession(hostedSession);
            } catch {
                // Shutdown cleanup is best effort.
            }
            this.closeSession(session.id);
        }
        return { ok: true, closed: sessions.length };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {SessionRuntimeEventListener} listener
     * @returns {() => void}
     */
    subscribeSessionEvents(sessionOrId, listener) {
        const sessionId = this.getSessionId(sessionOrId);
        if (!sessionId) return () => {};
        let listeners = this.eventListeners.get(sessionId);
        if (!listeners) {
            listeners = new Set();
            this.eventListeners.set(sessionId, listeners);
        }
        listeners.add(listener);
        return () => {
            const current = this.eventListeners.get(sessionId);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) this.eventListeners.delete(sessionId);
        };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} event
     */
    emitSessionEvent(sessionOrId, event) {
        const sessionId = this.getSessionId(sessionOrId);
        if (!sessionId) return;
        const runtimeEvent = createSessionRuntimeEvent(sessionId, event);
        const listeners = this.eventListeners.get(sessionId);
        if (!listeners) return;
        for (const listener of Array.from(listeners)) {
            try {
                const result = listener(runtimeEvent);
                if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
                    result.catch(() => {});
                }
            } catch {
                // Event subscribers are adapter concerns; a bad adapter listener must not
                // crash an in-flight RunWield prompt.
            }
        }
    }

    /** @param {string | import('./hosted-session.js').HostedSession} sessionOrId */
    getSessionId(sessionOrId) {
        if (typeof sessionOrId === "string") return sessionOrId;
        if (isHostedSessionLike(sessionOrId)) return sessionOrId.id;
        return "";
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     */
    attachRuntimeEventSink(hostedSession) {
        hostedSession.setEventSink({
            emit: (
                /** @type {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} */ event,
            ) => {
                this.emitSessionEvent(hostedSession, event);
            },
        });
    }

    /**
     * @param {PromptReadySessionOptions} options
     * @returns {Promise<import('./hosted-session.js').HostedSession>}
     */
    async createPromptReadySession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.createPromptReadySession requires an absolute cwd");
        }
        const agentName = options.agentName || AGENTS.ROUTER;
        const sessionManager = await this.createRootSessionManager("new", options.cwd);
        const hostedSession = this.createSession({
            sessionManager,
            cwd: options.cwd,
            uiAPI: options.uiAPI,
        });
        this.attachRuntimeEventSink(hostedSession);
        hostedSession.setActiveOnMessage(this.createAgentHandler(agentName, { hostedSession }));
        await this.ensureRootAgentSession({ hostedSession, agentName, uiAPI: options.uiAPI, sessionManager });
        this.emitSessionEvent(hostedSession, {
            type: RuntimeEventTypes.SESSION_CREATED,
            cwd: hostedSession.cwd,
        });
        return hostedSession;
    }

    /**
     * @param {LoadSessionOptions} options
     * @returns {Promise<{ hostedSession: import('./hosted-session.js').HostedSession, replayEvents: import('./session-runtime-events.js').SessionRuntimeEvent[], sessionManagerId: string, sessionPath: string }>}
     */
    async loadSession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.loadSession requires an absolute cwd");
        }
        if (!options.sessionId || typeof options.sessionId !== "string") {
            throw new Error("SessionRuntime.loadSession requires a session id");
        }
        const { sessionManager, resolved } = await this.openPersistedRootSession({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath: options.sessionPath,
        });
        const agentName = await this.resolveResumeAgentName(sessionManager);
        const hostedSession = this.createSession({
            sessionManager,
            cwd: options.cwd,
            uiAPI: options.uiAPI,
        });
        this.attachRuntimeEventSink(hostedSession);
        hostedSession.setActiveOnMessage(this.createAgentHandler(agentName, { hostedSession }));
        await this.ensureRootAgentSession({ hostedSession, agentName, uiAPI: options.uiAPI, sessionManager });
        const replayEvents = createReplayEvents(hostedSession.id, getRootSessionBranchEntries(sessionManager))
            .map((event) => createSessionRuntimeEvent(hostedSession.id, /** @type {any} */ (event)));
        this.emitSessionEvent(hostedSession, {
            type: RuntimeEventTypes.SESSION_LOADED,
            cwd: hostedSession.cwd,
            _meta: { sessionManagerId: resolved.sessionId, sessionPath: resolved.sessionPath },
        });
        return {
            hostedSession,
            replayEvents,
            sessionManagerId: resolved.sessionId,
            sessionPath: resolved.sessionPath,
        };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionAdapter | null} adapter
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionAdapterMeta | null} [meta]
     */
    setInteractionAdapter(sessionOrId, adapter, meta = null) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, error: "not_found" };
        session.setInteractionAdapter(adapter, meta);
        return { ok: true };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionRequest} request
     * @param {AbortSignal} [signal]
     */
    async requestInteraction(sessionOrId, request, signal) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { outcome: "unsupported", message: "Session not found." };
        const interactionId = request.id || crypto.randomUUID();
        this.emitSessionEvent(session, {
            type: RuntimeEventTypes.INTERACTION_REQUESTED,
            interactionId,
            interactionType: request.type,
        });
        const response = await requestHostedSessionInteraction(session, { ...request, id: interactionId }, signal);
        this.emitSessionEvent(session, {
            type: response.outcome === "canceled"
                ? RuntimeEventTypes.INTERACTION_CANCELED
                : RuntimeEventTypes.INTERACTION_RESOLVED,
            interactionId,
            interactionType: request.type,
            outcome: response.outcome,
            message: response.message,
        });
        return response;
    }

    /** @param {string | import('./hosted-session.js').HostedSession} sessionOrId */
    cancelSession(sessionOrId) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, aborted: false, error: "not_found" };
        let aborted = false;
        try {
            session.cancelActiveInteractions?.();
            aborted = this.abortActiveSession(session);
        } finally {
            this.emitSessionEvent(session, {
                type: RuntimeEventTypes.CANCELLATION,
                aborted,
                reason: "session_cancel",
            });
        }
        return { ok: true, aborted };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {PromptSessionOptions} options
     * @returns {Promise<{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string }>}
     */
    async promptSession(hostedSession, options) {
        const uiAPI = options.uiAPI;
        const turnId = crypto.randomUUID();
        let request = options.initialRequest;
        let images = options.initialImages || [];
        let turns = 0;
        let handoffs = 0;
        let ok = false;
        let result =
            /** @type {{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string } | null} */ (null);

        hostedSession.setActiveUiAPI(uiAPI || null);
        this.emitSessionEvent(hostedSession, { type: RuntimeEventTypes.USER_MESSAGE, turnId, text: request });
        this.emitSessionEvent(hostedSession, { type: RuntimeEventTypes.TURN_START, turnId });

        try {
            if (!hostedSession.getActiveOnMessage() || !hostedSession.getRootSessionManager()) {
                const message = "Error: No active agent handler or session manager.";
                uiAPI?.appendSystemMessage?.(message);
                this.emitSessionEvent(hostedSession, {
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    turnId,
                    level: "error",
                    message,
                });
                this.emitSessionEvent(hostedSession, {
                    type: RuntimeEventTypes.TERMINAL_ERROR,
                    turnId,
                    message,
                    error: "missing_active_handler_or_session_manager",
                });
                result = {
                    ok: false,
                    turns,
                    handoffs,
                    handoffLimitReached: false,
                    error: "missing_active_handler_or_session_manager",
                };
                return result;
            }

            for (let turn = 0; turn <= MAX_CHAINED_HANDOFFS; turn++) {
                await this.applyPendingRootSwap(hostedSession, uiAPI);

                const handler = hostedSession.getActiveOnMessage();
                if (!handler) {
                    const message = "Error: No active agent handler or session manager.";
                    uiAPI?.appendSystemMessage?.(message);
                    this.emitSessionEvent(hostedSession, {
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        turnId,
                        level: "error",
                        message,
                    });
                    result = {
                        ok: false,
                        turns,
                        handoffs,
                        handoffLimitReached: false,
                        error: "missing_active_handler_or_session_manager",
                    };
                    return result;
                }

                await handler(request, images, uiAPI, hostedSession.getRootSessionManager() || undefined);
                turns++;

                const handoff = hostedSession.consumePendingSwitchHandoff();
                if (!handoff) {
                    await this.applyPendingRootSwap(hostedSession, uiAPI);
                    ok = true;
                    result = { ok: true, turns, handoffs, handoffLimitReached: false };
                    return result;
                }

                if (turn === MAX_CHAINED_HANDOFFS) {
                    uiAPI?.appendSystemMessage?.(HANDOFF_LIMIT_MESSAGE);
                    this.emitSessionEvent(hostedSession, {
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        turnId,
                        level: "warning",
                        message: HANDOFF_LIMIT_MESSAGE,
                    });
                    ok = true;
                    result = { ok: true, turns, handoffs, handoffLimitReached: true };
                    return result;
                }

                handoffs++;
                request = handoff.reason;
                images = [];
            }

            ok = true;
            result = { ok: true, turns, handoffs, handoffLimitReached: false };
            return result;
        } catch (error) {
            this.emitSessionEvent(hostedSession, {
                type: RuntimeEventTypes.TERMINAL_ERROR,
                turnId,
                message: getRuntimeErrorMessage(error),
                error,
            });
            throw error;
        } finally {
            this.emitSessionEvent(hostedSession, {
                type: RuntimeEventTypes.TURN_END,
                turnId,
                ok,
                result: result || { turns, handoffs },
            });
        }
    }
}
