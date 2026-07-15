import { assertEquals, assertThrows } from "@std/assert";
import { mapRuntimeEventToAcpUpdate } from "../../acp/event-mapper.js";
import { createSessionRuntimeEvent, RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { attachTuiRuntimeAdapter } from "./runtime-adapter.js";

function makeUi() {
    /** @type {string[]} */
    const transcript = [];
    /** @type {Map<string, any>} */
    const tools = new Map();
    const uiAPI = /** @type {import('./types.js').UiAPI} */ ({
        appendUserMessage: (text) => transcript.push(`user:${text}`),
        appendImage: (base64, mimeType) => transcript.push(`image:${mimeType}:${base64}`),
        appendQueuedMessage: (id, text) => transcript.push(`queue:add:${id}:${text}`),
        removeQueuedMessage: (id) => transcript.push(`queue:remove:${id}`),
        appendAgentMessageStart: (agentName) => ({
            appendText: (text) => transcript.push(`assistant:${agentName}:${text}`),
        }),
        appendThinkingStart: () => ({
            appendDelta: (text) => transcript.push(`thinking:${text}`),
            end: () => transcript.push("thinking:end"),
        }),
        appendSystemMessage: (text, isError) => transcript.push(`system:${isError ? "error" : "info"}:${text}`),
        startToolExecution: (id, name, args) => {
            const block = {
                bodyText: "",
                startTime: Date.now(),
                /** @param {string} text */
                appendOutput(text) {
                    this.bodyText += text;
                    transcript.push(`tool:update:${id}:${text}`);
                },
                /** @param {boolean} isError */
                endExecution(isError) {
                    transcript.push(`tool:end:${id}:${isError ? "error" : "ok"}`);
                },
            };
            tools.set(id, block);
            transcript.push(`tool:start:${id}:${name}:${args}`);
            return block;
        },
        getActiveToolBlock: (id) => tools.get(id),
        setBusy: (busy) => transcript.push(`busy:${busy}`),
        requestRender() {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector() {},
    });
    return { transcript, uiAPI };
}

/**
 * Runtime consumer contract fixture. It deliberately has no HostedSession;
 * the adapter can only subscribe by id and read public snapshots.
 *
 * @param {string} sessionId
 * @param {import('../../shared/session/session-runtime-events.js').RuntimeQueuedMessage[]} [queuedMessages]
 */
function makeRuntimeHarness(sessionId, queuedMessages = []) {
    /** @type {((event: any) => void) | null} */
    let listener = null;
    const runtime = /** @type {any} */ ({
        setInteractionAdapter: () => ({ ok: true }),
        subscribeSessionEvents: (/** @type {string} */ id, /** @type {(event: any) => void} */ next) => {
            if (id !== sessionId) throw new Error("wrong session id");
            listener = next;
            return () => {
                if (listener === next) listener = null;
            };
        },
        emitSessionEvent: (/** @type {string} */ id, /** @type {any} */ event) => {
            listener?.(createSessionRuntimeEvent(id, event));
        },
        getSessionSnapshot: (/** @type {string} */ id) => ({
            id,
            cwd: Deno.cwd(),
            name: null,
            queuedMessages,
        }),
    });
    return { runtime, sessionId };
}

Deno.test("TUI and ACP adapters consume the same semantic runtime transcript", () => {
    const { runtime, sessionId } = makeRuntimeHarness("adapter-parity");
    const { transcript, uiAPI } = makeUi();
    /** @type {Array<{ reason: string, sessionName: string | undefined, agentName: string | undefined }>} */
    const attentionRequests = [];
    const adapter = attachTuiRuntimeAdapter({
        runtime,
        sessionId,
        uiAPI,
        notifyRunWieldEvent: (reason, options) => {
            attentionRequests.push({
                reason,
                sessionName: options?.sessionName,
                agentName: options?.agentName,
            });
        },
    });
    const fixture =
        /** @type {Array<Partial<import('../../shared/session/session-runtime-events.js').SessionRuntimeEvent> & { type: string }>} */ ([
            { type: RuntimeEventTypes.USER_MESSAGE, text: "hello" },
            {
                type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                messageId: "answer-1",
                delta: "world",
                _meta: { agentName: "Guide" },
            },
            { type: RuntimeEventTypes.TOOL_START, toolCallId: "tool-1", toolName: "read", title: "read README.md" },
            { type: RuntimeEventTypes.TOOL_UPDATE, toolCallId: "tool-1", toolName: "read", text: "part" },
            {
                type: RuntimeEventTypes.TOOL_END,
                toolCallId: "tool-1",
                toolName: "read",
                text: "partial",
                isError: false,
            },
            { type: RuntimeEventTypes.SYSTEM_STATUS, level: "warning", message: "notice" },
            { type: RuntimeEventTypes.BUSY_CHANGED, busy: true },
            { type: RuntimeEventTypes.BUSY_CHANGED, busy: false },
            { type: RuntimeEventTypes.ATTENTION_REQUESTED, reason: "agentStopped", agentName: "Guide" },
        ]);

    for (const event of fixture) runtime.emitSessionEvent(sessionId, event);
    const acpUpdates = fixture.map((event) =>
        mapRuntimeEventToAcpUpdate(createSessionRuntimeEvent(sessionId, /** @type {any} */ (event)))
    ).filter(Boolean);
    adapter.dispose();

    assertEquals(transcript, [
        "user:hello",
        "assistant:Guide:world",
        "tool:start:tool-1:read:README.md",
        "tool:update:tool-1:part",
        "tool:update:tool-1:ial",
        "tool:end:tool-1:ok",
        "system:info:notice",
        "busy:true",
        "busy:false",
    ]);
    assertEquals(acpUpdates.map((update) => update?.sessionUpdate), [
        "user_message_chunk",
        "agent_message_chunk",
        "tool_call",
        "tool_call_update",
        "tool_call_update",
        "agent_message_chunk",
    ]);
    assertEquals(attentionRequests, [{ reason: "agentStopped", sessionName: undefined, agentName: "Guide" }]);
});

Deno.test("TUI renders Runtime cancellation events instead of key handlers rendering directly", () => {
    const { runtime, sessionId } = makeRuntimeHarness("adapter-cancellation");
    const { transcript, uiAPI } = makeUi();
    const adapter = attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI });

    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.CANCELLATION,
        aborted: true,
        reason: "session_cancel",
        scope: "agent",
        message: "Agent run canceled.",
    });
    adapter.dispose();

    assertEquals(transcript, ["system:info:Agent run canceled."]);
});

Deno.test("TUI adapter coalesces repeated thinking deltas and duplicate tool starts", () => {
    const { runtime, sessionId } = makeRuntimeHarness("adapter-coalesce");
    const { transcript, uiAPI } = makeUi();
    const adapter = attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI });

    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
        messageId: "thinking-1",
        delta: "Planning",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
        messageId: "thinking-1",
        delta: "Planning",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
        messageId: "thinking-1",
        delta: "Planning more",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId: "tool-1",
        toolName: "code_search",
        title: "code_search createAgentJobHandler",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId: "tool-1",
        toolName: "code_search",
        title: "code_search createAgentJobHandler",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.TOOL_UPDATE,
        toolCallId: "tool-1",
        toolName: "code_search",
        text: "result",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.TOOL_END,
        toolCallId: "tool-1",
        toolName: "code_search",
        text: "result",
        isError: false,
    });
    adapter.dispose();

    assertEquals(transcript, [
        "thinking:Planning",
        "thinking: more",
        "tool:start:tool-1:code_search:createAgentJobHandler",
        "tool:update:tool-1:result",
        "tool:end:tool-1:ok",
        "thinking:end",
    ]);
});

Deno.test("TUI adapter projects core queued, consumed, and dequeued message transitions", () => {
    const { runtime, sessionId } = makeRuntimeHarness("adapter-queue");
    const { transcript, uiAPI } = makeUi();
    const adapter = attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI });
    const firstMessage = /** @type {import('../../shared/session/session-runtime-events.js').RuntimeQueuedMessage} */ ({
        id: "queued-1",
        text: "revise this",
        images: [{ base64: "abc", mimeType: "image/png", ref: "attachment:abc" }],
        delivery: "steer",
        queuedAt: "2026-07-14T00:00:00.000Z",
    });
    const secondMessage =
        /** @type {import('../../shared/session/session-runtime-events.js').RuntimeQueuedMessage} */ ({
            id: "queued-2",
            text: "remove this",
            images: [],
            delivery: "steer",
            queuedAt: "2026-07-14T00:00:01.000Z",
        });

    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
        status: "queued",
        message: firstMessage,
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
        status: "consumed",
        message: firstMessage,
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.USER_MESSAGE,
        messageId: firstMessage.id,
        text: firstMessage.text,
        images: firstMessage.images,
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
        status: "queued",
        message: secondMessage,
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
        status: "dequeued",
        message: secondMessage,
    });
    adapter.dispose();

    assertEquals(transcript, [
        "queue:add:queued-1:revise this\n\n[Image attached: attachment:abc image/png]",
        "queue:remove:queued-1",
        "user:revise this",
        "image:image/png:abc",
        "queue:add:queued-2:remove this",
        "queue:remove:queued-2",
    ]);
});

Deno.test("TUI adapter hydrates queued messages from the core session snapshot", () => {
    const queued = /** @type {import('../../shared/session/session-runtime-events.js').RuntimeQueuedMessage} */ ({
        id: "already-queued",
        text: "already queued",
        images: [],
        delivery: "steer",
        queuedAt: "2026-07-14T00:00:00.000Z",
    });
    const { runtime, sessionId } = makeRuntimeHarness("adapter-queue-snapshot", [queued]);
    const { transcript, uiAPI } = makeUi();

    const adapter = attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI });
    adapter.dispose();

    assertEquals(transcript, [`queue:add:${queued.id}:already queued`]);
});

Deno.test("a second TUI adapter for one Runtime session fails instead of duplicating output", () => {
    const { runtime, sessionId } = makeRuntimeHarness("adapter-replacement");
    const { transcript, uiAPI } = makeUi();

    const previousAdapter = attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI });
    assertThrows(
        () => attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI }),
        Error,
        "already attached",
    );

    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
        messageId: "answer-1",
        delta: "once",
        _meta: { agentName: "Engineer" },
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
        messageId: "thinking-1",
        delta: "once",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId: "tool-1",
        toolName: "read",
        title: "read README.md",
    });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId: "tool-2",
        toolName: "code_structure",
        title: "code_structure",
    });

    previousAdapter.dispose();
    const activeAdapter = attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI });
    runtime.emitSessionEvent(sessionId, {
        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
        messageId: "answer-2",
        delta: "still active",
        _meta: { agentName: "Engineer" },
    });
    activeAdapter.dispose();

    assertEquals(transcript, [
        "assistant:Engineer:once",
        "thinking:once",
        "tool:start:tool-1:read:README.md",
        "tool:start:tool-2:code_structure:",
        "thinking:end",
        "assistant:Engineer:still active",
    ]);
});
