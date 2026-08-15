import {
    validationTreeBrokenObjectiveDetectedRejectScenario,
    validationTreeBrokenObjectiveDetectedWaiveScenario,
    validationTreeBrokenObjectiveEngineerReportedRejectScenario,
    validationTreeBrokenObjectiveEngineerReportedWaiveScenario,
    validationTreeBrokenObjectiveFollowUpScenario,
    validationTreeBrokenObjectiveStaleReportScenario,
    validationTreeBrokenObjectiveStopScenario,
} from "./validation-workflow-tree-mechanical.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-mechanical.ts", [
    {
        scenario: validationTreeBrokenObjectiveDetectedRejectScenario,
        exportName: "validationTreeBrokenObjectiveDetectedRejectScenario",
        todo: "captured state does not yet prove the validation phase turn",
    },
    {
        scenario: validationTreeBrokenObjectiveDetectedWaiveScenario,
        exportName: "validationTreeBrokenObjectiveDetectedWaiveScenario",
        todo: "captured TUI evidence does not yet show the Objective Check decision",
    },
    {
        scenario: validationTreeBrokenObjectiveEngineerReportedRejectScenario,
        exportName: "validationTreeBrokenObjectiveEngineerReportedRejectScenario",
        todo: "workflow never reaches the Engineer broken-Objective report",
    },
    {
        scenario: validationTreeBrokenObjectiveEngineerReportedWaiveScenario,
        exportName: "validationTreeBrokenObjectiveEngineerReportedWaiveScenario",
        todo: "workflow never reaches the Engineer broken-Objective report",
    },
    {
        scenario: validationTreeBrokenObjectiveFollowUpScenario,
        exportName: "validationTreeBrokenObjectiveFollowUpScenario",
        todo: "captured Plan state does not yet retain the follow-up outcome",
    },
    {
        scenario: validationTreeBrokenObjectiveStopScenario,
        exportName: "validationTreeBrokenObjectiveStopScenario",
        todo: "captured TUI evidence does not yet show the broken-Objective Stop decision",
    },
    {
        scenario: validationTreeBrokenObjectiveStaleReportScenario,
        exportName: "validationTreeBrokenObjectiveStaleReportScenario",
        todo: "production does not surface the stale broken-Objective report decision",
    },
]);
