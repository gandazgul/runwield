import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import { runValidationLoop } from "./validation.ts";
import {
    makeRecordedSession,
    makeUi,
    makeValidationProjectRoot,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-repair-test", uiAPI) };
}

Deno.test("runValidationLoop reads persisted CI attempts and fails the implemented phase without resetting through another local loop", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "implemented",
        validationCiAttempts: 2,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "type error", canceled: false }),
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "failed");
    assertStringIncludes(result.reason || "", "after 3 repair attempts");
    assertEquals(plan?.attrs.status, "implemented");
    assertEquals(plan?.attrs.validationCiAttempts, 0);
});
