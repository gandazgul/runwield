import {
    validationTreeCiCancelFollowUpScenario,
    validationTreeCiCancelRetryScenario,
    validationTreeCiCancelStopScenario,
    validationTreeCiLoopScenario,
    validationTreeCiRepairIncompleteScenario,
    validationTreeCiRetrySuccessScenario,
    validationTreeValidationExhaustedFollowUpScenario,
    validationTreeValidationExhaustedRetryScenario,
    validationTreeValidationExhaustedStopScenario,
} from "./validation-workflow-tree-mechanical.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-mechanical.ts", [
    { scenario: validationTreeCiLoopScenario, exportName: "validationTreeCiLoopScenario" },
    {
        scenario: validationTreeCiRetrySuccessScenario,
        exportName: "validationTreeCiRetrySuccessScenario",
    },
    { scenario: validationTreeCiCancelRetryScenario, exportName: "validationTreeCiCancelRetryScenario" },
    { scenario: validationTreeCiCancelFollowUpScenario, exportName: "validationTreeCiCancelFollowUpScenario" },
    { scenario: validationTreeCiCancelStopScenario, exportName: "validationTreeCiCancelStopScenario" },
    { scenario: validationTreeCiRepairIncompleteScenario, exportName: "validationTreeCiRepairIncompleteScenario" },
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
