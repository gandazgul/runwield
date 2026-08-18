// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertEquals } from "@std/assert";
import { deriveManagedSessionContinuationDecision } from "../../shared/session/session-runtime.js";
import { reduceSessionEvents } from "./components/SessionTimeline.jsx";

Deno.test("Workspace creates one Router Session and resumes idle conversational Agents through one stable identity", () => {
    const guideDecision = deriveManagedSessionContinuationDecision({
        activation: { state: "idle" },
        generation: { generation: 3 },
        expectedGeneration: 3,
        projection: { ok: true, complete: true, snapshot: { activeAgent: "Guide" } },
    });
    assertEquals(guideDecision.ok, true);
    assertEquals(guideDecision.agentName, "Guide");

    const workflowDecision = deriveManagedSessionContinuationDecision({
        activation: { state: "idle" },
        generation: { generation: 3 },
        expectedGeneration: 3,
        projection: { ok: true, complete: true, snapshot: { activeAgent: "Planner", workflowContext: { plan: "x" } } },
    });
    assertEquals(workflowDecision.ok, true);
    assertEquals(workflowDecision.agentName, "Planner");

    const executionWorkflowDecision = deriveManagedSessionContinuationDecision({
        activation: { state: "idle" },
        generation: { generation: 3 },
        expectedGeneration: 3,
        projection: {
            ok: true,
            complete: true,
            snapshot: { activeAgent: "Engineer", activeExecutionWorkflow: { planName: "feature-a" } },
        },
    });
    assertEquals(executionWorkflowDecision.ok, false);
    assertEquals(executionWorkflowDecision.code, "active_workflow_read_only");
    assertEquals(
        executionWorkflowDecision.message,
        "This Session is running work. It becomes available when that work finishes.",
    );

    const timeline = reduceSessionEvents([
        { type: "user_message", eventId: "u1", messageId: "u1", text: "Start" },
        { type: "assistant_text_delta", eventId: "a1", messageId: "a1", agentName: "Router", delta: "Routing." },
        { type: "tool_start", eventId: "t1", toolCallId: "tool-1", toolName: "read" },
        { type: "tool_end", eventId: "t2", toolCallId: "tool-1", toolName: "read", output: "done" },
    ]);
    assertEquals(timeline.map((item) => item.kind), ["message", "message", "tool"]);
    assertEquals(timeline[1].agentName, "Router");
});
