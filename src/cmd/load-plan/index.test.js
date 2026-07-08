import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";
import { resolveSiblingChildPlanDependencies, savePlan } from "../../plan-store.js";
import { AGENTS } from "../../constants.js";
import { HostedSession } from "../../shared/session/hosted-session.js";

function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<unknown>} */
    const selections = [];
    /** @type {Array<{ prompt: string, options: Array<{ value: string, label: string, description?: string }>, config?: unknown }>} */
    const prompts = [];

    return {
        messages,
        selections,
        prompts,
        uiAPI: /** @type {import('../../ui/tui/types.js').UiAPI} */ ({
            appendSystemMessage: (msg) => messages.push(String(msg)),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: (prompt, options = [], config) => {
                prompts.push({
                    prompt: String(prompt),
                    options: /** @type {Array<{ value: string, label: string, description?: string }>} */ (options),
                    config,
                });
                return Promise.resolve(selections.shift() ?? null);
            },
            promptText: () => Promise.resolve(null),
            showModelSelector: () => {},
        }),
    };
}

function noOpRecordPlanEvent() {
    return Promise.resolve(/** @type {any} */ ({}));
}

Deno.test("resolveSiblingChildPlanDependencies supports sibling segments and canonical child names", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-i", "epic", {
            classification: "PROJECT",
            complexity: "HIGH",
            summary: "Epic",
            affectedPaths: [],
            status: "ready_for_work",
            type: "epic",
        });
        await savePlan(cwd, "epic-i/01-first", "first", {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "First",
            affectedPaths: [],
            status: "verified",
            parentPlan: "epic-i",
        });
        await savePlan(cwd, "epic-i/02-second", "second", {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Second",
            affectedPaths: [],
            status: "implemented",
            parentPlan: "epic-i",
        });

        const dependencies = await resolveSiblingChildPlanDependencies(cwd, "epic-i", [
            "01-first",
            "epic-i/02-second",
            "03-missing",
        ]);

        assertEquals(
            dependencies.map((dependency) => ({
                dependency: dependency.dependency,
                planName: dependency.planName,
                status: dependency.status,
                state: dependency.state,
            })),
            [
                { dependency: "01-first", planName: "epic-i/01-first", status: "verified", state: "verified" },
                {
                    dependency: "epic-i/02-second",
                    planName: "epic-i/02-second",
                    status: "implemented",
                    state: "unverified",
                },
                { dependency: "03-missing", planName: undefined, status: undefined, state: "missing" },
            ],
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("runLoadPlanCommand prints help", async () => {
    let helped = "";

    await runLoadPlanCommand(["--help"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        __testDeps: /** @type {any} */ ({
            printCommandHelp: (/** @type {string} */ name) => {
                helped = name;
            },
            parseArgs: () => ({ help: true, _: [] }),
        }),
    });

    assertEquals(helped, "load-plan");
});

Deno.test("runLoadPlanCommand no-arg TUI menu excludes child plans and shows top-level summaries", async () => {
    const { uiAPI, selections, prompts, messages } = makeUi();
    const editor = /** @type {import('../../ui/tui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });
    selections.push(null);

    await runLoadPlanCommand([], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () =>
                Promise.resolve([
                    {
                        name: "epic-a/01-child",
                        attrs: {
                            classification: "FEATURE",
                            status: "draft",
                            summary: "Hidden child",
                            parentPlan: "epic-a",
                        },
                    },
                    {
                        name: "epic-a",
                        attrs: {
                            classification: "PROJECT",
                            type: "epic",
                            status: "ready_for_work",
                            summary: "Top Epic summary",
                        },
                    },
                    {
                        name: "standalone",
                        attrs: {
                            classification: "FEATURE",
                            status: "approved",
                            summary: "Standalone summary",
                        },
                    },
                ]),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.length, 0);
    assertEquals(prompts[0].options.map((option) => option.value), ["epic-a", "standalone"]);
    assertEquals(prompts[0].options[0].label, "epic-a — Top Epic summary");
    assertEquals(prompts[0].options[0].description, "PROJECT - ready_for_work");
    assertEquals(
        /** @type {{ layout?: { maxPrimaryColumnWidth?: number } }} */ (prompts[0].config).layout
            ?.maxPrimaryColumnWidth,
        96,
    );
});

Deno.test("runLoadPlanCommand no-arg TUI menu sorts by status then name with on_hold last", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    const editor = /** @type {import('../../ui/tui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });
    selections.push(null);

    await runLoadPlanCommand([], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () =>
                Promise.resolve([
                    { name: "z-draft", attrs: { classification: "FEATURE", status: "draft" } },
                    { name: "b-on-hold", attrs: { classification: "FEATURE", status: "on_hold" } },
                    { name: "b-ready", attrs: { classification: "FEATURE", status: "ready_for_work" } },
                    { name: "a-ready", attrs: { classification: "FEATURE", status: "ready_for_work" } },
                    {
                        name: "c-decompose",
                        attrs: { classification: "PROJECT", type: "epic", status: "ready_for_decomposition" },
                    },
                    { name: "a-implemented", attrs: { classification: "FEATURE", status: "implemented" } },
                    { name: "a-draft", attrs: { classification: "FEATURE", status: "draft" } },
                    { name: "a-on-hold", attrs: { classification: "FEATURE", status: "on_hold" } },
                ]),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(prompts[0].options.map((option) => option.value), [
        "a-ready",
        "b-ready",
        "c-decompose",
        "a-implemented",
        "a-draft",
        "z-draft",
        "a-on-hold",
        "b-on-hold",
    ]);
});

Deno.test("runLoadPlanCommand no-arg TUI reports when only child plans exist", async () => {
    const { uiAPI, messages } = makeUi();
    const editor = /** @type {import('../../ui/tui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    await runLoadPlanCommand([], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () =>
                Promise.resolve([
                    {
                        name: "epic-a/01-child",
                        attrs: { classification: "FEATURE", status: "draft", parentPlan: "epic-a" },
                    },
                ]),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(
        messages.includes("No top-level plans available. Load the parent Epic directly or create a plan."),
        true,
    );
});

Deno.test("runLoadPlanCommand empty plan list in TUI mode", async () => {
    const { uiAPI, messages } = makeUi();
    const editor = /** @type {import('../../ui/tui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    await runLoadPlanCommand([], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () => Promise.resolve([]),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.includes("No plans available, start one by entering a new request"), true);
});

Deno.test("runLoadPlanCommand approved plan proceed path", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-a"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-a"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-a",
                    path: "plans/plan-a.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand Epic with no children opens Slicer", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("slicer");
    let slicerPlanName = "";
    let executed = false;

    await runLoadPlanCommand(["epic-a"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("no child FEATURE plans")), true);
    assertEquals(slicerPlanName, "epic-a");
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic with children shows ordered child labels, dependencies, and next shortcut", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push("pick_child", null);

    await runLoadPlanCommand(["epic-b"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(prompts[0].options.map((option) => option.value), [
        "pick_child",
        "slicer",
        "done_enough",
        "view",
        "hold",
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(recorded.event, "epic_done_enough");
    assertEquals(recorded.currentStatus, "ready_for_work");
    assertEquals(messages.some((message) => message.includes("Unverified child FEATURE plans remain visible")), true);
    assertEquals(messages.some((message) => message.includes("Epic marked done enough")), true);
});

Deno.test("runLoadPlanCommand Epic done-enough can be canceled", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("done_enough", "cancel", "cancel");
    let recorded = false;

    await runLoadPlanCommand(["epic-cancel"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(recorded, false);
    assertEquals(messages.some((message) => message.includes("canceled")), true);
});

Deno.test("runLoadPlanCommand verified done-enough Epic remains re-enterable", async () => {
    const { uiAPI, selections, prompts, messages } = makeUi();
    selections.push("pick_child", null);

    await runLoadPlanCommand(["epic-verified"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
                        complexity: "HIGH",
                        summary: "Epic summary",
                        affectedPaths: [],
                        status: "verified",
                        epicCompletionMode: "done_enough",
                        epicDoneEnoughSummary: "No active children found.",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic child selection delegates to FEATURE load behavior", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("pick_child", "epic-d/01-child", "load", "proceed");
    /** @type {string[]} */
    const resolved = [];
    let executedPlanName = "";

    await runLoadPlanCommand(["epic-d"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            executePlan: (/** @type {string} */ planName) => {
                executedPlanName = planName;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(resolved, ["epic-d", "epic-d/01-child"]);
    assertEquals(executedPlanName, "epic-d/01-child");
});

Deno.test("runLoadPlanCommand Epic next shortcut loads first ordered non-verified child", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("pick_child", "__next_child__", "proceed");
    /** @type {string[]} */
    const resolved = [];
    let executedPlanName = "";

    await runLoadPlanCommand(["epic-next"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
            executePlan: (/** @type {string} */ planName) => {
                executedPlanName = planName;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(resolved, ["epic-next", "epic-next/02-second", "epic-next"]);
    assertEquals(executedPlanName, "epic-next/02-second");
});

Deno.test("runLoadPlanCommand child FEATURE with verified dependencies executes without warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-e/02-second"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-e/02-second",
                    path: "plans/epic-e/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-e",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-e/01-first",
                        status: "verified",
                        state: "verified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("dependencies that are not verified")), false);
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child FEATURE warns for unverified dependencies and can proceed", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-f/02-second"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-f/02-second",
                    path: "plans/epic-f/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-f",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-f/01-first",
                        status: "implemented",
                        state: "unverified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("epic-f/01-first: implemented")), true);
    assertEquals(prompts[0].prompt, 'Proceed with "epic-f/02-second" anyway?');
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child FEATURE warns for missing dependencies", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-g/02-second"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-g/02-second",
                    path: "plans/epic-g/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-g",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        state: "missing",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("01-first: missing")), true);
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child FEATURE dependency warning can be canceled", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("cancel");
    let executed = false;

    await runLoadPlanCommand(["epic-h/02-second"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-h/02-second",
                    path: "plans/epic-h/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-h",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-h/01-first",
                        status: "ready_for_work",
                        state: "unverified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.includes("Plan load canceled."), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand warns and cancels execution when affected paths changed since updatedAt", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed", "cancel");
    let executed = false;
    /** @type {string | undefined} */
    let checkedTimestamp;
    /** @type {string[] | undefined} */
    let checkedPaths;

    await runLoadPlanCommand(["plan-stale"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-stale"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-stale",
                    path: "plans/plan-stale.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-02T00:00:00.000Z",
                        status: "ready_for_work",
                    },
                }),
            listCommitsTouchingPathsSince: (
                /** @type {string} */ _cwd,
                /** @type {string} */ since,
                /** @type {string[]} */ paths,
            ) => {
                checkedTimestamp = since;
                checkedPaths = paths;
                return Promise.resolve([
                    {
                        hash: "abc1234",
                        date: "2026-01-03T00:00:00-05:00",
                        subject: "change affected file",
                    },
                ]);
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(checkedTimestamp, "2026-01-02T00:00:00.000Z");
    assertEquals(checkedPaths, ["src/a.js"]);
    assertEquals(messages.some((m) => m.includes("change affected file")), true);
    assertEquals(messages.some((m) => m.includes("src/a.js")), true);
    assertEquals(messages.some((m) => m.includes("Execution canceled.")), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand proceeds after affected path warning confirmation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;
    /** @type {string | undefined} */
    let checkedTimestamp;

    await runLoadPlanCommand(["plan-stale-confirmed"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-stale-confirmed"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-stale-confirmed",
                    path: "plans/plan-stale-confirmed.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        status: "ready_for_work",
                    },
                }),
            listCommitsTouchingPathsSince: (
                /** @type {string} */ _cwd,
                /** @type {string} */ since,
                /** @type {string[]} */ _paths,
            ) => {
                checkedTimestamp = since;
                return Promise.resolve([
                    {
                        hash: "def5678",
                        date: "2026-01-03T00:00:00-05:00",
                        subject: "change affected file",
                    },
                ]);
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(checkedTimestamp, "2026-01-01T00:00:00.000Z");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand validates completed execution against freshly loaded plan content", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    /** @type {string | undefined} */
    let validatedPlanContent;

    await runLoadPlanCommand(["plan-fresh"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-fresh"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-fresh",
                    path: "plans/plan-fresh.md",
                    body: "stale body",
                    markdown: "stale markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            executePlan: () => Promise.resolve({ repairRequired: false, executionComplete: true }),
            loadPlan: () => Promise.resolve({ markdown: "fresh markdown", body: "fresh body", attrs: {} }),
            runValidationLoop: (/** @type {{ planContent: string }} */ args) => {
                validatedPlanContent = args.planContent;
                return Promise.resolve();
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(validatedPlanContent, "fresh markdown");
});

Deno.test("runLoadPlanCommand non-approved plan kicks off planning agent", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    let lifecycleCalled = false;

    await runLoadPlanCommand(["plan-b"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-b"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-b",
                    path: "plans/plan-b.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-b" });
            },
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
        }),
    });

    assertEquals(lifecycleCalled, true);
});

Deno.test("runLoadPlanCommand approved plan view then cancel", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("view", null);

    await runLoadPlanCommand(["plan-c"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-c"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-c",
                    path: "plans/plan-c.md",
                    body: "## Context\nThe quick brown fox.\n\n## Objective\nJump over.\n",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                        worktreeBaseBranch: "feature-base",
                    },
                }),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("Target branch:  feature-base")), true);
    assertEquals(messages.some((m) => m.includes("The quick brown fox")), true);
    assertEquals(messages.some((m) => m.includes("Jump over")), true);
    assertEquals(messages.some((m) => m.includes("Load canceled")), false);
});

Deno.test("runLoadPlanCommand approved review approves directly via submitPlanForReview", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let submitCalled = false;
    let executed = false;

    await runLoadPlanCommand(["plan-d"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-d"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-d",
                    path: "plans/plan-d.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => {
                submitCalled = true;
                return Promise.resolve({ approved: true });
            },
            askPostApproval: () => Promise.resolve("save"),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(submitCalled, true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand approved PROJECT review runs slicer before proceed", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let sliced = false;
    let askedWithTasks = false;
    let executed = false;
    let validated = false;

    await runLoadPlanCommand(["plan-project-review"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-project-review",
                    path: "plans/plan-project-review.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            ensureSlicerTasks: () => {
                sliced = true;
                return Promise.resolve({ ok: true, slicerInvoked: true });
            },
            askApprovalWithTasks: () => {
                askedWithTasks = true;
                return Promise.resolve("proceed");
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            runValidationLoop: () => {
                validated = true;
                return Promise.resolve();
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(sliced, true);
    assertEquals(askedWithTasks, true);
    assertEquals(executed, true);
    assertEquals(validated, true);
});

Deno.test("runLoadPlanCommand approved PROJECT Epic opens Slicer without executing", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("slicer");
    let slicerOpened = false;
    /** @type {any} */
    let slicerArgs = null;
    let askedWithTasks = false;
    let executed = false;
    /** @type {Array<{ event: string, currentStatus: string }>} */
    const events = [];

    await runLoadPlanCommand(["epic-review"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-review",
                    path: "plans/epic-review.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        type: "epic",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: (/** @type {any} */ args) => {
                slicerOpened = true;
                slicerArgs = args;
                return Promise.resolve({ ok: true });
            },
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            ensureSlicerTasks: () => {
                throw new Error("Legacy task slicer should not run for Epics");
            },
            askApprovalWithTasks: () => {
                askedWithTasks = true;
                return Promise.resolve("proceed");
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: (/** @type {{ event: string, currentStatus: string }} */ args) => {
                events.push({ event: args.event, currentStatus: args.currentStatus });
                return Promise.resolve(/** @type {any} */ ({}));
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(slicerOpened, true);
    assertEquals(slicerArgs.planName, "epic-review");
    assertEquals(slicerArgs.triageMeta.type, "epic");
    assertEquals(askedWithTasks, false);
    assertEquals(executed, false);
    assertEquals(events, []);
    assertEquals(messages.some((message) => message.includes("not executable")), true);
});

Deno.test("runLoadPlanCommand ready_for_decomposition PROJECT Epic does not execute", async () => {
    const { uiAPI, messages } = makeUi();
    let executed = false;

    await runLoadPlanCommand(["epic-ready"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-ready"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-ready",
                    path: "plans/epic-ready.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        type: "epic",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_decomposition",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, false);
    assertEquals(messages.some((message) => message.includes("no child FEATURE plans")), true);
});

Deno.test("runLoadPlanCommand approved review proceed keeps plan owner without transient operator switch", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-project-review"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-project-review",
                    path: "plans/plan-project-review.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            ensureSlicerTasks: () => Promise.resolve({ ok: true, slicerInvoked: true }),
            askApprovalWithTasks: () => Promise.resolve("proceed"),
            executePlan: () => Promise.resolve({ repairRequired: false, executionComplete: true }),
            runValidationLoop: () => Promise.resolve(),
            recordPlanEvent: noOpRecordPlanEvent,
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, [AGENTS.ARCHITECT, AGENTS.ARCHITECT]);
});

Deno.test("runLoadPlanCommand approved review kicks off planner on denial", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;

    await runLoadPlanCommand(["plan-d2"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-d2"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-d2",
                    path: "plans/plan-d2.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => Promise.resolve({ approved: false, feedback: "missing tests" }),
            runPlanningAgent: () => {
                plannerCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-d2" });
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(plannerCalled, true);
});

Deno.test("runLoadPlanCommand approved proceed with repair reroutes to planner", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let plannerCalled = false;
    let repairRequest = "";

    await runLoadPlanCommand(["plan-e"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-e"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-e",
                    path: "plans/plan-e.md",
                    body: "body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            ensureSlicerTasks: () => Promise.resolve({ ok: true, slicerInvoked: false }),
            executePlan: () => Promise.resolve({ repairRequired: true, error: "bad tasks" }),
            recordPlanEvent: noOpRecordPlanEvent,
            runPlanningAgent: (/** @type {{ initialRequest: string }} */ opts) => {
                plannerCalled = true;
                repairRequest = opts.initialRequest;
                return Promise.resolve({ outcome: "executed", planName: "plan-e" });
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(plannerCalled, true);
    assertEquals(repairRequest.includes("| Task | Assignee | Dependencies | Write Scope | Description |"), true);
    assertEquals(repairRequest.includes("corrected tasks array"), false);
    assertEquals(
        messages.some((m) =>
            m.includes("Rerouting to architect for repair") || m.includes("Rerouting to planner for repair")
        ),
        true,
    );
});

Deno.test("runLoadPlanCommand ready_for_work plan proceed path executes", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-ready-exec"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-ready-exec"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-ready-exec",
                    path: "plans/plan-ready-exec.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand in_progress plan can continue from current worktree", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("continue");
    let executed = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-progress"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(lifecycleEvent, "recovery_continue");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand failed plan can reset baseline and start over", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "reset");
    let restoredTree = "";
    let executed = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-failed"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("Failure reason:\ninterrupted")), true);
    assertEquals(messages.some((m) => m.includes("diff for baseline-tree")), true);
});

Deno.test("runLoadPlanCommand implemented plan retries validation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("validate");
    let validated = false;
    /** @type {unknown} */
    let workflowDuringValidation = null;
    const hostedSession = new HostedSession({ id: "load-plan-validation" });
    const otherHostedSession = new HostedSession({ id: "load-plan-other" });
    otherHostedSession.setActiveExecutionWorkflow({ planName: "other", triageMeta: {}, baselineTree: "other-tree" });

    await runLoadPlanCommand(["plan-implemented"], {
        uiAPI,
        hostedSession,
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
            runValidationLoop: (
                /** @type {{ hostedSession: HostedSession }} */ { hostedSession: validationHostedSession },
            ) => {
                validated = true;
                workflowDuringValidation = validationHostedSession.getActiveExecutionWorkflow();
                validationHostedSession.clearActiveExecutionWorkflow();
                return Promise.resolve();
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(validated, true);
    assertEquals(workflowDuringValidation, {
        planName: "plan-implemented",
        triageMeta: {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "s",
            affectedPaths: [],
            status: "implemented",
            failureReason: "CI failed",
            executionBaselineTree: "baseline-tree",
        },
        baselineTree: "baseline-tree",
    });
    assertEquals(otherHostedSession.getActiveExecutionWorkflow(), {
        planName: "other",
        triageMeta: {},
        baselineTree: "other-tree",
    });
});

Deno.test("runLoadPlanCommand only offers manual merge for merge-conflict worktree recovery", async () => {
    for (const worktreeStatus of ["completed", "validation_failed", "merge_conflict"]) {
        const { uiAPI, selections, prompts } = makeUi();
        selections.push("cancel");

        await runLoadPlanCommand([`plan-${worktreeStatus}`], {
            hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                            worktreeStatus,
                        },
                    }),
                findWorktreeById: () => Promise.resolve(null),
                findWorktreeByPlanName: () => Promise.resolve(null),
                createAgentHandler: () => async () => {},
                resetTuiState: () => {},
                setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(mergeCalled, false);
    assertEquals(events.includes("validation_passed"), false);
    assertEquals(messages.some((message) => message.includes("Retry Workflow Validation first")), true);
});

Deno.test("runLoadPlanCommand can manually merge merge-conflict worktree recovery", async () => {
    const worktreePath = await Deno.makeTempDir({ prefix: "runwield-load-plan-merge-" });
    try {
        const { uiAPI, selections } = makeUi();
        selections.push("merge");
        let mergedBranch = "";
        let mergedTargetBranch = "";
        let removedPath = "";
        let removedRegistryId = "";
        let registryStatus = "";
        let mergedPlanName = "";
        let mergedPlanDescription = "";
        /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
        let persistedUpdates = {};
        /** @type {string | null} */
        let lifecycleEvent = null;

        await runLoadPlanCommand(["plan-merge-conflict"], {
            hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                mergeExecutionWorktree: (
                    /** @type {{ branch: string, targetBranch?: string, planName?: string, planDescription?: string }} */ args,
                ) => {
                    mergedBranch = args.branch;
                    mergedTargetBranch = args.targetBranch || "";
                    mergedPlanName = args.planName || "";
                    mergedPlanDescription = args.planDescription || "";
                    return Promise.resolve();
                },
                removeExecutionWorktree: (/** @type {{ path: string }} */ args) => {
                    removedPath = args.path;
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
                    return Promise.resolve(/** @type {any} */ ({}));
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
                createAgentHandler: () => async () => {},
                resetTuiState: () => {},
                setActiveAgent: () => {},
            }),
        });

        assertEquals(persistedUpdates.worktreeBaseBranch, "feature-base");
        assertEquals(mergedBranch, "runwield/worktree/plan-merge-conflict");
        assertEquals(mergedTargetBranch, "feature-base");
        assertEquals(mergedPlanName, "plan-merge-conflict");
        assertEquals(mergedPlanDescription, "Resolve a manual merge conflict.");
        assertEquals(removedPath, worktreePath);
        assertEquals(removedRegistryId, "wt1");
        assertEquals(registryStatus, "merged");
        assertEquals(lifecycleEvent, "validation_passed");
    } finally {
        await Deno.remove(worktreePath, { recursive: true });
    }
});

Deno.test("runLoadPlanCommand records recovery metric when manual merge fails", async () => {
    const worktreePath = await Deno.makeTempDir({ prefix: "runwield-load-plan-merge-fail-" });
    try {
        const { uiAPI, selections } = makeUi();
        selections.push("merge");
        /** @type {any[]} */
        const metrics = [];

        await runLoadPlanCommand(["plan-merge-conflict-fail"], {
            hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                createAgentHandler: () => async () => {},
                resetTuiState: () => {},
                setActiveAgent: () => {},
            }),
        });

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

Deno.test("runLoadPlanCommand verified plan review path records review_reopened", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review", "resume");
    let lifecycleCalled = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-verified-review"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-verified-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-verified-review",
                    path: "plans/plan-verified-review.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "verified",
                    },
                }),
            recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                lifecycleEvent = args.event;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-verified-review" });
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(lifecycleEvent, "review_reopened");
    assertEquals(lifecycleCalled, true);
});

Deno.test("runLoadPlanCommand verified plan cancel returns without changes", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("cancel");
    let executed = false;
    let lifecycleCalled = false;
    let lifecycleEvents = 0;

    await runLoadPlanCommand(["plan-verified-cancel"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-verified-cancel"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-verified-cancel",
                    path: "plans/plan-verified-cancel.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "verified",
                    },
                }),
            recordPlanEvent: () => {
                lifecycleEvents += 1;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved" });
            },
            createAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(lifecycleEvents, 0);
    assertEquals(executed, false);
    assertEquals(lifecycleCalled, false);
});

Deno.test("runLoadPlanCommand starts interactive session when ui missing", async () => {
    let started = false;
    await runLoadPlanCommand(["plan-f"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-f"] }),
            startInteractiveSession: () => {
                started = true;
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(started, true);
});

Deno.test("runLoadPlanCommand keeps planner active when lifecycle canceled", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-h"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-h"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-h",
                    path: "plans/plan-h.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "canceled" }),
            createAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                activeAgents.push(name);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(activeAgents.includes(AGENTS.PLANNER), true);
    assertEquals(activeAgents.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand keeps planner active when agent ends without plan_written", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-i"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-i"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-i",
                    path: "plans/plan-i.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "no_call" }),
            createAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
            resetTuiState: () => {},
        }),
    });

    assertEquals(activeAgents.includes(AGENTS.PLANNER), true);
    assertEquals(activeAgents.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand keeps planner active after lifecycle saves a plan from router flow", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    /** @type {string[]} */
    const restoredAgents = [];

    await runLoadPlanCommand(["plan-g"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-g"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-g",
                    path: "plans/plan-g.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "saved", planName: "plan-g" }),
            createAgentHandler: () => async () => {},
            setActiveAgent: (
                /** @type {string} */ name,
                /** @type {unknown} */ _handler,
                /** @type {any} */ actualUiAPI,
            ) => {
                restoredAgents.push(name);
                assertEquals(actualUiAPI, uiAPI);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(restoredAgents.includes(AGENTS.PLANNER), true);
    assertEquals(restoredAgents.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand restores the initially active agent after lifecycle saves a plan", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const restoredAgents = [];

    await runLoadPlanCommand(["plan-j"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-j"] }),
            getRootAgentName: () => AGENTS.IDEATOR,
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-j",
                    path: "plans/plan-j.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "saved", planName: "plan-j" }),
            createAgentHandler: () => async () => {},
            setActiveAgent: (
                /** @type {string} */ name,
                /** @type {unknown} */ _handler,
                /** @type {any} */ actualUiAPI,
            ) => {
                restoredAgents.push(name);
                assertEquals(actualUiAPI, uiAPI);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(restoredAgents.includes(AGENTS.IDEATOR), true);
    assertEquals(restoredAgents.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand draft FEATURE can be put on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold");
    let recorded = null;

    await runLoadPlanCommand(["hold-me"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        classification: "FEATURE",
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
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        classification: "FEATURE",
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
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        classification: "FEATURE",
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
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_reset_to_draft");
});

Deno.test("runLoadPlanCommand blocks child FEATURE when parent Epic is on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("cancel");

    await runLoadPlanCommand(["epic/child"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                                type: "epic",
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
                                classification: "FEATURE",
                                complexity: "LOW",
                                summary: "child",
                                affectedPaths: [],
                                status: "ready_for_work",
                                parentPlan: "epic",
                            },
                        },
                ),
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        type: "epic",
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
                        attrs: { status: "draft", classification: "FEATURE", summary: "child" },
                    },
                ]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "on_hold", heldFromStatus: "ready_for_work" });
            },
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(messages.some((message) => message.includes("Child FEATURE Plans will be hidden/blocked")), true);
});

Deno.test("runLoadPlanCommand child FEATURE can be put on hold with child-only warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["epic/child-hold"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                                type: "epic",
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
                                classification: "FEATURE",
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
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(messages.some((message) => message.includes("Only this child FEATURE will be held")), true);
});

Deno.test("runLoadPlanCommand on-hold resume warning can keep plan on hold", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("resume", "keep", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-warning"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        classification: "FEATURE",
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
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        classification: "FEATURE",
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
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
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
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        classification: "FEATURE",
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
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
        }),
    });

    assertEquals(recorded, null);
    assertEquals(messages.some((message) => message.includes("Resume Check failed")), true);
});

Deno.test("runLoadPlanCommand on-hold reset can delete recorded worktree", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "reset_delete", "confirm");
    let recorded = null;
    let removed = null;
    let registryUpdate = null;

    await runLoadPlanCommand(["held-delete-worktree"], {
        hostedSession: new HostedSession({ id: "load-plan-test" }),
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
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "implemented",
                        worktreeId: "wt-1",
                        worktreePath: "/tmp/wt-1",
                        worktreeBranch: "runwield/worktree/held-delete-worktree-12345678",
                    },
                }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-1",
                    path: "/tmp/wt-1",
                    branch: "runwield/worktree/held-delete-worktree-12345678",
                    status: "in_progress",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            removeExecutionWorktree: (/** @type {any} */ args) => {
                removed = args;
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _cwd,
                /** @type {string} */ id,
                /** @type {any} */ patch,
            ) => {
                registryUpdate = { id, patch };
                return Promise.resolve({ id, ...patch });
            },
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "draft", heldFromStatus: null });
            },
            createAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_reset_to_draft");
    assertEquals(/** @type {any} */ (removed).force, true);
    assertEquals(/** @type {any} */ (registryUpdate).patch.status, "abandoned");
});
