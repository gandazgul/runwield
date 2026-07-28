import { assertEquals } from "@std/assert";
import { runGoldenScenario } from "../testing/mod.js";
import { projectWorkflowScenarios } from "./project-workflow.js";

for (const scenario of projectWorkflowScenarios) {
    Deno.test(`golden PROJECT workflow: ${scenario.name}`, async () => {
        const result = await runGoldenScenario(scenario, { keepArtifacts: false });
        assertEquals(result.actor.remaining, []);
    });
}
