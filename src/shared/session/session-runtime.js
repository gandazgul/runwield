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
    expandPromptTemplate,
    expandSkillCommand,
    listLoadedAgentMdFiles,
    listPromptTemplates,
    listSkills,
    reloadRootAgentSession,
    runAgentSession,
    steerRootSessionWithTarget,
} from "./session.js";
import { SessionHost } from "./session-host.js";
import {
    createRootSessionManager,
    exportRootSessionToHtml,
    exportRootSessionToJsonl,
    getRootSessionBranchEntries,
    getRunWieldSessionMemoryBackupDir,
    listPersistedRootSessions,
    openPersistedRootSession,
} from "./root-session.js";
import { createSessionRuntimeEvent, getRuntimeErrorMessage, RuntimeEventTypes } from "./session-runtime-events.js";
import { requestHostedSessionInteraction } from "./session-runtime-interactions.js";
import {
    modelSupportsImageInput,
    persistImageAttachment,
    preflightImageAttachments,
    resolveVisionFallbackModel,
} from "./image-attachments.js";
import { getModelRegistry } from "../models/model-registry.js";
import { isAbsolute } from "@std/path";

export const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeOptions
 * @property {SessionHost} [sessionHost]
 * @property {typeof switchActiveAgent} [switchActiveAgent]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 * @property {(mode: import('./root-session.js').RootSessionStartMode, cwd: string) => Promise<any>} [createRootSessionManager]
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
        super(`Session "${sessionId}" already has an active turn`);
        this.name = "SessionTurnInProgressError";
        this.sessionId = sessionId;
    }
}

/** @param {unknown} value */
/** @param {any} usage */
function normalizeRuntimeUsage(usage) {
    return {
        input: Number(usage?.input ?? usage?.inputTokens ?? 0) || 0,
        output: Number(usage?.output ?? usage?.outputTokens ?? 0) || 0,
        cacheRead: Number(usage?.cacheRead ?? usage?.cacheReadTokens ?? 0) || 0,
        cacheWrite: Number(usage?.cacheWrite ?? usage?.cacheWriteTokens ?? 0) || 0,
    };
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
    /** @type {SessionHost} */
    #sessionHost;
    /** @type {typeof switchActiveAgent} */
    #switchActiveAgent;
    /** @type {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} */
    #abortActiveSession;
    /** @type {(mode: import('./root-session.js').RootSessionStartMode, cwd: string) => Promise<any>} */
    #createRootSessionManager;
    /** @type {(options: import('./root-session.js').ResolvePersistedRootSessionOptions) => Promise<{ sessionManager: any, resolved: import('./root-session.js').ResolvedPersistedRootSession }>} */
    #openPersistedRootSession;
    /** @type {(sessionManager: any) => Promise<string>} */
    #resolveResumeAgentName;
    /** @type {(agentName: string, deps: any) => import('./types.js').AgentMessageHandler} */
    #createAgentHandler;
    /** @type {(opts: any) => Promise<any>} */
    #ensureRootAgentSession;
    /** @type {typeof steerRootSessionWithTarget} */
    #steerRootSessionWithTarget;
    /** @type {Map<string, Set<SessionRuntimeEventListener>>} */
    #eventListeners;
    /** @type {Map<string, Promise<void>>} */
    #turnSettlements;
    /** @type {Map<string, RuntimeQueuedMessageState[]>} */
    #queuedMessages;
    /** @type {Map<string, QueueSourceSubscription>} */
    #queueSourceSubscriptions;

    /** @param {SessionRuntimeOptions} [options] */
    constructor(options = {}) {
        this.#sessionHost = options.sessionHost || new SessionHost();
        this.#switchActiveAgent = options.switchActiveAgent || switchActiveAgent;
        this.#abortActiveSession = options.abortActiveSession || abortActiveSessionFn;
        this.#createRootSessionManager = options.createRootSessionManager || createRootSessionManager;
        this.#openPersistedRootSession = options.openPersistedRootSession || openPersistedRootSession;
        this.#resolveResumeAgentName = options.resolveResumeAgentName || resolveResumeAgentName;
        this.#createAgentHandler = options.createAgentHandler || createAgentHandler;
        this.#ensureRootAgentSession = options.ensureRootAgentSession || ensureRootAgentSession;
        this.#steerRootSessionWithTarget = options.steerRootSessionWithTarget || steerRootSessionWithTarget;
        this.#eventListeners = new Map();
        this.#turnSettlements = new Map();
        this.#queuedMessages = new Map();
        this.#queueSourceSubscriptions = new Map();
    }

    listSessions() {
        return this.#sessionHost.listSessions()
            .map((session) => this.getSessionSnapshot(session.id))
            .filter((snapshot) => snapshot !== null);
    }

    /**
     * @param {string} sessionId
     * @returns {import('../types.js').SessionSnapshot | null}
     */
    getSessionSnapshot(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        const sessionManager = session.getRootSessionManager();
        const rawSessionManagerId = sessionManager?.getSessionId?.();
        const sessionManagerId = typeof rawSessionManagerId === "string" && rawSessionManagerId
            ? rawSessionManagerId
            : null;
        const workflow = session.getActiveExecutionWorkflow();
        return {
            id: session.id,
            cwd: session.cwd,
            sessionManagerId,
            name: sessionManager?.getSessionName?.() || null,
            disposed: session.disposed,
            activeAgent: session.getRootAgentName(),
            activeAgentInfo: session.getActiveAgentInfo(),
            activeModel: session.getActiveModelState(),
            thinkingLevel: session.getThinkingLevel(),
            busy: session.isTurnActive(),
            activeTurnId: session.getActiveTurnId(),
            queuedMessages: this.getQueuedMessages(session.id),
            workflow: workflow ? { ...workflow } : null,
        };
    }

    /**
     * @param {string} sessionId
     * @returns {import('./session-runtime-events.js').RuntimeQueuedMessage[]}
     */
    getQueuedMessages(sessionId) {
        return (this.#queuedMessages.get(sessionId) || []).map(toRuntimeQueuedMessage);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     */
    #ensureQueueSourceSubscription(hostedSession, sourceSession) {
        const current = this.#queueSourceSubscriptions.get(hostedSession.id);
        if (current?.sourceSession === sourceSession) return;
        current?.unsubscribe();
        const unsubscribe = sourceSession.subscribe((event) => {
            if (event.type !== "queue_update") return;
            this.#reconcileQueuedMessages(hostedSession, sourceSession, event.steering);
        });
        this.#queueSourceSubscriptions.set(hostedSession.id, { sourceSession, unsubscribe });
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     * @param {readonly string[] | undefined} steering
     */
    #reconcileQueuedMessages(hostedSession, sourceSession, steering) {
        const sourceMessages = (this.#queuedMessages.get(hostedSession.id) || [])
            .filter((message) => message.sourceSession === sourceSession);
        const consumedCount = Math.max(0, sourceMessages.length - (steering?.length || 0));
        for (const message of sourceMessages.slice(0, consumedCount)) {
            this.#transitionQueuedMessage(hostedSession, message, "consumed");
        }
        const sourceStillQueued = (this.#queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (!sourceStillQueued) this.#removeQueueSourceSubscription(hostedSession.id, sourceSession);
    }

    /**
     * @param {string} sessionId
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     */
    #removeQueueSourceSubscription(sessionId, sourceSession) {
        const subscription = this.#queueSourceSubscriptions.get(sessionId);
        if (subscription?.sourceSession !== sourceSession) return;
        subscription.unsubscribe();
        this.#queueSourceSubscriptions.delete(sessionId);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {RuntimeQueuedMessageState} message
     * @param {"consumed" | "dequeued"} status
     * @param {string} [reason]
     */
    #transitionQueuedMessage(hostedSession, message, status, reason) {
        const queue = this.#queuedMessages.get(hostedSession.id);
        const index = queue?.indexOf(message) ?? -1;
        if (!queue || index < 0) return null;
        queue.splice(index, 1);
        if (queue.length === 0) this.#queuedMessages.delete(hostedSession.id);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.#emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
            status,
            message: publicMessage,
            ...(reason ? { reason } : {}),
        });
        if (status === "consumed" && message.delivery === "steer") {
            this.#emitSessionEvent(hostedSession.id, {
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
     * @param {string} sessionId
     * @param {string} text
     * @param {import('./types.js').ImageAttachment[]} [images]
     * @returns {Promise<SteerSessionResult>}
     */
    async steerSession(sessionId, text, images = []) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const rootSession = /** @type {any} */ (hostedSession.getRootAgentSession());
        if (!rootSession?.isStreaming) return { ok: true, queued: false, reason: "not_streaming" };

        this.#ensureQueueSourceSubscription(hostedSession, rootSession);
        const sourceSession = await this.#steerRootSessionWithTarget(hostedSession, text, images);
        if (!sourceSession) {
            this.#removeQueueSourceSubscription(hostedSession.id, rootSession);
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
        this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
        const publicMessage = this.#trackQueuedMessage(hostedSession, message);
        const activeSteering = sourceSession.getSteeringMessages?.();
        if (Array.isArray(activeSteering)) {
            this.#reconcileQueuedMessages(hostedSession, sourceSession, activeSteering);
        }
        return { ok: true, queued: true, message: publicMessage };
    }

    /**
     * Queue a message for a later prompt when it could not be accepted as live
     * steering. This state is core-owned so every UI sees the same queue.
     *
     * @param {string} sessionId
     * @param {string} text
     * @param {import('./types.js').ImageAttachment[]} [images]
     * @returns {SteerSessionResult}
     */
    queueNextTurnMessage(sessionId, text, images = []) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const message = /** @type {RuntimeQueuedMessageState} */ ({
            id: crypto.randomUUID(),
            text,
            images: images.map((image) => ({ ...image })),
            delivery: "next_turn",
            queuedAt: new Date().toISOString(),
        });
        return { ok: true, queued: true, message: this.#trackQueuedMessage(hostedSession, message) };
    }

    /**
     * Claim the oldest deferred message for execution. Removing it emits the
     * same consumed transition as a steering message; promptSession publishes
     * its USER_MESSAGE event when execution begins.
     *
     * @param {string} sessionId
     * @returns {DequeueQueuedMessageResult}
     */
    takeNextTurnMessage(sessionId) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const selected = (this.#queuedMessages.get(hostedSession.id) || [])
            .find((message) => message.delivery === "next_turn");
        if (!selected) return { ok: true, message: null };
        const publicMessage = this.#transitionQueuedMessage(hostedSession, selected, "consumed");
        return { ok: true, message: publicMessage };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {RuntimeQueuedMessageState} message
     */
    #trackQueuedMessage(hostedSession, message) {
        let queue = this.#queuedMessages.get(hostedSession.id);
        if (!queue) {
            queue = [];
            this.#queuedMessages.set(hostedSession.id, queue);
        }
        queue.push(message);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.#emitSessionEvent(hostedSession.id, {
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
     * @param {string} sessionId
     * @returns {Promise<DequeueQueuedMessageResult>}
     */
    async dequeueLastQueuedMessage(sessionId) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const queue = this.#queuedMessages.get(hostedSession.id) || [];
        const selected = queue.at(-1);
        if (!selected) return { ok: true, message: null };

        if (selected.delivery === "next_turn") {
            const publicMessage = this.#transitionQueuedMessage(
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
        this.#removeQueueSourceSubscription(hostedSession.id, sourceSession);
        /** @type {{ steering: string[], followUp: string[] }} */
        let cleared;
        try {
            cleared = sourceSession.clearQueue();
        } catch (error) {
            this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
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
                const requeued = await this.#steerRootSessionWithTarget(hostedSession, message.text, message.images);
                if (!requeued) throw new Error("root session stopped streaming while restoring its queue");
            }
            for (const followUp of cleared.followUp || []) await sourceSession.followUp(followUp);
        } catch (error) {
            requeueError = getRuntimeErrorMessage(error);
        }

        const publicMessage = toRuntimeQueuedMessage(selected);
        if (requeueError) {
            for (const message of sourceMessages) {
                this.#transitionQueuedMessage(
                    hostedSession,
                    message,
                    "dequeued",
                    message.id === selected.id ? "user_recall" : "requeue_failed",
                );
            }
            return { ok: true, message: publicMessage, warning: requeueError };
        }

        this.#transitionQueuedMessage(hostedSession, selected, "dequeued", "user_recall");
        const sourceStillQueued = (this.#queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (sourceStillQueued) this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
        return { ok: true, message: publicMessage };
    }

    /**
     * @param {string} sessionId
     * @param {string} [reason]
     */
    clearQueuedMessages(sessionId, reason = "cleared") {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, cleared: 0, error: "not_found" };
        const messages = [...(this.#queuedMessages.get(hostedSession.id) || [])];
        const sources = new Set(messages.map((message) => message.sourceSession).filter(Boolean));
        const clearedSources = new Set();
        for (const sourceSession of sources) {
            if (!sourceSession || typeof sourceSession.clearQueue !== "function") continue;
            this.#removeQueueSourceSubscription(hostedSession.id, sourceSession);
            try {
                sourceSession.clearQueue();
                clearedSources.add(sourceSession);
            } catch {
                this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
            }
        }
        const clearedMessages = messages.filter((message) =>
            message.delivery === "next_turn" ||
            (message.sourceSession && clearedSources.has(message.sourceSession))
        );
        for (const message of clearedMessages) {
            this.#transitionQueuedMessage(hostedSession, message, "dequeued", reason);
        }
        return { ok: true, cleared: clearedMessages.length };
    }

    /**
     * @param {string} sessionId
     * @param {string} name
     */
    renameSession(sessionId, name) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const normalizedName = String(name || "").trim();
        if (!normalizedName) return { ok: false, error: "invalid_name" };
        session.getRootSessionManager()?.appendSessionInfo?.(normalizedName);
        this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.SESSION_RENAMED, name: normalizedName });
        return { ok: true, name: normalizedName };
    }

    /**
     * @param {string} sessionId
     * @param {string} model
     * @param {string} [provider]
     * @param {boolean} [userOverride]
     */
    setSessionModel(sessionId, model, provider = "", userOverride = true) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setActiveModelState(model, provider, userOverride);
        this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
        return { ok: true, model, provider };
    }

    /**
     * Apply a model override and rebuild the active root agent through the
     * runtime boundary.
     *
     * @param {string} sessionId
     * @param {string} model
     * @param {string} [provider]
     */
    async reconfigureSessionModel(sessionId, model, provider = "") {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setActiveModelState(model, provider, true);
        const agentName = session.getRootAgentName();
        if (agentName) {
            await this.#ensureRootAgentSession({
                hostedSession: session,
                agentName,
                modelOverride: provider ? `${provider}/${model}` : model,
                sessionManager: /** @type {any} */ (session.getRootSessionManager() || undefined),
            });
        }
        this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
        return { ok: true, model, provider };
    }

    /** @param {string} sessionId @param {string} context */
    setProjectStateContext(sessionId, context) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setProjectStateContext(context);
        return { ok: true };
    }

    /** @param {string} sessionId @param {string} agentName */
    setSessionHandler(sessionId, agentName) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setActiveOnMessage(this.#createAgentHandler(agentName, { hostedSession: session }));
        return { ok: true };
    }

    /**
     * @param {string} sessionId
     * @param {{ agentName: string, modelOverride?: string }} options
     */
    async ensureSessionReady(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        await this.#ensureRootAgentSession({
            hostedSession: session,
            agentName: options.agentName,
            modelOverride: options.modelOverride,
            sessionManager: /** @type {any} */ (session.getRootSessionManager() || undefined),
        });
        return { ok: true };
    }

    /**
     * Run a transient agent inside an existing runtime session. Consumers may
     * select behavior, but the internal HostedSession and Pi manager never
     * cross the runtime boundary.
     *
     * @param {string} sessionId
     * @param {{
     *   agentName: string,
     *   userRequest: string,
     *   agentDef?: any,
     *   images?: import('./types.js').ImageAttachment[],
     *   toolNames?: string[],
     *   customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[],
     *   modelOverride?: string,
     *   allowReturnToRouter?: boolean,
     * }} options
     */
    async runIsolatedAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runIsolatedAgent: session not found");
        return await runAgentSession({
            hostedSession: session,
            agentName: options.agentName,
            userRequest: options.userRequest,
            images: options.images || [],
            toolNames: options.toolNames,
            customTools: options.customTools,
            modelOverride: options.modelOverride,
            allowReturnToRouter: options.allowReturnToRouter,
            sessionManager: /** @type {any} */ (session.getRootSessionManager() || undefined),
            _agentDefOverride: options.agentDef,
            useRootSession: false,
        });
    }

    /** @param {string} sessionId @param {Record<string, any>} workflow */
    setActiveExecutionWorkflow(sessionId, workflow) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setActiveExecutionWorkflow(/** @type {any} */ (workflow));
        return { ok: true };
    }

    /** @param {string} sessionId */
    clearActiveExecutionWorkflow(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.clearActiveExecutionWorkflow();
        return { ok: true };
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async executePlan(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.executePlan: session not found");
        const { executePlan } = await import("../workflow/workflow.js");
        return await executePlan(/** @type {any} */ ({ ...options, hostedSession: session }));
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async runPlanningAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runPlanningAgent: session not found");
        const { runPlanningAgent } = await import("../workflow/workflow.js");
        return await runPlanningAgent(
            /** @type {any} */ ({
                ...options,
                hostedSession: session,
                sessionManager: /** @type {any} */ (session.getRootSessionManager() || undefined),
            }),
        );
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async runSlicerAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runSlicerAgent: session not found");
        const { runSlicerAgent } = await import("../workflow/workflow-slicer.js");
        return await runSlicerAgent(
            /** @type {any} */ ({
                ...options,
                hostedSession: session,
                sessionManager: /** @type {any} */ (session.getRootSessionManager() || undefined),
            }),
        );
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async ensureSlicerTasks(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.ensureSlicerTasks: session not found");
        const { ensureSlicerTasks } = await import("../workflow/workflow-slicer.js");
        return await ensureSlicerTasks(/** @type {any} */ ({ ...options, hostedSession: session }));
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async runValidation(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runValidation: session not found");
        const { runValidationLoop } = await import("../workflow/validation.js");
        return await runValidationLoop(/** @type {any} */ ({ ...options, hostedSession: session }));
    }

    /** @param {string} sessionId @param {string} planName */
    async askPostApproval(sessionId, planName) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.askPostApproval: session not found");
        const { askPostApproval } = await import("../workflow/workflow-prompts.js");
        return await askPostApproval(planName, session);
    }

    /** @param {string} sessionId @param {string} planName @param {string} [cwd] */
    async askApprovalWithTasks(sessionId, planName, cwd) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.askApprovalWithTasks: session not found");
        const { askApprovalWithTasks } = await import("../workflow/workflow-prompts.js");
        return await askApprovalWithTasks(planName, session, undefined, cwd || session.cwd);
    }

    /** @param {string} sessionId @param {string} planName */
    async askProjectDecompositionApproval(sessionId, planName) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.askProjectDecompositionApproval: session not found");
        const { askProjectDecompositionApproval } = await import("../workflow/workflow-prompts.js");
        return await askProjectDecompositionApproval(planName, session);
    }

    /** @param {string} sessionId @param {boolean} enabled */
    async setSessionAutoCompaction(sessionId, enabled) {
        const session = this.#sessionHost.getSession(sessionId);
        const rootAgentSession = /** @type {any} */ (session?.getRootAgentSession());
        if (!rootAgentSession?.setAutoCompactionEnabled) return { ok: false, error: "unsupported" };
        rootAgentSession.setAutoCompactionEnabled(enabled);
        await rootAgentSession.settingsManager?.flush?.();
        return { ok: true, enabled };
    }

    /** @param {string} sessionId */
    replaySession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, replayed: 0, error: "not_found" };
        const manager = session.getRootSessionManager();
        const events = createReplayEvents(sessionId, manager ? getRootSessionBranchEntries(manager) : []);
        for (const event of events) this.#emitSessionEvent(sessionId, /** @type {any} */ (event));
        return { ok: true, replayed: events.length };
    }

    /**
     * @param {string} sessionId
     * @param {import('./types.js').ImageAttachment} image
     */
    async persistSessionImage(sessionId, image) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.persistSessionImage: session not found");
        return await persistImageAttachment(
            image,
            /** @type {any} */ (session.getRootSessionManager() || undefined),
            session.cwd,
        );
    }

    /**
     * @param {string} sessionId
     * @param {import('./types.js').ImageAttachment[]} images
     */
    async preflightSessionImages(sessionId, images) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, message: "Runtime session not found." };
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        const activeModel = rootAgentSession?.model;
        let fallbackModelRef;
        if (images.length > 0 && !modelSupportsImageInput(activeModel)) {
            fallbackModelRef = (await resolveVisionFallbackModel(rootAgentSession?.modelRegistry || getModelRegistry()))
                ?.modelRef;
        }
        return preflightImageAttachments(images, { activeModel, fallbackModelRef });
    }

    /** @param {string} sessionId */
    cycleSessionThinkingLevel(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        const levels = /** @type {const} */ (["off", "minimal", "low", "medium", "high", "xhigh"]);
        const next = rootAgentSession?.cycleThinkingLevel?.() ??
            levels[(levels.indexOf(session.getThinkingLevel()) + 1) % levels.length];
        if (next === undefined) {
            this.#emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.SYSTEM_STATUS,
                message: "Current model does not support thinking",
            });
            return { ok: false, error: "unsupported" };
        }
        session.setThinkingLevel(next);
        this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.THINKING_LEVEL_CHANGED, thinkingLevel: next });
        return { ok: true, thinkingLevel: next };
    }

    /**
     * Execute a consumer-requested local shell command as one Runtime-owned
     * tool lifecycle. The consumer never publishes presentation events.
     *
     * @param {string} sessionId
     * @param {{ command: string, userRequest?: string, persist?: boolean }} options
     */
    async runLocalShellCommand(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, exitCode: 1, output: "", error: "not_found" };
        const command = String(options?.command || "").trim();
        if (!command) return { ok: false, exitCode: 1, output: "", error: "empty_command" };

        const persist = options.persist !== false && !session.isTurnActive();
        const userRequest = options.userRequest || `!${command}`;
        const toolCallId = `bash-${crypto.randomUUID()}`;
        const interactionId = `local-shell:${toolCallId}`;
        const abortController = new AbortController();
        /** @type {Deno.ChildProcess | null} */
        let child = null;
        let canceled = false;
        let output = "";
        let exitCode = 1;

        const abort = () => {
            canceled = true;
            try {
                child?.kill();
            } catch {
                // The process may have exited between cancellation and kill.
            }
        };
        abortController.signal.addEventListener("abort", abort, { once: true });
        session.addActiveInteraction(interactionId, { abortController });

        if (persist) {
            this.#emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.USER_MESSAGE,
                text: userRequest,
                images: [],
            });
        }
        this.#emitSessionEvent(sessionId, {
            type: RuntimeEventTypes.TOOL_START,
            toolCallId,
            toolName: "bash",
            title: `$ ${command}`,
            args: { command },
        });

        try {
            const executable = Deno.build.os === "windows" ? "cmd" : "sh";
            const commandFlag = Deno.build.os === "windows" ? "/c" : "-c";
            child = new Deno.Command(executable, {
                args: [commandFlag, command],
                cwd: session.cwd,
                stdout: "piped",
                stderr: "piped",
            }).spawn();

            /** @param {ReadableStream<Uint8Array>} stream */
            const readStream = async (stream) => {
                const reader = stream.getReader();
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        if (canceled) continue;
                        output += new TextDecoder().decode(value);
                        this.#emitSessionEvent(sessionId, {
                            type: RuntimeEventTypes.TOOL_UPDATE,
                            toolCallId,
                            toolName: "bash",
                            text: output,
                        });
                    }
                } finally {
                    reader.releaseLock();
                }
            };

            const [status] = await Promise.all([
                child.status,
                readStream(child.stdout),
                readStream(child.stderr),
            ]);
            exitCode = canceled ? 130 : status.success ? 0 : status.code || 1;
        } catch (error) {
            if (!canceled) {
                output += `Error starting process: ${error instanceof Error ? error.message : String(error)}\n`;
            }
            exitCode = canceled ? 130 : 1;
        } finally {
            abortController.signal.removeEventListener("abort", abort);
            session.removeActiveInteraction(interactionId);
        }

        const finalText = canceled ? `${output}\n[RunWield] Command canceled by user.` : output;
        this.#emitSessionEvent(sessionId, {
            type: RuntimeEventTypes.TOOL_END,
            toolCallId,
            toolName: "bash",
            text: finalText,
            result: output,
            isError: canceled || exitCode !== 0,
        });
        if (canceled) {
            this.#emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.SYSTEM_STATUS,
                message: "Bash command canceled.",
            });
        } else if (persist) {
            this.#recordLocalToolExchange(session, {
                userRequest,
                toolCallId,
                command,
                output,
                isError: exitCode !== 0,
            });
        }

        return { ok: !canceled && exitCode === 0, exitCode, output, canceled, toolCallId };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {{ userRequest: string, toolCallId: string, command: string, output: string, isError: boolean }} exchange
     */
    #recordLocalToolExchange(session, exchange) {
        const manager = /** @type {any} */ (session.getRootSessionManager());
        if (!manager?.addMessage) return { ok: false, error: "not_found" };
        manager.addMessage({ role: "user", content: [{ type: "text", text: exchange.userRequest }] });
        manager.addMessage({
            role: "assistant",
            content: [{
                type: "tool_use",
                id: exchange.toolCallId,
                name: "bash",
                input: { command: exchange.command },
            }],
        });
        manager.addMessage({
            role: "user",
            content: [{
                type: "tool_result",
                tool_use_id: exchange.toolCallId,
                is_error: exchange.isError,
                content: exchange.output,
            }],
        });
        return { ok: true };
    }

    /** @param {string} sessionId @param {string} [instructions] */
    async compactSession(sessionId, instructions = undefined) {
        const session = this.#sessionHost.getSession(sessionId);
        const rootAgentSession = /** @type {any} */ (session?.getRootAgentSession());
        if (!rootAgentSession?.compact) throw new Error("Runtime session cannot be compacted.");
        return await rootAgentSession.compact(instructions);
    }

    /** @param {string} sessionId */
    async reloadSession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const reloaded = await reloadRootAgentSession(session);
        return { ok: reloaded };
    }

    /** @param {string} sessionId */
    getLastAssistantText(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        const messages = /** @type {any[]} */ (
            /** @type {any} */ (session?.getRootAgentSession())?.agent?.state?.messages || []
        );
        for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
            const text = message.content
                .filter((/** @type {any} */ block) => block?.type === "text" && typeof block.text === "string")
                .map((/** @type {any} */ block) => block.text)
                .join("\n")
                .trim();
            if (text) return text;
        }
        return null;
    }

    /** @param {string} sessionId */
    getSessionInfo(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        const manager = /** @type {any} */ (session.getRootSessionManager());
        const entries = manager?.getEntries?.() || [];
        const info = {
            name: manager?.getSessionName?.() || "",
            file: manager?.getSessionFile?.() || "In-memory",
            persistedId: manager?.getSessionId?.() || sessionId,
            compactionCount: 0,
            userMessages: 0,
            assistantMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            compactionSettings: null,
            contextUsage: null,
        };
        for (const entry of entries) {
            if (entry?.type === "compaction") info.compactionCount++;
            if (entry?.type !== "message" || !entry.message) continue;
            const message = entry.message;
            if (message.role === "user") {
                info.userMessages++;
                info.toolResults += Array.isArray(message.content)
                    ? message.content.filter((/** @type {any} */ block) => block?.type === "tool_result").length
                    : 0;
            }
            if (message.role === "assistant") {
                info.assistantMessages++;
                info.toolCalls += Array.isArray(message.content)
                    ? message.content.filter((/** @type {any} */ block) => block?.type === "tool_use").length
                    : 0;
                const usage = normalizeRuntimeUsage(message.usage);
                info.inputTokens += usage.input;
                info.outputTokens += usage.output;
                info.cacheReadTokens += usage.cacheRead;
                info.cacheWriteTokens += usage.cacheWrite;
            }
        }
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        info.compactionSettings = rootAgentSession?.settingsManager?.getCompactionSettings?.() || null;
        info.contextUsage = rootAgentSession?.getContextUsage?.() || null;
        return info;
    }

    /** @param {string} sessionId */
    getSessionMemoryBackupDir(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        const manager = session?.getRootSessionManager();
        const persistedId = manager?.getSessionId?.();
        if (!session || !persistedId) throw new Error("Runtime session has no persisted session id.");
        return getRunWieldSessionMemoryBackupDir(session.cwd, persistedId);
    }

    /** @param {string} cwd */
    async listResumableSessions(cwd) {
        if (!cwd || !isAbsolute(cwd)) {
            throw new Error("SessionRuntime.listResumableSessions requires an absolute cwd");
        }
        return await listPersistedRootSessions(cwd);
    }

    /**
     * Inspect the model context of a persisted session without exposing its
     * SessionManager to the consumer.
     *
     * @param {{ cwd: string, sessionId: string, sessionPath?: string }} options
     */
    async inspectResumableSession(options) {
        const { estimateTokens } = await import("@earendil-works/pi-coding-agent");
        const { sessionManager } = await this.#openPersistedRootSession(options);
        try {
            const context = sessionManager.buildSessionContext?.();
            const messages = Array.isArray(context?.messages) ? context.messages : [];
            let estimatedTokens = 0;
            for (const message of messages) estimatedTokens += estimateTokens(/** @type {any} */ (message));
            const model = context?.model && typeof context.model === "object"
                ? /** @type {{ provider: string, modelId: string }} */ (context.model)
                : null;
            return { estimatedTokens, messageCount: messages.length, model };
        } finally {
            sessionManager.dispose?.();
        }
    }

    /** @param {string} sessionId */
    async listSessionPromptTemplates(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.listSessionPromptTemplates: session not found");
        return await listPromptTemplates({ cwd: session.cwd });
    }

    /** @param {string} sessionId */
    async listSessionSkills(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.listSessionSkills: session not found");
        return await listSkills({ cwd: session.cwd });
    }

    /** @param {string} sessionId */
    async listSessionContextFiles(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.listSessionContextFiles: session not found");
        return await listLoadedAgentMdFiles(session.cwd);
    }

    /** @param {string} sessionId @param {string} skillName @param {string} [instructions] */
    async expandSessionSkillCommand(sessionId, skillName, instructions) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.expandSessionSkillCommand: session not found");
        return await expandSkillCommand(skillName, instructions, session.cwd);
    }

    /** @param {string} templatePath @param {string} [instructions] */
    async expandSessionPromptTemplate(templatePath, instructions) {
        return await expandPromptTemplate(templatePath, instructions);
    }

    /** @param {string} sessionId @param {string} outputPath */
    async exportSession(sessionId, outputPath) {
        const session = this.#sessionHost.getSession(sessionId);
        const manager = /** @type {any} */ (session?.getRootSessionManager());
        if (!manager) throw new Error("Runtime session has no persistence store.");
        return outputPath.toLowerCase().endsWith(".jsonl")
            ? exportRootSessionToJsonl(manager, outputPath)
            : await exportRootSessionToHtml(manager, outputPath);
    }

    /**
     * @param {string} sessionId
     * @param {import('./hosted-session.js').ThinkingLevel} thinkingLevel
     */
    setSessionThinkingLevel(sessionId, thinkingLevel) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setThinkingLevel(thinkingLevel);
        this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.THINKING_LEVEL_CHANGED, thinkingLevel });
        return { ok: true, thinkingLevel };
    }

    /** @param {string} id */
    closeSession(id) {
        const hostedSession = this.#sessionHost.getSession(id);
        if (hostedSession) this.clearQueuedMessages(hostedSession.id, "session_closed");
        const closed = this.#sessionHost.disposeSession(id);
        if (closed) {
            this.#emitSessionEvent(id, { type: RuntimeEventTypes.SESSION_CLOSED });
            this.#eventListeners.delete(id);
            const queueSubscription = this.#queueSourceSubscriptions.get(id);
            queueSubscription?.unsubscribe();
            this.#queueSourceSubscriptions.delete(id);
            this.#queuedMessages.delete(id);
        }
        return { ok: true, closed };
    }

    /**
     * Cancel an active turn, wait for the underlying Agent Session prompt to
     * settle, then dispose the Hosted Session.
     *
     * @param {string} sessionId
     */
    async closeSessionWhenIdle(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: true, closed: false };
        if (session.isTurnActive()) {
            this.cancelSession(session.id);
            await this.#turnSettlements.get(session.id);
        }
        return this.closeSession(session.id);
    }

    closeAllSessions() {
        const sessions = this.listSessions();
        for (const session of sessions) {
            try {
                const hostedSession = this.#sessionHost.getSession(session.id);
                if (hostedSession) this.cancelSession(hostedSession.id);
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
     * @param {string} sessionId
     * @param {SessionRuntimeEventListener} listener
     * @returns {() => void}
     */
    subscribeSessionEvents(sessionId, listener) {
        let listeners = this.#eventListeners.get(sessionId);
        if (!listeners) {
            listeners = new Set();
            this.#eventListeners.set(sessionId, listeners);
        }
        listeners.add(listener);
        return () => {
            const current = this.#eventListeners.get(sessionId);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) this.#eventListeners.delete(sessionId);
        };
    }

    /**
     * @param {string} sessionId
     * @param {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} event
     */
    #emitSessionEvent(sessionId, event) {
        const runtimeEvent = createSessionRuntimeEvent(sessionId, event);
        const listeners = this.#eventListeners.get(sessionId);
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

    /** @param {import('./hosted-session.js').HostedSession} hostedSession */
    #attachRuntimeEventSink(hostedSession) {
        if (!hostedSession) throw new Error("SessionRuntime.attachRuntimeEventSink: session not found");
        hostedSession.setEventSink({
            emit: (
                /** @type {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} */ event,
            ) => {
                this.#emitSessionEvent(hostedSession.id, event);
            },
        });
    }

    /**
     * Create the persistence and internal session state used by an interactive
     * consumer. Only the opaque runtime id and public metadata cross the core
     * boundary.
     *
     * @param {{ cwd: string, mode?: "new" | "continue" }} options
     */
    async createInteractiveSession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.createInteractiveSession requires an absolute cwd");
        }
        const sessionManager = await this.#createRootSessionManager(options.mode || "new", options.cwd);
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            sessionManager,
            cwd: options.cwd,
        });
        this.#attachRuntimeEventSink(hostedSession);
        this.#emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.SESSION_CREATED,
            cwd: hostedSession.cwd,
        });
        return {
            sessionId: hostedSession.id,
            cwd: hostedSession.cwd,
            sessionManagerId: sessionManager.getSessionId?.() || hostedSession.id,
            startedAt: sessionManager.getHeader?.()?.timestamp || new Date().toISOString(),
        };
    }

    /**
     * @param {PromptReadySessionOptions} options
     * @returns {Promise<string>}
     */
    async createPromptReadySession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.createPromptReadySession requires an absolute cwd");
        }
        const agentName = options.agentName || AGENTS.ROUTER;
        const created = await this.createInteractiveSession({ cwd: options.cwd, mode: "new" });
        const hostedSession = this.#sessionHost.getSession(created.sessionId);
        if (!hostedSession) throw new Error("SessionRuntime failed to retain the new session");
        const sessionManager = hostedSession.getRootSessionManager();
        try {
            hostedSession.setActiveOnMessage(this.#createAgentHandler(agentName, { hostedSession }));
            await this.#ensureRootAgentSession({
                hostedSession,
                agentName,
                sessionManager: /** @type {any} */ (sessionManager || undefined),
            });
            return hostedSession.id;
        } catch (error) {
            this.closeSession(hostedSession.id);
            throw error;
        }
    }

    /**
     * @param {LoadSessionOptions} options
     * @returns {Promise<{ sessionId: string, cwd: string, replayEvents: import('./session-runtime-events.js').SessionRuntimeEvent[], sessionManagerId: string, sessionPath: string }>}
     */
    async loadSession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.loadSession requires an absolute cwd");
        }
        if (!options.sessionId || typeof options.sessionId !== "string") {
            throw new Error("SessionRuntime.loadSession requires a session id");
        }
        const { sessionManager, resolved } = await this.#openPersistedRootSession({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath: options.sessionPath,
        });
        const agentName = await this.#resolveResumeAgentName(sessionManager);
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            sessionManager,
            cwd: options.cwd,
        });
        this.#attachRuntimeEventSink(hostedSession);
        try {
            hostedSession.setActiveOnMessage(this.#createAgentHandler(agentName, { hostedSession }));
            await this.#ensureRootAgentSession({
                hostedSession,
                agentName,
                modelOverride: options.modelOverride,
                sessionManager,
            });
            const replayEvents = createReplayEvents(hostedSession.id, getRootSessionBranchEntries(sessionManager))
                .map((event) => createSessionRuntimeEvent(hostedSession.id, /** @type {any} */ (event)));
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.SESSION_LOADED,
                cwd: hostedSession.cwd,
                _meta: { sessionManagerId: resolved.sessionId, sessionPath: resolved.sessionPath },
            });
            return {
                sessionId: hostedSession.id,
                cwd: hostedSession.cwd,
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
     * @param {string} sessionId
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionAdapter | null} adapter
     */
    setInteractionAdapter(sessionId, adapter) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setInteractionAdapter(adapter);
        return { ok: true };
    }

    /**
     * @param {string} sessionId
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionRequest} request
     * @param {AbortSignal} [signal]
     */
    async requestInteraction(sessionId, request, signal) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { outcome: "unsupported", message: "Session not found." };
        return await requestHostedSessionInteraction(session, request, signal);
    }

    /**
     * @param {string} sessionId
     * @param {{ agentName: string, model?: string, allowReturnToRouter?: boolean }} options
     */
    async switchAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        if (session.isTurnActive()) throw new SessionTurnInProgressError(session.id);
        return await this.#switchActiveAgent(session, options, {
            ensureRootAgentSession: this.#ensureRootAgentSession,
            createAgentHandler: /** @type {typeof createAgentHandler} */ (this.#createAgentHandler),
        });
    }

    /** @param {string} sessionId */
    cancelSession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, aborted: false, error: "not_found" };
        let aborted = false;
        let operationCanceled = false;
        let agentCanceled = false;
        try {
            operationCanceled = Boolean(session.cancelActiveInteractions?.());
            const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
            if (rootAgentSession?.isCompacting && rootAgentSession?.abortCompaction) {
                rootAgentSession.abortCompaction();
                operationCanceled = true;
            }
            this.clearQueuedMessages(session.id, "session_cancel");
            agentCanceled = this.#abortActiveSession(session);
            aborted = operationCanceled || agentCanceled;
        } finally {
            this.#emitSessionEvent(session.id, {
                type: RuntimeEventTypes.CANCELLATION,
                aborted,
                reason: "session_cancel",
                ...(aborted
                    ? {
                        scope: operationCanceled ? "operation" : "agent",
                        message: operationCanceled ? "Operation canceled." : "Agent run canceled.",
                    }
                    : {}),
            });
        }
        return { ok: true, aborted };
    }

    /**
     * @param {string} sessionId
     * @param {PromptSessionOptions} options
     * @returns {Promise<{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string }>}
     */
    async promptSession(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptSession: session not found");
        const turnId = crypto.randomUUID();
        if (!hostedSession.beginTurn(turnId)) throw new SessionTurnInProgressError(hostedSession.id);
        /** @type {() => void} */
        let cleanupTurn = () => {};
        /** @type {() => void} */
        let settleTurn = () => {};
        const turnSettlement = new Promise((resolve) => {
            settleTurn = () => resolve(undefined);
        });
        this.#turnSettlements.set(hostedSession.id, turnSettlement);
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
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.USER_MESSAGE,
                turnId,
                text: request,
                images: images.map((image) => ({ ...image })),
            });
            this.#emitSessionEvent(hostedSession.id, { type: RuntimeEventTypes.TURN_START, turnId });
            this.#emitSessionEvent(hostedSession.id, { type: RuntimeEventTypes.BUSY_CHANGED, turnId, busy: true });

            if (!hostedSession.getActiveOnMessage() || !hostedSession.getRootSessionManager()) {
                const message = "Error: No active agent handler or session manager.";
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    turnId,
                    level: "error",
                    message,
                });
                this.#emitSessionEvent(hostedSession.id, {
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
                    this.#emitSessionEvent(hostedSession.id, {
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
                    hostedSession.getRootSessionManager() || undefined,
                );
                turns++;

                if (!turnResult || turnResult.kind !== "handoff") {
                    ok = true;
                    result = { ok: true, turns, handoffs, handoffLimitReached: false };
                    return result;
                }

                if (turn === MAX_CHAINED_HANDOFFS) {
                    this.#emitSessionEvent(hostedSession.id, {
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
                await this.#switchActiveAgent(
                    hostedSession,
                    {
                        agentName: turnResult.agentName,
                        model: turnResult.model,
                    },
                    {
                        ensureRootAgentSession: this.#ensureRootAgentSession,
                        createAgentHandler: /** @type {typeof createAgentHandler} */ (this.#createAgentHandler),
                    },
                );
                request = turnResult.userRequest;
                images = [];
            }

            ok = true;
            result = { ok: true, turns, handoffs, handoffLimitReached: false };
            return result;
        } catch (error) {
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.TERMINAL_ERROR,
                turnId,
                message: getRuntimeErrorMessage(error),
                error,
            });
            throw error;
        } finally {
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.TURN_END,
                turnId,
                ok,
                result: result || { turns, handoffs },
            });
            hostedSession.endTurn(turnId);
            this.#emitSessionEvent(hostedSession.id, { type: RuntimeEventTypes.BUSY_CHANGED, turnId, busy: false });
            try {
                cleanupTurn();
            } catch {
                // Adapter cleanup must not prevent runtime turn settlement.
            }
            settleTurn();
            if (this.#turnSettlements.get(hostedSession.id) === turnSettlement) {
                this.#turnSettlements.delete(hostedSession.id);
            }
        }
    }
}
