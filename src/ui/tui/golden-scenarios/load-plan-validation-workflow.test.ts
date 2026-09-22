import { assertEquals } from "@std/assert";
import {
    loadPlanContinueUsesExecutionPlanAuthorityScenario,
    loadPlanImplementedFollowUpRepaintsScenario,
    loadPlanResetReviewArchiveScenario,
    loadPlanValidateWithoutCustomChecksScenario,
} from "./load-plan-workflow.ts";

const scenarios = {
    loadPlanImplementedFollowUpRepaintsScenario,
    loadPlanResetReviewArchiveScenario,
    loadPlanContinueUsesExecutionPlanAuthorityScenario,
    loadPlanValidateWithoutCustomChecksScenario,
};

for (const [exportName, scenario] of Object.entries(scenarios)) {
    Deno.test({
        name: `golden /load-plan workflow: ${scenario.name}`,
        fn: async () => {
            const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
            const result = await runGoldenScenarioChildProcess({
                scenarioModule: "src/ui/tui/golden-scenarios/load-plan-workflow.ts",
                exportName,
                timeoutMs: ("timeoutMs" in scenario ? scenario.timeoutMs : undefined) || 60000,
            });
            assertEquals(result.result.actor.remaining, []);
        },
    });
}
