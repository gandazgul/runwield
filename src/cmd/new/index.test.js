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
    let disposedRoot = false;
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
            hostedSession: /** @type {any} */ ({ id: "old-hosted-session" }),
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
                disposeRootAgentSessionForNewSession: () => {
                    disposedRoot = true;
                },
                setTerminalTitleForSession: (/** @type {any} */ sessionManager, /** @type {string} */ cwd) => {
                    titles.push(`${sessionManager.getSessionName?.() || cwd}`);
                    return "wld - build coverage";
                },
            },
        }),
    );

    assertEquals(disposedRoot, true);
    assertEquals(createArgs, ["new", Deno.cwd()]);
    assertEquals(infos, ["build coverage"]);
    assertEquals(installed, true);
    assertEquals(titles, ["build coverage"]);
    assertEquals(cleared, true);
    assertEquals(messages, ["Started new session: session-123"]);
});

Deno.test("runNewCommand starts fresh interactive sessions at Router", async () => {
    const manager = {
        getSessionId: () => "session-router",
    };
    const hostedSession = { id: "fresh-hosted-session" };
    /** @type {Array<{ agentName: string, deps?: unknown }>} */
    const handlerArgs = [];
    /** @type {Array<{ hostedSession: unknown, agentName: string, uiAPI: unknown }>} */
    const activeAgents = [];
    /** @type {Array<{ hostedSession: unknown, uiAPI: unknown }>} */
    const swaps = [];
    const uiAPI = {
        appendSystemMessage: () => {},
    };

    await runNewCommand(
        [],
        /** @type {any} */ ({
            uiAPI,
            sessionHost: {
                createSession: () => hostedSession,
            },
            replaceHostedSession: () => {},
            setActiveAgent: (
                /** @type {unknown} */ nextHostedSession,
                /** @type {string} */ agentName,
                /** @type {unknown} */ _handler,
                /** @type {unknown} */ nextUiAPI,
            ) => {
                activeAgents.push({ hostedSession: nextHostedSession, agentName, uiAPI: nextUiAPI });
            },
            applyPendingRootSwap: (/** @type {unknown} */ nextHostedSession, /** @type {unknown} */ nextUiAPI) => {
                swaps.push({ hostedSession: nextHostedSession, uiAPI: nextUiAPI });
                return Promise.resolve();
            },
            __testDeps: {
                createRootSessionManager: () => Promise.resolve(manager),
                createAgentHandler: (/** @type {string} */ agentName, /** @type {unknown} */ deps) => {
                    handlerArgs.push({ agentName, deps });
                    return () => Promise.resolve();
                },
                setTerminalTitleForSession: () => "wld - new session",
            },
        }),
    );

    assertEquals(activeAgents, [{ hostedSession, agentName: "router", uiAPI }]);
    assertEquals(swaps, [{ hostedSession, uiAPI }]);
    assertEquals(handlerArgs, [{ agentName: "router", deps: { hostedSession } }]);
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
