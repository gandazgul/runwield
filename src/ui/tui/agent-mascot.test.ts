import { assertEquals, assertNotEquals } from "@std/assert";
import { TuiAgentMascot, type TuiMascotState } from "./agent-mascot.ts";
import { mascotForAgent } from "../mascot/mascot.ts";

Deno.test("mascot is horizontally centered within its available width", () => {
    const mascot = new TuiAgentMascot(() => {});
    try {
        for (const width of [20, 22, 34, 35, 60]) {
            for (const agentName of ["engineer", "architect", "guide", "operator"]) {
                for (const compact of [false, true]) {
                    const lines = mascot.render(width, compact, { agentName, sessionId: "one", pose: "idle" });
                    const visible = lines.filter((line) => line.trim());
                    const left = Math.min(...visible.map((line) => line.search(/\S/)));
                    const right = width - Math.max(...visible.map((line) => line.trimEnd().length));
                    assertEquals(Math.abs(left - right) <= 1, true, `${agentName}, width ${width}, compact ${compact}`);
                }
            }
        }
    } finally {
        mascot.dispose();
    }
});

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
            mascot.render(20, false, { ...state, pose: "answering" }).map((line) => line.trim()),
            mascotForAgent("architect")!.answering.lines.map((line) => line.trim()),
        );
        assertEquals(mascot.render(20, false, { ...state, agentName: "recorder" }), []);
        mascot.render(20, false, state);
    } finally {
        mascot.dispose();
    }
    await new Promise((resolve) => setTimeout(resolve, 95));
    assertEquals(renders, 1);
});
