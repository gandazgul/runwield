import { assertEquals } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import { runValidationLoop, shouldContinueParentEpicAfterValidation } from "./validation.ts";
import {
    makeRecordedSession,
    makeUi,
    makeValidationProjectRoot,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-core-test", uiAPI) };
}

/**
 * @param {"implemented" | "validated_ci" | "validated_reviewer"} status
 * @param {Record<string, string | number | null>} [attrs]
 */
async function makeLifecycleRun(status, attrs = {}) {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status,
        ...attrs,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status, ...attrs },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    return { projectRoot, hostedSession };
}

Deno.test("shouldContinueParentEpicAfterValidation ignores standalone FEATURE plans", () => {
    assertEquals(shouldContinueParentEpicAfterValidation({ classification: "FEATURE" }), false);
    assertEquals(
        shouldContinueParentEpicAfterValidation({ classification: "FEATURE", parentPlan: "" }),
        false,
    );
    assertEquals(
        shouldContinueParentEpicAfterValidation({ classification: "FEATURE", parentPlan: "epic" }),
        true,
    );
});

Deno.test("runValidationLoop starts at implemented and records only the mechanical pass boundary", async () => {
    const { projectRoot, hostedSession } = await makeLifecycleRun("implemented");
    let ciCalls = 0;

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => {
                ciCalls += 1;
                return Promise.resolve({ exitCode: 0, output: "ok", canceled: false });
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(ciCalls, 1);
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_ci");
    assertEquals(plan?.attrs.validationCiAttempts, 0);
});
