import { assertEquals } from "@std/assert";
import { runResumeCommand } from "./index.js";

function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<unknown>} */
    const selections = [];

    return {
        messages,
        selections,
        uiAPI: /** @type {import('../../shared/workflow/workflow.js').UiAPI} */ ({
            appendSystemMessage: (msg) => messages.push(String(msg)),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: () => Promise.resolve(selections.shift() ?? null),
            promptText: () => Promise.resolve(null),
        }),
    };
}

Deno.test("runResumeCommand prints help", async () => {
    let helped = "";

    await runResumeCommand(["--help"], {
        __testDeps: /** @type {any} */ ({
            printCommandHelp: (/** @type {string} */ name) => {
                helped = name;
            },
            parseArgs: () => ({ help: true, _: [] }),
        }),
    });

    assertEquals(helped, "resume");
});

Deno.test("runResumeCommand empty plan list in TUI mode", async () => {
    const { uiAPI, messages } = makeUi();
    const editor = /** @type {import('../../shared/ui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    await runResumeCommand([], {
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () => Promise.resolve([]),
            resetTuiState: () => {},
            importRouter: () => Promise.resolve({ routerCmdOnMessage: async () => {} }),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.includes("No plans available, start one by entering a new request"), true);
});

Deno.test("runResumeCommand approved plan proceed path", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runResumeCommand(["plan-a"], {
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
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            importRouter: () => Promise.resolve({ routerCmdOnMessage: async () => {} }),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runResumeCommand non-approved plan enters shared plan lifecycle", async () => {
    const { uiAPI } = makeUi();
    let lifecycleCalled = false;

    await runResumeCommand(["plan-b"], {
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
            runPlanLifecycle: () => {
                lifecycleCalled = true;
                return Promise.resolve({ status: "saved", planName: "plan-b" });
            },
            createDirectAgentHandler: () => async () => {},
            createUserInterviewTool: () => ({ name: "user_interview" }),
            setActiveAgent: () => {},
            resetTuiState: () => {},
            importRouter: () => Promise.resolve({ routerCmdOnMessage: async () => {} }),
        }),
    });

    assertEquals(lifecycleCalled, true);
});

Deno.test("runResumeCommand approved plan view then cancel", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("view", null);

    await runResumeCommand(["plan-c"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-c"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-c",
                    path: "plans/plan-c.md",
                    body: "plan body content",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            resetTuiState: () => {},
            importRouter: () => Promise.resolve({ routerCmdOnMessage: async () => {} }),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("plan body content")), true);
    assertEquals(messages.some((m) => m.includes("Resume canceled")), true);
});

Deno.test("runResumeCommand approved review uses shared lifecycle (no rerun hint)", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    let lifecycleCalled = false;

    await runResumeCommand(["plan-d"], {
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
            runPlanLifecycle: () => {
                lifecycleCalled = true;
                return Promise.resolve({ status: "saved", planName: "plan-d" });
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            importRouter: () => Promise.resolve({ routerCmdOnMessage: async () => {} }),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(lifecycleCalled, true);
    assertEquals(messages.some((m) => m.includes("To continue the revision loop, run")), false);
});

Deno.test("runResumeCommand CLI mode missing plan exits", async () => {
    let exitCode = 0;
    const originalExit = Deno.exit;
    Deno.exit = (code) => {
        exitCode = Number(code ?? 0);
        throw new Error("exit");
    };

    try {
        await runResumeCommand([], {
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: false, _: [] }),
            }),
        });
    } catch {
        // expected
    } finally {
        Deno.exit = originalExit;
    }

    assertEquals(exitCode, 1);
});

Deno.test("runResumeCommand approved proceed with repair reroutes review", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let reviewCalled = false;

    await runResumeCommand(["plan-e"], {
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
            executePlan: () => Promise.resolve({ repairRequired: true, error: "bad tasks" }),
            reviewLoop: () => {
                reviewCalled = true;
                return Promise.resolve(null);
            },
            createUserInterviewTool: () => ({ name: "user_interview" }),
            resetTuiState: () => {},
            importRouter: () => Promise.resolve({ routerCmdOnMessage: async () => {} }),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(reviewCalled, true);
    assertEquals(
        messages.some((m) =>
            m.includes("Rerouting to architect for repair") || m.includes("Rerouting to planner for repair")
        ),
        true,
    );
});

Deno.test("runResumeCommand starts interactive session when ui missing", async () => {
    let started = false;
    await runResumeCommand(["plan-f"], {
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

Deno.test("runResumeCommand keeps planner active when lifecycle canceled", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await runResumeCommand(["plan-h"], {
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
            runPlanLifecycle: () => Promise.resolve({ status: "canceled" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                activeAgents.push(name);
            },
            resetTuiState: () => {},
            importRouter: () => Promise.resolve({ routerCmdOnMessage: async () => {} }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
        }),
    });

    assertEquals(activeAgents.includes("planner"), true);
    assertEquals(activeAgents.includes("Router"), false);
});

Deno.test("runResumeCommand router restore failure appends warning", async () => {
    const { uiAPI, messages } = makeUi();

    await runResumeCommand(["plan-g"], {
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
            runPlanLifecycle: () => Promise.resolve({ status: "failed" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
            importRouter: () => Promise.reject(new Error("boom")),
        }),
    });

    assertEquals(messages.some((m) => m.includes("Could not reload Router automatically")), true);
});
