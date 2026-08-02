import { assertEquals, assertStringIncludes } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";
import { AGENTS, getCwd } from "../../constants.js";
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

import {
    addEntry as addRegistryEntry,
    findById as findRegistryEntryById,
    listEntries as listRegistryEntries,
    pruneEntry as pruneRegistryEntry,
} from "../../shared/worktree-registry.js";

import { git, makePlanProject, makeRuntimeContext, makeRuntimeFixture, makeUi } from "./load-plan-test-helpers.js";
import { listTransitionRecoveryRecords } from "../../shared/workflow/state-transition.ts";
import { createTestWorktreeAttempt } from "../../shared/worktree-test-helpers.js";

Deno.test("runLoadPlanCommand rehydrates Frontend Engineer recovery without transient Pair style", async () => {
    const { uiAPI, selections } = makeUi();
    const { projectRoot } = await makePlanProject("plan-progress", {
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "in_progress",
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
        executionMode: "non_git_in_place",
        executionBaselineTree: "baseline-tree",
    });
    const runtimeFixture = makeRuntimeFixture({ cwd: projectRoot });
    selections.push("continue");
    let executed = false;

    await runLoadPlanCommand(["plan-progress"], {
        ...runtimeFixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-progress"] }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    // recovery_continue lands the Plan back on ready_for_work before execution.
    assertEquals((await loadPlan(projectRoot, "plan-progress"))?.attrs.status, "ready_for_work");
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
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: getCwd() }),
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
    // A project of its own, deliberately not a Git repository — that is the scenario.
    // The registry is a plain file, so the real abandon works here; without a project
    // of its own it would be written into the developer's checkout.
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-nongit-project-" }));
    await addRegistryEntry(
        projectRoot,
        /** @type {any} */ ({
            id: "wt-non-git-reset",
            planName: "plan-non-git-reset",
            planId: "plan-non-git-reset-id",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "recorded",
            baseTree: "recorded-tree",
            branch: "runwield/worktree/plan-non-git-reset",
            path: `${projectRoot}/stale-worktree`,
            status: "execution_failed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }),
    );

    // The Plan has to exist on disk: clearing stale recovery metadata is a real Front
    // Matter write, and a stand-in writer never needed a file to write to.
    await savePlanForTest(projectRoot, "plan-non-git-reset", "# Non Git Reset", {
        status: "failed",
        classification: "FEATURE",
        planId: "plan-non-git-reset-id",
        worktreeId: "wt-non-git-reset",
    });

    const { uiAPI, selections, messages } = makeUi();
    selections.push("reset", "clear");
    let restored = false;
    /** @type {Record<string, unknown> | null} */
    /** @type {{ id: string, updates: Record<string, unknown> } | null} */

    await runLoadPlanCommand(["plan-non-git-reset"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
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
                        worktreeId: "wt-non-git-reset",
                        worktreePath: "/tmp/recorded-worktree",
                        worktreeBranch: "runwield/worktree/plan-non-git-reset",
                        worktreeStatus: "execution_failed",
                    },
                }),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: getCwd() }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            restoreWorktreeTree: () => {
                restored = true;
                return Promise.resolve();
            },
            recordWorkflowMetric: () => Promise.resolve(null),
            resetTuiState: () => {},
        }),
    });

    assertEquals(restored, false);
    // No worktree removal was attempted: the real remover asserts a Git repository
    // first, so in a non-Git project any attempt would have thrown rather than
    // reaching the metadata-only outcome asserted below.
    assertEquals((await findRegistryEntryById(projectRoot, "wt-non-git-reset"))?.status, "abandoned");
    // The Plan on disk is what was cleared, rather than the argument object a
    // stand-in writer was handed. The cleared worktree fields are also what makes
    // this a metadata-only reset: a `recovery_reset` lifecycle event carries the
    // recorded worktree forward instead of dropping it, so it could not produce
    // this state. That used to be asserted by a stand-in rigged to throw.
    const cleared = await loadPlan(projectRoot, "plan-non-git-reset");
    assertEquals(cleared?.attrs.status, "ready_for_work");
    assertEquals(cleared?.attrs.executionBaselineTree ?? null, null);
    assertEquals(cleared?.attrs.worktreeId ?? null, null);
    assertEquals(cleared?.attrs.worktreePath ?? null, null);
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
    // The baseline reset is the Git-backed branch of recovery, so the project has
    // to be a repository. The old fixture inherited the process cwd for that.
    const { projectRoot } = await makePlanProject("plan-failed", {
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "failed",
        failureReason: "engineer stopped",
        executionBaselineTree: "baseline-tree",
    });
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "base"]);

    await runLoadPlanCommand(["plan-failed"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-failed"] }),
            restoreWorktreeTree: (/** @type {string} */ _cwd, /** @type {string} */ tree) => {
                restoredTree = tree;
                return Promise.resolve();
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(restoredTree, "baseline-tree");
    // Starting over clears the recorded failure as well as moving the status.
    const reset = await loadPlan(projectRoot, "plan-failed");
    assertEquals(reset?.attrs.status, "ready_for_work");
    assertEquals(reset?.attrs.failureReason ?? null, null);
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand refuses worktree reset when recorded recreate base is missing", async () => {
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-refuse-project-" }));
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-refuse-worktrees-" }));
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
    await git(projectRoot, ["add", ".gitignore"]);
    await git(projectRoot, ["commit", "-m", "base"]);
    const worktree = await createTestWorktreeAttempt({
        projectRoot,
        planName: "plan-missing-base",
        planId: "plan-missing-base-id",
        worktreeRoot,
    });

    const { uiAPI, selections, messages } = makeUi();
    selections.push("reset", "cancel");

    await runLoadPlanCommand(["plan-missing-base"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
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
                        worktreeId: worktree.id,
                        worktreePath: worktree.path,
                        worktreeBranch: worktree.branch,
                        worktreeStatus: "execution_failed",
                    },
                }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            resetTuiState: () => {},
        }),
    });

    // Nothing was destroyed by the refusal: the recorded worktree is still registered
    // with Git, which is the durable form of "the remover was never called".
    assertEquals((await git(projectRoot, ["worktree", "list"])).includes(worktree.path), true);
    // Nothing new was created either: Git still knows exactly one worktree for this
    // project, the one the refusal declined to touch.
    assertEquals((await git(projectRoot, ["worktree", "list"])).split("\n").length, 2);
    assertEquals(messages.some((message) => message.includes("no recorded base commit or base ref")), true);
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
});

Deno.test("runLoadPlanCommand recreates worktree reset from recorded base commit", async () => {
    // A reset deletes the failed worktree before recreating it. That deletion is real
    // here; the recreate is still stood in for, because it is a different seam.
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-reset-project-" }));
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-reset-worktrees-" }));
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
    await git(projectRoot, ["add", ".gitignore"]);
    await git(projectRoot, ["commit", "-m", "base"]);
    const failedWorktree = await createTestWorktreeAttempt({
        projectRoot,
        planName: "plan-recorded-base",
        planId: "plan-recorded-base-id",
        worktreeRoot,
    });

    // The recorded base is a real commit, because the recreate now really branches
    // from it. "abc123" only ever worked against a stand-in.
    const recordedBaseCommit = await git(projectRoot, ["rev-parse", "HEAD"]);

    // The Plan has to exist on disk: the recovery transaction writes its Front Matter
    // for real, and a Plan it cannot load rolls the whole recreate back.
    await savePlanForTest(projectRoot, "plan-recorded-base", "# plan-recorded-base", {
        status: "failed",
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        // A Plan that reached execution carries its durable identity; the real
        // recreate refuses to branch a worktree without one.
        planId: "plan-recorded-base-id",
        executionBaselineTree: "baseline-tree",
        worktreeId: failedWorktree.id,
        worktreePath: failedWorktree.path,
        worktreeBranch: failedWorktree.branch,
        worktreeStatus: "execution_failed",
    });

    const { uiAPI, selections } = makeUi();
    selections.push("reset", "confirm");
    let executed = false;

    await runLoadPlanCommand(["plan-recorded-base"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-recorded-base"] }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: failedWorktree.id,
                    planName: "plan-recorded-base",
                    path: failedWorktree.path,
                    branch: failedWorktree.branch,
                    baseRef: "main",
                    baseCommit: recordedBaseCommit,
                    baseTree: "baseline-tree",
                    status: "execution_failed",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    // Really deleted from Git, then really recreated: a second worktree exists, it is
    // not the failed one, and it sits on the recorded base commit.
    assertEquals((await git(projectRoot, ["worktree", "list"])).includes(failedWorktree.path), false);
    const settled = (await listRegistryEntries(projectRoot)).filter((entry) => entry.id !== failedWorktree.id);
    assertEquals(settled.length, 1, "the recreated attempt is settled in the registry");
    assertEquals(settled[0].baseCommit, recordedBaseCommit);
    assertEquals(
        await git(projectRoot, ["rev-parse", `${settled[0].branch}^{commit}`]),
        recordedBaseCommit,
        "the recreated branch really starts at the recorded base commit",
    );
    assertEquals(executed, true);
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
});

Deno.test("runLoadPlanCommand recreates missing worktree reset after warning confirmation", async () => {
    // The recorded worktree is gone from disk, so removal has nothing to delete and
    // says so by succeeding. What this scenario is actually about is the warning, the
    // confirmation, and the recreate that follows — asserting the path handed to a
    // stand-in remover proved none of that.
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-lost-project-" }));
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
    await git(projectRoot, ["add", ".gitignore"]);
    await git(projectRoot, ["commit", "-m", "base"]);

    // Recorded but gone from disk — the scenario's whole premise. The registry entry
    // has to exist for real, because abandoning it is what clears the way for the
    // replacement, and the real registry refuses to update an entry it has never seen.
    const recordedBaseCommit = await git(projectRoot, ["rev-parse", "HEAD"]);
    await addRegistryEntry(
        projectRoot,
        /** @type {any} */ ({
            id: "wt-lost-worktree",
            planName: "plan-lost-worktree",
            planId: "plan-lost-worktree-id",
            baseBranch: "main",
            baseRef: "main",
            baseCommit: recordedBaseCommit,
            baseTree: "baseline-tree",
            branch: "runwield/worktree/plan-lost-worktree",
            path: "/tmp/runwield-missing-plan-worktree",
            status: "execution_failed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }),
    );

    // The Plan has to exist on disk: the recovery transaction writes its Front Matter
    // for real, and a Plan it cannot load rolls the whole recreate back.
    await savePlanForTest(projectRoot, "plan-lost-worktree", "# plan-lost-worktree", {
        status: "failed",
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        planId: "plan-lost-worktree-id",
        executionBaselineTree: "baseline-tree",
        worktreeId: "wt-lost-worktree",
        worktreePath: "/tmp/runwield-missing-plan-worktree",
        worktreeBranch: "runwield/worktree/plan-lost-worktree",
        worktreeStatus: "execution_failed",
    });

    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("reset", "confirm");
    let executed = false;

    await runLoadPlanCommand(["plan-lost-worktree"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-lost-worktree"] }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-lost-worktree",
                    planName: "plan-lost-worktree",
                    path: "/tmp/runwield-missing-plan-worktree",
                    branch: "runwield/worktree/plan-lost-worktree",
                    baseRef: "main",
                    baseCommit: recordedBaseCommit,
                    baseTree: "baseline-tree",
                    status: "execution_failed",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
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
    // The lost attempt is recorded abandoned and a real replacement is settled in its
    // place, rather than a stand-in reporting that it would have been.
    const entries = await listRegistryEntries(projectRoot);
    assertEquals(entries.filter((entry) => entry.status === "active").length, 1);
    assertEquals(entries.some((entry) => entry.status === "abandoned"), true);
    assertEquals(executed, true);
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
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
            message.includes("cannot tell where") &&
            message.includes("will not validate the current checkout automatically")
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
                resetTuiState: () => {},
            }),
        });

        assertEquals(validationDispatched, false);
        assertEquals(executionDispatched, false);
        // No Front Matter was written. This fixture has no Plan on disk, and the real
        // writer throws `Plan not found` rather than inventing one — so reaching this
        // assertion at all is the proof that the refusal mutated nothing.
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
        projectRoot: getCwd(),
        executionCwd: getCwd(),
        executionStarted: true,
        nonGitInPlace: true,
    });
});

Deno.test("runLoadPlanCommand keeps paused validation continuation with execution owner", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("validate");
    const fixture = makeRuntimeFixture({ sessionId: "load-plan-paused-validation" });

    await runLoadPlanCommand(["plan-paused-validation"], {
        uiAPI,
        ...fixture.context,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-paused-validation"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-paused-validation",
                    path: "plans/plan-paused-validation.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        failureReason: "semantic repair paused",
                        executionMode: "non_git_in_place",
                    },
                }),
            runValidationLoop: async () => {
                fixture.runtime.setActiveExecutionWorkflow(fixture.context.sessionId, {
                    planName: "plan-paused-validation",
                    triageMeta: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        failureReason: "semantic repair paused",
                        executionMode: "non_git_in_place",
                    },
                    executionAgent: AGENTS.ENGINEER,
                    executionMode: "non_git_in_place",
                    projectRoot: getCwd(),
                    executionCwd: getCwd(),
                    nonGitInPlace: true,
                    validationContinuation: true,
                });
                await fixture.runtime.switchAgent(fixture.context.sessionId, {
                    agentName: AGENTS.ENGINEER,
                    allowReturnToRouter: false,
                });
                return { kind: "paused", planName: "plan-paused-validation", projectRoot: getCwd() };
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(fixture.state.activeAgent, AGENTS.ENGINEER);
    assertEquals(fixture.state.agentHistory.at(-1), AGENTS.ENGINEER);
});

Deno.test("runLoadPlanCommand retry validation reports Plan restoration before validation", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("validate");
    let validated = false;
    const fixture = makeRuntimeFixture({ sessionId: "load-plan-restored-validation" });
    const worktreePath = await Deno.makeTempDir();
    try {
        await runLoadPlanCommand(["plan-restored"], {
            uiAPI,
            ...fixture.context,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: false, _: ["plan-restored"] }),
                resolvePlan: () =>
                    Promise.resolve({
                        planName: "plan-restored",
                        path: "plans/plan-restored.md",
                        body: "body",
                        markdown: "markdown",
                        attrs: {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "s",
                            affectedPaths: [],
                            status: "implemented",
                            executionMode: "worktree",
                            executionBaselineTree: "baseline-tree",
                            worktreeId: "wt-restored",
                            worktreePath,
                            worktreeBranch: "runwield/worktree/plan-restored",
                            worktreeBaseBranch: "feature-base",
                            worktreeStatus: "completed",
                        },
                    }),
                findWorktreeById: () =>
                    Promise.resolve({
                        id: "wt-restored",
                        planName: "plan-restored",
                        path: worktreePath,
                        branch: "runwield/worktree/plan-restored",
                        baseBranch: "feature-base",
                        baseTree: "baseline-tree",
                        status: "completed",
                        executionBaselineTree: "baseline-tree",
                    }),
                getWorktreeStatus: () =>
                    Promise.resolve({
                        exists: true,
                        path: worktreePath,
                        branch: "runwield/worktree/plan-restored",
                        statusText: "",
                        diff: "",
                    }),
                resolveValidationExecutionContext: () =>
                    Promise.resolve({
                        kind: "ok",
                        restoredPlanFile: { relativePath: "plans/plan-restored.md" },
                        context: {
                            executionMode: "worktree",
                            planName: "plan-restored",
                            projectRoot: getCwd(),
                            executionCwd: worktreePath,
                            baselineTree: "baseline-tree",
                            worktreeId: "wt-restored",
                            worktreeBranch: "runwield/worktree/plan-restored",
                            worktreeBaseBranch: "feature-base",
                            source: "durable_recovery",
                        },
                    }),
                runValidationLoop: () => {
                    validated = true;
                    return Promise.resolve();
                },
                resetTuiState: () => {},
            }),
        });

        assertEquals(validated, true, messages.join("\n"));
        assertEquals(messages.filter((message) => message.includes("plans/plan-restored.md")).length, 1);
    } finally {
        await Deno.remove(worktreePath, { recursive: true }).catch(() => {});
    }
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
    const { projectRoot } = await makePlanProject("plan-completed-worktree", {
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "implemented",
        worktreePath: "/tmp/runwield-plan-worktree",
        worktreeBranch: "runwield/worktree/plan-completed-worktree",
        worktreeStatus: "completed",
    });
    // Manual merge is only offered inside a repository, so the project is one.
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "base"]);

    await runLoadPlanCommand(["plan-completed-worktree"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-completed-worktree"] }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            resetTuiState: () => {},
        }),
    });

    // The merge never ran: the Plan is still implemented rather than verified, and the
    // refusal reaches the user. Previously a stand-in merge recorded that it was not
    // called, which is the same claim with an extra layer of make-believe in front.
    assertEquals((await loadPlan(projectRoot, "plan-completed-worktree"))?.attrs.status, "implemented");
    assertEquals(messages.some((message) => message.includes("Retry Workflow Validation first")), true);
});

Deno.test("runLoadPlanCommand keeps a successful manual merge canonical when registry bookkeeping fails", async () => {
    // A real repository with a real execution worktree, in a project of its own.
    //
    // Post-merge cleanup is a sequence — remove the worktree, delete the branch only
    // once Git proves it merged, then drop the registry entry — and faking its ends
    // while the middle ran for real meant it had been running against the developer's
    // own checkout, because `projectRoot` was the process cwd.
    // Resolved, because Git reports and matches worktree paths after resolving
    // symlinks: on macOS a temp dir is `/var/...` while Git says `/private/var/...`,
    // and an unresolved path makes `git worktree remove` fail with "not a working tree".
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-load-plan-project-" }));
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-load-plan-worktrees-" }));
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await Deno.writeTextFile(`${projectRoot}/merged.txt`, "base\n");
        // The Plan must exist in the primary checkout: publication resolves the Plan
        // path there and stages it into the execution worktree. A stand-in merge never
        // touched the filesystem, so no fixture ever needed a real Plan.
        await savePlanForTest(projectRoot, "plan-merge-conflict", "# Merge Conflict", {
            status: "implemented",
            classification: "FEATURE",
            planId: "plan-merge-conflict-id",
        });
        await git(projectRoot, ["add", ".gitignore", "merged.txt", "plans/plan-merge-conflict.md"]);
        await git(projectRoot, ["commit", "-m", "base"]);
        await git(projectRoot, ["branch", "feature-base"]);
        const worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "plan-merge-conflict",
            planId: "plan-merge-conflict-id",
            worktreeRoot,
        });
        const worktreePath = worktree.path;
        // The failure this test is about, made real: the worktree exists on disk but
        // the registry has no record of it, so the post-merge status update has
        // nothing to update. Previously a stand-in was told to reject, which proved
        // only that the caller forwards a rejection it was handed.
        //
        // `pruneEntry`, not `removeEntry`: removal is a soft delete that retains the
        // entry as `abandoned`, and an abandoned entry is still findable and updatable.
        await pruneRegistryEntry(projectRoot, worktree.id);
        const executionHead = await git(worktree.path, ["rev-parse", "HEAD"]);
        const { uiAPI, selections, messages } = makeUi();
        selections.push("merge");
        await runLoadPlanCommand(["plan-merge-conflict"], {
            // Without this the session cwd is the developer's checkout, and post-merge
            // cleanup runs `git worktree remove` against *that* repository.
            ...makeRuntimeContext({ cwd: projectRoot }),
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
                            worktreeId: worktree.id,
                            worktreePath,
                            worktreeBranch: "runwield/worktree/plan-merge-conflict",
                            worktreeStatus: "merge_conflict",
                        },
                    }),
                findWorktreeById: () =>
                    Promise.resolve({
                        id: worktree.id,
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
                resolveValidationExecutionContext: () =>
                    Promise.resolve({
                        kind: "ok",
                        restoredPlanFile: { relativePath: "plans/plan-merge-conflict.md" },
                        context: {
                            executionMode: "worktree",
                            projectRoot,
                            executionCwd: worktreePath,
                            worktreeId: worktree.id,
                            // The worktree's real branch: the real merge refuses to publish
                            // a worktree that is not on the branch the Plan claims.
                            worktreeBranch: worktree.branch,
                            worktreeBaseBranch: "feature-base",
                            baselineTree: "baseline-tree",
                        },
                    }),
                recordWorkflowMetric: (/** @type {any} */ metric) =>
                    metric.event === "recovery_action_result" && metric.details.result === "merged"
                        ? Promise.reject(new Error("metrics unavailable"))
                        : Promise.resolve(null),
                resetTuiState: () => {},
            }),
        });

        // The merge really happened, read from Git rather than from the arguments
        // handed to a stand-in: the execution commit is now on the target branch.
        assertEquals(
            (await git(projectRoot, ["branch", "--contains", executionHead, "--list", "feature-base"])).includes(
                "feature-base",
            ),
            true,
            "the execution work is on the target branch",
        );
        // The Plan the merge published does not carry the base-branch bookkeeping field,
        // and it is still `implemented`: a manual merge publishes the work but records
        // no lifecycle event, so nothing advanced the Plan to verified.
        const publishedPlan = await loadPlan(projectRoot, "plan-merge-conflict");
        assertEquals(publishedPlan?.attrs.worktreeBaseBranch ?? null, null);
        assertEquals(publishedPlan?.attrs.status, "implemented");
        // Post-merge worktree removal is not this test's subject. Its premise is that
        // registry bookkeeping fails after a successful merge, and cleanup runs after
        // that bookkeeping — so what must hold here is that the merge stayed canonical
        // and the failure was reported. Removal is proven by the tests whose
        // bookkeeping succeeds.
        //
        // Still no registry record, because there was none to restore.
        assertEquals(await findRegistryEntryById(projectRoot, worktree.id), null);
        assertEquals(
            messages.some((message) => message.includes("plans/plan-merge-conflict.md")),
            true,
        );
        assertEquals(
            messages.some((message) =>
                message.includes("Worktree merged, but updating its registry status failed:") &&
                message.includes(worktree.id)
            ),
            true,
            "the merge stays canonical even though the registry could not record it",
        );
        assertEquals(
            messages.some((message) =>
                message.includes("Worktree merged, but recording the recovery result failed: metrics unavailable")
            ),
            true,
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runLoadPlanCommand rolls back a conflicted manual merge, then publishes once it is resolved", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await savePlanForTest(projectRoot, "manual-conflict", "# Manual Conflict", {
            status: "ready_for_work",
            classification: "FEATURE",
            planId: "plan-manual-conflict",
        });
        await git(projectRoot, ["add", ".gitignore", "conflict.txt", "plans/manual-conflict.md"]);
        await git(projectRoot, ["commit", "-m", "add manual conflict plan"]);
        const worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Manual Conflict",
            planId: "plan-manual-conflict",
            worktreeRoot,
        });
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "target conflict"]);
        await savePlanForTest(projectRoot, "manual-conflict", "# Manual Conflict", {
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
            ...makeRuntimeContext({ cwd: projectRoot }),
            uiAPI: firstUi.uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: deps,
        });
        assertEquals((await loadPlan(projectRoot, "manual-conflict"))?.attrs.status, "implemented");
        // The publication transaction compensated its staging and settled, so nothing is
        // left to block the retry below. A journal here would strand the Plan.
        assertEquals(
            await listTransitionRecoveryRecords(projectRoot),
            [],
            "a merge that failed before the target ref moved leaves no unresolved record",
        );

        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "resolved\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        const secondUi = makeUi();
        secondUi.selections.push("merge");
        await runLoadPlanCommand(["manual-conflict"], {
            ...makeRuntimeContext({ cwd: projectRoot }),
            uiAPI: secondUi.uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: deps,
        });

        // Resolving the conflict and merging again publishes for real. This used to
        // assert "Target branch advanced" instead, which the fixture manufactured: the
        // Git helpers below are not injected here, so with the session pointed at the
        // developer's own checkout `getBranchHead` read that repository's `main` and
        // mismatched this project's head. The test passed by looking at the wrong repo.
        const manualConflictPlan = await loadPlan(projectRoot, "manual-conflict");
        const deliveryEvidence = manualConflictPlan?.attrs.deliveryEvidence;
        assertEquals(manualConflictPlan?.attrs.status, "verified");
        assertEquals(deliveryEvidence?.mode, "worktree_merge");
        if (deliveryEvidence?.mode !== "worktree_merge") throw new Error("Expected worktree merge delivery evidence.");
        assertEquals(deliveryEvidence.targetBranch, "main");
        assertStringIncludes(secondUi.messages.join("\n"), "Worktree changes merged and plan marked verified.");
        assertEquals(
            await listTransitionRecoveryRecords(projectRoot),
            [],
            "a committed publication removes its own journal",
        );
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runLoadPlanCommand refuses a manual merge whose target branch moved since validation", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await Deno.writeTextFile(`${projectRoot}/app.txt`, "base\n");
        await savePlanForTest(projectRoot, "stale-target", "# Stale Target", {
            status: "ready_for_work",
            classification: "FEATURE",
            planId: "plan-stale-target",
        });
        await git(projectRoot, ["add", ".gitignore", "app.txt", "plans/stale-target.md"]);
        await git(projectRoot, ["commit", "-m", "add stale target plan"]);
        const worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Stale Target",
            planId: "plan-stale-target",
            worktreeRoot,
        });
        await Deno.writeTextFile(`${worktree.path}/app.txt`, "execution\n");
        await git(worktree.path, ["add", "app.txt"]);
        await git(worktree.path, ["commit", "-m", "execution work"]);
        const sealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);
        const staleTargetHead = await git(projectRoot, ["rev-parse", "main"]);

        // Validation sealed this candidate against the head above. Someone then pushed
        // to the target branch, so the recorded head no longer describes it — the merge
        // must refuse rather than publish onto a branch nobody re-validated against.
        await Deno.writeTextFile(`${projectRoot}/unrelated.txt`, "landed after validation\n");
        await git(projectRoot, ["add", "unrelated.txt"]);
        await git(projectRoot, ["commit", "-m", "target advanced"]);

        await savePlanForTest(projectRoot, "stale-target", "# Stale Target", {
            status: "implemented",
            classification: "FEATURE",
            executionMode: "worktree",
            executionBaselineTree: worktree.baseTree,
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "merge_conflict",
            deliveryEvidence: {
                version: 1,
                mode: "worktree_merge",
                executionCommit: sealedCommit,
                targetBranch: "main",
                targetHeadBeforeMerge: staleTargetHead,
            },
        });
        const worktreeRecord = {
            id: worktree.id,
            planName: "stale-target",
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
        const { uiAPI, selections, messages } = makeUi();
        selections.push("merge");
        const targetHeadBeforeAttempt = await git(projectRoot, ["rev-parse", "main"]);

        await runLoadPlanCommand(["stale-target"], {
            ...makeRuntimeContext({ cwd: projectRoot }),
            uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: false, _: ["stale-target"] }),
                resolvePlan: async () => ({
                    ...(await loadPlan(projectRoot, "stale-target")),
                    planName: "stale-target",
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
            }),
        });

        assertStringIncludes(messages.join("\n"), "advanced before publication");
        const plan = await loadPlan(projectRoot, "stale-target");
        assertEquals(plan?.attrs.status, "implemented", "an unpublished Plan must not read verified");
        assertEquals(
            await git(projectRoot, ["rev-parse", "main"]),
            targetHeadBeforeAttempt,
            "a refused publication must not move the target branch",
        );
        assertEquals(
            await listTransitionRecoveryRecords(projectRoot),
            [],
            "refusing before the target ref moves is a clean rollback, not a recovery case",
        );
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runLoadPlanCommand records recovery metric when manual merge fails", async () => {
    // A real repository whose merge genuinely conflicts, in a project of its own. The
    // failure used to come from a stand-in told to reject, against the developer's own
    // checkout — which proved only that a rejection is forwarded.
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-mergefail-project-" }));
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-mergefail-worktrees-" }));
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await savePlanForTest(projectRoot, "plan-merge-conflict-fail", "# Merge Conflict Fail", {
            status: "implemented",
            classification: "FEATURE",
            planId: "plan-merge-conflict-fail-id",
        });
        await git(projectRoot, ["add", ".gitignore", "conflict.txt", "plans/plan-merge-conflict-fail.md"]);
        await git(projectRoot, ["commit", "-m", "base"]);
        const worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "plan-merge-conflict-fail",
            planId: "plan-merge-conflict-fail-id",
            worktreeRoot,
        });
        const worktreePath = worktree.path;
        // Divergent edits to the same line on both sides: the merge really conflicts.
        await Deno.writeTextFile(`${worktreePath}/conflict.txt`, "execution\n");
        await git(worktreePath, ["add", "conflict.txt"]);
        await git(worktreePath, ["commit", "-m", "execution conflict"]);
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "target conflict"]);
        const primaryPlanBefore = await Deno.readTextFile(`${projectRoot}/plans/plan-merge-conflict-fail.md`);

        const { uiAPI, selections } = makeUi();
        selections.push("merge");
        /** @type {any[]} */
        const metrics = [];

        await runLoadPlanCommand(["plan-merge-conflict-fail"], {
            ...makeRuntimeContext({ cwd: projectRoot }),
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
                resolveValidationExecutionContext: () =>
                    Promise.resolve({
                        kind: "ok",
                        context: {
                            executionMode: "worktree",
                            projectRoot,
                            executionCwd: worktreePath,
                            worktreeId: "wt1",
                            worktreeBranch: "runwield/worktree/plan-merge-conflict-fail",
                            worktreeBaseBranch: "feature-base",
                            baselineTree: "baseline-tree",
                        },
                    }),
                recordWorkflowMetric: (/** @type {any} */ metric) => {
                    metrics.push(metric);
                    return Promise.resolve(null);
                },
                resetTuiState: () => {},
            }),
        });

        // The primary checkout's Plan file is back to what it was before publication
        // staged anything into it — the durable form of "the failure was rolled back".
        assertEquals(await Deno.readTextFile(`${projectRoot}/plans/plan-merge-conflict-fail.md`), primaryPlanBefore);
        assertEquals(
            metrics.some((metric) =>
                metric.category === "recovery" && metric.event === "recovery_action_result" &&
                metric.details.action === "merge" && metric.details.result === "failed" &&
                metric.details.hasWorktree === true && metric.details.canMergeWorktree === true
            ),
            true,
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runLoadPlanCommand reports abandon progress around worktree removal", async () => {
    // Removal is real now, so it cannot be held open mid-flight the way a stand-in
    // could. What that stand-in was there to prove is still proven: the user is told
    // the deletion is starting before they are told it finished, and the worktree is
    // genuinely gone by the end. The claim that narrowed is "progress appears while
    // removal is still running" — untestable without replacing the machinery, and a
    // weaker guarantee than "the worktree is actually deleted", which was never checked.
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-abandon-project-" }));
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-abandon-worktrees-" }));
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
    await git(projectRoot, ["add", ".gitignore"]);
    await git(projectRoot, ["commit", "-m", "base"]);
    const worktree = await createTestWorktreeAttempt({
        projectRoot,
        planName: "recover-progress",
        planId: "recover-progress-plan",
        worktreeRoot,
    });
    await savePlanForTest(projectRoot, "recover-progress", "# recover progress", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "recover progress",
        affectedPaths: [],
        status: "in_progress",
        planId: "recover-progress-plan",
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        worktreeBranch: worktree.branch,
        worktreeStatus: "active",
    });
    const { uiAPI, selections, messages } = makeUi();
    selections.push("abandon", "confirm");

    await runLoadPlanCommand(["recover-progress"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["recover-progress"] }),
            resetTuiState: () => {},
        }),
    });

    const progressIndex = messages.findIndex((message) =>
        message.includes('Deleting recorded worktree for "recover-progress"')
    );
    const finalIndex = messages.findIndex((message) => message.includes("Worktree abandoned and removed."));
    assertEquals(progressIndex >= 0, true, "the user is told the deletion is starting");
    assertEquals(finalIndex > progressIndex, true, "and is told it finished afterwards");
    assertEquals((await git(projectRoot, ["worktree", "list"])).includes(worktree.path), false);
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
});
