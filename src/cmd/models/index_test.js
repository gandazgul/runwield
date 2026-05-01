import { assertEquals } from "@std/assert";
import { runModelsCommand } from "./index.js";

Deno.test("runModelsCommand rejects bare model id in ui mode", async () => {
    /** @type {string[]} */
    const messages = [];
    await runModelsCommand(["gpt-4.1"], {
        uiAPI: {
            appendSystemMessage: (msg) => {
                messages.push(msg);
            },
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: () => Promise.resolve(null),
            promptText: () => Promise.resolve(null),
        },
    });

    assertEquals(messages.length, 1);
    assertEquals(messages[0], "Invalid model format. Use /model to switch.");
});
