import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunWieldModel } from "../../../models/model-registry.ts";
import type { HostedSession } from "../../hosted-session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "../../session-runtime-events.js";
import {
    cleanupAgyCustomAgent,
    materializeAgyCustomAgent,
    resolveAgyCustomAgentPaths,
    verifyAgyCustomAgentOwnership,
} from "./custom-agent.ts";
import type { AgyCustomAgentOwnership } from "./custom-agent.ts";
import { prepareAgyCliAgentsCommand, prepareAgyCliStreamCommand } from "./command.ts";
import { DenoAgyCliProcessPort } from "./process.ts";
import type { AgyCliProcessResult, AgyCliProcessStatus } from "./process.ts";
import {
    AgyCliBackendError,
    type AgyCliBackendStatusKind,
    buildAgyBackendStatusEntry,
    emitAgyBackendStatus,
    isAgyAuthFailure,
    isAgyMcpUnavailable,
    isAgyPermissionDenied,
} from "./failure.ts";
import {
    AGY_CLI_MCP_PROVENANCE,
    type RunWieldMcpBridgeHandle,
    startRunWieldMcpBridge,
} from "../../bridged-tools/mcp-bridge.ts";
import { RUNWIELD_MCP_BRIDGE_TOKEN_ENV, RUNWIELD_MCP_BRIDGE_URL_ENV } from "../../bridged-tools/stdio-transport.ts";
import { AgyCliStreamError, parseAgyCliStream } from "./stream-parser.ts";
import type { AgyCliParseResult, AgyCliUsage } from "./stream-parser.ts";
import { readExternalCliConversation, serializeExternalCliConversation } from "../../external-cli-conversation.ts";

type SessionAppendMessage = Parameters<SessionManager["appendMessage"]>[0];

export interface AgyCliExecutionSessionOptions {
    cwd: string;
    agentName: string;
    agentDisplayName: string;
    finalSystemPrompt: string;
    model: RunWieldModel;
    sessionManager: SessionManager;
    hostedSession?: HostedSession;
    bridgedTools?: ToolDefinition[];
    thinkingLevel?: string;
    persistModelChange?: boolean;
}

export interface AgyCliRunOptions {
    userRequest: string;
    images?: { base64: string; mimeType: string }[];
    signal?: AbortSignal;
    requestId?: string;
    attemptId?: string;
}

interface ClassifiedFailure {
    kind: AgyCliBackendStatusKind;
    exitCode: number | null;
    message?: string;
}

interface AgyParseOutcome {
    parsed: AgyCliParseResult | null;
    parseError: Error | null;
}

export class AgyCliExecutionSession {
    readonly kind = "agy-cli";
    readonly id: string;
    readonly model: RunWieldModel;
    readonly agentName: string;
    readonly agentDisplayName: string;
    readonly sessionManager: SessionManager;
    readonly finalSystemPrompt: string;
    private readonly cwd: string;
    private readonly hostedSession?: HostedSession;
    private readonly ownership: AgyCustomAgentOwnership;
    private readonly bridgedTools: ToolDefinition[];
    private readonly thinkingLevel?: string;
    private readonly persistModelChange: boolean;
    private messages: AgentMessage[] = [];
    private activeProcess: AgyCliProcessResult | null = null;
    private turnAbortController: AbortController | null = null;
    private activeTurnDone: Promise<void> | null = null;
    private cleanupStatusEmitted = false;
    isStreaming = false;

    private constructor(options: AgyCliExecutionSessionOptions, ownership: AgyCustomAgentOwnership) {
        this.id = `agy-cli:${crypto.randomUUID()}`;
        this.cwd = options.cwd;
        this.agentName = options.agentName;
        this.agentDisplayName = options.agentDisplayName;
        this.finalSystemPrompt = options.finalSystemPrompt;
        this.model = options.model;
        this.sessionManager = options.sessionManager;
        this.hostedSession = options.hostedSession;
        this.bridgedTools = [...(options.bridgedTools || [])];
        this.thinkingLevel = options.thinkingLevel;
        this.persistModelChange = options.persistModelChange !== false;
        this.ownership = ownership;
        this.messages = this.readMessages();
    }

    static async create(options: AgyCliExecutionSessionOptions): Promise<AgyCliExecutionSession> {
        const selector = makeTemporaryAgentSelector(options.agentName);
        const definition = formatAgyCustomAgentDefinition(options.finalSystemPrompt, options.agentDisplayName);
        const paths = resolveAgyCustomAgentPaths(selector);
        const pendingOwnership: AgyCustomAgentOwnership = {
            name: selector,
            definition,
            agentsRootPath: paths.agentsRootPath,
            agentDirectoryPath: paths.agentDirectoryPath,
            definitionPath: paths.definitionPath,
            createdAgentDirectory: true,
            createdDefinition: true,
        };
        let ownership: AgyCustomAgentOwnership | null = null;
        try {
            ownership = await materializeAgyCustomAgent(selector, definition);
            await verifyAgyCustomAgentListed(selector, options.cwd);
            return new AgyCliExecutionSession(options, ownership);
        } catch (error) {
            const failure = classifySetupFailure(error instanceof Error ? error : String(error));
            emitAgyBackendStatus(
                options.hostedSession,
                options.sessionManager,
                buildAgyBackendStatusEntry(failure.kind, { exitCode: failure.exitCode, message: failure.message }),
            );
            await cleanupAgyCustomAgent(ownership || pendingOwnership).catch((cleanupError) => {
                emitAgyBackendStatus(
                    options.hostedSession,
                    options.sessionManager,
                    buildAgyBackendStatusEntry("cleanup_failed", {
                        message: getErrorText(cleanupError instanceof Error ? cleanupError : String(cleanupError)),
                    }),
                );
            });
            throw new AgyCliBackendError(failure.kind, { exitCode: failure.exitCode, message: failure.message });
        }
    }

    getMessages(): AgentMessage[] {
        return [...this.messages];
    }

    async dispose(): Promise<void> {
        this.abort();
        await this.activeTurnDone?.catch(() => undefined);
        try {
            await cleanupAgyCustomAgent(this.ownership);
        } catch (error) {
            this.emitCleanupWarning(error instanceof Error ? error : String(error));
        }
    }

    abort(): void {
        this.turnAbortController?.abort();
        this.activeProcess?.kill();
    }

    clearQueue(): void {}

    async runTurn(options: AgyCliRunOptions): Promise<AgentMessage[]> {
        const turn = this.runTurnInternal(options);
        const done = turn.then(
            () => undefined,
            () => undefined,
        );
        this.activeTurnDone = done;
        try {
            return await turn;
        } finally {
            if (this.activeTurnDone === done) this.activeTurnDone = null;
        }
    }

    private async runTurnInternal(options: AgyCliRunOptions): Promise<AgentMessage[]> {
        if (options.images && options.images.length > 0) {
            throw new Error("Agy CLI execution backend does not support image attachments in this slice");
        }
        const effort = thinkingLevelToEffort(this.model.id, this.thinkingLevel);
        const expectedBackendModel = concreteAgyModel(this.model.id, effort);
        const conversation = readExternalCliConversation(this.sessionManager);
        conversation.push({ role: "user", text: options.userRequest });
        const serializedConversation = serializeExternalCliConversation(conversation);
        if (serializedConversation.includes(this.finalSystemPrompt)) {
            throw new Error("Agy user text cannot contain the Agent Definition");
        }

        let statusEmitted = false;
        const emitFailure = (failure: ClassifiedFailure, afterAcceptedTerminal: boolean): void => {
            if (statusEmitted) return;
            statusEmitted = true;
            emitAgyBackendStatus(
                this.hostedSession,
                this.sessionManager,
                buildAgyBackendStatusEntry(failure.kind, {
                    exitCode: failure.exitCode,
                    ...(failure.message ? { message: failure.message } : {}),
                    requestId: options.requestId,
                    attemptId: options.attemptId,
                    afterAcceptedTerminal,
                }),
            );
        };

        let bridge: RunWieldMcpBridgeHandle | null = null;
        let process: AgyCliProcessResult | null = null;
        let bridgeDisconnected = false;
        this.turnAbortController = new AbortController();
        const combinedSignal = options.signal
            ? AbortSignal.any([options.signal, this.turnAbortController.signal])
            : this.turnAbortController.signal;
        this.isStreaming = true;

        try {
            try {
                await this.verifyCustomAgentReady(combinedSignal);
            } catch (error) {
                const failure = classifySetupFailure(error instanceof Error ? error : String(error));
                emitFailure(failure, false);
                throw new AgyCliBackendError(failure.kind, { exitCode: failure.exitCode, message: failure.message });
            }

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
                        provenance: AGY_CLI_MCP_PROVENANCE,
                        onUnexpectedDisconnect: () => {
                            bridgeDisconnected = true;
                        },
                    });
                } catch (error) {
                    const failure: ClassifiedFailure = {
                        kind: "bridge_startup_failed",
                        exitCode: null,
                        message: getErrorText(error instanceof Error ? error : String(error)),
                    };
                    emitFailure(failure, false);
                    throw new AgyCliBackendError(failure.kind, { message: failure.message });
                }
            }

            const command = prepareAgyCliStreamCommand({
                agentName: this.ownership.name,
                model: this.model.id,
                userRequest: serializedConversation,
                effort,
                env: bridge
                    ? {
                        [RUNWIELD_MCP_BRIDGE_URL_ENV]: bridge.url,
                        [RUNWIELD_MCP_BRIDGE_TOKEN_ENV]: bridge.token,
                    }
                    : undefined,
            });
            const processPort = new DenoAgyCliProcessPort();
            try {
                process = processPort.run(command, this.cwd, combinedSignal);
                this.activeProcess = process;
                if (process.pid === null) {
                    const failure: ClassifiedFailure = { kind: "canceled", exitCode: null };
                    emitFailure(failure, false);
                    throw new AgyCliBackendError(failure.kind, { exitCode: failure.exitCode });
                }
            } catch (error) {
                const failure = classifySetupFailure(error instanceof Error ? error : String(error));
                emitFailure(failure, false);
                throw new AgyCliBackendError(failure.kind, { exitCode: failure.exitCode, message: failure.message });
            }

            const userMessage = makeUserMessage(options.userRequest);
            this.sessionManager.appendMessage(userMessage);
            this.messages.push(userMessage as AgentMessage);
            appendExecutionBackendEntry(this.sessionManager, this.model, {
                requestId: options.requestId,
                attemptId: options.attemptId,
                thinkingLevel: this.thinkingLevel || "off",
                effort,
            });

            const messageId = `agy-cli-assistant:${crypto.randomUUID()}`;
            const parseOutcomePromise = parseAgyCliStream(process.stdout, {
                onDelta: (delta) => {
                    emitHostedSessionRuntimeEvent(this.hostedSession, {
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        messageId,
                        delta: delta.text,
                        agentName: this.agentDisplayName,
                        messageKind: "assistant",
                    });
                },
            }).then(
                (parsed): AgyParseOutcome => ({ parsed, parseError: null }),
                (error): AgyParseOutcome => ({
                    parsed: null,
                    parseError: error instanceof Error ? error : new Error(String(error)),
                }),
            );
            const status = await waitForAgyProcessExit(process, parseOutcomePromise);
            process.kill();
            const [{ parsed, parseError }, stderrText] = await Promise.all([parseOutcomePromise, process.stderrText]);
            const acceptedTerminal = bridge?.acceptedTerminal === true;
            const failure = classifyTurnFailure({
                parsed,
                parseError,
                status,
                stderrText,
                bridgeDisconnected,
                expectedAgent: this.ownership.name,
                expectedModel: expectedBackendModel,
                signalAborted: combinedSignal.aborted,
            });
            if (failure) {
                process.kill();
                emitFailure(failure, acceptedTerminal);
                if (acceptedTerminal) return this.getMessages();
                throw new AgyCliBackendError(failure.kind, {
                    exitCode: failure.exitCode,
                    message: failure.message,
                });
            }
            if (!parsed) {
                const fallback = { kind: "empty_result", exitCode: status.code } satisfies ClassifiedFailure;
                emitFailure(fallback, acceptedTerminal);
                if (acceptedTerminal) return this.getMessages();
                throw new AgyCliBackendError(fallback.kind, { exitCode: fallback.exitCode });
            }

            const softFailure = classifySoftResultStatus(parsed);
            if (acceptedTerminal) {
                if (softFailure) emitFailure(softFailure, true);
                return this.getMessages();
            }
            if (this.persistModelChange) this.sessionManager.appendModelChange(this.model.provider, this.model.id);
            const assistantMessage = makeAssistantMessage(parsed.text, this.model, parsed.metadata.usage);
            this.sessionManager.appendMessage(assistantMessage);
            appendExecutionBackendEntry(this.sessionManager, this.model, {
                requestId: options.requestId,
                attemptId: options.attemptId,
                externalConversationId: parsed.metadata.sessionId,
                thinkingLevel: this.thinkingLevel || "off",
                effort,
                backendModel: parsed.metadata.model,
            });
            this.messages.push(assistantMessage as AgentMessage);
            emitHostedSessionRuntimeEvent(this.hostedSession, {
                type: RuntimeEventTypes.USAGE,
                usage: toRuntimeUsage(parsed.metadata.usage),
            });
            if (softFailure) emitFailure(softFailure, false);
            return this.getMessages();
        } finally {
            if (bridge) await bridge.close();
            this.activeProcess = null;
            this.isStreaming = false;
            this.turnAbortController = null;
        }
    }

    private async verifyCustomAgentReady(signal: AbortSignal): Promise<void> {
        await verifyAgyCustomAgentOwnership(this.ownership);
        await verifyAgyCustomAgentListed(this.ownership.name, this.cwd, signal);
    }

    private emitCleanupWarning(error: Error | string): void {
        if (this.cleanupStatusEmitted) return;
        this.cleanupStatusEmitted = true;
        emitAgyBackendStatus(
            this.hostedSession,
            this.sessionManager,
            buildAgyBackendStatusEntry("cleanup_failed", { message: getErrorText(error) }),
        );
    }

    private readMessages(): AgentMessage[] {
        return readExternalCliConversation(this.sessionManager).map((message) => {
            return message.role === "user"
                ? makeUserMessage(message.text) as AgentMessage
                : makeAssistantMessage(message.text, this.model, zeroUsage()) as AgentMessage;
        });
    }
}

async function waitForAgyProcessExit(
    process: AgyCliProcessResult,
    parseOutcomePromise: Promise<AgyParseOutcome>,
): Promise<AgyCliProcessStatus> {
    const first = await Promise.race([
        process.completed.then((status) => ({ kind: "status" as const, status })),
        parseOutcomePromise.then((outcome) => ({ kind: "parse" as const, outcome })),
    ]);
    if (first.kind === "status") return first.status;
    return await process.completed;
}

function classifySetupFailure(error: Error | string): ClassifiedFailure {
    if (error instanceof AgyCliBackendError) {
        return {
            kind: error.kind,
            exitCode: error.exitCode,
            ...(error.kind === "custom_agent_invalid" ? {} : { message: error.message }),
        };
    }
    const message = getErrorText(error);
    if (isAgyAuthFailure(message)) return { kind: "auth_failed", exitCode: null, message };
    if (isAgyMcpUnavailable(message)) return { kind: "mcp_unavailable", exitCode: null, message };
    return { kind: "custom_agent_invalid", exitCode: null };
}

async function verifyAgyCustomAgentListed(agentName: string, cwd: string, signal?: AbortSignal): Promise<void> {
    const processPort = new DenoAgyCliProcessPort();
    const result = processPort.run(prepareAgyCliAgentsCommand(), cwd, signal);
    const stdoutTextPromise = new Response(result.stdout).text().catch(() => "");
    const [status, stderrText, stdoutText] = await Promise.all([
        result.completed,
        result.stderrText,
        stdoutTextPromise,
    ]);
    if (!status.success) {
        const detail = stderrText || `agy /agents exited with code ${status.code}`;
        if (signal?.aborted || status.terminatedBy === "abort") {
            throw new AgyCliBackendError("canceled", { exitCode: status.code });
        }
        if (status.terminatedBy === "timeout") {
            throw new AgyCliBackendError("timeout", { exitCode: status.code });
        }
        if (isAgyAuthFailure(detail)) {
            throw new AgyCliBackendError("auth_failed", { exitCode: status.code, message: detail });
        }
        if (isAgyMcpUnavailable(detail)) {
            throw new AgyCliBackendError("mcp_unavailable", { exitCode: status.code, message: detail });
        }
        throw new AgyCliBackendError("custom_agent_invalid", { exitCode: status.code, message: detail });
    }
    let parsed: JsonValue;
    try {
        parsed = JSON.parse(stdoutText) as JsonValue;
    } catch {
        throw new AgyCliBackendError("custom_agent_invalid", { message: "agy /agents did not return JSON" });
    }
    if (!agentListContainsExactName(parsed, agentName)) {
        throw new AgyCliBackendError("custom_agent_invalid", {
            message: "agy /agents did not list the expected RunWield custom agent",
        });
    }
}

function classifyTurnFailure(options: {
    parsed: AgyCliParseResult | null;
    parseError: Error | null;
    status: AgyCliProcessStatus;
    stderrText: string;
    bridgeDisconnected: boolean;
    expectedAgent: string;
    expectedModel: string;
    signalAborted: boolean;
}): ClassifiedFailure | null {
    const { parsed, parseError, status, stderrText, bridgeDisconnected, expectedAgent, expectedModel, signalAborted } =
        options;
    if (status.terminatedBy === "abort" && signalAborted) return { kind: "canceled", exitCode: status.code };
    if (status.terminatedBy === "timeout") return { kind: "timeout", exitCode: status.code };
    const processDetail = stderrText || parsed?.metadata.errorText || parsed?.text || "";
    if ((parseError || !status.success) && isAgyAuthFailure(processDetail)) {
        return { kind: "auth_failed", exitCode: status.code, message: processDetail };
    }
    if ((parseError || !status.success) && isAgyPermissionDenied(processDetail)) {
        return { kind: "permission_denied", exitCode: status.code, message: processDetail };
    }
    if ((parseError || !status.success) && isAgyMcpUnavailable(processDetail)) {
        return { kind: "mcp_unavailable", exitCode: status.code, message: processDetail };
    }
    if (!status.success && status.terminatedBy !== "abort") {
        return { kind: "non_zero_exit", exitCode: status.code, message: processDetail };
    }
    if (parseError) {
        if (parseError instanceof AgyCliStreamError) {
            return { kind: parseError.kind, exitCode: status.code };
        }
        return { kind: "malformed_stream", exitCode: status.code, message: parseError.message };
    }
    if (!parsed) return { kind: "empty_result", exitCode: status.code };
    if (parsed.metadata.agent && parsed.metadata.agent !== expectedAgent) {
        return { kind: "selection_mismatch", exitCode: status.code };
    }
    if (parsed.metadata.model !== expectedModel) {
        return {
            kind: "selection_mismatch",
            exitCode: status.code,
            message: `Antigravity CLI reported model ${
                parsed.metadata.model || "[missing]"
            } instead of ${expectedModel}.`,
        };
    }
    if (!isResultStatusSuccess(parsed.metadata.status)) {
        if (parsed.text && (parsed.metadata.permissionDenied || parsed.metadata.mcpUnavailable)) return null;
        if (parsed.metadata.authFailed) {
            return { kind: "auth_failed", exitCode: status.code, message: parsed.metadata.errorText };
        }
        if (parsed.metadata.permissionDenied) {
            return { kind: "permission_denied", exitCode: status.code, message: parsed.metadata.errorText };
        }
        if (parsed.metadata.mcpUnavailable) {
            return { kind: "mcp_unavailable", exitCode: status.code, message: parsed.metadata.errorText };
        }
        return { kind: "non_zero_exit", exitCode: status.code, message: parsed.metadata.errorText || parsed.text };
    }
    if (bridgeDisconnected) return { kind: "bridge_disconnected", exitCode: status.code };
    return null;
}

function classifySoftResultStatus(parsed: AgyCliParseResult): ClassifiedFailure | null {
    if (!parsed.text) return null;
    if (parsed.metadata.permissionDenied) {
        return { kind: "permission_denied", exitCode: 0, message: parsed.metadata.errorText || parsed.text };
    }
    if (parsed.metadata.mcpUnavailable) {
        return { kind: "mcp_unavailable", exitCode: 0, message: parsed.metadata.errorText || parsed.text };
    }
    return null;
}

function isResultStatusSuccess(status: string): boolean {
    return !status || status === "success" || status === "ok" || status === "completed";
}

function getErrorText(error: Error | string): string {
    return error instanceof Error ? error.message : String(error);
}

function formatAgyCustomAgentDefinition(systemPrompt: string, displayName: string): string {
    return [
        "---",
        `description: Temporary RunWield ${displayName} execution agent`,
        "---",
        "",
        systemPrompt.trim(),
        "",
    ].join("\n");
}

function makeTemporaryAgentSelector(agentName: string): string {
    const sanitized = agentName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
    return `runwield-${sanitized}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function thinkingLevelToEffort(modelId: string, thinkingLevel: string | undefined): "low" | "medium" | "high" {
    switch (thinkingLevel || "off") {
        case "off":
        case "minimal":
        case "low":
            return "low";
        case "medium":
            return modelId === "gemini-3.1-pro" ? "high" : "medium";
        case "high":
        case "xhigh":
        case "max":
            return "high";
        default:
            throw new Error(`Unknown RunWield thinkingLevel "${thinkingLevel}".`);
    }
}

function concreteAgyModel(modelId: string, effort: "low" | "medium" | "high"): string {
    return `${modelId}-${effort}`;
}

type JsonScalar = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonRecord {
    [key: string]: JsonValue;
}
type JsonValue = JsonScalar | JsonArray | JsonRecord;

function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readAgentList(value: JsonValue): JsonArray | null {
    if (Array.isArray(value)) return value;
    if (isJsonRecord(value) && Array.isArray(value.agents)) return value.agents;
    return null;
}

function agentEntryMatchesName(value: JsonValue, expected: string): boolean {
    if (typeof value === "string") return value === expected;
    if (!isJsonRecord(value)) return false;
    return value.name === expected;
}

function agentListContainsExactName(value: JsonValue, expected: string): boolean {
    const agents = readAgentList(value);
    return Boolean(agents?.some((agent) => agentEntryMatchesName(agent, expected)));
}

function makeUserMessage(text: string): SessionAppendMessage {
    return {
        role: "user",
        timestamp: Date.now(),
        content: [{ type: "text", text }],
    };
}

function makeAssistantMessage(text: string, model: RunWieldModel, usage: AgyCliUsage): SessionAppendMessage {
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

function zeroUsage(): AgyCliUsage {
    return { inputTokens: 0, outputTokens: 0 };
}

function toPiUsage(usage: AgyCliUsage) {
    return {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: usage.inputTokens + usage.outputTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}

function toRuntimeUsage(usage: AgyCliUsage) {
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
    };
}

function appendExecutionBackendEntry(
    sessionManager: SessionManager,
    model: RunWieldModel,
    options: {
        requestId?: string;
        attemptId?: string;
        externalConversationId?: string;
        thinkingLevel?: string;
        effort?: "low" | "medium" | "high";
        backendModel?: string;
    },
): void {
    sessionManager.appendCustomEntry("runwield.execution_backend", {
        version: 1,
        backend: "agy-cli",
        provider: model.provider,
        model: model.id,
        outputFormat: "stream-json",
        ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
        ...(options.effort ? { effort: options.effort } : {}),
        ...(options.backendModel ? { backendModel: options.backendModel } : {}),
        ...(options.requestId ? { requestId: options.requestId } : {}),
        ...(options.attemptId ? { attemptId: options.attemptId } : {}),
        ...(options.externalConversationId ? { externalConversationId: options.externalConversationId } : {}),
    });
}
