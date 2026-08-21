import {
    validationTreePublicationDirtyCheckoutScenario,
    validationTreePublicationDirtyStopResumeScenario,
    validationTreePublicationGenericGitFailureScenario,
    validationTreePublicationIsolatedDirtyPrimaryScenario,
    validationTreePublicationLegacyPartialRetryScenario,
    validationTreePublicationLocalOnlyScenario,
    validationTreePublicationMergeConflictRepairCompletedScenario,
    validationTreePublicationMergeConflictRepairIncompleteRetryScenario,
    validationTreePublicationMergeConflictRepairIncompleteStopScenario,
    validationTreePublicationMissingTargetBranchScenario,
    validationTreePublicationPrimaryPlanRestoredScenario,
    validationTreePublicationPushFailureRetryScenario,
    validationTreePublicationRemoteTargetAdvanceScenario,
    validationTreePublicationRemoteUnavailableRetryScenario,
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
        scenario: validationTreePublicationLocalOnlyScenario,
        exportName: "validationTreePublicationLocalOnlyScenario",
    },
    {
        scenario: validationTreePublicationIsolatedDirtyPrimaryScenario,
        exportName: "validationTreePublicationIsolatedDirtyPrimaryScenario",
    },
    {
        scenario: validationTreePublicationRemoteTargetAdvanceScenario,
        exportName: "validationTreePublicationRemoteTargetAdvanceScenario",
    },
    {
        scenario: validationTreePublicationPrimaryPlanRestoredScenario,
        exportName: "validationTreePublicationPrimaryPlanRestoredScenario",
    },
    {
        scenario: validationTreePublicationRemoteUnavailableRetryScenario,
        exportName: "validationTreePublicationRemoteUnavailableRetryScenario",
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
        scenario: validationTreePublicationMissingTargetBranchScenario,
        exportName: "validationTreePublicationMissingTargetBranchScenario",
    },
    {
        scenario: validationTreePublicationStaleRepairWorktreeScenario,
        exportName: "validationTreePublicationStaleRepairWorktreeScenario",
    },
    {
        scenario: validationTreePublicationGenericGitFailureScenario,
        exportName: "validationTreePublicationGenericGitFailureScenario",
    },
    {
        scenario: validationTreePublicationPushFailureRetryScenario,
        exportName: "validationTreePublicationPushFailureRetryScenario",
    },
    {
        scenario: validationTreePublicationLegacyPartialRetryScenario,
        exportName: "validationTreePublicationLegacyPartialRetryScenario",
    },
]);
