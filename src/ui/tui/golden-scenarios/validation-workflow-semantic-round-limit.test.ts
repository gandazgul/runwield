import {
    validationTreeSemanticRoundLimitContinueScenario,
    validationTreeSemanticRoundLimitHumanReviewScenario,
    validationTreeSemanticRoundLimitStopDirectScenario,
    validationTreeSemanticRoundLimitStopScenario,
} from "./validation-workflow-tree-semantic.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts", [
    {
        scenario: validationTreeSemanticRoundLimitContinueScenario,
        exportName: "validationTreeSemanticRoundLimitContinueScenario",
    },
    {
        scenario: validationTreeSemanticRoundLimitHumanReviewScenario,
        exportName: "validationTreeSemanticRoundLimitHumanReviewScenario",
    },
    {
        scenario: validationTreeSemanticRoundLimitStopScenario,
        exportName: "validationTreeSemanticRoundLimitStopScenario",
    },
    {
        scenario: validationTreeSemanticRoundLimitStopDirectScenario,
        exportName: "validationTreeSemanticRoundLimitStopDirectScenario",
    },
]);
