import { assert, assertEquals } from "@std/assert";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
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

Deno.test("current Pi Agent runs long tool-result loop without a public mid-run compaction stop", async () => {
    const providerContextTexts = /** @type {string[]} */ ([]);
    let providerCalls = 0;
    let completedToolResults = 0;
    const pressureThreshold = 5_000;
    const resultText = "x".repeat(1_200);

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
                contextWindow: 6_000,
                maxTokens: 1_000,
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
            providerContextTexts.push(JSON.stringify(context.messages));
            return messageStream(providerCalls <= 6 ? makeToolCallMessage(providerCalls) : makeDoneMessage());
        },
    });

    await agent.prompt("start");

    assertEquals(completedToolResults, 6);
    assertEquals(providerCalls, 7);
    const finalContextText = providerContextTexts.at(-1);
    assert(finalContextText, "expected a final provider context");
    assert(
        finalContextText.length > pressureThreshold,
        `expected accumulated tool results above threshold; got ${finalContextText.length}`,
    );
});

Deno.test("current public Agent API has no shouldStopAfterTurn hook for AgentSession consumers", () => {
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
                contextWindow: 6_000,
                maxTokens: 1_000,
            },
            tools: [],
        },
        streamFn: (_model, _context) => messageStream(makeDoneMessage()),
    });

    assertEquals("shouldStopAfterTurn" in agent, false);
});
