/**
 * @module ui/review/plan-review
 * Browser plan-review consumer used by the terminal runtime adapter.
 *
 * Launches the review UI through review-launcher.js so a future Workspace-hosted
 * The browser surface is isolated here so core only requests a review.
 */

import { injectFrontMatter, parsePlanFrontMatter } from "../../plan-store.js";
import { isAbsolute, resolve } from "node:path";
import { assertSharedPlanWriteAllowed } from "../../shared/collaboration/lock.js";
import { mimeTypeForImagePath } from "../../shared/session/image-attachments.js";
import { recordPlanEvent } from "../../shared/workflow/plan-lifecycle.js";
import { startPlanReviewSurface } from "./review-launcher.js";

// Browser opening lives in review-launcher.js and is imported here for dependency injection types.

// ─── Types ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlanReviewResult
 * @property {boolean} approved - Whether the plan was approved
 * @property {boolean} [canceled] - Whether waiting for review was canceled via Esc
 * @property {string} [feedback] - User feedback/annotations (present when the user submits feedback or approves with notes)
 * @property {import('../../shared/workflow/plan-approval.js').PlanApprovalAction} [approvalAction] - Browser-selected post-approval action.
 * @property {import('../../plan-store.js').PlanFrontMatter} [planAttrs] - Canonical post-review Plan attributes.
 * @property {string} [savedPath] - Optional path where plan was saved (if available)
 * @property {Array<{base64: string, mimeType: string, name: string}>} [images] - Annotated feedback images for the agent
 */

/**
 * @typedef {Object} ReviewServerOutput
 * @property {"stdout" | "stderr"} stream
 * @property {string} text
 */

const MAX_REVIEW_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Read image attachments while the review decision and its temp files are
 * still available. Invalid attachments stay fail-soft so text feedback is not
 * lost when one image cannot be loaded.
 *
 * @param {any} decision
 * @param {string} cwd
 * @returns {Promise<Array<{base64: string, mimeType: string, name: string}>>}
 */
async function loadReviewFeedbackImages(decision, cwd) {
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
        } catch (_error) {
            // Text feedback remains valid if an uploaded image disappears.
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

/**
 * @param {any} decision
 * @returns {{ executionAgent: "engineer" | "frontend-engineer", collaborationRecommendation: "autonomous" | "pair" } | null}
 */
function readApprovedExecutionPolicy(decision) {
    const executionAgent = decision?.executionAgent;
    const collaborationRecommendation = decision?.collaborationRecommendation;
    if (executionAgent !== "engineer" && executionAgent !== "frontend-engineer") return null;
    if (collaborationRecommendation !== "autonomous" && collaborationRecommendation !== "pair") return null;
    return { executionAgent, collaborationRecommendation };
}

// ─── Main Function ────────────────────────────────────────────────────

/**
 * Submit a plan for interactive review via the browser review surface.
 *
 * @param {Object} opts
 * @param {string} opts.cwd - Project root
 * @param {string} opts.planName - Plan filename (without .md)
 * @param {string} opts.planPath - Absolute path to the plan .md file
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} [opts.triageMeta] - Triage metadata to ensure in front matter
 * @param {(output: { stream: "stdout" | "stderr", text: string }) => void} [opts.onOutput]
 * @param {AbortSignal} [opts.signal]
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
    onOutput,
    signal,
    __deps,
}) {
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

    const trustedClassification = fmOverrides.classification;
    const planWithFm = injectFrontMatter(body, fmOverrides);
    await Deno.writeTextFile(planPath, planWithFm);

    // 4. Start the review surface through an adapter seam.
    const server = await startPlanReviewSurfaceImpl({
        cwd,
        plan: planWithFm,
        planPath,
        htmlContent: __deps?.htmlContent,
        startPlanReviewServer: __deps?.startPlanReviewServer,
        openInDefaultBrowser: __deps?.openInDefaultBrowser,
        onOutput,
    });

    try {
        const canceled = new Promise((resolve) => {
            signal?.addEventListener("abort", () => resolve({ _cancelled: true }), { once: true });
        });
        const decision = await (signal ? Promise.race([server.waitForDecision(), canceled]) : server.waitForDecision());

        // Handle cancellation triggered from the TUI
        if (decision && typeof decision === "object" && "_cancelled" in decision) {
            return {
                approved: false,
                canceled: true,
                feedback: "Cancelled by user (Esc)",
            };
        }

        let reviewedPlan = typeof decision.plan === "string" ? decision.plan : planWithFm;
        const approvedPolicy = readApprovedExecutionPolicy(decision);
        const canonicalReviewOverrides = {
            classification: trustedClassification,
        };
        if (trustedClassification === "PROJECT") {
            Object.assign(canonicalReviewOverrides, {
                executionAgent: /** @type {any} */ (null),
                collaborationRecommendation: /** @type {any} */ (null),
                frontend: /** @type {any} */ (null),
            });
        } else if (decision.approved && approvedPolicy) {
            Object.assign(canonicalReviewOverrides, {
                executionAgent: approvedPolicy.executionAgent,
                collaborationRecommendation: approvedPolicy.collaborationRecommendation,
                frontend: /** @type {any} */ (null),
            });
        }
        reviewedPlan = injectFrontMatter(reviewedPlan, canonicalReviewOverrides);
        const reviewedAttrs = parsePlanFrontMatter(reviewedPlan).attrs;
        if (typeof decision.plan === "string" || decision.approved && approvedPolicy) {
            await Deno.writeTextFile(planPath, reviewedPlan);
        }

        // 6. Update status
        // If the plan is in a terminal/completed status (e.g. verified, implemented),
        // reopen it first so the review event can transition cleanly.
        const STATUS_ALLOWS_REVIEW = attrs.status === "draft" ||
            attrs.status === "feedback" ||
            attrs.status === "approved";

        let lifecycleMeta = reviewedAttrs;
        if (!STATUS_ALLOWS_REVIEW) {
            const reopenedMeta = await recordPlanEventImpl({
                cwd,
                planName,
                event: "review_reopened",
                currentStatus: attrs.status,
                details: { triageMeta: lifecycleMeta },
            });
            if (reopenedMeta) lifecycleMeta = { ...lifecycleMeta, ...reopenedMeta };
        }

        // Use the reopened status ("feedback") if we reopened, or the original if already reviewable
        const postReopenStatus = STATUS_ALLOWS_REVIEW ? attrs.status : "feedback";

        if (decision.approved) {
            const approvedMeta = await recordPlanEventImpl({
                cwd,
                planName,
                event: "review_approved",
                currentStatus: postReopenStatus,
                details: { triageMeta: lifecycleMeta },
            });
            if (approvedMeta) lifecycleMeta = { ...lifecycleMeta, ...approvedMeta };
        } else {
            const feedbackMeta = await recordPlanEventImpl({
                cwd,
                planName,
                event: "review_feedback",
                currentStatus: postReopenStatus,
                details: { triageMeta: lifecycleMeta, failureReason: decision.feedback },
            });
            if (feedbackMeta) lifecycleMeta = { ...lifecycleMeta, ...feedbackMeta };
        }

        const images = await loadReviewFeedbackImages(decision, cwd);
        return {
            approved: decision.approved,
            feedback: decision.feedback,
            ...(decision.approvalAction && { approvalAction: decision.approvalAction }),
            ...(decision.approved && { planAttrs: lifecycleMeta }),
            ...(decision.savedPath && { savedPath: decision.savedPath }),
            ...(images.length > 0 && { images }),
        };
    } finally {
        // Ensure server is stopped regardless of outcome
        await server.stop();
    }
}
