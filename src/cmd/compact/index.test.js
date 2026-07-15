import { assertEquals } from "@std/assert";
import { runCompactCommand } from "./index.js";
import { initRunWieldTheme } from "../../ui/theme/theme.js";

initRunWieldTheme();

function makeUi() {
    const messages = /** @type {string[]} */ ([]);
    return {
        messages,
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        }),
    };
}

/** @param {{ compact?: (id: string, instructions?: string) => Promise<any> }} [options] */
function makeRuntimeContext(options = {}) {
    return {
        sessionId: "compact-test",
        sessionRuntime: /** @type {any} */ ({
            compactSession: options.compact || (() => Promise.resolve({ tokensBefore: 1234, summary: "summary" })),
        }),
    };
}

Deno.test("runCompactCommand requires a Runtime session id", async () => {
    const { uiAPI, messages } = makeUi();
    await runCompactCommand([], { uiAPI });
    assertEquals(messages, ["Error: No active agent session."]);
});

Deno.test("runCompactCommand delegates compaction to SessionRuntime", async () => {
    const { uiAPI, messages } = makeUi();
    let instructions = "";
    const context = makeRuntimeContext({
        compact: (_id, value) => {
            instructions = value || "";
            return Promise.resolve({ tokensBefore: 1234, summary: "short summary" });
        },
    });

    await runCompactCommand(["keep", "decisions"], {
        uiAPI,
        ...context,
    });

    assertEquals(instructions, "keep decisions");
    assertEquals(messages.some((message) => message.includes("Session compacted.")), true);
    assertEquals(messages.includes("short summary"), true);
});

Deno.test("runCompactCommand reports Runtime compaction outcomes", async () => {
    for (
        const [errorMessage, expected] of [
            ["Compaction cancelled", "Compaction cancelled."],
            ["Nothing to compact yet", "Nothing to compact — the session doesn't have enough messages yet."],
            ["model unavailable", "Compaction failed: model unavailable"],
        ]
    ) {
        const { uiAPI, messages } = makeUi();
        await runCompactCommand([], {
            uiAPI,
            ...makeRuntimeContext({ compact: () => Promise.reject(new Error(errorMessage)) }),
        });
        assertEquals(messages.at(-1), expected);
    }
});
