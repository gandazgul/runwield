import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { loadPlan, savePlan } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { createValidationSessionPort } from "./validation-session-adapter.ts";
import { attachRecorder, makeUi, makeValidationProjectRoot, runValidationLoop } from "./validation-test-helpers.js";
import { executeWorkflowTestTools } from "../../testing/workflow-agent-tools.ts";
import { runWorkflowValidationToStableBoundary } from "./validation-supervisor.ts";
import { createGitPort } from "../git-port.ts";
import { createWorkRecordMnemotecaFixture } from "../work-records/test-fixtures/mnemoteca-port.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { runValidationAgentUntilEvent } from "../session/agent-workflow-step.ts";
import { createTestWorktreeAttempt, git as runGit, makeRepo } from "../worktree-test-helpers.js";
import { switchActiveAgent } from "../session/agent-switching.js";

for (const outcome of ["canceled", "blocked"] as const) {
    Deno.test(`canceling human review (${outcome}) cannot publish through the outer driver`, async () => {
        const projectRoot = await makeValidationProjectRoot("p", {
            classification: "PLANNED_CHANGE",
            status: "validated_reviewer",
            humanReviewMode: "ask",
            humanReviewDecision: null,
        });
        const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot });
        let prompts = 0;
        hostedSession.setInteractionAdapter({
            requestInteraction: () => {
                prompts += 1;
                return Promise.resolve({ outcome });
            },
        });
        const result = await runWorkflowValidationToStableBoundary({
            hostedSession,
            planName: "p",
            planContent: "# stale",
            triageMeta: { classification: "PLANNED_CHANGE", status: "validated_reviewer" },
            git: createGitPort(),
            localCI: {
                run: () => {
                    throw new Error("Cancellation must not run CI");
                },
            },
            workRecordMnemotecaPort: createWorkRecordMnemotecaFixture(),
        });
        assertEquals(result.kind, "paused");
        assertEquals(result.continueValidation, undefined);
        assertEquals(prompts, 1);
        const plan = await loadPlan(projectRoot, "p");
        assertEquals(plan?.attrs.status, "validated_reviewer");
        assertEquals(plan?.attrs.humanReviewDecision, null);
        hostedSession.dispose();
    });
}

Deno.test("verified publication moves the root Session to Engineer in the primary checkout", async () => {
    await withRuntimeCommandFixture("published-handoff-", async () => {
        const projectRoot = await makeRepo();
        const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-validation-worktree-" });
        const planName = "published-follow-up";
        try {
            await savePlan(projectRoot, planName, `# ${planName}\n\nvalidation fixture\n`, {
                classification: "PLANNED_CHANGE",
                status: "validated_reviewer",
                summary: "validation fixture",
                affectedPaths: ["published-marker.txt"],
                planId: "published-follow-up-plan",
                executionAgent: "engineer",
                executionMode: "worktree",
                humanReviewMode: "none",
            });
            await runGit(projectRoot, ["add", "."]);
            await runGit(projectRoot, ["commit", "-m", "add plan"]);
            const baseTree = await runGit(projectRoot, ["rev-parse", "HEAD^{tree}"]);
            const worktree = await createTestWorktreeAttempt({
                projectRoot,
                planName,
                planId: "published-follow-up-plan",
                worktreeRoot,
                attemptId: "attempt-1",
            });
            const worktreePlan = await loadPlan(worktree.path, planName);
            if (!worktreePlan) throw new Error("worktree Plan fixture disappeared");
            await savePlan(worktree.path, planName, `# ${planName}\n\nvalidation fixture\n`, {
                classification: "PLANNED_CHANGE",
                status: "validated_reviewer",
                summary: "validation fixture",
                affectedPaths: ["published-marker.txt"],
                planId: "published-follow-up-plan",
                executionAgent: "engineer",
                executionMode: "worktree",
                humanReviewMode: "none",
                executionBaselineTree: baseTree,
                worktreeId: worktree.id,
                worktreePath: worktree.path,
                worktreeBranch: worktree.branch,
                worktreeBaseBranch: "main",
            }, { expectedRevision: worktreePlan.revision });
            await Deno.writeTextFile(join(worktree.path, "published-marker.txt"), "from worktree\n");
            const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: worktree.path });
            await switchActiveAgent(hostedSession, { agentName: "planner", cwd: worktree.path });
            hostedSession.setActiveExecutionWorkflow({
                planName,
                triageMeta: { classification: "PLANNED_CHANGE", status: "validated_reviewer" },
                executionAgent: "engineer",
                projectRoot,
                executionCwd: worktree.path,
                executionMode: "worktree",
                baselineTree: baseTree,
                worktreeId: worktree.id,
                worktreeBranch: worktree.branch,
                worktreeBaseBranch: "main",
            });

            const result = await runWorkflowValidationToStableBoundary({
                hostedSession,
                planName,
                planContent: `# ${planName}`,
                triageMeta: { classification: "PLANNED_CHANGE", status: "validated_reviewer" },
                git: createGitPort(),
                localCI: {
                    run: () => {
                        throw new Error("Publication regression should not run CI");
                    },
                },
                workRecordMnemotecaPort: createWorkRecordMnemotecaFixture(),
            });

            assertEquals(result.kind, "verified");
            assertEquals(await Deno.stat(worktree.path).then(() => true).catch(() => false), false);
            assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
            assertEquals(hostedSession.getRootAgentName(), "engineer");
            const canonicalProjectRoot = await Deno.realPath(projectRoot);
            assertEquals(hostedSession.cwd, canonicalProjectRoot);
            const shell = await new Deno.Command("sh", {
                cwd: hostedSession.cwd,
                args: ["-c", "pwd && git branch --show-current && cat published-marker.txt"],
                stdout: "piped",
                stderr: "piped",
            }).output();
            assertEquals(shell.success, true, new TextDecoder().decode(shell.stderr));
            assertStringIncludes(new TextDecoder().decode(shell.stdout), canonicalProjectRoot);
            assertStringIncludes(new TextDecoder().decode(shell.stdout), "main");
            assertStringIncludes(new TextDecoder().decode(shell.stdout), "from worktree");
            hostedSession.dispose();
        } finally {
            await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
            await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
        }
    });
});

Deno.test("paused validation keeps the execution workflow cwd", async () => {
    const projectRoot = await makeValidationProjectRoot("paused-context", {
        classification: "PLANNED_CHANGE",
        status: "validated_reviewer",
        humanReviewMode: "ask",
        humanReviewDecision: null,
    });
    const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot });
    hostedSession.setInteractionAdapter({
        requestInteraction: () => Promise.resolve({ outcome: "canceled" }),
    });
    hostedSession.setActiveExecutionWorkflow({
        planName: "paused-context",
        triageMeta: { classification: "PLANNED_CHANGE", status: "validated_reviewer" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        executionMode: "non_git_in_place",
        nonGitInPlace: true,
    });
    const result = await runWorkflowValidationToStableBoundary({
        hostedSession,
        planName: "paused-context",
        planContent: "# paused-context",
        triageMeta: { classification: "PLANNED_CHANGE", status: "validated_reviewer" },
        git: createGitPort(),
        localCI: {
            run: () => {
                throw new Error("Paused validation regression should not run CI");
            },
        },
        workRecordMnemotecaPort: createWorkRecordMnemotecaFixture(),
    });
    assertEquals(result.kind, "paused");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionCwd, projectRoot);
    hostedSession.dispose();
});

for (const repaired of [true, false]) {
    Deno.test(`third repair is checked before ${repaired ? "continuing" : "stopping without a fourth repair"}`, async () => {
        await withRuntimeCommandFixture("third-repair-boundary-", async ({ setModelResponseFactories }) => {
            const projectRoot = await makeValidationProjectRoot("p", {
                classification: "PLANNED_CHANGE",
                status: "implemented",
                humanReviewMode: "none",
            });
            const ui = makeUi();
            ui.promptSelect = () => Promise.resolve("stop");
            const hostedSession = attachRecorder(new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot }), ui);
            hostedSession.setActiveExecutionWorkflow({
                planName: "p",
                triageMeta: { classification: "PLANNED_CHANGE", status: "implemented" },
                executionAgent: "engineer",
                projectRoot,
                executionCwd: projectRoot,
                executionMode: "non_git_in_place",
                nonGitInPlace: true,
            });
            let repairs = 0;
            let checks = 0;
            const repairResponse = () => {
                repairs += 1;
                Deno.writeTextFileSync(join(projectRoot, "implementation.txt"), String(repairs));
                return fauxAssistantMessage(fauxToolCall("task_completed", { message: `Repair ${repairs} finished.` }));
            };
            setModelResponseFactories([repairResponse, repairResponse, repairResponse]);
            const result = await runValidationLoop({
                hostedSession,
                planName: "p",
                planContent: "# p",
                triageMeta: { classification: "PLANNED_CHANGE", status: "implemented" },
                localCI: {
                    run: async () => {
                        checks += 1;
                        if (checks > 1) {
                            assertEquals(
                                await Deno.readTextFile(join(projectRoot, "implementation.txt")),
                                String(checks - 1),
                            );
                        }
                        return { kind: "completed", exitCode: repaired && checks === 4 ? 0 : 1, output: "test result" };
                    },
                },
            });
            assertEquals(repairs, 3);
            assertEquals(checks, 4);
            assertEquals(result.kind, repaired ? "verified" : "paused");
            assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, repaired ? "validated" : "implemented");
            hostedSession.dispose();
        });
    });
}

Deno.test("accepted completion stops the producer without waiting for natural turn end", async () => {
    const cwd = await makeValidationProjectRoot("p", { classification: "PLANNED_CHANGE", status: "implemented" });
    const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
    let interrupted = false;
    const port = createValidationSessionPort(hostedSession, {
        semanticReviewPort: {
            runIsolatedAgentSession: async (options) => {
                // This backend deliberately cannot finish naturally. Acceptance must
                // initiate its shutdown; a driver waiting for output would hang here.
                const stopped = new Promise<void>((resolve) => {
                    options.signal?.addEventListener("abort", () => {
                        interrupted = true;
                        resolve();
                    }, { once: true });
                });
                await executeWorkflowTestTools(options, [{
                    name: "task_completed",
                    arguments: { message: "Finished." },
                }]);
                await stopped;
                return [];
            },
        },
    });
    const result = await port.runIndependentRepairTurn({ agentName: "engineer", cwd, userRequest: "Fix it" });
    assertEquals(interrupted, true);
    assertEquals(result, { completed: true, report: "Finished." });
    hostedSession.dispose();
});

for (const foreign of [false, true]) {
    Deno.test(`${foreign ? "another Session's" : "an earlier invocation's"} completion cannot advance a repair`, async () => {
        const cwd = await makeValidationProjectRoot("p", { classification: "PLANNED_CHANGE", status: "implemented" });
        const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
        const sessionManager = SessionManager.inMemory(cwd);
        const options = { hostedSession, sessionManager, cwd, agentName: "engineer", userRequest: "Repair p" };
        const call = [{ name: "task_completed", arguments: { message: "Not this repair." } }];
        if (!foreign) await executeWorkflowTestTools(options, call);
        const result = await runValidationAgentUntilEvent(
            {
                runIsolatedAgentSession: async () => {
                    if (foreign) {
                        await executeWorkflowTestTools(
                            { ...options, sessionManager: SessionManager.inMemory(cwd) },
                            call,
                        );
                    }
                    return [];
                },
            },
            options,
            "task_completed",
        );
        assertEquals(result.event, null);
        assertEquals((await loadPlan(cwd, "p"))?.attrs.status, "implemented");
        hostedSession.dispose();
    });
}

Deno.test("canceling the CI follow-up prompt does not send the default feedback to an Engineer", async () => {
    const cwd = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        validationCiAttempts: 3,
    });
    const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
    hostedSession.setInteractionAdapter({
        requestInteraction: (request) =>
            Promise.resolve(
                request.type === "select"
                    ? { outcome: "selected", value: "engineer_follow_up" }
                    : { outcome: "canceled" },
            ),
    });
    let repairs = 0;
    const result = await runWorkflowValidationToStableBoundary({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented" },
        git: createGitPort(),
        localCI: { run: () => Promise.resolve({ kind: "completed", exitCode: 1, output: "Still fails" }) },
        semanticReviewPort: {
            runIsolatedAgentSession: () => {
                repairs += 1;
                return Promise.resolve([]);
            },
        },
        workRecordMnemotecaPort: createWorkRecordMnemotecaFixture(),
    });
    assertEquals(result.kind, "paused");
    assertEquals(repairs, 0);
    assertEquals((await loadPlan(cwd, "p"))?.attrs.validationCiAttempts, 3);
    hostedSession.dispose();
});

Deno.test("Engineer follow-up after restart rebuilds context and accepts a real completion tool", async () => {
    await withRuntimeCommandFixture("repair-restart-", async ({ setModelResponseFactory }) => {
        const cwd = await makeValidationProjectRoot("p", { classification: "PLANNED_CHANGE", status: "implemented" });
        const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
        hostedSession.setActiveExecutionWorkflow({
            planName: "p",
            triageMeta: { classification: "PLANNED_CHANGE", status: "implemented" },
            executionAgent: "engineer",
            executionCwd: cwd,
            executionMode: "non_git_in_place",
        });
        let prompt = "";
        setModelResponseFactory((context) => {
            prompt = JSON.stringify(context);
            return fauxAssistantMessage(fauxToolCall("task_completed", { message: "Restarted repair finished." }));
        });
        const result = await createValidationSessionPort(hostedSession).continueLastRepairTurn(
            "Fix the remaining validation failure",
        );
        assertEquals(result?.completed, true);
        assertStringIncludes(prompt, "Fix the remaining validation failure");
        assertStringIncludes(prompt, "Continue the interrupted validation repair");
        hostedSession.dispose();
    });
});
