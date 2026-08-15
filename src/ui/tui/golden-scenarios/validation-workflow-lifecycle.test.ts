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
        todo: "captured TUI evidence does not yet show missing-Plan recovery",
    },
    {
        scenario: validationTreeMalformedFrontMatterScenario,
        exportName: "validationTreeMalformedFrontMatterScenario",
        todo: "captured TUI evidence does not yet show malformed-front-matter recovery",
    },
    {
        scenario: validationTreeResumeImplementedScenario,
        exportName: "validationTreeResumeImplementedScenario",
        todo: "captured TUI evidence does not yet show implemented-Plan recovery",
    },
    {
        scenario: validationTreeResumeValidatedCiScenario,
        exportName: "validationTreeResumeValidatedCiScenario",
        todo: "captured TUI evidence does not yet show validated_ci recovery",
    },
    {
        scenario: validationTreeResumeValidatedReviewerScenario,
        exportName: "validationTreeResumeValidatedReviewerScenario",
        todo: "captured TUI evidence does not yet show validated_reviewer recovery",
    },
    {
        scenario: validationTreeMissingExecutionContextScenario,
        exportName: "validationTreeMissingExecutionContextScenario",
        todo: "captured TUI evidence does not yet show missing execution-context recovery",
    },
    {
        scenario: validationTreeMismatchedWorktreeIdentityScenario,
        exportName: "validationTreeMismatchedWorktreeIdentityScenario",
        todo: "captured TUI evidence does not yet show worktree-identity recovery",
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
