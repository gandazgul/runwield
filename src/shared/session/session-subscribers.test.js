import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { attachUiSubscribers } from "./session.js";
import { HostedSession } from "./hosted-session.js";

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

/**
 * @returns {any}
 */
function makeUi() {
    const toolBlocks = new Map();
    return {
        thinking: "",
        thinkingEnded: 0,
        agentMessages: /** @type {Array<{ agentName: string, text: string }>} */ ([]),
        systemMessages: /** @type {Array<{ text: string, isError: boolean }>} */ ([]),
        tools: /** @type {Array<{ id: string, name: string, args: string }>} */ ([]),
        busyStates: /** @type {boolean[]} */ ([]),
        renderCount: 0,
        appendThinkingStart() {
            return {
                /** @param {string} delta */
                appendDelta: (delta) => {
                    this.thinking += delta;
                },
                end: () => {
                    this.thinkingEnded++;
                },
            };
        },
        /** @param {string} agentName */
        appendAgentMessageStart(agentName) {
            const entry = { agentName, text: "" };
            this.agentMessages.push(entry);
            return {
                /** @param {string} delta */
                appendText: (delta) => {
                    entry.text += delta;
                },
            };
        },
        /**
         * @param {string} text
         * @param {boolean} [isError]
         */
        appendSystemMessage(text, isError = false) {
            this.systemMessages.push({ text, isError });
        },
        /**
         * @param {string} id
         * @param {string} name
         * @param {string} args
         */
        startToolExecution(id, name, args) {
            const block = {
                bodyText: "",
                startTime: Date.now(),
                isError: false,
                durationMs: 0,
                /** @param {string} delta */
                appendOutput(delta) {
                    this.bodyText += delta;
                },
                ended: false,
                /**
                 * @param {boolean} isError
                 * @param {number} durationMs
                 */
                endExecution(isError, durationMs) {
                    this.ended = true;
                    this.isError = isError;
                    this.durationMs = durationMs;
                },
            };
            toolBlocks.set(id, block);
            this.tools.push({ id, name, args });
            return block;
        },
        /** @param {string} id */
        getActiveToolBlock(id) {
            return toolBlocks.get(id);
        },
        requestRender() {
            this.renderCount++;
        },
        /** @param {boolean} value */
        setBusy(value) {
            this.busyStates.push(value);
        },
    };
}

const agentDef = /** @type {any} */ ({ displayName: "Tester" });

Deno.test("attachUiSubscribers renders assistant text, thinking, retries, compaction, and busy state", () => {
    const { session, emit } = makeSubscribableSession();
    const ui = makeUi();
    const state = attachUiSubscribers(session, agentDef, ui);

    emit({ type: "turn_start" });
    emit({ type: "message_start", message: { role: "assistant" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_end" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });
    emit({ type: "message_end", message: { role: "assistant" } });
    emit({ type: "auto_retry_start", attempt: 2, maxAttempts: 4, errorMessage: "rate limited", delayMs: 250 });
    emit({ type: "auto_retry_end", success: false, attempt: 4, finalError: "still rate limited" });
    emit({ type: "compaction_start", reason: "overflow" });
    emit({ type: "compaction_end", reason: "overflow", result: { tokensBefore: 12345 } });
    emit({ type: "compaction_end", reason: "overflow", aborted: true });
    emit({ type: "compaction_end", reason: "overflow", errorMessage: "summary failed" });
    emit({ type: "compaction_start", reason: "manual" });
    emit({ type: "compaction_end", reason: "manual", result: { tokensBefore: 1 } });
    emit({ type: "turn_end" });

    assertEquals(ui.busyStates, [true, false]);
    assertEquals(ui.thinking, "hmm");
    assertEquals(ui.thinkingEnded, 1);
    assertEquals(ui.agentMessages, [{ agentName: "Tester", text: "hello world" }]);
    assert(ui.systemMessages.some((/** @type {{ text: string }} */ m) => m.text.includes("[Retry 2/4] rate limited")));
    assert(
        ui.systemMessages.some((/** @type {{ text: string }} */ m) =>
            m.text.includes("Auto-retry failed after 4 attempts")
        ),
    );
    assert(ui.systemMessages.some((/** @type {{ text: string }} */ m) => m.text.includes("Context overflow detected")));
    assert(
        ui.systemMessages.some((/** @type {{ text: string }} */ m) =>
            m.text.includes("Auto-compacted. Tokens before: 12,345")
        ),
    );
    assert(ui.systemMessages.some((/** @type {{ text: string }} */ m) => m.text === "Auto-compaction cancelled."));
    assert(
        ui.systemMessages.some((/** @type {{ text: string }} */ m) =>
            m.text === "Auto-compaction failed: summary failed"
        ),
    );

    state.endThinking();
});

Deno.test("attachUiSubscribers streams assistant deltas to debug log path immediately", async () => {
    const { session, emit } = makeSubscribableSession();
    const ui = makeUi();
    const debugLogPath = await Deno.makeTempFile({ prefix: "runwield-subscriber-log-test-", suffix: ".log" });
    try {
        attachUiSubscribers(session, agentDef, ui, debugLogPath);

        emit({ type: "message_start", message: { role: "assistant" } });
        emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "thinking live" } });

        const afterThinking = await Deno.readTextFile(debugLogPath);
        assertStringIncludes(afterThinking, "Event: MESSAGE START");
        assertStringIncludes(afterThinking, "Event: ASSISTANT THINKING DELTA");
        assertStringIncludes(afterThinking, "thinking live");

        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "writing live" } });

        const afterText = await Deno.readTextFile(debugLogPath);
        assertStringIncludes(afterText, "Event: ASSISTANT TEXT DELTA");
        assertStringIncludes(afterText, "writing live");
    } finally {
        await Deno.remove(debugLogPath);
    }
});

Deno.test("attachUiSubscribers reports assistant error when the stream ends before text", () => {
    const { session, emit } = makeSubscribableSession();
    const ui = makeUi();
    attachUiSubscribers(session, agentDef, ui);

    emit({ type: "message_start", message: { role: "assistant" } });
    emit({
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "model exploded" },
    });

    assertEquals(ui.agentMessages.length, 1);
    assertEquals(ui.agentMessages[0].text.includes("**Error:** model exploded"), true);
});

Deno.test("attachUiSubscribers uses the target HostedSession active UI fallback", () => {
    const { session, emit } = makeSubscribableSession();
    const ui = makeUi();
    const otherUi = makeUi();
    const hostedSession = new HostedSession({ id: "subscriber-target", cwd: Deno.cwd() });
    const otherHostedSession = new HostedSession({ id: "subscriber-other", cwd: Deno.cwd(), uiAPI: otherUi });

    attachUiSubscribers(session, agentDef, undefined, undefined, hostedSession);
    hostedSession.setActiveUiAPI(ui);

    emit({ type: "message_start", message: { role: "assistant" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "reasoning" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer" } });

    assertEquals(ui.thinking, "reasoning");
    assertEquals(ui.thinkingEnded, 1);
    assertEquals(ui.agentMessages.length, 1);
    assertEquals(ui.agentMessages[0].text, "answer");
    assertEquals(otherHostedSession.getActiveUiAPIState(), otherUi);
    assertEquals(otherUi.agentMessages.length, 0, "other HostedSession UI must not receive target output");
});

Deno.test("attachUiSubscribers sends attention notifications for plan_written and user_interview", () => {
    const { session, emit } = makeSubscribableSession();
    const ui = makeUi();
    const hostedSession = new HostedSession({
        id: "subscriber-notifications",
        cwd: Deno.cwd(),
        sessionManager: /** @type {any} */ ({ getSessionName: () => "notification session" }),
    });
    /** @type {Array<{ eventName: string, sessionName: string | undefined, agentName: string | undefined }>} */
    const notifications = [];

    attachUiSubscribers(session, agentDef, ui, undefined, hostedSession, {
        notifyRunWieldEventQuietly: (
            /** @type {string} */ eventName,
            /** @type {{ sessionName?: string, agentName?: string }} */ options,
        ) => {
            notifications.push({ eventName, sessionName: options?.sessionName, agentName: options?.agentName });
        },
    });

    emit({ type: "tool_execution_start", toolCallId: "1", toolName: "plan_written", args: { planName: "p" } });
    emit({ type: "tool_execution_start", toolCallId: "2", toolName: "user_interview", args: { question: {} } });
    emit({ type: "tool_execution_start", toolCallId: "3", toolName: "bash", args: { command: "true" } });

    assertEquals(notifications, [
        { eventName: "planWritten", sessionName: "notification session", agentName: "Tester" },
        { eventName: "userInterview", sessionName: "notification session", agentName: "Tester" },
    ]);
});

Deno.test("attachUiSubscribers formats tool headers, streams output deltas, and drains invoked tools", () => {
    const { session, emit, unsubscribed } = makeSubscribableSession();
    const ui = makeUi();
    const state = attachUiSubscribers(session, agentDef, ui);

    const starts = [
        ["1", "read", { path: "src/a.js" }, "src/a.js", "read"],
        ["2", "edit", { file_path: "src/b.js" }, "src/b.js", "edit"],
        ["3", "write", { path: "src/c.js" }, "src/c.js", "write"],
        ["4", "bash", { command: "deno task test" }, "deno task test", "$"],
        ["5", "grep", { pattern: "needle", path: "src" }, "needle in src", "grep"],
        ["5b", "grep", { pattern: "needle", path: ["src", "tests"] }, "needle in src tests", "grep"],
        ["6", "find", { pattern: "*.js", path: "." }, "*.js in .", "find"],
        ["7", "ls", { path: "src" }, "src", "ls"],
        ["8", "code_search", { query: "foo", textSearch: true }, "foo (text)", "code_search"],
        ["9", "code_show", { target: "mod.fn" }, "mod.fn", "code_show"],
        ["10", "code_outline", { file: "src/a.js" }, "src/a.js", "code_outline"],
        [
            "10b",
            "code_batch",
            { operations: [{ op: "show", target: "mod.fn" }, { op: "outline", file: "src/a.js" }] },
            "show mod.fn; outline src/a.js",
            "code_batch",
        ],
        ["11", "code_refs", { symbol: "Thing" }, "Thing", "code_refs"],
        ["12", "code_importers", { target: "src/a.js" }, "src/a.js", "code_importers"],
        ["12b", "plan_written", { planName: "example-plan.md" }, "plans/example-plan.md", "plan_written"],
        ["13", "memory_recall", { query: "plans" }, "plans", "memory_recall"],
        ["14", "memory_store", { content: "short memory" }, "short memory", "memory_store"],
        ["15", "memory_delete", { id: 123 }, "id: 123", "memory_delete"],
        ["16", "return_to_router", {}, "to router", "return_to_router"],
        ["17", "code_structure", {}, "", "code_structure"],
    ];

    for (const [id, toolName, args, expectedArgs, expectedName] of starts) {
        emit({ type: "tool_execution_start", toolCallId: id, toolName, args });
        assertEquals(ui.tools.at(-1), { id, name: expectedName, args: expectedArgs });
    }

    emit({ type: "tool_execution_start", toolCallId: "18", toolName: "task_completed", args: { message: "done" } });
    assertEquals(ui.tools.some((/** @type {{ id: string }} */ tool) => tool.id === "18"), false);

    emit({
        type: "tool_execution_update",
        toolCallId: "4",
        partialResult: { content: [{ text: "hel" }, { text: "lo" }] },
    });
    emit({
        type: "tool_execution_update",
        toolCallId: "4",
        partialResult: { content: [{ text: "hello world" }] },
    });
    emit({
        type: "tool_execution_end",
        toolCallId: "4",
        toolName: "bash",
        isError: false,
        result: { content: [{ text: "hello world!" }] },
    });
    const bashBlock = ui.getActiveToolBlock("4");
    assertEquals(bashBlock.bodyText, "hello world!");
    assertEquals(bashBlock.ended, true);

    assertEquals(state.drainInvokedToolNames(), starts.map((entry) => entry[1]).concat("task_completed"));
    assertEquals(state.drainInvokedToolNames(), []);
    state.unsubscribe();
    assertEquals(unsubscribed(), true);
});

Deno.test("attachUiSubscribers emits runtime events with turn and stable stream ids", () => {
    const { session, emit } = makeSubscribableSession();
    const hostedSession = new HostedSession({ id: "runtime-ids", cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    hostedSession.setEventSink({ emit: (/** @type {unknown} */ event) => events.push(event) });
    attachUiSubscribers(session, agentDef, undefined, undefined, hostedSession);

    emit({ type: "turn_start", turnId: "turn-known" });
    emit({ type: "message_start", message: { id: "assistant-known", role: "assistant" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "think 1" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "think 2" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer 1" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer 2" } });
    emit({ type: "turn_end" });

    const thinking = events.filter((event) => event.type === "assistant_thinking_delta");
    const text = events.filter((event) => event.type === "assistant_text_delta");
    assertEquals(events.every((event) => event.turnId === "turn-known"), true);
    assertEquals(thinking[0].messageId, thinking[1].messageId);
    assertStringIncludes(thinking[0].messageId, "turn-known:thinking:");
    assertEquals(text[0].messageId, "assistant-known");
    assertEquals(text[1].messageId, "assistant-known");
});

Deno.test("attachUiSubscribers emits runtime events without console fallback when sink is active", () => {
    const { session, emit } = makeSubscribableSession();
    const hostedSession = new HostedSession({ id: "runtime-sink", cwd: Deno.cwd() });
    /** @type {unknown[]} */
    const events = [];
    hostedSession.setEventSink({
        emit: (/** @type {unknown} */ event) => events.push(event),
    });
    const originalLog = console.log;
    /** @type {unknown[]} */
    const logs = [];
    console.log = (...args) => logs.push(args);
    try {
        attachUiSubscribers(session, agentDef, undefined, undefined, hostedSession);

        emit({ type: "message_start", message: { role: "assistant" } });
        emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "thinking" } });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer" } });
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
            result: { content: [{ text: "hi" }] },
        });
        emit({ type: "auto_retry_end", success: false, attempt: 2, finalError: "nope" });
        emit({ type: "compaction_start", reason: "overflow" });
    } finally {
        console.log = originalLog;
    }

    assertEquals(logs, []);
    assertEquals(
        events.map((/** @type {any} */ event) => event.type),
        [
            "assistant_thinking_delta",
            "assistant_text_delta",
            "tool_start",
            "tool_update",
            "tool_end",
            "system_status",
            "system_status",
        ],
    );
});
