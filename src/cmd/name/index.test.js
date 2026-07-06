import { assertEquals } from "@std/assert";
import { runNameCommand } from "./index.js";
import { initRunWieldTheme } from "../../ui/theme/theme.js";

initRunWieldTheme();

Deno.test("runNameCommand reports when used outside interactive mode", async () => {
    /** @type {string[]} */
    const errors = [];
    const origError = console.error;
    console.error = (msg = "") => errors.push(String(msg));
    try {
        await runNameCommand([], {});
    } finally {
        console.error = origError;
    }

    assertEquals(errors, ["The /name command is only available inside an interactive session."]);
});

Deno.test("runNameCommand sets session name and terminal title", async () => {
    /** @type {string[]} */
    const messages = [];
    /** @type {string[]} */
    const infos = [];
    /** @type {string[]} */
    const titles = [];

    await runNameCommand(
        ["build", "coverage"],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            },
            sessionManager: {
                appendSessionInfo: (/** @type {string} */ name) => infos.push(name),
            },
            __testDeps: {
                setTerminalTitleForName: (/** @type {string} */ name) => {
                    titles.push(name);
                    return `wld - ${name}`;
                },
            },
        }),
    );

    assertEquals(infos, ["build coverage"]);
    assertEquals(titles, ["build coverage"]);
    assertEquals(messages.length, 1);
    assertEquals(messages[0].includes("Session name set: build coverage"), true);
});

Deno.test("runNameCommand shows current session name", async () => {
    /** @type {string[]} */
    const messages = [];

    await runNameCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            },
            sessionManager: {
                getSessionName: () => "Deep Work",
            },
        }),
    );

    assertEquals(messages.length, 1);
    assertEquals(messages[0].includes("Session name: Deep Work"), true);
});

Deno.test("runNameCommand shows usage when unnamed", async () => {
    /** @type {string[]} */
    const messages = [];

    await runNameCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            },
            sessionManager: {
                getSessionName: () => undefined,
            },
        }),
    );

    assertEquals(messages.length, 1);
    assertEquals(messages[0].includes("Usage: /name <name>"), true);
});

Deno.test("runNameCommand reports missing active session", async () => {
    /** @type {string[]} */
    const messages = [];

    await runNameCommand(
        ["name"],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            },
        }),
    );

    assertEquals(messages, ["Error: No active session."]);
});
