import { assertEquals } from "@std/assert";
import {
    loadPlanAbandonProgressScenario,
    loadPlanActionsScenario,
    loadPlanInterruptedRecoveryScenario,
    loadPlanMalformedFrontMatterScenario,
    loadPlanWorkflowScenarios,
} from "./load-plan-workflow.ts";

const scenarioExportNames = new Map<object, string>([
    [loadPlanActionsScenario, "loadPlanActionsScenario"],
    [loadPlanInterruptedRecoveryScenario, "loadPlanInterruptedRecoveryScenario"],
    [loadPlanAbandonProgressScenario, "loadPlanAbandonProgressScenario"],
    [loadPlanMalformedFrontMatterScenario, "loadPlanMalformedFrontMatterScenario"],
]);

for (const scenario of loadPlanWorkflowScenarios) {
    Deno.test({
        name: `golden /load-plan workflow: ${scenario.name}`,
        fn: async () => {
            const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
            const result = await runGoldenScenarioChildProcess({
                scenarioModule: "src/ui/tui/golden-scenarios/load-plan-workflow.ts",
                exportName: scenarioExportNames.get(scenario) || "",
                timeoutMs: scenario.timeoutMs || 60000,
            });
            assertEquals(result.result.actor.remaining, []);
        },
    });
}
