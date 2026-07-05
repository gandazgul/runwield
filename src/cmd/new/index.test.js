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

Deno.test("runNewCommand creates and installs a fresh root session", async () => {
    /** @type {string[]} */
    const messages = [];
    /** @type {string[]} */
    const infos = [];
    let cleared = false;
    let installed = false;
    /** @type {unknown[]} */
    const createArgs = [];
    /** @type {string[]} */
    const titles = [];

    const manager = {
        appendSessionInfo: (/** @type {string} */ info) => infos.push(info),
        getSessionName: () => infos.at(-1),
        getSessionId: () => "session-123",
    };

    await runNewCommand(
        ["build", "coverage"],
        /** @type {any} */ ({
            uiAPI: {
                clearMessages: () => {
                    cleared = true;
                },
                appendSystemMessage: (/** @type {string} */ msg) => messages.push(msg),
            },
            sessionHost: {
                createSession: (
                    /** @type {{ sessionManager?: unknown, uiAPI?: unknown, eventSink?: unknown }} */ options,
                ) => {
                    installed = options.sessionManager === manager && options.uiAPI === options.eventSink;
                    return { id: "hosted-session-123" };
                },
            },
            replaceHostedSession: () => {},
            __testDeps: {
                createRootSessionManager: (
                    /** @type {string} */ mode,
                    /** @type {string} */ cwd,
                ) => {
                    createArgs.push(mode, cwd);
                    return Promise.resolve(manager);
                },
                /* setRootSessionManager intentionally unused by HostedSession path */
                setTerminalTitleForSession: (/** @type {any} */ sessionManager, /** @type {string} */ cwd) => {
                    titles.push(`${sessionManager.getSessionName?.() || cwd}`);
                    return "wld - build coverage";
                },
            },
        }),
    );

    assertEquals(createArgs, ["new", Deno.cwd()]);
    assertEquals(infos, ["build coverage"]);
    assertEquals(installed, true);
    assertEquals(titles, ["build coverage"]);
    assertEquals(cleared, true);
    assertEquals(messages, ["Started new session: session-123"]);
});

Deno.test("runNewCommand updates terminal title for unnamed sessions", async () => {
    /** @type {string[]} */
    const titles = [];
    const manager = {
        getSessionName: () => undefined,
        getSessionId: () => "session-456",
    };

    await runNewCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: () => {},
            },
            __testDeps: {
                createRootSessionManager: () => Promise.resolve(manager),
                setTerminalTitleForSession: (/** @type {any} */ _sessionManager, /** @type {string} */ cwd) => {
                    titles.push(cwd);
                    return "wld - project";
                },
            },
        }),
    );

    assertEquals(titles, [Deno.cwd()]);
});
