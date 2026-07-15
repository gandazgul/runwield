import { assertEquals, assertStringIncludes } from "@std/assert";
import { HostedSession } from "../session/hosted-session.js";
import {
    askRetryFailedTasks,
    buildDependencyOutputsContext,
    buildEngineerRequest,
    buildSlicerRequest,
    buildTaskAssignmentRequest,
    buildTaskResultDisplay,
    reportExecutionSummary,
} from "./workflow-prompts.js";

Deno.test("buildSlicerRequest includes existing child order and dependencies", () => {
    const request = buildSlicerRequest({
        planName: "epic-a",
        epicBody: "# Epic",
        epicAttrs: {
            classification: "PROJECT",
            type: "epic",
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

Deno.test("buildDependencyOutputsContext includes only successful dependency displays", () => {
    const context = buildDependencyOutputsContext(
        { dependencies: "1, 2, 3" },
        new Map([
            [1, { status: "success", display: "Task 1 output" }],
            [2, { status: "failed", error: "boom" }],
            [3, { status: "success", output: "raw only" }],
        ]),
    );

    assertEquals(context, "Task 1 output");
});

Deno.test("buildTaskAssignmentRequest includes dependency outputs, write scope, and plan context", () => {
    const request = buildTaskAssignmentRequest(
        "project-plan",
        "Full plan body",
        {
            task: 2,
            dependencies: "1",
            description: "Verify alpha",
            writeScope: "none",
        },
        new Map([[1, { status: "success", display: "Task 1 (Engineer) — Implement alpha" }]]),
    );

    assertStringIncludes(request, 'Task 2 from the plan "project-plan"');
    assertStringIncludes(request, "### Dependency Outputs");
    assertStringIncludes(request, "Task 1 (Engineer) — Implement alpha");
    assertStringIncludes(request, "### Write Scope\n\nnone");
    assertStringIncludes(request, "Full plan body");
});

Deno.test("buildTaskResultDisplay and buildEngineerRequest preserve workflow completion contract", () => {
    assertEquals(
        buildTaskResultDisplay({ task: 1, description: "Implement alpha" }, "engineer", "Done."),
        "Task 1 (Engineer) — Implement alpha\n\nDone.",
    );

    const request = buildEngineerRequest("feature-plan", "Plan body");
    assertStringIncludes(request, "Approved Plan: feature-plan");
    assertStringIncludes(request, "call task_completed with a concise success or failure summary");
    assertStringIncludes(request, "Plan body");
});

Deno.test("askRetryFailedTasks maps prompt choice to boolean", async () => {
    /** @type {string[]} */
    const prompts = [];
    const yesSession = new HostedSession({ id: "retry-yes", cwd: Deno.cwd() });
    yesSession.setInteractionAdapter({
        requestInteraction: (request) => {
            prompts.push(request.prompt);
            return Promise.resolve({ outcome: "selected", value: "yes" });
        },
    });
    const yes = await askRetryFailedTasks(
        { failedTasks: [1, 2], results: new Map() },
        yesSession,
    );
    const noSession = new HostedSession({ id: "retry-no", cwd: Deno.cwd() });
    noSession.setInteractionAdapter({
        requestInteraction: () => Promise.resolve({ outcome: "selected", value: "no" }),
    });
    const no = await askRetryFailedTasks(
        { failedTasks: [3], results: new Map() },
        noSession,
    );

    assertEquals(yes, true);
    assertEquals(no, false);
    assertStringIncludes(prompts[0], "2 task(s) failed");
});

Deno.test("reportExecutionSummary counts success, failed, and blocked tasks", () => {
    /** @type {string[]} */
    const messages = [];
    const session = new HostedSession({ id: "execution-summary", cwd: Deno.cwd() });
    session.setEventSink((/** @type {any} */ event) => {
        if (event.type === "system_status") messages.push(String(event.message));
    });
    reportExecutionSummary(
        {
            results: new Map([
                [1, { status: "success" }],
                [2, { status: "failed" }],
                [3, { status: "blocked" }],
            ]),
        },
        session,
    );

    assertEquals(messages, ["Execution Summary: 1 success, 1 failed, 1 blocked."]);
});
