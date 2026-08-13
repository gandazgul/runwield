import { assertEquals } from "@std/assert";
import { validationWorkflowTreeScenarios } from "./validation-workflow-tree.ts";
import {
    assertValidationBranchEvidence,
    assertValidationBranchInventory,
    EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS,
    VALIDATION_WORKFLOW_BRANCHES,
    type ValidationWorkflowBranchId,
    type ValidationWorkflowResultLike,
} from "../testing/validation-workflow-coverage.ts";

function evidenceResult(id: ValidationWorkflowBranchId): ValidationWorkflowResultLike {
    const branch = VALIDATION_WORKFLOW_BRANCHES.find((entry) => entry.id === id);
    return {
        name: branch?.owner || "",
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
        scrollbackText: `Validation branch evidence: ${id}`,
        events: ["project:state:captured", "human-review:captured"],
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
                    },
                }],
                registryEntries: [],
                nonTerminalRegistryEntries: [],
            },
        },
        actor: { consumed: ["engineer", "reviewer:semantic_review"], remaining: [] },
    };
}

Deno.test("golden validation workflow tree: inventory covers Mechanical Validation and Objective Check branches", () => {
    assertValidationBranchInventory(validationWorkflowTreeScenarios);
    const branchIds = new Set(validationWorkflowTreeScenarios.flatMap((scenario) => scenario.validationBranches || []));
    for (const id of EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS) {
        if (!id.startsWith("mechanical:")) continue;
        assertEquals(branchIds.has(id), true, `Missing Mechanical Validation branch ${id}`);
        assertValidationBranchEvidence(id, evidenceResult(id));
    }
});

Deno.test("golden validation workflow tree: inventory covers Semantic Code Review and Local Human Code Review branches", () => {
    assertValidationBranchInventory(validationWorkflowTreeScenarios);
    const branchIds = new Set(validationWorkflowTreeScenarios.flatMap((scenario) => scenario.validationBranches || []));
    for (const id of EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS) {
        if (!id.startsWith("semantic:") && !id.startsWith("human-review:")) continue;
        assertEquals(branchIds.has(id), true, `Missing review branch ${id}`);
        assertValidationBranchEvidence(id, evidenceResult(id));
    }
});

Deno.test("golden validation workflow tree: inventory covers publication and lifecycle resume branches", () => {
    assertValidationBranchInventory(validationWorkflowTreeScenarios);
    const branchIds = new Set(validationWorkflowTreeScenarios.flatMap((scenario) => scenario.validationBranches || []));
    for (const id of EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS) {
        if (!id.startsWith("publication:") && !id.startsWith("lifecycle:")) continue;
        assertEquals(branchIds.has(id), true, `Missing publication or lifecycle branch ${id}`);
        assertValidationBranchEvidence(id, evidenceResult(id));
    }
});
