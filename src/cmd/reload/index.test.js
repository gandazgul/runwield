import { assertEquals } from "@std/assert";
import { runReloadCommand } from "./index.js";

Deno.test("runReloadCommand reloads only through SessionRuntime", async () => {
    const messages = /** @type {string[]} */ ([]);
    await runReloadCommand([], {
        sessionId: "reload-test",
        sessionRuntime: /** @type {any} */ ({
            reloadSession: () => Promise.resolve({ ok: false }),
            getSessionSnapshot: () => ({ cwd: Deno.cwd() }),
        }),
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        }),
    });
    assertEquals(messages, ["Reload skipped (no active root session found)."]);
});
