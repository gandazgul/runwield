import {
    validationTreeObjectiveCancelFollowUpScenario,
    validationTreeObjectiveCancelRetryScenario,
    validationTreeObjectiveCancelStopScenario,
    validationTreeObjectiveExhaustedFollowUpScenario,
    validationTreeObjectiveExhaustedRetryScenario,
    validationTreeObjectiveExhaustedStopScenario,
    validationTreeObjectiveMixedWaivedScenario,
    validationTreeObjectiveNoneScenario,
    validationTreeObjectiveRepairCompletedScenario,
    validationTreeObjectiveRepairIncompleteScenario,
} from "./validation-workflow-tree-mechanical.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-mechanical.ts", [
    { scenario: validationTreeObjectiveNoneScenario, exportName: "validationTreeObjectiveNoneScenario" },
    {
        scenario: validationTreeObjectiveMixedWaivedScenario,
        exportName: "validationTreeObjectiveMixedWaivedScenario",
    },
    {
        scenario: validationTreeObjectiveRepairCompletedScenario,
        exportName: "validationTreeObjectiveRepairCompletedScenario",
    },
    {
        scenario: validationTreeObjectiveRepairIncompleteScenario,
        exportName: "validationTreeObjectiveRepairIncompleteScenario",
    },
    {
        scenario: validationTreeObjectiveCancelRetryScenario,
        exportName: "validationTreeObjectiveCancelRetryScenario",
        todo: "objective-cancel retry branch is unstable after the validation recovery merge",
    },
    {
        scenario: validationTreeObjectiveCancelFollowUpScenario,
        exportName: "validationTreeObjectiveCancelFollowUpScenario",
        todo: "objective-cancel follow-up branch is unstable after the validation recovery merge",
    },
    {
        scenario: validationTreeObjectiveCancelStopScenario,
        exportName: "validationTreeObjectiveCancelStopScenario",
        todo: "objective-cancel stop branch is unstable after the validation recovery merge",
    },
    {
        scenario: validationTreeObjectiveExhaustedRetryScenario,
        exportName: "validationTreeObjectiveExhaustedRetryScenario",
    },
    {
        scenario: validationTreeObjectiveExhaustedFollowUpScenario,
        exportName: "validationTreeObjectiveExhaustedFollowUpScenario",
    },
    {
        scenario: validationTreeObjectiveExhaustedStopScenario,
        exportName: "validationTreeObjectiveExhaustedStopScenario",
    },
]);
