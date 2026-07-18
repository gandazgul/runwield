/**
 * @module shared/session/workflow-messages
 * Semantic messages produced by workflow tools.
 */

import { emitAssistantMessage } from "./session-runtime-events.js";

export const MANUAL_QA_CHECKLIST_CUSTOM_TYPE = "runwield.manual_qa_checklist";

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
        { messageKind: "workflow", workflowMessage: "task_completed" },
    );
}

/**
 * Persist a workflow-owned Manual QA checklist that was produced by a transient
 * AgentSession. Transient sessions emit live Runtime events but do not write to
 * the root Pi transcript, so store the visible checklist as RunWield metadata
 * for `/resume` replay.
 *
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined | null} sessionManager
 * @param {{ agentName?: string, text: string, name?: string, classification?: string }} checklist
 */
export function recordManualQaChecklistMessage(sessionManager, checklist) {
    if (!sessionManager?.appendCustomEntry) return;
    const text = typeof checklist.text === "string" ? checklist.text.trim() : "";
    if (!text) return;
    sessionManager.appendCustomEntry(MANUAL_QA_CHECKLIST_CUSTOM_TYPE, {
        agentName: checklist.agentName || "Operator",
        text,
        ...(checklist.name ? { name: checklist.name } : {}),
        ...(checklist.classification ? { classification: checklist.classification } : {}),
    });
}

/**
 * @param {unknown} entry
 * @returns {{ agentName: string, text: string } | null}
 */
export function readManualQaChecklistMessage(entry) {
    if (!entry || typeof entry !== "object") return null;
    const customType = /** @type {{ customType?: unknown }} */ (entry).customType;
    if (customType !== MANUAL_QA_CHECKLIST_CUSTOM_TYPE) return null;
    const data = /** @type {{ data?: { agentName?: unknown, text?: unknown } }} */ (entry).data;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) return null;
    return {
        agentName: typeof data?.agentName === "string" && data.agentName.trim() ? data.agentName.trim() : "Operator",
        text,
    };
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
        messageKind: "review_result",
        approved,
        workflowMessage: "review_complete",
    });
}
