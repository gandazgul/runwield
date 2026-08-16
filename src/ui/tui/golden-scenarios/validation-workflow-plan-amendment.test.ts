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
    },
    {
        scenario: validationTreePlanAmendmentFollowUpScenario,
        exportName: "validationTreePlanAmendmentFollowUpScenario",
    },
    {
        scenario: validationTreePlanAmendmentStopScenario,
        exportName: "validationTreePlanAmendmentStopScenario",
    },
    {
        scenario: validationTreePlanAmendmentInvalidBaselineScenario,
        exportName: "validationTreePlanAmendmentInvalidBaselineScenario",
    },
]);
