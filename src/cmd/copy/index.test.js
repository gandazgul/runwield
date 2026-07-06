import { assertEquals } from "@std/assert";
import { runCopyCommand } from "./index.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { initRunWieldTheme } from "../../ui/theme/theme.js";

initRunWieldTheme();

/** @returns {{ uiAPI: any, messages: string[] }} */
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

Deno.test("runCopyCommand reports missing active agent session from HostedSession", async () => {
    const { uiAPI, messages } = makeUi();
    const hostedSession = new HostedSession({ id: "copy-command-empty", cwd: Deno.cwd() });

    await runCopyCommand([], { uiAPI, hostedSession });

    assertEquals(messages, ["Error: No active agent session."]);
});

Deno.test("runCopyCommand reads messages from the supplied HostedSession root session", async () => {
    const { uiAPI, messages } = makeUi();
    const hostedSession = new HostedSession({ id: "copy-command-root", cwd: Deno.cwd() });
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: { state: { messages: [{ role: "user", content: "hello" }] } },
        }),
    );

    await runCopyCommand([], { uiAPI, hostedSession });

    assertEquals(messages, ["Nothing to copy — no assistant message found."]);
});
