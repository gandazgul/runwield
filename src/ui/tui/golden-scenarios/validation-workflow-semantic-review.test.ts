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
        todo: "scenario aliases the successful repair loop instead of proving an incomplete repair",
    },
    {
        scenario: validationTreeSemanticReviewerIncompletePauseScenario,
        exportName: "validationTreeSemanticReviewerIncompletePauseScenario",
        todo: "scenario stops the repair Engineer instead of proving an incomplete Reviewer pause",
    },
    {
        scenario: validationTreeSemanticRoundModeDiscoveryToVerifyScenario,
        exportName: "validationTreeSemanticRoundModeDiscoveryToVerifyScenario",
    },
]);
