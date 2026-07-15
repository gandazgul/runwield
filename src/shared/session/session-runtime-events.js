/**
 * @module shared/session/session-runtime-events
 * Adapter-neutral SessionRuntime event vocabulary.
 */

export const RuntimeEventTypes = Object.freeze({
    SESSION_CREATED: "session_created",
    SESSION_LOADED: "session_loaded",
    SESSION_CLOSED: "session_closed",
    REPLAY_ENTRY: "replay_entry",
    USER_MESSAGE: "user_message",
    ASSISTANT_TEXT_DELTA: "assistant_text_delta",
    ASSISTANT_THINKING_DELTA: "assistant_thinking_delta",
    ASSISTANT_THINKING_END: "assistant_thinking_end",
    TOOL_START: "tool_start",
    TOOL_UPDATE: "tool_update",
    TOOL_END: "tool_end",
    SYSTEM_STATUS: "system_status",
    TURN_START: "turn_start",
    TURN_END: "turn_end",
    BUSY_CHANGED: "busy_changed",
    AGENT_CHANGED: "agent_changed",
    MODEL_CHANGED: "model_changed",
    THINKING_LEVEL_CHANGED: "thinking_level_changed",
    SESSION_RENAMED: "session_renamed",
    INPUT_STATE_CHANGED: "input_state_changed",
    RUNNING_TASKS_CHANGED: "running_tasks_changed",
    MESSAGES_CLEARED: "messages_cleared",
    QUEUED_MESSAGE_CHANGED: "queued_message_changed",
    USAGE: "usage",
    CANCELLATION: "cancellation",
    TERMINAL_ERROR: "terminal_error",
    INTERACTION_REQUESTED: "interaction_requested",
    INTERACTION_RESOLVED: "interaction_resolved",
    INTERACTION_CANCELED: "interaction_canceled",
    PLAN_REVIEW_LINK: "plan_review_link",
    ATTENTION_REQUESTED: "attention_requested",
});

/**
 * @typedef {Object} RuntimeEventBase
 * @property {string} type
 * @property {string} sessionId
 * @property {string} timestamp
 * @property {string} [turnId]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {RuntimeEventBase & { type: "session_created" | "session_loaded" | "session_closed", cwd?: string }} RuntimeSessionLifecycleEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "replay_entry", role?: string, text?: string, raw?: unknown }} RuntimeReplayEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "user_message", text: string, messageId?: string, images?: import('./types.js').ImageAttachment[] }} RuntimeUserMessageEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "assistant_text_delta" | "assistant_thinking_delta", delta: string, messageId?: string }} RuntimeAssistantDeltaEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "assistant_thinking_end", messageId?: string }} RuntimeAssistantThinkingEndEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "tool_start", toolCallId: string, toolName: string, title?: string, args?: unknown }} RuntimeToolStartEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "tool_update", toolCallId: string, toolName?: string, partialResult?: unknown, text?: string }} RuntimeToolUpdateEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "tool_end", toolCallId: string, toolName?: string, isError?: boolean, result?: unknown, text?: string }} RuntimeToolEndEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "system_status", message: string, level?: "info" | "success" | "warning" | "error", raw?: unknown }} RuntimeSystemStatusEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "turn_start" | "turn_end", ok?: boolean, stopReason?: string, result?: unknown }} RuntimeTurnEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "busy_changed", busy: boolean }} RuntimeBusyChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "agent_changed", agentName: string, model?: string }} RuntimeAgentChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "model_changed", model: string, provider?: string }} RuntimeModelChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "thinking_level_changed", thinkingLevel: string }} RuntimeThinkingLevelChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "session_renamed", name: string }} RuntimeSessionRenamedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "input_state_changed", enabled: boolean } | RuntimeEventBase & { type: "running_tasks_changed", tasks: Array<{ task: number, assignee: string, description: string }> } | RuntimeEventBase & { type: "messages_cleared" }} RuntimePresentationStateEvent
 */

/**
 * @typedef {Object} RuntimeQueuedMessage
 * @property {string} id
 * @property {string} text
 * @property {import('./types.js').ImageAttachment[]} images
 * @property {"steer" | "next_turn"} delivery
 * @property {string} queuedAt
 */

/**
 * @typedef {RuntimeEventBase & { type: "queued_message_changed", status: "queued" | "consumed" | "dequeued", message: RuntimeQueuedMessage, reason?: string }} RuntimeQueuedMessageEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "usage", used?: number, size?: number, cost?: unknown, raw?: unknown }} RuntimeUsageEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "cancellation", reason?: string, aborted?: boolean, message?: string, scope?: "agent" | "operation" | "session" }} RuntimeCancellationEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "terminal_error", message: string, error?: unknown }} RuntimeTerminalErrorEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "interaction_requested" | "interaction_resolved" | "interaction_canceled", interactionId: string, interactionType?: string, outcome?: string, message?: string }} RuntimeInteractionLifecycleEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "plan_review_link", planName: string, reviewerUrl: string, spaceId?: string, serverUrl?: string, revision?: number, reused?: boolean, message?: string }} RuntimePlanReviewLinkEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "attention_requested", reason: "agentStopped" | "planWritten" | "userInterview", agentName?: string }} RuntimeAttentionRequestedEvent
 */

/**
 * @typedef {RuntimeSessionLifecycleEvent | RuntimeReplayEvent | RuntimeUserMessageEvent | RuntimeAssistantDeltaEvent | RuntimeAssistantThinkingEndEvent | RuntimeToolStartEvent | RuntimeToolUpdateEvent | RuntimeToolEndEvent | RuntimeSystemStatusEvent | RuntimeTurnEvent | RuntimeBusyChangedEvent | RuntimeAgentChangedEvent | RuntimeModelChangedEvent | RuntimeThinkingLevelChangedEvent | RuntimeSessionRenamedEvent | RuntimePresentationStateEvent | RuntimeQueuedMessageEvent | RuntimeUsageEvent | RuntimeCancellationEvent | RuntimeTerminalErrorEvent | RuntimeInteractionLifecycleEvent | RuntimePlanReviewLinkEvent | RuntimeAttentionRequestedEvent} SessionRuntimeEvent
 */

/**
 * @param {string} sessionId
 * @param {Partial<SessionRuntimeEvent> & { type: string }} event
 * @returns {SessionRuntimeEvent}
 */
export function createSessionRuntimeEvent(sessionId, event) {
    return /** @type {SessionRuntimeEvent} */ ({
        ...event,
        sessionId,
        timestamp: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
    });
}

/**
 * Publish a partial semantic event through a Hosted Session's installed sink.
 * Adapters own sink failures and cannot interrupt engine execution.
 *
 * @param {import('./hosted-session.js').HostedSession | undefined} hostedSession
 * @param {Partial<SessionRuntimeEvent> & { type: string }} event
 * @returns {boolean}
 */
export function emitHostedSessionRuntimeEvent(hostedSession, event) {
    const sink = hostedSession?.getEventSink?.();
    if (!sink) return false;
    try {
        if (typeof sink === "function") {
            sink(event);
            return true;
        }
        if (typeof sink === "object" && "emit" in sink && typeof sink.emit === "function") {
            sink.emit(event);
            return true;
        }
    } catch {
        // Adapter event sinks must not break core execution.
    }
    return false;
}

/**
 * Publish a user-visible status without coupling the producer to an adapter.
 * SessionRuntime owns the installed event sink and fans the event out to its
 * registered listeners.
 *
 * @param {import('./hosted-session.js').HostedSession | undefined} hostedSession
 * @param {string} message
 * @param {{ level?: "info" | "success" | "warning" | "error", header?: string, raw?: unknown, meta?: Record<string, unknown> }} [options]
 * @returns {boolean}
 */
export function emitSystemStatus(hostedSession, message, options = {}) {
    return emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.SYSTEM_STATUS,
        message: String(message),
        level: options.level || "info",
        ...(options.raw === undefined ? {} : { raw: options.raw }),
        _meta: {
            ...(options.header ? { header: options.header } : {}),
            ...(options.meta || {}),
        },
    });
}

/**
 * Publish a complete synthetic assistant message as one semantic delta. This
 * is used for workflow-owned messages such as completion and review results;
 * adapters decide how to render or encode it.
 *
 * @param {import('./hosted-session.js').HostedSession | undefined} hostedSession
 * @param {string} agentName
 * @param {string} text
 * @param {Record<string, unknown>} [meta]
 * @returns {boolean}
 */
export function emitAssistantMessage(hostedSession, agentName, text, meta = {}) {
    return emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
        messageId: crypto.randomUUID(),
        delta: String(text),
        _meta: { agentName, ...meta },
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function getRuntimeErrorMessage(value) {
    if (value instanceof Error) return value.message;
    return String(value || "Unknown runtime error");
}
