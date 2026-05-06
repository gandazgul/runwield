import { assertEquals } from "@std/assert";
import { extractPlanWritten } from "./triage.js";

Deno.test("extractPlanWritten returns details", () => {
    const out = extractPlanWritten([
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "plan_written",
            details: {
                planName: "abc",
                tasks: [{ task: 1, assignee: "engineer", dependencies: "", description: "do" }],
            },
        }),
    ]);
    assertEquals(out?.planName, "abc");
    assertEquals(out?.tasks?.length, 1);
});

Deno.test("extractPlanWritten returns null when absent", () => {
    assertEquals(extractPlanWritten([]), null);
});
