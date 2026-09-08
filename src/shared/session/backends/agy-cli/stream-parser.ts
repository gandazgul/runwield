import type { AgyCliBackendStatusKind } from "./failure.ts";
import { isAgyAuthFailure, isAgyMcpUnavailable, isAgyPermissionDenied } from "./failure.ts";

export interface AgyCliUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface AgyCliMetadata {
    agent?: string;
    model?: string;
    sessionId?: string;
    usage: AgyCliUsage;
    toolInfoCount: number;
    status: string;
    errorText: string;
    deniedActions: boolean;
    authFailed: boolean;
    permissionDenied: boolean;
    mcpUnavailable: boolean;
}

export interface AgyCliParseResult {
    text: string;
    rawResultText: string;
    metadata: AgyCliMetadata;
}

export interface AgyCliAssistantDelta {
    text: string;
}

export interface AgyCliStreamCallbacks {
    onDelta?: (delta: AgyCliAssistantDelta) => void;
}

type JsonScalar = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonRecord {
    [key: string]: JsonValue;
}
type JsonValue = JsonScalar | JsonArray | JsonRecord;

type AgyCliStreamEvent =
    | { kind: "init"; agent?: string; model?: string; sessionId?: string }
    | { kind: "text_delta"; text: string }
    | { kind: "tool_info" }
    | {
        kind: "result";
        text: string;
        usage: AgyCliUsage;
        model?: string;
        sessionId?: string;
        status: string;
        errorText: string;
        deniedActions: boolean;
    };

const emptyUsage: AgyCliUsage = { inputTokens: 0, outputTokens: 0 };

export class AgyCliStreamError extends Error {
    readonly kind: Extract<AgyCliBackendStatusKind, "malformed_stream" | "empty_result" | "result_mismatch">;

    constructor(kind: AgyCliStreamError["kind"], message: string) {
        super(message);
        this.name = "AgyCliStreamError";
        this.kind = kind;
    }
}

function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: JsonValue | undefined): string {
    return typeof value === "string" ? value : "";
}

function asNumber(value: JsonValue | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsage(value: JsonValue | undefined): AgyCliUsage {
    const usage = isJsonRecord(value) ? value : {};
    return {
        inputTokens: asNumber(usage.input_tokens) || asNumber(usage.inputTokens) || asNumber(usage.input),
        outputTokens: asNumber(usage.output_tokens) || asNumber(usage.outputTokens) || asNumber(usage.output),
    };
}

function readTextDelta(record: JsonRecord): string {
    const direct = asString(record.text) || asString(record.text_delta) || asString(record.delta);
    if (direct) return direct;
    const delta = isJsonRecord(record.delta) ? record.delta : undefined;
    return asString(delta?.text) || asString(delta?.text_delta);
}

function readResultText(record: JsonRecord): string {
    const direct = asString(record.result) || asString(record.response) || asString(record.text) ||
        asString(record.output);
    if (direct) return direct;
    const result = isJsonRecord(record.result) ? record.result : undefined;
    return asString(result?.response) || asString(result?.text) || asString(result?.output);
}

function readStatus(record: JsonRecord, result: JsonRecord): string {
    return (asString(result.status) || asString(record.status) || asString(result.outcome) ||
        asString(record.outcome) ||
        "success").toLowerCase();
}

function readErrorText(record: JsonRecord, result: JsonRecord): string {
    const direct = asString(result.error) || asString(record.error) || asString(result.message) ||
        asString(record.message);
    if (direct) return direct;
    const error = isJsonRecord(result.error) ? result.error : isJsonRecord(record.error) ? record.error : undefined;
    return asString(error?.message) || asString(error?.text);
}

function hasDeniedActions(record: JsonRecord, result: JsonRecord): boolean {
    return Array.isArray(record.denied_actions) || Array.isArray(result.denied_actions) ||
        Array.isArray(record.deniedActions) || Array.isArray(result.deniedActions);
}

export function parseAgyCliJsonLine(line: string): AgyCliStreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: JsonValue;
    try {
        parsed = JSON.parse(trimmed) as JsonValue;
    } catch {
        throw new AgyCliStreamError("malformed_stream", "Agy CLI emitted malformed JSON output");
    }
    if (!isJsonRecord(parsed)) return null;
    const type = asString(parsed.type) || asString(parsed.event);
    if (type === "init") {
        const init = isJsonRecord(parsed.init) ? parsed.init : parsed;
        return {
            kind: "init",
            agent: asString(init.agent) || undefined,
            model: asString(init.model) || asString(parsed.model) || undefined,
            sessionId: asString(parsed.conversation_id) || asString(init.conversation_id) ||
                asString(init.session_id) ||
                asString(init.sessionId) || undefined,
        };
    }
    if (type === "step_update") {
        const updateType = asString(parsed.update_type) || asString(parsed.kind) || asString(parsed.step_update);
        if (updateType === "text_delta") {
            const text = readTextDelta(parsed);
            return text ? { kind: "text_delta", text } : null;
        }
        if (updateType === "tool_info") return { kind: "tool_info" };
        const nested = isJsonRecord(parsed.step_update) ? parsed.step_update : undefined;
        if (nested) {
            const nestedType = asString(nested.type) || asString(nested.update_type) || asString(nested.kind);
            if (nestedType === "text_delta" || asString(nested.step_type) === "agent_response") {
                const text = readTextDelta(nested);
                return text ? { kind: "text_delta", text } : null;
            }
            if (nestedType === "tool_info") return { kind: "tool_info" };
        }
        return null;
    }
    if (type === "result") {
        const result = isJsonRecord(parsed.result) ? parsed.result : parsed;
        const errorText = readErrorText(parsed, result);
        return {
            kind: "result",
            text: readResultText(parsed),
            usage: readUsage(result.usage || parsed.usage),
            model: asString(result.model) || asString(parsed.model) || undefined,
            sessionId: asString(parsed.conversation_id) || asString(result.conversation_id) ||
                asString(result.session_id) ||
                asString(result.sessionId) || undefined,
            status: readStatus(parsed, result),
            errorText,
            deniedActions: hasDeniedActions(parsed, result),
        };
    }
    return null;
}

export async function parseAgyCliStream(
    stream: ReadableStream<Uint8Array>,
    callbacks: AgyCliStreamCallbacks = {},
): Promise<AgyCliParseResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let visibleText = "";
    let rawResultText = "";
    let sawResult = false;
    let agent: string | undefined;
    let model: string | undefined;
    let sessionId: string | undefined;
    let usage = emptyUsage;
    let status = "success";
    let errorText = "";
    let deniedActions = false;
    let toolInfoCount = 0;
    let streamError: AgyCliStreamError | null = null;

    const applyEvent = (event: AgyCliStreamEvent) => {
        if (event.kind === "init") {
            if (event.agent) agent = event.agent;
            if (event.model) model = event.model;
            if (event.sessionId) sessionId = event.sessionId;
            return;
        }
        if (event.kind === "text_delta") {
            visibleText += event.text;
            callbacks.onDelta?.({ text: event.text });
            return;
        }
        if (event.kind === "tool_info") {
            toolInfoCount += 1;
            return;
        }
        sawResult = true;
        rawResultText = event.text;
        usage = event.usage;
        status = event.status;
        errorText = event.errorText;
        deniedActions = event.deniedActions;
        if (event.model) model = event.model;
        if (event.sessionId) sessionId = event.sessionId;
    };

    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() || "";
        for (const line of lines) {
            let event: AgyCliStreamEvent | null = null;
            try {
                event = parseAgyCliJsonLine(line);
            } catch (error) {
                if (!streamError) {
                    streamError = error instanceof AgyCliStreamError
                        ? error
                        : new AgyCliStreamError("malformed_stream", String(error));
                }
            }
            if (event) applyEvent(event);
        }
    }
    buffered += decoder.decode();
    if (buffered.trim()) {
        let event: AgyCliStreamEvent | null = null;
        try {
            event = parseAgyCliJsonLine(buffered);
        } catch (error) {
            if (!streamError) {
                streamError = error instanceof AgyCliStreamError
                    ? error
                    : new AgyCliStreamError("malformed_stream", String(error));
            }
        }
        if (event) applyEvent(event);
    }
    if (streamError) throw streamError;
    if (!sawResult) {
        if (!visibleText) throw new AgyCliStreamError("empty_result", "Agy CLI stream ended without output");
        throw new AgyCliStreamError("empty_result", "Agy CLI stream ended without a terminal result");
    }
    const successfulStatus = !status || status === "success" || status === "ok" || status === "completed";
    if (successfulStatus && !rawResultText) {
        throw new AgyCliStreamError("empty_result", "Agy CLI stream ended with an empty terminal result");
    }
    if (successfulStatus && visibleText && rawResultText !== visibleText) {
        throw new AgyCliStreamError("result_mismatch", "Agy CLI terminal result did not match streamed assistant text");
    }
    const combinedText = `${status}\n${errorText}`;
    return {
        text: rawResultText,
        rawResultText,
        metadata: {
            ...(agent ? { agent } : {}),
            ...(model ? { model } : {}),
            ...(sessionId ? { sessionId } : {}),
            usage,
            toolInfoCount,
            status,
            errorText,
            deniedActions,
            authFailed: isAgyAuthFailure(combinedText),
            permissionDenied: deniedActions || isAgyPermissionDenied(combinedText),
            mcpUnavailable: isAgyMcpUnavailable(combinedText),
        },
    };
}
