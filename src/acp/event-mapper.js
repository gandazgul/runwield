/**
 * @module acp/event-mapper
 * Maps adapter-neutral SessionRuntime events to ACP session/update notifications.
 */

import { RuntimeEventTypes } from "../shared/session/session-runtime-events.js";

/** @param {unknown} value */
function safeMeta(value) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object") return { runwield: value };
    return {
        runwield: Object.fromEntries(
            Object.entries(/** @type {Record<string, unknown>} */ (value)).filter(([, entry]) => entry !== undefined),
        ),
    };
}

/**
 * @param {import('../shared/session/session-runtime-events.js').SessionRuntimeEvent} event
 * @param {Record<string, unknown>} [extra]
 */
function runtimeMeta(event, extra = {}) {
    const raw = /** @type {{ _meta?: unknown }} */ (event)._meta;
    const base = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
    const merged = Object.fromEntries(
        Object.entries({ ...base, ...extra }).filter(([, value]) => value !== undefined),
    );
    return Object.keys(merged).length > 0 ? safeMeta(merged) : undefined;
}

/**
 * ACP uses the same content-block shapes inside one protocol wrapper.
 * @param {import('../shared/session/session-runtime-events.js').RuntimeToolContentBlock[]} content
 */
function mapToolContent(content) {
    return content.map((block) => ({ type: "content", content: block }));
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
                messageId: event.messageId,
                content: { type: "text", text: event.text },
                ...(runtimeMeta(event) ? { _meta: runtimeMeta(event) } : {}),
            };
        case RuntimeEventTypes.ASSISTANT_TEXT_DELTA:
            return {
                sessionUpdate: "agent_message_chunk",
                messageId: event.messageId,
                content: { type: "text", text: event.delta },
                _meta: runtimeMeta(event, {
                    agentName: event.agentName,
                    messageKind: event.messageKind,
                    workflowMessage: event.workflowMessage,
                    approved: event.approved,
                }),
            };
        case RuntimeEventTypes.ASSISTANT_THINKING_DELTA:
            return {
                sessionUpdate: "agent_thought_chunk",
                messageId: event.messageId,
                content: { type: "text", text: event.delta },
                _meta: runtimeMeta(event, { agentName: event.agentName }),
            };
        case RuntimeEventTypes.TOOL_START:
            return {
                sessionUpdate: "tool_call",
                toolCallId: event.toolCallId,
                title: event.title,
                kind: event.kind,
                status: "in_progress",
                rawInput: event.args,
                _meta: runtimeMeta(event, { toolName: event.toolName }),
            };
        case RuntimeEventTypes.TOOL_UPDATE:
            return {
                sessionUpdate: "tool_call_update",
                toolCallId: event.toolCallId,
                title: event.title,
                kind: event.kind,
                status: "in_progress",
                content: mapToolContent(event.content),
                rawOutput: { content: event.content, details: event.details },
                _meta: runtimeMeta(event, { toolName: event.toolName }),
            };
        case RuntimeEventTypes.TOOL_END:
            return {
                sessionUpdate: "tool_call_update",
                toolCallId: event.toolCallId,
                title: event.title,
                kind: event.kind,
                status: event.isError ? "failed" : "completed",
                content: mapToolContent(event.content),
                rawOutput: { content: event.content, details: event.details },
                _meta: runtimeMeta(event, { toolName: event.toolName, durationMs: event.durationMs }),
            };
        case RuntimeEventTypes.USAGE: {
            const used = event.usage.inputTokens;
            const size = event.usage.contextWindow || used;
            return {
                sessionUpdate: "usage_update",
                used,
                size,
                ...(event.usage.costUsd ? { cost: event.usage.costUsd } : {}),
            };
        }
        case RuntimeEventTypes.PLAN_REVIEW_LINK: {
            return {
                sessionUpdate: "agent_message_chunk",
                messageId: event.messageId,
                content: { type: "text", text: event.message },
                _meta: safeMeta({
                    type: event.type,
                    planName: event.planName,
                    reviewerUrl: event.reviewerUrl,
                    spaceId: event.spaceId,
                    serverUrl: event.serverUrl,
                    revision: event.revision,
                    reused: event.reused,
                }),
            };
        }
        case RuntimeEventTypes.AGENT_CHANGED: {
            return {
                sessionUpdate: "agent_message_chunk",
                messageId: event.messageId,
                content: { type: "text", text: `Active agent: ${event.agentName}` },
                _meta: runtimeMeta(event, {
                    type: event.type,
                    agentName: event.agentName,
                    model: event.model,
                }),
            };
        }
        case RuntimeEventTypes.SYSTEM_STATUS:
        case RuntimeEventTypes.CANCELLATION:
        case RuntimeEventTypes.TERMINAL_ERROR: {
            if (!event.message) return null;
            return {
                sessionUpdate: "agent_message_chunk",
                messageId: event.messageId,
                content: { type: "text", text: event.message },
                _meta: runtimeMeta(event, {
                    type: event.type,
                    level: "level" in event ? event.level : undefined,
                }),
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
