import { assertEquals } from "@std/assert";
import {
    loadPlanEpicChildMenusScenario,
    loadPlanEpicDoneEnoughArchiveScenario,
    loadPlanEpicMenuOptionsScenario,
    loadPlanEpicSlicerScenario,
    loadPlanEpicWorkflowScenarios,
} from "./load-plan-epic-workflow.ts";

const scenarioExportNames = new Map<object, string>([
    [loadPlanEpicMenuOptionsScenario, "loadPlanEpicMenuOptionsScenario"],
    [loadPlanEpicSlicerScenario, "loadPlanEpicSlicerScenario"],
    [loadPlanEpicChildMenusScenario, "loadPlanEpicChildMenusScenario"],
    [loadPlanEpicDoneEnoughArchiveScenario, "loadPlanEpicDoneEnoughArchiveScenario"],
]);

for (const scenario of loadPlanEpicWorkflowScenarios) {
    Deno.test({
        name: `golden /load-plan Epic workflow: ${scenario.name}`,
        fn: async () => {
            const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
            const result = await runGoldenScenarioChildProcess({
                scenarioModule: "src/ui/tui/golden-scenarios/load-plan-epic-workflow.ts",
                exportName: scenarioExportNames.get(scenario) || "",
                timeoutMs: scenario.timeoutMs || 90000,
            });
            assertEquals(result.result.actor.remaining, []);
        },
    });
}
