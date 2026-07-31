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
