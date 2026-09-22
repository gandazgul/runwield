import { validationTreeSemanticRoundLimitHumanReviewScenario } from "./validation-workflow-tree-semantic.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts", [
    {
        scenario: validationTreeSemanticRoundLimitHumanReviewScenario,
        exportName: "validationTreeSemanticRoundLimitHumanReviewScenario",
    },
]);
