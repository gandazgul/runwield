/** @module shared/workflow/collaboration-pull */

import { AGENTS, CLI_BIN } from "../../constants.js";
import { redactSecrets } from "../collaboration/capabilities.js";

/**
 * @typedef {Object} PullReviewComment
 * @property {string} id
 * @property {string} createdAt
 * @property {boolean} resolved
 * @property {boolean} readable
 * @property {string} [displayName]
 * @property {string} [body]
 * @property {string} [type]
 * @property {string} [originalText]
 * @property {Record<string, unknown>} [anchor]
 * @property {string} [error]
 */

/** @param {Record<string, unknown>} attrs */
export function selectPullPlanningAgent(attrs = {}) {
    return attrs.classification === "PROJECT" || attrs.type === "epic" ? AGENTS.ARCHITECT : AGENTS.PLANNER;
}

/**
 * @param {PullReviewComment[]} comments
 * @returns {string}
 */
export function formatPullCommentsForPrompt(comments) {
    if (!comments.length) return "No comments were returned for the latest remote revision.";
    return comments.map((comment, index) => {
        if (!comment.readable) {
            return [
                `Comment ${index + 1} (${comment.id}) — unreadable`,
                `Created: ${comment.createdAt}`,
                `Resolved: ${comment.resolved ? "yes" : "no"}`,
                `Error: ${comment.error || "Unable to decrypt comment payload."}`,
            ].join("\n");
        }
        const type = comment.type === "global_comment" ? "global" : "inline";
        const lines = [
            `Comment ${index + 1} (${comment.id}) — ${type}`,
            `Author: ${comment.displayName || "Anonymous reviewer"}`,
            `Created: ${comment.createdAt}`,
            `Resolved: ${comment.resolved ? "yes" : "no"}`,
            `Feedback: ${comment.body || "(empty)"}`,
        ];
        if (comment.originalText) lines.push(`Selected text: ${comment.originalText}`);
        if (comment.anchor) lines.push(`Anchor: ${JSON.stringify(comment.anchor)}`);
        return lines.join("\n");
    }).join("\n\n");
}

/** @param {unknown} value */
function formatListValue(value) {
    if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "(none)";
    if (typeof value === "string" && value.trim()) return value;
    return "(none)";
}

/**
 * @param {{ planName: string, planPath?: string, title?: string, attrs: Record<string, unknown>, remote: { serverUrl: string, spaceId: string, status?: string, revision: number }, comments: PullReviewComment[], unreadableCommentCount?: number, action?: string }} context
 * @returns {string}
 */
export function buildPullRevisionRequest(context) {
    const title = String(context.title || context.attrs.title || context.attrs.summary || context.planName);
    const summary = context.attrs.summary ? String(context.attrs.summary) : "(not provided)";
    const localStatus = context.attrs.status ? String(context.attrs.status) : "draft";
    const text = [
        "## Collaborative Planning Pull Revision Request",
        "",
        `Local Plan: ${context.planName}`,
        context.planPath ? `Plan path: ${context.planPath}` : undefined,
        context.action ? `Local pull action: ${context.action}` : undefined,
        "",
        "## Decrypted Plan Metadata",
        "",
        `Title: ${title}`,
        `Summary: ${summary}`,
        `Status: ${localStatus}`,
        `Classification: ${context.attrs.classification || "FEATURE"}`,
        `Affected paths: ${formatListValue(context.attrs.affectedPaths)}`,
        "",
        "## Remote Revision Context",
        "",
        `Remote Shared Space: ${context.remote.serverUrl} (space ${context.remote.spaceId})`,
        `Remote status: ${context.remote.status || "open"}`,
        `Pulled revision: ${context.remote.revision}`,
        "",
        "The latest remote Plan revision and reviewer comments have been decrypted locally and the local Plan file has been synchronized through the collaboration pull bypass.",
        "Revise this Plan to incorporate the review feedback. Stay inside the collaborative planning workflow: do not execute implementation work from this pull context. After the local Plan revision is accepted, the maintainer should publish it with `wld plans push <plan>`.",
        "",
        "## Review Comments",
        "",
        formatPullCommentsForPrompt(context.comments),
        context.unreadableCommentCount
            ? `\nUnreadable/tampered comments: ${context.unreadableCommentCount}`
            : undefined,
    ].filter((line) => line !== undefined).join("\n");
    return redactSecrets(text);
}

/**
 * @param {unknown} outcome
 * @param {string} planName
 * @returns {string}
 */
export function summarizePullPlanningOutcome(outcome, planName) {
    if (outcome && typeof outcome === "object" && "outcome" in outcome) {
        const value = String(/** @type {{ outcome: unknown }} */ (outcome).outcome || "unknown");
        return `Planning agent finished with outcome "${value}". Review the local revision, then publish with: ${CLI_BIN} plans push ${planName}`;
    }
    return `Planning agent was launched. Review the local revision, then publish with: ${CLI_BIN} plans push ${planName}`;
}
