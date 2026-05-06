import { assertEquals, assertMatch } from "@std/assert";
import { createPlanWrittenTool } from "../plan-written.js";

Deno.test("createPlanWrittenTool exposes expected metadata", () => {
    const tool = createPlanWrittenTool();
    assertEquals(tool.name, "plan_written");
    assertEquals(tool.label, "Plan Written");
    assertMatch(tool.description, /Declare the plan filename/i);
    assertEquals(typeof tool.execute, "function");
    assertEquals(typeof tool.parameters, "object");
});

Deno.test("createPlanWrittenTool returns guidance when planName is empty", async () => {
    const tool = createPlanWrittenTool();
    const result = await /** @type {any} */ (tool.execute)(
        "tool-call-1",
        { planName: "" },
        new AbortController().signal,
        () => {},
        {},
    );
    const text = result.content[0]?.text ?? "";
    assertMatch(text, /planName is empty/);
});

Deno.test("createPlanWrittenTool returns guidance when plan file is missing", async () => {
    const tool = createPlanWrittenTool();
    const result = await /** @type {any} */ (tool.execute)(
        "tool-call-1",
        { planName: "definitely-does-not-exist-" + Math.random().toString(36).slice(2) },
        new AbortController().signal,
        () => {},
        {},
    );
    const text = result.content[0]?.text ?? "";
    assertMatch(text, /not found/);
});
