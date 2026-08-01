import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { ensureRootAgentSession } from "../session/session.js";
import { runValidationLoop, runValidationPhase } from "./validation.ts";
import {
    attachRecorder,
    makeUi,
    makeValidationProjectRoot,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

function makeValidationUi(cwd = Deno.cwd()) {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: attachRecorder(new HostedSession({ id: "validation-repair-test", cwd }), uiAPI) };
}

/**
 * @param {import("../session/hosted-session.js").HostedSession} hostedSession
 * @param {"engineer" | "frontend-engineer"} agentName
 * @param {string} cwd
 * @returns {Promise<{ prompts: string[] }>}
 */
async function primeRepairAgentRoot(hostedSession, agentName, cwd) {
    const prompts = /** @type {string[]} */ ([]);
    const session = /** @type {any} */ ({
        model: "test/fake",
        agent: { state: { messages: [] }, waitForIdle: () => Promise.resolve() },
        prompt: (/** @type {string} */ request) => {
            prompts.push(String(request));
            return Promise.resolve();
        },
        dispose: () => {},
    });
    const turnState = {
        resetTurn: () => {},
        endThinking: () => {},
        drainInvokedToolNames: () => [],
        unsubscribe: () => {},
    };
    await ensureRootAgentSession({
        hostedSession,
        agentName,
        cwd,
        _buildAgentSession: () =>
            Promise.resolve({
                session,
                agentDef: { name: agentName, displayName: agentName },
                promptState: { text: "fake system prompt" },
                tools: [],
                finalCustomTools: [],
                resolvedModel: { provider: "test", id: "fake" },
            }),
        _attachSessionEventSubscribers: () => turnState,
    });
    return { prompts };
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
    const { hostedSession, uiAPI } = makeValidationUi(projectRoot);
    const executionAgent = attrs.executionAgent || "engineer";
    const repairRoot = await primeRepairAgentRoot(hostedSession, executionAgent, projectRoot);
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", ...attrs },
        executionAgent,
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    return { projectRoot, hostedSession, uiAPI, repairRoot };
}

Deno.test("runValidationLoop pauses with Engineer when CI repair does not call task_completed", async () => {
    const { projectRoot, hostedSession, repairRoot } = await makeImplementedRun();

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "type error", canceled: false }),
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(repairRoot.prompts.length, 1);
    assertEquals(hostedSession.getRootAgentName(), "engineer");
    assertStringIncludes(repairRoot.prompts[0], "type error");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals(plan?.attrs.status, "implemented");
    assertEquals(plan?.attrs.validationCiAttempts, 1);
});

Deno.test("runValidationLoop dispatches repair when Objective-Failing Checks are unmet", async () => {
    const objectiveChecks = [{ id: "OC1", command: "false", rationale: "must become true" }];
    const { projectRoot, hostedSession, repairRoot } = await makeImplementedRun({ objectiveChecks });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }),
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(repairRoot.prompts.length, 1);
    assertStringIncludes(repairRoot.prompts[0], "Objective-Failing Checks");
    assertStringIncludes(repairRoot.prompts[0], "OC1: unmet");
    assertEquals(plan?.attrs.validationCiAttempts, 1);
});

Deno.test("runValidationLoop stops without repair when an Objective-Failing Check is broken", async () => {
    const objectiveChecks = [{ id: "OC1", command: "not-a-real-runwield-command" }];
    const { projectRoot, hostedSession, repairRoot } = await makeImplementedRun({ objectiveChecks });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }),
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "failed");
    assertStringIncludes(result.reason || "", "Objective-Failing Check defect");
    assertEquals(repairRoot.prompts.length, 0);
    assertEquals(plan?.attrs.validationCiAttempts, 0);
});

Deno.test("runValidationLoop preserves Frontend Engineer owner when CI repair pauses", async () => {
    const { projectRoot, hostedSession, repairRoot } = await makeImplementedRun({
        executionAgent: "frontend-engineer",
    });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "css failed", canceled: false }),
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(hostedSession.getRootAgentName(), "frontend-engineer");
    assertStringIncludes(repairRoot.prompts[0], "css failed");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(plan?.attrs.validationCiAttempts, 1);
});

Deno.test("runValidationLoop offers a way out when the repair rounds for CI are spent", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "implemented",
        validationCiAttempts: 2,
    });
    const { hostedSession, uiAPI } = makeValidationUi();
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
    // The user is asked before RunWield gives up, and told what would help.
    assertEquals(uiAPI.promptSelections.length, 1);
    assertEquals(result.kind, "failed");
    assertStringIncludes(result.reason || "", "still failing");
    assertStringIncludes(result.reason || "", "pick Retry");
    assertEquals(plan?.attrs.status, "implemented");
    // Cleared, so the Retry the message promises actually gets rounds to spend.
    assertEquals(plan?.attrs.validationCiAttempts, 0);
});

Deno.test("Retry after the CI rounds run out runs the tests again and carries on", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "implemented",
        validationCiAttempts: 2,
    });
    const { hostedSession, uiAPI } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    // The user fixes the tests, then picks Retry — exactly what the pause told them
    // to do. RunWield must run them again in the same breath, not make the user
    // start the whole Plan over.
    let ciRuns = 0;
    uiAPI.promptSelect = () => {
        uiAPI.promptSelections.push("prompted");
        return Promise.resolve("retry");
    };

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => {
                ciRuns += 1;
                return Promise.resolve(
                    ciRuns === 1
                        ? { exitCode: 1, output: "type error", canceled: false }
                        : { exitCode: 0, output: "ok", canceled: false },
                );
            },
        }),
    });

    assertEquals(uiAPI.promptSelections.length, 1);
    assertEquals(ciRuns, 2);
    assertEquals(result.kind, "paused");
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "validated_ci");
});

Deno.test("a stopped test run asks rather than reporting the work as broken", async () => {
    const projectRoot = await makeValidationProjectRoot("p", { classification: "QUICK_FIX", status: "implemented" });
    const { hostedSession, uiAPI } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 130, output: "", canceled: true }),
        }),
    });

    assertEquals(uiAPI.promptSelections.length, 1);
    assertEquals(result.kind, "paused");
    assertStringIncludes(result.reason || "", "stopped before they finished");
    // Nothing was learned, so nothing is recorded: the Plan stays where it was.
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "implemented");
});
