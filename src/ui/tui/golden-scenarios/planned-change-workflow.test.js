import { assertEquals } from "@std/assert";
import {
    plannedChangeBlockedMergePauseScenario,
    plannedChangeNonGitInPlaceScenario,
    plannedChangeReviewRepairValidationScenario,
    plannedChangeValidationExhaustedScenario,
    plannedChangeValidationFailureRetryScenario,
    plannedChangeWorkflowScenarios,
} from "./planned-change-workflow.js";

const scenarioExportNames = new Map(
    /** @type {Array<[object, string]>} */ ([
        [plannedChangeReviewRepairValidationScenario, "plannedChangeReviewRepairValidationScenario"],
        [plannedChangeBlockedMergePauseScenario, "plannedChangeBlockedMergePauseScenario"],
        [plannedChangeNonGitInPlaceScenario, "plannedChangeNonGitInPlaceScenario"],
        [plannedChangeValidationFailureRetryScenario, "plannedChangeValidationFailureRetryScenario"],
        [plannedChangeValidationExhaustedScenario, "plannedChangeValidationExhaustedScenario"],
    ]),
);

for (const scenario of plannedChangeWorkflowScenarios) {
    Deno.test({
        name: `golden PLANNED_CHANGE workflow: ${scenario.name}`,
        fn: async () => {
            const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
            const result = await runGoldenScenarioChildProcess({
                scenarioModule: "src/ui/tui/golden-scenarios/planned-change-workflow.js",
                exportName: scenarioExportNames.get(scenario) || "",
                timeoutMs: scenario.timeoutMs || 120000,
            });
            assertEquals(result.result.actor.remaining, []);
        },
    });
}
