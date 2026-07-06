/**
 * @module ui/tui/task-completed-message
 *
 * Shared rendering for the task_completed workflow signal. The tool itself is
 * internal plumbing, so the TUI should show the human completion note instead
 * of a raw tool-call header.
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

/**
 * @param {unknown} message
 * @returns {string}
 */
export function formatTaskCompletedMarkdown(message) {
    const text = typeof message === "string" ? message.trim() : "";
    return text ? `**Task completed.**\n\n${text}` : "**Task completed.**";
}

/**
 * @param {import('./types.js').UiAPI} uiAPI
 * @param {string} agentName
 * @param {unknown} message
 */
export function appendTaskCompletedMessage(uiAPI, agentName, message) {
    const displayName = agentName || "RunWield";
    const markdown = formatTaskCompletedMarkdown(message);

    const appender = uiAPI.appendAgentMessageStart?.(displayName);
    if (appender) {
        appender.appendText(markdown);
        uiAPI.requestRender?.();
        return;
    }

    uiAPI.appendSystemMessage(markdown, false, displayName);
}
