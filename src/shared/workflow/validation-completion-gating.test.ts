import { assertEquals, assertRejects, assertStrictEquals, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "@std/path";

import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { loadPlan } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { ensureRootAgentSession } from "../session/session.js";
import { createValidationSessionPort } from "./validation-session-adapter.ts";
import { attachRecorder, makeUi, makeValidationProjectRoot, runValidationLoop } from "./validation-test-helpers.js";

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
                                ? { kind: "completed", exitCode: 1, output: "type error" }
                                : { kind: "completed", exitCode: 0, output: "ok" },
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

async function runBrokenObjectiveCheck(selection = "reject") {
    return await withRuntimeCommandFixture(
        "validation-broken-objective-",
        async () => {
            const objectiveChecks = [{
                id: "OC1",
                command: "runwield-missing-objective-check-command",
                rationale: "The command is deliberately unavailable.",
            }];
            const projectRoot = await makeValidationProjectRoot("p", {
                classification: "PLANNED_CHANGE",
                status: "implemented",
                humanReviewMode: "none",
                objectiveChecks,
            });
            const ui = makeUi();
            ui.promptSelect = () => Promise.resolve(selection);
            const hostedSession = attachRecorder(new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot }), ui);
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
                    run: () => Promise.resolve({ kind: "completed", exitCode: 0, output: "ok" }),
                },
            });

            const plan = await loadPlan(projectRoot, "p");
            hostedSession.dispose();
            return { plan, result, systemCalls: ui.systemCalls };
        },
    );
}

async function runWaivedBrokenObjectiveCheckAgain() {
    return await withRuntimeCommandFixture(
        "validation-waived-broken-objective-",
        async () => {
            const objectiveChecks = [{
                id: "OC1",
                command: "runwield-missing-objective-check-command",
                rationale: "The command is deliberately unavailable.",
            }];
            const objectiveCheckWaivers = [{
                id: "OC1",
                command: "runwield-missing-objective-check-command",
                source: "mechanical_detection" as const,
                explanation: "The command is not available in this environment.",
                waivedAt: "2026-01-01T00:00:00.000Z",
            }];
            const projectRoot = await makeValidationProjectRoot("p", {
                classification: "PLANNED_CHANGE",
                status: "implemented",
                humanReviewMode: "none",
                objectiveChecks,
                objectiveCheckWaivers,
            });
            const ui = makeUi();
            const hostedSession = attachRecorder(new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot }), ui);
            await primeRepairRoot(hostedSession, projectRoot);
            const triageMeta = {
                classification: "PLANNED_CHANGE" as const,
                status: "implemented" as const,
                humanReviewMode: "none" as const,
                objectiveChecks,
                objectiveCheckWaivers,
            };
            hostedSession.setActiveExecutionWorkflow({
                planName: "p",
                triageMeta,
                executionAgent: "engineer",
                projectRoot,
                executionCwd: projectRoot,
                executionMode: "non_git_in_place",
                nonGitInPlace: true,
                validationContinuation: true,
            });

            const result = await runValidationLoop({
                hostedSession,
                planName: "p",
                planContent: "# p",
                triageMeta,
                localCI: {
                    run: () => Promise.resolve({ kind: "completed", exitCode: 0, output: "ok" }),
                },
            });

            const plan = await loadPlan(projectRoot, "p");
            hostedSession.dispose();
            return { plan, result, promptSelections: ui.promptSelections };
        },
    );
}

async function runEngineerReportedBrokenRepairThatNowPasses() {
    return await withRuntimeCommandFixture(
        "validation-objective-repair-broken-report-passes-",
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
            setModelResponseFactory(async () => {
                await Deno.writeTextFile(join(projectRoot, ".objective-repaired"), "done\n");
                return fauxAssistantMessage(
                    fauxToolCall("task_completed", {
                        message: "- Objective-Failing Check repair completed; the check looked broken during repair.",
                        brokenObjectiveChecks: [{ id: "OC1", explanation: "The marker was absent before repair." }],
                    }),
                );
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
                        return Promise.resolve({ kind: "completed", exitCode: 0, output: "ok" });
                    },
                },
            });

            const plan = await loadPlan(projectRoot, "p");
            hostedSession.dispose();
            return { ciRuns, plan, result };
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
                        return Promise.resolve({ kind: "completed", exitCode: 0, output: "ok" });
                    },
                },
            });

            const plan = await loadPlan(projectRoot, "p");
            hostedSession.dispose();
            return { ciRuns, plan, prompts, result };
        },
    );
}

Deno.test("PLANNED_CHANGE rejected broken objective check waiver dispatches repair", async () => {
    const run = await runBrokenObjectiveCheck();

    assertEquals(run.result.kind, "paused");
    assertStringIncludes(
        run.result.reason || "",
        "without task_completed during broken Objective-Failing Check repair",
    );
    assertEquals(run.plan?.attrs.status, "implemented");
    assertEquals(run.plan?.attrs.validationObjectiveCheckAttempts, 1);
    assertEquals(typeof run.plan?.attrs.failureReason, "string");
    assertEquals(run.plan?.attrs.objectiveCheckWaivers, undefined);
});

Deno.test("PLANNED_CHANGE broken objective check records accepted waiver and continues", async () => {
    const run = await runBrokenObjectiveCheck("waive");

    assertEquals(run.result.kind, "verified");
    assertEquals(run.plan?.attrs.status, "verified");
    assertEquals(run.plan?.attrs.objectiveCheckWaivers?.[0].source, "mechanical_detection");
    assertEquals(run.plan?.attrs.objectiveCheckWaivers?.[0].id, "OC1");
});

Deno.test("PLANNED_CHANGE skips already waived broken objective checks on later runs", async () => {
    const run = await runWaivedBrokenObjectiveCheckAgain();

    assertEquals(run.promptSelections, []);
    assertEquals(run.result.kind, "verified");
    assertEquals(run.plan?.attrs.status, "verified");
    assertEquals(run.plan?.attrs.objectiveCheckWaivers?.[0].id, "OC1");
});

Deno.test("PLANNED_CHANGE CI repair parks when Engineer does not call task_completed", async () => {
    const run = await runCiRepair({ reportCompletion: false });

    assertEquals(run.prompts.length, 1);
    assertEquals(run.ciRuns, 1);
    assertEquals(run.result.kind, "paused");
    assertStringIncludes(run.result.reason || "", "without task_completed during CI repair");
    assertEquals(run.plan?.attrs.status, "implemented");
    assertEquals(run.plan?.attrs.validationCiAttempts, 1);
    assertEquals(typeof run.plan?.attrs.failureReason, "string");
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
    assertEquals(run.plan?.attrs.validationObjectiveCheckAttempts, 1);
    assertEquals(typeof run.plan?.attrs.failureReason, "string");
});

Deno.test("PLANNED_CHANGE objective repair continues after Engineer calls task_completed", async () => {
    const run = await runObjectiveRepair({ reportCompletion: true });

    assertEquals(run.prompts.length, 1);
    assertEquals(run.ciRuns, 2);
    assertEquals(run.result.kind, "verified");
    assertEquals(run.plan?.attrs.status, "verified");
});

Deno.test("Engineer-reported broken objective check can still pass after repair without a durable report", async () => {
    const run = await runEngineerReportedBrokenRepairThatNowPasses();

    assertEquals(run.ciRuns, 2);
    assertEquals(run.result.kind, "verified");
    assertEquals(run.plan?.attrs.status, "verified");
    assertEquals(run.plan?.attrs.objectiveCheckWaivers, undefined);
});

Deno.test("validation repair runs independently and returns structured completion", async () => {
    await withRuntimeCommandFixture(
        "validation-adapter-empty-broken-objective-checks-",
        async ({ setModelResponseFactory }) => {
            const projectRoot = await makeValidationProjectRoot("p", {
                classification: "PLANNED_CHANGE",
                status: "implemented",
                humanReviewMode: "none",
            });
            const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot });
            setModelResponseFactory(() =>
                fauxAssistantMessage(fauxToolCall("task_completed", { message: "- Repair complete." }))
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

            const port = createValidationSessionPort(hostedSession);
            const outcome = await port.runIndependentRepairTurn({
                agentName: "engineer",
                userRequest: "Complete repair.",
                cwd: projectRoot,
            });

            assertEquals(outcome.completed, true);
            assertEquals(outcome.report, "- Repair complete.");
            assertEquals(outcome.brokenObjectiveChecks, []);
            assertEquals(hostedSession.getRootAgentSession(), null);
            hostedSession.dispose();
        },
    );
});

Deno.test("failed validation repair keeps its private manager for backend continuation", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        humanReviewMode: "none",
    });
    const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot });
    const managers: object[] = [];
    let calls = 0;
    const port = createValidationSessionPort(hostedSession, {
        semanticReviewPort: {
            runIsolatedAgentSession: (options) => {
                managers.push(options.sessionManager || {});
                calls += 1;
                if (calls === 1) return Promise.reject(new Error("backend failed"));
                return Promise.resolve([
                    fauxAssistantMessage(fauxToolCall("task_completed", { message: "repair continued" })),
                ]);
            },
        },
    });
    const request = {
        agentName: "engineer",
        userRequest: "Stable repair packet",
        cwd: projectRoot,
    };

    await assertRejects(() => port.runIndependentRepairTurn(request), Error, "backend failed");
    const outcome = await port.runIndependentRepairTurn(request);

    assertEquals(managers.length, 2);
    assertStrictEquals(managers[0], managers[1]);
    assertEquals(outcome.completed, false);
    assertEquals(hostedSession.getRootAgentSession(), null);
    hostedSession.dispose();
});

Deno.test("completed validation repair can be reopened with the exact same session", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
    });
    const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot });
    const managers: object[] = [];
    const requests: string[] = [];
    const port = createValidationSessionPort(hostedSession, {
        semanticReviewPort: {
            runIsolatedAgentSession: (options) => {
                managers.push(options.sessionManager || {});
                requests.push(options.userRequest);
                return Promise.resolve([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed", message: `Repair ${requests.length} complete.` },
                }] as never);
            },
        },
    });

    const first = await port.runIndependentRepairTurn({
        agentName: "reviewer-feedback-engineer",
        userRequest: "Initial repair evidence.",
        cwd: projectRoot,
    });
    const followUp = await port.continueLastRepairTurn("User guidance for the same repair.");

    assertEquals(first.completed, true);
    assertEquals(followUp?.completed, true);
    assertStrictEquals(managers[0], managers[1]);
    assertEquals(requests, ["Initial repair evidence.", "User guidance for the same repair."]);
    hostedSession.dispose();
});
