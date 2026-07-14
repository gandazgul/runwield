/**
 * @module shared/session/session-runtime
 * Prompt loop boundary for HostedSession-based interactive turns.
 */

import { AGENTS } from "../../constants.js";
import { createAgentHandler } from "./agent-handler.js";
import { resolveResumeAgentName } from "./active-agent-session.js";
import { switchActiveAgent } from "./agent-switching.js";
import {
    abortActiveSession as abortActiveSessionFn,
    ensureRootAgentSession,
    steerRootSessionWithTarget,
} from "./session.js";
import { SessionHost } from "./session-host.js";
import { createRootSessionManager, getRootSessionBranchEntries, openPersistedRootSession } from "./root-session.js";
import { createSessionRuntimeEvent, getRuntimeErrorMessage, RuntimeEventTypes } from "./session-runtime-events.js";
import { requestHostedSessionInteraction } from "./session-runtime-interactions.js";
import { createRuntimeSessionUi } from "./session-runtime-ui.js";
import { isAbsolute } from "@std/path";

export const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeOptions
 * @property {SessionHost} [sessionHost]
 * @property {typeof switchActiveAgent} [switchActiveAgent]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 * @property {(mode: string, cwd: string) => Promise<any>} [createRootSessionManager]
 * @property {(options: import('./root-session.js').ResolvePersistedRootSessionOptions) => Promise<{ sessionManager: any, resolved: import('./root-session.js').ResolvedPersistedRootSession }>} [openPersistedRootSession]
 * @property {(sessionManager: any) => Promise<string>} [resolveResumeAgentName]
 * @property {(agentName: string, deps: any) => import('./types.js').AgentMessageHandler} [createAgentHandler]
 * @property {(opts: any) => Promise<any>} [ensureRootAgentSession]
 * @property {typeof steerRootSessionWithTarget} [steerRootSessionWithTarget]
 */

/**
 * @typedef {Object} PromptReadySessionOptions
 * @property {string} cwd
 * @property {string} [agentName]
 */

/**
 * @typedef {Object} PromptTurnContext
 * @property {string} turnId
 */

/**
 * @typedef {Object} PromptSessionOptions
 * @property {string} initialRequest
 * @property {import('./types.js').ImageAttachment[]} [initialImages]
 * @property {(context: PromptTurnContext) => void | (() => void)} [onTurnStarted]
 */

/**
 * @typedef {Object} LoadSessionOptions
 * @property {string} cwd
 * @property {string} sessionId
 * @property {string} [sessionPath]
 * @property {string} [modelOverride]
 */

/**
 * @typedef {(event: import('./session-runtime-events.js').SessionRuntimeEvent) => void | Promise<void>} SessionRuntimeEventListener
 */

/**
 * @typedef {Object} SteerSessionResult
 * @property {boolean} ok
 * @property {boolean} queued
 * @property {import('./session-runtime-events.js').RuntimeQueuedMessage} [message]
 * @property {string} [reason]
 * @property {string} [error]
 */

/**
 * @typedef {Object} DequeueQueuedMessageResult
 * @property {boolean} ok
 * @property {import('./session-runtime-events.js').RuntimeQueuedMessage | null} message
 * @property {string} [warning]
 * @property {string} [error]
 */

/**
 * @typedef {Object} RuntimeQueuedMessageState
 * @property {string} id
 * @property {string} text
 * @property {import('./types.js').ImageAttachment[]} images
 * @property {"steer" | "next_turn"} delivery
 * @property {string} queuedAt
 * @property {import('@earendil-works/pi-coding-agent').AgentSession} [sourceSession]
 */

/**
 * @typedef {Object} QueueSourceSubscription
 * @property {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
 * @property {() => void} unsubscribe
 */

const MAX_CHAINED_HANDOFFS = 4;

export class SessionTurnInProgressError extends Error {
    /** @param {string} sessionId */
    constructor(sessionId) {
        super(`HostedSession "${sessionId}" already has an active turn`);
        this.name = "SessionTurnInProgressError";
        this.sessionId = sessionId;
    }
}

/** @param {unknown} value */
function isHostedSessionLike(value) {
    return value && typeof value === "object" && "id" in value && typeof value.id === "string";
}

/**
 * @param {RuntimeQueuedMessageState} message
 * @returns {import('./session-runtime-events.js').RuntimeQueuedMessage}
 */
function toRuntimeQueuedMessage(message) {
    return {
        id: message.id,
        text: message.text,
        images: message.images.map((image) => ({ ...image })),
        delivery: message.delivery,
        queuedAt: message.queuedAt,
    };
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
        this.switchActiveAgent = options.switchActiveAgent || switchActiveAgent;
        this.abortActiveSession = options.abortActiveSession || abortActiveSessionFn;
        this.createRootSessionManager = options.createRootSessionManager || createRootSessionManager;
        this.openPersistedRootSession = options.openPersistedRootSession || openPersistedRootSession;
        this.resolveResumeAgentName = options.resolveResumeAgentName || resolveResumeAgentName;
        this.createAgentHandler = options.createAgentHandler || createAgentHandler;
        this.ensureRootAgentSession = options.ensureRootAgentSession || ensureRootAgentSession;
        this.steerRootSessionWithTarget = options.steerRootSessionWithTarget || steerRootSessionWithTarget;
        /** @type {Map<string, Set<SessionRuntimeEventListener>>} */
        this.eventListeners = new Map();
        /** @type {Map<string, import('../types.js').SessionUiPort>} */
        this.sessionUiPorts = new Map();
        /** @type {Map<string, Promise<void>>} */
        this.turnSettlements = new Map();
        /** @type {Map<string, RuntimeQueuedMessageState[]>} */
        this.queuedMessages = new Map();
        /** @type {Map<string, QueueSourceSubscription>} */
        this.queueSourceSubscriptions = new Map();
    }

    /** @param {import('./session-host.js').CreateSessionOptions} [options] */
    createSession(options = {}) {
        const sessionManagerCwd = typeof options?.sessionManager?.getCwd === "function"
            ? options.sessionManager.getCwd()
            : null;
        const projectRoot = sessionManagerCwd || options?.cwd;
        if (!projectRoot || !isAbsolute(projectRoot)) {
            throw new Error("SessionRuntime.createSession requires an absolute project root");
        }
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

    /** @param {import('./hosted-session.js').HostedSession} hostedSession */
    getSessionUiPort(hostedSession) {
        let uiPort = this.sessionUiPorts.get(hostedSession.id);
        if (!uiPort) {
            uiPort = createRuntimeSessionUi({ runtime: this, hostedSession });
            this.sessionUiPorts.set(hostedSession.id, uiPort);
        }
        return uiPort;
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @returns {import('../types.js').SessionSnapshot | null}
     */
    getSessionSnapshot(sessionOrId) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return null;
        const sessionManager = session.getRootSessionManager();
        const rawSessionManagerId = sessionManager?.getSessionId?.();
        const sessionManagerId = typeof rawSessionManagerId === "string" && rawSessionManagerId
            ? rawSessionManagerId
            : null;
        const workflow = session.getActiveExecutionWorkflow();
        const interactionMeta = session.getInteractionAdapterMeta();
        return {
            id: session.id,
            cwd: session.cwd,
            sessionManagerId,
            name: sessionManager?.getSessionName?.() || null,
            disposed: session.disposed,
            activeAgent: session.getRootAgentName(),
            activeModel: session.getActiveModelState(),
            thinkingLevel: session.getThinkingLevel(),
            busy: session.isTurnActive(),
            activeTurnId: session.getActiveTurnId(),
            queuedMessages: this.getQueuedMessages(session),
            workflow: workflow ? { ...workflow } : null,
            interactionAdapter: interactionMeta
                ? { kind: interactionMeta.kind, capabilities: { ...(interactionMeta.capabilities || {}) } }
                : null,
        };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @returns {import('./session-runtime-events.js').RuntimeQueuedMessage[]}
     */
    getQueuedMessages(sessionOrId) {
        const sessionId = this.getSessionId(sessionOrId);
        if (!sessionId) return [];
        return (this.queuedMessages.get(sessionId) || []).map(toRuntimeQueuedMessage);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     */
    ensureQueueSourceSubscription(hostedSession, sourceSession) {
        const current = this.queueSourceSubscriptions.get(hostedSession.id);
        if (current?.sourceSession === sourceSession) return;
        current?.unsubscribe();
        const unsubscribe = sourceSession.subscribe((event) => {
            if (event.type !== "queue_update") return;
            this.reconcileQueuedMessages(hostedSession, sourceSession, event.steering);
        });
        this.queueSourceSubscriptions.set(hostedSession.id, { sourceSession, unsubscribe });
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     * @param {readonly string[] | undefined} steering
     */
    reconcileQueuedMessages(hostedSession, sourceSession, steering) {
        const sourceMessages = (this.queuedMessages.get(hostedSession.id) || [])
            .filter((message) => message.sourceSession === sourceSession);
        const consumedCount = Math.max(0, sourceMessages.length - (steering?.length || 0));
        for (const message of sourceMessages.slice(0, consumedCount)) {
            this.transitionQueuedMessage(hostedSession, message, "consumed");
        }
        const sourceStillQueued = (this.queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (!sourceStillQueued) this.removeQueueSourceSubscription(hostedSession.id, sourceSession);
    }

    /**
     * @param {string} sessionId
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     */
    removeQueueSourceSubscription(sessionId, sourceSession) {
        const subscription = this.queueSourceSubscriptions.get(sessionId);
        if (subscription?.sourceSession !== sourceSession) return;
        subscription.unsubscribe();
        this.queueSourceSubscriptions.delete(sessionId);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {RuntimeQueuedMessageState} message
     * @param {"consumed" | "dequeued"} status
     * @param {string} [reason]
     */
    transitionQueuedMessage(hostedSession, message, status, reason) {
        const queue = this.queuedMessages.get(hostedSession.id);
        const index = queue?.indexOf(message) ?? -1;
        if (!queue || index < 0) return null;
        queue.splice(index, 1);
        if (queue.length === 0) this.queuedMessages.delete(hostedSession.id);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.emitSessionEvent(hostedSession, {
            type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
            status,
            message: publicMessage,
            ...(reason ? { reason } : {}),
        });
        if (status === "consumed" && message.delivery === "steer") {
            this.emitSessionEvent(hostedSession, {
                type: RuntimeEventTypes.USER_MESSAGE,
                messageId: message.id,
                text: message.text,
                images: message.images.map((image) => ({ ...image })),
            });
        }
        return publicMessage;
    }

    /**
     * Queue a steering message in the active root AgentSession and publish the
     * resulting core state. Adapters should render QUEUED_MESSAGE_CHANGED rather
     * than subscribing to AgentSession directly.
     *
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {string} text
     * @param {import('./types.js').ImageAttachment[]} [images]
     * @returns {Promise<SteerSessionResult>}
     */
    async steerSession(sessionOrId, text, images = []) {
        const hostedSession = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const rootSession = /** @type {any} */ (hostedSession.getRootAgentSession());
        if (!rootSession?.isStreaming) return { ok: true, queued: false, reason: "not_streaming" };

        this.ensureQueueSourceSubscription(hostedSession, rootSession);
        const sourceSession = await this.steerRootSessionWithTarget(hostedSession, text, images);
        if (!sourceSession) {
            this.removeQueueSourceSubscription(hostedSession.id, rootSession);
            return { ok: true, queued: false, reason: "not_streaming" };
        }

        const message = /** @type {RuntimeQueuedMessageState} */ ({
            id: crypto.randomUUID(),
            text,
            images: images.map((image) => ({ ...image })),
            delivery: "steer",
            queuedAt: new Date().toISOString(),
            sourceSession,
        });
        this.ensureQueueSourceSubscription(hostedSession, sourceSession);
        const publicMessage = this.trackQueuedMessage(hostedSession, message);
        const activeSteering = sourceSession.getSteeringMessages?.();
        if (Array.isArray(activeSteering)) {
            this.reconcileQueuedMessages(hostedSession, sourceSession, activeSteering);
        }
        return { ok: true, queued: true, message: publicMessage };
    }

    /**
     * Queue a message for a later prompt when it could not be accepted as live
     * steering. This state is core-owned so every UI sees the same queue.
     *
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {string} text
     * @param {import('./types.js').ImageAttachment[]} [images]
     * @returns {SteerSessionResult}
     */
    queueNextTurnMessage(sessionOrId, text, images = []) {
        const hostedSession = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const message = /** @type {RuntimeQueuedMessageState} */ ({
            id: crypto.randomUUID(),
            text,
            images: images.map((image) => ({ ...image })),
            delivery: "next_turn",
            queuedAt: new Date().toISOString(),
        });
        return { ok: true, queued: true, message: this.trackQueuedMessage(hostedSession, message) };
    }

    /**
     * Claim the oldest deferred message for execution. Removing it emits the
     * same consumed transition as a steering message; promptSession publishes
     * its USER_MESSAGE event when execution begins.
     *
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @returns {DequeueQueuedMessageResult}
     */
    takeNextTurnMessage(sessionOrId) {
        const hostedSession = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const selected = (this.queuedMessages.get(hostedSession.id) || [])
            .find((message) => message.delivery === "next_turn");
        if (!selected) return { ok: true, message: null };
        const publicMessage = this.transitionQueuedMessage(hostedSession, selected, "consumed");
        return { ok: true, message: publicMessage };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {RuntimeQueuedMessageState} message
     */
    trackQueuedMessage(hostedSession, message) {
        let queue = this.queuedMessages.get(hostedSession.id);
        if (!queue) {
            queue = [];
            this.queuedMessages.set(hostedSession.id, queue);
        }
        queue.push(message);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.emitSessionEvent(hostedSession, {
            type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
            status: "queued",
            message: publicMessage,
        });
        return publicMessage;
    }

    /**
     * Dequeue the latest core-owned message. Deferred messages are removed
     * directly. AgentSession exposes only whole-queue clearing for live
     * steering, so earlier steering and follow-up messages are immediately
     * restored while queue reconciliation is suspended.
     *
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @returns {Promise<DequeueQueuedMessageResult>}
     */
    async dequeueLastQueuedMessage(sessionOrId) {
        const hostedSession = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const queue = this.queuedMessages.get(hostedSession.id) || [];
        const selected = queue.at(-1);
        if (!selected) return { ok: true, message: null };

        if (selected.delivery === "next_turn") {
            const publicMessage = this.transitionQueuedMessage(
                hostedSession,
                selected,
                "dequeued",
                "user_recall",
            );
            return { ok: true, message: publicMessage };
        }

        const sourceSession = selected.sourceSession;
        if (!sourceSession) return { ok: false, message: null, error: "queue_not_mutable" };
        if (typeof sourceSession.clearQueue !== "function") {
            return { ok: false, message: null, error: "queue_not_mutable" };
        }
        const sourceMessages = queue.filter((message) => message.sourceSession === sourceSession);
        this.removeQueueSourceSubscription(hostedSession.id, sourceSession);
        /** @type {{ steering: string[], followUp: string[] }} */
        let cleared;
        try {
            cleared = sourceSession.clearQueue();
        } catch (error) {
            this.ensureQueueSourceSubscription(hostedSession, sourceSession);
            return {
                ok: false,
                message: null,
                error: getRuntimeErrorMessage(error),
            };
        }

        let requeueError = "";
        try {
            for (const message of sourceMessages) {
                if (message.id === selected.id) continue;
                const requeued = await this.steerRootSessionWithTarget(hostedSession, message.text, message.images);
                if (!requeued) throw new Error("root session stopped streaming while restoring its queue");
            }
            for (const followUp of cleared.followUp || []) await sourceSession.followUp(followUp);
        } catch (error) {
            requeueError = getRuntimeErrorMessage(error);
        }

        const publicMessage = toRuntimeQueuedMessage(selected);
        if (requeueError) {
            for (const message of sourceMessages) {
                this.transitionQueuedMessage(
                    hostedSession,
                    message,
                    "dequeued",
                    message.id === selected.id ? "user_recall" : "requeue_failed",
                );
            }
            return { ok: true, message: publicMessage, warning: requeueError };
        }

        this.transitionQueuedMessage(hostedSession, selected, "dequeued", "user_recall");
        const sourceStillQueued = (this.queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (sourceStillQueued) this.ensureQueueSourceSubscription(hostedSession, sourceSession);
        return { ok: true, message: publicMessage };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {string} [reason]
     */
    clearQueuedMessages(sessionOrId, reason = "cleared") {
        const hostedSession = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!hostedSession) return { ok: false, cleared: 0, error: "not_found" };
        const messages = [...(this.queuedMessages.get(hostedSession.id) || [])];
        const sources = new Set(messages.map((message) => message.sourceSession).filter(Boolean));
        const clearedSources = new Set();
        for (const sourceSession of sources) {
            if (!sourceSession || typeof sourceSession.clearQueue !== "function") continue;
            this.removeQueueSourceSubscription(hostedSession.id, sourceSession);
            try {
                sourceSession.clearQueue();
                clearedSources.add(sourceSession);
            } catch {
                this.ensureQueueSourceSubscription(hostedSession, sourceSession);
            }
        }
        const clearedMessages = messages.filter((message) =>
            message.delivery === "next_turn" ||
            (message.sourceSession && clearedSources.has(message.sourceSession))
        );
        for (const message of clearedMessages) {
            this.transitionQueuedMessage(hostedSession, message, "dequeued", reason);
        }
        return { ok: true, cleared: clearedMessages.length };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {string} name
     */
    renameSession(sessionOrId, name) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, error: "not_found" };
        const normalizedName = String(name || "").trim();
        if (!normalizedName) return { ok: false, error: "invalid_name" };
        session.getRootSessionManager()?.appendSessionInfo?.(normalizedName);
        this.emitSessionEvent(session, { type: RuntimeEventTypes.SESSION_RENAMED, name: normalizedName });
        return { ok: true, name: normalizedName };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {string} model
     * @param {string} [provider]
     * @param {boolean} [userOverride]
     */
    setSessionModel(sessionOrId, model, provider = "", userOverride = true) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, error: "not_found" };
        session.setActiveModelState(model, provider, userOverride);
        this.emitSessionEvent(session, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
        return { ok: true, model, provider };
    }

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {import('./hosted-session.js').ThinkingLevel} thinkingLevel
     */
    setSessionThinkingLevel(sessionOrId, thinkingLevel) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, error: "not_found" };
        session.setThinkingLevel(thinkingLevel);
        this.emitSessionEvent(session, { type: RuntimeEventTypes.THINKING_LEVEL_CHANGED, thinkingLevel });
        return { ok: true, thinkingLevel };
    }

    /** @param {string} id */
    closeSession(id) {
        const hostedSession = this.sessionHost.getSession(id);
        if (hostedSession) this.clearQueuedMessages(hostedSession, "session_closed");
        const closed = this.sessionHost.disposeSession(id);
        if (closed) {
            this.emitSessionEvent(id, { type: RuntimeEventTypes.SESSION_CLOSED });
            this.eventListeners.delete(id);
            this.sessionUiPorts.delete(id);
            const queueSubscription = this.queueSourceSubscriptions.get(id);
            queueSubscription?.unsubscribe();
            this.queueSourceSubscriptions.delete(id);
            this.queuedMessages.delete(id);
        }
        return { ok: true, closed };
    }

    /**
     * Cancel an active turn, wait for the underlying Agent Session prompt to
     * settle, then dispose the Hosted Session.
     *
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     */
    async closeSessionWhenIdle(sessionOrId) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: true, closed: false };
        if (session.isTurnActive()) {
            this.cancelSession(session);
            await this.turnSettlements.get(session.id);
        }
        return this.closeSession(session.id);
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

    async closeAllSessionsWhenIdle() {
        const sessions = this.listSessions();
        await Promise.all(sessions.map((session) => this.closeSessionWhenIdle(session.id)));
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
            id: crypto.randomUUID(),
            sessionManager,
            cwd: options.cwd,
        });
        const runtimeUiAPI = this.getSessionUiPort(hostedSession);
        this.attachRuntimeEventSink(hostedSession);
        try {
            hostedSession.setActiveOnMessage(this.createAgentHandler(agentName, { hostedSession }));
            await this.ensureRootAgentSession({ hostedSession, agentName, uiAPI: runtimeUiAPI, sessionManager });
            this.emitSessionEvent(hostedSession, {
                type: RuntimeEventTypes.SESSION_CREATED,
                cwd: hostedSession.cwd,
            });
            return hostedSession;
        } catch (error) {
            this.closeSession(hostedSession.id);
            throw error;
        }
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
            id: crypto.randomUUID(),
            sessionManager,
            cwd: options.cwd,
        });
        const runtimeUiAPI = this.getSessionUiPort(hostedSession);
        this.attachRuntimeEventSink(hostedSession);
        try {
            hostedSession.setActiveOnMessage(this.createAgentHandler(agentName, { hostedSession }));
            await this.ensureRootAgentSession({
                hostedSession,
                agentName,
                modelOverride: options.modelOverride,
                uiAPI: runtimeUiAPI,
                sessionManager,
            });
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
        } catch (error) {
            this.closeSession(hostedSession.id);
            throw error;
        }
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

    /**
     * @param {string | import('./hosted-session.js').HostedSession} sessionOrId
     * @param {{ agentName: string, model?: string, allowReturnToRouter?: boolean }} options
     */
    async switchAgent(sessionOrId, options) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, error: "not_found" };
        if (session.isTurnActive()) throw new SessionTurnInProgressError(session.id);
        const uiAPI = this.getSessionUiPort(session);
        return await this.switchActiveAgent(session, options, uiAPI, {
            ensureRootAgentSession: this.ensureRootAgentSession,
            createAgentHandler: /** @type {typeof createAgentHandler} */ (this.createAgentHandler),
        });
    }

    /** @param {string | import('./hosted-session.js').HostedSession} sessionOrId */
    cancelSession(sessionOrId) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, aborted: false, error: "not_found" };
        let aborted = false;
        try {
            session.cancelActiveInteractions?.();
            this.clearQueuedMessages(session, "session_cancel");
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
        const uiAPI = this.getSessionUiPort(hostedSession);
        const turnId = crypto.randomUUID();
        if (!hostedSession.beginTurn(turnId)) throw new SessionTurnInProgressError(hostedSession.id);
        /** @type {() => void} */
        let cleanupTurn = () => {};
        /** @type {() => void} */
        let settleTurn = () => {};
        const turnSettlement = new Promise((resolve) => {
            settleTurn = () => resolve(undefined);
        });
        this.turnSettlements.set(hostedSession.id, turnSettlement);
        let request = options.initialRequest;
        let images = options.initialImages || [];
        let turns = 0;
        let handoffs = 0;
        let ok = false;
        let result =
            /** @type {{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string } | null} */ (null);

        try {
            const cleanup = options.onTurnStarted?.({ turnId });
            if (typeof cleanup === "function") cleanupTurn = cleanup;
            hostedSession.setActiveUiAPI(uiAPI || null);
            this.emitSessionEvent(hostedSession, {
                type: RuntimeEventTypes.USER_MESSAGE,
                turnId,
                text: request,
                images: images.map((image) => ({ ...image })),
            });
            this.emitSessionEvent(hostedSession, { type: RuntimeEventTypes.TURN_START, turnId });
            this.emitSessionEvent(hostedSession, { type: RuntimeEventTypes.BUSY_CHANGED, turnId, busy: true });

            if (!hostedSession.getActiveOnMessage() || !hostedSession.getRootSessionManager()) {
                const message = "Error: No active agent handler or session manager.";
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
                const handler = hostedSession.getActiveOnMessage();
                if (!handler) {
                    const message = "Error: No active agent handler or session manager.";
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

                const turnResult = await handler(
                    request,
                    images,
                    uiAPI,
                    hostedSession.getRootSessionManager() || undefined,
                );
                turns++;

                if (!turnResult || turnResult.kind !== "handoff") {
                    ok = true;
                    result = { ok: true, turns, handoffs, handoffLimitReached: false };
                    return result;
                }

                if (turn === MAX_CHAINED_HANDOFFS) {
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
                await this.switchActiveAgent(
                    hostedSession,
                    {
                        agentName: turnResult.agentName,
                        model: turnResult.model,
                    },
                    uiAPI,
                    {
                        ensureRootAgentSession: this.ensureRootAgentSession,
                        createAgentHandler: /** @type {typeof createAgentHandler} */ (this.createAgentHandler),
                    },
                );
                request = turnResult.userRequest;
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
            hostedSession.endTurn(turnId);
            this.emitSessionEvent(hostedSession, { type: RuntimeEventTypes.BUSY_CHANGED, turnId, busy: false });
            try {
                cleanupTurn();
            } catch {
                // Adapter cleanup must not prevent runtime turn settlement.
            }
            settleTurn();
            if (this.turnSettlements.get(hostedSession.id) === turnSettlement) {
                this.turnSettlements.delete(hostedSession.id);
            }
        }
    }
}
