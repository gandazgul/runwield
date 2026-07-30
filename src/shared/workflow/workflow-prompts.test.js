import { assertStringIncludes } from "@std/assert";
import { buildEngineerRequest, buildSlicerRequest, buildTriageReport } from "./workflow-prompts.js";

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
                workKind: "DOCUMENTATION",
                dependencies: ["01-first"],
                affectedPaths: ["src/second.js"],
            },
        ],
    });

    assertStringIncludes(request, "- epic-a/02-second");
    assertStringIncludes(request, "  - Order: 2");
    assertStringIncludes(request, "  - Status: draft");
    assertStringIncludes(request, "  - Work Kind: DOCUMENTATION");
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

Deno.test("buildTriageReport preserves the Router's structured context", () => {
    const report = buildTriageReport({
        routingIntent: "PLANNED_CHANGE",
        classification: "PLANNED_CHANGE",
        workKind: "DOCUMENTATION",
        sessionName: "documentation work kind",
        complexity: "MEDIUM",
        summary: "Add a documentation Work Kind.",
        affectedPaths: ["src/constants.js", "docs/product-rules.md"],
    });

    assertStringIncludes(report, "- Routing Intent: PLANNED_CHANGE");
    assertStringIncludes(report, "- Plan Classification: PLANNED_CHANGE");
    assertStringIncludes(report, "- Work Kind: DOCUMENTATION");
    assertStringIncludes(report, "- Session Name: documentation work kind");
    assertStringIncludes(report, "- Complexity: MEDIUM");
    assertStringIncludes(report, "- Summary: Add a documentation Work Kind.");
    assertStringIncludes(report, "- Affected paths: src/constants.js, docs/product-rules.md");
});

Deno.test("buildEngineerRequest includes planned triage and the Router handoff before the Plan", () => {
    const request = buildEngineerRequest(
        "documentation-work-kind",
        "## Implementation Steps\n\n1. Update the taxonomy.",
        undefined,
        {
            triageMeta: {
                routingIntent: "PLANNED_CHANGE",
                classification: "PLANNED_CHANGE",
                workKind: "DOCUMENTATION",
                complexity: "MEDIUM",
                summary: "Add a documentation Work Kind.",
                affectedPaths: ["src/constants.js"],
            },
            routerMessage: "Add documentation as a first-class Work Kind.",
        },
    );

    assertStringIncludes(request, "This is a planned documentation.");
    assertStringIncludes(request, "## Triage Report");
    assertStringIncludes(request, "- Routing Intent: PLANNED_CHANGE");
    assertStringIncludes(request, "- Plan Classification: PLANNED_CHANGE");
    assertStringIncludes(request, "## Router Handoff Message");
    assertStringIncludes(request, "Add documentation as a first-class Work Kind.");
    const triageIndex = request.indexOf("## Triage Report");
    const routerIndex = request.indexOf("## Router Handoff Message");
    const planIndex = request.indexOf("## Implementation Steps");
    if (!(triageIndex < routerIndex && routerIndex < planIndex)) {
        throw new Error("Engineer handoff context must precede the approved Plan body");
    }
});

Deno.test("buildEngineerRequest reconstructs planned classification for loaded legacy Plans", () => {
    const request = buildEngineerRequest("loaded-plan", "Plan body", undefined, {
        triageMeta: {
            workKind: "FEATURE",
            complexity: "LOW",
            summary: "Loaded from disk.",
            affectedPaths: [],
        },
    });

    assertStringIncludes(request, "- Routing Intent: PLANNED_CHANGE");
    assertStringIncludes(request, "- Plan Classification: PLANNED_CHANGE");
    assertStringIncludes(request, "- Summary: Loaded from disk.");
});
