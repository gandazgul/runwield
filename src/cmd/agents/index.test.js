import { assertEquals } from "@std/assert";
import { runAgentsCommand } from "./index.js";

Deno.test("runAgentsCommand help path", async () => {
    let helped = "";

    await runAgentsCommand(
        ["help"],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                printCommandHelp: (/** @type {string} */ name) => {
                    helped = name;
                },
            }),
        }),
    );

    assertEquals(helped, "agent");
});

Deno.test("runAgentsCommand chooses TUI handler when ui deps present", async () => {
    let called = false;
    /** @type {string | undefined} */
    let model = "not-set";

    await runAgentsCommand(
        ["router"],
        /** @type {any} */ ({
            uiAPI: /** @type {any} */ ({
                appendSystemMessage: () => {},
                promptSelect: () => Promise.resolve("router"),
            }),
            editor: /** @type {any} */ ({ setText: () => {} }),
            tui: /** @type {any} */ ({ setFocus: () => {} }),
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: () =>
                    Promise.resolve([
                        { name: "router", displayName: "RunWield", description: "", model: "" },
                    ]),
                setActiveAgent: (
                    /** @type {unknown} */ _hostedSession,
                    /** @type {string} */ _name,
                    /** @type {unknown} */ _handler,
                    /** @type {unknown} */ _uiAPI,
                    /** @type {string | undefined} */ agentModel,
                ) => {
                    called = true;
                    model = agentModel;
                },
                createAgentHandler: () => async () => {},
            }),
        }),
    );

    assertEquals(called, true);
    assertEquals(model, undefined);
});

Deno.test("runAgentsCommand CLI unknown agent exits", async () => {
    let exitCode = 0;

    await runAgentsCommand(
        ["nope"],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: () =>
                    Promise.resolve([
                        { name: "router", displayName: "RunWield", description: "", model: "" },
                    ]),
                exit: (/** @type {number} */ code) => {
                    exitCode = code;
                    throw new Error("exit");
                },
            }),
        }),
    ).catch(() => {});

    assertEquals(exitCode, 1);
});

Deno.test("runAgentsCommand CLI lists agents when no agent name", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runAgentsCommand(
            [],
            /** @type {any} */ ({
                __testDeps: /** @type {any} */ ({
                    listAvailableAgents: () =>
                        Promise.resolve([
                            { name: "planner", displayName: "Planner", description: "plan", model: "m" },
                        ]),
                }),
            }),
        );
    } finally {
        console.log = orig;
    }

    assertEquals(logs.some((m) => m.includes("Available agents")), true);
});

Deno.test("runAgentsCommand CLI valid agent starts session", async () => {
    let startedWith = "";
    let active = "";
    /** @type {string | undefined} */
    let activeModel = "not-set";
    /** @type {string | undefined} */
    let initialModel = "not-set";

    await runAgentsCommand(
        ["planner", "build", "thing"],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: () =>
                    Promise.resolve([
                        { name: "planner", displayName: "Planner", description: "plan", model: "m" },
                    ]),
                createAgentHandler: () => async () => {},
                setActiveAgent: (
                    /** @type {string} */ name,
                    /** @type {unknown} */ _handler,
                    /** @type {unknown} */ _uiAPI,
                    /** @type {string | undefined} */ agentModel,
                ) => {
                    active = name;
                    activeModel = agentModel;
                },
                startInteractiveSession: (
                    /** @type {string | null} */ request,
                    /** @type {unknown} */ _handler,
                    /** @type {{ initialAgentModel?: string }} */ options,
                ) => {
                    startedWith = String(request);
                    initialModel = options.initialAgentModel;
                    return Promise.resolve(undefined);
                },
            }),
        }),
    );

    assertEquals(active, "");
    assertEquals(activeModel, "not-set");
    assertEquals(startedWith, "build thing");
    assertEquals(initialModel, undefined);
});

Deno.test("runAgentsCommand TUI with missing selected agent shows message", async () => {
    let msg = "";
    /** @type {unknown} */
    let promptHooks;
    await runAgentsCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ m) => {
                    msg = String(m);
                },
                promptSelect: (
                    /** @type {string} */ _title,
                    /** @type {unknown[]} */ _options,
                    /** @type {unknown} */ hooks,
                ) => {
                    promptHooks = hooks;
                    return Promise.resolve("nope");
                },
            },
            editor: { setText: () => {} },
            tui: { setFocus: () => {} },
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: () =>
                    Promise.resolve([{ name: "planner", displayName: "Planner", description: "", model: "" }]),
            }),
        }),
    );

    assertEquals(msg.includes('Agent "nope" not found'), true);
    assertEquals(promptHooks, { persistResult: false });
});
