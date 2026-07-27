import { assertEquals, assertRejects } from "@std/assert";
import { initialGoldenScenarios } from "./initial-scenarios.js";
import { GoldenScenarioActor, runGoldenScenario } from "../testing/mod.js";

for (const scenario of initialGoldenScenarios) {
    Deno.test(`golden scenario: ${scenario.name}`, async () => {
        const result = await runGoldenScenario(scenario, { keepArtifacts: false });
        assertEquals(result.actor.remaining, []);
    });
}

Deno.test("golden actor fails on missing scripted turn", () => {
    const actor = new GoldenScenarioActor([{ id: "guide", agent: "guide", response: "ok" }]);
    assertRejects(
        async () => await Promise.resolve(actor.next({ agent: "router" })),
        Error,
        "Unexpected scripted turn",
    );
});

Deno.test("golden actor fails on unused scripted turn", () => {
    const actor = new GoldenScenarioActor([{ id: "router", agent: "router", response: "ok" }]);
    assertRejects(
        async () => await Promise.resolve(actor.assertComplete()),
        Error,
        "Unused scripted turns",
    );
});

Deno.test("golden runner reports unknown actions", async () => {
    await assertRejects(
        () => runGoldenScenario({ name: "bad", actions: [{ type: "unknown" }] }, { keepArtifacts: false }),
        Error,
        "Unknown scenario action",
    );
});
