import { assertStringIncludes } from "@std/assert";
import { buildEngineerRequest, buildSlicerRequest } from "./workflow-prompts.js";

Deno.test("buildSlicerRequest includes existing child order and dependencies", () => {
    const request = buildSlicerRequest({
        planName: "epic-a",
        epicBody: "# Epic",
        epicAttrs: {
            classification: "PROJECT",
            status: "ready_for_work",
            worktreeBaseBranch: "feature-base",
        },
        children: [
            {
                name: "epic-a/02-second",
                order: 2,
                status: "draft",
                summary: "Second slice",
                dependencies: ["01-first"],
                affectedPaths: ["src/second.js"],
            },
        ],
    });

    assertStringIncludes(request, "- epic-a/02-second");
    assertStringIncludes(request, "  - Order: 2");
    assertStringIncludes(request, "  - Status: draft");
    assertStringIncludes(request, "  - Dependencies: 01-first");
    assertStringIncludes(request, "- Target branch: feature-base");
});

Deno.test("approval annotations are included in Engineer and Slicer handoffs", () => {
    const feedback = "Keep the selected command and highlighted boundary.";
    const engineerRequest = buildEngineerRequest("feature-plan", "Plan body", feedback);
    const slicerRequest = buildSlicerRequest({
        planName: "epic-plan",
        epicBody: "Epic body",
        reviewFeedback: feedback,
    });

    assertStringIncludes(engineerRequest, "Annotations Submitted With Approval");
    assertStringIncludes(engineerRequest, feedback);
    assertStringIncludes(slicerRequest, "Annotations Submitted With Approval");
    assertStringIncludes(slicerRequest, feedback);
});

Deno.test("buildEngineerRequest preserves workflow completion contract", () => {
    const request = buildEngineerRequest("feature-plan", "Plan body");
    assertStringIncludes(request, "Approved Plan: feature-plan");
    assertStringIncludes(request, "call task_completed with a concise bullet-point success or failure report");
    assertStringIncludes(request, "Plan body");
});
