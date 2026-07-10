import { assertEquals } from "@std/assert";
import { mapRuntimeEventToAcpUpdate } from "../../acp/event-mapper.js";
import { createSessionRuntimeEvent, RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { attachTuiRuntimeAdapter } from "./runtime-adapter.js";

function makeUi() {
    /** @type {string[]} */
    const transcript = [];
    /** @type {Map<string, any>} */
    const tools = new Map();
    const uiAPI = /** @type {import('./types.js').UiAPI} */ ({
        appendUserMessage: (text) => transcript.push(`user:${text}`),
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

Deno.test("TUI and ACP adapters consume the same semantic runtime transcript", () => {
    const runtime = new SessionRuntime();
    const session = runtime.createSession({ id: "adapter-parity", cwd: "/repo/parity" });
    const { transcript, uiAPI } = makeUi();
    /** @type {Array<{ reason: string, sessionName: string | undefined, agentName: string | undefined }>} */
    const attentionRequests = [];
    const adapter = attachTuiRuntimeAdapter({
        runtime,
        hostedSession: session,
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

    for (const event of fixture) runtime.emitSessionEvent(session, event);
    const acpUpdates = fixture.map((event) =>
        mapRuntimeEventToAcpUpdate(createSessionRuntimeEvent(session.id, /** @type {any} */ (event)))
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

Deno.test("attaching a replacement TUI adapter does not duplicate session output", () => {
    const runtime = new SessionRuntime();
    const session = runtime.createSession({ id: "adapter-replacement", cwd: "/repo/replacement" });
    const { transcript, uiAPI } = makeUi();

    const previousAdapter = attachTuiRuntimeAdapter({ runtime, hostedSession: session, uiAPI });
    const activeAdapter = attachTuiRuntimeAdapter({ runtime, hostedSession: session, uiAPI });

    runtime.emitSessionEvent(session, {
        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
        messageId: "answer-1",
        delta: "once",
        _meta: { agentName: "Engineer" },
    });
    runtime.emitSessionEvent(session, {
        type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
        messageId: "thinking-1",
        delta: "once",
    });
    runtime.emitSessionEvent(session, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId: "tool-1",
        toolName: "read",
        title: "read README.md",
    });
    runtime.emitSessionEvent(session, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId: "tool-2",
        toolName: "code_structure",
        title: "code_structure",
    });

    previousAdapter.dispose();
    runtime.emitSessionEvent(session, {
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
        "assistant:Engineer:still active",
        "thinking:end",
    ]);
});
