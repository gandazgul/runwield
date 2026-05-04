import { assert, assertEquals } from "@std/assert";
import { routerCmdOnMessage, runRouterCommand } from "./index.js";

/**
 * @returns {{ messages: string[], ui: import('../../shared/workflow/workflow.js').UiAPI }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    return {
        messages,
        ui: /** @type {import('../../shared/workflow/workflow.js').UiAPI} */ ({
            appendSystemMessage: (msg) => messages.push(String(msg)),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: () => Promise.resolve(null),
            promptText: () => Promise.resolve(null),
        }),
    };
}

Deno.test("runRouterCommand prints help when userRequest is help", async () => {
    let helpCommand = "";
    let started = false;

    await runRouterCommand(["help"], {
        __testDeps: {
            printCommandHelp: (/** @type {string} */ name) => {
                helpCommand = name;
                return true;
            },
            startInteractiveSession: () => {
                started = true;
                return Promise.resolve(/** @type {import('../../shared/workflow/workflow.js').UiAPI} */ ({}));
            },
        },
    });

    assertEquals(helpCommand, "router");
    assertEquals(started, false);
});

Deno.test("runRouterCommand starts session with provided request", async () => {
    /** @type {string | null} */
    let initial = null;
    /** @type {string | null} */
    let mode = null;

    await runRouterCommand(["fix", "bug"], {
        sessionStartMode: "continue",
        __testDeps: {
            startInteractiveSession: (
                /** @type {string | null} */ userRequest,
                /** @type {unknown} */ _handler,
                opts = /** @type {{ sessionStartMode?: "new" | "continue" } | undefined} */ (undefined),
            ) => {
                initial = userRequest;
                mode = opts?.sessionStartMode || null;
                return Promise.resolve(/** @type {import('../../shared/workflow/workflow.js').UiAPI} */ ({}));
            },
        },
    });

    assertEquals(initial, "fix bug");
    assertEquals(mode, "continue");
});

Deno.test("routerCmdOnMessage reports router error when no triage and assistant errored", async () => {
    const { ui, messages } = makeUi();

    await routerCmdOnMessage(
        "hello",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () =>
                Promise.resolve([
                    { role: "assistant", stopReason: "error", errorMessage: "model down" },
                ]),
            extractTriageReport: () => null,
        }),
    );

    assert(messages.some((m) => m.includes("Router error: model down")));
});

Deno.test("routerCmdOnMessage handles QUICK_FIX path", async () => {
    const { ui, messages } = makeUi();
    /** @type {string[]} */
    const calls = [];
    let switched = "";

    await routerCmdOnMessage(
        "fix typo",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: (/** @type {{ agentName: string }} */ opts) => {
                calls.push(opts.agentName);
                return Promise.resolve([]);
            },
            extractTriageReport: () => ({
                classification: "QUICK_FIX",
                complexity: "LOW",
                summary: "Small fix",
                affectedPaths: ["src/a.js"],
            }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                switched = name;
            },
        }),
    );

    assertEquals(calls, ["router", "operator"]);
    assertEquals(switched, "Operator");
    assert(messages.some((m) => m.includes("QUICK_FIX detected")));
});

Deno.test("routerCmdOnMessage handles FEATURE proceed", async () => {
    const { ui } = makeUi();
    let switched = "";
    let lifecycleCalled = false;

    await routerCmdOnMessage(
        "add feature",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () => Promise.resolve([]),
            extractTriageReport: () => ({
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "Feature summary",
                affectedPaths: ["src/f.js"],
            }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
            runPlanLifecycle: () => {
                lifecycleCalled = true;
                return Promise.resolve({ status: "executed", planName: "feature-plan" });
            },
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                switched = name;
            },
        }),
    );

    assertEquals(lifecycleCalled, true);
    assertEquals(switched, "Operator");
});

Deno.test("routerCmdOnMessage handles FEATURE save-for-later", async () => {
    const { ui } = makeUi();
    let lifecycleCalled = false;

    await routerCmdOnMessage(
        "add feature",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () => Promise.resolve([]),
            extractTriageReport: () => ({
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "Feature summary",
                affectedPaths: ["src/f.js"],
            }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
            runPlanLifecycle: () => {
                lifecycleCalled = true;
                return Promise.resolve({ status: "saved", planName: "feature-plan" });
            },
        }),
    );

    assertEquals(lifecycleCalled, true);
});

Deno.test("routerCmdOnMessage keeps planner active when FEATURE lifecycle canceled", async () => {
    const { ui } = makeUi();
    let switched = "";

    await routerCmdOnMessage(
        "add feature",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () => Promise.resolve([]),
            extractTriageReport: () => ({
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "Feature summary",
                affectedPaths: ["src/f.js"],
            }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
            runPlanLifecycle: () => Promise.resolve({ status: "canceled" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                switched = name;
            },
        }),
    );

    assertEquals(switched, "Planner");
});

Deno.test("routerCmdOnMessage handles PROJECT repair flow", async () => {
    const { ui } = makeUi();
    let lifecycleCalled = false;

    await routerCmdOnMessage(
        "big refactor",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () => Promise.resolve([]),
            extractTriageReport: () => ({
                classification: "PROJECT",
                complexity: "HIGH",
                summary: "Project summary",
                affectedPaths: ["src/p.js"],
            }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
            runPlanLifecycle: () => {
                lifecycleCalled = true;
                return Promise.resolve({ status: "executed", planName: "project-plan" });
            },
        }),
    );

    assertEquals(lifecycleCalled, true);
});

Deno.test("routerCmdOnMessage handles PROJECT proceed success", async () => {
    const { ui } = makeUi();
    let switched = "";

    const sessionManager = /** @type {any} */ ({
        appendCustomMessageEntry: () => {},
    });

    await routerCmdOnMessage(
        "big refactor",
        [],
        ui,
        sessionManager,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () => Promise.resolve([]),
            extractTriageReport: () => ({
                classification: "PROJECT",
                complexity: "HIGH",
                summary: "Project summary",
                affectedPaths: ["src/p.js"],
            }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
            runPlanLifecycle: () => Promise.resolve({ status: "executed", planName: "project-plan" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                switched = name;
            },
        }),
    );

    assertEquals(switched, "Operator");
});

Deno.test("routerCmdOnMessage handles PROJECT save-for-later", async () => {
    const { ui } = makeUi();
    let lifecycleCalled = false;

    await routerCmdOnMessage(
        "big refactor",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () => Promise.resolve([]),
            extractTriageReport: () => ({
                classification: "PROJECT",
                complexity: "HIGH",
                summary: "Project summary",
                affectedPaths: ["src/p.js"],
            }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
            runPlanLifecycle: () => {
                lifecycleCalled = true;
                return Promise.resolve({ status: "saved", planName: "project-plan" });
            },
        }),
    );

    assertEquals(lifecycleCalled, true);
});

Deno.test("routerCmdOnMessage keeps architect active when PROJECT lifecycle canceled", async () => {
    const { ui } = makeUi();
    let switched = "";

    await routerCmdOnMessage(
        "big refactor",
        [],
        ui,
        undefined,
        /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("plans"),
            runAgentSession: () => Promise.resolve([]),
            extractTriageReport: () => ({
                classification: "PROJECT",
                complexity: "HIGH",
                summary: "Project summary",
                affectedPaths: ["src/p.js"],
            }),
            createUserInterviewTool: () => ({ name: "user_interview" }),
            runPlanLifecycle: () => Promise.resolve({ status: "canceled" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                switched = name;
            },
        }),
    );

    assertEquals(switched, "Architect");
});
