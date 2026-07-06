/**
 * @module cmd/name
 * Command to set or show the current session name.
 */

import { sanitizeSessionName, setTerminalTitleForName } from "../../ui/tui/terminal-title.js";
import { theme } from "../../ui/theme/theme.js";

/**
 * Handle name command. Mirrors upstream Pi behavior:
 * - `/name <name>` sets the session display name.
 * - `/name` shows the current name, or usage when unnamed.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
// deno-lint-ignore require-await
export async function runNameCommand(argv, options = {}) {
    if (!options?.uiAPI) {
        console.error("The /name command is only available inside an interactive session.");
        return;
    }

    const deps = /** @type {{ setTerminalTitleForName?: typeof setTerminalTitleForName }} */ (options.__testDeps || {});
    const setTitle = deps.setTerminalTitleForName || setTerminalTitleForName;
    const { uiAPI, sessionManager } = options;

    if (!sessionManager) {
        uiAPI.appendSystemMessage("Error: No active session.");
        return;
    }

    const name = sanitizeSessionName(argv.join(" "));
    if (!name) {
        const currentName = sanitizeSessionName(sessionManager.getSessionName?.() || "");
        if (currentName) {
            uiAPI.appendSystemMessage(theme.fg("dim", `Session name: ${currentName}`));
        } else {
            uiAPI.appendSystemMessage(theme.fg("dim", "Usage: /name <name>"));
        }
        return;
    }

    sessionManager.appendSessionInfo?.(name);
    setTitle(name);
    uiAPI.appendSystemMessage(theme.fg("dim", `Session name set: ${name}`));
}
