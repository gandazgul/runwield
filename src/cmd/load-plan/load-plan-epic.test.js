import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";

import { makePlanProject, makeRuntimeContext, makeRuntimeFixture, makeUi } from "./load-plan-test-helpers.js";
import { loadPlan } from "../../plan-store.js";

Deno.test("runLoadPlanCommand draft Epic offers Architect review without Slicer decomposition", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push(null);

    await runLoadPlanCommand(["epic-draft"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-draft",
                    path: "plans/epic-draft.md",
                    body: "## Context\nEpic context",
                    markdown: "## Context\nEpic context",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            resetTuiState: () => {},
        }),
    });

    const epicPrompt = prompts.find((prompt) => prompt.prompt === "What would you like to do with this Epic?");
    assertEquals(epicPrompt?.options.map((option) => option.value), [
        "review",
        "user_verify",
        "hold",
        "view",
        "cancel",
    ]);
    assertEquals(epicPrompt?.options[0].label, "Review with Architect");
});

Deno.test("runLoadPlanCommand ready-for-decomposition Epic offers Slicer first", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("slicer");
    let slicerPlanName = "";
    let executed = false;

    await runLoadPlanCommand(["epic-a"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-a",
                    path: "plans/epic-a.md",
                    body: "## Context\nEpic context",
                    markdown: "## Context\nEpic context",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_decomposition",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: (/** @type {{ planName: string }} */ opts) => {
                slicerPlanName = opts.planName;
                return Promise.resolve({ ok: true });
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    const epicPrompt = prompts.find((prompt) => prompt.prompt === "What would you like to do with this Epic?");
    assertEquals(epicPrompt?.options.map((option) => option.value), [
        "slicer",
        "user_verify",
        "hold",
        "view",
        "cancel",
    ]);
    assertEquals(messages.some((m) => m.includes("no child plans")), true);
    assertEquals(slicerPlanName, "epic-a");
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic with children shows ordered child labels, dependencies, and next shortcut", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push("pick_child", null);

    await runLoadPlanCommand(["epic-b"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-b",
                    path: "plans/epic-b.md",
                    body: "body",
                    markdown: "body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-b/02-second",
                        path: "plans/epic-b/02-second.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Second child",
                            affectedPaths: [],
                            status: "draft",
                            order: 2,
                            dependencies: ["01-first"],
                        },
                    },
                    {
                        name: "epic-b/01-first",
                        path: "plans/epic-b/01-first.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "First child",
                            affectedPaths: [],
                            status: "verified",
                            order: 1,
                        },
                    },
                ]),
            resetTuiState: () => {},
        }),
    });

    assertEquals(prompts[0].options.map((option) => option.value), [
        "pick_child",
        "slicer",
        "done_enough",
        "user_verify",
        "hold",
        "view",
        "cancel",
    ]);
    assertEquals(prompts[1].options[0].value, "__next_child__");
    assertEquals(prompts[1].options[0].label, "Execute next incomplete child Planned Change: 02. Second child [draft]");
    assertEquals(prompts[1].options[1].label, "01. epic-b/01-first [verified] — First child");
    assertEquals(prompts[1].options[2].label, "02. epic-b/02-second [draft] — Second child — deps: 01-first");
    assertEquals(prompts[1].options[2].description?.includes("Dependencies: 01-first"), true);
});

Deno.test("runLoadPlanCommand View Epic details includes child Planned Change labels and statuses", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("view", "cancel");

    await runLoadPlanCommand(["epic-view"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-view",
                    path: "plans/epic-view.md",
                    body: "## Context\nEpic context\n\n## Objective\nEpic objective",
                    markdown: "## Context\nEpic context\n\n## Objective\nEpic objective",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-view/01-first",
                        path: "plans/epic-view/01-first.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "First child",
                            affectedPaths: [],
                            status: "verified",
                        },
                    },
                    {
                        name: "epic-view/02-second",
                        path: "plans/epic-view/02-second.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Second child",
                            affectedPaths: [],
                            status: "ready_for_work",
                        },
                    },
                ]),
            resetTuiState: () => {},
        }),
    });

    const detailMessage = messages.find((message) => message.includes("Child Plans:")) || "";
    assertEquals(
        detailMessage.includes("Progress: 1 RunWield verified / 0 User Verified / 2 child Planned Changes"),
        true,
    );
    assertEquals(detailMessage.includes("epic-view/01-first [verified] — First child"), true);
    assertEquals(detailMessage.includes("epic-view/02-second [ready_for_work] — Second child"), true);
});

Deno.test("runLoadPlanCommand child Planned Change detail inspection resolves and displays details without executing", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("pick_child", "epic-inspect/01-child", "view", "back", null, "cancel");
    /** @type {string[]} */
    const resolved = [];
    let executed = false;

    await runLoadPlanCommand(["epic-inspect"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            /** @param {string} _cwd @param {string} planName */
            resolvePlan: (_cwd, planName) => {
                resolved.push(planName);
                if (planName === "epic-inspect/01-child") {
                    return Promise.resolve({
                        planName,
                        path: "plans/epic-inspect/01-child.md",
                        body: "## Context\nChild context\n\n## Objective\nChild objective",
                        markdown: "## Context\nChild context\n\n## Objective\nChild objective",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Child summary",
                            affectedPaths: [],
                            status: "approved",
                        },
                    });
                }
                return Promise.resolve({
                    planName: "epic-inspect",
                    path: "plans/epic-inspect.md",
                    body: "epic body",
                    markdown: "epic body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                });
            },
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-inspect/01-child",
                        path: "plans/epic-inspect/01-child.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Child summary",
                            affectedPaths: [],
                            status: "approved",
                        },
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    const detailMessage = messages.find((message) => message.includes("Planned Change: epic-inspect/01-child")) || "";
    assertEquals(resolved, ["epic-inspect", "epic-inspect/01-child"]);
    assertEquals(detailMessage.includes("── Context ──\nChild context"), true);
    assertEquals(detailMessage.includes("── Objective ──\nChild objective"), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand child Planned Change submenu back returns without loading", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push("pick_child", "epic-back/01-child", "back", null, "cancel");
    let executed = false;

    await runLoadPlanCommand(["epic-back"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-back",
                    path: "plans/epic-back.md",
                    body: "body",
                    markdown: "body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-back/01-child",
                        path: "plans/epic-back/01-child.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Child summary",
                            affectedPaths: [],
                            status: "approved",
                        },
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(
        prompts.some((prompt) => prompt.prompt === "What would you like to do with this Planned Change?"),
        true,
    );
    assertEquals(prompts.filter((prompt) => prompt.prompt === "Load child Plan:").length, 2);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic done-enough confirm records lifecycle event", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("done_enough", "confirm", "cancel");
    const { projectRoot } = await makePlanProject("epic-done", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "Epic summary",
        affectedPaths: [],
        status: "ready_for_work",
    });

    await runLoadPlanCommand(["epic-done"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-done/01-first",
                        path: "",
                        attrs: { classification: "PLANNED_CHANGE", status: "verified" },
                    },
                    {
                        name: "epic-done/02-second",
                        path: "",
                        attrs: { classification: "PLANNED_CHANGE", status: "draft" },
                    },
                ]),
            resetTuiState: () => {},
        }),
    });

    // The stand-in was handed the summary it then echoed back, so the assertion
    // only proved the test's own arithmetic. The Plan on disk is the real record.
    const epic = await loadPlan(projectRoot, "epic-done");
    assertEquals(epic?.attrs.status, "verified");
    assertEquals(epic?.attrs.epicCompletionMode, "done_enough");
    assertEquals(
        epic?.attrs.epicDoneEnoughSummary,
        "Done enough for now: 1 RunWield verified and 0 User Verified of 2 child Plans, 0 active/implemented, 1 remaining.",
    );
    assertEquals(
        messages.some((message) => message.includes("Unverified child plans remain visible")),
        true,
    );
    assertEquals(messages.some((message) => message.includes("Epic marked done enough")), true);
});

Deno.test("runLoadPlanCommand Epic done-enough auto-generates Work Record only after lifecycle success", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("done_enough", "confirm");
    let generated = false;

    // A real lifecycle write failure rather than a rejected stand-in: the Epic
    // moved to verified underneath the caller, so the transition refuses on its
    // stale precondition. That is the failure this ordering guard exists for.
    const { projectRoot } = await makePlanProject("epic-record-fails", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "Epic summary",
        affectedPaths: [],
        status: "verified",
    });

    let failed = false;
    try {
        await runLoadPlanCommand(["epic-record-fails"], {
            ...makeRuntimeContext({ cwd: projectRoot }),
            uiAPI,
            editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
            __testDeps: /** @type {any} */ ({
                parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
                resolvePlan: () =>
                    Promise.resolve({
                        planName: "epic-record-fails",
                        path: "plans/epic-record-fails.md",
                        body: "body",
                        markdown: "body",
                        attrs: {
                            classification: "PROJECT",
                            complexity: "HIGH",
                            summary: "Epic summary",
                            affectedPaths: [],
                            status: "ready_for_work",
                        },
                    }),
                findPlansByParent: () =>
                    Promise.resolve([
                        {
                            name: "epic-record-fails/01-first",
                            path: "",
                            attrs: { classification: "PLANNED_CHANGE", status: "verified" },
                        },
                    ]),
                autoGenerateWorkRecordForCompletedPlan: () => {
                    generated = true;
                    return Promise.resolve({
                        status: "generated",
                        planName: "epic-record-fails",
                        message: "generated",
                    });
                },
                resetTuiState: () => {},
            }),
        });
    } catch (error) {
        failed = error instanceof Error && error.message.includes("Stale Plan lifecycle precondition");
    }

    assertEquals(failed, true);
    assertEquals(generated, false);
});

Deno.test("runLoadPlanCommand Epic done-enough reports Work Record failure without undoing terminal Epic state", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("done_enough", "confirm", "cancel");
    const { projectRoot } = await makePlanProject("epic-generation-fails", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "Epic summary",
        affectedPaths: [],
        status: "ready_for_work",
    });

    await runLoadPlanCommand(["epic-generation-fails"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-generation-fails/01-first",
                        path: "",
                        attrs: { classification: "PLANNED_CHANGE", status: "verified" },
                    },
                ]),
            autoGenerateWorkRecordForCompletedPlan: () => Promise.reject(new Error("recorder unavailable")),
            resetTuiState: () => {},
        }),
    });

    // "Without undoing" is a claim about what survived on disk, so it has to be
    // read back from disk — the stand-in returned the attrs the test wrote itself.
    const epic = await loadPlan(projectRoot, "epic-generation-fails");
    assertEquals(epic?.attrs.status, "verified");
    assertEquals(epic?.attrs.epicCompletionMode, "done_enough");
    assertEquals(messages.some((message) => message.includes("Epic marked done enough")), true);
    assertEquals(messages.some((message) => message.includes("Work Record generation failed")), true);
    assertEquals(messages.some((message) => message.includes("recorder unavailable")), true);
});

Deno.test("runLoadPlanCommand Epic done-enough can be canceled", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("done_enough", "cancel", "cancel");
    const { projectRoot } = await makePlanProject("epic-cancel", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "Epic summary",
        affectedPaths: [],
        status: "ready_for_work",
    });
    const before = await loadPlan(projectRoot, "epic-cancel");

    await runLoadPlanCommand(["epic-cancel"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-cancel/01-first",
                        path: "",
                        attrs: { classification: "PLANNED_CHANGE", status: "verified" },
                    },
                ]),
            resetTuiState: () => {},
        }),
    });

    const after = await loadPlan(projectRoot, "epic-cancel");
    assertEquals(after?.attrs.status, "ready_for_work");
    assertEquals(after?.revision, before?.revision);
    assertEquals(messages.some((message) => message.includes("canceled")), true);
});

Deno.test("runLoadPlanCommand verified done-enough Epic remains re-enterable", async () => {
    const { uiAPI, selections, prompts, messages } = makeUi();
    selections.push("pick_child", null);

    await runLoadPlanCommand(["epic-verified"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-verified",
                    path: "plans/epic-verified.md",
                    body: "body",
                    markdown: "body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "verified",
                        epicCompletionMode: "done_enough",
                        epicDoneEnoughSummary: "1/2 verified",
                    },
                }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-verified/01-first",
                        path: "",
                        attrs: { classification: "PLANNED_CHANGE", status: "verified" },
                    },
                    {
                        name: "epic-verified/02-second",
                        path: "",
                        attrs: { classification: "PLANNED_CHANGE", status: "draft" },
                    },
                ]),
            resetTuiState: () => {},
        }),
    });

    assertEquals(prompts[0].options.some((option) => option.value === "pick_child"), true);
    assertEquals(prompts[0].options.some((option) => option.value === "done_enough"), false);
    assertEquals(messages.some((message) => message.includes("done enough for now")), true);
});

Deno.test("runLoadPlanCommand verified done-enough Epic shows banner without children", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("cancel");

    await runLoadPlanCommand(["epic-empty-done"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-empty-done",
                    path: "plans/epic-empty-done.md",
                    body: "body",
                    markdown: "body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "verified",
                        epicCompletionMode: "done_enough",
                        epicDoneEnoughSummary: "No active children found.",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("done enough for now")), true);
    assertEquals(messages.some((message) => message.includes("no child plans yet")), true);
});

Deno.test("runLoadPlanCommand Epic child selection can be canceled", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("pick_child", null);
    let executed = false;

    await runLoadPlanCommand(["epic-c"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-c",
                    path: "plans/epic-c.md",
                    body: "body",
                    markdown: "body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-c/01-child",
                        path: "plans/epic-c/01-child.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Child",
                            affectedPaths: [],
                            status: "approved",
                        },
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic child selection delegates to Planned Change load behavior", async () => {
    const { uiAPI, selections } = makeUi();
    const fixture = makeRuntimeFixture();
    selections.push("pick_child", "epic-d/01-child", "load", "proceed");
    /** @type {string[]} */
    const resolved = [];
    let executedPlanName = "";

    await runLoadPlanCommand(["epic-d"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            /** @param {string} _cwd @param {string} planName */
            resolvePlan: (_cwd, planName) => {
                resolved.push(planName);
                if (planName === "epic-d/01-child") {
                    return Promise.resolve({
                        planName,
                        path: "plans/epic-d/01-child.md",
                        body: "child body",
                        markdown: "child body",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Child",
                            affectedPaths: [],
                            status: "ready_for_work",
                        },
                    });
                }
                return Promise.resolve({
                    planName: "epic-d",
                    path: "plans/epic-d.md",
                    body: "epic body",
                    markdown: "epic body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                });
            },
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-d/01-child",
                        path: "plans/epic-d/01-child.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Child",
                            affectedPaths: [],
                            status: "ready_for_work",
                        },
                    },
                ]),
            executePlan: (/** @type {{ planName: string }} */ options) => {
                executedPlanName = options.planName;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(resolved, ["epic-d", "epic-d/01-child"]);
    assertEquals(executedPlanName, "epic-d/01-child");
});

Deno.test("runLoadPlanCommand Epic next shortcut loads first ordered non-verified child", async () => {
    const { uiAPI, selections } = makeUi();
    const fixture = makeRuntimeFixture();
    selections.push("pick_child", "__next_child__", "proceed");
    /** @type {string[]} */
    const resolved = [];
    let executedPlanName = "";

    await runLoadPlanCommand(["epic-next"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            /** @param {string} _cwd @param {string} planName */
            resolvePlan: (_cwd, planName) => {
                resolved.push(planName);
                if (planName === "epic-next/02-second") {
                    return Promise.resolve({
                        planName,
                        path: "plans/epic-next/02-second.md",
                        body: "child body",
                        markdown: "child body",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            complexity: "LOW",
                            summary: "Second child",
                            affectedPaths: [],
                            status: "ready_for_work",
                            parentPlan: "epic-next",
                        },
                    });
                }
                return Promise.resolve({
                    planName: "epic-next",
                    path: "plans/epic-next.md",
                    body: "epic body",
                    markdown: "epic body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                });
            },
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        name: "epic-next/03-closed",
                        path: "plans/epic-next/03-closed.md",
                        attrs: { classification: "PLANNED_CHANGE", status: "closed_without_verification", order: 3 },
                    },
                    {
                        name: "epic-next/02-second",
                        path: "plans/epic-next/02-second.md",
                        attrs: {
                            classification: "PLANNED_CHANGE",
                            status: "ready_for_work",
                            summary: "Second child",
                            order: 2,
                        },
                    },
                    {
                        name: "epic-next/01-first",
                        path: "plans/epic-next/01-first.md",
                        attrs: { classification: "PLANNED_CHANGE", status: "verified", order: 1 },
                    },
                ]),
            executePlan: (/** @type {{ planName: string }} */ options) => {
                executedPlanName = options.planName;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(resolved, ["epic-next", "epic-next/02-second", "epic-next"]);
    assertEquals(executedPlanName, "epic-next/02-second");
});
