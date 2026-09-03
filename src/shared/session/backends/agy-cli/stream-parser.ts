export interface AgyCliUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface AgyCliMetadata {
    agent?: string;
    sessionId?: string;
    usage: AgyCliUsage;
    toolInfo: string[];
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
    | { kind: "init"; agent?: string; sessionId?: string }
    | { kind: "text_delta"; text: string }
    | { kind: "tool_info"; text: string }
    | { kind: "result"; text: string; usage: AgyCliUsage; sessionId?: string };

const emptyUsage: AgyCliUsage = { inputTokens: 0, outputTokens: 0 };

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

function readToolInfo(record: JsonRecord): string {
    const direct = asString(record.tool_info) || asString(record.text) || asString(record.message);
    if (direct) return direct;
    const toolInfo = isJsonRecord(record.tool_info) ? record.tool_info : undefined;
    return asString(toolInfo?.name) || asString(toolInfo?.title) || JSON.stringify(record);
}

export function parseAgyCliJsonLine(line: string): AgyCliStreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: JsonValue;
    try {
        parsed = JSON.parse(trimmed) as JsonValue;
    } catch {
        throw new Error("Agy CLI emitted malformed JSON output");
    }
    if (!isJsonRecord(parsed)) return null;
    const type = asString(parsed.type) || asString(parsed.event);
    if (type === "init") {
        const init = isJsonRecord(parsed.init) ? parsed.init : parsed;
        return {
            kind: "init",
            agent: asString(init.agent) || undefined,
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
        if (updateType === "tool_info") {
            return { kind: "tool_info", text: readToolInfo(parsed) };
        }
        const nested = isJsonRecord(parsed.step_update) ? parsed.step_update : undefined;
        if (nested) {
            const nestedType = asString(nested.type) || asString(nested.update_type) || asString(nested.kind);
            if (nestedType === "text_delta" || asString(nested.step_type) === "agent_response") {
                const text = readTextDelta(nested);
                return text ? { kind: "text_delta", text } : null;
            }
            if (nestedType === "tool_info") return { kind: "tool_info", text: readToolInfo(nested) };
        }
        return null;
    }
    if (type === "result") {
        const result = isJsonRecord(parsed.result) ? parsed.result : parsed;
        const text = readResultText(parsed);
        return {
            kind: "result",
            text,
            usage: readUsage(result.usage || parsed.usage),
            sessionId: asString(parsed.conversation_id) || asString(result.conversation_id) ||
                asString(result.session_id) ||
                asString(result.sessionId) || undefined,
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
    let sessionId: string | undefined;
    let usage = emptyUsage;
    const toolInfo: string[] = [];

    const applyEvent = (event: AgyCliStreamEvent) => {
        if (event.kind === "init") {
            if (event.agent) agent = event.agent;
            if (event.sessionId) sessionId = event.sessionId;
            return;
        }
        if (event.kind === "text_delta") {
            visibleText += event.text;
            callbacks.onDelta?.({ text: event.text });
            return;
        }
        if (event.kind === "tool_info") {
            toolInfo.push(event.text);
            return;
        }
        sawResult = true;
        rawResultText = event.text;
        usage = event.usage;
        if (event.sessionId) sessionId = event.sessionId;
    };

    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() || "";
        for (const line of lines) {
            const event = parseAgyCliJsonLine(line);
            if (event) applyEvent(event);
        }
    }
    buffered += decoder.decode();
    if (buffered.trim()) {
        const event = parseAgyCliJsonLine(buffered);
        if (event) applyEvent(event);
    }
    if (!sawResult) {
        if (!visibleText) throw new Error("Agy CLI stream ended without output");
        throw new Error("Agy CLI stream ended without a terminal result");
    }
    if (rawResultText !== visibleText) {
        throw new Error("Agy CLI terminal result did not match streamed assistant text");
    }
    return {
        text: rawResultText,
        rawResultText,
        metadata: { ...(agent ? { agent } : {}), ...(sessionId ? { sessionId } : {}), usage, toolInfo },
    };
}
