import { assertEquals } from "@std/assert";
import { runGoldenScenario } from "../testing/mod.js";
import { plannedChangeWorkflowScenarios } from "./planned-change-workflow.js";

for (const scenario of plannedChangeWorkflowScenarios) {
    Deno.test(`golden PLANNED_CHANGE workflow: ${scenario.name}`, async () => {
        const result = await runGoldenScenario(scenario, { keepArtifacts: false });
        assertEquals(result.actor.remaining, []);
    });
}
