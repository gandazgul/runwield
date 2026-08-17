import { assertEquals } from "@std/assert";
import {
    resumeCorruptSessionScenario,
    resumeInterruptedSessionScenario,
    resumePersistedSessionScenario,
    sessionResumeWorkflowScenarios,
} from "./session-resume-workflow.ts";

const scenarioExportNames = new Map<object, string>([
    [resumePersistedSessionScenario, "resumePersistedSessionScenario"],
    [resumeCorruptSessionScenario, "resumeCorruptSessionScenario"],
    [resumeInterruptedSessionScenario, "resumeInterruptedSessionScenario"],
]);

for (const scenario of sessionResumeWorkflowScenarios) {
    Deno.test({
        name: `golden Session resume: ${scenario.name}`,
        fn: async () => {
            const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
            const result = await runGoldenScenarioChildProcess({
                scenarioModule: "src/ui/tui/golden-scenarios/session-resume-workflow.ts",
                exportName: scenarioExportNames.get(scenario) || "",
                timeoutMs: scenario.timeoutMs || 90000,
            });
            assertEquals(result.result.actor.remaining, []);
        },
    });
}
