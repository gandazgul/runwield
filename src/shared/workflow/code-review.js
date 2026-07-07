/**
 * @module shared/workflow/code-review
 * Launches the Plannotator human code review UI for a completed workflow diff.
 */

import { startCodeReviewSurface } from "./review-launcher.js";

export { loadReviewEditorHtml } from "./review-launcher.js";

/**
 * @typedef {Object} CodeReviewAnnotation
 * @property {string} [file]
 * @property {string} [path]
 * @property {number} [line]
 * @property {string} [text]
 * @property {string} [comment]
 */

/**
 * @typedef {Object} CodeReviewDecision
 * @property {boolean} approved
 * @property {string} feedback
 * @property {CodeReviewAnnotation[]} annotations
 * @property {boolean} exit
 */

/**
 * @param {unknown} value
 * @returns {CodeReviewAnnotation[]}
 */
function normalizeAnnotations(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === "object");
}

/**
 * @param {unknown} decision
 * @returns {CodeReviewDecision}
 */
export function normalizeCodeReviewDecision(decision) {
    if (!decision || typeof decision !== "object") {
        return { approved: false, feedback: "", annotations: [], exit: true };
    }

    const record = /** @type {Record<string, unknown>} */ (decision);
    const approved = record.approved === true;
    const feedback = typeof record.feedback === "string" ? record.feedback : "";
    const annotations = normalizeAnnotations(record.annotations);
    const explicitlyExited = record.exit === true || record.canceled === true || record.cancelled === true;
    const noDecision = !approved && !feedback.trim() && annotations.length === 0;

    return {
        approved,
        feedback,
        annotations,
        exit: explicitlyExited || noDecision,
    };
}

/**
 * @param {CodeReviewAnnotation[]} annotations
 * @returns {string}
 */
export function formatCodeReviewAnnotations(annotations) {
    if (annotations.length === 0) return "";

    return annotations.map((annotation, index) => {
        const file = annotation.file || annotation.path || "unknown file";
        const line = typeof annotation.line === "number" ? `:${annotation.line}` : "";
        const text = annotation.text || annotation.comment || "";
        return `${index + 1}. ${file}${line}${text ? `\n${text}` : ""}`;
    }).join("\n\n");
}

/**
 * Launch Plannotator code review for the supplied diff.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} opts.diffText
 * @param {string} opts.executionCwd
 * @param {import('./workflow.js').UiAPI} opts.uiAPI
 * @param {{
 *   startCodeReviewSurface?: typeof startCodeReviewSurface,
 *   startReviewServer?: (options: object) => Promise<any>,
 *   loadReviewEditorHtml?: typeof import("./review-launcher.js").loadReviewEditorHtml,
 *   openInDefaultBrowser?: typeof import("./review-launcher.js").openInDefaultBrowser,
 * }} [opts.__deps]
 * @returns {Promise<CodeReviewDecision>}
 */
export async function runPlannotatorCodeReview({
    planName,
    diffText,
    executionCwd,
    uiAPI,
    __deps,
}) {
    const startCodeReviewSurfaceImpl = __deps?.startCodeReviewSurface || startCodeReviewSurface;

    const server = await startCodeReviewSurfaceImpl({
        rawPatch: diffText,
        gitRef: `RunWield workflow diff: ${planName}`,
        agentCwd: executionCwd,
        startReviewServer: __deps?.startReviewServer,
        loadReviewEditorHtml: __deps?.loadReviewEditorHtml,
        openInDefaultBrowser: __deps?.openInDefaultBrowser,
    });

    uiAPI.appendSystemMessage(`Code review UI available at: ${server.url}`, false, "RunWield");

    if (!server.opened) {
        uiAPI.appendSystemMessage(`Could not auto-open browser. Open manually: ${server.url}`, false, "RunWield");
    }

    try {
        return normalizeCodeReviewDecision(await server.waitForDecision());
    } finally {
        await server.stop();
    }
}
