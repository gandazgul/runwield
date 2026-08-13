import { assertEquals } from "@std/assert";
import { validationWorkflowTreeScenarios } from "../golden-scenarios/validation-workflow-tree.ts";
import {
    assertValidationBranchInventory,
    assertValidationEvidenceRejectsCounterfeits,
    EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS,
    VALIDATION_WORKFLOW_BRANCHES,
    type ValidationWorkflowBranchId,
    type ValidationWorkflowResultLike,
} from "./validation-workflow-coverage.ts";

function fullEvidenceResult(id: ValidationWorkflowBranchId): ValidationWorkflowResultLike {
    const owner = VALIDATION_WORKFLOW_BRANCHES.find((branch) => branch.id === id)?.owner || "";
    return {
        name: owner,
        screenText: [
            "Running CI Validation",
            "Objective",
            "Semantic",
            "Code Review",
            "Merging validated worktree branch",
            "have not saved to git yet",
            "Plan Recovery",
            "Plan Front Matter",
            "No implementation changes detected",
        ].join("\n"),
        scrollbackText: [
            `validation branch ${id}`,
            "Build, tests, and Objective-Failing Checks passed.",
            "Local Human Code Review approved.",
        ].join("\n"),
        events: ["project:state:captured", "human-review:captured", "runtime:tool:start:review_complete"],
        state: {
            turnSequence: ["engineer:engineer:plan:1", "reviewer:semantic_review:plan:1"],
            projectState: {
                plans: [{
                    name: "plan",
                    attrs: {
                        status: "verified",
                        validationCiAttempts: 0,
                        validationSemanticRounds: 1,
                        humanReviewDecision: "approved",
                        failureReason: null,
                    },
                }],
                registryEntries: [],
                nonTerminalRegistryEntries: [],
            },
        },
        actor: { consumed: ["engineer:engineer", "reviewer:semantic_review"], remaining: [] },
    };
}

Deno.test("validation workflow inventory is independent, owned, and assertion-tagged", () => {
    assertValidationBranchInventory(validationWorkflowTreeScenarios);
    const declared = validationWorkflowTreeScenarios.flatMap((scenario) => scenario.validationBranches || []);
    assertEquals(new Set(declared).size, EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS.length);
});

Deno.test("validation workflow evidence checks reject metadata-only coverage", () => {
    for (const id of EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS) {
        assertValidationEvidenceRejectsCounterfeits(id, fullEvidenceResult(id));
    }
});
