/**
 * @module shared/workflow/code-review
 * Launches the Plannotator human code review UI for a completed workflow diff.
 */

import { startCodeReviewSurface } from "./review-launcher.js";
import { isAbsolute, resolve } from "node:path";
import { mimeTypeForImagePath } from "../session/image-attachments.js";

const MAX_CODE_REVIEW_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * @typedef {Object} CodeReviewAnnotation
 * @property {string} [file]
 * @property {string} [path]
 * @property {string} [filePath]
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
 * @property {boolean} [canceled]
 * @property {Array<{path: string, name: string} | {base64: string, mimeType: string, name: string}>} [images]
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
 * @param {unknown} value
 * @returns {Array<{path: string, name: string}>}
 */
function normalizeImageAttachments(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((image) => {
        const path = image && typeof image === "object" && typeof image.path === "string" ? image.path.trim() : "";
        if (!path) return [];
        const name = typeof image.name === "string" && image.name.trim() ? image.name.trim() : "image";
        return [{ path, name }];
    });
}

/**
 * @param {unknown} decision
 * @returns {CodeReviewDecision}
 */
export function normalizeCodeReviewDecision(decision) {
    if (!decision || typeof decision !== "object") {
        return { approved: false, feedback: "", annotations: [], exit: true, canceled: false };
    }

    const record = /** @type {Record<string, unknown>} */ (decision);
    const approved = record.approved === true;
    const feedback = typeof record.feedback === "string" ? record.feedback : "";
    const annotations = normalizeAnnotations(record.annotations);
    const images = normalizeImageAttachments(record.images);
    const canceled = record.canceled === true || record.cancelled === true;
    const explicitlyExited = record.exit === true || canceled;
    const noDecision = !approved && !feedback.trim() && annotations.length === 0 && images.length === 0;

    return {
        approved,
        feedback,
        annotations,
        exit: explicitlyExited || noDecision,
        canceled,
        ...(images.length > 0 && { images: /** @type {any} */ (images) }),
    };
}

/**
 * Read code-review images before the temporary upload files are removed.
 * Invalid files stay fail-soft so text and inline feedback are still delivered.
 *
 * @param {Array<{path: string, name: string}>} attachments
 * @param {string} cwd
 * @param {import('../types.js').SessionUiPort} uiAPI
 * @returns {Promise<Array<{base64: string, mimeType: string, name: string}>>}
 */
async function loadCodeReviewImages(attachments, cwd, uiAPI) {
    const images = [];
    for (const attachment of attachments) {
        try {
            const path = isAbsolute(attachment.path) ? attachment.path : resolve(cwd, attachment.path);
            const stat = await Deno.stat(path);
            if (!stat.isFile || stat.size > MAX_CODE_REVIEW_IMAGE_BYTES) {
                throw new Error(stat.size > MAX_CODE_REVIEW_IMAGE_BYTES ? "image exceeds 20 MB" : "path is not a file");
            }
            const bytes = await Deno.readFile(path);
            images.push({
                base64: bytesToBase64(bytes),
                mimeType: mimeTypeForImagePath(path),
                name: attachment.name,
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            uiAPI.appendSystemMessage(`[RunWield] Could not attach code review image "${attachment.name}": ${reason}`);
        }
    }
    return images;
}

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return btoa(chunks.join(""));
}

/**
 * @param {CodeReviewAnnotation[]} annotations
 * @returns {string}
 */
export function formatCodeReviewAnnotations(annotations) {
    if (annotations.length === 0) return "";

    return annotations.map((annotation, index) => {
        const file = annotation.file || annotation.path || annotation.filePath || "unknown file";
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
 *   loadReviewEditorHtml?: () => Promise<string>,
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
        uiAPI.disableInput?.();
        const decision = normalizeCodeReviewDecision(await server.waitForDecision());
        if (!decision.images?.length) return decision;
        const images = await loadCodeReviewImages(
            /** @type {Array<{path: string, name: string}>} */ (/** @type {unknown} */ (decision.images)),
            executionCwd,
            uiAPI,
        );
        return { ...decision, images };
    } finally {
        uiAPI.enableInput?.();
        await server.stop();
    }
}
