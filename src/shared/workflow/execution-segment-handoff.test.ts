import { assertEquals } from "@std/assert";
import { savePlan } from "../../plan-store.js";
import { buildExecutionSegmentContinuation, resolvePendingSegmentHandoff } from "./execution-segment-handoff.ts";

Deno.test("rejects changed canonical Plan and worktree evidence before handoff", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-handoff-" });
    await savePlan(root, "demo", "# Demo\n\nApproved", {
        planId: "plan-demo",
        status: "ready_for_work",
        classification: "PLANNED_CHANGE",
    });
    const preparedEvidence = {
        planId: "plan-demo",
        planName: "demo",
        revision: "old-revision",
        status: "ready_for_work",
        worktree: { kind: "none" as const },
    };
    const continuation = buildExecutionSegmentContinuation({
        runwieldSessionId: "session-one",
        planId: "plan-demo",
        planName: "demo",
        approvedRevision: "old-revision",
        approvedStatus: "ready_for_work",
        approvedMarkdown: "# Demo\n\nApproved",
        preparedEvidence,
        activeWorkflow: { planName: "demo", triageMeta: {}, executionAgent: "engineer" },
        executionOwner: "engineer",
        collaborationStyle: "autonomous",
        collaborationRecommendation: "autonomous",
    });

    const result = await resolvePendingSegmentHandoff({
        marker: { payload: continuation, entryIndex: 0, entries: [{ type: "custom" }] },
        projectRoot: root,
        runwieldSessionId: "session-one",
    });

    assertEquals(result.kind, "refresh_required");
});

Deno.test("treats a marker as consumed after Pi's first seeded message entry", async () => {
    const continuation = buildExecutionSegmentContinuation({
        runwieldSessionId: "session-one",
        planId: "plan-demo",
        planName: "demo",
        approvedRevision: "rev",
        approvedStatus: "ready_for_work",
        approvedMarkdown: "# Demo",
        preparedEvidence: {
            planId: "plan-demo",
            planName: "demo",
            revision: "rev",
            status: "ready_for_work",
            worktree: { kind: "none" },
        },
        activeWorkflow: { planName: "demo", triageMeta: {}, executionAgent: "engineer" },
        executionOwner: "engineer",
        collaborationStyle: "autonomous",
        collaborationRecommendation: "autonomous",
    });

    const result = await resolvePendingSegmentHandoff({
        marker: {
            payload: continuation,
            entryIndex: 0,
            entries: [{ type: "custom" }, { type: "message" }],
        },
        projectRoot: "/not-read-because-consumed",
        runwieldSessionId: "session-one",
    });

    assertEquals(result.kind, "consumed");
});
