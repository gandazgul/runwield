/**
 * @module shared/session/workflow-messages
 * Semantic messages produced by workflow tools.
 */

import { emitAssistantMessage } from "./session-runtime-events.js";

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
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {string} agentName
 * @param {unknown} message
 */
export function emitTaskCompletedMessage(hostedSession, agentName, message) {
    emitAssistantMessage(
        hostedSession,
        agentName || "RunWield",
        formatTaskCompletedMarkdown(message),
        { workflowMessage: "task_completed" },
    );
}

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {string} agentName
 * @param {unknown} message
 * @param {boolean} approved
 */
export function emitReviewResultMessage(hostedSession, agentName, message, approved) {
    const markdown = typeof message === "string" && message.trim() ? message.trim() : "Review complete.";
    emitAssistantMessage(hostedSession, agentName || "Reviewer", markdown, {
        reviewResult: true,
        approved,
        workflowMessage: "review_complete",
    });
}
