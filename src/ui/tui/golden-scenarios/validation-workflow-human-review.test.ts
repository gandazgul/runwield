import {
    validationTreeHumanReviewAlwaysApproveScenario,
    validationTreeHumanReviewAskOpenApproveScenario,
    validationTreeHumanReviewAskSkipScenario,
    validationTreeHumanReviewFeedbackRepairApproveScenario,
    validationTreeHumanReviewNoAnswerRetryScenario,
    validationTreeHumanReviewNoAnswerStopScenario,
    validationTreeHumanReviewNoneScenario,
} from "./validation-workflow-tree-human-review.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-human-review.ts", [
    {
        scenario: validationTreeHumanReviewNoneScenario,
        exportName: "validationTreeHumanReviewNoneScenario",
    },
    {
        scenario: validationTreeHumanReviewAskSkipScenario,
        exportName: "validationTreeHumanReviewAskSkipScenario",
    },
    {
        scenario: validationTreeHumanReviewAskOpenApproveScenario,
        exportName: "validationTreeHumanReviewAskOpenApproveScenario",
    },
    {
        scenario: validationTreeHumanReviewAlwaysApproveScenario,
        exportName: "validationTreeHumanReviewAlwaysApproveScenario",
    },
    {
        scenario: validationTreeHumanReviewFeedbackRepairApproveScenario,
        exportName: "validationTreeHumanReviewFeedbackRepairApproveScenario",
    },
    {
        scenario: validationTreeHumanReviewNoAnswerRetryScenario,
        exportName: "validationTreeHumanReviewNoAnswerRetryScenario",
    },
    {
        scenario: validationTreeHumanReviewNoAnswerStopScenario,
        exportName: "validationTreeHumanReviewNoAnswerStopScenario",
    },
]);
