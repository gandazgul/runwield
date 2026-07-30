import { assertEquals } from "@std/assert";
import {
    plannedChangeReviewRepairValidationScenario,
    plannedChangeWorkflowScenarios,
} from "./planned-change-workflow.js";

const scenarioExportNames = new Map([
    [plannedChangeReviewRepairValidationScenario, "plannedChangeReviewRepairValidationScenario"],
]);

for (const scenario of plannedChangeWorkflowScenarios) {
    Deno.test(`golden PLANNED_CHANGE workflow: ${scenario.name}`, async () => {
        const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
        const result = await runGoldenScenarioChildProcess({
            scenarioModule: "src/ui/tui/golden-scenarios/planned-change-workflow.js",
            exportName: scenarioExportNames.get(scenario) || "",
            timeoutMs: 30000,
        });
        assertEquals(result.result.actor.remaining, []);
    });
}
