import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";

import { makeRuntimeContext, makeRuntimeFixture, makeUi } from "./load-plan-test-helpers.js";

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
    assertEquals(epicPrompt?.options.map((option) => option.value), ["review", "hold", "view", "cancel"]);
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
    assertEquals(epicPrompt?.options.map((option) => option.value), ["slicer", "hold", "view", "cancel"]);
    assertEquals(messages.some((m) => m.includes("no child FEATURE plans")), true);
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
                            classification: "FEATURE",
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
                            classification: "FEATURE",
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
        "hold",
        "view",
        "cancel",
    ]);
    assertEquals(prompts[1].options[0].value, "__next_child__");
    assertEquals(prompts[1].options[0].label, "Execute next non-verified child FEATURE: 02. Second child [draft]");
    assertEquals(prompts[1].options[1].label, "01. epic-b/01-first [verified] — First child");
    assertEquals(prompts[1].options[2].label, "02. epic-b/02-second [draft] — Second child — deps: 01-first");
    assertEquals(prompts[1].options[2].description?.includes("Dependencies: 01-first"), true);
});

Deno.test("runLoadPlanCommand View Epic details includes child FEATURE labels and statuses", async () => {
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
                            classification: "FEATURE",
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
                            classification: "FEATURE",
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

    const detailMessage = messages.find((message) => message.includes("Child FEATURE plans:")) || "";
    assertEquals(detailMessage.includes("Progress: 1/2 child FEATUREs verified"), true);
    assertEquals(detailMessage.includes("epic-view/01-first [verified] — First child"), true);
    assertEquals(detailMessage.includes("epic-view/02-second [ready_for_work] — Second child"), true);
});

Deno.test("runLoadPlanCommand child FEATURE detail inspection resolves and displays details without executing", async () => {
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
                            classification: "FEATURE",
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
                            classification: "FEATURE",
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

    const detailMessage = messages.find((message) => message.includes("FEATURE: epic-inspect/01-child")) || "";
    assertEquals(resolved, ["epic-inspect", "epic-inspect/01-child"]);
    assertEquals(detailMessage.includes("── Context ──\nChild context"), true);
    assertEquals(detailMessage.includes("── Objective ──\nChild objective"), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand child FEATURE submenu back returns without loading", async () => {
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
                            classification: "FEATURE",
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

    assertEquals(prompts.some((prompt) => prompt.prompt === "What would you like to do with this FEATURE?"), true);
    assertEquals(prompts.filter((prompt) => prompt.prompt === "Load child FEATURE plan:").length, 2);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic done-enough confirm records lifecycle event", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("done_enough", "confirm", "cancel");
    /** @type {any} */
    let recorded = null;

    await runLoadPlanCommand(["epic-done"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-done",
                    path: "plans/epic-done.md",
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
                    { name: "epic-done/01-first", path: "", attrs: { classification: "FEATURE", status: "verified" } },
                    { name: "epic-done/02-second", path: "", attrs: { classification: "FEATURE", status: "draft" } },
                ]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({
                    status: "verified",
                    epicCompletionMode: "done_enough",
                    epicDoneEnoughSummary: args.details.epicDoneEnoughSummary,
                });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(recorded.event, "epic_done_enough");
    assertEquals(recorded.currentStatus, "ready_for_work");
    assertEquals(messages.some((message) => message.includes("Unverified child FEATURE plans remain visible")), true);
    assertEquals(messages.some((message) => message.includes("Epic marked done enough")), true);
});

Deno.test("runLoadPlanCommand Epic done-enough auto-generates Work Record only after lifecycle success", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("done_enough", "confirm");
    let generated = false;

    let failed = false;
    try {
        await runLoadPlanCommand(["epic-record-fails"], {
            ...makeRuntimeContext(),
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
                            attrs: { classification: "FEATURE", status: "verified" },
                        },
                    ]),
                recordPlanEvent: () => Promise.reject(new Error("lifecycle write failed")),
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
        failed = error instanceof Error && error.message.includes("lifecycle write failed");
    }

    assertEquals(failed, true);
    assertEquals(generated, false);
});

Deno.test("runLoadPlanCommand Epic done-enough reports Work Record failure without undoing terminal Epic state", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("done_enough", "confirm", "cancel");
    /** @type {any} */
    let updatedAttrs = null;

    await runLoadPlanCommand(["epic-generation-fails"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-generation-fails",
                    path: "plans/epic-generation-fails.md",
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
                        name: "epic-generation-fails/01-first",
                        path: "",
                        attrs: { classification: "FEATURE", status: "verified" },
                    },
                ]),
            recordPlanEvent: () => {
                updatedAttrs = {
                    status: "verified",
                    epicCompletionMode: "done_enough",
                    epicDoneEnoughSummary: "1/1 child FEATURE plans are verified.",
                };
                return Promise.resolve(updatedAttrs);
            },
            autoGenerateWorkRecordForCompletedPlan: () => Promise.reject(new Error("recorder unavailable")),
            resetTuiState: () => {},
        }),
    });

    assertEquals(updatedAttrs.status, "verified");
    assertEquals(updatedAttrs.epicCompletionMode, "done_enough");
    assertEquals(messages.some((message) => message.includes("Epic marked done enough")), true);
    assertEquals(messages.some((message) => message.includes("Work Record generation failed")), true);
    assertEquals(messages.some((message) => message.includes("recorder unavailable")), true);
});

Deno.test("runLoadPlanCommand Epic done-enough can be canceled", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("done_enough", "cancel", "cancel");
    let recorded = false;

    await runLoadPlanCommand(["epic-cancel"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-cancel",
                    path: "plans/epic-cancel.md",
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
                        name: "epic-cancel/01-first",
                        path: "",
                        attrs: { classification: "FEATURE", status: "verified" },
                    },
                ]),
            recordPlanEvent: () => {
                recorded = true;
                return Promise.resolve({});
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(recorded, false);
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
                        attrs: { classification: "FEATURE", status: "verified" },
                    },
                    {
                        name: "epic-verified/02-second",
                        path: "",
                        attrs: { classification: "FEATURE", status: "draft" },
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
    assertEquals(messages.some((message) => message.includes("no child FEATURE plans yet")), true);
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
                            classification: "FEATURE",
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

Deno.test("runLoadPlanCommand Epic child selection delegates to FEATURE load behavior", async () => {
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
                            classification: "FEATURE",
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
                            classification: "FEATURE",
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
                            classification: "FEATURE",
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
                        attrs: { classification: "FEATURE", status: "closed_without_verification", order: 3 },
                    },
                    {
                        name: "epic-next/02-second",
                        path: "plans/epic-next/02-second.md",
                        attrs: {
                            classification: "FEATURE",
                            status: "ready_for_work",
                            summary: "Second child",
                            order: 2,
                        },
                    },
                    {
                        name: "epic-next/01-first",
                        path: "plans/epic-next/01-first.md",
                        attrs: { classification: "FEATURE", status: "verified", order: 1 },
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
