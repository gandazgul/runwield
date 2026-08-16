import {
    validationTreeAheadStatusScenario,
    validationTreeMalformedFrontMatterScenario,
    validationTreeMismatchedWorktreeIdentityScenario,
    validationTreeMissingExecutionContextScenario,
    validationTreeMissingPlanScenario,
    validationTreeResumeImplementedScenario,
    validationTreeResumeValidatedCiScenario,
    validationTreeResumeValidatedReviewerScenario,
    validationTreeUnsupportedStatusScenario,
} from "./validation-workflow-tree-lifecycle.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-lifecycle.ts", [
    {
        scenario: validationTreeMissingPlanScenario,
        exportName: "validationTreeMissingPlanScenario",
    },
    {
        scenario: validationTreeMalformedFrontMatterScenario,
        exportName: "validationTreeMalformedFrontMatterScenario",
    },
    {
        scenario: validationTreeResumeImplementedScenario,
        exportName: "validationTreeResumeImplementedScenario",
    },
    {
        scenario: validationTreeResumeValidatedCiScenario,
        exportName: "validationTreeResumeValidatedCiScenario",
    },
    {
        scenario: validationTreeResumeValidatedReviewerScenario,
        exportName: "validationTreeResumeValidatedReviewerScenario",
    },
    {
        scenario: validationTreeMissingExecutionContextScenario,
        exportName: "validationTreeMissingExecutionContextScenario",
    },
    {
        scenario: validationTreeMismatchedWorktreeIdentityScenario,
        exportName: "validationTreeMismatchedWorktreeIdentityScenario",
    },
    {
        scenario: validationTreeAheadStatusScenario,
        exportName: "validationTreeAheadStatusScenario",
        todo: "loading an ahead Plan normalizes it before lifecycle healing can be observed",
    },
    {
        scenario: validationTreeUnsupportedStatusScenario,
        exportName: "validationTreeUnsupportedStatusScenario",
        todo: "loading an unsupported status normalizes it before fail-closed behavior can be observed",
    },
]);
