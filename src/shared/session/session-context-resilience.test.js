import { assert, assertEquals } from "@std/assert";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Agent } from "@earendil-works/pi-agent-core";
import {
    AgentSession,
    createAgentSession,
    estimateTokens,
    VERSION as PI_CODING_AGENT_VERSION,
} from "@earendil-works/pi-coding-agent";
import {
    AgentSession as LatestObservedAgentSession,
    createAgentSession as createLatestObservedAgentSession,
    VERSION as LATEST_OBSERVED_PI_CODING_AGENT_VERSION,
} from "@earendil-works/pi-coding-agent-latest-observed";
import { Agent as LatestObservedAgent } from "@earendil-works/pi-agent-core-latest-observed";
import { Type } from "@sinclair/typebox";

/** @returns {import('@earendil-works/pi-ai').Usage} */
function zeroUsage() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}

/**
 * @param {number} callIndex
 * @returns {import('@earendil-works/pi-ai').AssistantMessage}
 */
function makeToolCallMessage(callIndex) {
    return {
        role: "assistant",
        content: [{ type: "toolCall", id: `tool-${callIndex}`, name: "large_result", arguments: {} }],
        api: "faux",
        provider: "faux",
        model: "faux-context",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
    };
}

/** @returns {import('@earendil-works/pi-ai').AssistantMessage} */
function makeDoneMessage() {
    return {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: "faux",
        provider: "faux",
        model: "faux-context",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
    };
}

/**
 * @param {import('@earendil-works/pi-ai').AssistantMessage} message
 * @returns {import('@earendil-works/pi-ai').AssistantMessageEventStream}
 */
function messageStream(message) {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
        stream.push({ type: "start", partial: { ...message, content: [] } });
        if (message.stopReason === "error" || message.stopReason === "aborted") {
            stream.push({ type: "error", reason: message.stopReason, error: message });
            stream.end(message);
            return;
        }
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end(message);
    });
    return stream;
}

/**
 * @param {unknown[]} messages
 * @returns {number}
 */
function estimateContextMessagesTokens(messages) {
    let total = 0;
    for (const message of messages) {
        total += estimateTokens(/** @type {any} */ (message));
    }
    return total;
}

/**
 * @param {unknown[]} messages
 * @returns {boolean}
 */
function hasCompactionSummary(messages) {
    return JSON.stringify(messages).includes("Compaction Summary");
}

Deno.test("RunWield/Pi seam currently submits another provider call after tool-result pressure without compaction", async () => {
    const providerContexts =
        /** @type {{ call: number; completedToolResults: number; estimatedTokens: number; compacted: boolean }[]} */ ([]);
    let providerCalls = 0;
    let completedToolResults = 0;
    const contextWindow = 6_000;
    const reserveTokens = 1_000;
    const triggerThreshold = contextWindow - reserveTokens;
    const resultText = "x".repeat(6_000);

    const agent = new Agent({
        initialState: {
            systemPrompt: "system",
            model: {
                id: "faux-context",
                name: "Faux Context",
                api: "faux",
                provider: "faux",
                baseUrl: "http://localhost:0",
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                reasoning: false,
                contextWindow,
                maxTokens: reserveTokens,
            },
            tools: [{
                name: "large_result",
                label: "Large Result",
                description: "Return a large deterministic tool result.",
                parameters: Type.Object({}),
                execute: () => {
                    completedToolResults++;
                    return Promise.resolve({ content: [{ type: "text", text: resultText }], details: {} });
                },
            }],
        },
        streamFn: (_model, context) => {
            providerCalls++;
            providerContexts.push({
                call: providerCalls,
                completedToolResults,
                estimatedTokens: estimateContextMessagesTokens(context.messages),
                compacted: hasCompactionSummary(context.messages),
            });
            return messageStream(providerCalls <= 6 ? makeToolCallMessage(providerCalls) : makeDoneMessage());
        },
    });

    await agent.prompt("start");

    assertEquals(completedToolResults, 6);
    assertEquals(providerCalls, 7);
    const pressuredProviderCall = providerContexts.find((entry) =>
        entry.completedToolResults >= 4 && entry.estimatedTokens > triggerThreshold
    );
    assert(pressuredProviderCall, `expected context pressure above W - R (${triggerThreshold}) before a provider call`);
    assertEquals(
        pressuredProviderCall.compacted,
        false,
        "current seam should show the missing behavior: no compaction summary before the next provider call",
    );
    assert(
        providerContexts.some((entry) => entry.call > pressuredProviderCall.call),
        "expected at least one provider call after the pressured completed tool-result turn",
    );
});

/**
 * @param {{ AgentSessionClass: any; AgentClass: any; createSession: Function }} api
 */
function characterizePublicContextResilienceContract(api) {
    const agentSessionMethods = Object.getOwnPropertyNames(api.AgentSessionClass.prototype);
    const agentMethods = Object.getOwnPropertyNames(api.AgentClass.prototype);
    const publicAgentSessionMethods = agentSessionMethods.filter((name) => !name.startsWith("_"));
    const createSessionSource = api.createSession.toString();
    return {
        publicAgentSessionMethods,
        agentMethods,
        hasCompletedTurnStopHook: publicAgentSessionMethods.includes("shouldStopAfterTurn") ||
            publicAgentSessionMethods.includes("stopAfterTurn") || createSessionSource.includes("shouldStopAfterTurn"),
        hasRecoveryNumbersBeforeContinuation: publicAgentSessionMethods.includes("getCompactionRecovery") ||
            publicAgentSessionMethods.includes("compactAndMeasure"),
        hasPublicContinuationAfterManagedCompaction: publicAgentSessionMethods.includes("continueAfterCompaction") ||
            publicAgentSessionMethods.includes("continue"),
        hasQueueOrderContractForContinuation: publicAgentSessionMethods.includes("enqueueContinuation") ||
            publicAgentSessionMethods.includes("queueContinuation"),
        hasPrivateAutoCompactionOnly: agentSessionMethods.includes("_runAutoCompaction"),
        hasLowLevelAgentLoopConfig: agentMethods.includes("createLoopConfig"),
    };
}

Deno.test("selected public Pi AgentSession contract lacks the required completed-turn stop and recovery hook", async () => {
    const repositoryRoot = new URL("../../../", import.meta.url);
    const denoConfig = JSON.parse(await Deno.readTextFile(new URL("deno.json", repositoryRoot)));
    assertEquals(
        denoConfig.imports["@earendil-works/pi-coding-agent"],
        `npm:@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}`,
    );
    assertEquals(
        denoConfig.imports["@earendil-works/pi-agent-core"],
        `npm:@earendil-works/pi-agent-core@${PI_CODING_AGENT_VERSION}`,
    );
    assertEquals(denoConfig.imports["@earendil-works/pi-ai"], `npm:@earendil-works/pi-ai@${PI_CODING_AGENT_VERSION}`);

    const contract = characterizePublicContextResilienceContract({
        AgentSessionClass: AgentSession,
        AgentClass: Agent,
        createSession: createAgentSession,
    });

    assertEquals(contract.hasCompletedTurnStopHook, false);
    assertEquals(contract.hasRecoveryNumbersBeforeContinuation, false);
    assertEquals(contract.hasPublicContinuationAfterManagedCompaction, false);
    assertEquals(contract.hasQueueOrderContractForContinuation, false);
    assertEquals("shouldStopAfterTurn" in Agent.prototype, false);
    assertEquals(
        contract.hasLowLevelAgentLoopConfig,
        true,
        "low-level Agent exposes loop config only below RunWield's AgentSession seam",
    );
    assertEquals(
        contract.hasPrivateAutoCompactionOnly,
        true,
        "AgentSession compaction remains private and must not be used by RunWield",
    );
});

Deno.test("latest observed public Pi AgentSession contract still blocks mid-run context resilience", () => {
    assertEquals(LATEST_OBSERVED_PI_CODING_AGENT_VERSION, "0.82.1");

    const contract = characterizePublicContextResilienceContract({
        AgentSessionClass: LatestObservedAgentSession,
        AgentClass: LatestObservedAgent,
        createSession: createLatestObservedAgentSession,
    });

    assertEquals(contract.hasCompletedTurnStopHook, false);
    assertEquals(
        contract.hasRecoveryNumbersBeforeContinuation,
        false,
        "without public recovery numbers, RunWield cannot decide whether continuation is safe",
    );
    assertEquals(
        contract.hasPublicContinuationAfterManagedCompaction,
        false,
        "without a public AgentSession continuation contract, RunWield cannot preserve queued-message ordering",
    );
    assertEquals(contract.hasQueueOrderContractForContinuation, false);
    assertEquals(
        contract.hasLowLevelAgentLoopConfig,
        true,
        "0.82.1 exposes only lower-level Agent loop control, not the public AgentSession contract RunWield may use",
    );
    assertEquals(contract.hasPrivateAutoCompactionOnly, true);
});
