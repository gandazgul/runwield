import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { ensureRootAgentSession } from "../session/session.js";
import { runValidationLoop } from "./validation.ts";
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

    const result = await runValidationLoop({
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

Deno.test("runValidationLoop preserves Frontend Engineer owner when CI repair pauses", async () => {
    const { projectRoot, hostedSession, repairRoot } = await makeImplementedRun({
        executionAgent: "frontend-engineer",
    });

    const result = await runValidationLoop({
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
