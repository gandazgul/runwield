import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunWieldModel } from "../../../models/model-registry.ts";
import type { HostedSession } from "../../hosted-session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "../../session-runtime-events.js";
import { getRootSessionBranchEntries } from "../../root-session.js";
import {
    prepareClaudeCliCommand,
    type PreparedClaudeCliCommand,
    removeClaudeCliMcpConfigFile,
    removeClaudeCliPromptFile,
} from "./command.ts";
import {
    buildBackendStatusEntry,
    ClaudeCliBackendError,
    emitBackendStatus,
    sanitizeStderrForDisplay,
} from "./failure.ts";
import { type ClaudeCliProcessResult, DenoClaudeCliProcessPort } from "./process.ts";
import { type ClaudeCliUsage, parseClaudeCliStream } from "./stream-parser.ts";
import { mcpAliasFor, type RunWieldMcpBridgeHandle, startRunWieldMcpBridge } from "./mcp-bridge.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonRecord;

interface JsonRecord {
    [key: string]: JsonValue;
}

interface TextBlock {
    type: "text";
    text: string;
}

interface ToolUseBlock {
    type: "tool_use" | "toolCall";
    name?: string;
    arguments?: JsonRecord;
    input?: JsonRecord;
}

interface ToolResultBlock {
    type: "tool_result";
    text?: string;
    content?: string | TextBlock[];
    tool_use_id?: string;
    toolUseId?: string;
    is_error?: boolean;
    isError?: boolean;
}

type TranscriptContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

type SessionAppendMessage = Parameters<SessionManager["appendMessage"]>[0];

interface TranscriptMessage {
    role: string;
    content?: string | TranscriptContentBlock[];
    toolName?: string;
    tool_name?: string;
    isError?: boolean;
    is_error?: boolean;
}

interface TranscriptEntry {
    type?: string;
    customType?: string;
    data?: { version?: number; compactInvocation?: string; expandedRequest?: string };
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
    /** Eligible RunWield Tool Definitions exposed over MCP this turn. */
    bridgedTools?: ToolDefinition[];
    /** False for temporary turns that must not change the root model marker. */
    persistModelChange?: boolean;
}

export interface ClaudeCliRunOptions {
    userRequest: string;
    images?: { base64: string; mimeType: string }[];
    signal?: AbortSignal;
    requestId?: string;
    attemptId?: string;
}

class RuntimeDeltaBuffer {
    private buffered = "";
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly emit: (delta: string) => void) {}

    push(delta: string): void {
        if (!delta) return;
        this.buffered += delta;
        if (this.flushTimer !== null) return;
        this.flushTimer = setTimeout(() => this.flush(), 16);
    }

    flush(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (!this.buffered) return;
        const delta = this.buffered;
        this.buffered = "";
        this.emit(delta);
    }
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
    private readonly bridgedTools: ToolDefinition[];
    private readonly persistModelChange: boolean;
    private readonly messages: AgentMessage[] = [];
    private turnAbortController: AbortController | null = null;
    isStreaming = false;

    constructor(options: ClaudeCliExecutionSessionOptions) {
        this.id = `claude-cli:${crypto.randomUUID()}`;
        this.cwd = options.cwd;
        this.agentName = options.agentName;
        this.finalSystemPrompt = options.finalSystemPrompt;
        this.model = options.model;
        this.sessionManager = options.sessionManager;
        this.hostedSession = options.hostedSession;
        this.bridgedTools = [...(options.bridgedTools || [])];
        this.persistModelChange = options.persistModelChange !== false;
        this.messages = this.readMessages();
    }

    getMessages(): AgentMessage[] {
        return [...this.messages];
    }

    dispose(): void {
        this.abort();
    }

    abort(): void {
        this.turnAbortController?.abort();
    }

    clearQueue(): void {}

    async runTurn(options: ClaudeCliRunOptions): Promise<AgentMessage[]> {
        if (options.images && options.images.length > 0) {
            throw new Error("Claude CLI execution backend does not support image attachments in this slice");
        }
        const conversation = this.readConversation();
        const userMessage = makeUserMessage(options.userRequest);
        conversation.push({ role: "user", text: options.userRequest });
        const selector = this.model.id;
        let bridge: RunWieldMcpBridgeHandle | null = null;
        let command: PreparedClaudeCliCommand | null = null;
        let process: ClaudeCliProcessResult | null = null;
        let statusEmitted = false;
        this.turnAbortController = new AbortController();
        const combinedSignal = options.signal
            ? AbortSignal.any([options.signal, this.turnAbortController.signal])
            : this.turnAbortController.signal;
        this.isStreaming = true;

        const emitFailure = (
            kind: ConstructorParameters<typeof ClaudeCliBackendError>[0],
            exitCode: number | null,
            message?: string,
        ) => {
            // emitBackendStatus persists the sanitized runwield.backend_status transcript entry.
            if (statusEmitted) return;
            statusEmitted = true;
            emitBackendStatus(
                this.hostedSession,
                this.sessionManager,
                buildBackendStatusEntry(kind, {
                    exitCode,
                    ...(message ? { message } : {}),
                    requestId: options.requestId,
                    attemptId: options.attemptId,
                }),
            );
        };

        let flushRuntimeDeltas = () => {};
        try {
            const eligibleAliases = this.bridgedTools.map((tool) => mcpAliasFor(tool.name));
            if (this.bridgedTools.length > 0) {
                try {
                    bridge = await startRunWieldMcpBridge({
                        tools: this.bridgedTools,
                        cwd: this.cwd,
                        hostedSession: this.hostedSession,
                        sessionManager: this.sessionManager,
                        onMessage: (message) => {
                            this.messages.push(message);
                        },
                        signal: combinedSignal,
                        assistantBase: {
                            api: this.model.api,
                            provider: this.model.provider,
                            model: this.model.id,
                        },
                        beforeRuntimeToolEvent: () => flushRuntimeDeltas(),
                    });
                } catch {
                    emitFailure("bridge_startup_failed", null);
                    throw new ClaudeCliBackendError("bridge_startup_failed");
                }
            }
            command = await prepareClaudeCliCommand({
                selector,
                systemPrompt: this.finalSystemPrompt + buildBridgedToolPromptAppendix(this.bridgedTools),
                ...(bridge ? { mcpConfig: bridge.config } : {}),
                allowedToolNames: eligibleAliases.flatMap((alias) => [alias, `mcp__runwield__${alias}`]),
            });
            const stdinText = serializeConversation(conversation);
            const processPort = new DenoClaudeCliProcessPort();
            try {
                process = processPort.run(command, stdinText, this.cwd, combinedSignal);
            } catch (error) {
                if (error instanceof ClaudeCliBackendError) {
                    emitFailure(error.kind, error.exitCode);
                }
                throw error;
            }

            this.sessionManager.appendMessage(userMessage);
            this.messages.push(userMessage as AgentMessage);
            this.sessionManager.appendCustomEntry("runwield.execution_backend", {
                version: 1,
                backend: "claude-cli",
                provider: this.model.provider,
                model: selector,
                outputFormat: "stream-json",
                ...(options.requestId ? { requestId: options.requestId } : {}),
                ...(options.attemptId ? { attemptId: options.attemptId } : {}),
            });

            const messageId = `claude-cli-assistant:${crypto.randomUUID()}`;
            const thinkingMessageId = `claude-cli-thinking:${crypto.randomUUID()}`;
            const textDeltas = new RuntimeDeltaBuffer((delta) => {
                emitHostedSessionRuntimeEvent(this.hostedSession, {
                    type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                    messageId,
                    delta,
                    agentName: this.agentName,
                    messageKind: "assistant",
                });
            });
            const thinkingDeltas = new RuntimeDeltaBuffer((delta) => {
                emitHostedSessionRuntimeEvent(this.hostedSession, {
                    type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
                    messageId: thinkingMessageId,
                    delta,
                    agentName: this.agentName,
                });
            });
            flushRuntimeDeltas = () => {
                thinkingDeltas.flush();
                textDeltas.flush();
            };
            let parsed: Awaited<ReturnType<typeof parseClaudeCliStream>>;
            try {
                parsed = await parseClaudeCliStream(process.stdout, {
                    onDelta: (delta) => {
                        textDeltas.push(delta.text);
                    },
                    onThinkingDelta: (delta) => {
                        thinkingDeltas.push(delta.text);
                    },
                    onThinkingEnd: () => {
                        thinkingDeltas.flush();
                        emitHostedSessionRuntimeEvent(this.hostedSession, {
                            type: RuntimeEventTypes.ASSISTANT_THINKING_END,
                            messageId: thinkingMessageId,
                            agentName: this.agentName,
                        });
                    },
                    isTerminalAccepted: () => bridge?.acceptedTerminal === true,
                });
            } catch (error) {
                process.kill();
                if (!combinedSignal.aborted && error instanceof Error && error.message.includes("terminal result")) {
                    try {
                        const status = await process.completed;
                        if (!status.success) {
                            const stderr = await process.stderrText;
                            const kind = isAuthFailure(stderr) ? "auth_failed" : "non_zero_exit";
                            emitFailure(kind, status.code);
                            const excerpt = sanitizeStderrForDisplay(stderr);
                            const base = buildBackendStatusEntry(kind, { exitCode: status.code }).message;
                            throw new ClaudeCliBackendError(kind, {
                                exitCode: status.code,
                                message: excerpt ? `${base}\n${excerpt}` : base,
                            });
                        }
                    } catch (statusError) {
                        if (statusError instanceof ClaudeCliBackendError) throw statusError;
                    }
                }
                const kind = combinedSignal.aborted ? "canceled" : "malformed_stream";
                emitFailure(kind, null);
                throw error instanceof ClaudeCliBackendError ? error : new ClaudeCliBackendError(kind);
            }
            flushRuntimeDeltas();

            let status: Deno.CommandStatus;
            try {
                status = await process.completed;
            } catch {
                const kind = combinedSignal.aborted ? "canceled" : "non_zero_exit";
                emitFailure(kind, null);
                throw new ClaudeCliBackendError(kind);
            }
            if (combinedSignal.aborted) {
                process.kill();
                emitFailure("canceled", status.code);
                throw new ClaudeCliBackendError("canceled", { exitCode: status.code });
            }
            if (parsed.metadata.isError || !status.success) {
                const stderr = await process.stderrText;
                const excerpt = sanitizeStderrForDisplay(stderr);
                const claudeMessage = parsed.metadata.isError ? sanitizeStderrForDisplay(parsed.text) : "";
                const detail = claudeMessage || excerpt;
                const kind = isAuthFailure(detail) ? "auth_failed" : "non_zero_exit";
                const base = buildBackendStatusEntry(kind, { exitCode: status.code }).message;
                const message = detail || base;
                emitFailure(kind, status.code, message);
                throw new ClaudeCliBackendError(kind, {
                    exitCode: status.code,
                    message,
                });
            }
            if (this.persistModelChange) this.sessionManager.appendModelChange(this.model.provider, this.model.id);
            const assistantMessage = makeAssistantMessage(parsed.text, this.model, parsed.metadata.usage);
            this.sessionManager.appendMessage(assistantMessage);
            this.sessionManager.appendCustomEntry("runwield.execution_backend", {
                version: 1,
                backend: "claude-cli",
                provider: this.model.provider,
                model: selector,
                outputFormat: "stream-json",
                ...(options.requestId ? { requestId: options.requestId } : {}),
                ...(options.attemptId ? { attemptId: options.attemptId } : {}),
                ...(parsed.metadata.externalSessionId ? { externalSessionId: parsed.metadata.externalSessionId } : {}),
            });
            this.messages.push(assistantMessage as AgentMessage);
            emitHostedSessionRuntimeEvent(this.hostedSession, {
                type: RuntimeEventTypes.USAGE,
                usage: parsed.metadata.usage,
            });
            return this.getMessages();
        } finally {
            flushRuntimeDeltas();
            this.isStreaming = false;
            this.turnAbortController = null;
            if (command) {
                await removeClaudeCliPromptFile(command);
                await removeClaudeCliMcpConfigFile(command);
            }
            if (bridge) await bridge.close();
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
        const messages: ConversationMessage[] = [];
        let skipNextCompactInvocation = "";
        for (const entry of getRootSessionBranchEntries(this.sessionManager)) {
            const expanded = readNamedInvocationExpandedText(entry as TranscriptEntry);
            if (expanded) {
                messages.push({ role: "user", text: expanded });
                const compact = (entry as { data?: { compactInvocation?: string } }).data?.compactInvocation || "";
                skipNextCompactInvocation = compact;
                continue;
            }
            const normalizedMessages = normalizeTranscriptEntry(entry as TranscriptEntry);
            for (const message of normalizedMessages) {
                if (
                    skipNextCompactInvocation && message.role === "user" && message.text === skipNextCompactInvocation
                ) {
                    skipNextCompactInvocation = "";
                    continue;
                }
                skipNextCompactInvocation = "";
                messages.push(message);
            }
        }
        return messages;
    }
}

function readNamedInvocationExpandedText(entry: TranscriptEntry): string {
    if (entry.type !== "custom" || entry.customType !== "runwield.named_invocation") return "";
    if (entry.data?.version !== 1 || typeof entry.data.expandedRequest !== "string") return "";
    return entry.data.expandedRequest;
}

function normalizeTranscriptEntry(entry: TranscriptEntry): ConversationMessage[] {
    if (entry.type !== "message" || !entry.message) return [];
    const text = extractText(entry.message.content);
    if (!text) return [];
    if (entry.message.role === "user" || entry.message.role === "assistant") {
        return [{ role: entry.message.role, text }];
    }
    if (entry.message.role === "toolResult" || entry.message.role === "tool_result") {
        const toolName = entry.message.toolName || entry.message.tool_name || "tool";
        const suffix = entry.message.isError || entry.message.is_error ? " (error)" : "";
        return [{ role: "user", text: `Tool result ${toolName}${suffix}: ${text}` }];
    }
    return [];
}

function extractText(content: string | TranscriptContentBlock[] | undefined): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((block) => transcriptContentBlockText(block)).filter(Boolean).join("\n");
}

function isToolUseBlock(block: TranscriptContentBlock): block is ToolUseBlock {
    return block.type === "tool_use" || block.type === "toolCall";
}

function isToolResultBlock(block: TranscriptContentBlock): block is ToolResultBlock {
    return block.type === "tool_result";
}

function transcriptContentBlockText(block: TranscriptContentBlock): string {
    if (block.type === "text") return block.text;
    if (isToolUseBlock(block)) {
        const toolName = block.name || "tool";
        const args = block.arguments || block.input || {};
        return `Tool call ${toolName}: ${JSON.stringify(args)}`;
    }
    if (isToolResultBlock(block)) {
        const toolText = extractText(block.content) || block.text || "";
        const toolCallId = block.tool_use_id || block.toolUseId || "tool";
        const suffix = block.is_error || block.isError ? " (error)" : "";
        return `Tool result ${toolCallId}${suffix}: ${toolText}`;
    }
    return "";
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

function isAuthFailure(stderr: string): boolean {
    return /authenticate|not signed in|oauth|api key|login|expired/i.test(stderr);
}

/**
 * Backend-specific prompt appendix. Names only the aliases eligible for this
 * Agent and states that plain-text questions are non-terminal; for the
 * Reviewer it points at Claude's native tools because RunWield's
 * `review_diff` is intentionally not bridged.
 */
export function buildBridgedToolPromptAppendix(bridgedTools: ToolDefinition[]): string {
    const eligibleAliases = bridgedTools.map((tool) => mcpAliasFor(tool.name));
    if (eligibleAliases.length === 0) return "";
    const lines = [
        "",
        "## RunWield Bridged Tools (MCP)",
        "",
        "This session exposes these RunWield tools through the RunWield MCP server:",
        ...eligibleAliases.map((alias) => `- ${alias}`),
        "",
        "Use Claude Code native tools for file, search, and shell work. Use RunWield bridged tools for memory, code intelligence, Work Record, user interview, and lifecycle work.",
        "",
        "Calling a lifecycle tool is the only way to advance RunWield workflow state. Plain-text questions, " +
        'statements such as "done", or text that resembles a tool call have no workflow effect.',
    ];
    if (eligibleAliases.includes("runwield_review_complete")) {
        lines.push(
            "",
            "Before calling runwield_review_complete, inspect the implementation with your native " +
                "read/grep/find/ls/Bash tools. RunWield's review_diff tool may be bridged when the caller supplies it for this turn.",
        );
    }
    return lines.join("\n");
}
