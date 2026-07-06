/**
 * @module ui/tui/terminal-title
 * Helpers for RunWield terminal tab/window titles.
 */

import { basename } from "@std/path";
import { getTUI } from "./tui.js";

const SESSION_NAME_MAX_LENGTH = 40;

/**
 * Sanitize a value so it is safe and compact as a persisted Session Name and
 * terminal title suffix.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeSessionName(value) {
    return Array.from(String(value ?? ""), (char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127 ? " " : char;
    }).join("")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, SESSION_NAME_MAX_LENGTH)
        .trim();
}

/**
 * Format a terminal title from a Session Name.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function formatTerminalTitle(name) {
    const sanitized = sanitizeSessionName(name);
    return sanitized ? `wld - ${sanitized}` : "wld";
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

/**
 * Best-effort Terminal Title update for the active session. Uses the persisted
 * Session Name when available, otherwise falls back to the cwd basename.
 *
 * @param {{ getSessionName?: () => string | undefined } | undefined} sessionManager
 * @param {string} cwd
 * @param {{ getTUI?: typeof getTUI }} [deps]
 * @returns {string} The title that was attempted.
 */
export function setTerminalTitleForSession(sessionManager, cwd, deps = {}) {
    const sessionName = sanitizeSessionName(sessionManager?.getSessionName?.() || "");
    const fallbackName = sanitizeSessionName(basename(cwd || Deno.cwd()));
    return setTerminalTitleForName(sessionName || fallbackName, deps);
}
