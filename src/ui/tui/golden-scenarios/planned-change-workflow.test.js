import { assertEquals } from "@std/assert";
import {
    plannedChangeCiRepairReentryScenario,
    plannedChangeFrontendIdentityScenario,
    plannedChangeNonGitInPlaceScenario,
    plannedChangeReviewRepairValidationScenario,
    plannedChangeValidationExhaustedScenario,
    plannedChangeValidationFailureRetryScenario,
    plannedChangeWorkflowScenarios,
} from "./planned-change-workflow.js";

const scenarioExportNames = new Map(
    /** @type {Array<[object, string]>} */ ([
        [plannedChangeReviewRepairValidationScenario, "plannedChangeReviewRepairValidationScenario"],
        [plannedChangeFrontendIdentityScenario, "plannedChangeFrontendIdentityScenario"],
        [plannedChangeCiRepairReentryScenario, "plannedChangeCiRepairReentryScenario"],
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
                // Read from the scenario rather than fixed here, so the budget lives next
                // to the waits it has to cover. A cap hidden in the test file silently
                // overrode those waits and killed the child before they could apply.
                timeoutMs: /** @type {{ timeoutMs?: number }} */ (scenario).timeoutMs || 120000,
            });
            assertEquals(result.result.actor.remaining, []);
        },
    });
}
