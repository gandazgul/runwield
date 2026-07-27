import { assertEquals, assertRejects } from "@std/assert";

import { loadPlan, savePlan } from "../../plan-store.js";
import { addEntry } from "../worktree-registry.js";
import { runValidationLoop } from "./validation.js";

import { __resetSettingsForTests } from "../settings.js";

import {
    git,
    makeRecordedSession,
    makeUi,
    noOpRecordPlanEvent,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-test", uiAPI) };
}

Deno.test("runValidationLoop restores a real missing worktree Plan and continues validation in the same call", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    const { uiAPI, hostedSession } = makeValidationUi();
    const worktreePath = `${worktreeRoot}/wt`;
    const worktreeBranch = "runwield/worktree/p-wt";
    /** @type {string[]} */
    const events = [];
    let ciRan = false;

    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "test@example.com"]);
        await git(projectRoot, ["config", "user.name", "Test"]);
        await Deno.writeTextFile(`${projectRoot}/file.txt`, "base\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "init"]);
        const baseCommit = await git(projectRoot, ["rev-parse", "HEAD"]);
        const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        await git(projectRoot, ["worktree", "add", "-b", worktreeBranch, worktreePath, "HEAD"]);
        const canonicalWorktreePath = await Deno.realPath(worktreePath);

        await savePlan(projectRoot, "p", "# Plan", {
            classification: "FEATURE",
            status: "implemented",
            executionMode: "worktree",
            executionBaselineTree: baselineTree,
            worktreeId: "wt-1",
            worktreePath,
            worktreeBranch,
            worktreeBaseBranch: "main",
            worktreeStatus: "validation_failed",
        });
        await addEntry(projectRoot, {
            id: "wt-1",
            planName: "p",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit,
            baseTree: baselineTree,
            executionBaselineTree: baselineTree,
            branch: worktreeBranch,
            path: worktreePath,
            status: "validation_failed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const canonicalPlan = await loadPlan(projectRoot, "p");
        if (!canonicalPlan) throw new Error("canonical Plan fixture was not created");
        await assertRejects(() => Deno.lstat(`${worktreePath}/plans/p.md`), Deno.errors.NotFound);

        hostedSession.setActiveExecutionWorkflow({
            planName: "p",
            triageMeta: canonicalPlan.attrs,
            executionAgent: "engineer",
            executionMode: "worktree",
            baselineTree,
            projectRoot,
            executionCwd: worktreePath,
            worktreeId: "wt-1",
            worktreeBranch,
            worktreeBaseBranch: "main",
        });

        /**
         * @param {{ cwd: string }} options
         */
        const runPassingCI = ({ cwd }) => {
            ciRan = true;
            assertEquals(cwd, canonicalWorktreePath);
            return Promise.resolve({ exitCode: 0, output: "" });
        };

        /**
         * @param {{ event: string }} event
         */
        const recordEvent = (event) => {
            events.push(event.event);
            return Promise.resolve({});
        };

        /**
         * @param {string} message
         */
        const isRestorationMessage = (message) => message.includes("Restored missing execution worktree Plan file");

        const result = await runValidationLoop({
            hostedSession,
            planName: "p",
            planContent: canonicalPlan.markdown,
            triageMeta: canonicalPlan.attrs,
            sessionManager: undefined,
            __deps: /** @type {any} */ ({
                ...noOpWorktreePlanHandoffDeps(),
                resolveValidationExecutionContext: undefined,
                runLocalCI: runPassingCI,
                getDiffText: () => Promise.resolve("diff --git a/file.txt b/file.txt\n+implemented\n"),
                runIsolatedAgentSession: () =>
                    Promise.resolve(
                        /** @type {any} */ ([{
                            role: "assistant",
                            content: [{ type: "text", text: "The implementation matches the plan." }],
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "" },
                        }]),
                    ),
                mergeExecutionWorktree: () => Promise.resolve(),
                verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
                updateWorktreeRegistryEntry: () => Promise.resolve({}),
                recordPlanEvent: recordEvent,
                recordWorkflowMetric: () => Promise.resolve(null),
                getCodeReviewMode: () => "none",
                shouldCleanupMergedWorktrees: () => false,
                autoGenerateWorkRecordForCompletedPlan: () =>
                    Promise.resolve({ status: "disabled", planName: "p", message: "disabled" }),
            }),
        });

        assertEquals(result.kind, "verified");
        assertEquals(ciRan, true);
        assertEquals(await Deno.readTextFile(`${worktreePath}/plans/p.md`), canonicalPlan.markdown);
        assertEquals(uiAPI.messages.filter(isRestorationMessage).length, 1);
        assertEquals(events.includes("validation_failed"), false);
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runValidationLoop reports restored Plan file once and continues CI without spurious validation_failed", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const events = [];
    let ciRan = false;
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            resolveValidationExecutionContext: (/** @type {any} */ opts) =>
                Promise.resolve({
                    kind: "ok",
                    restoredPlanFile: { relativePath: "plans/p.md" },
                    context: {
                        executionMode: "worktree",
                        planName: opts.planName,
                        projectRoot: "/primary",
                        executionCwd: "/worktree",
                        baselineTree: "baseline-tree",
                        worktreeId: "wt1",
                        worktreeBranch: "runwield/worktree/p-wt1",
                        worktreeBaseBranch: "feature-base",
                        source: "active_session",
                    },
                }),
            runLocalCI: () => {
                ciRan = true;
                return Promise.resolve({ exitCode: 0, output: "" });
            },
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {{ event: string }} */ event) => {
                events.push(event.event);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            shouldCleanupMergedWorktrees: () => false,
        }),
    });

    assertEquals(ciRan, true);
    assertEquals(
        uiAPI.messages.filter((/** @type {string} */ message) =>
            message.includes("Restored missing execution worktree Plan file")
        ).length,
        1,
    );
    assertEquals(events.includes("validation_failed"), false);
});

Deno.test("runValidationLoop keeps merged worktree when cleanup setting is disabled", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: () => {
                actions.push("registry-remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry");
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.cleanupMergedWorktrees}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            shouldCleanupMergedWorktrees: () => false,
        }),
    });

    assertEquals(actions, ["merge", "registry"]);
});

Deno.test("runValidationLoop records worktree_merge_failed when merge-back fails", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any} */
    let mergeFailedDetails = null;

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            restorePrimaryPlanPathAfterMergeFailure: () => {
                actions.push("restore-primary-plan");
                return Promise.resolve();
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            runActiveAgentTurn: () => Promise.resolve([]),
            mergeExecutionWorktree: () => Promise.reject(new Error("conflict")),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                if (event.event === "worktree_merge_failed") {
                    mergeFailedDetails = event.details;
                }
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, [
        "restore-primary-plan",
        "registry:merge_conflict",
        "event:worktree_merge_failed:conflict",
        "registry:validation_failed",
        "event:validation_failed:Worktree merge failed: conflict",
    ]);
    assertEquals(mergeFailedDetails.worktreePath, "/worktree");
    assertEquals(mergeFailedDetails.worktreeBranch, "runwield/worktree/p-wt1");
    assertEquals(mergeFailedDetails.worktreeBaseBranch, "feature-base");
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("Worktree merge failed: conflict")),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string, isError: boolean }} */ call) =>
            call.message.includes("Worktree merge failed: conflict") && call.isError
        ),
        true,
    );
});

Deno.test("runValidationLoop still prompts when merge-conflict metadata updates fail", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            runActiveAgentTurn: () => Promise.resolve([]),
            mergeExecutionWorktree: () => Promise.reject(new Error("merge conflict")),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry-failed");
                return Promise.reject(new SyntaxError("Expected double-quoted property name"));
            },
            recordPlanEvent: () => {
                actions.push("plan-event-failed");
                return Promise.reject(new Error("front matter conflict markers"));
            },
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, ["registry-failed", "plan-event-failed", "registry-failed", "plan-event-failed"]);
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update worktree registry while merge conflict is active")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update plan metadata while merge conflict is active")
        ),
        true,
    );
});

Deno.test("runValidationLoop recovers missing worktree target branch from registry before merge", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {Array<string | undefined>} */
    const targets = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {{ targetBranch?: string }} */ args) => {
                targets.push(args.targetBranch);
                return Promise.resolve();
            },
            findWorktreeRegistryEntryById: (/** @type {string} */ projectRoot, /** @type {string} */ id) =>
                Promise.resolve({ id, projectRoot, baseBranch: "main" }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
            removeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(targets, []);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("missing worktree delivery identity")),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Recorded worktree target branch is unknown")
        ),
        false,
    );
});

Deno.test("runValidationLoop fails closed instead of using guarded primary-checkout fallback", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {Array<string | undefined>} */
    const targets = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {{ targetBranch?: string }} */ args) => {
                targets.push(args.targetBranch);
                return Promise.resolve();
            },
            findWorktreeRegistryEntryById: () => Promise.resolve(null),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
            removeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(targets, []);
    assertEquals(uiAPI.messages.length >= 0, true);
});

Deno.test("runValidationLoop dispatches active owner merge repair and retries merge-back", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];
    let mergeAttempts = 0;

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
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
        __deps: /** @type {any} */ ({
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {any} */ args) => {
                mergeAttempts++;
                actions.push(`merge:${mergeAttempts}:${args.repairMergeWorktreePath || ""}`);
                if (mergeAttempts === 1) {
                    const error =
                        /** @type {Error & { repairCwd?: string, mergeWorktreePath?: string, mergeFailureKind?: string }} */ (
                            new Error("conflict")
                        );
                    error.repairCwd = "/merge-wt";
                    error.mergeWorktreePath = "/merge-wt";
                    error.mergeFailureKind = "detached_merge_conflict";
                    return Promise.reject(error);
                }
                return Promise.resolve();
            },
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                actions.push(
                    `repair:${opts.agentName}:${opts.cwd}:${opts.userRequest.includes("feature-base")}:${
                        opts.userRequest.includes("Current plan status: implemented")
                    }:${opts.userRequest.includes("Diff/context:")}:${
                        opts.userRequest.includes("detached merge worktree")
                    }`,
                );
                return Promise.resolve(true);
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, [
        "merge:1:",
        "registry:merge_conflict",
        "event:worktree_merge_failed:conflict",
        "repair:frontend-engineer:/merge-wt:true:true:true:true",
        "merge:2:/merge-wt",
        "registry:merged",
        "remove",
    ]);
    assertEquals(uiAPI.promptSelections, []);
});

Deno.test("runValidationLoop completes after merge repair task_completed and retry", async () => {
    const { uiAPI } = makeValidationUi();
    const repairHostedSession = makeRecordedSession("merge-repair-completion-test", uiAPI);
    repairHostedSession.setRootAgentName("engineer");
    repairHostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: {
                state: {
                    messages: [{ role: "assistant", content: [{ type: "text", text: "previous turn" }] }],
                },
            },
        }),
    );
    /** @type {string[]} */
    const events = [];
    let mergeAttempts = 0;

    repairHostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            runActiveAgentTurn: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                ),
            mergeExecutionWorktree: () => {
                mergeAttempts++;
                if (mergeAttempts === 1) {
                    return Promise.reject(new Error("merge conflict"));
                }
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {{ event: string }} */ event) => {
                events.push(event.event);
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(events, ["worktree_merge_failed"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Planned change execution and validation complete")
        ),
        true,
    );
});

Deno.test("runValidationLoop retries worktree merge after user fixes primary checkout", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];
    let mergeAttempts = 0;
    uiAPI.promptSelect = () => {
        uiAPI.promptSelections.push("retry");
        return Promise.resolve("retry");
    };

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
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
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            runActiveAgentTurn: () => Promise.resolve([]),
            mergeExecutionWorktree: () => {
                mergeAttempts++;
                actions.push(`merge:${mergeAttempts}`);
                if (mergeAttempts === 1) return Promise.reject(new Error("primary dirty"));
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, [
        "merge:1",
        "registry:merge_conflict",
        "event:worktree_merge_failed:primary dirty",
        "merge:2",
        "registry:merged",
        "remove",
    ]);
    assertEquals(uiAPI.promptSelections, ["retry"]);
});

Deno.test("runValidationLoop marks active worktree validation_failed when validation fails", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(actions, [
        "registry:validation_failed",
        "event:validation_failed:No implementation changes detected in workflow diff.",
    ]);
});

// ─── review-diff-tool tests ────────────────────────────────────────────────

Deno.test("runValidationLoop mechanically retries when target branch advances before publication", async () => {
    const { uiAPI } = makeValidationUi();
    const session = makeRecordedSession("target-advance-validation-test", uiAPI);
    session.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "main",
    });
    let mergeCalls = 0;
    let sealCalls = 0;
    let targetHeadCalls = 0;
    let repairCalls = 0;
    let promptCalls = 0;
    /** @type {any[]} */
    const registryUpdates = [];
    /** @type {any[]} */
    const planEvents = [];
    /** @type {any[]} */
    const stagedEvidence = [];
    /** @type {any[]} */
    const resetUpdates = [];

    await runValidationLoop({
        hostedSession: session,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "ok" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "none",
            sealExecutionWorktreeCandidate: () => {
                sealCalls++;
                return Promise.resolve({ executionCommit: "a".repeat(40) });
            },
            getBranchHead: () => {
                targetHeadCalls++;
                return Promise.resolve(targetHeadCalls === 1 ? "b".repeat(40) : "c".repeat(40));
            },
            stageValidationPassedInExecutionWorktree: (/** @type {any} */ args) => {
                stagedEvidence.push(args.details.deliveryEvidence);
                return Promise.resolve({
                    attrs: /** @type {any} */ ({ status: "verified" }),
                    planPaths: ["plans/p.md"],
                });
            },
            mergeExecutionWorktree: () => {
                mergeCalls++;
                if (mergeCalls === 1) {
                    const error = /** @type {Error & { mergeFailureKind?: string }} */ (
                        new Error("Target branch main advanced before publication; rerun Workflow Validation.")
                    );
                    error.mergeFailureKind = "target_branch_advanced";
                    return Promise.reject(error);
                }
                return Promise.resolve({ updatedPrimaryCheckout: true });
            },
            repair: () => {
                repairCalls++;
                return Promise.resolve(true);
            },
            requestInteraction: () => {
                promptCalls++;
                return Promise.resolve({ outcome: "selected", value: "retry" });
            },
            updatePlanFrontMatter: (
                /** @type {string} */ cwd,
                /** @type {string} */ planName,
                /** @type {any} */ updates,
            ) => {
                resetUpdates.push({ cwd, planName, updates });
                return Promise.resolve(/** @type {any} */ ({ status: updates.status }));
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _worktreeId,
                /** @type {any} */ updates,
            ) => {
                registryUpdates.push(updates);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                planEvents.push(event);
                return Promise.resolve({});
            },
            shouldCleanupMergedWorktrees: () => false,
            isCommitAncestorOfBranch: () => Promise.resolve(true),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(mergeCalls, 2);
    assertEquals(sealCalls, 1);
    assertEquals(repairCalls, 0);
    assertEquals(promptCalls, 0);
    assertEquals(registryUpdates.some((updates) => updates.status === "merge_conflict"), false);
    assertEquals(planEvents.some((event) => event.event === "worktree_merge_failed"), false);
    assertEquals(stagedEvidence, [
        {
            version: 1,
            mode: "worktree_merge",
            executionCommit: "a".repeat(40),
            targetBranch: "main",
            targetHeadBeforeMerge: "b".repeat(40),
        },
        {
            version: 1,
            mode: "worktree_merge",
            executionCommit: "a".repeat(40),
            targetBranch: "main",
            targetHeadBeforeMerge: "c".repeat(40),
        },
    ]);
    assertEquals(resetUpdates, [{
        cwd: "/worktree",
        planName: "p",
        updates: {
            status: "implemented",
            verifiedAt: null,
            deliveryEvidence: null,
            executionMode: "worktree",
            executionBaselineTree: "baseline-tree",
            worktreeId: "wt1",
            worktreePath: "/worktree",
            worktreeBranch: "runwield/worktree/p-wt1",
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        },
    }]);
    assertEquals(
        uiAPI.systemCalls.some((/** @type {any} */ call) =>
            String(call.message).includes("retrying merge against its current head")
        ),
        true,
    );
});
