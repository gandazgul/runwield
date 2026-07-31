import { assertEquals } from "@std/assert";

import { loadPlan, savePlan } from "../../plan-store.js";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { HostedSession } from "../session/hosted-session.js";
import { runValidationLoop, shouldContinueParentEpicAfterValidation } from "./validation.ts";
import { startActiveExecutionWorkflow } from "./workflow.js";
import {
    attachRecorder,
    makeRecordedSession,
    makeUi,
    makeValidationProjectRoot,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

const footerExecutionRepo = defineGitFixture(async (repoPath) => {
    await savePlan(repoPath, "footer-plan", "# footer-plan\n\nvalidation fixture\n", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "ready_for_work",
        summary: "validation fixture",
        affectedPaths: [],
    });
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "fixture base"]);
});

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
    const triageMeta = { classification: "QUICK_FIX", status, ...attrs };
    hostedSession.setWorkflowExecutionContext({
        planName: "p",
        triageMeta,
    });
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta,
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    return { projectRoot, hostedSession };
}

Deno.test("startActiveExecutionWorkflow seeds footer workflow context from Plan front matter", async () => {
    const projectRoot = await footerExecutionRepo.checkout({ prefix: "footer-context-start-" });
    const plan = await loadPlan(projectRoot, "footer-plan");
    const uiAPI = makeUi();
    const hostedSession = attachRecorder(
        new HostedSession({ id: "footer-context-start-test", cwd: projectRoot }),
        uiAPI,
    );

    await startActiveExecutionWorkflow({
        planName: "footer-plan",
        triageMeta: plan?.attrs || {},
        currentStatus: "ready_for_work",
        hostedSession,
    });

    assertEquals(hostedSession.getWorkflowContext(), {
        routingIntent: "PLANNED_CHANGE",
        complexity: "MEDIUM",
        planName: "footer-plan",
    });
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "engineer");
});

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
    const expectedWorkflowContext = { routingIntent: "QUICK_FIX", complexity: "MEDIUM", planName: "p" };
    const { projectRoot, hostedSession } = await makeLifecycleRun("implemented", { complexity: "MEDIUM" });
    let ciCalls = 0;
    assertEquals(hostedSession.getWorkflowContext(), expectedWorkflowContext);

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", complexity: "MEDIUM" },
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
    assertEquals(hostedSession.getWorkflowContext(), expectedWorkflowContext);
    assertEquals(plan?.attrs.status, "validated_ci");
    assertEquals(plan?.attrs.validationCiAttempts, 0);
});
