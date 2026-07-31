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
    return { uiAPI, hostedSession: makeRecordedSession("validation-delivery-test", uiAPI) };
}

Deno.test("runValidationLoop does not preserve a nonexistent Plan path for quick-fix worktrees", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_reviewer",
        humanReviewMode: "none",
        humanReviewDecision: "not_required",
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: {
            classification: "QUICK_FIX",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
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
            humanReviewDecision: "not_required",
        },
        __deps: /** @type {any} */ (noOpWorktreePlanHandoffDeps()),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "verified");
    assertEquals(plan?.attrs.status, "verified");
    assertEquals(plan?.attrs.deliveryEvidence, { version: 1, mode: "non_git_in_place" });
});

Deno.test("runValidationLoop publishes only from validated_reviewer after human review is durably complete", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_reviewer",
        humanReviewMode: "none",
        humanReviewDecision: "not_required",
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: {
            classification: "QUICK_FIX",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
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
            humanReviewDecision: "not_required",
        },
        __deps: /** @type {any} */ (noOpWorktreePlanHandoffDeps()),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "verified");
    assertEquals(plan?.attrs.status, "verified");
    assertEquals(plan?.attrs.deliveryEvidence?.mode, "non_git_in_place");
    assertEquals(plan?.attrs.humanReviewDecision, "not_required");
});
