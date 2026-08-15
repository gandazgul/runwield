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
        todo: "captured TUI evidence does not yet show the semantic repair loop",
    },
    {
        scenario: validationTreeSemanticRepairIncompleteScenario,
        exportName: "validationTreeSemanticRepairIncompleteScenario",
        todo: "semantic repair does not resume to the expected incomplete-repair outcome",
    },
    {
        scenario: validationTreeSemanticReviewerIncompletePauseScenario,
        exportName: "validationTreeSemanticReviewerIncompletePauseScenario",
        todo: "captured TUI evidence does not yet show the incomplete-reviewer pause",
    },
    {
        scenario: validationTreeSemanticRoundModeDiscoveryToVerifyScenario,
        exportName: "validationTreeSemanticRoundModeDiscoveryToVerifyScenario",
        todo: "captured TUI evidence does not yet show discovery-to-verify mode progression",
    },
]);
