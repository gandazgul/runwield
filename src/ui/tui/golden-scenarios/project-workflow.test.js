import { assertEquals } from "@std/assert";
import {
    projectPlanReviewScenario,
    projectWorkflowScenarios,
    twoChildProjectContinuationScenario,
} from "./project-workflow.js";

const scenarioExportNames = new Map(
    /** @type {Array<[unknown, string]>} */ ([
        [projectPlanReviewScenario, "projectPlanReviewScenario"],
        [twoChildProjectContinuationScenario, "twoChildProjectContinuationScenario"],
    ]),
);

for (const scenario of projectWorkflowScenarios) {
    Deno.test(`golden PROJECT workflow: ${scenario.name}`, async () => {
        const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
        const result = await runGoldenScenarioChildProcess({
            scenarioModule: "src/ui/tui/golden-scenarios/project-workflow.js",
            exportName: scenarioExportNames.get(scenario) || "",
            timeoutMs: /** @type {{ timeoutMs?: number }} */ (scenario).timeoutMs || 30000,
        });
        assertEquals(result.result.actor.remaining, []);
    });
}
