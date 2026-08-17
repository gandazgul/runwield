import { assertEquals } from "@std/assert";
import {
    loadPlanAbandonProgressScenario,
    loadPlanActionsScenario,
    loadPlanCanceledExecutionThenPlannerReviewScenario,
    loadPlanInterruptedRecoveryScenario,
    loadPlanMalformedFrontMatterScenario,
    loadPlanResetReviewArchiveScenario,
    loadPlanValidateWaivedObjectiveChecksScenario,
    loadPlanWorkflowScenarios,
    loadPlanWorktreeInspectResetScenario,
} from "./load-plan-workflow.ts";

const scenarioExportNames = new Map<object, string>([
    [loadPlanActionsScenario, "loadPlanActionsScenario"],
    [loadPlanCanceledExecutionThenPlannerReviewScenario, "loadPlanCanceledExecutionThenPlannerReviewScenario"],
    [loadPlanResetReviewArchiveScenario, "loadPlanResetReviewArchiveScenario"],
    [loadPlanInterruptedRecoveryScenario, "loadPlanInterruptedRecoveryScenario"],
    [loadPlanWorktreeInspectResetScenario, "loadPlanWorktreeInspectResetScenario"],
    [loadPlanAbandonProgressScenario, "loadPlanAbandonProgressScenario"],
    [loadPlanMalformedFrontMatterScenario, "loadPlanMalformedFrontMatterScenario"],
    [loadPlanValidateWaivedObjectiveChecksScenario, "loadPlanValidateWaivedObjectiveChecksScenario"],
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
