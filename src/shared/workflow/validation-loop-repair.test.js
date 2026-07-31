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

/**
 * @param {{ executionAgent?: "engineer" | "frontend-engineer" } & Record<string, unknown>} [attrs]
 */
async function makeImplementedRun(attrs = {}) {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "implemented",
        ...attrs,
    });
    const { hostedSession, uiAPI } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", ...attrs },
        executionAgent: attrs.executionAgent || "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    return { projectRoot, hostedSession, uiAPI };
}

Deno.test("runValidationLoop pauses with Engineer when CI repair does not call task_completed", async () => {
    const { projectRoot, hostedSession } = await makeImplementedRun();
    let repairCalls = 0;
    let repairAgentName = "";
    let repairRequest = "";

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        agentTurnPort: {
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                repairCalls += 1;
                repairAgentName = opts.agentName;
                repairRequest = opts.userRequest;
                return Promise.resolve(false);
            },
        },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "type error", canceled: false }),
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(repairCalls, 1);
    assertEquals(repairAgentName, "engineer");
    assertStringIncludes(repairRequest, "type error");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals(plan?.attrs.status, "implemented");
    assertEquals(plan?.attrs.validationCiAttempts, 1);
});

Deno.test("runValidationLoop preserves Frontend Engineer owner when CI repair pauses", async () => {
    const { projectRoot, hostedSession } = await makeImplementedRun({ executionAgent: "frontend-engineer" });
    let repairAgentName = "";

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        agentTurnPort: {
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                repairAgentName = opts.agentName;
                return Promise.resolve(false);
            },
        },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "css failed", canceled: false }),
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(repairAgentName, "frontend-engineer");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(plan?.attrs.validationCiAttempts, 1);
});

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
