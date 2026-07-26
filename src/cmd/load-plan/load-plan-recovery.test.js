import { assertEquals, assertStringIncludes } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";
import { loadPlan, savePlan, updatePlanFrontMatter } from "../../plan-store.js";

import { recordPlanEvent, stageValidationPassedInExecutionWorktree } from "../../shared/workflow/plan-lifecycle.js";
import {
    createExecutionWorktree,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    restorePrimaryPlanPathAfterMergeFailure,
} from "../../shared/worktree.js";

import { git, makeRuntimeContext, makeRuntimeFixture, makeUi, noOpRecordPlanEvent } from "./load-plan-test-helpers.js";

Deno.test("runLoadPlanCommand rehydrates Frontend Engineer recovery without transient Pair style", async () => {
    const { uiAPI, selections } = makeUi();
    const runtimeFixture = makeRuntimeFixture();
    selections.push("continue");
    let executed = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-progress"], {
        ...runtimeFixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-progress"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-progress",
                    path: "plans/plan-progress.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "in_progress",
                        executionAgent: "frontend-engineer",
                        collaborationRecommendation: "pair",
                        executionMode: "non_git_in_place",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                lifecycleEvent = args.event;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(lifecycleEvent, "recovery_continue");
    assertEquals(executed, true);
    assertEquals(runtimeFixture.state.workflow?.executionAgent, "frontend-engineer");
    assertEquals(runtimeFixture.state.workflow?.executionMode, "non_git_in_place");
    assertEquals(runtimeFixture.state.workflow?.triageMeta.collaborationRecommendation, "pair");
    assertEquals("collaborationStyle" in (runtimeFixture.state.workflow || {}), false);
    assertEquals("pairCheckpointCount" in (runtimeFixture.state.workflow || {}), false);
});

Deno.test("runLoadPlanCommand blocks Git-dependent recovery continue in non-Git projects", async () => {
    const { uiAPI, selections, prompts, messages } = makeUi();
    selections.push("continue", "cancel");
    let executed = false;

    await runLoadPlanCommand(["plan-non-git-continue"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-non-git-continue"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-non-git-continue",
                    path: "plans/plan-non-git-continue.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "in_progress",
                        executionBaselineTree: "baseline-tree",
                        worktreeId: "wt-1",
                        worktreePath: "/tmp/recorded-worktree",
                        worktreeBranch: "runwield/worktree/plan-non-git-continue",
                    },
                }),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            recordWorkflowMetric: () => Promise.resolve(null),
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, false);
    assertEquals(prompts[0].options.some((option) => option.value === "continue"), false);
    assertEquals(
        messages.some((message) =>
            message.includes("Cannot continue this Plan recovery state because Git is not available")
        ),
        true,
    );
});

Deno.test("runLoadPlanCommand performs metadata-only recovery reset in non-Git projects", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("reset", "clear");
    let removed = false;
    let restored = false;
    /** @type {Record<string, unknown> | null} */
    let clearedUpdates = null;
    /** @type {string | null} */
    let lifecycleEvent = null;
    /** @type {{ id: string, updates: Record<string, unknown> } | null} */
    let registryUpdate = null;

    await runLoadPlanCommand(["plan-non-git-reset"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-non-git-reset"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-non-git-reset",
                    path: "plans/plan-non-git-reset.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "failed",
                        executionBaselineTree: "baseline-tree",
                        worktreeId: "wt-1",
                        worktreePath: "/tmp/recorded-worktree",
                        worktreeBranch: "runwield/worktree/plan-non-git-reset",
                        worktreeStatus: "execution_failed",
                    },
                }),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            restoreWorktreeTree: () => {
                restored = true;
                return Promise.resolve();
            },
            removeExecutionWorktree: () => {
                removed = true;
                return Promise.resolve();
            },
            updatePlanFrontMatter: (
                /** @type {string} */ _cwd,
                /** @type {string} */ _planName,
                /** @type {Record<string, unknown>} */ updates,
                /** @type {Record<string, unknown>} */ current,
            ) => {
                clearedUpdates = updates;
                return Promise.resolve(/** @type {any} */ ({ ...current, ...updates }));
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _cwd,
                /** @type {string} */ id,
                /** @type {Record<string, unknown>} */ updates,
            ) => {
                registryUpdate = { id, updates };
                return Promise.resolve(/** @type {any} */ ({ id, ...updates }));
            },
            recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                lifecycleEvent = args.event;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            recordWorkflowMetric: () => Promise.resolve(null),
            resetTuiState: () => {},
        }),
    });

    assertEquals(restored, false);
    assertEquals(removed, false);
    assertEquals(lifecycleEvent, "recovery_reset");
    const registry = /** @type {{ id?: string, updates?: Record<string, unknown> }} */ (registryUpdate || {});
    assertEquals(registry.id, "wt-1");
    assertEquals(registry.updates?.status, "abandoned");
    const updates = /** @type {Record<string, unknown>} */ (clearedUpdates || {});
    assertEquals(updates.executionBaselineTree, null);
    assertEquals(updates.worktreeId, null);
    assertEquals(updates.worktreePath, null);
    assertEquals(
        messages.some((message) => message.includes("Cleared stale Git recovery metadata")),
        true,
    );
});

Deno.test("runLoadPlanCommand failed plan can reset baseline and start over", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "reset");
    let restoredTree = "";
    let executed = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-failed"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-failed"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-failed",
                    path: "plans/plan-failed.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "failed",
                        failureReason: "engineer stopped",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            restoreWorktreeTree: (/** @type {string} */ _cwd, /** @type {string} */ tree) => {
                restoredTree = tree;
                return Promise.resolve();
            },
            recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                lifecycleEvent = args.event;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(restoredTree, "baseline-tree");
    assertEquals(lifecycleEvent, "recovery_reset");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand refuses worktree reset when recorded recreate base is missing", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("reset", "cancel");
    let removed = false;
    let recreated = false;

    await runLoadPlanCommand(["plan-missing-base"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-missing-base"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-missing-base",
                    path: "plans/plan-missing-base.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "failed",
                        executionBaselineTree: "baseline-tree",
                        worktreeId: "wt-missing-base",
                        worktreePath: "/tmp/runwield-plan-worktree",
                        worktreeBranch: "runwield/worktree/plan-missing-base",
                        worktreeStatus: "execution_failed",
                    },
                }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            removeExecutionWorktree: () => {
                removed = true;
                return Promise.resolve();
            },
            createExecutionWorktree: () => {
                recreated = true;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(removed, false);
    assertEquals(recreated, false);
    assertEquals(messages.some((message) => message.includes("no recorded base commit or base ref")), true);
});

Deno.test("runLoadPlanCommand recreates worktree reset from recorded base commit", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "confirm");
    let removed = false;
    let createdBaseRef = "";
    let executed = false;

    await runLoadPlanCommand(["plan-recorded-base"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-recorded-base"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-recorded-base",
                    path: "plans/plan-recorded-base.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "failed",
                        executionBaselineTree: "baseline-tree",
                        worktreeId: "wt-recorded-base",
                        worktreePath: "/tmp/runwield-plan-worktree",
                        worktreeBranch: "runwield/worktree/plan-recorded-base",
                        worktreeStatus: "execution_failed",
                    },
                }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-recorded-base",
                    planName: "plan-recorded-base",
                    path: "/tmp/runwield-plan-worktree",
                    branch: "runwield/worktree/plan-recorded-base",
                    baseRef: "main",
                    baseCommit: "abc123",
                    baseTree: "baseline-tree",
                    status: "execution_failed",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            removeExecutionWorktree: () => {
                removed = true;
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: () => Promise.resolve(/** @type {any} */ ({})),
            createExecutionWorktree: (/** @type {{ baseRef: string }} */ args) => {
                createdBaseRef = args.baseRef;
                return Promise.resolve({
                    id: "wt-recreated",
                    path: "/tmp/runwield-plan-worktree-2",
                    branch: "runwield/worktree/plan-recorded-base-2",
                    status: "active",
                    baseRef: "abc123",
                    baseCommit: "abc123",
                    baseTree: "new-baseline-tree",
                });
            },
            updatePlanFrontMatter: (
                /** @type {string} */ _cwd,
                /** @type {string} */ _planName,
                /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */ updates,
                /** @type {import('../../plan-store.js').PlanFrontMatter} */ attrs,
            ) => Promise.resolve({ ...attrs, ...updates }),
            recordPlanEvent: noOpRecordPlanEvent,
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(removed, true);
    assertEquals(createdBaseRef, "abc123");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand recreates missing worktree reset after warning confirmation", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("reset", "confirm");
    let removedPath = "";
    let abandoned = false;
    let createdBaseRef = "";
    let executed = false;

    await runLoadPlanCommand(["plan-lost-worktree"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-lost-worktree"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-lost-worktree",
                    path: "plans/plan-lost-worktree.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "failed",
                        executionBaselineTree: "baseline-tree",
                        worktreeId: "wt-lost-worktree",
                        worktreePath: "/tmp/runwield-missing-plan-worktree",
                        worktreeBranch: "runwield/worktree/plan-lost-worktree",
                        worktreeStatus: "execution_failed",
                    },
                }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-lost-worktree",
                    planName: "plan-lost-worktree",
                    path: "/tmp/runwield-missing-plan-worktree",
                    branch: "runwield/worktree/plan-lost-worktree",
                    baseRef: "main",
                    baseCommit: "abc123",
                    baseTree: "baseline-tree",
                    status: "execution_failed",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            removeExecutionWorktree: (/** @type {{ path: string }} */ args) => {
                removedPath = args.path;
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: () => {
                abandoned = true;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            createExecutionWorktree: (/** @type {{ baseRef: string }} */ args) => {
                createdBaseRef = args.baseRef;
                return Promise.resolve({
                    id: "wt-recreated",
                    path: "/tmp/runwield-plan-worktree-2",
                    branch: "runwield/worktree/plan-lost-worktree-2",
                    status: "active",
                    baseRef: "abc123",
                    baseCommit: "abc123",
                    baseTree: "new-baseline-tree",
                });
            },
            updatePlanFrontMatter: (
                /** @type {string} */ _cwd,
                /** @type {string} */ _planName,
                /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */ updates,
                /** @type {import('../../plan-store.js').PlanFrontMatter} */ attrs,
            ) => Promise.resolve({ ...attrs, ...updates }),
            recordPlanEvent: noOpRecordPlanEvent,
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(
        messages.some((message) => message.includes("does not exist at /tmp/runwield-missing-plan-worktree")),
        true,
    );
    assertEquals(prompts.some((prompt) => prompt.prompt === "Recreate the worktree and start over?"), true);
    assertEquals(removedPath, "/tmp/runwield-missing-plan-worktree");
    assertEquals(abandoned, true);
    assertEquals(createdBaseRef, "abc123");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand in_progress inspect reports failure and baseline diff", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("inspect", "cancel");

    await runLoadPlanCommand(["plan-inspect"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-inspect"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-inspect",
                    path: "plans/plan-inspect.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "in_progress",
                        failureReason: "interrupted",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            getWorkflowDiff: (/** @type {string} */ _cwd, /** @type {string} */ baselineTree) =>
                Promise.resolve(`diff for ${baselineTree}`),
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("Failure reason:\ninterrupted")), true);
    assertEquals(messages.some((m) => m.includes("diff for baseline-tree")), true);
});

Deno.test("runLoadPlanCommand implemented plan blocks validation without execution proof", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("validate");
    let validated = false;
    /** @type {unknown} */
    let workflowDuringValidation = null;
    const fixture = makeRuntimeFixture({ sessionId: "load-plan-validation" });
    const otherFixture = makeRuntimeFixture({ sessionId: "load-plan-other" });
    otherFixture.state.workflow = { planName: "other", triageMeta: {}, baselineTree: "other-tree" };

    await runLoadPlanCommand(["plan-implemented"], {
        uiAPI,
        ...fixture.context,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-implemented"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-implemented",
                    path: "plans/plan-implemented.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        failureReason: "CI failed",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            runValidationLoop: () => {
                validated = true;
                workflowDuringValidation = fixture.state.workflow;
                fixture.runtime.clearActiveExecutionWorkflow(fixture.context.sessionId);
                return Promise.resolve();
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(validated, false);
    assertEquals(workflowDuringValidation, null);
    assertEquals(
        messages.some((message) =>
            message.includes("Validation blocked:") &&
            (message.includes("RunWield will not infer in-place execution from missing worktree state") ||
                message.includes("missing worktree delivery identity"))
        ),
        true,
    );
    assertEquals(otherFixture.state.workflow, {
        planName: "other",
        triageMeta: {},
        baselineTree: "other-tree",
    });
});

Deno.test("runLoadPlanCommand reports invalid recovery policy without workflow mutation or dispatch", async () => {
    for (
        const scenario of [
            { status: "implemented", action: "validate" },
            { status: "in_progress", action: "continue" },
            { status: "failed", action: "reset" },
            { status: "implemented", action: "merge" },
        ]
    ) {
        const { uiAPI, selections, messages } = makeUi();
        selections.push(scenario.action, "cancel");
        let validationDispatched = false;
        let executionDispatched = false;
        let metadataMutated = false;
        const fixture = makeRuntimeFixture({ sessionId: `invalid-policy-${scenario.status}` });

        await runLoadPlanCommand([`invalid-${scenario.status}`], {
            uiAPI,
            ...fixture.context,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: false, _: [`invalid-${scenario.status}`] }),
                resolvePlan: () =>
                    Promise.resolve({
                        planName: `invalid-${scenario.status}`,
                        path: `plans/invalid-${scenario.status}.md`,
                        body: "body",
                        markdown: "markdown",
                        attrs: {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "s",
                            affectedPaths: [],
                            status: scenario.status,
                            executionAgent: "unknown-owner",
                        },
                    }),
                runValidationLoop: () => {
                    validationDispatched = true;
                    return Promise.resolve();
                },
                executePlan: () => {
                    executionDispatched = true;
                    return Promise.resolve({ executionComplete: false });
                },
                updatePlanFrontMatter: () => {
                    metadataMutated = true;
                    return Promise.resolve({});
                },
                updateWorktreeRegistryEntry: () => {
                    metadataMutated = true;
                    return Promise.resolve({});
                },
                resetTuiState: () => {},
            }),
        });

        assertEquals(validationDispatched, false);
        assertEquals(executionDispatched, false);
        assertEquals(metadataMutated, false);
        assertEquals(fixture.state.workflow, null);
        assertEquals(
            messages.some((message) =>
                message.includes("Cannot recover Plan recovery") &&
                message.includes("Invalid executionAgent: unknown-owner")
            ),
            true,
        );
    }
});

Deno.test("runLoadPlanCommand implemented non-Git plan retries validation in-place", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("validate");
    let validated = false;
    /** @type {unknown} */
    let workflowDuringValidation = null;
    const fixture = makeRuntimeFixture({ sessionId: "load-plan-non-git-validation" });

    await runLoadPlanCommand(["plan-implemented-non-git"], {
        uiAPI,
        ...fixture.context,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-implemented-non-git"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-implemented-non-git",
                    path: "plans/plan-implemented-non-git.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        failureReason: "CI failed",
                        executionMode: "non_git_in_place",
                    },
                }),
            runValidationLoop: () => {
                validated = true;
                workflowDuringValidation = fixture.state.workflow;
                fixture.runtime.clearActiveExecutionWorkflow(fixture.context.sessionId);
                return Promise.resolve();
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(validated, true);
    assertEquals(workflowDuringValidation, {
        planName: "plan-implemented-non-git",
        triageMeta: {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "s",
            affectedPaths: [],
            status: "implemented",
            failureReason: "CI failed",
            executionMode: "non_git_in_place",
        },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
});

Deno.test("runLoadPlanCommand only offers manual merge for merge-conflict worktree recovery", async () => {
    for (const worktreeStatus of ["completed", "validation_failed", "merge_conflict"]) {
        const { uiAPI, selections, prompts } = makeUi();
        selections.push("cancel");

        await runLoadPlanCommand([`plan-${worktreeStatus}`], {
            ...makeRuntimeContext(),
            uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: false, _: [`plan-${worktreeStatus}`] }),
                resolvePlan: () =>
                    Promise.resolve({
                        planName: `plan-${worktreeStatus}`,
                        path: `plans/plan-${worktreeStatus}.md`,
                        body: "body",
                        markdown: "markdown",
                        attrs: {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "s",
                            affectedPaths: [],
                            status: "implemented",
                            worktreePath: "/tmp/runwield-plan-worktree",
                            worktreeBranch: `runwield/worktree/plan-${worktreeStatus}`,
                            worktreeBaseBranch: "feature-base",
                            worktreeStatus,
                        },
                    }),
                findWorktreeById: () => Promise.resolve(null),
                findWorktreeByPlanName: () => Promise.resolve(null),
                resetTuiState: () => {},
            }),
        });

        const optionValues = prompts[0].options.map((option) => option.value);
        assertEquals(optionValues.includes("merge"), worktreeStatus === "merge_conflict");
    }
});

Deno.test("runLoadPlanCommand refuses forced manual merge before validation-backed merge conflict", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("merge", "cancel");
    let mergeCalled = false;
    /** @type {string[]} */
    const events = [];

    await runLoadPlanCommand(["plan-completed-worktree"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-completed-worktree"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-completed-worktree",
                    path: "plans/plan-completed-worktree.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        worktreePath: "/tmp/runwield-plan-worktree",
                        worktreeBranch: "runwield/worktree/plan-completed-worktree",
                        worktreeStatus: "completed",
                    },
                }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            mergeExecutionWorktree: () => {
                mergeCalled = true;
                return Promise.resolve();
            },
            recordPlanEvent: (/** @type {{ event: string }} */ event) => {
                events.push(event.event);
                return Promise.resolve(/** @type {any} */ ({}));
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(mergeCalled, false);
    assertEquals(events.includes("validation_passed"), false);
    assertEquals(messages.some((message) => message.includes("Retry Workflow Validation first")), true);
});

Deno.test("runLoadPlanCommand keeps a successful manual merge canonical when registry bookkeeping fails", async () => {
    const worktreePath = await Deno.makeTempDir({ prefix: "runwield-load-plan-merge-" });
    try {
        const { uiAPI, selections, messages } = makeUi();
        selections.push("merge");
        let mergedBranch = "";
        let mergedTargetBranch = "";
        let removedPath = "";
        /** @type {boolean | undefined} */
        let removedForce;
        let removedRegistryId = "";
        let registryStatus = "";
        let mergedPlanName = "";
        let mergedPlanDescription = "";
        let stagedExecutionCwd = "";
        let primaryPlanRestored = false;
        /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
        let persistedUpdates = {};
        /** @type {string | null} */
        let lifecycleEvent = null;

        await runLoadPlanCommand(["plan-merge-conflict"], {
            ...makeRuntimeContext(),
            uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: false, _: ["plan-merge-conflict"] }),
                resolvePlan: () =>
                    Promise.resolve({
                        planName: "plan-merge-conflict",
                        path: "plans/plan-merge-conflict.md",
                        body: "body",
                        markdown: "markdown",
                        attrs: {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "Resolve a manual merge conflict.",
                            affectedPaths: [],
                            status: "implemented",
                            worktreeId: "wt1",
                            worktreePath,
                            worktreeBranch: "runwield/worktree/plan-merge-conflict",
                            worktreeStatus: "merge_conflict",
                        },
                    }),
                findWorktreeById: () =>
                    Promise.resolve({
                        id: "wt1",
                        planName: "plan-merge-conflict",
                        path: worktreePath,
                        branch: "runwield/worktree/plan-merge-conflict",
                        baseBranch: "feature-base",
                        baseRef: "feature-base",
                        baseCommit: "abc123",
                        baseTree: "baseline-tree",
                        status: "merge_conflict",
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    }),
                findWorktreeByPlanName: () => Promise.resolve(null),
                getWorktreeStatus: () =>
                    Promise.resolve({
                        exists: true,
                        path: worktreePath,
                        branch: "runwield/worktree/plan-merge-conflict",
                        statusText: "",
                        diff: "",
                    }),
                sealExecutionWorktreeCandidate: () =>
                    Promise.resolve({ executionCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
                getBranchHead: () => Promise.resolve("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
                isCommitAncestorOfBranch: () => Promise.resolve(true),
                resolveValidationExecutionContext: () =>
                    Promise.resolve({
                        kind: "ok",
                        context: {
                            executionMode: "worktree",
                            projectRoot: Deno.cwd(),
                            executionCwd: worktreePath,
                            worktreeId: "wt1",
                            worktreeBranch: "runwield/worktree/plan-merge-conflict",
                            worktreeBaseBranch: "feature-base",
                            baselineTree: "baseline-tree",
                        },
                    }),
                stageValidationPassedInExecutionWorktree: (/** @type {{ executionCwd: string }} */ args) => {
                    stagedExecutionCwd = args.executionCwd;
                    return Promise.resolve(
                        /** @type {any} */ ({
                            attrs: { status: "verified" },
                            planPaths: ["plans/plan-merge-conflict.md"],
                        }),
                    );
                },
                preparePrimaryPlanPathForMerge: () =>
                    Promise.resolve(
                        /** @type {any} */ ({
                            projectRoot: "/primary",
                            relativePath: "plans/plan-merge-conflict.md",
                            absolutePath: "/primary/plans/plan-merge-conflict.md",
                            existed: true,
                            tracked: true,
                            content: "implemented",
                        }),
                    ),
                restorePrimaryPlanPathAfterMergeFailure: () => {
                    primaryPlanRestored = true;
                    return Promise.resolve();
                },
                mergeExecutionWorktree: (
                    /** @type {{ branch: string, targetBranch?: string, planName?: string, planDescription?: string }} */ args,
                ) => {
                    mergedBranch = args.branch;
                    mergedTargetBranch = args.targetBranch || "";
                    mergedPlanName = args.planName || "";
                    mergedPlanDescription = args.planDescription || "";
                    return Promise.resolve({ updatedPrimaryCheckout: false });
                },
                removeExecutionWorktree: (/** @type {{ path: string, force?: boolean }} */ args) => {
                    removedPath = args.path;
                    removedForce = args.force;
                    return Promise.resolve();
                },
                removeWorktreeRegistryEntry: (/** @type {string} */ _cwd, /** @type {string} */ id) => {
                    removedRegistryId = id;
                    return Promise.resolve();
                },
                updateWorktreeRegistryEntry: (
                    /** @type {string} */ _cwd,
                    /** @type {string} */ _id,
                    /** @type {{ status: string }} */ updates,
                ) => {
                    registryStatus = updates.status;
                    return Promise.reject(new Error("registry unavailable"));
                },
                updatePlanFrontMatter: (
                    /** @type {string} */ _cwd,
                    /** @type {string} */ _planName,
                    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */ updates,
                    /** @type {import('../../plan-store.js').PlanFrontMatter} */ attrs,
                ) => {
                    persistedUpdates = updates;
                    return Promise.resolve({ ...attrs, ...updates });
                },
                recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                    lifecycleEvent = args.event;
                    return Promise.resolve(/** @type {any} */ ({}));
                },
                recordWorkflowMetric: (/** @type {any} */ metric) =>
                    metric.event === "recovery_action_result" && metric.details.result === "merged"
                        ? Promise.reject(new Error("metrics unavailable"))
                        : Promise.resolve(null),
                resetTuiState: () => {},
            }),
        });

        assertEquals(persistedUpdates.worktreeBaseBranch, "feature-base");
        assertEquals(stagedExecutionCwd, worktreePath);
        assertEquals(mergedBranch, "runwield/worktree/plan-merge-conflict");
        assertEquals(mergedTargetBranch, "feature-base");
        assertEquals(mergedPlanName, "plan-merge-conflict");
        assertEquals(mergedPlanDescription, "Resolve a manual merge conflict.");
        assertEquals(primaryPlanRestored, true);
        assertEquals(removedPath, worktreePath);
        assertEquals(removedForce, false);
        assertEquals(removedRegistryId, "wt1");
        assertEquals(registryStatus, "merged");
        assertEquals(lifecycleEvent, null);
        assertEquals(
            messages.some((message) =>
                message.includes("Worktree merged, but updating its registry status failed: registry unavailable")
            ),
            true,
        );
        assertEquals(
            messages.some((message) =>
                message.includes("Worktree merged, but recording the recovery result failed: metrics unavailable")
            ),
            true,
        );
    } finally {
        await Deno.remove(worktreePath, { recursive: true });
    }
});

Deno.test("runLoadPlanCommand reapplies verified Plan metadata after real manual merge-conflict rollback", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await savePlan(projectRoot, "manual-conflict", "# Manual Conflict", {
            status: "ready_for_work",
            classification: "FEATURE",
        });
        await git(projectRoot, ["add", ".gitignore", "conflict.txt", "plans/manual-conflict.md"]);
        await git(projectRoot, ["commit", "-m", "add manual conflict plan"]);
        const worktree = await createExecutionWorktree({ projectRoot, planName: "Manual Conflict", worktreeRoot });
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "target conflict"]);
        await savePlan(projectRoot, "manual-conflict", "# Manual Conflict", {
            status: "implemented",
            classification: "FEATURE",
            executionMode: "worktree",
            executionBaselineTree: worktree.baseTree,
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "merge_conflict",
        });
        await Deno.writeTextFile(`${worktree.path}/conflict.txt`, "execution\n");
        const worktreeRecord = {
            id: worktree.id,
            planName: "manual-conflict",
            path: worktree.path,
            branch: worktree.branch,
            baseBranch: "main",
            baseRef: "main",
            baseCommit: worktree.baseCommit,
            baseTree: worktree.baseTree,
            status: "merge_conflict",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const deps = /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["manual-conflict"] }),
            resolvePlan: async () => ({
                ...(await loadPlan(projectRoot, "manual-conflict")),
                planName: "manual-conflict",
            }),
            findWorktreeById: () => Promise.resolve(worktreeRecord),
            findWorktreeByPlanName: () => Promise.resolve(worktreeRecord),
            getWorktreeStatus: () =>
                Promise.resolve({
                    exists: true,
                    path: worktree.path,
                    branch: worktree.branch,
                    statusText: "",
                    diff: "",
                }),
            stageValidationPassedInExecutionWorktree: (/** @type {any} */ args) =>
                stageValidationPassedInExecutionWorktree({ ...args, projectRoot }),
            preparePrimaryPlanPathForMerge: (/** @type {any} */ args) =>
                preparePrimaryPlanPathForMerge({ ...args, projectRoot }),
            restorePrimaryPlanPathAfterMergeFailure,
            mergeExecutionWorktree: (/** @type {any} */ args) => mergeExecutionWorktree({ ...args, projectRoot }),
            updatePlanFrontMatter: (
                /** @type {string} */ _cwd,
                /** @type {string} */ planName,
                /** @type {any} */ updates,
                /** @type {any} */ attrs,
            ) => updatePlanFrontMatter(projectRoot, planName, updates, attrs),
            recordPlanEvent: (/** @type {any} */ args) => recordPlanEvent({ ...args, cwd: projectRoot }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            removeExecutionWorktree: () => Promise.resolve(),
            removeWorktreeRegistryEntry: () => Promise.resolve(),
            shouldCleanupMergedWorktrees: () => false,
            recordWorkflowMetric: () => Promise.resolve(null),
            resolveValidationExecutionContext: () =>
                Promise.resolve({
                    kind: "ok",
                    context: {
                        executionMode: "worktree",
                        projectRoot,
                        executionCwd: worktree.path,
                        worktreeId: worktree.id,
                        worktreeBranch: worktree.branch,
                        worktreeBaseBranch: "main",
                        baselineTree: worktree.baseTree,
                    },
                }),
            resetTuiState: () => {},
        });

        const firstUi = makeUi();
        firstUi.selections.push("merge");
        await runLoadPlanCommand(["manual-conflict"], {
            ...makeRuntimeContext(),
            uiAPI: firstUi.uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: deps,
        });
        assertEquals((await loadPlan(projectRoot, "manual-conflict"))?.attrs.status, "implemented");

        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "resolved\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        const secondUi = makeUi();
        secondUi.selections.push("merge");
        await runLoadPlanCommand(["manual-conflict"], {
            ...makeRuntimeContext(),
            uiAPI: secondUi.uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: deps,
        });

        const manualConflictPlan = await loadPlan(projectRoot, "manual-conflict");
        assertEquals(manualConflictPlan?.attrs.status, "implemented");
        assertStringIncludes(
            String(manualConflictPlan?.attrs.failureReason || ""),
            "Target branch main advanced before publication",
        );
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runLoadPlanCommand records recovery metric when manual merge fails", async () => {
    const worktreePath = await Deno.makeTempDir({ prefix: "runwield-load-plan-merge-fail-" });
    try {
        const { uiAPI, selections } = makeUi();
        selections.push("merge");
        /** @type {any[]} */
        const metrics = [];
        let primaryPlanRestored = false;

        await runLoadPlanCommand(["plan-merge-conflict-fail"], {
            ...makeRuntimeContext(),
            uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: false, _: ["plan-merge-conflict-fail"] }),
                resolvePlan: () =>
                    Promise.resolve({
                        planName: "plan-merge-conflict-fail",
                        path: "plans/plan-merge-conflict-fail.md",
                        body: "body",
                        markdown: "markdown",
                        attrs: {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "Resolve a manual merge conflict.",
                            affectedPaths: [],
                            status: "implemented",
                            worktreeId: "wt1",
                            worktreePath,
                            worktreeBranch: "runwield/worktree/plan-merge-conflict-fail",
                            worktreeStatus: "merge_conflict",
                        },
                    }),
                findWorktreeById: () =>
                    Promise.resolve({
                        id: "wt1",
                        planName: "plan-merge-conflict-fail",
                        path: worktreePath,
                        branch: "runwield/worktree/plan-merge-conflict-fail",
                        baseBranch: "feature-base",
                        baseRef: "feature-base",
                        baseCommit: "abc123",
                        baseTree: "baseline-tree",
                        status: "merge_conflict",
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    }),
                getWorktreeStatus: () =>
                    Promise.resolve({
                        exists: true,
                        path: worktreePath,
                        branch: "runwield/worktree/plan-merge-conflict-fail",
                        statusText: "",
                        diff: "",
                    }),
                sealExecutionWorktreeCandidate: () =>
                    Promise.resolve({ executionCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
                getBranchHead: () => Promise.resolve("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
                resolveValidationExecutionContext: () =>
                    Promise.resolve({
                        kind: "ok",
                        context: {
                            executionMode: "worktree",
                            projectRoot: Deno.cwd(),
                            executionCwd: worktreePath,
                            worktreeId: "wt1",
                            worktreeBranch: "runwield/worktree/plan-merge-conflict-fail",
                            worktreeBaseBranch: "feature-base",
                            baselineTree: "baseline-tree",
                        },
                    }),
                stageValidationPassedInExecutionWorktree: () =>
                    Promise.resolve(
                        /** @type {any} */ ({
                            attrs: { status: "verified" },
                            planPaths: ["plans/plan-merge-conflict-fail.md"],
                        }),
                    ),
                preparePrimaryPlanPathForMerge: () =>
                    Promise.resolve(
                        /** @type {any} */ ({
                            projectRoot: "/primary",
                            relativePath: "plans/plan-merge-conflict-fail.md",
                            absolutePath: "/primary/plans/plan-merge-conflict-fail.md",
                            existed: true,
                            tracked: true,
                            content: "implemented",
                        }),
                    ),
                restorePrimaryPlanPathAfterMergeFailure: () => {
                    primaryPlanRestored = true;
                    return Promise.resolve();
                },
                mergeExecutionWorktree: () => Promise.reject(new Error("conflict")),
                updateWorktreeRegistryEntry: () => Promise.resolve({}),
                updatePlanFrontMatter: (
                    /** @type {string} */ _cwd,
                    /** @type {string} */ _planName,
                    /** @type {any} */ updates,
                    /** @type {any} */ attrs,
                ) => Promise.resolve({ ...attrs, ...updates }),
                recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
                recordWorkflowMetric: (/** @type {any} */ metric) => {
                    metrics.push(metric);
                    return Promise.resolve(null);
                },
                resetTuiState: () => {},
            }),
        });

        assertEquals(primaryPlanRestored, true);
        assertEquals(
            metrics.some((metric) =>
                metric.category === "recovery" && metric.event === "recovery_action_result" &&
                metric.details.action === "merge" && metric.details.result === "failed" &&
                metric.details.hasWorktree === true && metric.details.canMergeWorktree === true
            ),
            true,
        );
    } finally {
        await Deno.remove(worktreePath, { recursive: true });
    }
});
