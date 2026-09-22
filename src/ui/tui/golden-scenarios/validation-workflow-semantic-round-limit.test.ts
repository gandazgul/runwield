import {
    validationTreeSemanticRoundLimitContinueScenario,
    validationTreeSemanticRoundLimitFollowUpScenario,
} from "./validation-workflow-tree-semantic.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts", [
    {
        scenario: validationTreeSemanticRoundLimitFollowUpScenario,
        exportName: "validationTreeSemanticRoundLimitFollowUpScenario",
    },
    {
        scenario: validationTreeSemanticRoundLimitContinueScenario,
        exportName: "validationTreeSemanticRoundLimitContinueScenario",
    },
]);
