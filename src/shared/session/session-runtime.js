/**
 * @module shared/session/session-runtime
 * Prompt loop boundary for HostedSession-based interactive turns.
 */

import { AGENTS } from "../../constants.js";
import { createAgentHandler } from "./agent-handler.js";
import { abortActiveSession as abortActiveSessionFn, ensureRootAgentSession } from "./session.js";
import { SessionHost } from "./session-host.js";
import { createRootSessionManager } from "./root-session.js";
import { createSessionRuntimeEvent, getRuntimeErrorMessage, RuntimeEventTypes } from "./session-runtime-events.js";
import { isAbsolute } from "@std/path";

export const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeOptions
 * @property {SessionHost} [sessionHost]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession, uiAPI: import('../../ui/tui/types.js').UiAPI | undefined) => Promise<void> | void} [applyPendingRootSwap]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 * @property {(mode: string, cwd: string) => Promise<any>} [createRootSessionManager]
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
 * @typedef {(event: import('./session-runtime-events.js').SessionRuntimeEvent) => void | Promise<void>} SessionRuntimeEventListener
 */

const MAX_CHAINED_HANDOFFS = 4;

/** @param {unknown} value */
function isHostedSessionLike(value) {
    return value && typeof value === "object" && "id" in value && typeof value.id === "string";
}

export class SessionRuntime {
    /** @param {SessionRuntimeOptions} [options] */
    constructor(options = {}) {
        this.sessionHost = options.sessionHost || new SessionHost();
        this.applyPendingRootSwap = options.applyPendingRootSwap || (() => {});
        this.abortActiveSession = options.abortActiveSession || abortActiveSessionFn;
        this.createRootSessionManager = options.createRootSessionManager || createRootSessionManager;
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

    /** @param {string | import('./hosted-session.js').HostedSession} sessionOrId */
    cancelSession(sessionOrId) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, aborted: false, error: "not_found" };
        let aborted = false;
        try {
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
