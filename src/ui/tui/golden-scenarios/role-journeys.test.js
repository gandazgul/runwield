import { assertEquals } from "@std/assert";
import { runGoldenScenario } from "../testing/mod.js";
import { roleJourneyScenarios } from "./role-journeys.js";

for (const scenario of roleJourneyScenarios) {
    Deno.test(`golden role journey: ${scenario.name}`, async () => {
        const result = await runGoldenScenario(scenario, { keepArtifacts: false });
        assertEquals(result.actor.remaining, []);
    });
}
