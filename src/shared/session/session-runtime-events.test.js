import { assertEquals, assertThrows } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import {
    createSessionRuntimeEvent,
    emitHostedSessionRuntimeEvent,
    normalizeRuntimeToolResult,
    normalizeRuntimeUsage,
    RuntimeEventTypes,
} from "./session-runtime-events.js";

Deno.test("Runtime normalizes one complete structured tool result for every consumer", () => {
    assertEquals(
        normalizeRuntimeToolResult({
            content: [
                { type: "text", text: "hello" },
                { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
                { type: "text", text: " world" },
            ],
            details: { truncation: { truncated: true }, fullOutputPath: "/tmp/full.log" },
        }),
        {
            content: [
                { type: "text", text: "hello" },
                { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
                { type: "text", text: " world" },
            ],
            output: "hello world",
            details: { truncation: { truncated: true }, fullOutputPath: "/tmp/full.log" },
        },
    );
    assertEquals(normalizeRuntimeToolResult({ internal: true }), {
        content: [],
        output: "",
        details: null,
    });
});

Deno.test("Runtime normalizes provider usage once", () => {
    assertEquals(
        normalizeRuntimeUsage({
            input: 12,
            output: 4,
            cacheRead: 3,
            cacheWrite: 2,
            cost: { total: 0.25 },
            context_window: 128000,
        }),
        {
            inputTokens: 12,
            outputTokens: 4,
            cacheReadTokens: 3,
            cacheWriteTokens: 2,
            costUsd: 0.25,
            contextWindow: 128000,
        },
    );
});

Deno.test("Runtime event factory supplies shared identity defaults and rejects partial semantic events", () => {
    const userEvent = createSessionRuntimeEvent("session-1", {
        type: RuntimeEventTypes.USER_MESSAGE,
        text: "hello",
    });
    assertEquals(userEvent.type, RuntimeEventTypes.USER_MESSAGE);
    if (userEvent.type !== RuntimeEventTypes.USER_MESSAGE) throw new Error("unexpected event type");
    assertEquals(typeof userEvent.messageId, "string");
    assertEquals(userEvent.images, []);

    const workflowContextEvent = createSessionRuntimeEvent("session-1", {
        type: RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED,
        workflowContext: { routingIntent: "QUICK_FIX", complexity: "LOW" },
    });
    assertEquals(workflowContextEvent.type, RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED);

    const keyboardHelpEvent = createSessionRuntimeEvent("session-1", {
        type: RuntimeEventTypes.KEYBOARD_HELP,
        title: "Keyboard shortcuts",
        items: [{ key: "?", description: "show help" }],
    });
    assertEquals(keyboardHelpEvent.type, RuntimeEventTypes.KEYBOARD_HELP);
    if (keyboardHelpEvent.type !== RuntimeEventTypes.KEYBOARD_HELP) throw new Error("unexpected event type");
    assertEquals(keyboardHelpEvent.items, [{ key: "?", description: "show help" }]);

    assertThrows(
        () =>
            createSessionRuntimeEvent("session-1", {
                type: RuntimeEventTypes.TOOL_UPDATE,
                toolCallId: "tool-1",
                toolName: "bash",
                output: "partial",
            }),
        TypeError,
        "title must be a string",
    );
    assertThrows(
        () =>
            createSessionRuntimeEvent("session-1", {
                type: RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED,
                workflowContext: { routingIntent: "FEATURE" },
            }),
        TypeError,
        "routingIntent and complexity must be provided together",
    );
    assertThrows(
        () =>
            createSessionRuntimeEvent("session-1", {
                type: RuntimeEventTypes.KEYBOARD_HELP,
                title: "Keyboard shortcuts",
                items: [{ key: "", description: "show help" }],
            }),
        TypeError,
        "item.key must be non-empty",
    );
    assertThrows(
        () =>
            createSessionRuntimeEvent("session-1", {
                type: RuntimeEventTypes.KEYBOARD_HELP,
                title: "Keyboard shortcuts",
                items: [],
            }),
        TypeError,
        "items must be non-empty",
    );
});

Deno.test("internal event sink contract failures are not swallowed as consumer failures", () => {
    const session = new HostedSession({ id: "sink-errors", cwd: Deno.cwd() });
    session.setEventSink(() => {
        throw new TypeError("invalid producer event");
    });
    assertThrows(
        () => emitHostedSessionRuntimeEvent(session, { type: RuntimeEventTypes.BUSY_CHANGED, busy: true }),
        TypeError,
        "invalid producer event",
    );
});
