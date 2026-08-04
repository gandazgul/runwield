import { assertEquals } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import {
    makeRecordedSession,
    makeUi,
    makeValidationProjectRoot,
    NO_ISOLATED_AGENT_PORT,
    runValidationLoop,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-delivery-test", uiAPI) };
}

Deno.test("savePlan and loadPlan preserve validationMergeRepairWorktree", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "validated_reviewer",
        humanReviewMode: "none",
        humanReviewDecision: "not_required",
        validationMergeRepairWorktree: "/tmp/runwield-merge",
    });

    const plan = await loadPlan(projectRoot, "p");

    assertEquals(plan?.attrs.validationMergeRepairWorktree, "/tmp/runwield-merge");
});

Deno.test("runValidationLoop clears validationMergeRepairWorktree for non-Git publication", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_reviewer",
        humanReviewMode: "none",
        humanReviewDecision: "not_required",
        validationMergeRepairWorktree: "/tmp/missing-runwield-merge",
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: {
            classification: "QUICK_FIX",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
            validationMergeRepairWorktree: "/tmp/missing-runwield-merge",
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
            validationMergeRepairWorktree: "/tmp/missing-runwield-merge",
        },
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "verified");
    assertEquals(plan?.attrs.status, "verified");
    assertEquals(plan?.attrs.validationMergeRepairWorktree ?? null, null);
});

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
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
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
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "verified");
    assertEquals(plan?.attrs.status, "verified");
    assertEquals(plan?.attrs.deliveryEvidence?.mode, "non_git_in_place");
    assertEquals(plan?.attrs.humanReviewDecision, "not_required");
});
