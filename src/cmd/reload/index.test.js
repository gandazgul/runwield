import { assertEquals } from "@std/assert";
import { runReloadCommand } from "./index.js";
import { HostedSession } from "../../shared/session/hosted-session.js";

Deno.test("runReloadCommand reports no active root session", async () => {
    /** @type {string[]} */
    const messages = [];
    const hostedSession = new HostedSession({ id: "reload-command-empty", cwd: Deno.cwd() });

    await runReloadCommand([], {
        hostedSession,
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        }),
    });

    assertEquals(messages, ["Reload skipped (no active root session found)."]);
});
