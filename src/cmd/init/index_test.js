/**
 * @module cmd/init/index_test
 * Tests for the init command handler — guard logic and basic dispatch.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { runInitCommand } from "./index.js";

Deno.test("runInitCommand warns and exits on duplicate init", async () => {
    /** @type {string[]} */
    const warns = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warns.push(String(msg));
    await runInitCommand(
        [],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                isInitDone: () => true,
                recordInitDone: () => {},
                parseArgs: () => ({}),
                printCommandHelp: () => {},
                readTextFile: () => "",
                cwd: () => "/tmp/test-project",
            }),
        }),
    );
    console.warn = originalWarn;

    assertEquals(warns.length, 1);
    assertStringIncludes(warns[0], "Init has already been run");
});

Deno.test("runInitCommand prints help without checking init state", async () => {
    let helped = false;
    let checked = false;

    await runInitCommand(
        ["--help"],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                parseArgs: () => ({ help: true }),
                printCommandHelp: (/** @type {string} */ name) => {
                    helped = name === "init";
                },
                isInitDone: () => {
                    checked = true;
                    return false;
                },
            }),
        }),
    );

    assertEquals(helped, true);
    assertEquals(checked, false);
});

Deno.test("runInitCommand reports duplicate init through ui when available", async () => {
    /** @type {string[]} */
    const messages = [];

    await runInitCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ msg) => messages.push(msg),
            },
            __testDeps: /** @type {any} */ ({
                isInitDone: () => true,
                parseArgs: () => ({}),
                cwd: () => "/tmp/project",
            }),
        }),
    );

    assertEquals(messages.length, 1);
    assertStringIncludes(messages[0], "/tmp/project");
});

Deno.test("runInitCommand runs init agent and records completion in CLI mode", async () => {
    /** @type {string[]} */
    const events = [];
    /** @type {unknown} */
    let sessionArgs;
    const agentDef = { name: "init-agent" };
    const originalLog = console.log;
    console.log = (msg = "") => events.push(String(msg));

    try {
        await runInitCommand(
            [],
            /** @type {any} */ ({
                sessionManager: { id: "session" },
                __testDeps: /** @type {any} */ ({
                    isInitDone: () => false,
                    parseArgs: () => ({}),
                    cwd: () => "/tmp/project",
                    ensureBundledAgentDefFile: (/** @type {string} */ relativePath) =>
                        Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
                    loadAgentDefFromPath: (
                        /** @type {string} */ path,
                        /** @type {{ agentName: string }} */ opts,
                    ) => {
                        events.push(`${path}:${opts.agentName}`);
                        return Promise.resolve(agentDef);
                    },
                    recordInitOffered: () => {
                        events.push("offered");
                    },
                    runAgentSession: (/** @type {unknown} */ args) => {
                        sessionArgs = args;
                        events.push("ran");
                        return Promise.resolve();
                    },
                    recordInitDone: () => {
                        events.push("done");
                    },
                }),
            }),
        );
    } finally {
        console.log = originalLog;
    }

    assertEquals(events, [
        "/tmp/bundled-agent-definitions/workflow-prompts/init-agent-prompt.md:init",
        "offered",
        "ran",
        "done",
        "\n[RunWield] ✅ Init complete for /tmp/project.",
    ]);
    assertEquals(/** @type {any} */ (sessionArgs)._agentDefOverride, agentDef);
    assertEquals(/** @type {any} */ (sessionArgs).agentName, "init");
    assertEquals(/** @type {any} */ (sessionArgs).useRootSession, false);
});

Deno.test("runInitCommand reports failure and does not record completion", async () => {
    /** @type {string[]} */
    const errors = [];
    const originalError = console.error;
    console.error = (msg = "") => errors.push(String(msg));
    let completed = false;

    try {
        await assertRejects(
            () =>
                runInitCommand(
                    [],
                    /** @type {any} */ ({
                        __testDeps: /** @type {any} */ ({
                            isInitDone: () => false,
                            parseArgs: () => ({}),
                            loadAgentDefFromPath: () => Promise.resolve({}),
                            recordInitOffered: () => {},
                            runAgentSession: () => Promise.reject(new Error("agent stopped")),
                            recordInitDone: () => {
                                completed = true;
                            },
                        }),
                    }),
                ),
            Error,
            "agent stopped",
        );
    } finally {
        console.error = originalError;
    }

    assertEquals(completed, false);
    assertEquals(errors, ["[RunWield] Init failed: agent stopped"]);
});

Deno.test("runInitCommand definition has correct flags", async () => {
    const mod = await import("./index.js");
    assertEquals(mod.runInitCommand.name, "runInitCommand");
    // Verify the command is registered with correct flags
    const { getCommandDefinition, hasCommandSurface } = await import("../registry.js");
    const cmd = getCommandDefinition("init");
    assertEquals(cmd ? hasCommandSurface(cmd, "slash") : false, true);
    assertEquals(cmd ? hasCommandSurface(cmd, "cli") : false, true);
    assertEquals(cmd?.name, "init");
    assertEquals(cmd?.displayName, "Init");
    assertStringIncludes(cmd?.description ?? "", "Initialize");
});
