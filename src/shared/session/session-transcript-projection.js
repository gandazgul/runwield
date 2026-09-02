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
import { namedInvocationDisplayText, namedInvocationImageReferences } from "./named-invocation.ts";

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

/** @param {unknown} entry @param {string | null} [segmentId] */
function replayMeta(entry, segmentId = null) {
    const value =
        /** @type {{ id?: string, type?: string, timestamp?: unknown, message?: { role?: string } }} */ (entry || {});
    const timestamp = normalizeReplayTimestamp(value.timestamp);
    return {
        replay: true,
        ...(value.id ? { entryId: segmentId ? `${segmentId}:${value.id}` : value.id } : {}),
        ...(value.type ? { entryType: value.type } : {}),
        ...(value.message?.role ? { role: value.message.role } : {}),
        ...(timestamp ? { timestamp } : {}),
    };
}

/** @param {unknown} entry @param {string} fallback @param {string | null} [segmentId] */
function entryMessageId(entry, fallback, segmentId = null) {
    const value = /** @type {{ id?: string }} */ (entry || {});
    const id = value.id || fallback;
    return segmentId ? `${segmentId}:${id}` : id;
}

/** @param {unknown} entry @param {string} eventKind @param {number} blockIndex @param {string | null} [segmentId] */
function makeEventId(entry, eventKind, blockIndex, segmentId = null) {
    const entryId = entryMessageId(entry, "entry", segmentId);
    return `${entryId}:${eventKind}:${blockIndex}`;
}

/** @param {string} kind @returns {"warning" | "error"} */
function claudeBackendStatusLevel(kind) {
    return kind === "canceled" || kind === "bridge_disconnected" ? "warning" : "error";
}

/**
 * @param {string} sessionId
 * @param {unknown[]} entries
 * @param {{ segmentId?: string | null }} [options]
 * @returns {Array<Record<string, any> & { type: string, eventId: string }>}
 */
export function createReplayEvents(sessionId, entries, options = {}) {
    const segmentId = options.segmentId || null;
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
    let skipNextCompactNamedInvocation = "";
    const finishReplayTool = (/** @type {string} */ toolCallId, /** @type {string | undefined} */ timestamp) => {
        const startedAt = replayToolStartedAt.get(toolCallId);
        replayToolStartedAt.delete(toolCallId);
        const finishedAt = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
        return startedAt === undefined || !Number.isFinite(finishedAt) ? null : Math.max(0, finishedAt - startedAt);
    };
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const value = /** @type {any} */ (entry);
        const namedInvocationText = namedInvocationDisplayText(value);
        if (namedInvocationText) {
            const namedInvocationImages = namedInvocationImageReferences(value);
            const meta = replayMeta(value, segmentId);
            events.push({
                timestamp: normalizeReplayTimestamp(value.timestamp),
                _meta: meta,
                type: RuntimeEventTypes.USER_MESSAGE,
                eventId: makeEventId(value, RuntimeEventTypes.USER_MESSAGE, 0, segmentId),
                messageId: entryMessageId(value, `${sessionId}:named-invocation`, segmentId),
                text: namedInvocationText,
                images: namedInvocationImages,
            });
            skipNextCompactNamedInvocation = namedInvocationText;
            continue;
        }
        const meta = replayMeta(value, segmentId);
        const common = { timestamp: normalizeReplayTimestamp(value.timestamp), _meta: meta };
        if (value.type === "message") {
            const role = value.message?.role || "unknown";
            const content = value.message?.content;
            if (role === "toolResult" || role === "tool_result") {
                const messageId = entryMessageId(value, `${sessionId}:replay-tool-result`, segmentId);
                const toolCallId = value.message?.toolCallId || value.message?.tool_call_id || messageId;
                const toolName = value.message?.toolName || value.message?.tool_name || "tool";
                const toolResult = normalizeRuntimeToolResult(value.message);
                events.push({
                    ...common,
                    type: RuntimeEventTypes.TOOL_END,
                    eventId: makeEventId(value, RuntimeEventTypes.TOOL_END, 0, segmentId),
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
                        eventId: makeEventId(value, "task_completed", 1, segmentId),
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
                const messageId = `${entryMessageId(value, `${sessionId}:replay`, segmentId)}:${blockIndex}`;
                const eventBlockIndex = blockIndex++;
                if (typed.type === "thinking" || typed.type === "reasoning") {
                    const delta = toReplayText(typed.text || typed.thinking || typed.content || "");
                    if (delta) {
                        events.push({
                            ...common,
                            type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
                            eventId: makeEventId(
                                value,
                                RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
                                eventBlockIndex,
                                segmentId,
                            ),
                            messageId,
                            delta,
                            agentName: replayAgentName,
                        });
                        events.push({
                            ...common,
                            type: RuntimeEventTypes.ASSISTANT_THINKING_END,
                            eventId: makeEventId(
                                value,
                                RuntimeEventTypes.ASSISTANT_THINKING_END,
                                eventBlockIndex,
                                segmentId,
                            ),
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
                        eventId: makeEventId(value, RuntimeEventTypes.TOOL_START, eventBlockIndex, segmentId),
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
                        eventId: makeEventId(value, RuntimeEventTypes.TOOL_END, eventBlockIndex, segmentId),
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
                    if (skipNextCompactNamedInvocation && text === skipNextCompactNamedInvocation) {
                        skipNextCompactNamedInvocation = "";
                        continue;
                    }
                    skipNextCompactNamedInvocation = "";
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.USER_MESSAGE,
                        eventId: makeEventId(value, RuntimeEventTypes.USER_MESSAGE, eventBlockIndex, segmentId),
                        messageId,
                        text,
                        images: [],
                    });
                } else if (role === "assistant") {
                    events.push({
                        ...common,
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        eventId: makeEventId(value, RuntimeEventTypes.ASSISTANT_TEXT_DELTA, eventBlockIndex, segmentId),
                        messageId,
                        delta: text,
                        agentName: replayAgentName,
                        messageKind: "assistant",
                    });
                } else {events.push({
                        ...common,
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        eventId: makeEventId(value, RuntimeEventTypes.SYSTEM_STATUS, eventBlockIndex, segmentId),
                        messageId,
                        message: text,
                        level: "info",
                    });}
            }
            if (value.message?.usage) {
                events.push({
                    ...common,
                    type: RuntimeEventTypes.USAGE,
                    eventId: makeEventId(value, RuntimeEventTypes.USAGE, 0, segmentId),
                    messageId: `${entryMessageId(value, `${sessionId}:replay`, segmentId)}:usage`,
                    usage: normalizeRuntimeUsage(value.message.usage),
                });
            }
            continue;
        }
        if (value.type === "compaction" || value.type === "branch_summary") {
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                eventId: makeEventId(value, value.type, 0, segmentId),
                messageId: entryMessageId(value, value.type, segmentId),
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
                    eventId: makeEventId(value, RuntimeEventTypes.MODEL_CHANGED, 0, segmentId),
                    messageId: entryMessageId(value, value.type, segmentId),
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
                    eventId: makeEventId(value, RuntimeEventTypes.THINKING_LEVEL_CHANGED, 0, segmentId),
                    messageId: entryMessageId(value, value.type, segmentId),
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
        if (value.type === "custom" && value.customType === "runwield.backend_status") {
            const kind = typeof value.data?.kind === "string" ? value.data.kind : "non_zero_exit";
            const message = typeof value.data?.message === "string" ? value.data.message : "Claude CLI backend status.";
            events.push({
                ...common,
                type: RuntimeEventTypes.SYSTEM_STATUS,
                eventId: makeEventId(value, RuntimeEventTypes.SYSTEM_STATUS, 0, segmentId),
                messageId: entryMessageId(value, `${sessionId}:claude-backend-status`, segmentId),
                message,
                level: claudeBackendStatusLevel(kind),
            });
            continue;
        }
        const manualQaChecklist = readManualQaChecklistMessage(value);
        if (manualQaChecklist) {
            events.push({
                ...common,
                type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                eventId: makeEventId(value, "manual_qa_checklist", 0, segmentId),
                messageId: entryMessageId(value, `${sessionId}:manual-qa`, segmentId),
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
 * @typedef {Object} ResumableTranscriptContentBlock
 * @property {string} [type]
 * @property {string} [text]
 */

/**
 * @typedef {Object} ResumableTranscriptMessage
 * @property {string} [role]
 * @property {string | ResumableTranscriptContentBlock[]} [content]
 */

/**
 * @typedef {Object} ResumableTranscriptEntry
 * @property {string} [type]
 * @property {ResumableTranscriptMessage} [message]
 */

/**
 * @typedef {Object} ResumableTranscriptSummary
 * @property {number} messageCount
 * @property {string} [firstMessage]
 */

/**
 * Extract the small amount of conversation metadata needed by the resume
 * picker from an already parsed transcript.
 *
 * @param {unknown[]} entries
 * @returns {ResumableTranscriptSummary}
 */
export function summarizeResumableTranscript(entries) {
    const typedEntries = entries.map((entry) => /** @type {ResumableTranscriptEntry} */ (entry));
    const messages = typedEntries.filter((entry) => entry?.type === "message");
    const firstUser = messages.find((entry) => entry.message?.role === "user");
    const firstContent = firstUser?.message?.content;
    const firstMessage = typeof firstContent === "string"
        ? firstContent
        : Array.isArray(firstContent)
        ? firstContent.find((block) => block?.type === "text")?.text
        : undefined;
    return { messageCount: messages.length, firstMessage };
}

/**
 * @param {{ transcriptPath: string, transcriptCwd: string, committedGeneration: { generation: number, byteLength: number, terminalEntryId: string | null, digestHex: string } }} options
 */
export async function validateExpiredControlTranscriptEvidence(options) {
    const committed = options.committedGeneration;
    const committedEvidence = await captureTranscriptEvidence({
        transcriptPath: options.transcriptPath,
        transcriptCwd: options.transcriptCwd,
        byteLength: committed.byteLength,
    });
    if (committedEvidence.digestHex !== committed.digestHex) {
        throw new Error("Committed transcript digest does not match published evidence");
    }
    if (committedEvidence.terminalEntryId !== committed.terminalEntryId) {
        throw new Error("Committed transcript terminal entry does not match published evidence");
    }
    const fullEvidence = await captureTranscriptEvidence({
        transcriptPath: options.transcriptPath,
        transcriptCwd: options.transcriptCwd,
    });
    if (fullEvidence.byteLength < committed.byteLength) throw new Error("Current transcript was truncated");
    return {
        generation: fullEvidence.byteLength === committed.byteLength ? committed.generation : committed.generation + 1,
        byteLength: fullEvidence.byteLength,
        terminalEntryId: fullEvidence.terminalEntryId,
        digestHex: fullEvidence.digestHex,
    };
}

/**
 * @param {{ sessionPath: string, sessionDir: string, cwd: string, generation: number, byteLength: number, digestHex: string, terminalEntryId: string | null, runtimeSessionId?: string, cursorEventId?: string, cursorEventOrdinal?: number | null, limit?: number }} options
 */
/**
 * @param {{ events: Array<Record<string, any> & { eventId: string }>, cursorEventId?: string | null, cursorEventOrdinal?: number | null, limit?: number }} options
 */
export function selectProjectedEventsAfterCursor(options) {
    const events = Array.isArray(options.events) ? options.events : [];
    let startIndex = 0;
    if (options.cursorEventId) {
        const cursorEventOrdinal = Number.isInteger(options.cursorEventOrdinal)
            ? Number(options.cursorEventOrdinal)
            : null;
        const expectedIndex = cursorEventOrdinal !== null && cursorEventOrdinal >= 0 ? cursorEventOrdinal : null;
        if (expectedIndex !== null) {
            if (events[expectedIndex]?.eventId !== options.cursorEventId) {
                const error = new Error(
                    "Timeline cursor is not a prefix-continuous ancestor of the requested generation",
                );
                error.name = "ProjectionContinuityError";
                throw error;
            }
            startIndex = expectedIndex + 1;
        } else {
            const cursorIndex = events.findIndex((event) => event.eventId === options.cursorEventId);
            if (cursorIndex === -1) {
                const error = new Error("Timeline cursor is not present in the requested generation");
                error.name = "ProjectionContinuityError";
                throw error;
            }
            startIndex = cursorIndex + 1;
        }
    }
    const limit = Math.max(1, Math.min(500, options.limit || 200));
    const selected = events.slice(startIndex, startIndex + limit);
    return {
        events: selected,
        nextCursor: selected.length > 0 ? selected[selected.length - 1].eventId : options.cursorEventId || null,
        nextCursorOrdinal: selected.length > 0 ? startIndex + selected.length - 1 : options.cursorEventOrdinal ?? null,
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
    return {
        ok: false,
        state: "degraded",
        code,
        message: message === "Committed generation references an ambiguous segment lineage"
            ? message
            : "Committed transcript projection is unavailable.",
    };
}

/**
 * @param {{ cwd: string, sessionDir: string, sessionPath: string, runtimeSessionId?: string, generation: number, byteLength: number, terminalEntryId: string | null, digestHex: string, cursorEventId?: string | null, cursorEventOrdinal?: number | null, limit?: number }} options
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
        cursorEventOrdinal: options.cursorEventOrdinal,
        limit: options.limit,
    });
    return {
        generation: options.generation,
        events: selected.events,
        nextCursor: selected.nextCursor,
        nextCursorOrdinal: selected.nextCursorOrdinal,
        complete: selected.complete,
        snapshot: summarizeProjectedEntries(evidence.entries),
    };
}

/**
 * Extract facts whose authority comes from the already-verified committed
 * transcript prefix. Callers may use these only in phases where committed JSONL
 * is the active source of truth, such as idle continuation gates or hydration.
 *
 * @param {{ snapshot?: Record<string, any> | null } | null | undefined} projection
 * @returns {{ activeAgent: string | null, workflowContext: unknown | null, model: string | null, provider: string | null, thinkingLevel: string | null }}
 */
export function getCommittedTranscriptAuthorityFacts(projection) {
    const snapshot = projection?.snapshot || {};
    return {
        activeAgent: typeof snapshot.activeAgent === "string" && snapshot.activeAgent ? snapshot.activeAgent : null,
        workflowContext: snapshot.workflowContext || null,
        model: typeof snapshot.model === "string" && snapshot.model ? snapshot.model : null,
        provider: typeof snapshot.provider === "string" && snapshot.provider ? snapshot.provider : null,
        thinkingLevel: typeof snapshot.thinkingLevel === "string" && snapshot.thinkingLevel
            ? snapshot.thinkingLevel
            : null,
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
            if (typeof value.data?.agentName === "string") activeAgent = value.data.agentName.trim().toLowerCase();
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
            attention = {
                eventId: makeEventId(value, RuntimeEventTypes.ATTENTION_REQUESTED, 0),
                reason,
                agentName,
            };
        }
        const maybeWorkflow = readPersistedWorkflowContext(/** @type {any} */ ({ getEntries: () => [value] }));
        if (maybeWorkflow) workflowContext = maybeWorkflow;
    }
    return { name, activeAgent, model, provider, thinkingLevel, workflowContext, attention };
}

/** @param {unknown} value @returns {string} */
function projectedDisplayText(value) {
    const namedInvocationText = typeof value === "object" && value !== null
        ? namedInvocationDisplayText(/** @type {any} */ (value))
        : "";
    if (namedInvocationText) return namedInvocationText;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(projectedDisplayText).filter(Boolean).join("\n");
    if (value === null || value === undefined) return "";
    if (typeof value !== "object") return String(value);
    const typed = /** @type {any} */ (value);
    if (typed.type === "text") return projectedDisplayText(typed.text);
    if (typed.type === "tool_use") return `[tool_use:${typed.name || "unknown"}] ${JSON.stringify(typed.input || {})}`;
    if (typed.type === "tool_result") return `[tool_result] ${projectedDisplayText(typed.content || "")}`;
    if ("content" in typed) return projectedDisplayText(typed.content);
    return "";
}

/** @param {unknown[]} entries */
export function inspectProjectedTranscript(entries) {
    const summary = summarizeProjectedEntries(entries);
    let messageCount = 0;
    let estimatedTokens = 0;
    for (const entry of entries) {
        const value = /** @type {any} */ (entry || {});
        if (value.type !== "message" || !value.message) continue;
        messageCount++;
        estimatedTokens += projectedDisplayText(value.message.content).split(/\s+/).filter(Boolean).length;
    }
    return {
        estimatedTokens,
        messageCount,
        model: summary.model || summary.provider
            ? { provider: summary.provider || "", modelId: summary.model || "" }
            : null,
    };
}

/** @param {string} text @returns {number} */
function estimateProjectedTextTokens(text) {
    return text ? Math.ceil(text.length / 4) : 0;
}

/** @param {unknown[]} entries @param {{ sessionId: string, cwd: string, transcriptPath?: string }} options */
export function buildProjectedSessionInfo(entries, options) {
    const summary = summarizeProjectedEntries(entries);
    const info = {
        name: summary.name || "",
        file: options.transcriptPath || "Committed transcript",
        persistedId: options.sessionId,
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
        const value = /** @type {any} */ (entry || {});
        if (value.type === "compaction") info.compactionCount++;
        if (value.type !== "message" || !value.message) continue;
        const message = value.message;
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
            info.inputTokens += usage.inputTokens;
            info.outputTokens += usage.outputTokens;
            info.cacheReadTokens += usage.cacheReadTokens;
            info.cacheWriteTokens += usage.cacheWriteTokens;
        }
    }
    return info;
}

/**
 * @param {unknown[]} entries
 * @returns {import('./session-context-report.js').SessionContextProjection}
 */
export function buildProjectedSessionContextProjection(entries) {
    let tokens = 0;
    for (const entry of entries) {
        const value = /** @type {{ type?: string, message?: { content?: unknown } }} */ (entry || {});
        if (value.type !== "message" || !value.message) continue;
        tokens += estimateProjectedTextTokens(projectedDisplayText(value.message.content));
    }
    const categories = tokens > 0
        ? [{
            id: /** @type {import('./session-context-report.js').ContextCategoryId} */ ("conversation_overhead"),
            label: "Committed conversation",
            tokens,
            items: [],
        }]
        : [];
    return {
        categories,
        instructionFiles: [],
        skills: [],
        staticTokens: 0,
    };
}

/** @param {unknown[]} entries */
export function getProjectedLastAssistantText(entries) {
    for (let index = entries.length - 1; index >= 0; index--) {
        const value = /** @type {any} */ (entries[index] || {});
        if (value.type !== "message" || value.message?.role !== "assistant") continue;
        const text = projectedDisplayText(value.message.content).trim();
        if (text) return text;
    }
    return null;
}

/** @param {unknown[]} entries @param {{ cwd: string, sessionId: string }} options @param {string} outputPath */
export async function exportProjectedTranscript(entries, options, outputPath) {
    const filePath = resolve(outputPath);
    const parent = dirname(filePath);
    await Deno.mkdir(parent, { recursive: true });
    if (filePath.toLowerCase().endsWith(".jsonl")) {
        const lines = entries.map((entry) => JSON.stringify(entry));
        await Deno.writeTextFile(filePath, `${lines.join("\n")}\n`);
        return filePath;
    }
    const escapeHtml = (/** @type {string} */ value) =>
        value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    let skipNextNamedInvocation = "";
    const rows = entries.flatMap((entry) => {
        const value = /** @type {any} */ (entry || {});
        const namedInvocationText = namedInvocationDisplayText(value);
        const displayText = namedInvocationText ||
            projectedDisplayText(value.message?.content ?? value.content ?? JSON.stringify(value));
        if (
            skipNextNamedInvocation && value.type === "message" && value.message?.role === "user" &&
            displayText === skipNextNamedInvocation
        ) {
            skipNextNamedInvocation = "";
            return [];
        }
        skipNextNamedInvocation = namedInvocationText || "";
        const text = escapeHtml(displayText);
        return [
            `<section class="entry"><header>${escapeHtml(value.type || "entry")}</header><pre>${text}</pre></section>`,
        ];
    }).join("\n");
    await Deno.writeTextFile(
        filePath,
        [
            "<!doctype html>",
            "<html lang='en'><head><meta charset='utf-8' />",
            `<title>RunWield Session Export — ${escapeHtml(options.sessionId)}</title></head><body>`,
            `<h1>RunWield Session Export — ${escapeHtml(options.sessionId)}</h1>`,
            `<div>cwd: ${escapeHtml(options.cwd)}</div>`,
            rows,
            "</body></html>",
            "",
        ].join("\n"),
    );
    return filePath;
}
