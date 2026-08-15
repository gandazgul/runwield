import {
    validationTreePlanAmendmentApproveScenario,
    validationTreePlanAmendmentFollowUpScenario,
    validationTreePlanAmendmentInvalidBaselineScenario,
    validationTreePlanAmendmentStopScenario,
} from "./validation-workflow-tree-mechanical.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-mechanical.ts", [
    {
        scenario: validationTreePlanAmendmentApproveScenario,
        exportName: "validationTreePlanAmendmentApproveScenario",
        todo: "captured TUI evidence does not yet show the Plan amendment decision",
    },
    {
        scenario: validationTreePlanAmendmentFollowUpScenario,
        exportName: "validationTreePlanAmendmentFollowUpScenario",
        todo: "captured TUI evidence does not yet show the Plan amendment follow-up decision",
    },
    {
        scenario: validationTreePlanAmendmentStopScenario,
        exportName: "validationTreePlanAmendmentStopScenario",
        todo: "captured TUI evidence does not yet show the Plan amendment Stop decision",
    },
    {
        scenario: validationTreePlanAmendmentInvalidBaselineScenario,
        exportName: "validationTreePlanAmendmentInvalidBaselineScenario",
        todo: "captured TUI evidence does not yet show the invalid-baseline amendment path",
    },
]);
