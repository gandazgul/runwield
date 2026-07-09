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
 * @typedef {RuntimeEventBase & { type: "user_message", text: string }} RuntimeUserMessageEvent
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
 * @typedef {RuntimeEventBase & { type: "system_status", message: string, level?: "info" | "warning" | "error", raw?: unknown }} RuntimeSystemStatusEvent
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
 * @typedef {RuntimeEventBase & { type: "usage", used?: number, size?: number, cost?: unknown, raw?: unknown }} RuntimeUsageEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "cancellation", reason?: string, aborted?: boolean }} RuntimeCancellationEvent
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
 * @typedef {RuntimeSessionLifecycleEvent | RuntimeReplayEvent | RuntimeUserMessageEvent | RuntimeAssistantDeltaEvent | RuntimeAssistantThinkingEndEvent | RuntimeToolStartEvent | RuntimeToolUpdateEvent | RuntimeToolEndEvent | RuntimeSystemStatusEvent | RuntimeTurnEvent | RuntimeBusyChangedEvent | RuntimeAgentChangedEvent | RuntimeModelChangedEvent | RuntimeThinkingLevelChangedEvent | RuntimeSessionRenamedEvent | RuntimePresentationStateEvent | RuntimeUsageEvent | RuntimeCancellationEvent | RuntimeTerminalErrorEvent | RuntimeInteractionLifecycleEvent | RuntimePlanReviewLinkEvent | RuntimeAttentionRequestedEvent} SessionRuntimeEvent
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
 * @param {unknown} value
 * @returns {string}
 */
export function getRuntimeErrorMessage(value) {
    if (value instanceof Error) return value.message;
    return String(value || "Unknown runtime error");
}
