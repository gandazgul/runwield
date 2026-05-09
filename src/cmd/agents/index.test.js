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
                        { name: "router", displayName: "Router", description: "", model: "" },
                    ]),
                setActiveAgent: () => {
                    called = true;
                },
                createDirectAgentHandler: () => async () => {},
            }),
        }),
    );

    assertEquals(called, true);
});

Deno.test("runAgentsCommand CLI unknown agent exits", async () => {
    let exitCode = 0;

    await runAgentsCommand(
        ["nope"],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: () =>
                    Promise.resolve([
                        { name: "router", displayName: "Router", description: "", model: "" },
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

    await runAgentsCommand(
        ["planner", "build", "thing"],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                listAvailableAgents: () =>
                    Promise.resolve([
                        { name: "planner", displayName: "Planner", description: "plan", model: "m" },
                    ]),
                createDirectAgentHandler: () => async () => {},
                setActiveAgent: (/** @type {string} */ name) => {
                    active = name;
                },
                startInteractiveSession: (/** @type {string | null} */ request) => {
                    startedWith = String(request);
                    return Promise.resolve(undefined);
                },
            }),
        }),
    );

    assertEquals(active, "Planner");
    assertEquals(startedWith, "build thing");
});

Deno.test("runAgentsCommand TUI with missing selected agent shows message", async () => {
    let msg = "";
    await runAgentsCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ m) => {
                    msg = String(m);
                },
                promptSelect: () => Promise.resolve("nope"),
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
});
