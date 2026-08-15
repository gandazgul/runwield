import { assertEquals } from "@std/assert";
import { assertValidationEvidenceRejectsCounterfeits } from "../testing/validation-workflow-coverage.ts";
import type { ValidationWorkflowBranchId } from "../testing/validation-workflow-coverage.ts";

type ValidationWorkflowScenario = {
    name: string;
    timeoutMs?: number;
    validationBranches?: ValidationWorkflowBranchId[];
};

export type ValidationWorkflowTestCase = {
    scenario: ValidationWorkflowScenario;
    exportName: string;
    todo?: string;
};

export function registerValidationWorkflowTests(
    scenarioModule: string,
    testCases: ValidationWorkflowTestCase[],
): void {
    for (const testCase of testCases) {
        const prefix = testCase.todo ? `TODO: ${testCase.todo} — ` : "";
        Deno.test({
            name: `${prefix}golden validation workflow: ${testCase.scenario.name}`,
            ignore: Boolean(testCase.todo),
            fn: async () => {
                const { runGoldenScenarioChildProcess } = await import("../testing/child-protocol.js");
                const result = await runGoldenScenarioChildProcess({
                    scenarioModule,
                    exportName: testCase.exportName,
                    timeoutMs: testCase.scenario.timeoutMs || 180000,
                });
                assertEquals(result.result.actor.remaining, []);
                for (const id of testCase.scenario.validationBranches || []) {
                    assertValidationEvidenceRejectsCounterfeits(id, result.result);
                }
            },
        });
    }
}
