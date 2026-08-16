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
    },
    {
        scenario: validationTreeSemanticNudgeMissingDiffInspectionScenario,
        exportName: "validationTreeSemanticNudgeMissingDiffInspectionScenario",
    },
    {
        scenario: validationTreeSemanticNudgeOmittedPriorFindingScenario,
        exportName: "validationTreeSemanticNudgeOmittedPriorFindingScenario",
        todo: "production publishes instead of nudging for an omitted prior finding",
    },
]);
