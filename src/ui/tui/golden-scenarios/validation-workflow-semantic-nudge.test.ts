import {
    validationTreeSemanticNudgeMissingDiffInspectionScenario,
    validationTreeSemanticNudgeMissingReviewCompleteScenario,
    validationTreeSemanticNudgeOmittedPriorFindingScenario,
} from "./validation-workflow-tree-semantic.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts", [
    {
        scenario: validationTreeSemanticNudgeMissingReviewCompleteScenario,
        exportName: "validationTreeSemanticNudgeMissingReviewCompleteScenario",
        todo: "captured TUI evidence does not yet show the missing-review-complete nudge",
    },
    {
        scenario: validationTreeSemanticNudgeMissingDiffInspectionScenario,
        exportName: "validationTreeSemanticNudgeMissingDiffInspectionScenario",
        todo: "captured TUI evidence does not yet show the missing-diff-inspection nudge",
    },
    {
        scenario: validationTreeSemanticNudgeOmittedPriorFindingScenario,
        exportName: "validationTreeSemanticNudgeOmittedPriorFindingScenario",
        todo: "production publishes instead of nudging for an omitted prior finding",
    },
]);
