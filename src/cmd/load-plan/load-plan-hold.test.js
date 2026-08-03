import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";

import { findById as findRegistryEntryById } from "../../shared/worktree-registry.js";
import { createTestWorktreeAttempt } from "../../shared/worktree-test-helpers.js";

import { git, makePlanProject, makeRuntimeContext, makeUi } from "./load-plan-test-helpers.js";
import { loadPlan, savePlan } from "../../plan-store.js";

Deno.test("runLoadPlanCommand draft Planned Change can be put on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold");
    const { projectRoot } = await makePlanProject("hold-me", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "draft",
        updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await runLoadPlanCommand(["hold-me"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["hold-me"] }),
        }),
    });

    // The staleness baseline is what a later Resume Check compares against, so
    // it has to survive the write — not merely be present in the call.
    const held = await loadPlan(projectRoot, "hold-me");
    assertEquals(held?.attrs.status, "on_hold");
    assertEquals(held?.attrs.heldFromStatus, "draft");
    assertEquals(held?.attrs.holdStalenessBaseline, "2026-01-01T00:00:00.000Z");
    assertEquals(messages.some((message) => message.includes("Plan put on hold")), true);
});

Deno.test("runLoadPlanCommand on-hold plan resumes after passing Resume Check", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("resume", "cancel");
    const { projectRoot } = await makePlanProject("held-plan", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "on_hold",
        heldFromStatus: "draft",
    });

    await runLoadPlanCommand(["held-plan"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-plan"] }),
            listCommitsTouchingPathsSince: () => Promise.resolve([]),
        }),
    });

    // Resuming has to land the Plan back on the status it was held from and
    // clear the hold bookkeeping, or the next Resume Check reads stale fields.
    const resumed = await loadPlan(projectRoot, "held-plan");
    assertEquals(resumed?.attrs.status, "draft");
    assertEquals(resumed?.attrs.heldFromStatus ?? null, null);
    assertEquals(resumed?.attrs.holdStalenessBaseline ?? null, null);
    assertEquals(messages.some((message) => message.includes("Resume Check")), true);
});

Deno.test("runLoadPlanCommand on-hold plan can reset status to draft", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "confirm");
    const { projectRoot } = await makePlanProject("held-reset", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "on_hold",
        heldFromStatus: "implemented",
    });

    await runLoadPlanCommand(["held-reset"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-reset"] }),
            findWorktreeByPlanName: () => Promise.resolve(null),
        }),
    });

    // Reset drops the plan all the way back to draft rather than to the status
    // it was held from — the distinction the event name alone never showed.
    const reset = await loadPlan(projectRoot, "held-reset");
    assertEquals(reset?.attrs.status, "draft");
    assertEquals(reset?.attrs.heldFromStatus ?? null, null);
});

Deno.test("runLoadPlanCommand blocks child Planned Change when parent Epic is on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("cancel");

    await runLoadPlanCommand(["epic/child"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic/child"] }),
            /** @param {string} _cwd @param {string} name */
            resolvePlan: (_cwd, name) =>
                Promise.resolve(
                    name === "epic"
                        ? {
                            planName: "epic",
                            path: "plans/epic.md",
                            body: "epic body",
                            attrs: {
                                classification: "PROJECT",
                                complexity: "HIGH",
                                summary: "epic",
                                affectedPaths: [],
                                status: "on_hold",
                                heldFromStatus: "ready_for_work",
                            },
                        }
                        : {
                            planName: "epic/child",
                            path: "plans/epic/child.md",
                            body: "child body",
                            attrs: {
                                classification: "PLANNED_CHANGE",
                                complexity: "LOW",
                                summary: "child",
                                affectedPaths: [],
                                status: "ready_for_work",
                                parentPlan: "epic",
                            },
                        },
                ),
        }),
    });

    assertEquals(messages.some((message) => message.includes("Parent Epic") && message.includes("on hold")), true);
});

Deno.test("runLoadPlanCommand Epic can be put on hold with warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold", "confirm");
    const { projectRoot } = await makePlanProject("epic-hold", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "epic",
        affectedPaths: [],
        status: "ready_for_work",
    });

    await runLoadPlanCommand(["epic-hold"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-hold"] }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        planName: "epic-hold/child",
                        path: "plans/epic-hold/child.md",
                        body: "child",
                        attrs: { status: "draft", classification: "PLANNED_CHANGE", summary: "child" },
                    },
                ]),
        }),
    });

    const epic = await loadPlan(projectRoot, "epic-hold");
    assertEquals(epic?.attrs.status, "on_hold");
    assertEquals(epic?.attrs.heldFromStatus, "ready_for_work");
    assertEquals(
        messages.some((message) => message.includes("Child Plans will be hidden/blocked")),
        true,
    );
});

Deno.test("runLoadPlanCommand child Planned Change can be put on hold with child-only warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold", "confirm");
    // Both Plans are real so the parent lookup and the child's hold write hit the
    // same store: holding a child must not disturb the Epic above it.
    const { projectRoot } = await makePlanProject("epic", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "epic",
        affectedPaths: [],
        status: "ready_for_work",
    });
    await savePlan(projectRoot, "epic/child-hold", "# child", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "child",
        affectedPaths: [],
        status: "draft",
        parentPlan: "epic",
    });

    await runLoadPlanCommand(["epic/child-hold"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic/child-hold"] }),
        }),
    });

    assertEquals((await loadPlan(projectRoot, "epic/child-hold"))?.attrs.status, "on_hold");
    assertEquals((await loadPlan(projectRoot, "epic"))?.attrs.status, "ready_for_work");
    assertEquals(messages.some((message) => message.includes("Only this child Planned Change will be held")), true);
});

Deno.test("runLoadPlanCommand on-hold resume warning can keep plan on hold", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("resume", "keep", "cancel");
    const { projectRoot } = await makePlanProject("held-warning", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: ["src/a.js"],
        status: "on_hold",
        heldFromStatus: "ready_for_work",
        holdStalenessBaseline: "2026-01-01T00:00:00.000Z",
    });

    await runLoadPlanCommand(["held-warning"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-warning"] }),
            listCommitsTouchingPathsSince: () => Promise.resolve([{ hash: "abc1234", subject: "change", author: "A" }]),
        }),
    });

    // Keeping the hold means the Plan is still on hold, not merely that no
    // stand-in was called.
    assertEquals((await loadPlan(projectRoot, "held-warning"))?.attrs.status, "on_hold");
    assertEquals(messages.some((message) => message.includes("Resume Check")), true);
    assertEquals(
        prompts.some((prompt) => prompt.options.some((option) => option.label === "Keep on hold")),
        true,
    );
});

Deno.test("runLoadPlanCommand on-hold resume warning can proceed", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume", "proceed", "cancel");
    const { projectRoot } = await makePlanProject("held-warning-proceed", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: ["src/a.js"],
        status: "on_hold",
        heldFromStatus: "ready_for_work",
        holdStalenessBaseline: "2026-01-01T00:00:00.000Z",
    });

    await runLoadPlanCommand(["held-warning-proceed"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-warning-proceed"] }),
            listCommitsTouchingPathsSince: () => Promise.resolve([{ hash: "abc1234", subject: "change", author: "A" }]),
        }),
    });

    // Proceeding past the warning restores the held-from status, not draft.
    assertEquals((await loadPlan(projectRoot, "held-warning-proceed"))?.attrs.status, "ready_for_work");
});

Deno.test("runLoadPlanCommand failed Resume Check keeps plan on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("resume", "cancel");
    const { projectRoot } = await makePlanProject("held-fail", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "on_hold",
        heldFromStatus: "implemented",
        worktreeId: "missing-worktree",
        // The faked Plan this replaced said "in_progress", which is not a
        // worktreeStatus the store will ever write. A live attempt is "active".
        worktreeStatus: "active",
    });

    await runLoadPlanCommand(["held-fail"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-fail"] }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
        }),
    });

    // A failed Resume Check must leave the hold intact on disk.
    const held = await loadPlan(projectRoot, "held-fail");
    assertEquals(held?.attrs.status, "on_hold");
    assertEquals(held?.attrs.heldFromStatus, "implemented");
    assertEquals(messages.some((message) => message.includes("Resume Check failed")), true);
});

Deno.test("runLoadPlanCommand on-hold reset can delete recorded worktree", async () => {
    // A real repository with a real worktree. Deleting one is the destructive half of
    // this command, and while it was faked the test proved only that an argument was
    // passed — against the developer's own checkout, because the session cwd was the
    // process cwd and the recorded path was a fiction under /tmp.
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-hold-project-" }));
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-hold-worktrees-" }));
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
    await git(projectRoot, ["add", ".gitignore"]);
    await git(projectRoot, ["commit", "-m", "base"]);
    const worktree = await createTestWorktreeAttempt({
        projectRoot,
        planName: "held-delete-worktree",
        planId: "plan-held-delete-worktree",
        worktreeRoot,
    });

    await savePlan(projectRoot, "held-delete-worktree", "# held", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "on_hold",
        heldFromStatus: "implemented",
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        worktreeBranch: worktree.branch,
    });

    const { uiAPI, selections } = makeUi();
    selections.push("reset", "reset_delete", "confirm");

    await runLoadPlanCommand(["held-delete-worktree"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-delete-worktree"] }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: worktree.id,
                    path: worktree.path,
                    branch: worktree.branch,
                    status: "in_progress",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
        }),
    });

    const reset = await loadPlan(projectRoot, "held-delete-worktree");
    assertEquals(reset?.attrs.status, "draft");
    assertEquals(reset?.attrs.heldFromStatus ?? null, null);
    // The worktree is really gone from Git, not merely reported as removed.
    assertEquals((await git(projectRoot, ["worktree", "list"])).includes(worktree.path), false);
    // The registry itself records the abandonment, rather than a stand-in recording
    // that it was asked to.
    assertEquals((await findRegistryEntryById(projectRoot, worktree.id))?.status, "abandoned");
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
});
