import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";
import { resolveSiblingChildPlanDependencies, savePlan } from "../../plan-store.js";
import { AGENTS } from "../../constants.js";
import { clearActiveExecutionWorkflow, getActiveExecutionWorkflow } from "../../shared/session/session-state.js";

function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<unknown>} */
    const selections = [];
    /** @type {Array<{ prompt: string, options: Array<{ value: string, label: string }> }>} */
    const prompts = [];

    return {
        messages,
        selections,
        prompts,
        uiAPI: /** @type {import('../../shared/ui/types.js').UiAPI} */ ({
            appendSystemMessage: (msg) => messages.push(String(msg)),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: (prompt, options = []) => {
                prompts.push({
                    prompt: String(prompt),
                    options: /** @type {Array<{ value: string, label: string }>} */ (options),
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
        __testDeps: /** @type {any} */ ({
            printCommandHelp: (/** @type {string} */ name) => {
                helped = name;
            },
            parseArgs: () => ({ help: true, _: [] }),
        }),
    });

    assertEquals(helped, "load-plan");
});

Deno.test("runLoadPlanCommand empty plan list in TUI mode", async () => {
    const { uiAPI, messages } = makeUi();
    const editor = /** @type {import('../../shared/ui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    await runLoadPlanCommand([], {
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
            createDirectAgentHandler: () => () => Promise.resolve(),
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
            createDirectAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("no child FEATURE plans")), true);
    assertEquals(slicerPlanName, "epic-a");
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic with children shows child FEATURE labels", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push("pick_child", null);

    await runLoadPlanCommand(["epic-b"], {
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
                        name: "epic-b/01-first",
                        path: "plans/epic-b/01-first.md",
                        attrs: {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "First child",
                            affectedPaths: [],
                            status: "approved",
                        },
                    },
                    {
                        name: "epic-b/02-second",
                        path: "plans/epic-b/02-second.md",
                        attrs: {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "Second child",
                            affectedPaths: [],
                            status: "draft",
                        },
                    },
                ]),
            createDirectAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(prompts[0].options.some((option) => option.value === "pick_child"), true);
    assertEquals(prompts[1].options[0].label, "epic-b/01-first [approved] — First child");
    assertEquals(prompts[1].options[1].label, "epic-b/02-second [draft] — Second child");
});

Deno.test("runLoadPlanCommand Epic child selection can be canceled", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("pick_child", null);
    let executed = false;

    await runLoadPlanCommand(["epic-c"], {
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
            createDirectAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand Epic child selection delegates to FEATURE load behavior", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("pick_child", "epic-d/01-child", "proceed");
    /** @type {string[]} */
    const resolved = [];
    let executedPlanName = "";

    await runLoadPlanCommand(["epic-d"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: (/** @type {string} */ _cwd, /** @type {string} */ planName) => {
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
            createDirectAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(resolved, ["epic-d", "epic-d/01-child"]);
    assertEquals(executedPlanName, "epic-d/01-child");
});

Deno.test("runLoadPlanCommand child FEATURE with verified dependencies executes without warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-e/02-second"], {
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
            createDirectAgentHandler: () => () => Promise.resolve(),
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
            createDirectAgentHandler: () => () => Promise.resolve(),
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
            createDirectAgentHandler: () => () => Promise.resolve(),
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
            createDirectAgentHandler: () => () => Promise.resolve(),
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
            createDirectAgentHandler: () => () => Promise.resolve(),
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
            createDirectAgentHandler: () => () => Promise.resolve(),
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
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(validatedPlanContent, "fresh markdown");
});

Deno.test("runLoadPlanCommand non-approved plan kicks off planning agent", async () => {
    const { uiAPI } = makeUi();
    let lifecycleCalled = false;

    await runLoadPlanCommand(["plan-b"], {
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
            createDirectAgentHandler: () => async () => {},
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
                    },
                }),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, false);
    assertEquals(messages.some((message) => message.includes("no child FEATURE plans")), true);
});

Deno.test("runLoadPlanCommand approved review proceed restores initial agent without transient operator switch", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-project-review"], {
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
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, [AGENTS.ARCHITECT, AGENTS.ROUTER]);
});

Deno.test("runLoadPlanCommand approved review kicks off planner on denial", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;

    await runLoadPlanCommand(["plan-d2"], {
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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
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
                        worktreePath: "/tmp/harns-plan-worktree",
                        worktreeBranch: "harns/worktree/plan-missing-base",
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
            createDirectAgentHandler: () => async () => {},
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
                        worktreePath: "/tmp/harns-plan-worktree",
                        worktreeBranch: "harns/worktree/plan-recorded-base",
                        worktreeStatus: "execution_failed",
                    },
                }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-recorded-base",
                    planName: "plan-recorded-base",
                    path: "/tmp/harns-plan-worktree",
                    branch: "harns/worktree/plan-recorded-base",
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
                    path: "/tmp/harns-plan-worktree-2",
                    branch: "harns/worktree/plan-recorded-base-2",
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
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(removed, true);
    assertEquals(createdBaseRef, "abc123");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand in_progress inspect reports failure and baseline diff", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("inspect", "cancel");

    await runLoadPlanCommand(["plan-inspect"], {
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
            createDirectAgentHandler: () => async () => {},
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

    await runLoadPlanCommand(["plan-implemented"], {
        uiAPI,
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
                workflowDuringValidation = getActiveExecutionWorkflow();
                clearActiveExecutionWorkflow();
                return Promise.resolve();
            },
            createDirectAgentHandler: () => async () => {},
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
});

Deno.test("runLoadPlanCommand only offers manual merge for merge-conflict worktree recovery", async () => {
    for (const worktreeStatus of ["completed", "validation_failed", "merge_conflict"]) {
        const { uiAPI, selections, prompts } = makeUi();
        selections.push("cancel");

        await runLoadPlanCommand([`plan-${worktreeStatus}`], {
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
                            worktreePath: "/tmp/harns-plan-worktree",
                            worktreeBranch: `harns/worktree/plan-${worktreeStatus}`,
                            worktreeStatus,
                        },
                    }),
                findWorktreeById: () => Promise.resolve(null),
                findWorktreeByPlanName: () => Promise.resolve(null),
                createDirectAgentHandler: () => async () => {},
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
                        worktreePath: "/tmp/harns-plan-worktree",
                        worktreeBranch: "harns/worktree/plan-completed-worktree",
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
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(mergeCalled, false);
    assertEquals(events.includes("validation_passed"), false);
    assertEquals(messages.some((message) => message.includes("Retry Workflow Validation first")), true);
});

Deno.test("runLoadPlanCommand can manually merge merge-conflict worktree recovery", async () => {
    const worktreePath = await Deno.makeTempDir({ prefix: "harns-load-plan-merge-" });
    try {
        const { uiAPI, selections } = makeUi();
        selections.push("merge");
        let mergedBranch = "";
        let removedPath = "";
        let removedRegistryId = "";
        let registryStatus = "";
        /** @type {string | null} */
        let lifecycleEvent = null;

        await runLoadPlanCommand(["plan-merge-conflict"], {
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
                            summary: "s",
                            affectedPaths: [],
                            status: "implemented",
                            worktreeId: "wt1",
                            worktreePath,
                            worktreeBranch: "harns/worktree/plan-merge-conflict",
                            worktreeStatus: "merge_conflict",
                        },
                    }),
                findWorktreeById: () => Promise.resolve(null),
                findWorktreeByPlanName: () => Promise.resolve(null),
                getWorktreeStatus: () =>
                    Promise.resolve({
                        exists: true,
                        path: worktreePath,
                        branch: "harns/worktree/plan-merge-conflict",
                        statusText: "",
                        diff: "",
                    }),
                mergeExecutionWorktree: (/** @type {{ branch: string }} */ args) => {
                    mergedBranch = args.branch;
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
                recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                    lifecycleEvent = args.event;
                    return Promise.resolve(/** @type {any} */ ({}));
                },
                createDirectAgentHandler: () => async () => {},
                resetTuiState: () => {},
                setActiveAgent: () => {},
            }),
        });

        assertEquals(mergedBranch, "harns/worktree/plan-merge-conflict");
        assertEquals(removedPath, worktreePath);
        assertEquals(removedRegistryId, "wt1");
        assertEquals(registryStatus, "merged");
        assertEquals(lifecycleEvent, "validation_passed");
    } finally {
        await Deno.remove(worktreePath, { recursive: true });
    }
});

Deno.test("runLoadPlanCommand verified plan review path records review_reopened", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let lifecycleCalled = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-verified-review"], {
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
            createDirectAgentHandler: () => async () => {},
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
            createDirectAgentHandler: () => async () => {},
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
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-h"], {
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
            createDirectAgentHandler: () => async () => {},
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
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-i"], {
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
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
            resetTuiState: () => {},
        }),
    });

    assertEquals(activeAgents.includes(AGENTS.PLANNER), true);
    assertEquals(activeAgents.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand restores router flow after lifecycle saves a plan", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const restoredAgents = [];

    await runLoadPlanCommand(["plan-g"], {
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
            createDirectAgentHandler: () => async () => {},
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

    assertEquals(restoredAgents.includes(AGENTS.ROUTER), true);
});

Deno.test("runLoadPlanCommand restores the initially active agent after lifecycle saves a plan", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const restoredAgents = [];

    await runLoadPlanCommand(["plan-j"], {
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
            createDirectAgentHandler: () => async () => {},
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
