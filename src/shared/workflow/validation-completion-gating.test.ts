import { assertEquals, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "@std/path";

import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { loadPlan } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { ensureRootAgentSession } from "../session/session.js";
import { runValidationLoop } from "./validation.ts";
import { attachRecorder, makeUi, makeValidationProjectRoot } from "./validation-test-helpers.js";

type RepairRunOptions = {
    reportCompletion: boolean;
};

async function primeRepairRoot(hostedSession: HostedSession, projectRoot: string) {
    await ensureRootAgentSession({
        hostedSession,
        agentName: "engineer",
        cwd: projectRoot,
    });
}

async function runCiRepair({ reportCompletion }: RepairRunOptions) {
    return await withRuntimeCommandFixture(
        "validation-ci-repair-",
        async ({ setModelResponseFactory }) => {
            const projectRoot = await makeValidationProjectRoot("p", {
                classification: "PLANNED_CHANGE",
                status: "implemented",
                humanReviewMode: "none",
            });
            const ui = makeUi();
            const hostedSession = attachRecorder(new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot }), ui);
            const prompts: string[] = [];
            setModelResponseFactory((context) => {
                prompts.push(JSON.stringify(context));
                return reportCompletion
                    ? fauxAssistantMessage(fauxToolCall("task_completed", { message: "- CI repair completed." }))
                    : fauxAssistantMessage(fauxText("CI repair remains incomplete."));
            });
            await primeRepairRoot(hostedSession, projectRoot);
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

            const plan = await loadPlan(projectRoot, "p");
            hostedSession.dispose();
            return { ciRuns, plan, prompts, result };
        },
    );
}

async function runObjectiveRepair({ reportCompletion }: RepairRunOptions) {
    return await withRuntimeCommandFixture(
        "validation-objective-repair-",
        async ({ setModelResponseFactory }) => {
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
            setModelResponseFactory(async (context) => {
                prompts.push(JSON.stringify(context));
                await Deno.writeTextFile(join(projectRoot, ".objective-repaired"), "done\n");
                return reportCompletion
                    ? fauxAssistantMessage(
                        fauxToolCall("task_completed", {
                            message: "- Objective-Failing Check repair completed.",
                        }),
                    )
                    : fauxAssistantMessage(fauxText("Objective repair remains incomplete."));
            });
            await primeRepairRoot(hostedSession, projectRoot);
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

            const plan = await loadPlan(projectRoot, "p");
            hostedSession.dispose();
            return { ciRuns, plan, prompts, result };
        },
    );
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
