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
    {
        scenario: validationTreeObjectiveNoneScenario,
        exportName: "validationTreeObjectiveNoneScenario",
        todo: "captured state does not yet prove the validation phase turn",
    },
    {
        scenario: validationTreeObjectiveMixedWaivedScenario,
        exportName: "validationTreeObjectiveMixedWaivedScenario",
        todo: "captured state does not yet prove the validation phase turn",
    },
    {
        scenario: validationTreeObjectiveRepairCompletedScenario,
        exportName: "validationTreeObjectiveRepairCompletedScenario",
        todo: "captured Plan state does not yet retain the repair outcome evidence",
    },
    {
        scenario: validationTreeObjectiveRepairIncompleteScenario,
        exportName: "validationTreeObjectiveRepairIncompleteScenario",
        todo: "captured Plan state does not yet retain the incomplete-repair evidence",
    },
    {
        scenario: validationTreeObjectiveCancelRetryScenario,
        exportName: "validationTreeObjectiveCancelRetryScenario",
        todo: "workflow remains validated_ci instead of returning to implemented for retry",
    },
    {
        scenario: validationTreeObjectiveCancelFollowUpScenario,
        exportName: "validationTreeObjectiveCancelFollowUpScenario",
        todo: "workflow remains validated_ci instead of returning to implemented for follow-up",
    },
    {
        scenario: validationTreeObjectiveCancelStopScenario,
        exportName: "validationTreeObjectiveCancelStopScenario",
        todo: "workflow remains validated_ci instead of returning to implemented for Stop",
    },
    {
        scenario: validationTreeObjectiveExhaustedRetryScenario,
        exportName: "validationTreeObjectiveExhaustedRetryScenario",
        todo: "workflow does not complete the expected exhausted-repair attempts",
    },
    {
        scenario: validationTreeObjectiveExhaustedFollowUpScenario,
        exportName: "validationTreeObjectiveExhaustedFollowUpScenario",
        todo: "workflow does not complete the expected exhausted-repair attempts",
    },
    {
        scenario: validationTreeObjectiveExhaustedStopScenario,
        exportName: "validationTreeObjectiveExhaustedStopScenario",
        todo: "workflow does not complete the expected exhausted-repair attempts",
    },
]);
