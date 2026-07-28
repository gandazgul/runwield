import { assertEquals } from "@std/assert";
import { runGoldenScenario } from "../testing/mod.js";
import { presentationAndTerminalScenarios } from "./presentation-and-terminal.js";

for (const scenario of presentationAndTerminalScenarios) {
    Deno.test(`golden presentation/terminal: ${scenario.name}`, async () => {
        const result = await runGoldenScenario(scenario, { keepArtifacts: false });
        assertEquals(result.actor.remaining, []);
    });
}
