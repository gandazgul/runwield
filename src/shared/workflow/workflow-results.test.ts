import { assertEquals, assertStringIncludes } from "@std/assert";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
    buildReturnToRouterPrompt,
    readLatestReturnToRouterOutcome,
    readLatestTaskCompletedReport,
} from "./workflow-results.js";

Deno.test("buildReturnToRouterPrompt tells the Router to triage the handoff and call triage_report", () => {
    const reason = "Route this as QUICK_FIX: fix the typo in the banner.";
    const prompt = buildReturnToRouterPrompt(reason);

    assertStringIncludes(prompt, "Triage the report");
    assertStringIncludes(prompt, "call `triage_report`");
    assertStringIncludes(prompt, "possibly following the recommendation in the handoff");
    assertStringIncludes(prompt, "<handoff from tool>");
    assertStringIncludes(prompt, reason);
});

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

Deno.test("readLatestReturnToRouterOutcome reads the raw reason from the tool result", () => {
    const messages = [
        {
            role: "toolResult",
            toolName: "return_to_router",
            details: { agentName: "router", reason: "The user needs fresh triage." },
        },
    ] as AgentMessage[];
    assertEquals(readLatestReturnToRouterOutcome(messages), {
        agentName: "router",
        reason: "The user needs fresh triage.",
    });
});
