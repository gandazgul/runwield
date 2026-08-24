import { assertEquals } from "@std/assert";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readLatestTaskCompletedReport } from "./workflow-results.js";

Deno.test("workflow result extraction preserves task completion reports", () => {
    const messages = [{
        role: "toolResult",
        toolName: "task_completed",
        details: {
            outcome: "task_completed",
            message: "- Done.",
        },
    }] as AgentMessage[];

    assertEquals(readLatestTaskCompletedReport(messages), {
        completed: true,
        message: "- Done.",
    });
});
