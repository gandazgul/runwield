import {
    EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS,
    VALIDATION_WORKFLOW_BRANCHES,
    validationEvidenceAssertion,
    type ValidationWorkflowBranchId,
} from "../testing/validation-workflow-coverage.ts";

interface ValidationWorkflowTreeScenario {
    name: string;
    composedTui: boolean;
    validationBranches: ValidationWorkflowBranchId[];
    assertions: Array<ReturnType<typeof validationEvidenceAssertion>>;
}

function scenario(name: string): ValidationWorkflowTreeScenario {
    const branches = EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS.filter((id) =>
        VALIDATION_WORKFLOW_BRANCHES.find((branch) => branch.id === id)?.owner === name
    );
    return {
        name,
        composedTui: true,
        validationBranches: branches,
        assertions: branches.map((id) => validationEvidenceAssertion(id)),
    };
}

export const validationTreeMechanicalPlanAmendmentScenario = scenario("validation-tree-mechanical-plan-amendment");
export const validationTreeCiLoopScenario = scenario("validation-tree-ci-loop");
export const validationTreeObjectiveCheckLoopScenario = scenario("validation-tree-objective-check-loop");
export const validationTreeSemanticReviewLoopScenario = scenario("validation-tree-semantic-review-loop");
export const validationTreeHumanReviewLoopScenario = scenario("validation-tree-human-review-loop");
export const validationTreePublicationRecoveryScenario = scenario("validation-tree-publication-recovery");
export const validationTreeLifecycleResumeScenario = scenario("validation-tree-lifecycle-resume");
export const validationTreeNonGitDeliveryScenario = scenario("validation-tree-non-git-delivery");
export const validationTreePublicationDirtyCheckoutScenario = scenario("validation-tree-publication-dirty-checkout");

export const validationWorkflowTreeScenarios = [
    validationTreeMechanicalPlanAmendmentScenario,
    validationTreeCiLoopScenario,
    validationTreeObjectiveCheckLoopScenario,
    validationTreeSemanticReviewLoopScenario,
    validationTreeHumanReviewLoopScenario,
    validationTreePublicationRecoveryScenario,
    validationTreeLifecycleResumeScenario,
    validationTreeNonGitDeliveryScenario,
    validationTreePublicationDirtyCheckoutScenario,
];
