/**
 * @module ui/tui/terminal-title
 * Helpers for RunWield terminal tab/window titles.
 */

import { formatSessionTerminalTitle } from "../../shared/session/session-name.js";
import { getTUI } from "./tui.js";

export { sanitizeSessionName } from "../../shared/session/session-name.js";

/**
 * Format a terminal title from a Session Name.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function formatTerminalTitle(name) {
    return formatSessionTerminalTitle(name);
}

/**
 * Best-effort Terminal Title update for a Session Name.
 *
 * @param {unknown} name
 * @param {{ getTUI?: typeof getTUI }} [deps]
 * @returns {string} The title that was attempted.
 */
export function setTerminalTitleForName(name, deps = {}) {
    const title = formatTerminalTitle(name);
    try {
        const getTuiImpl = deps.getTUI || getTUI;
        const { terminal } = getTuiImpl();
        if (terminal && typeof terminal.setTitle === "function") {
            terminal.setTitle(title);
        }
    } catch (_error) {
        // Terminal title updates are cosmetic. Never break the TUI if unavailable.
    }
    return title;
}
