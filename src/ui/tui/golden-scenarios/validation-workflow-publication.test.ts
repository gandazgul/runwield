import {
    validationTreePublicationIsolatedDirtyPrimaryScenario,
    validationTreePublicationLegacyPartialRetryScenario,
    validationTreePublicationLocalOnlyScenario,
    validationTreePublicationPushFailureRetryScenario,
    validationTreePublicationRemoteTargetAdvanceScenario,
} from "./validation-workflow-tree-publication.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-publication.ts", [
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
        scenario: validationTreePublicationPushFailureRetryScenario,
        exportName: "validationTreePublicationPushFailureRetryScenario",
    },
    {
        scenario: validationTreePublicationLegacyPartialRetryScenario,
        exportName: "validationTreePublicationLegacyPartialRetryScenario",
    },
]);
