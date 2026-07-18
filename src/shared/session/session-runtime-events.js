/**
 * @module shared/session/session-runtime-events
 * Adapter-neutral SessionRuntime event vocabulary.
 */

export const RuntimeEventTypes = Object.freeze({
    SESSION_CREATED: "session_created",
    SESSION_LOADED: "session_loaded",
    SESSION_CLOSED: "session_closed",
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
    WORKFLOW_CONTEXT_CHANGED: "workflow_context_changed",
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
    KEYBOARD_HELP: "keyboard_help",
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
 * @typedef {RuntimeEventBase & { type: "user_message", text: string, messageId: string, images: import('./types.js').ImageAttachment[] }} RuntimeUserMessageEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "assistant_text_delta", delta: string, messageId: string, agentName: string, messageKind: "assistant" | "workflow" | "review_result", workflowMessage?: string, approved?: boolean }} RuntimeAssistantTextDeltaEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "assistant_thinking_delta", delta: string, messageId: string, agentName: string }} RuntimeAssistantThinkingDeltaEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "assistant_thinking_end", messageId: string, agentName: string }} RuntimeAssistantThinkingEndEvent
 */

/**
 * @typedef {import('./tool-event-title.js').RuntimeToolKind} RuntimeToolKind
 */

/**
 * @typedef {{ toolCallId: string, toolName: string, title: string, kind: RuntimeToolKind }} RuntimeToolIdentity
 */

/**
 * @typedef {RuntimeEventBase & RuntimeToolIdentity & { type: "tool_start", args?: unknown }} RuntimeToolStartEvent
 */

/**
 * @typedef {{ type: "text", text: string } | { type: "image", data: string, mimeType: string }} RuntimeToolContentBlock
 */

/**
 * @typedef {Object} RuntimeToolResult
 * @property {RuntimeToolContentBlock[]} content Complete displayable content snapshot.
 * @property {string} output Complete text-only projection for text surfaces.
 * @property {Record<string, unknown> | null} details Structured tool result details such as truncation metadata.
 */

/**
 * @typedef {RuntimeEventBase & RuntimeToolIdentity & RuntimeToolResult & { type: "tool_update" }} RuntimeToolUpdateEvent
 */

/**
 * @typedef {RuntimeEventBase & RuntimeToolIdentity & RuntimeToolResult & { type: "tool_end", isError: boolean, durationMs: number | null }} RuntimeToolEndEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "system_status", messageId: string, message: string, level: "info" | "success" | "warning" | "error", header?: string }} RuntimeSystemStatusEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "turn_start" | "turn_end", ok?: boolean, stopReason?: string, result?: unknown }} RuntimeTurnEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "busy_changed", busy: boolean }} RuntimeBusyChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "agent_changed", messageId: string, agentName: string, model?: string }} RuntimeAgentChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "model_changed", model: string, provider?: string }} RuntimeModelChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "thinking_level_changed", thinkingLevel: string }} RuntimeThinkingLevelChangedEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "workflow_context_changed", workflowContext: import('./workflow-context-session.js').WorkflowContext }} RuntimeWorkflowContextChangedEvent
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
 * @typedef {Object} RuntimeUsage
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} costUsd
 * @property {number} [contextWindow]
 */

/**
 * @typedef {RuntimeEventBase & { type: "usage", usage: RuntimeUsage }} RuntimeUsageEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "cancellation", messageId: string, reason?: string, aborted?: boolean, message?: string, scope?: "agent" | "operation" | "session" }} RuntimeCancellationEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "terminal_error", messageId: string, message: string, error?: unknown }} RuntimeTerminalErrorEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "interaction_requested" | "interaction_resolved" | "interaction_canceled", interactionId: string, interactionType?: string, outcome?: string, message?: string }} RuntimeInteractionLifecycleEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "plan_review_link", messageId: string, planName: string, reviewerUrl: string, spaceId?: string, serverUrl?: string, revision?: number, reused?: boolean, message: string }} RuntimePlanReviewLinkEvent
 */

/**
 * @typedef {RuntimeEventBase & { type: "attention_requested", reason: "agentStopped" | "planWritten" | "userInterview", agentName?: string, sessionName?: string }} RuntimeAttentionRequestedEvent
 */

/**
 * @typedef {import('./session-help.js').SessionHelpItem} RuntimeKeyboardHelpItem
 */

/**
 * @typedef {RuntimeEventBase & { type: "keyboard_help", title: string, items: RuntimeKeyboardHelpItem[] }} RuntimeKeyboardHelpEvent
 */

/**
 * @typedef {RuntimeSessionLifecycleEvent | RuntimeUserMessageEvent | RuntimeAssistantTextDeltaEvent | RuntimeAssistantThinkingDeltaEvent | RuntimeAssistantThinkingEndEvent | RuntimeToolStartEvent | RuntimeToolUpdateEvent | RuntimeToolEndEvent | RuntimeSystemStatusEvent | RuntimeTurnEvent | RuntimeBusyChangedEvent | RuntimeAgentChangedEvent | RuntimeModelChangedEvent | RuntimeThinkingLevelChangedEvent | RuntimeWorkflowContextChangedEvent | RuntimeSessionRenamedEvent | RuntimePresentationStateEvent | RuntimeQueuedMessageEvent | RuntimeUsageEvent | RuntimeCancellationEvent | RuntimeTerminalErrorEvent | RuntimeInteractionLifecycleEvent | RuntimePlanReviewLinkEvent | RuntimeAttentionRequestedEvent | RuntimeKeyboardHelpEvent} SessionRuntimeEvent
 */

/** @type {Set<string>} */
const MESSAGE_ID_EVENT_TYPES = new Set([
    RuntimeEventTypes.USER_MESSAGE,
    RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
    RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
    RuntimeEventTypes.ASSISTANT_THINKING_END,
    RuntimeEventTypes.SYSTEM_STATUS,
    RuntimeEventTypes.TERMINAL_ERROR,
    RuntimeEventTypes.CANCELLATION,
    RuntimeEventTypes.PLAN_REVIEW_LINK,
    RuntimeEventTypes.AGENT_CHANGED,
]);

const RUNTIME_EVENT_TYPE_VALUES = new Set(Object.values(RuntimeEventTypes));
const TOOL_KINDS = new Set([
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
]);

/**
 * @param {boolean} condition
 * @param {string} type
 * @param {string} requirement
 */
function requireRuntimeEvent(condition, type, requirement) {
    if (!condition) throw new TypeError(`Invalid SessionRuntime event "${type}": ${requirement}`);
}

/**
 * Fail at the one outward boundary when a producer violates the semantic
 * contract. Consumer listeners are isolated separately by SessionRuntime.
 *
 * @param {SessionRuntimeEvent} event
 * @returns {SessionRuntimeEvent}
 */
export function assertSessionRuntimeEvent(event) {
    requireRuntimeEvent(RUNTIME_EVENT_TYPE_VALUES.has(event.type), event.type, "unknown event type");
    requireRuntimeEvent(
        typeof event.sessionId === "string" && event.sessionId.length > 0,
        event.type,
        "sessionId required",
    );
    requireRuntimeEvent(
        typeof event.timestamp === "string" && event.timestamp.length > 0,
        event.type,
        "timestamp required",
    );
    const value = /** @type {any} */ (event);
    const requireString = (/** @type {string} */ field) =>
        requireRuntimeEvent(typeof value[field] === "string", event.type, `${field} must be a string`);

    if (MESSAGE_ID_EVENT_TYPES.has(event.type)) requireString("messageId");
    switch (event.type) {
        case RuntimeEventTypes.USER_MESSAGE:
            requireString("text");
            requireRuntimeEvent(Array.isArray(value.images), event.type, "images must be an array");
            break;
        case RuntimeEventTypes.ASSISTANT_TEXT_DELTA:
            requireString("delta");
            requireString("agentName");
            requireRuntimeEvent(
                ["assistant", "workflow", "review_result"].includes(value.messageKind),
                event.type,
                "messageKind is invalid",
            );
            break;
        case RuntimeEventTypes.ASSISTANT_THINKING_DELTA:
            requireString("delta");
            requireString("agentName");
            break;
        case RuntimeEventTypes.ASSISTANT_THINKING_END:
            requireString("agentName");
            break;
        case RuntimeEventTypes.TOOL_START:
        case RuntimeEventTypes.TOOL_UPDATE:
        case RuntimeEventTypes.TOOL_END:
            requireString("toolCallId");
            requireString("toolName");
            requireString("title");
            requireRuntimeEvent(TOOL_KINDS.has(value.kind), event.type, "kind is invalid");
            if (event.type !== RuntimeEventTypes.TOOL_START) {
                requireString("output");
                requireRuntimeEvent(Array.isArray(value.content), event.type, "content must be an array");
                for (const block of value.content) {
                    const validText = block?.type === "text" && typeof block.text === "string";
                    const validImage = block?.type === "image" && typeof block.data === "string" &&
                        typeof block.mimeType === "string";
                    requireRuntimeEvent(validText || validImage, event.type, "content block is invalid");
                }
                requireRuntimeEvent(
                    value.details === null || (value.details && typeof value.details === "object"),
                    event.type,
                    "details must be an object or null",
                );
            }
            if (event.type === RuntimeEventTypes.TOOL_END) {
                requireRuntimeEvent(typeof value.isError === "boolean", event.type, "isError must be boolean");
                requireRuntimeEvent(
                    value.durationMs === null || (typeof value.durationMs === "number" && value.durationMs >= 0),
                    event.type,
                    "durationMs must be a non-negative number or null",
                );
            }
            break;
        case RuntimeEventTypes.SYSTEM_STATUS:
            requireString("message");
            requireRuntimeEvent(
                ["info", "success", "warning", "error"].includes(value.level),
                event.type,
                "level is invalid",
            );
            break;
        case RuntimeEventTypes.BUSY_CHANGED:
            requireRuntimeEvent(typeof value.busy === "boolean", event.type, "busy must be boolean");
            break;
        case RuntimeEventTypes.AGENT_CHANGED:
            requireString("agentName");
            break;
        case RuntimeEventTypes.MODEL_CHANGED:
            requireString("model");
            break;
        case RuntimeEventTypes.THINKING_LEVEL_CHANGED:
            requireString("thinkingLevel");
            break;
        case RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED:
            requireRuntimeEvent(
                value.workflowContext && typeof value.workflowContext === "object",
                event.type,
                "workflowContext must be an object",
            );
            requireRuntimeEvent(
                (typeof value.workflowContext.routingIntent === "string" &&
                    typeof value.workflowContext.complexity === "string") ||
                    (value.workflowContext.routingIntent === undefined &&
                        value.workflowContext.complexity === undefined),
                event.type,
                "routingIntent and complexity must be provided together",
            );
            if ("planName" in value.workflowContext) {
                requireRuntimeEvent(
                    typeof value.workflowContext.planName === "string",
                    event.type,
                    "workflowContext.planName must be a string",
                );
            }
            requireRuntimeEvent(
                typeof value.workflowContext.routingIntent === "string" ||
                    typeof value.workflowContext.planName === "string",
                event.type,
                "workflowContext must contain routing context or a plan name",
            );
            break;
        case RuntimeEventTypes.SESSION_RENAMED:
            requireString("name");
            break;
        case RuntimeEventTypes.INPUT_STATE_CHANGED:
            requireRuntimeEvent(typeof value.enabled === "boolean", event.type, "enabled must be boolean");
            break;
        case RuntimeEventTypes.RUNNING_TASKS_CHANGED:
            requireRuntimeEvent(Array.isArray(value.tasks), event.type, "tasks must be an array");
            break;
        case RuntimeEventTypes.QUEUED_MESSAGE_CHANGED:
            requireRuntimeEvent(
                ["queued", "consumed", "dequeued"].includes(value.status),
                event.type,
                "status is invalid",
            );
            requireRuntimeEvent(value.message && typeof value.message === "object", event.type, "message required");
            requireRuntimeEvent(typeof value.message.id === "string", event.type, "message.id required");
            requireRuntimeEvent(typeof value.message.text === "string", event.type, "message.text required");
            requireRuntimeEvent(Array.isArray(value.message.images), event.type, "message.images must be an array");
            break;
        case RuntimeEventTypes.USAGE:
            requireRuntimeEvent(value.usage && typeof value.usage === "object", event.type, "usage required");
            for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "costUsd"]) {
                requireRuntimeEvent(
                    typeof value.usage[field] === "number",
                    event.type,
                    `usage.${field} must be a number`,
                );
            }
            break;
        case RuntimeEventTypes.TERMINAL_ERROR:
            requireString("message");
            break;
        case RuntimeEventTypes.INTERACTION_REQUESTED:
        case RuntimeEventTypes.INTERACTION_RESOLVED:
        case RuntimeEventTypes.INTERACTION_CANCELED:
            requireString("interactionId");
            break;
        case RuntimeEventTypes.PLAN_REVIEW_LINK:
            for (const field of ["planName", "reviewerUrl", "message"]) requireString(field);
            break;
        case RuntimeEventTypes.ATTENTION_REQUESTED:
            requireRuntimeEvent(
                ["agentStopped", "planWritten", "userInterview"].includes(value.reason),
                event.type,
                "reason is invalid",
            );
            break;
        case RuntimeEventTypes.KEYBOARD_HELP:
            requireString("title");
            requireRuntimeEvent(value.title.trim().length > 0, event.type, "title must be non-empty");
            requireRuntimeEvent(Array.isArray(value.items), event.type, "items must be an array");
            requireRuntimeEvent(value.items.length > 0, event.type, "items must be non-empty");
            for (const item of value.items) {
                requireRuntimeEvent(item && typeof item === "object", event.type, "item must be an object");
                requireRuntimeEvent(typeof item.key === "string", event.type, "item.key must be a string");
                requireRuntimeEvent(item.key.trim().length > 0, event.type, "item.key must be non-empty");
                requireRuntimeEvent(
                    typeof item.description === "string",
                    event.type,
                    "item.description must be a string",
                );
                requireRuntimeEvent(
                    item.description.trim().length > 0,
                    event.type,
                    "item.description must be non-empty",
                );
            }
            break;
    }
    return event;
}

/**
 * Normalize provider-specific usage once at the Runtime boundary.
 * @param {unknown} value
 * @returns {RuntimeUsage}
 */
export function normalizeRuntimeUsage(value) {
    const usage = /** @type {any} */ (value || {});
    const contextWindow = Number(usage.contextWindow ?? usage.context_window ?? 0) || 0;
    const normalized = {
        inputTokens: Number(usage.input ?? usage.inputTokens ?? 0) || 0,
        outputTokens: Number(usage.output ?? usage.outputTokens ?? 0) || 0,
        cacheReadTokens: Number(usage.cacheRead ?? usage.cacheReadTokens ?? 0) || 0,
        cacheWriteTokens: Number(usage.cacheWrite ?? usage.cacheWriteTokens ?? 0) || 0,
        costUsd: Number(usage.cost?.total ?? usage.cost ?? 0) || 0,
    };
    return contextWindow > 0 ? { ...normalized, contextWindow } : normalized;
}

/**
 * Normalize tool output once at the Runtime boundary. The text projection is
 * intentionally included beside structured content so terminal consumers do
 * not flatten blocks and richer consumers do not have to recover structure.
 *
 * @param {unknown} value
 * @returns {RuntimeToolResult}
 */
export function normalizeRuntimeToolResult(value) {
    const source = value && typeof value === "object" ? /** @type {any} */ (value) : null;
    const rawContent = Array.isArray(value) ? value : Array.isArray(source?.content) ? source.content : [value];
    /** @type {RuntimeToolContentBlock[]} */
    const content = [];
    for (const rawBlock of rawContent) {
        if (typeof rawBlock === "string") {
            content.push({ type: "text", text: rawBlock });
            continue;
        }
        if (!rawBlock || typeof rawBlock !== "object") {
            if (rawBlock !== undefined && rawBlock !== null) {
                content.push({ type: "text", text: String(rawBlock) });
            }
            continue;
        }
        const block = /** @type {any} */ (rawBlock);
        if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
            content.push({ type: "image", data: block.data, mimeType: block.mimeType });
            continue;
        }
        if (typeof block.text === "string") content.push({ type: "text", text: block.text });
    }
    const details = source?.details && typeof source.details === "object"
        ? /** @type {Record<string, unknown>} */ (source.details)
        : null;
    return {
        content,
        output: content.filter((block) => block.type === "text").map((block) => block.text).join(""),
        details,
    };
}

/**
 * @param {string} sessionId
 * @param {Partial<SessionRuntimeEvent> & { type: string }} event
 * @returns {SessionRuntimeEvent}
 */
export function createSessionRuntimeEvent(sessionId, event) {
    const messageId = MESSAGE_ID_EVENT_TYPES.has(event.type) && !("messageId" in event)
        ? `${sessionId}:${event.type}:${crypto.randomUUID()}`
        : undefined;
    const level = event.type === RuntimeEventTypes.SYSTEM_STATUS && !("level" in event) ? "info" : undefined;
    const images = event.type === RuntimeEventTypes.USER_MESSAGE && !("images" in event) ? [] : undefined;
    const runtimeEvent = /** @type {SessionRuntimeEvent} */ ({
        ...event,
        ...(messageId ? { messageId } : {}),
        ...(level ? { level } : {}),
        ...(images ? { images } : {}),
        sessionId,
        timestamp: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
    });
    return assertSessionRuntimeEvent(runtimeEvent);
}

/**
 * Publish a semantic event draft through a Hosted Session's Runtime-installed
 * internal sink. SessionRuntime validates before fanout and isolates consumer
 * listener failures; producer and contract failures propagate here.
 *
 * @param {import('./hosted-session.js').HostedSession | undefined} hostedSession
 * @param {Partial<SessionRuntimeEvent> & { type: string }} event
 * @returns {boolean}
 */
export function emitHostedSessionRuntimeEvent(hostedSession, event) {
    const sink = hostedSession?.getEventSink?.();
    if (!sink) return false;
    if (typeof sink === "function") {
        sink(event);
        return true;
    }
    if (typeof sink === "object" && "emit" in sink && typeof sink.emit === "function") {
        sink.emit(event);
        return true;
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
 * @param {{ level?: "info" | "success" | "warning" | "error", header?: string }} [options]
 * @returns {boolean}
 */
export function emitSystemStatus(hostedSession, message, options = {}) {
    return emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.SYSTEM_STATUS,
        messageId: crypto.randomUUID(),
        message: String(message),
        level: options.level || "info",
        ...(options.header ? { header: options.header } : {}),
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
 * @param {{ messageKind?: "assistant" | "workflow" | "review_result", workflowMessage?: string, approved?: boolean }} [options]
 * @returns {boolean}
 */
export function emitAssistantMessage(hostedSession, agentName, text, options = {}) {
    return emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
        messageId: crypto.randomUUID(),
        delta: String(text),
        agentName,
        messageKind: options.messageKind || "assistant",
        ...(options.workflowMessage ? { workflowMessage: options.workflowMessage } : {}),
        ...(options.approved === undefined ? {} : { approved: options.approved }),
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
