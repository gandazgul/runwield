import { assertEquals, assertStrictEquals } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";

Deno.test("Plan review captures only the selected Architect and keeps the same conversation through dehydration", async () => {
    const cwd = await Deno.makeTempDir();
    const session = new HostedSession({ id: crypto.randomUUID(), cwd });
    const other = new HostedSession({ id: crypto.randomUUID(), cwd });
    try {
        const conversation = session.planReviewConversations.select("epic-a", "architect");
        const events = conversation.events;
        for (const [agentName, delta] of [["Architect", "First reply"], ["Planner", "Other reply"]]) {
            emitHostedSessionRuntimeEvent(session, {
                type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                agentName,
                delta,
                messageId: crypto.randomUUID(),
                messageKind: "assistant",
            });
        }
        assertEquals(conversation.events.map((event) => event.delta), ["First reply"]);
        session.dehydrateManagedSession();
        assertStrictEquals(session.planReviewConversations.select("epic-a", "architect"), conversation);
        assertStrictEquals(conversation.events, events);
        const unrelated = session.planReviewConversations.select("epic-b", "architect");
        assertEquals(unrelated.events, []);
        assertEquals(other.planReviewConversations.select("epic-a", "architect").events, []);
        session.planReviewConversations.stopCapture("epic-b");
        emitHostedSessionRuntimeEvent(session, {
            type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
            agentName: "Architect",
            delta: "After final decision",
            messageId: crypto.randomUUID(),
            messageKind: "assistant",
        });
        assertEquals(unrelated.events, []);
        assertEquals(conversation.events.map((event) => event.delta), ["First reply"]);
    } finally {
        await session.dispose();
        await other.dispose();
        await Deno.remove(cwd, { recursive: true });
    }
});
