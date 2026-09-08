import { assert, assertEquals } from "@std/assert";
import { appendLiveSessionEvent } from "./live-session-events.ts";
import { createSessionRuntimeEvent, type SessionRuntimeEvent } from "./session-runtime-events.js";

Deno.test("live observation excludes saved replay and coalesces streaming text", () => {
    const events: SessionRuntimeEvent[] = [];
    appendLiveSessionEvent(
        events,
        createSessionRuntimeEvent("session", {
            type: "user_message",
            messageId: "saved",
            text: "Earlier message",
            eventId: "segment:saved:user_message:0",
        }),
    );
    for (let index = 0; index < 2000; index++) {
        appendLiveSessionEvent(
            events,
            createSessionRuntimeEvent("session", {
                type: "assistant_text_delta",
                messageId: "reply",
                agentName: "guide",
                messageKind: "assistant",
                delta: "a",
            }),
        );
    }
    assertEquals(events.length, 1);
    assert(events[0].type === "assistant_text_delta");
    assertEquals(events[0].delta.length, 2000);
});

Deno.test("a long operation retains its latest question and terminal events", () => {
    const events: SessionRuntimeEvent[] = [];
    for (let index = 0; index < 1500; index++) {
        appendLiveSessionEvent(
            events,
            createSessionRuntimeEvent("session", {
                type: "system_status",
                messageId: `status-${index}`,
                message: "Working",
                level: "info",
            }),
        );
    }
    appendLiveSessionEvent(
        events,
        createSessionRuntimeEvent("session", {
            type: "interaction_requested",
            interactionId: "question",
            interactionType: "text",
            prompt: "Continue?",
        }),
    );
    appendLiveSessionEvent(events, createSessionRuntimeEvent("session", { type: "turn_end", ok: true }));
    assertEquals(events.length, 1000);
    assertEquals(events.at(-2)?.type, "interaction_requested");
    assertEquals(events.at(-1)?.type, "turn_end");
});
