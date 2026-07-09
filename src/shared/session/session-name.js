/**
 * @module shared/session/session-name
 * UI-independent persisted Session Name normalization.
 */

const SESSION_NAME_MAX_LENGTH = 40;

/**
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

/** @param {unknown} name @returns {string} */
export function formatSessionTerminalTitle(name) {
    const sanitized = sanitizeSessionName(name);
    return sanitized ? `wld - ${sanitized}` : "wld";
}
