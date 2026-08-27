import { assertEquals } from "@std/assert";
import {
    loadPlanAbandonProgressScenario,
    loadPlanActionsScenario,
    loadPlanCanceledExecutionThenPlannerReviewScenario,
    loadPlanContinueUsesExecutionPlanAuthorityScenario,
    loadPlanDirectReviewRunScenario,
    loadPlanDirectReviewScenario,
    loadPlanImplementedFollowUpRepaintsScenario,
    loadPlanInterruptedRecoveryScenario,
    loadPlanMalformedFrontMatterScenario,
    loadPlanResetReviewArchiveScenario,
    loadPlanValidateWithoutCustomChecksScenario,
    loadPlanWorkflowScenarios,
    loadPlanWorktreeInspectResetScenario,
} from "./load-plan-workflow.ts";

const scenarioExportNames = new Map<object, string>([
    [loadPlanActionsScenario, "loadPlanActionsScenario"],
    [loadPlanDirectReviewScenario, "loadPlanDirectReviewScenario"],
    [loadPlanDirectReviewRunScenario, "loadPlanDirectReviewRunScenario"],
    [loadPlanCanceledExecutionThenPlannerReviewScenario, "loadPlanCanceledExecutionThenPlannerReviewScenario"],
    [loadPlanImplementedFollowUpRepaintsScenario, "loadPlanImplementedFollowUpRepaintsScenario"],
    [loadPlanResetReviewArchiveScenario, "loadPlanResetReviewArchiveScenario"],
    [loadPlanInterruptedRecoveryScenario, "loadPlanInterruptedRecoveryScenario"],
    [loadPlanWorktreeInspectResetScenario, "loadPlanWorktreeInspectResetScenario"],
    [loadPlanAbandonProgressScenario, "loadPlanAbandonProgressScenario"],
    [loadPlanContinueUsesExecutionPlanAuthorityScenario, "loadPlanContinueUsesExecutionPlanAuthorityScenario"],
    [loadPlanMalformedFrontMatterScenario, "loadPlanMalformedFrontMatterScenario"],
    [loadPlanValidateWithoutCustomChecksScenario, "loadPlanValidateWithoutCustomChecksScenario"],
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
