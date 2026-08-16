import {
    validationTreePublicationDirtyCheckoutScenario,
    validationTreePublicationDirtyStopResumeScenario,
    validationTreePublicationGenericGitFailureScenario,
    validationTreePublicationMergeConflictRepairCompletedScenario,
    validationTreePublicationMergeConflictRepairIncompleteRetryScenario,
    validationTreePublicationMergeConflictRepairIncompleteStopScenario,
    validationTreePublicationMissingTargetBranchScenario,
    validationTreePublicationStaleRepairWorktreeScenario,
} from "./validation-workflow-tree-publication.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-publication.ts", [
    {
        scenario: validationTreePublicationDirtyCheckoutScenario,
        exportName: "validationTreePublicationDirtyCheckoutScenario",
    },
    {
        scenario: validationTreePublicationDirtyStopResumeScenario,
        exportName: "validationTreePublicationDirtyStopResumeScenario",
    },
    {
        scenario: validationTreePublicationMissingTargetBranchScenario,
        exportName: "validationTreePublicationMissingTargetBranchScenario",
    },
    {
        scenario: validationTreePublicationMergeConflictRepairCompletedScenario,
        exportName: "validationTreePublicationMergeConflictRepairCompletedScenario",
    },
    {
        scenario: validationTreePublicationMergeConflictRepairIncompleteRetryScenario,
        exportName: "validationTreePublicationMergeConflictRepairIncompleteRetryScenario",
    },
    {
        scenario: validationTreePublicationMergeConflictRepairIncompleteStopScenario,
        exportName: "validationTreePublicationMergeConflictRepairIncompleteStopScenario",
    },
    {
        scenario: validationTreePublicationStaleRepairWorktreeScenario,
        exportName: "validationTreePublicationStaleRepairWorktreeScenario",
    },
    {
        scenario: validationTreePublicationGenericGitFailureScenario,
        exportName: "validationTreePublicationGenericGitFailureScenario",
    },
]);
