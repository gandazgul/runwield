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
    },
    {
        scenario: validationTreeBrokenObjectiveDetectedWaiveScenario,
        exportName: "validationTreeBrokenObjectiveDetectedWaiveScenario",
    },
    {
        scenario: validationTreeBrokenObjectiveEngineerReportedRejectScenario,
        exportName: "validationTreeBrokenObjectiveEngineerReportedRejectScenario",
    },
    {
        scenario: validationTreeBrokenObjectiveEngineerReportedWaiveScenario,
        exportName: "validationTreeBrokenObjectiveEngineerReportedWaiveScenario",
    },
    {
        scenario: validationTreeBrokenObjectiveFollowUpScenario,
        exportName: "validationTreeBrokenObjectiveFollowUpScenario",
    },
    {
        scenario: validationTreeBrokenObjectiveStopScenario,
        exportName: "validationTreeBrokenObjectiveStopScenario",
    },
    {
        scenario: validationTreeBrokenObjectiveStaleReportScenario,
        exportName: "validationTreeBrokenObjectiveStaleReportScenario",
    },
]);
