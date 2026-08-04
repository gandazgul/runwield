import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RunWieldModel } from "../../../models/model-registry.ts";
import type { HostedSession } from "../../hosted-session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "../../session-runtime-events.js";
import { getRootSessionBranchEntries } from "../../root-session.js";
import { prepareClaudeCliCommand, removeClaudeCliPromptFile } from "./command.ts";
import { DenoClaudeCliProcessPort } from "./process.ts";
import { type ClaudeCliUsage, parseClaudeCliStream } from "./stream-parser.ts";

interface TextBlock {
    type: "text";
    text: string;
}

type SessionAppendMessage = Parameters<SessionManager["appendMessage"]>[0];

interface TranscriptMessage {
    role: string;
    content?: string | TextBlock[];
}

interface TranscriptEntry {
    type?: string;
    message?: TranscriptMessage;
}

interface ConversationMessage {
    role: "user" | "assistant";
    text: string;
}

export interface ClaudeCliExecutionSessionOptions {
    cwd: string;
    agentName: string;
    finalSystemPrompt: string;
    model: RunWieldModel;
    sessionManager: SessionManager;
    hostedSession?: HostedSession;
}

export interface ClaudeCliRunOptions {
    userRequest: string;
    images?: { base64: string; mimeType: string }[];
    signal?: AbortSignal;
}

export class ClaudeCliExecutionSession {
    readonly kind = "claude-cli";
    readonly id: string;
    readonly model: RunWieldModel;
    readonly agentName: string;
    readonly sessionManager: SessionManager;
    readonly finalSystemPrompt: string;
    private readonly cwd: string;
    private readonly hostedSession?: HostedSession;
    private readonly messages: AgentMessage[] = [];
    isStreaming = false;

    constructor(options: ClaudeCliExecutionSessionOptions) {
        this.id = `claude-cli:${crypto.randomUUID()}`;
        this.cwd = options.cwd;
        this.agentName = options.agentName;
        this.finalSystemPrompt = options.finalSystemPrompt;
        this.model = options.model;
        this.sessionManager = options.sessionManager;
        this.hostedSession = options.hostedSession;
        this.messages = this.readMessages();
    }

    getMessages(): AgentMessage[] {
        return [...this.messages];
    }

    dispose(): void {}

    abort(): void {}

    async runTurn(options: ClaudeCliRunOptions): Promise<AgentMessage[]> {
        if (options.images && options.images.length > 0) {
            throw new Error("Claude CLI execution backend does not support image attachments in this slice");
        }
        const conversation = this.readConversation();
        const userMessage = makeUserMessage(options.userRequest);
        this.sessionManager.appendMessage(userMessage);
        this.messages.push(userMessage as AgentMessage);
        conversation.push({ role: "user", text: options.userRequest });
        const selector = this.model.id;
        const command = await prepareClaudeCliCommand({
            selector,
            systemPrompt: this.finalSystemPrompt +
                "\n\nRunWield Custom Tools are not exposed to Claude CLI in this tracer bullet. Responses are non-terminal ordinary assistant text.",
        });
        this.sessionManager.appendCustomEntry("runwield.execution_backend", {
            version: 1,
            backend: "claude-cli",
            provider: this.model.provider,
            model: selector,
            outputFormat: "stream-json",
        });
        const stdinText = serializeConversation(conversation);
        const processPort = new DenoClaudeCliProcessPort();
        const messageId = `claude-cli-assistant:${crypto.randomUUID()}`;
        this.isStreaming = true;
        try {
            const process = processPort.run(command, stdinText, this.cwd, options.signal);
            const parsed = await parseClaudeCliStream(process.stdout, {
                onDelta: (delta) => {
                    emitHostedSessionRuntimeEvent(this.hostedSession, {
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        messageId,
                        delta: delta.text,
                        agentName: this.agentName,
                        messageKind: "assistant",
                    });
                },
            });
            const status = await process.completed;
            if (!status.success) {
                const stderr = await process.stderrText;
                throw new Error(`Claude CLI exited with code ${status.code}${stderr ? `: ${stderr}` : ""}`);
            }
            this.sessionManager.appendModelChange(this.model.provider, this.model.id);
            const assistantMessage = makeAssistantMessage(parsed.text, this.model, parsed.metadata.usage);
            this.sessionManager.appendMessage(assistantMessage);
            this.sessionManager.appendCustomEntry("runwield.execution_backend", {
                version: 1,
                backend: "claude-cli",
                provider: this.model.provider,
                model: selector,
                outputFormat: "stream-json",
                ...(parsed.metadata.externalSessionId ? { externalSessionId: parsed.metadata.externalSessionId } : {}),
            });
            this.messages.push(assistantMessage as AgentMessage);
            emitHostedSessionRuntimeEvent(this.hostedSession, {
                type: RuntimeEventTypes.USAGE,
                usage: parsed.metadata.usage,
            });
            return this.getMessages();
        } finally {
            this.isStreaming = false;
            await removeClaudeCliPromptFile(command);
        }
    }

    private readMessages(): AgentMessage[] {
        return this.readConversation().map((message) => {
            return message.role === "user"
                ? makeUserMessage(message.text) as AgentMessage
                : makeAssistantMessage(message.text, this.model, zeroUsage()) as AgentMessage;
        });
    }

    private readConversation(): ConversationMessage[] {
        return getRootSessionBranchEntries(this.sessionManager)
            .map((entry) => normalizeTranscriptEntry(entry as TranscriptEntry))
            .filter((message): message is ConversationMessage => Boolean(message));
    }
}

function normalizeTranscriptEntry(entry: TranscriptEntry): ConversationMessage | null {
    if (entry.type !== "message" || !entry.message) return null;
    if (entry.message.role !== "user" && entry.message.role !== "assistant") return null;
    const text = extractText(entry.message.content);
    if (!text) return null;
    return { role: entry.message.role, text };
}

function extractText(content: string | TextBlock[] | undefined): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((block) => block.type === "text").map((block) => block.text).join("");
}

function makeUserMessage(text: string): SessionAppendMessage {
    return {
        role: "user",
        timestamp: Date.now(),
        content: [{ type: "text", text }],
    };
}

function makeAssistantMessage(text: string, model: RunWieldModel, usage: ClaudeCliUsage): SessionAppendMessage {
    return {
        role: "assistant",
        timestamp: Date.now(),
        content: [{ type: "text", text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: toPiUsage(usage),
        stopReason: "stop",
    };
}

function zeroUsage(): ClaudeCliUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
    };
}

function toPiUsage(usage: ClaudeCliUsage) {
    return {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadTokens,
        cacheWrite: usage.cacheWriteTokens,
        totalTokens: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: usage.costUsd,
        },
    };
}

function serializeConversation(messages: ConversationMessage[]): string {
    return messages.map((message) => `${message.role.toUpperCase()}: ${message.text}`).join("\n\n");
}
