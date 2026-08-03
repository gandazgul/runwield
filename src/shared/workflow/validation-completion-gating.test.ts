import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { loadPlan } from "../../plan-store.js";
import { createTaskCompletedTool } from "../../tools/task-completed.ts";
import { HostedSession } from "../session/hosted-session.js";
import { ensureRootAgentSession } from "../session/session.js";
import { runValidationLoop } from "./validation.ts";
import { attachRecorder, makeUi, makeValidationProjectRoot } from "./validation-test-helpers.js";

const EXTENSION_CONTEXT = {} as ExtensionContext;

type RepairRunOptions = {
    reportCompletion: boolean;
};

type RepairPrompt = (request: string) => Promise<void>;

async function primeRepairRoot(hostedSession: HostedSession, projectRoot: string, prompt: RepairPrompt) {
    const rootSession = {
        model: "test/fake",
        agent: { state: { messages: [] }, waitForIdle: () => Promise.resolve() },
        prompt,
        dispose: () => {},
    };
    await ensureRootAgentSession({
        hostedSession,
        agentName: "engineer",
        cwd: projectRoot,
        _buildAgentSession: () =>
            Promise.resolve({
                session: rootSession,
                agentDef: { name: "engineer", displayName: "Engineer" },
                promptState: { text: "fake system prompt" },
                tools: [],
                finalCustomTools: [],
                resolvedModel: { provider: "test", id: "fake" },
            }),
        _attachSessionEventSubscribers: () => ({
            resetTurn: () => {},
            endThinking: () => {},
            drainInvokedToolNames: () => [],
            unsubscribe: () => {},
        }),
    });
}

async function runCiRepair({ reportCompletion }: RepairRunOptions) {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        humanReviewMode: "none",
    });
    const ui = makeUi();
    const hostedSession = attachRecorder(new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot }), ui);
    const prompts: string[] = [];
    const completionTool = createTaskCompletedTool({
        hostedSession,
        agentName: "engineer",
        recordWorkflowMetric: () => Promise.resolve(null),
    });
    await primeRepairRoot(
        hostedSession,
        projectRoot,
        async (request) => {
            prompts.push(request);
            if (!reportCompletion) return;
            await completionTool.execute(
                "repair-completed",
                { message: "- CI repair completed." },
                undefined,
                undefined,
                EXTENSION_CONTEXT,
            );
        },
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", humanReviewMode: "none" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        executionMode: "non_git_in_place",
        nonGitInPlace: true,
        validationContinuation: true,
    });

    let ciRuns = 0;
    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", humanReviewMode: "none" },
        localCI: {
            run: () => {
                ciRuns += 1;
                return Promise.resolve(
                    ciRuns === 1
                        ? { exitCode: 1, output: "type error", canceled: false }
                        : { exitCode: 0, output: "ok", canceled: false },
                );
            },
        },
    });

    return {
        ciRuns,
        plan: await loadPlan(projectRoot, "p"),
        prompts,
        result,
    };
}

async function runObjectiveRepair({ reportCompletion }: RepairRunOptions) {
    const objectiveChecks = [{
        id: "OC1",
        command: "test -f .objective-repaired",
        rationale: "The repair creates its proof marker.",
    }];
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        humanReviewMode: "none",
        objectiveChecks,
    });
    const ui = makeUi();
    const hostedSession = attachRecorder(new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot }), ui);
    const prompts: string[] = [];
    const completionTool = createTaskCompletedTool({
        hostedSession,
        agentName: "engineer",
        recordWorkflowMetric: () => Promise.resolve(null),
    });
    await primeRepairRoot(
        hostedSession,
        projectRoot,
        async (request) => {
            prompts.push(request);
            await Deno.writeTextFile(join(projectRoot, ".objective-repaired"), "done\n");
            if (!reportCompletion) return;
            await completionTool.execute(
                "repair-completed",
                { message: "- Objective-Failing Check repair completed." },
                undefined,
                undefined,
                EXTENSION_CONTEXT,
            );
        },
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: {
            classification: "PLANNED_CHANGE",
            status: "implemented",
            humanReviewMode: "none",
            objectiveChecks,
        },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        executionMode: "non_git_in_place",
        nonGitInPlace: true,
        validationContinuation: true,
    });

    let ciRuns = 0;
    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: {
            classification: "PLANNED_CHANGE",
            status: "implemented",
            humanReviewMode: "none",
            objectiveChecks,
        },
        localCI: {
            run: () => {
                ciRuns += 1;
                return Promise.resolve({ exitCode: 0, output: "ok", canceled: false });
            },
        },
    });

    return {
        ciRuns,
        plan: await loadPlan(projectRoot, "p"),
        prompts,
        result,
    };
}

Deno.test("PLANNED_CHANGE CI repair parks when Engineer does not call task_completed", async () => {
    const run = await runCiRepair({ reportCompletion: false });

    assertEquals(run.prompts.length, 1);
    assertEquals(run.ciRuns, 1);
    assertEquals(run.result.kind, "paused");
    assertStringIncludes(run.result.reason || "", "without task_completed during CI repair");
    assertEquals(run.plan?.attrs.status, "implemented");
    assertEquals(run.plan?.attrs.validationCiAttempts, 1);
});

Deno.test("PLANNED_CHANGE CI repair continues after Engineer calls task_completed", async () => {
    const run = await runCiRepair({ reportCompletion: true });

    assertEquals(run.prompts.length, 1);
    assertEquals(run.ciRuns, 2);
    assertEquals(run.result.kind, "verified");
    assertEquals(run.plan?.attrs.status, "verified");
});

Deno.test("PLANNED_CHANGE objective repair parks when Engineer does not call task_completed", async () => {
    const run = await runObjectiveRepair({ reportCompletion: false });

    assertEquals(run.prompts.length, 1);
    assertEquals(run.ciRuns, 1);
    assertEquals(run.result.kind, "paused");
    assertStringIncludes(run.result.reason || "", "without task_completed during Objective-Failing Check repair");
    assertEquals(run.plan?.attrs.status, "implemented");
    assertEquals(run.plan?.attrs.validationCiAttempts, 1);
});

Deno.test("PLANNED_CHANGE objective repair continues after Engineer calls task_completed", async () => {
    const run = await runObjectiveRepair({ reportCompletion: true });

    assertEquals(run.prompts.length, 1);
    assertEquals(run.ciRuns, 2);
    assertEquals(run.result.kind, "verified");
    assertEquals(run.plan?.attrs.status, "verified");
});
