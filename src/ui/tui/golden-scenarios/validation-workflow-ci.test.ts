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
    {
        scenario: validationTreeCiLoopScenario,
        exportName: "validationTreeCiLoopScenario",
        todo: "captured state does not yet prove the validation phase turn",
    },
    {
        scenario: validationTreeCiRetrySuccessScenario,
        exportName: "validationTreeCiRetrySuccessScenario",
        todo: "captured TUI evidence does not yet show first-round semantic approval",
    },
    {
        scenario: validationTreeCiCancelRetryScenario,
        exportName: "validationTreeCiCancelRetryScenario",
        todo: "captured state does not yet prove the validation retry turn",
    },
    { scenario: validationTreeCiCancelFollowUpScenario, exportName: "validationTreeCiCancelFollowUpScenario" },
    {
        scenario: validationTreeCiCancelStopScenario,
        exportName: "validationTreeCiCancelStopScenario",
        todo: "captured state does not yet prove the validation Stop turn",
    },
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
