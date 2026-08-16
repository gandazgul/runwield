import {
    validationTreeSemanticRepairIncompleteScenario,
    validationTreeSemanticReviewerIncompletePauseScenario,
    validationTreeSemanticReviewLoopScenario,
    validationTreeSemanticRoundModeDiscoveryToVerifyScenario,
} from "./validation-workflow-tree-semantic.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts", [
    {
        scenario: validationTreeSemanticReviewLoopScenario,
        exportName: "validationTreeSemanticReviewLoopScenario",
    },
    {
        scenario: validationTreeSemanticRepairIncompleteScenario,
        exportName: "validationTreeSemanticRepairIncompleteScenario",
    },
    {
        scenario: validationTreeSemanticReviewerIncompletePauseScenario,
        exportName: "validationTreeSemanticReviewerIncompletePauseScenario",
    },
    {
        scenario: validationTreeSemanticRoundModeDiscoveryToVerifyScenario,
        exportName: "validationTreeSemanticRoundModeDiscoveryToVerifyScenario",
    },
]);
