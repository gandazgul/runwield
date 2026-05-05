import { assertEquals } from "@std/assert";
import { getAgentCompletions } from "../agents/getArgumentCompletions.js";
import { getModelCompletions } from "../models/getArgumentCompletions.js";
import { getResumeCompletions } from "../resume-plan/getArgumentCompletions.js";

Deno.test("getAgentCompletions includes router", async () => {
    const items = await getAgentCompletions("ro");
    assertEquals(items.some((i) => i.value === "router"), true);
});

Deno.test("getModelCompletions can find by provider prefix", async () => {
    const items = await getModelCompletions("open");
    assertEquals(items.length > 0, true);
});

Deno.test("getResumeCompletions handles missing plans dir", async () => {
    const items = await getResumeCompletions("anything");
    assertEquals(Array.isArray(items), true);
});
