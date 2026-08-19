export interface ClaudeCliUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
}

export interface ClaudeCliFinalMetadata {
    externalSessionId?: string;
    isError: boolean;
    usage: ClaudeCliUsage;
}

export interface ClaudeCliParseResult {
    text: string;
    metadata: ClaudeCliFinalMetadata;
}

export interface ClaudeCliAssistantDelta {
    text: string;
}

export interface ClaudeCliThinkingDelta {
    text: string;
}

export type ClaudeCliStreamEvent =
    | { kind: "assistant_delta"; text: string }
    | { kind: "text_partial"; text: string }
    | { kind: "thinking_partial"; text: string }
    | { kind: "result"; text: string; externalSessionId?: string; isError: boolean; usage: ClaudeCliUsage };

export interface ClaudeCliStreamCallbacks {
    onDelta: (delta: ClaudeCliAssistantDelta) => void;
    /** Live thinking chunks from `stream_event` partial messages; display-only, never persisted as visible text. */
    onThinkingDelta?: (delta: ClaudeCliThinkingDelta) => void;
    /** Signals the current thinking block ended, either because visible text started or the turn finished. */
    onThinkingEnd?: () => void;
    isTerminalAccepted?: () => boolean;
}

type JsonScalar = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonRecord {
    [key: string]: JsonValue;
}
type JsonValue = JsonScalar | JsonArray | JsonRecord;

const emptyUsage: ClaudeCliUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
};

function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: JsonValue | undefined): string {
    return typeof value === "string" ? value : "";
}

function asNumber(value: JsonValue | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsage(value: JsonValue | undefined): ClaudeCliUsage {
    const usage = isJsonRecord(value) ? value : {};
    const cost = isJsonRecord(usage.cost) ? asNumber(usage.cost.total) : asNumber(usage.cost);
    return {
        inputTokens: asNumber(usage.input_tokens) || asNumber(usage.inputTokens) || asNumber(usage.input),
        outputTokens: asNumber(usage.output_tokens) || asNumber(usage.outputTokens) || asNumber(usage.output),
        cacheReadTokens: asNumber(usage.cache_read_input_tokens) || asNumber(usage.cacheReadTokens),
        cacheWriteTokens: asNumber(usage.cache_creation_input_tokens) || asNumber(usage.cacheWriteTokens),
        costUsd: cost,
    };
}

function contentText(value: JsonValue | undefined): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        return value.map((item) => {
            if (!isJsonRecord(item)) return "";
            if (item.type === "text") return asString(item.text);
            return "";
        }).join("");
    }
    return "";
}

export function parseClaudeCliJsonLine(line: string): ClaudeCliStreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: JsonValue;
    try {
        parsed = JSON.parse(trimmed) as JsonValue;
    } catch {
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { kind: "assistant_delta", text: trimmed };
        throw new Error("Claude CLI emitted malformed stream-json output");
    }
    if (!isJsonRecord(parsed)) return null;
    const eventType = asString(parsed.type);
    if (eventType === "assistant") {
        const message = isJsonRecord(parsed.message) ? parsed.message : parsed;
        const text = contentText(message.content);
        return text ? { kind: "assistant_delta", text } : null;
    }
    if (eventType === "content_block_delta") {
        const delta = isJsonRecord(parsed.delta) ? parsed.delta : parsed;
        const text = asString(delta.text);
        return text ? { kind: "assistant_delta", text } : null;
    }
    if (eventType === "stream_event") {
        const inner = isJsonRecord(parsed.event) ? parsed.event : null;
        if (!inner || asString(inner.type) !== "content_block_delta") return null;
        const delta = isJsonRecord(inner.delta) ? inner.delta : null;
        if (!delta) return null;
        const deltaType = asString(delta.type);
        if (deltaType === "text_delta") {
            const text = asString(delta.text);
            return text ? { kind: "text_partial", text } : null;
        }
        if (deltaType === "thinking_delta") {
            const text = asString(delta.thinking);
            return text ? { kind: "thinking_partial", text } : null;
        }
        return null;
    }
    if (eventType === "result") {
        const text = asString(parsed.result) || asString(parsed.text);
        const usage = readUsage(parsed.usage);
        const externalSessionId = asString(parsed.session_id) || asString(parsed.sessionId) || undefined;
        return {
            kind: "result",
            text,
            isError: parsed.is_error === true,
            usage,
            ...(externalSessionId ? { externalSessionId } : {}),
        };
    }
    return null;
}

export async function parseClaudeCliStream(
    stream: ReadableStream<Uint8Array>,
    callbacks: ClaudeCliStreamCallbacks,
): Promise<ClaudeCliParseResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let visibleText = "";
    let resultText = "";
    let metadata: ClaudeCliFinalMetadata = { isError: false, usage: emptyUsage };
    let sawResult = false;
    // Text already forwarded live through `text_partial` `stream_event`s for the block currently
    // in progress; used to avoid re-emitting it when the matching complete `assistant` message arrives.
    let streamedBlockText = "";
    let thinkingActive = false;

    const endThinking = () => {
        if (!thinkingActive) return;
        thinkingActive = false;
        callbacks.onThinkingEnd?.();
    };

    const applyEvent = (event: ClaudeCliStreamEvent) => {
        if (event.kind === "thinking_partial") {
            thinkingActive = true;
            callbacks.onThinkingDelta?.({ text: event.text });
            return;
        }
        if (event.kind === "text_partial") {
            endThinking();
            visibleText += event.text;
            streamedBlockText += event.text;
            callbacks.onDelta({ text: event.text });
            return;
        }
        if (event.kind === "assistant_delta") {
            endThinking();
            const alreadyStreamed = streamedBlockText;
            streamedBlockText = "";
            if (alreadyStreamed && event.text === alreadyStreamed) return;
            const remainder = alreadyStreamed && event.text.startsWith(alreadyStreamed)
                ? event.text.slice(alreadyStreamed.length)
                : event.text;
            if (!remainder) return;
            visibleText += remainder;
            callbacks.onDelta({ text: remainder });
            return;
        }
        endThinking();
        sawResult = true;
        resultText = event.text;
        metadata = {
            isError: event.isError,
            usage: event.usage,
            ...(event.externalSessionId ? { externalSessionId: event.externalSessionId } : {}),
        };
    };

    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() || "";
        for (const line of lines) {
            const event = parseClaudeCliJsonLine(line);
            if (event) applyEvent(event);
        }
    }
    if (buffered.trim()) {
        const event = parseClaudeCliJsonLine(buffered);
        if (event) applyEvent(event);
    }
    endThinking();
    if (!sawResult) {
        if (visibleText || callbacks.isTerminalAccepted?.() === true) {
            return { text: visibleText, metadata: { isError: false, usage: emptyUsage } };
        }
        throw new Error("Claude CLI stream ended without a terminal result");
    }
    if (!metadata.isError && resultText !== visibleText && callbacks.isTerminalAccepted?.() !== true) {
        if (!resultText || !visibleText.includes(resultText)) {
            throw new Error("Claude CLI terminal result did not match visible assistant stream");
        }
        return { text: visibleText, metadata };
    }
    return { text: callbacks.isTerminalAccepted?.() === true ? visibleText : resultText, metadata };
}
