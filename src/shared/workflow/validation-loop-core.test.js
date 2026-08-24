import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadPlan, savePlan } from "../../plan-store.js";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { HostedSession } from "../session/hosted-session.js";
import { removeWorktreeGitArtifacts } from "../worktree.js";
import { createTestWorktreeAttempt, makeRepo } from "../worktree-test-helpers.js";
import { shouldContinueParentEpicAfterValidation } from "./validation.ts";
import { createExecutionStartPorts } from "./execution-start.ts";
import { startActiveExecutionWorkflow } from "./workflow.js";
import {
    attachRecorder,
    makeRecordedSession,
    makeUi,
    makeValidationProjectRoot,
    NO_ISOLATED_AGENT_PORT,
    runValidationLoop,
    runValidationPhase,
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
    /** @type {import('../../tools/plan-written.ts').TriageMeta} */
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
    const { uiAPI, hostedSession } = makeValidationUi();
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
        executionCwd: worktree.path,
        hostedSession,
        uiAPI,
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
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "verified");
    assertEquals(result.epicContinuation, undefined);
    assertEquals(plan?.attrs.status, "validated");
    assertEquals(plan?.attrs.deliveryEvidence, { version: 1, mode: "non_git_in_place" });
});

Deno.test("runValidationLoop shows why FEATURE validation fails when workflow diff is empty", async () => {
    const { executionCwd, hostedSession, uiAPI, cleanup } = await makePlannedReviewWorktree();
    try {
        const result = await runValidationLoop({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "FEATURE", status: "validated_ci" },
            semanticReviewPort: NO_ISOLATED_AGENT_PORT,
        });

        const plan = await loadPlan(executionCwd, "p");
        assertEquals(result.kind, "failed");
        assertStringIncludes(result.reason || "", "No implementation changes detected");
        assertEquals(plan?.attrs.status, "implemented");
        const messages = /** @type {string[]} */ (uiAPI.messages);
        assertEquals(
            messages.some((message) => message.includes("Ask the Engineer to restore the code")),
            true,
        );
    } finally {
        await cleanup();
    }
});

Deno.test("runValidationLoop fails PROJECT validation when workflow diff only changes a plan document", async () => {
    const { projectRoot, hostedSession } = await makeLifecycleRun("validated_ci", { classification: "PROJECT" });
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "runwield@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Test"]);
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "validation baseline"]);
    const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
    const baselinePlan = await loadPlan(projectRoot, "p");
    await savePlan(projectRoot, "p", "# p\n\nPlan-only follow-up.\n", {
        classification: "PROJECT",
        status: "validated_ci",
        summary: "validation fixture",
        affectedPaths: [],
    }, { expectedRevision: baselinePlan?.revision });
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "PROJECT", status: "validated_ci" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        executionMode: "worktree",
        baselineTree,
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "main",
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PROJECT", status: "validated_ci" },
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "failed");
    assertStringIncludes(result.reason || "", "only plan document changes");
    assertEquals(plan?.attrs.status, "implemented");
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
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
        localCI: {
            run: () => {
                ciCalls += 1;
                return Promise.resolve({ kind: "completed", exitCode: 0, output: "ok" });
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
