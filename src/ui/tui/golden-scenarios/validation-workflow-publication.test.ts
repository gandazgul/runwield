import {
    validationTreePublicationCommittedRepairCompletionScenario,
    validationTreePublicationDirtyCheckoutScenario,
    validationTreePublicationIsolatedDirtyPrimaryScenario,
    validationTreePublicationLocalOnlyScenario,
    validationTreePublicationMissingTargetBranchScenario,
    validationTreePublicationPrimaryPlanRestoredScenario,
    validationTreePublicationRemoteTargetAdvanceScenario,
    validationTreePublicationRepairCompletionScenario,
    validationTreePublicationResumedRepairCompletionScenario,
} from "./validation-workflow-tree-publication.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-publication.ts", [
    {
        scenario: validationTreePublicationResumedRepairCompletionScenario,
        exportName: "validationTreePublicationResumedRepairCompletionScenario",
    },
    {
        scenario: validationTreePublicationCommittedRepairCompletionScenario,
        exportName: "validationTreePublicationCommittedRepairCompletionScenario",
    },
    {
        scenario: validationTreePublicationRepairCompletionScenario,
        exportName: "validationTreePublicationRepairCompletionScenario",
    },
    {
        scenario: validationTreePublicationDirtyCheckoutScenario,
        exportName: "validationTreePublicationDirtyCheckoutScenario",
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
        scenario: validationTreePublicationMissingTargetBranchScenario,
        exportName: "validationTreePublicationMissingTargetBranchScenario",
    },
]);
