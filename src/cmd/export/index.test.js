import { assertEquals, assertMatch } from "@std/assert";
import * as path from "@std/path";
import { existsSync } from "node:fs";
import { runExportCommand } from "./index.js";

Deno.test("runExportCommand reports error when session export fails", async () => {
    /** @type {string[]} */
    const messages = [];

    await runExportCommand([], {
        sessionStartedAt: "2026-05-01T19:44:54.629Z",
        uiAPI: {
            appendSystemMessage: (msg) => messages.push(msg),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: () => Promise.resolve(null),
            promptText: () => Promise.resolve(null),
            showModelSelector: () => {},
        },
        editor: {
            disableSubmit: false,
            setText: () => {},
            setAutocompleteProvider: () => {},
            handleInput: () => {},
        },
        // Intentionally incomplete to trigger export failure path
        sessionManager: /** @type {any} */ ({}),
    });

    assertEquals(messages.length, 1);
    assertMatch(messages[0], /Failed to export session:/);
});

Deno.test("runExportCommand exports jsonl from root session manager", async () => {
    /** @type {string[]} */
    const messages = [];
    const outPath = `${Deno.cwd()}/temp/test-root-session-export-${Date.now()}.jsonl`;

    const sessionManager = /** @type {any} */ ({
        getSessionId: () => "test-session",
        getCwd: () => Deno.cwd(),
        getBranch: () => [{
            type: "custom_message",
            id: "entry-1",
            parentId: null,
            timestamp: new Date().toISOString(),
            customType: "test",
            content: "hello export",
            display: true,
        }],
    });

    try {
        await runExportCommand([outPath], {
            uiAPI: {
                appendSystemMessage: (msg) => messages.push(msg),
                appendAgentMessageStart: () => ({ appendText: () => {} }),
                requestRender: () => {},
                promptSelect: () => Promise.resolve(null),
                promptText: () => Promise.resolve(null),
                showModelSelector: () => {},
            },
            editor: {
                disableSubmit: false,
                setText: () => {},
                setAutocompleteProvider: () => {},
                handleInput: () => {},
            },
            sessionManager,
        });

        assertEquals(messages.length, 1);
        assertMatch(messages[0], /Session exported to:/);
        assertEquals(existsSync(outPath), true);
    } finally {
        if (existsSync(outPath)) {
            await Deno.remove(path.dirname(outPath), { recursive: true });
        }
    }
});
