import { assertEquals } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import { runValidationLoop } from "./validation.ts";
import {
    makeRecordedSession,
    makeUi,
    makeValidationProjectRoot,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-human-review-test", uiAPI) };
}

Deno.test("runValidationLoop runs always human review after semantic approval and before merge", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_reviewer",
        humanReviewMode: "always",
        humanReviewDecision: null,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_reviewer", humanReviewMode: "always" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    const requests = /** @type {string[]} */ ([]);

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_reviewer", humanReviewMode: "always" },
        semanticReviewPort: {
            requestInteraction: (_session, request) => {
                requests.push(request.type);
                return Promise.resolve({ outcome: "selected", _meta: { approved: true, feedback: "" } });
            },
        },
        __deps: /** @type {any} */ (noOpWorktreePlanHandoffDeps()),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(requests, ["code_review"]);
    assertEquals(plan?.attrs.status, "validated_reviewer");
    assertEquals(plan?.attrs.humanReviewMode, "always");
    assertEquals(plan?.attrs.humanReviewDecision, "approved");
});

Deno.test("runValidationLoop ask mode can skip human review and merge", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_reviewer",
        humanReviewMode: "ask",
        humanReviewDecision: null,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_reviewer", humanReviewMode: "ask" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_reviewer", humanReviewMode: "ask" },
        semanticReviewPort: {
            requestInteraction: () => Promise.resolve({ outcome: "selected", value: "skip" }),
        },
        __deps: /** @type {any} */ (noOpWorktreePlanHandoffDeps()),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_reviewer");
    assertEquals(plan?.attrs.humanReviewDecision, "skipped");
});

Deno.test("runValidationLoop ask mode opens human review before merge when approved", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_reviewer",
        humanReviewMode: "ask",
        humanReviewDecision: null,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_reviewer", humanReviewMode: "ask" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    let calls = 0;

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_reviewer", humanReviewMode: "ask" },
        semanticReviewPort: {
            requestInteraction: (_session, request) => {
                calls += 1;
                if (request.type === "select") return Promise.resolve({ outcome: "selected", value: "open" });
                return Promise.resolve({ outcome: "selected", _meta: { approved: true, feedback: "" } });
            },
        },
        __deps: /** @type {any} */ (noOpWorktreePlanHandoffDeps()),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(calls, 2);
    assertEquals(plan?.attrs.humanReviewMode, "ask");
    assertEquals(plan?.attrs.humanReviewDecision, "approved");
});

Deno.test("runValidationLoop resumes at validated_reviewer and records durable human-review metadata before publication", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_reviewer",
        humanReviewMode: "none",
        humanReviewDecision: null,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: {
            classification: "QUICK_FIX",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: null,
        },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: {
            classification: "QUICK_FIX",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: null,
        },
        __deps: /** @type {any} */ (noOpWorktreePlanHandoffDeps()),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_reviewer");
    assertEquals(plan?.attrs.humanReviewMode, "none");
    assertEquals(plan?.attrs.humanReviewDecision, "not_required");
});
