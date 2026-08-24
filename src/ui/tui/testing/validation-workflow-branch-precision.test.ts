import { assert, assertEquals } from "@std/assert";
import { VALIDATION_WORKFLOW_BRANCHES, type ValidationWorkflowBranchId } from "./validation-workflow-coverage.ts";

function branch(id: ValidationWorkflowBranchId) {
    const found = VALIDATION_WORKFLOW_BRANCHES.find((entry) => entry.id === id);
    assert(found, `Missing validation branch ${id}.`);
    return found;
}

Deno.test("human review none and ask-skip branches have independent owners and evidence", () => {
    const none = branch("human-review:none");
    const askSkip = branch("human-review:ask-skip");

    assertEquals(none.owner, "validation-tree-human-review-none");
    assertEquals(askSkip.owner, "validation-tree-human-review-ask-skip");
    assertEquals(none.evidence.stateEquals["projectState.plans.0.attrs.humanReviewMode"], "none");
    assertEquals(none.evidence.stateEquals["projectState.plans.0.attrs.humanReviewDecision"], "not_required");
    assert(none.evidence.interactionAbsentValues.includes("skip"));
    assertEquals(askSkip.evidence.stateEquals["projectState.plans.0.attrs.humanReviewMode"], "ask");
    assertEquals(askSkip.evidence.stateEquals["projectState.plans.0.attrs.humanReviewDecision"], "skipped");
    assert(askSkip.evidence.interactionValues.includes("skip"));
});
