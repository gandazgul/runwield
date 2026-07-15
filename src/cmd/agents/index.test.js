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
    /** @type {unknown} */
    let switchedSessionId = "";
    /** @type {string | undefined} */
    let listedProjectRoot;
    const sessionRuntime = /** @type {any} */ ({
        getSessionSnapshot: () => ({ cwd: "/tmp/runwield-agents-project", name: "session" }),
        switchAgent: (
            /** @type {string} */ sessionId,
            /** @type {{ agentName: string, model?: string }} */ options,
        ) => {
            called = true;
            switchedSessionId = sessionId;
            model = options.model;
            return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
        },
    });

    await runAgentsCommand(
        ["router"],
        /** @type {any} */ ({
            uiAPI: /** @type {any} */ ({
                appendSystemMessage: () => {},
                promptSelect: () => Promise.resolve("router"),
            }),
            editor: /** @type {any} */ ({ setText: () => {} }),
            tui: /** @type {any} */ ({ setFocus: () => {} }),
            sessionId: "runtime-session",
            sessionRuntime,
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: (/** @type {string | undefined} */ projectRoot) => {
                    listedProjectRoot = projectRoot;
                    return Promise.resolve([
                        { name: "router", displayName: "RunWield", description: "", model: "" },
                    ]);
                },
            }),
        }),
    );

    assertEquals(called, true);
    assertEquals(switchedSessionId, "runtime-session");
    assertEquals(listedProjectRoot, "/tmp/runwield-agents-project");
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
    /** @type {string | undefined} */
    let initialAgentName = "not-set";

    await runAgentsCommand(
        ["planner", "build", "thing"],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: () =>
                    Promise.resolve([
                        { name: "planner", displayName: "Planner", description: "plan", model: "m" },
                    ]),
                startInteractiveSession: (
                    /** @type {string | null} */ request,
                    /** @type {{ initialAgentName?: string }} */ options,
                ) => {
                    startedWith = String(request);
                    initialAgentName = options.initialAgentName;
                    return Promise.resolve(undefined);
                },
            }),
        }),
    );

    assertEquals(startedWith, "build thing");
    assertEquals(initialAgentName, "planner");
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
