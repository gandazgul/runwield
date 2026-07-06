import { assertEquals } from "@std/assert";
import { runCompactCommand } from "./index.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { initRunWieldTheme } from "../../shared/ui/theme.js";

initRunWieldTheme();

/**
 * @returns {{ uiAPI: any, messages: string[] }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    return {
        messages,
        uiAPI: {
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        },
    };
}

/** @param {any} [rootAgentSession] */
function makeHostedSession(rootAgentSession = null) {
    const hostedSession = new HostedSession({ id: `compact-command-${crypto.randomUUID()}`, cwd: Deno.cwd() });
    hostedSession.setRootAgentSession(rootAgentSession);
    return hostedSession;
}

Deno.test("runCompactCommand reports missing active agent session", async () => {
    const { uiAPI, messages } = makeUi();

    await runCompactCommand([], { uiAPI, hostedSession: makeHostedSession() });

    assertEquals(messages, ["Error: No active agent session."]);
});

Deno.test("runCompactCommand reports when compaction is already running", async () => {
    const { uiAPI, messages } = makeUi();

    await runCompactCommand([], { uiAPI, hostedSession: makeHostedSession({ isCompacting: true }) });

    assertEquals(messages, ["Compaction is already in progress. Press Escape to cancel."]);
});

Deno.test("runCompactCommand skips empty sessions before invoking compact", async () => {
    const { uiAPI, messages } = makeUi();
    let compactCalled = false;
    const hostedSession = makeHostedSession(
        /** @type {any} */ ({
            isCompacting: false,
            sessionManager: { getBranch: () => [] },
            settingsManager: { getCompactionSettings: () => ({ keepRecentTokens: 1000 }) },
            compact: () => {
                compactCalled = true;
            },
        }),
    );

    await runCompactCommand([], { uiAPI, hostedSession });

    assertEquals(compactCalled, false);
    assertEquals(messages[0].includes("Nothing meaningful to compact"), true);
});

Deno.test("runCompactCommand skips immediately after an existing compaction", async () => {
    const { uiAPI, messages } = makeUi();
    const hostedSession = makeHostedSession(
        /** @type {any} */ ({
            isCompacting: false,
            sessionManager: { getBranch: () => [{ type: "message" }, { type: "compaction" }] },
            settingsManager: { getCompactionSettings: () => ({ keepRecentTokens: 1000 }) },
        }),
    );

    await runCompactCommand([], { uiAPI, hostedSession });

    assertEquals(messages, ["Already compacted — no new messages since the last compaction."]);
});

Deno.test("runCompactCommand registers cancellation and reports compact success", async () => {
    const { uiAPI, messages } = makeUi();
    let cancelHandler = /** @type {(() => void) | null} */ (null);
    let abortCalled = false;
    let instructions = "";
    const hostedSession = makeHostedSession(
        /** @type {any} */ ({
            isCompacting: false,
            sessionManager: {
                getBranch: () =>
                    Array.from({ length: 40 }, (_, index) => ({
                        type: "message",
                        message: { role: index % 2 === 0 ? "user" : "assistant", content: "x".repeat(1000) },
                    })),
            },
            settingsManager: { getCompactionSettings: () => ({ keepRecentTokens: 1 }) },
            abortCompaction: () => {
                abortCalled = true;
            },
            compact: (/** @type {string | undefined} */ customInstructions) => {
                instructions = customInstructions || "";
                return Promise.resolve({ tokensBefore: 1234, summary: "short summary" });
            },
        }),
    );

    await runCompactCommand(["keep", "decisions"], {
        uiAPI,
        hostedSession,
        registerOperationCancel: (handler) => {
            cancelHandler = handler;
        },
    });
    cancelHandler?.();

    assertEquals(instructions, "keep decisions");
    assertEquals(abortCalled, true);
    assertEquals(messages.some((message) => message.includes("Compacting context")), true);
    assertEquals(messages.some((message) => message.includes("Session compacted.")), true);
    assertEquals(messages.includes("short summary"), true);
});

Deno.test("runCompactCommand reports compact cancellation and failures", async () => {
    for (
        const [errorMessage, expected] of [
            ["Compaction cancelled", "Compaction cancelled."],
            ["Nothing to compact yet", "Nothing to compact — the session doesn't have enough messages yet."],
            ["model unavailable", "Compaction failed: model unavailable"],
        ]
    ) {
        const { uiAPI, messages } = makeUi();
        const hostedSession = makeHostedSession(
            /** @type {any} */ ({
                isCompacting: false,
                sessionManager: {
                    getBranch: () =>
                        Array.from({ length: 40 }, () => ({
                            type: "message",
                            message: { role: "user", content: "x".repeat(1000) },
                        })),
                },
                settingsManager: { getCompactionSettings: () => ({ keepRecentTokens: 1 }) },
                compact: () => Promise.reject(new Error(errorMessage)),
            }),
        );

        await runCompactCommand([], { uiAPI, hostedSession });

        assertEquals(messages.at(-1), expected);
    }
});
