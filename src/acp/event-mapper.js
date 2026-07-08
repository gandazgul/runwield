/**
 * @module acp/event-mapper
 * Maps adapter-neutral SessionRuntime events to ACP session/update notifications.
 */

import { RuntimeEventTypes } from "../shared/session/session-runtime-events.js";

/** @param {unknown} value */
function safeString(value) {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** @param {unknown} value */
function safeMeta(value) {
    if (value === undefined) return undefined;
    return { runwield: value };
}

/** @param {string} sessionId @param {import('../shared/session/session-runtime-events.js').SessionRuntimeEvent} event */
function messageId(sessionId, event) {
    const value = /** @type {any} */ (event);
    return value.messageId || event.turnId || `${sessionId}:${event.type}`;
}

/**
 * @param {import('../shared/session/session-runtime-events.js').SessionRuntimeEvent} event
 * @returns {Record<string, any> | null}
 */
export function mapRuntimeEventToAcpUpdate(event) {
    switch (event.type) {
        case RuntimeEventTypes.USER_MESSAGE:
            return {
                sessionUpdate: "user_message_chunk",
                messageId: messageId(event.sessionId, event),
                content: { type: "text", text: event.text || "" },
            };
        case RuntimeEventTypes.ASSISTANT_TEXT_DELTA:
            return {
                sessionUpdate: "agent_message_chunk",
                messageId: messageId(event.sessionId, event),
                content: { type: "text", text: event.delta || "" },
            };
        case RuntimeEventTypes.ASSISTANT_THINKING_DELTA:
            return {
                sessionUpdate: "agent_thought_chunk",
                messageId: messageId(event.sessionId, event),
                content: { type: "text", text: event.delta || "" },
            };
        case RuntimeEventTypes.TOOL_START:
            return {
                sessionUpdate: "tool_call",
                toolCallId: event.toolCallId,
                title: event.title || event.toolName,
                status: "in_progress",
                _meta: safeMeta({ toolName: event.toolName }),
            };
        case RuntimeEventTypes.TOOL_UPDATE:
            return {
                sessionUpdate: "tool_call_update",
                toolCallId: event.toolCallId,
                status: "in_progress",
                ...(event.text ? { content: [{ type: "content", content: { type: "text", text: event.text } }] } : {}),
                _meta: safeMeta({ toolName: event.toolName }),
            };
        case RuntimeEventTypes.TOOL_END:
            return {
                sessionUpdate: "tool_call_update",
                toolCallId: event.toolCallId,
                status: event.isError ? "failed" : "completed",
                ...(event.text ? { content: [{ type: "content", content: { type: "text", text: event.text } }] } : {}),
                _meta: safeMeta({ toolName: event.toolName }),
            };
        case RuntimeEventTypes.USAGE: {
            const raw = /** @type {any} */ (event.raw || {});
            const used = Number(event.used ?? raw.used ?? raw.tokens ?? raw.inputTokens ?? raw.input ?? 0) || 0;
            const size = Number(event.size ?? raw.size ?? raw.contextWindow ?? raw.context_window ?? used) || used;
            return {
                sessionUpdate: "usage_update",
                used,
                size,
                ...(event.cost || raw.cost ? { cost: event.cost || raw.cost } : {}),
            };
        }
        case RuntimeEventTypes.SYSTEM_STATUS:
        case RuntimeEventTypes.CANCELLATION:
        case RuntimeEventTypes.TERMINAL_ERROR: {
            const statusEvent = /** @type {any} */ (event);
            const text = statusEvent.message || statusEvent.reason || safeString(statusEvent.error);
            if (!text) return null;
            return {
                sessionUpdate: "agent_message_chunk",
                messageId: messageId(event.sessionId, event),
                content: { type: "text", text },
                _meta: safeMeta({ type: event.type, level: statusEvent.level }),
            };
        }
        default:
            return null;
    }
}

/**
 * @param {string} acpSessionId
 * @param {import('../shared/session/session-runtime-events.js').SessionRuntimeEvent} event
 * @returns {Record<string, any> | null}
 */
export function mapRuntimeEventToAcpSessionNotification(acpSessionId, event) {
    const update = mapRuntimeEventToAcpUpdate(event);
    if (!update) return null;
    return { sessionId: acpSessionId, update };
}
