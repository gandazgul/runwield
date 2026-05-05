/**
 * @module cmd/resume
 * Command to browse and resume a recent session.
 */

import { getHarnsSessionDir } from "../../shared/session/root-session.js";
import { setRootSessionManager } from "../../shared/session/session-state.js";
import { restorePersistedMessagesToUi } from "../../shared/chat-session.js";

/**
 * Handle resume session command.
 *
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runResumeCommand(_argv, options = {}) {
    if (!options?.uiAPI || !options?.editor) {
        console.error("The /resume command is only available inside an interactive session.");
        return;
    }

    const { uiAPI, editor } = options;

    const { SessionManager } = await import("@mariozechner/pi-coding-agent");
    const cwd = Deno.cwd();
    const sessionDir = getHarnsSessionDir(cwd);

    // List recent sessions
    const sessions = await SessionManager.list(cwd, sessionDir);

    if (sessions.length === 0) {
        uiAPI.appendSystemMessage("No recent sessions found to resume.");
        return;
    }

    // Prepare options for promptSelect
    const selectOptions = sessions.map((s) => {
        let displayMsg = (s.firstMessage || s.id).trim().replace(/\n/g, " ");
        if (displayMsg.length > 60) {
            displayMsg = displayMsg.substring(0, 57) + "...";
        }

        const title = s.name ? `${s.name} (${displayMsg})` : displayMsg;
        const modified = new Date(s.modified).toLocaleString();
        return {
            value: s.path,
            label: title,
            description: `Modified: ${modified} | Messages: ${s.messageCount}`,
        };
    });

    const chosenPath = await uiAPI.promptSelect("Select a session to resume:", selectOptions);

    if (!chosenPath) {
        // User pressed Esc or cancelled
        editor.setText("");
        editor.disableSubmit = false;
        return;
    }

    // Resume the chosen session
    const rootSessionManager = SessionManager.open(chosenPath, sessionDir, cwd);
    setRootSessionManager(rootSessionManager);

    if (uiAPI.clearMessages) {
        uiAPI.clearMessages();
    }

    // Restore the messages into the UI
    restorePersistedMessagesToUi(rootSessionManager, uiAPI);

    uiAPI.appendSystemMessage(`Resumed session: ${rootSessionManager.getSessionId()}`);
}
