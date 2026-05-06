import { assertEquals } from "@std/assert";
import { runResumePlanCommand } from "./index.js";

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

Deno.test("runResumePlanCommand prints help", async () => {
    let helped = "";

    await runResumePlanCommand(["--help"], {
        __testDeps: /** @type {any} */ ({
            printCommandHelp: (/** @type {string} */ name) => {
                helped = name;
            },
            parseArgs: () => ({ help: true, _: [] }),
        }),
    });

    assertEquals(helped, "resume");
});

Deno.test("runResumePlanCommand empty plan list in TUI mode", async () => {
    const { uiAPI, messages } = makeUi();
    const editor = /** @type {import('../../shared/ui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    await runResumePlanCommand([], {
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

Deno.test("runResumePlanCommand approved plan proceed path", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runResumePlanCommand(["plan-a"], {
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
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runResumePlanCommand non-approved plan kicks off planning agent", async () => {
    const { uiAPI } = makeUi();
    let lifecycleCalled = false;

    await runResumePlanCommand(["plan-b"], {
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

Deno.test("runResumePlanCommand approved plan view then cancel", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("view", null);

    await runResumePlanCommand(["plan-c"], {
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
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("plan body content")), true);
    assertEquals(messages.some((m) => m.includes("Resume canceled")), false);
});

Deno.test("runResumePlanCommand approved review approves directly via submitPlanForReview", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let submitCalled = false;
    let executed = false;

    await runResumePlanCommand(["plan-d"], {
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
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(submitCalled, true);
    assertEquals(executed, false);
});

Deno.test("runResumePlanCommand approved review kicks off planner on denial", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;

    await runResumePlanCommand(["plan-d2"], {
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

Deno.test("runResumePlanCommand approved proceed with repair reroutes to planner", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let plannerCalled = false;

    await runResumePlanCommand(["plan-e"], {
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
            runPlanningAgent: () => {
                plannerCalled = true;
                return Promise.resolve({ outcome: "executed", planName: "plan-e" });
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(plannerCalled, true);
    assertEquals(
        messages.some((m) =>
            m.includes("Rerouting to architect for repair") || m.includes("Rerouting to planner for repair")
        ),
        true,
    );
});

Deno.test("runResumePlanCommand starts interactive session when ui missing", async () => {
    let started = false;
    await runResumePlanCommand(["plan-f"], {
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

Deno.test("runResumePlanCommand keeps planner active when lifecycle canceled", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await runResumePlanCommand(["plan-h"], {
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

    assertEquals(activeAgents.includes("planner"), true);
    assertEquals(activeAgents.includes("Router"), false);
});

Deno.test("runResumePlanCommand keeps planner active when agent ends without plan_written", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await runResumePlanCommand(["plan-i"], {
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

    assertEquals(activeAgents.includes("planner"), true);
    assertEquals(activeAgents.includes("Router"), false);
});

Deno.test("runResumePlanCommand restores router flow after lifecycle saves a plan", async () => {
    const { uiAPI, messages } = makeUi();
    /** @type {string[]} */
    const restoredAgents = [];

    await runResumePlanCommand(["plan-g"], {
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
            setActiveAgent: (/** @type {string} */ name) => restoredAgents.push(name),
            resetTuiState: () => {},
        }),
    });

    assertEquals(restoredAgents.includes("Router"), true);
    assertEquals(messages.some((m) => m.includes("Switched back to Router")), true);
});
