import {
    validationTreeValidationExhaustedFollowUpScenario,
    validationTreeValidationExhaustedRetryScenario,
    validationTreeValidationExhaustedStopScenario,
} from "./validation-workflow-tree-mechanical.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-mechanical.ts", [
    {
        scenario: validationTreeValidationExhaustedRetryScenario,
        exportName: "validationTreeValidationExhaustedRetryScenario",
    },
    {
        scenario: validationTreeValidationExhaustedFollowUpScenario,
        exportName: "validationTreeValidationExhaustedFollowUpScenario",
    },
    {
        scenario: validationTreeValidationExhaustedStopScenario,
        exportName: "validationTreeValidationExhaustedStopScenario",
    },
]);
