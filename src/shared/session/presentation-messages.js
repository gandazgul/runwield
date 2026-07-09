/**
 * @module shared/session/presentation-messages
 * UI-independent formatting helpers that write through the core session port.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function extractTaskCompletedMessage(value) {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            return extractTaskCompletedMessage(JSON.parse(value));
        } catch {
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const record = /** @type {{ message?: unknown }} */ (value);
    return typeof record.message === "string" ? record.message : "";
}

/** @param {unknown} message @returns {string} */
export function formatTaskCompletedMarkdown(message) {
    const text = typeof message === "string" ? message.trim() : "";
    return text ? `**Task completed.**\n\n${text}` : "**Task completed.**";
}

/**
 * @param {import('../types.js').SessionUiPort} uiAPI
 * @param {string} agentName
 * @param {unknown} message
 */
export function appendTaskCompletedMessage(uiAPI, agentName, message) {
    const displayName = agentName || "RunWield";
    const appender = uiAPI.appendAgentMessageStart(displayName);
    appender.appendText(formatTaskCompletedMarkdown(message));
    uiAPI.requestRender();
}

/**
 * @param {import('../types.js').SessionUiPort} uiAPI
 * @param {string} agentName
 * @param {unknown} message
 * @param {boolean} approved
 */
export function appendReviewResultMessage(uiAPI, agentName, message, approved) {
    const displayName = agentName || "Reviewer";
    const markdown = typeof message === "string" && message.trim() ? message.trim() : "Review complete.";
    if (uiAPI.appendReviewResult) {
        uiAPI.appendReviewResult(displayName, markdown, approved);
    } else {
        uiAPI.appendAgentMessageStart(displayName).appendText(markdown);
    }
    uiAPI.requestRender();
}
