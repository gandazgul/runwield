import { assertEquals, assertStringIncludes } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import { attachSessionEventSubscribers } from "./session.js";
import { createSessionRuntimeEvent } from "./session-runtime-events.js";

/**
 * @returns {{ session: any, emit: (event: any) => void, unsubscribed: () => boolean }}
 */
function makeSubscribableSession() {
    /** @type {((event: any) => void) | null} */
    let subscriber = null;
    let unsubscribed = false;
    return {
        session: {
            /** @param {(event: any) => void} fn */
            subscribe(fn) {
                subscriber = fn;
                return () => {
                    unsubscribed = true;
                    subscriber = null;
                };
            },
        },
        emit(event) {
            if (!subscriber) throw new Error("no subscriber registered");
            subscriber(event);
        },
        unsubscribed: () => unsubscribed,
    };
}

/** @param {string} id */
function makeRuntimeHarness(id) {
    const hostedSession = new HostedSession({ id, cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    hostedSession.setEventSink({
        emit: (/** @type {any} */ event) => events.push(createSessionRuntimeEvent(id, event)),
    });
    return { hostedSession, events };
}

const agentDef = /** @type {any} */ ({ name: "tester", displayName: "Tester" });

Deno.test("session subscriber emits thinking, message, status, error, usage, and lifecycle events only", () => {
    const { session, emit } = makeSubscribableSession();
    const { hostedSession, events } = makeRuntimeHarness("subscriber-streams");
    const state = attachSessionEventSubscribers(session, agentDef, undefined, hostedSession);

    emit({ type: "turn_start", turnId: "turn-known" });
    emit({ type: "message_start", message: { id: "assistant-known", role: "assistant" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "think 1" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "think 2" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer 1" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer 2" } });
    emit({
        type: "message_end",
        message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "model exploded",
            usage: { input: 12, output: 4 },
        },
    });
    emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 2, errorMessage: "retry", delayMs: 10 });
    emit({ type: "auto_retry_end", success: false, attempt: 2, finalError: "still failed" });
    emit({ type: "compaction_start", reason: "overflow" });
    emit({ type: "compaction_end", reason: "overflow", result: { tokensBefore: 1000 } });
    emit({ type: "turn_end" });

    const thinking = events.filter((event) => event.type === "assistant_thinking_delta");
    const text = events.filter((event) => event.type === "assistant_text_delta");
    assertEquals(thinking.length, 2);
    assertEquals(thinking[0].messageId, thinking[1].messageId);
    assertStringIncludes(thinking[0].messageId, "turn-known:thinking:");
    assertEquals(events.filter((event) => event.type === "assistant_thinking_end").length, 1);
    assertEquals(text.map((event) => event.delta), ["answer 1", "answer 2"]);
    assertEquals(text.every((event) => event.messageId === "assistant-known"), true);
    assertEquals(text.every((event) => event.agentName === "Tester" && event.messageKind === "assistant"), true);
    assertEquals(events.find((event) => event.type === "usage")?.usage, {
        inputTokens: 12,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
    });
    assertEquals(events.filter((event) => event.type === "terminal_error").length, 1);
    assertEquals(events.filter((event) => event.type === "system_status").length, 4);
    assertEquals(events.filter((event) => event.type === "turn_start").length, 1);
    assertEquals(events.filter((event) => event.type === "turn_end").length, 1);
    state.endThinking();
    assertEquals(events.filter((event) => event.type === "assistant_thinking_end").length, 1);
});

Deno.test("session subscriber maps one Pi tool lifecycle to one runtime tool lifecycle", () => {
    const { session, emit, unsubscribed } = makeSubscribableSession();
    const { hostedSession, events } = makeRuntimeHarness("subscriber-tools");
    const state = attachSessionEventSubscribers(session, agentDef, undefined, hostedSession);

    emit({ type: "turn_start", turnId: "tool-turn" });
    emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "echo hi" } });
    emit({
        type: "tool_execution_update",
        toolCallId: "tool-1",
        toolName: "bash",
        partialResult: { content: [{ text: "hi" }] },
    });
    emit({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "bash",
        isError: false,
        result: { content: [{ text: "hi\n" }] },
    });
    emit({ type: "tool_execution_start", toolCallId: "tool-2", toolName: "plan_written", args: { planName: "p" } });
    emit({ type: "tool_execution_start", toolCallId: "tool-3", toolName: "user_interview", args: {} });

    const toolEvents = events.filter((event) => event.type.startsWith("tool_"));
    assertEquals(toolEvents.map((event) => event.type), [
        "tool_start",
        "tool_update",
        "tool_end",
        "tool_start",
        "tool_start",
    ]);
    assertEquals(toolEvents[0].title, "$ echo hi");
    assertEquals(toolEvents[0].kind, "execute");
    assertEquals(toolEvents[1].output, "hi");
    assertEquals(toolEvents[1].content, [{ type: "text", text: "hi" }]);
    assertEquals(toolEvents[1].details, null);
    assertEquals(toolEvents[2].output, "hi\n");
    assertEquals(toolEvents[2].title, "$ echo hi");
    assertEquals(toolEvents[2].kind, "execute");
    assertEquals(typeof toolEvents[2].durationMs, "number");
    assertEquals(
        events.filter((event) => event.type === "attention_requested").map((event) => event.reason),
        ["planWritten", "userInterview"],
    );
    assertEquals(state.drainInvokedToolNames(), ["bash", "plan_written", "user_interview"]);
    state.unsubscribe();
    assertEquals(unsubscribed(), true);
});

Deno.test("session subscriber writes debug stream logs without any presentation port", async () => {
    const { session, emit } = makeSubscribableSession();
    const { hostedSession } = makeRuntimeHarness("subscriber-debug");
    const debugLogPath = await Deno.makeTempFile({ prefix: "runwield-subscriber-log-test-", suffix: ".log" });
    try {
        attachSessionEventSubscribers(session, agentDef, debugLogPath, hostedSession);
        emit({ type: "message_start", message: { role: "assistant" } });
        emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "thinking live" } });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "writing live" } });
        const log = await Deno.readTextFile(debugLogPath);
        assertStringIncludes(log, "Event: MESSAGE START");
        assertStringIncludes(log, "thinking live");
        assertStringIncludes(log, "writing live");
    } finally {
        await Deno.remove(debugLogPath);
    }
});
