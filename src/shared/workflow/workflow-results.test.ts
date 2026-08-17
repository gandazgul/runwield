import { assertEquals } from "@std/assert";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readLatestTaskCompletedReport } from "./workflow-results.js";

Deno.test("workflow result extraction preserves broken Objective Check reports from repair transcripts", () => {
    const messages = [{
        role: "toolResult",
        toolName: "task_completed",
        details: {
            outcome: "task_completed",
            message: "- Done.",
            brokenObjectiveChecks: [{ id: "OC1", command: "bad -A", explanation: "invalid option" }],
        },
    }] as AgentMessage[];

    assertEquals(readLatestTaskCompletedReport(messages), {
        completed: true,
        message: "- Done.",
        brokenObjectiveChecks: [{ id: "OC1", command: "bad -A", explanation: "invalid option" }],
    });
});
