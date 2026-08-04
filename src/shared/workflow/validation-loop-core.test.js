import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadPlan, savePlan } from "../../plan-store.js";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { HostedSession } from "../session/hosted-session.js";
import { removeWorktreeGitArtifacts } from "../worktree.js";
import { createTestWorktreeAttempt, makeRepo } from "../worktree-test-helpers.js";
import { runValidationLoop, runValidationPhase, shouldContinueParentEpicAfterValidation } from "./validation.ts";
import { createExecutionStartPorts } from "./execution-start.ts";
import { startActiveExecutionWorkflow } from "./workflow.js";
import { attachRecorder, makeRecordedSession, makeUi, makeValidationProjectRoot } from "./validation-test-helpers.js";

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

async function makePlannedReviewWorktree() {
    const projectRoot = await makeRepo();
    await savePlan(projectRoot, "p", "# p\n\nvalidation fixture\n", {
        classification: "FEATURE",
        status: "validated_ci",
        summary: "validation fixture",
        affectedPaths: [],
    });
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "add validation plan"]);

    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-validation-worktree-" });
    const worktree = await createTestWorktreeAttempt({
        projectRoot,
        planName: "p",
        worktreeRoot,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", status: "validated_ci" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: worktree.path,
        executionMode: "worktree",
        baselineTree: worktree.baseTree,
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
        worktreeBaseBranch: worktree.baseBranch,
    });
    return {
        projectRoot,
        hostedSession,
        cleanup: async () => {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
            await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
            await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
        },
    };
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
        ports: createExecutionStartPorts(),
    });

    assertEquals(hostedSession.getWorkflowContext(), {
        routingIntent: "PLANNED_CHANGE",
        complexity: "MEDIUM",
        planName: "footer-plan",
    });
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "engineer");
});

Deno.test("shouldContinueParentEpicAfterValidation detects parent epic linkage", () => {
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

Deno.test("shouldContinueParentEpicAfterValidation ignores standalone FEATURE plans", async () => {
    const { projectRoot, hostedSession } = await makeLifecycleRun("validated_reviewer", {
        classification: "FEATURE",
        humanReviewMode: "none",
        humanReviewDecision: "not_required",
    });
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: {
            classification: "FEATURE",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
        },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: {
            classification: "FEATURE",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "verified");
    assertEquals(result.epicContinuation, undefined);
    assertEquals(plan?.attrs.status, "verified");
    assertEquals(plan?.attrs.deliveryEvidence, { version: 1, mode: "non_git_in_place" });
});

Deno.test("runValidationLoop fails FEATURE validation when workflow diff is empty", async () => {
    const { projectRoot, hostedSession, cleanup } = await makePlannedReviewWorktree();
    try {
        const result = await runValidationLoop({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "FEATURE", status: "validated_ci" },
            semanticReviewPort: {
                getDiffText: () => Promise.resolve(""),
            },
        });

        const plan = await loadPlan(projectRoot, "p");
        assertEquals(result.kind, "failed");
        assertStringIncludes(result.reason || "", "No implementation changes detected");
        assertEquals(plan?.attrs.status, "implemented");
    } finally {
        await cleanup();
    }
});

Deno.test("runValidationLoop fails PROJECT validation when workflow diff only changes a plan document", async () => {
    const { projectRoot, hostedSession } = await makeLifecycleRun("validated_ci", { classification: "PROJECT" });
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "PROJECT", status: "validated_ci" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "main",
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PROJECT", status: "validated_ci" },
        semanticReviewPort: {
            getDiffText: () => Promise.resolve("diff --git a/plans/p.md b/plans/p.md\n+# p\n"),
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "failed");
    assertStringIncludes(result.reason || "", "only plan document changes");
    assertEquals(plan?.attrs.status, "implemented");
});

Deno.test("runValidationLoop runs Objective-Failing Checks after CI before mechanical pass", async () => {
    const objectiveChecks = [{ id: "OC1", command: "true", rationale: "already satisfied for test" }];
    const { projectRoot, hostedSession } = await makeLifecycleRun("implemented", {
        objectiveChecks: /** @type {any} */ (objectiveChecks),
    });
    let ciCalls = 0;

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
        localCI: {
            run: () => {
                ciCalls += 1;
                return Promise.resolve({ exitCode: 0, output: "ok", canceled: false });
            },
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(ciCalls, 1);
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_ci");
});

Deno.test("runValidationLoop advances from met Objective-Failing Checks into semantic review", async () => {
    const objectiveChecks = [{ id: "OC1", command: "true", rationale: "already satisfied for test" }];
    const { projectRoot, hostedSession } = await makeLifecycleRun("implemented", {
        classification: "PLANNED_CHANGE",
        humanReviewMode: "always",
        objectiveChecks: /** @type {any} */ (objectiveChecks),
    });
    const triageMeta = /** @type {any} */ ({
        classification: "PLANNED_CHANGE",
        status: "implemented",
        humanReviewMode: "always",
        objectiveChecks,
    });
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta,
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta,
        semanticReviewPort: {
            getDiffText: () => Promise.resolve("diff --git a/file.ts b/file.ts\n+const fixed = true;\n"),
            loadReviewerPrompt: () =>
                Promise.resolve({
                    name: "reviewer",
                    displayName: "Reviewer",
                    model: "",
                    description: "",
                    tools: [],
                    systemPrompt: "review prompt",
                }),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: "approved",
                            approved: true,
                            feedback: "",
                            findings: [],
                            advisories: [],
                        },
                    }]),
                ),
        },
        localCI: {
            run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }),
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationLoop skips Objective-Failing Checks for non-Planned-Change classifications", async () => {
    /** @type {Array<"QUICK_FIX" | "PROJECT">} */
    const classifications = ["QUICK_FIX", "PROJECT"];
    for (const classification of classifications) {
        const objectiveChecks = [{ id: "OC-SKIP", command: "false", rationale: "must not run" }];
        const { projectRoot, hostedSession } = await makeLifecycleRun("implemented", {
            classification,
            objectiveChecks: /** @type {any} */ (objectiveChecks),
        });
        let ciCalls = 0;

        const result = await runValidationPhase({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification, status: "implemented", objectiveChecks },
            localCI: {
                run: () => {
                    ciCalls += 1;
                    return Promise.resolve({ exitCode: 0, output: "ok", canceled: false });
                },
            },
        });

        const plan = await loadPlan(projectRoot, "p");
        assertEquals(ciCalls, 1);
        assertEquals(result.kind, "paused");
        assertEquals(plan?.attrs.status, "validated_ci");
        assertEquals(plan?.attrs.validationCiAttempts, 0);
    }
});

Deno.test({
    name: "Workflow Validation treats canceled Objective-Failing Checks as a resumable pause",
    ignore: Deno.build.os === "windows",
    fn: async () => {
        const objectiveChecks = [
            { id: "OC1", command: "sleep 30", rationale: "long check stopped by Escape" },
            {
                id: "OC2",
                command: "touch must-not-run-after-cancel.marker",
                rationale: "must not start once cancellation lands",
            },
        ];
        const { projectRoot, hostedSession } = await makeLifecycleRun("implemented", {
            classification: "PLANNED_CHANGE",
            objectiveChecks: /** @type {any} */ (objectiveChecks),
        });

        const validation = runValidationPhase({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
            localCI: {
                run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }),
            },
        });
        // Wait until the Objective-Failing Check phase owns an active interaction,
        // then cancel it exactly the way Escape does.
        while (![...hostedSession.getActiveInteractions().keys()].some((id) => id.startsWith("objective-checks:"))) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        hostedSession.cancelActiveInteractions();
        const result = await validation;

        const plan = await loadPlan(projectRoot, "p");
        assertEquals(result.kind, "paused");
        assertStringIncludes(result.kind === "paused" ? result.reason || "" : "", "Run this Plan again");
        // Cancellation is a resumable pause: no failure is staged and the Plan
        // keeps its `implemented` status and work ownership for a later Retry.
        assertEquals(plan?.attrs.status, "implemented");
        assertEquals(plan?.attrs.validationCiAttempts ?? 0, 0);
        const markerExists = await Deno.stat(`${projectRoot}/must-not-run-after-cancel.marker`).then(
            () => true,
            () => false,
        );
        assertEquals(markerExists, false, "remaining checks must not start after cancellation");
        assertEquals(hostedSession.getActiveInteractions().size, 0, "the phase releases its interaction");
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    },
});

Deno.test("runValidationLoop starts at implemented and records only the mechanical pass boundary", async () => {
    const expectedWorkflowContext = { routingIntent: "QUICK_FIX", complexity: "MEDIUM", planName: "p" };
    const { projectRoot, hostedSession } = await makeLifecycleRun("implemented", { complexity: "MEDIUM" });
    let ciCalls = 0;
    assertEquals(hostedSession.getWorkflowContext(), expectedWorkflowContext);

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", complexity: "MEDIUM" },
        localCI: {
            run: () => {
                ciCalls += 1;
                return Promise.resolve({ exitCode: 0, output: "ok", canceled: false });
            },
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(ciCalls, 1);
    assertEquals(result.kind, "paused");
    assertEquals(hostedSession.getWorkflowContext(), expectedWorkflowContext);
    assertEquals(plan?.attrs.status, "validated_ci");
    assertEquals(plan?.attrs.validationCiAttempts, 0);
});
