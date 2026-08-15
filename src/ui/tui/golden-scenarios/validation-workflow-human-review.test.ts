import {
    validationTreeHumanReviewAlwaysApproveScenario,
    validationTreeHumanReviewAskOpenApproveScenario,
    validationTreeHumanReviewAskSkipScenario,
    validationTreeHumanReviewFeedbackRepairApproveScenario,
    validationTreeHumanReviewNoAnswerRetryScenario,
    validationTreeHumanReviewNoAnswerStopScenario,
} from "./validation-workflow-tree-human-review.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-human-review.ts", [
    {
        scenario: validationTreeHumanReviewAskSkipScenario,
        exportName: "validationTreeHumanReviewAskSkipScenario",
        todo: "captured TUI evidence does not yet show the local human-review choice",
    },
    {
        scenario: validationTreeHumanReviewAskOpenApproveScenario,
        exportName: "validationTreeHumanReviewAskOpenApproveScenario",
        todo: "workflow does not consume the scripted local human-review approval",
    },
    {
        scenario: validationTreeHumanReviewAlwaysApproveScenario,
        exportName: "validationTreeHumanReviewAlwaysApproveScenario",
        todo: "captured TUI evidence does not yet show automatic local human review",
    },
    {
        scenario: validationTreeHumanReviewFeedbackRepairApproveScenario,
        exportName: "validationTreeHumanReviewFeedbackRepairApproveScenario",
    },
    {
        scenario: validationTreeHumanReviewNoAnswerRetryScenario,
        exportName: "validationTreeHumanReviewNoAnswerRetryScenario",
        todo: "captured TUI evidence does not yet show the no-answer retry path",
    },
    {
        scenario: validationTreeHumanReviewNoAnswerStopScenario,
        exportName: "validationTreeHumanReviewNoAnswerStopScenario",
        todo: "captured TUI evidence does not yet show the no-answer Stop path",
    },
]);
