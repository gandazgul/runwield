import {
    validationTreeCiCancelFollowUpScenario,
    validationTreeCiCancelRetryScenario,
    validationTreeCiCancelStopScenario,
} from "./validation-workflow-tree-mechanical.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-mechanical.ts", [
    { scenario: validationTreeCiCancelRetryScenario, exportName: "validationTreeCiCancelRetryScenario" },
    { scenario: validationTreeCiCancelFollowUpScenario, exportName: "validationTreeCiCancelFollowUpScenario" },
    { scenario: validationTreeCiCancelStopScenario, exportName: "validationTreeCiCancelStopScenario" },
]);
