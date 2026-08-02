import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";

import { findById as findRegistryEntryById } from "../../shared/worktree-registry.js";
import { createTestWorktreeAttempt } from "../../shared/worktree-test-helpers.js";

import { git, makeRuntimeContext, makeUi } from "./load-plan-test-helpers.js";

Deno.test("runLoadPlanCommand draft Planned Change can be put on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold");
    let recorded = null;

    await runLoadPlanCommand(["hold-me"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["hold-me"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "hold-me",
                    path: "plans/hold-me.md",
                    body: "body",
                    attrs: {
                        classification: "PLANNED_CHANGE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                }),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "on_hold", heldFromStatus: "draft" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(/** @type {any} */ (recorded).details.holdStalenessBaseline, "2026-01-01T00:00:00.000Z");
    assertEquals(messages.some((message) => message.includes("Plan put on hold")), true);
});

Deno.test("runLoadPlanCommand on-hold plan resumes after passing Resume Check", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("resume", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-plan"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-plan"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-plan",
                    path: "plans/held-plan.md",
                    body: "body",
                    attrs: {
                        classification: "PLANNED_CHANGE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "draft",
                    },
                }),
            listCommitsTouchingPathsSince: () => Promise.resolve([]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({
                    status: "draft",
                    heldFromStatus: null,
                    heldAt: null,
                    holdReason: null,
                    holdStalenessBaseline: null,
                });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_resumed");
    assertEquals(messages.some((message) => message.includes("Resume Check")), true);
});

Deno.test("runLoadPlanCommand on-hold plan can reset status to draft", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["held-reset"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-reset"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-reset",
                    path: "plans/held-reset.md",
                    body: "body",
                    attrs: {
                        classification: "PLANNED_CHANGE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "implemented",
                    },
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "draft", heldFromStatus: null });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_reset_to_draft");
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("Parent Epic") && message.includes("on hold")), true);
});

Deno.test("runLoadPlanCommand Epic can be put on hold with warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["epic-hold"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-hold"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-hold",
                    path: "plans/epic-hold.md",
                    body: "epic body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "epic",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        planName: "epic-hold/child",
                        path: "plans/epic-hold/child.md",
                        body: "child",
                        attrs: { status: "draft", classification: "PLANNED_CHANGE", summary: "child" },
                    },
                ]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "on_hold", heldFromStatus: "ready_for_work" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(
        messages.some((message) => message.includes("Child Plans will be hidden/blocked")),
        true,
    );
});

Deno.test("runLoadPlanCommand child Planned Change can be put on hold with child-only warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["epic/child-hold"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic/child-hold"] }),
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
                                status: "ready_for_work",
                            },
                        }
                        : {
                            planName: "epic/child-hold",
                            path: "plans/epic/child-hold.md",
                            body: "child body",
                            attrs: {
                                classification: "PLANNED_CHANGE",
                                complexity: "LOW",
                                summary: "child",
                                affectedPaths: [],
                                status: "draft",
                                parentPlan: "epic",
                            },
                        },
                ),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "on_hold", heldFromStatus: "draft" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(messages.some((message) => message.includes("Only this child Planned Change will be held")), true);
});

Deno.test("runLoadPlanCommand on-hold resume warning can keep plan on hold", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("resume", "keep", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-warning"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-warning"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-warning",
                    path: "plans/held-warning.md",
                    body: "body",
                    attrs: {
                        classification: "PLANNED_CHANGE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        status: "on_hold",
                        heldFromStatus: "ready_for_work",
                        holdStalenessBaseline: "2026-01-01T00:00:00.000Z",
                    },
                }),
            listCommitsTouchingPathsSince: () => Promise.resolve([{ hash: "abc1234", subject: "change", author: "A" }]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "ready_for_work" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(recorded, null);
    assertEquals(messages.some((message) => message.includes("Resume Check")), true);
    assertEquals(
        prompts.some((prompt) => prompt.options.some((option) => option.label === "Keep on hold")),
        true,
    );
});

Deno.test("runLoadPlanCommand on-hold resume warning can proceed", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume", "proceed", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-warning-proceed"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-warning-proceed"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-warning-proceed",
                    path: "plans/held-warning-proceed.md",
                    body: "body",
                    attrs: {
                        classification: "PLANNED_CHANGE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        status: "on_hold",
                        heldFromStatus: "ready_for_work",
                        holdStalenessBaseline: "2026-01-01T00:00:00.000Z",
                    },
                }),
            listCommitsTouchingPathsSince: () => Promise.resolve([{ hash: "abc1234", subject: "change", author: "A" }]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "ready_for_work" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_resumed");
});

Deno.test("runLoadPlanCommand failed Resume Check keeps plan on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("resume", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-fail"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-fail"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-fail",
                    path: "plans/held-fail.md",
                    body: "body",
                    attrs: {
                        classification: "PLANNED_CHANGE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "implemented",
                        worktreeId: "missing-worktree",
                        worktreeStatus: "in_progress",
                    },
                }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "implemented" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(recorded, null);
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

    const { uiAPI, selections } = makeUi();
    selections.push("reset", "reset_delete", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["held-delete-worktree"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-delete-worktree"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-delete-worktree",
                    path: "plans/held-delete-worktree.md",
                    body: "body",
                    attrs: {
                        classification: "PLANNED_CHANGE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "implemented",
                        worktreeId: worktree.id,
                        worktreePath: worktree.path,
                        worktreeBranch: worktree.branch,
                    },
                }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: worktree.id,
                    path: worktree.path,
                    branch: worktree.branch,
                    status: "in_progress",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "draft", heldFromStatus: null });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_reset_to_draft");
    // The worktree is really gone from Git, not merely reported as removed.
    assertEquals((await git(projectRoot, ["worktree", "list"])).includes(worktree.path), false);
    // The registry itself records the abandonment, rather than a stand-in recording
    // that it was asked to.
    assertEquals((await findRegistryEntryById(projectRoot, worktree.id))?.status, "abandoned");
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
});
