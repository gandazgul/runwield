import {
    validationTreeSemanticRoundLimitContinueScenario,
    validationTreeSemanticRoundLimitHumanReviewScenario,
    validationTreeSemanticRoundLimitStopScenario,
} from "./validation-workflow-tree-semantic.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts", [
    {
        scenario: validationTreeSemanticRoundLimitContinueScenario,
        exportName: "validationTreeSemanticRoundLimitContinueScenario",
        todo: "validation does not resume far enough to show the semantic round-limit Continue choice",
    },
    {
        scenario: validationTreeSemanticRoundLimitHumanReviewScenario,
        exportName: "validationTreeSemanticRoundLimitHumanReviewScenario",
        todo: "validation does not resume far enough to show the semantic round-limit human-review choice",
    },
    {
        scenario: validationTreeSemanticRoundLimitStopScenario,
        exportName: "validationTreeSemanticRoundLimitStopScenario",
        todo: "validation does not resume far enough to show the semantic round-limit Stop choice",
    },
]);
