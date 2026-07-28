/**
 * @module ui/tui/golden-scenarios/planned-change-workflow
 * Golden PLANNED_CHANGE workflow portfolio scenarios.
 */

import { assertCoverageWith, assertEventIncludes, assertScreenIncludes } from "../testing/mod.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

/** @param {GoldenScenarioResult} result */
function assertPlannedChangeDurableOutcome(result) {
    assertEventIncludes(result, "interaction:PLAN_REVIEW:feedback");
    assertEventIncludes(result, "interaction:PLAN_REVIEW:approved");
    assertEventIncludes(result, "runtime:agent:engineer");
    assertEventIncludes(result, "runtime:agent:reviewer");
    assertEventIncludes(result, "runtime:validation:passed");
    const lifecycle = /** @type {string[]} */ (result.state.lifecycle || []);
    const expected = ["feedback", "approved", "in_progress", "implemented", "verified"];
    for (const status of expected) {
        if (!lifecycle.includes(status)) throw new Error(`PLANNED_CHANGE lifecycle missing ${status}.`);
    }
    if (result.state.deliveryEvidence !== "recorded") throw new Error("Delivery evidence was not recorded.");
    if (result.state.worktreePublication !== "published") throw new Error("Worktree publication was not asserted.");
    if (result.state.registryCleanup !== "clean") throw new Error("Worktree registry cleanup was not asserted.");
    assertScreenIncludes(result, "Reviewer rejected the first implementation.");
    assertScreenIncludes(result, "Workflow Validation passed and delivery evidence was recorded.");
}

export const plannedChangeReviewRepairValidationScenario = {
    name: "planned-change-review-repair-validation-delivery",
    coverage: [
        "workflow:PLANNED_CHANGE",
        "recovery:reviewer-rejection",
        "recovery:workflow-validation",
        "durable:plan-lifecycle",
        "durable:worktree-publication",
        "durable:registry-cleanup",
        "block:review-result",
        "block:validation-handoff",
    ],
    assertedCoverage: [
        "workflow:PLANNED_CHANGE",
        "recovery:reviewer-rejection",
        "recovery:workflow-validation",
        "durable:plan-lifecycle",
        "durable:worktree-publication",
        "durable:registry-cleanup",
        "block:review-result",
        "block:validation-handoff",
    ],
    actions: [
        { type: "event", event: "runtime:agent:planner" },
        { type: "event", event: "interaction:PLAN_REVIEW:feedback" },
        { type: "event", event: "review_feedback" },
        { type: "appendStateArray", path: "lifecycle", value: "feedback" },
        { type: "event", event: "interaction:PLAN_REVIEW:approved" },
        { type: "event", event: "review_approved" },
        { type: "appendStateArray", path: "lifecycle", value: "approved" },
        { type: "appendStateArray", path: "lifecycle", value: "in_progress" },
        { type: "event", event: "runtime:agent:engineer" },
        { type: "appendStateArray", path: "lifecycle", value: "implemented" },
        { type: "event", event: "runtime:agent:reviewer" },
        { type: "event", event: "runtime:review:rejected" },
        { type: "event", event: "runtime:agent:engineer" },
        { type: "event", event: "runtime:review:approved" },
        { type: "event", event: "runtime:validation:passed" },
        { type: "appendStateArray", path: "lifecycle", value: "verified" },
        { type: "setState", path: "deliveryEvidence", value: "recorded" },
        { type: "setState", path: "worktreePublication", value: "published" },
        { type: "setState", path: "registryCleanup", value: "clean" },
        {
            type: "screen",
            text:
                "Review result: Reviewer rejected the first implementation.\nValidation handoff: Workflow Validation passed and delivery evidence was recorded.",
        },
    ],
    assertions: [
        assertCoverageWith([
            "workflow:PLANNED_CHANGE",
            "recovery:reviewer-rejection",
            "recovery:workflow-validation",
            "durable:plan-lifecycle",
            "durable:worktree-publication",
            "durable:registry-cleanup",
            "block:review-result",
            "block:validation-handoff",
        ], assertPlannedChangeDurableOutcome),
    ],
};

export const plannedChangeWorkflowScenarios = [plannedChangeReviewRepairValidationScenario];
