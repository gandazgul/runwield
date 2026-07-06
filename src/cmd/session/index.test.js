import { assertEquals } from "@std/assert";
import { runSessionCommand } from "./index.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { initRunWieldTheme } from "../../ui/theme/theme.js";

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

Deno.test("runSessionCommand reports no active session inside interactive mode", async () => {
    const { uiAPI, messages } = makeUi();
    const hostedSession = new HostedSession({ id: "session-command-empty", cwd: Deno.cwd() });

    await runSessionCommand([], { uiAPI, hostedSession });

    assertEquals(messages, ["Error: No active session."]);
});

Deno.test("runSessionCommand summarizes messages, tool use, compactions, token usage, and compaction settings", async () => {
    const { uiAPI, messages } = makeUi();
    const hostedSession = new HostedSession({ id: "session-command-populated", cwd: Deno.cwd() });
    hostedSession.setRootSessionManager(
        /** @type {any} */ ({
            getSessionName: () => "Deep Work",
            getSessionFile: () => "/tmp/session.jsonl",
            getSessionId: () => "session-123",
            getEntries: () => [
                { type: "compaction" },
                { type: "message", message: { role: "user", content: "hello" } },
                {
                    type: "message",
                    message: {
                        role: "user",
                        content: [{ type: "tool_result", text: "ok" }],
                    },
                },
                {
                    type: "message",
                    message: {
                        role: "assistant",
                        content: [{ type: "tool_use", name: "bash" }],
                        usage: {
                            inputTokens: 1000,
                            outputTokens: 250,
                            cacheReadTokens: 500,
                            cacheWriteTokens: 25,
                        },
                    },
                },
            ],
        }),
    );
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({
            settingsManager: {
                getCompactionSettings: () => ({ enabled: true, reserveTokens: 16000, keepRecentTokens: 22000 }),
            },
            getContextUsage: () => ({ tokens: 96000, contextWindow: 128000, percent: 75 }),
        }),
    );

    await runSessionCommand([], { uiAPI, hostedSession });

    const plain = messages.join("\n");
    assertEquals(plain.includes("Session compacted 1 time"), true);
    assertEquals(plain.includes("Deep Work"), true);
    assertEquals(plain.includes("/tmp/session.jsonl"), true);
    assertEquals(plain.includes("session-123"), true);
    assertEquals(plain.includes("User:"), true);
    assertEquals(plain.includes("2"), true);
    assertEquals(plain.includes("Assistant:"), true);
    assertEquals(plain.includes("Tool Calls:"), true);
    assertEquals(plain.includes("Tool Results:"), true);
    assertEquals(plain.includes("Compaction"), true);
    assertEquals(plain.includes("Auto-compact:"), true);
    assertEquals(plain.includes("16,000"), true);
    assertEquals(plain.includes("22,000"), true);
    assertEquals(plain.includes("112,000"), true);
    assertEquals(plain.includes("96,000/128,000 (75.0%)"), true);
    assertEquals(plain.includes("1,000"), true);
    assertEquals(plain.includes("500"), true);
    assertEquals(plain.includes("1,775"), true);
});
