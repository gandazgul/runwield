import { assertEquals } from "@std/assert";
import { getAgentCompletions } from "../agents/getArgumentCompletions.js";
import { getModelCompletions } from "../models/getArgumentCompletions.js";
import { getLoadPlanCompletions } from "../load-plan/getArgumentCompletions.js";

Deno.test("getAgentCompletions includes router", async () => {
    const items = await getAgentCompletions("ro");
    assertEquals(items.some((i) => i.value === "router"), true);
});

Deno.test("getModelCompletions can find by provider prefix", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalOpenAiKey = Deno.env.get("OPENAI_API_KEY");
    const tempHome = await Deno.makeTempDir({ prefix: "harns-model-completions-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.env.set("OPENAI_API_KEY", "test-key");
        const items = await getModelCompletions("open");
        assertEquals(items.length > 0, true);
    } finally {
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        if (originalOpenAiKey === undefined) Deno.env.delete("OPENAI_API_KEY");
        else Deno.env.set("OPENAI_API_KEY", originalOpenAiKey);
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("getLoadPlanCompletions handles missing plans dir", async () => {
    const items = await getLoadPlanCompletions("anything");
    assertEquals(Array.isArray(items), true);
});
