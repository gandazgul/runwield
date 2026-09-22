import {
    validationTreeCiLoopScenario,
    validationTreeCiRepairIncompleteScenario,
    validationTreeCiRetrySuccessScenario,
} from "./validation-workflow-tree-mechanical.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-mechanical.ts", [
    { scenario: validationTreeCiLoopScenario, exportName: "validationTreeCiLoopScenario" },
    { scenario: validationTreeCiRetrySuccessScenario, exportName: "validationTreeCiRetrySuccessScenario" },
    { scenario: validationTreeCiRepairIncompleteScenario, exportName: "validationTreeCiRepairIncompleteScenario" },
]);
