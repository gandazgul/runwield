import { assertEquals, assertNotEquals } from "@std/assert";
import { TuiAgentMascot, type TuiMascotState } from "./agent-mascot.ts";
import { mascotForAgent } from "../mascot/mascot.ts";

Deno.test("mascot clock advances only full active sprites and resets on Session replacement", async () => {
    let renders = 0;
    const mascot = new TuiAgentMascot(() => renders++);
    const state: TuiMascotState = { agentName: "architect", sessionId: "one", pose: "thinking" };
    try {
        const first = mascot.render(20, false, state);
        await new Promise((resolve) => setTimeout(resolve, 95));
        assertEquals(renders, 1);
        assertNotEquals(mascot.render(20, false, state), first);
        assertEquals(mascot.render(20, false, { ...state, sessionId: "two" }), first);
        const compact = mascot.render(20, true, state);
        assertEquals(compact.length, 2);
        await new Promise((resolve) => setTimeout(resolve, 95));
        assertEquals(renders, 1);
        assertEquals(
            mascot.render(20, false, { ...state, pose: "answering" }),
            mascotForAgent("architect")!.answering.lines,
        );
        assertEquals(mascot.render(20, false, { ...state, agentName: "recorder" }), []);
        mascot.render(20, false, state);
    } finally {
        mascot.dispose();
    }
    await new Promise((resolve) => setTimeout(resolve, 95));
    assertEquals(renders, 1);
});
