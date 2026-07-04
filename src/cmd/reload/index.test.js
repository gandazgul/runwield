import { assertEquals } from "@std/assert";
import { runReloadCommand } from "./index.js";
import { setRootAgentSession } from "../../shared/session/session-state.js";

Deno.test({
    name:
        "runReloadCommand reports no active root session (skipped until 03-tui-single-hostedsession-adapter threads HostedSession into reload command)",
    ignore: true,
    fn: async () => {
        /** @type {string[]} */
        const messages = [];
        setRootAgentSession(null);

        await runReloadCommand([], {
            uiAPI: /** @type {any} */ ({
                appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            }),
        });

        assertEquals(messages, ["Reload skipped (no active root session found)."]);
    },
});
