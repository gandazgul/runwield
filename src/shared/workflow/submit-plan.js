/**
 * @module submit-plan
 * RunWield function that submits a plan to the Plannotator review UI.
 *
 * Launches the review UI through review-launcher.js so a future Workspace-hosted
 * Plannotator surface can replace the compiled bridge behind one seam.
 */

import { injectFrontMatter, parsePlanFrontMatter } from "../../plan-store.js";
import { isAbsolute, resolve } from "node:path";
import { assertSharedPlanWriteAllowed } from "../collaboration/lock.js";
import { mimeTypeForImagePath } from "../session/image-attachments.js";
import { recordPlanEvent } from "./plan-lifecycle.js";
import { startPlanReviewSurface } from "./review-launcher.js";

// Browser opening lives in review-launcher.js and is imported here for dependency injection types.

// ─── Cancellation State ───────────────────────────────────────────────

/** @type {WeakMap<import('../session/hosted-session.js').HostedSession, () => void>} */
const planReviewCancelBySession = new WeakMap();

/**
 * Cancel an in-flight plan review wait for a HostedSession, if any.
 * @param {import('../session/hosted-session.js').HostedSession | undefined} hostedSession
 * @returns {boolean} true if a review was active and cancelled
 */
export function cancelActivePlanReview(hostedSession) {
    if (!hostedSession) return false;
    const cancel = planReviewCancelBySession.get(hostedSession);
    if (!cancel) return false;
    cancel();
    return true;
}

// ─── Types ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlanReviewResult
 * @property {boolean} approved - Whether the plan was approved
 * @property {boolean} [canceled] - Whether waiting for review was canceled via Esc
 * @property {string} [feedback] - User feedback/annotations (present when the user submits feedback or approves with notes)
 * @property {string} [savedPath] - Optional path where plan was saved (if available)
 * @property {Array<{base64: string, mimeType: string, name: string}>} [images] - Annotated feedback images for the agent
 */

/**
 * @typedef {Object} ReviewServerOutput
 * @property {"stdout" | "stderr"} stream
 * @property {string} text
 */

/**
 * Append review-server diagnostics through the session UI so TUI callers keep
 * them inside the active plan_written block instead of painting raw terminal
 * output over the interface.
 *
 * @param {import('../types.js').SessionUiPort} uiAPI
 * @param {ReviewServerOutput} output
 */
function appendReviewServerOutput(uiAPI, output) {
    const text = output.text.trimEnd();
    if (!text) return;
    uiAPI.appendSystemMessage(`[RunWield] Review server ${output.stream}:\n${text}`);
}

const MAX_REVIEW_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Read image attachments while the review decision and its temp files are
 * still available. Invalid attachments stay fail-soft so text feedback is not
 * lost when one image cannot be loaded.
 *
 * @param {any} decision
 * @param {string} cwd
 * @param {import('../types.js').SessionUiPort} uiAPI
 * @returns {Promise<Array<{base64: string, mimeType: string, name: string}>>}
 */
async function loadReviewFeedbackImages(decision, cwd, uiAPI) {
    const attachments = collectReviewImageAttachments(decision);
    const images = [];
    for (const attachment of attachments) {
        try {
            const path = isAbsolute(attachment.path) ? attachment.path : resolve(cwd, attachment.path);
            const stat = await Deno.stat(path);
            if (!stat.isFile || stat.size > MAX_REVIEW_IMAGE_BYTES) {
                throw new Error(stat.size > MAX_REVIEW_IMAGE_BYTES ? "image exceeds 20 MB" : "path is not a file");
            }
            const bytes = await Deno.readFile(path);
            images.push({
                base64: bytesToBase64(bytes),
                mimeType: mimeTypeForImagePath(path),
                name: attachment.name,
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            uiAPI.appendSystemMessage(`[RunWield] Could not attach review image "${attachment.name}": ${reason}`);
        }
    }
    return images;
}

/** @param {any} decision */
function collectReviewImageAttachments(decision) {
    const candidates = [
        ...readReviewImageAttachments(decision?.images),
        ...readReviewImageAttachments(decision?.globalAttachments),
        ...(Array.isArray(decision?.annotations) ? decision.annotations.flatMap(readAnnotationImageAttachments) : []),
    ];
    const seen = new Set();
    return candidates.filter((image) => {
        if (seen.has(image.path)) return false;
        seen.add(image.path);
        return true;
    });
}

/** @param {any} annotation */
function readAnnotationImageAttachments(annotation) {
    return readReviewImageAttachments(annotation?.images);
}

/** @param {any} value */
function readReviewImageAttachments(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((image) => {
        const path = typeof image?.path === "string" ? image.path.trim() : "";
        if (!path) return [];
        const name = typeof image?.name === "string" && image.name.trim() ? image.name.trim() : "image";
        return [{ path, name }];
    });
}

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return btoa(chunks.join(""));
}

// ─── Main Function ────────────────────────────────────────────────────

/**
 * Submit a plan for interactive review via the Plannotator browser UI.
 *
 * @param {Object} opts
 * @param {string} opts.cwd - Project root
 * @param {string} opts.planName - Plan filename (without .md)
 * @param {string} opts.planPath - Absolute path to the plan .md file
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} [opts.triageMeta] - Triage metadata to ensure in front matter
 * @param {import('../types.js').SessionUiPort} opts.uiAPI - Runtime session presentation port
 * @param {import('../session/hosted-session.js').HostedSession} opts.hostedSession
 * @param {{
 *   startPlanReviewSurface?: typeof startPlanReviewSurface,
 *   startPlanReviewServer?: (options: object) => Promise<any>,
 *   openInDefaultBrowser?: typeof import("./review-launcher.js").openInDefaultBrowser,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   htmlContent?: string,
 * }} [opts.__deps]
 * @returns {Promise<PlanReviewResult>}
 */
export async function submitPlanForReview({
    cwd,
    planName,
    planPath,
    triageMeta,
    uiAPI,
    hostedSession,
    __deps,
}) {
    if (!uiAPI) throw new Error("submitPlanForReview: uiAPI is required");
    if (!hostedSession) throw new Error("submitPlanForReview: hostedSession is required");
    const startPlanReviewSurfaceImpl = __deps?.startPlanReviewSurface || startPlanReviewSurface;
    const recordPlanEventImpl = __deps?.recordPlanEvent || recordPlanEvent;

    // 1. Read plan
    const planContent = await Deno.readTextFile(planPath);

    // 2. Ensure front matter is present and up to date
    const { attrs, body } = parsePlanFrontMatter(planContent);
    assertSharedPlanWriteAllowed(attrs);
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    const fmOverrides = {
        ...attrs,
        updatedAt: new Date().toISOString(),
    };

    if (triageMeta) {
        if (triageMeta.classification) {
            fmOverrides.classification = triageMeta.classification;
        }
        if (triageMeta.complexity) fmOverrides.complexity = triageMeta.complexity;
        if (triageMeta.summary) fmOverrides.summary = triageMeta.summary;
        if (triageMeta.affectedPaths) {
            fmOverrides.affectedPaths = triageMeta.affectedPaths;
        }
    }

    const planWithFm = injectFrontMatter(body, fmOverrides);
    await Deno.writeTextFile(planPath, planWithFm);

    uiAPI.appendSystemMessage(`[RunWield] Opening plan review UI for: ${planName}`);
    uiAPI.appendSystemMessage(`[RunWield] Plan file: ${planPath}`);

    // 4. Start the review surface through an adapter seam.
    const server = await startPlanReviewSurfaceImpl({
        cwd,
        plan: planWithFm,
        planPath,
        htmlContent: __deps?.htmlContent,
        startPlanReviewServer: __deps?.startPlanReviewServer,
        openInDefaultBrowser: __deps?.openInDefaultBrowser,
        onOutput: (output) => appendReviewServerOutput(uiAPI, output),
    });

    uiAPI.appendSystemMessage(`[RunWield] Review UI available at: ${server.url}`);

    const opened = server.opened;
    if (opened) {
        uiAPI.appendSystemMessage(`[RunWield] Opened review UI in your default browser.`);
    } else {
        uiAPI.appendSystemMessage(`[RunWield] Could not auto-open browser. Open manually: ${server.url}`);
    }

    uiAPI.appendSystemMessage(`[RunWield] Waiting for user decision...\n`);

    /** @type {() => void} */
    let localCancel = () => {};
    const cancelPromise = new Promise((resolve) => {
        localCancel = () => resolve({ _cancelled: true });
    });
    planReviewCancelBySession.set(hostedSession, localCancel);

    try {
        // 5. Disable input while waiting for review via server
        if (uiAPI.disableInput) uiAPI.disableInput();

        // Wait for user decide (blocks until approve/deny), but allow Esc cancellation
        const decision = await Promise.race([
            server.waitForDecision(),
            cancelPromise,
        ]);

        // Handle cancellation triggered from the TUI
        if (decision && typeof decision === "object" && "_cancelled" in decision) {
            uiAPI.appendSystemMessage(`[RunWield] ⏸️ Plan review wait cancelled: ${planName}`);
            return {
                approved: false,
                canceled: true,
                feedback: "Cancelled by user (Esc)",
            };
        }

        if (decision && typeof decision.plan === "string") {
            await Deno.writeTextFile(planPath, decision.plan);
        }

        // 6. Update status
        // If the plan is in a terminal/completed status (e.g. verified, implemented),
        // reopen it first so the review event can transition cleanly.
        const STATUS_ALLOWS_REVIEW = attrs.status === "draft" ||
            attrs.status === "feedback" ||
            attrs.status === "approved";

        if (!STATUS_ALLOWS_REVIEW) {
            try {
                await recordPlanEventImpl({
                    cwd,
                    planName,
                    event: "review_reopened",
                    currentStatus: attrs.status,
                    details: { triageMeta },
                });
            } catch (_reopenErr) {
                // If review_reopened also fails, fall back to the original status.
                // The downstream recordPlanEvent will surface its own error.
            }
        }

        // Use the reopened status ("feedback") if we reopened, or the original if already reviewable
        const postReopenStatus = STATUS_ALLOWS_REVIEW ? attrs.status : "feedback";

        if (decision.approved) {
            await recordPlanEventImpl({
                cwd,
                planName,
                event: "review_approved",
                currentStatus: postReopenStatus,
                details: { triageMeta },
            });
            uiAPI.appendSystemMessage(`[RunWield] ✅ Plan approved: ${planName}`);
        } else {
            await recordPlanEventImpl({
                cwd,
                planName,
                event: "review_feedback",
                currentStatus: postReopenStatus,
                details: { triageMeta, failureReason: decision.feedback },
            });
            uiAPI.appendSystemMessage(`[RunWield] Plan returned with feedback: ${planName}`);
        }

        const images = await loadReviewFeedbackImages(decision, cwd, uiAPI);
        return {
            approved: decision.approved,
            feedback: decision.feedback,
            ...(decision.savedPath && { savedPath: decision.savedPath }),
            ...(images.length > 0 && { images }),
        };
    } finally {
        planReviewCancelBySession.delete(hostedSession);
        if (uiAPI.enableInput) uiAPI.enableInput();
        // Ensure server is stopped regardless of outcome
        await server.stop();
    }
}
