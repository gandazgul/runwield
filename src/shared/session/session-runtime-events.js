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
    USAGE: "usage",
    CANCELLATION: "cancellation",
    TERMINAL_ERROR: "terminal_error",
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
 * @typedef {RuntimeEventBase & { type: "usage", used?: number, size?: number, cost?: unknown, raw?: unknown }} RuntimeUsageEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "cancellation", reason?: string, aborted?: boolean }} RuntimeCancellationEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "terminal_error", message: string, error?: unknown }} RuntimeTerminalErrorEvent
 */

/**
 * @typedef {RuntimeSessionLifecycleEvent | RuntimeReplayEvent | RuntimeUserMessageEvent | RuntimeAssistantDeltaEvent | RuntimeAssistantThinkingEndEvent | RuntimeToolStartEvent | RuntimeToolUpdateEvent | RuntimeToolEndEvent | RuntimeSystemStatusEvent | RuntimeTurnEvent | RuntimeUsageEvent | RuntimeCancellationEvent | RuntimeTerminalErrorEvent} SessionRuntimeEvent
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
 * @param {unknown} value
 * @returns {string}
 */
export function getRuntimeErrorMessage(value) {
    if (value instanceof Error) return value.message;
    return String(value || "Unknown runtime error");
}
