import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";
import { resolveSiblingChildPlanDependencies, savePlan } from "../../plan-store.js";

import { makeRuntimeContext, makeUi } from "./load-plan-test-helpers.js";

Deno.test("resolveSiblingChildPlanDependencies supports sibling segments and canonical child names", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-i", "epic", {
            classification: "PROJECT",
            complexity: "HIGH",
            summary: "Epic",
            affectedPaths: [],
            status: "ready_for_work",
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
        ...makeRuntimeContext(),
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
        ...makeRuntimeContext(),
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

Deno.test("runLoadPlanCommand no-arg TUI menu preserves core plan order", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    const editor = /** @type {import('../../ui/tui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });
    selections.push(null);

    await runLoadPlanCommand([], {
        ...makeRuntimeContext(),
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () =>
                Promise.resolve([
                    { name: "a-failed-project", attrs: { classification: "PROJECT", status: "failed" } },
                    { name: "z-failed-feature", attrs: { classification: "FEATURE", status: "failed" } },
                    { name: "a-implemented", attrs: { classification: "FEATURE", status: "implemented" } },
                    { name: "a-ready", attrs: { classification: "PROJECT", status: "ready_for_work" } },
                    { name: "b-ready", attrs: { classification: "FEATURE", status: "ready_for_work" } },
                    {
                        name: "c-decompose",
                        attrs: { classification: "PROJECT", status: "ready_for_decomposition" },
                    },
                    { name: "a-draft", attrs: { classification: "FEATURE", status: "draft" } },
                    { name: "z-draft", attrs: { classification: "FEATURE", status: "draft" } },
                    { name: "a-verified", attrs: { classification: "FEATURE", status: "verified" } },
                    { name: "a-closed", attrs: { classification: "FEATURE", status: "closed_without_verification" } },
                    { name: "a-on-hold", attrs: { classification: "FEATURE", status: "on_hold" } },
                    { name: "b-on-hold", attrs: { classification: "FEATURE", status: "on_hold" } },
                ]),
            resetTuiState: () => {},
        }),
    });

    assertEquals(prompts[0].options.map((option) => option.value), [
        "a-failed-project",
        "z-failed-feature",
        "a-implemented",
        "a-ready",
        "b-ready",
        "c-decompose",
        "a-draft",
        "z-draft",
        "a-verified",
        "a-closed",
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
        ...makeRuntimeContext(),
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
        ...makeRuntimeContext(),
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () => Promise.resolve([]),
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.includes("No plans available, start one by entering a new request"), true);
});
