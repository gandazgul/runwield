import { assertEquals } from "@std/assert";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { applySessionTemperature } from "./session.js";

/**
 * @typedef {Object} StreamCall
 * @property {import('@earendil-works/pi-ai').Model<any>} model
 * @property {import('@earendil-works/pi-ai').SimpleStreamOptions | undefined} options
 */

/**
 * @param {import('@earendil-works/pi-ai').Model<any>} model
 * @param {string} [errorMessage]
 * @returns {import('@earendil-works/pi-ai').AssistantMessage}
 */
function assistantMessage(model, errorMessage) {
    return {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: errorMessage ? "error" : "stop",
        ...(errorMessage ? { errorMessage } : {}),
        timestamp: Date.now(),
    };
}

/**
 * @param {import('@earendil-works/pi-ai').Model<any>} model
 * @param {string} [errorMessage]
 * @returns {import('@earendil-works/pi-ai').AssistantMessageEventStream}
 */
function completedStream(model, errorMessage) {
    const stream = createAssistantMessageEventStream();
    const message = assistantMessage(model, errorMessage);
    stream.push({ type: "start", partial: message });
    if (errorMessage) {
        stream.push({ type: "error", reason: "error", error: message });
    } else {
        stream.push({ type: "done", reason: "stop", message });
    }
    return stream;
}

/**
 * @param {(model: import('@earendil-works/pi-ai').Model<any>, options: import('@earendil-works/pi-ai').SimpleStreamOptions | undefined, calls: StreamCall[]) => import('@earendil-works/pi-ai').AssistantMessageEventStream} responder
 * @returns {{ session: import('@earendil-works/pi-coding-agent').AgentSession, calls: StreamCall[] }}
 */
function fakeSession(responder) {
    /** @type {StreamCall[]} */
    const calls = [];
    const session = /** @type {import('@earendil-works/pi-coding-agent').AgentSession} */ ({
        agent: {
            streamFn(model, _context, options) {
                calls.push({ model, options });
                return responder(model, options, calls);
            },
        },
    });
    return { session, calls };
}

/**
 * @param {Partial<import('@earendil-works/pi-ai').Model<any>>} overrides
 * @returns {import('@earendil-works/pi-ai').Model<any>}
 */
function testModel(overrides) {
    return {
        id: "test-model",
        name: "Test model",
        api: "openai-responses",
        provider: "test",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000,
        maxTokens: 1000,
        ...overrides,
    };
}

Deno.test("applySessionTemperature omits temperature for the Codex provider", async () => {
    const { session, calls } = fakeSession((model) => completedStream(model));
    applySessionTemperature(session, 0.4);

    const model = testModel({
        id: "gpt-5.6-sol",
        provider: "openai-codex",
        api: "openai-codex-responses",
    });
    const events = [];
    const source = await session.agent.streamFn(model, { messages: [] }, { temperature: 0.9 });
    for await (const event of source) {
        events.push(event.type);
    }

    assertEquals(calls.length, 1);
    assertEquals(calls[0].options, {});
    assertEquals(events, ["start", "done"]);
});

Deno.test("applySessionTemperature still configures providers that accept it", async () => {
    const { session, calls } = fakeSession((model) => completedStream(model));
    applySessionTemperature(session, 0.4);

    const model = testModel({ id: "temperature-model" });
    const source = await session.agent.streamFn(model, { messages: [] }, { maxTokens: 100 });
    for await (const _event of source) {
        // Consume the wrapped stream.
    }

    assertEquals(calls.length, 1);
    assertEquals(calls[0].options, { maxTokens: 100, temperature: 0.4 });
});

Deno.test("applySessionTemperature retries exact unsupported parameter errors without duplicate start", async () => {
    const { session, calls } = fakeSession((model, options) => {
        if (options?.temperature !== undefined) {
            return completedStream(model, "Codex error: Unsupported parameter: temperature");
        }
        return completedStream(model);
    });
    applySessionTemperature(session, 0.4);

    const model = testModel({ id: "future-reasoning-model" });
    const events = [];
    const source = await session.agent.streamFn(model, { messages: [] }, { maxTokens: 100 });
    for await (const event of source) {
        events.push(event.type);
    }

    assertEquals(calls.map((call) => call.options), [
        { maxTokens: 100, temperature: 0.4 },
        { maxTokens: 100 },
    ]);
    assertEquals(events, ["start", "done"]);
});
