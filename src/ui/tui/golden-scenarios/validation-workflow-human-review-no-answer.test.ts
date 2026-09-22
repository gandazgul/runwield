import {
    validationTreeHumanReviewNoAnswerRetryScenario,
    validationTreeHumanReviewNoAnswerStopScenario,
} from "./validation-workflow-tree-human-review.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-human-review.ts", [
    {
        scenario: validationTreeHumanReviewNoAnswerRetryScenario,
        exportName: "validationTreeHumanReviewNoAnswerRetryScenario",
    },
    {
        scenario: validationTreeHumanReviewNoAnswerStopScenario,
        exportName: "validationTreeHumanReviewNoAnswerStopScenario",
    },
]);
