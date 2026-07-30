import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";

/**
 * @param {string} cwd
 * @param {string} planName
 * @param {string} content
 * @param {import('../../plan-store.js').PlanFrontMatterInput} attrs
 */
async function savePlanForTest(cwd, planName, content, attrs) {
    const existing = await loadPlan(cwd, planName).catch(() => null);
    return await savePlan(cwd, planName, content, attrs, existing ? { expectedRevision: existing.revision } : {});
}
import { createExecutionWorktree } from "../worktree.js";
import { runValidationLoop } from "./validation.js";
import { runValidationOutcomeTransition } from "./state-transition.ts";
import { HostedSession } from "../session/hosted-session.js";

import { __resetSettingsForTests } from "../settings.js";

import {
    git,
    makeRecordedSession,
    makeStubGitPort,
    makeUi,
    makeValidationProjectRoot,
    noOpPublicationProofDeps,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-test", uiAPI) };
}

Deno.test("runValidationLoop stages validation_passed before worktree merge succeeds", async () => {
    const primaryRoot = await makeValidationProjectRoot();
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", summary: "Preserve metadata in merge commits." },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: primaryRoot,
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE", summary: "Preserve metadata in merge commits." },
        sessionManager: undefined,
        git: makeStubGitPort(),
        __deps: /** @type {any} */ ({
            ...noOpPublicationProofDeps(),
            ...noOpWorktreePlanHandoffDeps(),
            stageValidationPassedInExecutionWorktree: (/** @type {any} */ args) => {
                actions.push(`stage:${args.projectRoot}:${args.executionCwd}:${args.planName}`);
                return Promise.resolve({
                    attrs: /** @type {any} */ ({ status: "verified" }),
                    planPaths: ["plans/p.md"],
                });
            },
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (
                /** @type {{ projectRoot: string, branch: string, targetBranch?: string, planName?: string, planDescription?: string }} */ args,
            ) => {
                actions.push(
                    `merge:${args.projectRoot}:${args.branch}:${args.targetBranch || ""}:${args.planName || ""}:${
                        args.planDescription || ""
                    }`,
                );
                return Promise.resolve({ updatedPrimaryCheckout: false });
            },
            restorePrimaryPlanPathAfterMergeFailure: () => {
                actions.push("restore-primary");
                return Promise.resolve();
            },
            removeWorktreeGitArtifacts: (
                /** @type {{ projectRoot: string, path: string, force?: boolean }} */ args,
            ) => {
                actions.push(`remove:${args.projectRoot}:${args.path}:${args.force}`);
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: (/** @type {string} */ projectRoot, /** @type {string} */ id) => {
                actions.push(`registry-remove:${projectRoot}:${id}`);
                return Promise.resolve();
            },
            verifyPostMergeCandidatePublished: () => Promise.resolve({ merged: true, message: "merged" }),

            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.worktreeStatus || ""}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(actions, [
        `stage:${primaryRoot}:/worktree:p`,
        `merge:${primaryRoot}:runwield/worktree/p-wt1:feature-base:p:Preserve metadata in merge commits.`,
        "restore-primary",
        "registry:merged",
        `remove:${primaryRoot}:/worktree:false`,
        `registry-remove:${primaryRoot}:wt1`,
    ]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "validation" && metric.event === "human_review_result" &&
            metric.details.mode === "none" && metric.details.decision === "not_required"
        ),
        true,
    );
});

Deno.test("runValidationLoop merges verified Plan metadata in Git and leaves the primary checkout clean", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    const session = new HostedSession({ id: "validation-git-integration", cwd: Deno.cwd() });
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlanForTest(projectRoot, "git-plan", "# Git Plan", {
            status: "ready_for_work",
            classification: "FEATURE",
            summary: "Verify metadata in history.",
        });
        await git(projectRoot, ["add", ".gitignore", "plans/git-plan.md"]);
        await git(projectRoot, ["commit", "-m", "add plan"]);
        const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        const worktree = await createExecutionWorktree({
            allowRegistryMutation: "legacy-test-only",
            projectRoot,
            planName: "Git Plan",
            worktreeRoot,
        });
        await savePlanForTest(projectRoot, "git-plan", "# Git Plan", {
            status: "implemented",
            classification: "FEATURE",
            summary: "Verify metadata in history.",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await Deno.writeTextFile(`${worktree.path}/implemented.js`, "export const implemented = true;\n");
        session.setActiveExecutionWorkflow({
            planName: "git-plan",
            triageMeta: { classification: "FEATURE", summary: "Verify metadata in history." },
            executionAgent: "engineer",
            executionMode: "worktree",
            baselineTree,
            projectRoot,
            executionCwd: worktree.path,
            worktreeId: worktree.id,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
        });

        await runValidationLoop({
            hostedSession: session,
            planName: "git-plan",
            planContent: "plan",
            triageMeta: { classification: "FEATURE", summary: "Verify metadata in history." },
            sessionManager: undefined,
            __deps: /** @type {any} */ ({
                runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
                getDiffText: () => Promise.resolve("diff --git a/implemented.js b/implemented.js\n+change\n"),
                runIsolatedAgentSession: () =>
                    Promise.resolve(
                        /** @type {any} */ ([{
                            role: "assistant",
                            content: [{ type: "text", text: "The implementation matches the plan." }],
                        }, {
                            role: "toolResult",
                            toolName: "review_diff",
                            details: { command: "list", scope: "full", fileCount: 1 },
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "" },
                        }]),
                    ),
                getCodeReviewMode: () => "none",
                autoGenerateWorkRecordForCompletedPlan: () =>
                    Promise.resolve({ status: "disabled", planName: "git-plan", message: "disabled" }),
                recordWorkflowMetric: () => Promise.resolve(null),
            }),
        });

        assertEquals((await loadPlan(projectRoot, "git-plan"))?.attrs.status, "verified");
        assertStringIncludes(await git(projectRoot, ["log", "-p", "--", "plans/git-plan.md"]), 'status: "verified"');
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runValidationLoop reapplies verified Plan metadata after real merge-conflict rollback", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    const session = new HostedSession({ id: "validation-git-conflict-retry", cwd: Deno.cwd() });
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await savePlanForTest(projectRoot, "conflict-plan", "# Conflict Plan", {
            status: "ready_for_work",
            classification: "FEATURE",
        });
        await git(projectRoot, ["add", ".gitignore", "conflict.txt", "plans/conflict-plan.md"]);
        await git(projectRoot, ["commit", "-m", "add conflict plan"]);
        const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        const worktree = await createExecutionWorktree({
            allowRegistryMutation: "legacy-test-only",
            projectRoot,
            planName: "Conflict Plan",
            worktreeRoot,
        });
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "target conflict"]);
        await savePlanForTest(projectRoot, "conflict-plan", "# Conflict Plan", {
            status: "implemented",
            classification: "FEATURE",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await Deno.writeTextFile(`${worktree.path}/conflict.txt`, "execution\n");
        session.setActiveExecutionWorkflow({
            planName: "conflict-plan",
            triageMeta: { classification: "FEATURE" },
            executionAgent: "engineer",
            executionMode: "worktree",
            baselineTree,
            projectRoot,
            executionCwd: worktree.path,
            worktreeId: worktree.id,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
        });

        await runValidationLoop({
            hostedSession: session,
            planName: "conflict-plan",
            planContent: "plan",
            triageMeta: { classification: "FEATURE" },
            sessionManager: undefined,
            __deps: /** @type {any} */ ({
                runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
                getDiffText: () => Promise.resolve("diff --git a/conflict.txt b/conflict.txt\n+execution\n"),
                runIsolatedAgentSession: () =>
                    Promise.resolve(
                        /** @type {any} */ ([{
                            role: "assistant",
                            content: [{ type: "text", text: "The implementation matches the plan." }],
                        }, {
                            role: "toolResult",
                            toolName: "review_diff",
                            details: { command: "list", scope: "full", fileCount: 1 },
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "" },
                        }]),
                    ),
                runCompletionGatedRepair: async () => {
                    await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "resolved\n");
                    await git(projectRoot, ["add", "conflict.txt"]);
                    return true;
                },
                updateWorktreeRegistryEntry: () => Promise.resolve({}),
                shouldCleanupMergedWorktrees: () => false,
                getCodeReviewMode: () => "none",
                recordWorkflowMetric: () => Promise.resolve(null),
            }),
        });

        assertEquals((await loadPlan(projectRoot, "conflict-plan"))?.attrs.status, "verified");
        assertStringIncludes(
            await git(projectRoot, ["log", "-1", "-p", "--", "plans/conflict-plan.md"]),
            'status: "verified"',
        );
        assertEquals(await Deno.readTextFile(`${projectRoot}/conflict.txt`), "resolved\n");
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runValidationLoop does not preserve a nonexistent Plan path for quick-fix worktrees", async () => {
    const primaryRoot = await makeValidationProjectRoot();
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[][]} */
    const preservedPaths = [];
    hostedSession.setActiveExecutionWorkflow({
        planName: "quick-fix",
        triageMeta: { classification: "QUICK_FIX" },
        executionAgent: "engineer",
        baselineTree: "baseline-tree",
        projectRoot: primaryRoot,
        executionCwd: "/worktree",
        worktreeBranch: "runwield/worktree/quick-fix-wt1",
        worktreeBaseBranch: "main",
    });

    await runValidationLoop({
        hostedSession,
        planName: "quick-fix",
        planContent: "fix",
        triageMeta: { classification: "QUICK_FIX" },
        sessionManager: undefined,
        git: makeStubGitPort(),
        __deps: /** @type {any} */ ({
            ...noOpPublicationProofDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The quick fix is valid." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {{ preservePlanPaths: string[] }} */ args) => {
                preservedPaths.push(args.preservePlanPaths);
                return Promise.resolve();
            },
            verifyPostMergeCandidatePublished: () => Promise.resolve({ merged: true, message: "merged" }),
            removeWorktreeGitArtifacts: () => Promise.resolve(),
            getCodeReviewMode: () => "none",
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(preservedPaths, [[]]);
});

Deno.test("runValidationLoop halts and preserves worktree when post-merge verification fails", async () => {
    const primaryRoot = await makeValidationProjectRoot();
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        baselineTree: "baseline-tree",
        projectRoot: primaryRoot,
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        sessionManager: undefined,
        git: makeStubGitPort(),
        __deps: /** @type {any} */ ({
            ...noOpPublicationProofDeps(),
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            verifyPostMergeCandidatePublished: () =>
                Promise.resolve({ merged: false, message: "branch is not contained in target" }),
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                actions.push(`repair:${opts.agentName}:merge_verification`);
                return Promise.resolve(false);
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.reject(new Error("registry unavailable"));
            },
            removeWorktreeGitArtifacts: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(actions, ["merge"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Dispatching Frontend Engineer for automatic merge repair attempt")
        ),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("preserving worktree for recovery")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes(
                "Could not update worktree registry after merge verification failure: registry unavailable",
            )
        ),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("execution and validation complete")),
        true,
    );
});

Deno.test("an unresolved journal blocks validation settlement with an actionable message", async () => {
    const primaryRoot = await makeValidationProjectRoot();
    // A prior lifecycle operation on this Plan was interrupted and left durable
    // evidence behind. Real state, written by the transaction layer itself.
    const stranded = await runValidationOutcomeTransition({
        projectRoot: primaryRoot,
        planName: "p",
        worktreeId: "wt1",
        outcome: "merge_failed",
        settle: async ({ markEffect }) => {
            await markEffect("worktree_registry_updated", { worktreeId: "wt1", status: "merge_conflict" });
            throw new Error("interrupted after a durable effect");
        },
    });
    assertEquals(stranded.status, "needs_recovery");

    const { uiAPI, hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        baselineTree: "baseline-tree",
        projectRoot: primaryRoot,
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        sessionManager: undefined,
        git: makeStubGitPort(),
        __deps: /** @type {any} */ ({
            ...noOpPublicationProofDeps(),
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            verifyPostMergeCandidatePublished: () =>
                Promise.resolve({ merged: false, message: "branch is not contained in target" }),
            runCompletionGatedRepair: () => Promise.resolve(false),
            updateWorktreeRegistryEntry: () => Promise.resolve(null),
            removeWorktreeGitArtifacts: () => Promise.resolve(),
        }),
    });

    // The verification failure is real, but RunWield could not record it while the
    // earlier evidence still stands. It has to say so: the user needs to know the
    // Plan's status is behind reality, and which command clears the way.
    const messages = uiAPI.messages.join("\n");
    assertStringIncludes(messages, "could not record");
    assertStringIncludes(messages, "the Plan may still show");
    assertStringIncludes(messages, "plans doctor --repair");
});
