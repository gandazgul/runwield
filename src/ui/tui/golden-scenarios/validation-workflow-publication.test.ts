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
        todo: "captured TUI evidence does not yet show incomplete merge-repair retry",
    },
    {
        scenario: validationTreePublicationMergeConflictRepairIncompleteStopScenario,
        exportName: "validationTreePublicationMergeConflictRepairIncompleteStopScenario",
        todo: "captured TUI evidence does not yet show incomplete merge-repair Stop",
    },
    {
        scenario: validationTreePublicationStaleRepairWorktreeScenario,
        exportName: "validationTreePublicationStaleRepairWorktreeScenario",
        todo: "publication does not expose stale merge-repair worktree evidence",
    },
    {
        scenario: validationTreePublicationGenericGitFailureScenario,
        exportName: "validationTreePublicationGenericGitFailureScenario",
        todo: "the fixture reaches branch-movement recovery instead of generic publication failure",
    },
]);
