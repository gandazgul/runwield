/*
 * @module shared/session/session-transcript-projection
 * Non-mutating committed-prefix Session Transcript reader and semantic projector.
 */

import { dirname, resolve } from "@std/path";
import { ACTIVE_AGENT_CUSTOM_TYPE } from "./active-agent-session.js";
import { readPersistedWorkflowContext } from "./workflow-context-session.js";
import { normalizeRuntimeToolResult, normalizeRuntimeUsage, RuntimeEventTypes } from "./session-runtime-events.js";
import { describeRuntimeTool } from "./tool-event-title.js";
import { formatTaskCompletedMarkdown, readManualQaChecklistMessage } from "./workflow-messages.js";
import { isPathInside, readCatalogSafeRootSessionLocator } from "./root-session.js";

/** @param {unknown} value @returns {string} */
function toReplayText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(toReplayText).filter(Boolean).join("\n");
    if (value === undefined || value === null) return "";
    if (typeof value !== "object") return String(value);
    const typed = /** @type {any} */ (value);
    if (typed.type === "tool_result") return "[tool result replayed]";
    if (typed.type === "tool_use" || typed.type === "toolCall") return `[tool:${typed.name || "unknown"}]`;
    if (typed.type === "text") return toReplayText(typed.text);
    if (typed.type === "thinking" || typed.type === "reasoning") {
        return toReplayText(typed.thinking ?? typed.text ?? typed.content);
    }
    if ("content" in typed) return toReplayText(typed.content);
    return "";
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
    const value =
        /** @type {{ id?: string, type?: string, timestamp?: unknown, message?: { role?: string } }} */ (entry || {});
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

/** @param {unknown} entry @param {string} eventKind @param {number} blockIndex */
function makeEventId(entry, eventKind, blockIndex) {
    const entryId = entryMessageId(entry, "entry");
    return `${entryId}:${eventKind}:${blockIndex}`;
}

/**
 * @param {string} sessionId
 * @param {unknown[]} entries
 * @returns {Array<Record<string, any> & { type: string, eventId: string }>}
 */
export function createReplayEvents(sessionId, entries) {
    /** @type {Array<Record<string, any> & { type: string, eventId: string }>} */
    const events = [];
    /** @type {string | null} */
    let replayModel = null;
    /** @type {string | null} */
    let replayThinkingLevel = null;
    let replayAgentName = "Assistant";
    /** @type {Map<string, ReturnType<typeof describeRuntimeTool>>} */
    const replayTools = new Map();
    /** @type {Map<string, number>} */
    const replayToolStartedAt = new Map();
    const finishReplayTool = (/** @type {string} */ toolCallId, /** @type {string | undefined} */ timestamp) => {
        const startedAt = replayToolStartedAt.get(toolCallId);
        replayToolStartedAt.delete(toolCallId);
        const finishedAt = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
        return startedAt === undefined || !Number.isFinite(finishedAt) ? null : Math.max(0, finishedAt - startedAt);
    };
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const value = /** @type {any} */ (entry);
        const meta = replayMeta(value);
        const common = { timestamp: normalizeReplayTimestamp(value.timestamp), _meta: meta };
        if (value.type === "message") {
            const role = value.message?.role || "unknown";
            const content = value.message?.content;
            if (role === "toolResult" || role === "tool_result") {
                const messageId = entryMessageId(value, `${sessionId}:replay-tool-result`);
                const toolCallId = value.message?.toolCallId || value.message?.tool_call_id || messageId;
                const toolName = value.message?.toolName || value.message?.tool_name || "tool";
                const toolResult = normalizeRuntimeToolResult(value.message);
                events.push({
                    ...common,
                    type: RuntimeEventTypes.TOOL_END,
                    eventId: makeEventId(value, RuntimeEventTypes.TOOL_END, 0),
                    messageId,
                    toolCallId,
                    ...(replayTools.get(toolCallId) || describeRuntimeTool(toolName, undefined)),
                    ...toolResult,
                    isError: Boolean(value.message?.isError || value.message?.is_error),
                    durationMs: finishReplayTool(toolCallId, common.timestamp),
                });
                const taskCompletedMessage =
                    toolName === "task_completed" && toolResult.details?.outcome === "task_completed" &&
                        typeof toolResult.details?.message === "string"
                        ? toolResult.details.message
                        : "";
                if (taskCompletedMessage.trim()) {
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        eventId: makeEventId(value, "task_completed", 1),
                        messageId: `${messageId}:workflow`,
                        delta: formatTaskCompletedMarkdown(taskCompletedMessage),
                        agentName: replayAgentName,
                        messageKind: "workflow",
                        workflowMessage: "task_completed",
                    });
                }
                continue;
            }
            const blocks = Array.isArray(content) ? content : [{ type: "text", text: toReplayText(content) }];
            let blockIndex = 0;
            for (const block of blocks) {
                const typed = /** @type {any} */ (block || {});
                const messageId = `${entryMessageId(value, `${sessionId}:replay`)}:${blockIndex}`;
                const eventBlockIndex = blockIndex++;
                if (typed.type === "thinking" || typed.type === "reasoning") {
                    const delta = toReplayText(typed.text || typed.thinking || typed.content || "");
                    if (delta) {
                        events.push({
                            ...common,
                            type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
                            eventId: makeEventId(value, RuntimeEventTypes.ASSISTANT_THINKING_DELTA, eventBlockIndex),
                            messageId,
                            delta,
                            agentName: replayAgentName,
                        });
                        events.push({
                            ...common,
                            type: RuntimeEventTypes.ASSISTANT_THINKING_END,
                            eventId: makeEventId(value, RuntimeEventTypes.ASSISTANT_THINKING_END, eventBlockIndex),
                            messageId,
                            agentName: replayAgentName,
                        });
                    }
                    continue;
                }
                if (typed.type === "tool_use" || typed.type === "toolCall") {
                    const toolName = typed.name || "tool";
                    const args = typed.arguments || typed.input;
                    const toolCallId = typed.id || messageId;
                    const runtimeTool = describeRuntimeTool(toolName, args);
                    replayTools.set(toolCallId, runtimeTool);
                    const startedAt = typeof common.timestamp === "string" ? Date.parse(common.timestamp) : Number.NaN;
                    if (Number.isFinite(startedAt)) replayToolStartedAt.set(toolCallId, startedAt);
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.TOOL_START,
                        eventId: makeEventId(value, RuntimeEventTypes.TOOL_START, eventBlockIndex),
                        messageId,
                        toolCallId,
                        ...runtimeTool,
                        args,
                    });
                    continue;
                }
                if (typed.type === "tool_result") {
                    const toolCallId = typed.tool_use_id || typed.toolUseId || messageId;
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.TOOL_END,
                        eventId: makeEventId(value, RuntimeEventTypes.TOOL_END, eventBlockIndex),
                        messageId,
                        toolCallId,
                        ...(replayTools.get(toolCallId) || describeRuntimeTool("tool", undefined)),
                        ...normalizeRuntimeToolResult("[tool result replayed]"),
                        isError: Boolean(typed.is_error || typed.isError),
                        durationMs: finishReplayTool(toolCallId, common.timestamp),
                    });
                    continue;
                }
                const text = toReplayText(typed.type === "text" ? typed.text : typed);
                if (!text) continue;
                if (role === "user") {
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.USER_MESSAGE,
                        eventId: makeEventId(value, RuntimeEventTypes.USER_MESSAGE, eventBlockIndex),
                        messageId,
                        text,
                        images: [],
                    });
                } else if (role === "assistant") {
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        eventId: makeEventId(value, RuntimeEventTypes.ASSISTANT_TEXT_DELTA, eventBlockIndex),
                        messageId,
                        delta: text,
                        agentName: replayAgentName,
                        messageKind: "assistant",
                    });
                } else {events.push({
                        ...common,
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        eventId: makeEventId(value, RuntimeEventTypes.SYSTEM_STATUS, eventBlockIndex),
                        messageId,
                        message: text,
                        level: "info",
                    });}
            }
            if (value.message?.usage) {
                events.push({
                    ...common,
                    type: RuntimeEventTypes.USAGE,
                    eventId: makeEventId(value, RuntimeEventTypes.USAGE, 0),
                    messageId: `${entryMessageId(value, `${sessionId}:replay`)}:usage`,
                    usage: normalizeRuntimeUsage(value.message.usage),
                });
            }
            continue;
        }
        if (value.type === "compaction" || value.type === "branch_summary") {
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                eventId: makeEventId(value, value.type, 0),
                messageId: entryMessageId(value, value.type),
                message: value.summary || `${value.type} replayed`,
                level: "info",
            });
            continue;
        }
        if (value.type === "model_change") {
            const nextModel = [value.provider, value.modelId].filter(Boolean).join("/");
            if (replayModel !== null && nextModel && nextModel !== replayModel) {
                events.push({
                    ...common,
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    eventId: makeEventId(value, RuntimeEventTypes.MODEL_CHANGED, 0),
                    messageId: entryMessageId(value, value.type),
                    message: `Model changed: ${nextModel}`,
                    level: "info",
                });
            }
            replayModel = nextModel;
            continue;
        }
        if (value.type === "thinking_level_change") {
            const nextThinkingLevel = value.thinkingLevel || "unknown";
            if (replayThinkingLevel !== null && nextThinkingLevel && nextThinkingLevel !== replayThinkingLevel) {
                events.push({
                    ...common,
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    eventId: makeEventId(value, RuntimeEventTypes.THINKING_LEVEL_CHANGED, 0),
                    messageId: entryMessageId(value, value.type),
                    message: `Thinking level changed: ${nextThinkingLevel}`,
                    level: "info",
                });
            }
            replayThinkingLevel = nextThinkingLevel;
            continue;
        }
        if (value.type === "custom" && value.customType === ACTIVE_AGENT_CUSTOM_TYPE) {
            const agentName = typeof value.data?.agentName === "string" ? value.data.agentName.trim() : "";
            if (agentName) replayAgentName = agentName;
            continue;
        }
        const manualQaChecklist = readManualQaChecklistMessage(value);
        if (manualQaChecklist) {
            events.push({
                ...common,
                type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                eventId: makeEventId(value, "manual_qa_checklist", 0),
                messageId: entryMessageId(value, `${sessionId}:manual-qa`),
                delta: manualQaChecklist.text,
                agentName: manualQaChecklist.agentName,
                messageKind: "workflow",
                workflowMessage: "manual_qa_checklist",
            });
        }
    }
    return events;
}

/** @param {Uint8Array} bytes */
export async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} path
 * @param {number} byteLength
 */
async function readPrefixBytes(path, byteLength) {
    const file = await Deno.open(path, { read: true });
    try {
        const stat = await file.stat();
        if (stat.size < byteLength) throw new Error("Committed transcript prefix is shorter than published evidence");
        const bytes = new Uint8Array(byteLength);
        let offset = 0;
        while (offset < byteLength) {
            const read = await file.read(bytes.subarray(offset));
            if (read === null) break;
            offset += read;
        }
        if (offset !== byteLength) throw new Error("Unable to read committed transcript prefix");
        return bytes;
    } finally {
        file.close();
    }
}

/** @param {Uint8Array} bytes */
function parseJsonlPrefix(bytes) {
    const text = new TextDecoder().decode(bytes);
    if (text.length > 0 && !text.endsWith("\n")) {
        throw new Error("Committed transcript prefix must end at a JSONL boundary");
    }
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** @param {unknown[]} entries */
function terminalEntryId(entries) {
    const last = entries.at(-1);
    return last && typeof last === "object" && typeof /** @type {any} */ (last).id === "string"
        ? /** @type {any} */ (last).id
        : null;
}

/**
 * @param {{ transcriptPath: string, transcriptCwd: string, byteLength?: number }} options
 */
export async function captureTranscriptEvidence(options) {
    const path = resolve(options.transcriptPath);
    const stat = await Deno.stat(path);
    const byteLength = options.byteLength ?? stat.size;
    const bytes = await readPrefixBytes(path, byteLength);
    const entries = parseJsonlPrefix(bytes);
    return {
        byteLength,
        terminalEntryId: terminalEntryId(entries),
        digestHex: await sha256Hex(bytes),
        entries,
    };
}

/**
 * @param {{ sessionPath: string, sessionDir: string, cwd: string, generation: number, byteLength: number, digestHex: string, terminalEntryId: string | null, runtimeSessionId?: string, cursorEventId?: string, limit?: number }} options
 */
/**
 * @param {{ events: Array<Record<string, any> & { eventId: string }>, cursorEventId?: string | null, limit?: number }} options
 */
export function selectProjectedEventsAfterCursor(options) {
    const events = Array.isArray(options.events) ? options.events : [];
    let startIndex = 0;
    if (options.cursorEventId) {
        const cursorIndex = events.findIndex((event) => event.eventId === options.cursorEventId);
        if (cursorIndex === -1) {
            const error = new Error("Timeline cursor is not present in the requested generation");
            error.name = "ProjectionContinuityError";
            throw error;
        }
        startIndex = cursorIndex + 1;
    }
    const limit = Math.max(1, Math.min(500, options.limit || 200));
    const selected = events.slice(startIndex, startIndex + limit);
    return {
        events: selected,
        nextCursor: selected.length > 0 ? selected[selected.length - 1].eventId : options.cursorEventId || null,
        complete: startIndex + selected.length >= events.length,
    };
}

/** @param {unknown} error */
export function toProjectionFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && error.name === "ProjectionContinuityError"
        ? "cursor_missing"
        : message.includes("digest")
        ? "evidence_mismatch"
        : message.includes("terminal")
        ? "terminal_mismatch"
        : message.includes("outside")
        ? "invalid_transcript_path"
        : message.includes("JSON")
        ? "malformed_committed_prefix"
        : "projection_failed";
    return { ok: false, state: "degraded", code, message: "Committed transcript projection is unavailable." };
}

/**
 * @param {{ cwd: string, sessionDir: string, sessionPath: string, runtimeSessionId?: string, generation: number, byteLength: number, terminalEntryId: string | null, digestHex: string, cursorEventId?: string | null, limit?: number }} options
 */
export async function projectCommittedTranscript(options) {
    const sessionPath = resolve(options.sessionPath);
    if (!isPathInside(sessionPath, options.sessionDir)) {
        throw new Error("Committed transcript path is outside session directory");
    }
    await readCatalogSafeRootSessionLocator({ cwd: options.cwd, sessionDir: options.sessionDir, sessionPath });
    const evidence = await captureTranscriptEvidence({
        transcriptPath: sessionPath,
        transcriptCwd: options.cwd,
        byteLength: options.byteLength,
    });
    if (evidence.digestHex !== options.digestHex) {
        throw new Error("Committed transcript digest does not match published evidence");
    }
    if (evidence.terminalEntryId !== options.terminalEntryId) {
        throw new Error("Committed transcript terminal entry does not match published evidence");
    }
    const allEvents = createReplayEvents(options.runtimeSessionId || "committed", evidence.entries);
    const selected = selectProjectedEventsAfterCursor({
        events: allEvents,
        cursorEventId: options.cursorEventId,
        limit: options.limit,
    });
    return {
        generation: options.generation,
        events: selected.events,
        nextCursor: selected.nextCursor,
        complete: selected.complete,
        snapshot: summarizeProjectedEntries(evidence.entries),
    };
}

/**
 * @param {string} transcriptPath
 */
export async function syncTranscriptFileAndParent(transcriptPath) {
    const file = await Deno.open(transcriptPath, { read: true });
    try {
        await file.sync();
    } finally {
        file.close();
    }
    try {
        const dir = await Deno.open(dirname(transcriptPath), { read: true });
        try {
            await dir.sync();
        } finally {
            dir.close();
        }
    } catch {
        // Directory fsync is not available on every platform/filesystem. File fsync is still required.
    }
}

/** @param {unknown[]} entries */
export function summarizeProjectedEntries(entries) {
    let activeAgent = null;
    let name = null;
    let workflowContext = null;
    let model = null;
    let provider = null;
    let thinkingLevel = null;
    let attention = null;
    for (const entry of entries) {
        const value = /** @type {any} */ (entry || {});
        if (value.type === "session" && typeof value.name === "string") name = value.name;
        if (value.type === "custom" && value.customType === ACTIVE_AGENT_CUSTOM_TYPE) {
            if (typeof value.data?.agentName === "string") activeAgent = value.data.agentName;
        }
        if (value.type === "model_change") {
            if (typeof value.modelId === "string") model = value.modelId;
            if (typeof value.provider === "string") provider = value.provider;
        }
        if (value.type === "thinking_level_change" && typeof value.thinkingLevel === "string") {
            thinkingLevel = value.thinkingLevel;
        }
        if (value.type === "custom" && value.customType === "runwield.attention") {
            const reason = typeof value.data?.reason === "string" ? value.data.reason : "agentStopped";
            const agentName = typeof value.data?.agentName === "string" ? value.data.agentName : activeAgent;
            attention = { reason, agentName };
        }
        const maybeWorkflow = readPersistedWorkflowContext(/** @type {any} */ ({ getEntries: () => [value] }));
        if (maybeWorkflow) workflowContext = maybeWorkflow;
    }
    return { name, activeAgent, model, provider, thinkingLevel, workflowContext, attention };
}
