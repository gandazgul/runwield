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
    },
    {
        scenario: validationTreeObjectiveCancelFollowUpScenario,
        exportName: "validationTreeObjectiveCancelFollowUpScenario",
    },
    {
        scenario: validationTreeObjectiveCancelStopScenario,
        exportName: "validationTreeObjectiveCancelStopScenario",
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
