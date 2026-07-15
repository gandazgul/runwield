import { assertEquals } from "@std/assert";
import { runNewCommand } from "./index.js";

Deno.test("runNewCommand reports when used outside interactive mode", async () => {
    /** @type {string[]} */
    const errors = [];
    const origError = console.error;
    console.error = (msg = "") => errors.push(String(msg));
    try {
        await runNewCommand([], {});
    } finally {
        console.error = origError;
    }

    assertEquals(errors, ["The /new command is only available inside an interactive session."]);
});

Deno.test("runNewCommand creates, names, and installs a fresh Runtime session", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const createArgs = [];
    /** @type {string[]} */
    const renamed = [];
    /** @type {string[]} */
    const replaced = [];
    /** @type {string[]} */
    const titles = [];
    let cleared = false;

    await runNewCommand(
        ["build", "coverage"],
        /** @type {any} */ ({
            uiAPI: {
                clearMessages: () => {
                    cleared = true;
                },
            },
            sessionId: "runtime-old",
            sessionRuntime: {
                getSessionSnapshot: () => ({ cwd: "/workspace/project" }),
                createPromptReadySession: (/** @type {Record<string, unknown>} */ options) => {
                    createArgs.push(options);
                    return Promise.resolve("runtime-new");
                },
                renameSession: (/** @type {string} */ sessionId, /** @type {string} */ name) => {
                    renamed.push(`${sessionId}:${name}`);
                    return { ok: true };
                },
            },
            replaceRuntimeSession: (/** @type {string} */ sessionId) => replaced.push(sessionId),
            __testDeps: {
                setTerminalTitleForName: (/** @type {string} */ name) => {
                    titles.push(name);
                    return `wld - ${name}`;
                },
            },
        }),
    );

    assertEquals(createArgs, [{ cwd: "/workspace/project", agentName: "router" }]);
    assertEquals(renamed, ["runtime-new:build coverage"]);
    assertEquals(replaced, ["runtime-new"]);
    assertEquals(titles, ["build coverage"]);
    assertEquals(cleared, true);
});

Deno.test("runNewCommand starts fresh Runtime sessions at Router", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const createArgs = [];
    /** @type {string[]} */
    const replaced = [];

    await runNewCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {},
            sessionId: "runtime-old",
            sessionRuntime: {
                getSessionSnapshot: () => ({ cwd: "/workspace/project" }),
                createPromptReadySession: (/** @type {Record<string, unknown>} */ options) => {
                    createArgs.push(options);
                    return Promise.resolve("runtime-router");
                },
            },
            replaceRuntimeSession: (/** @type {string} */ sessionId) => replaced.push(sessionId),
            __testDeps: {
                setTerminalTitleForName: () => "wld - project",
            },
        }),
    );

    assertEquals(createArgs, [{ cwd: "/workspace/project", agentName: "router" }]);
    assertEquals(replaced, ["runtime-router"]);
});

Deno.test("runNewCommand uses the project root for an unnamed terminal title", async () => {
    /** @type {string[]} */
    const titles = [];

    await runNewCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {},
            sessionRuntime: {
                createPromptReadySession: () => Promise.resolve("runtime-new"),
            },
            replaceRuntimeSession: () => {},
            __testDeps: {
                setTerminalTitleForName: (/** @type {string} */ name) => {
                    titles.push(name);
                    return "wld - project";
                },
            },
        }),
    );

    assertEquals(titles, [Deno.cwd()]);
});
