/**
 * @module submit-plan
 * RunWield function that submits a plan to the Plannotator review UI.
 *
 * Launches the review UI through review-launcher.js so a future Workspace-hosted
 * Plannotator surface can replace the compiled bridge behind one seam.
 */

import { injectFrontMatter, parsePlanFrontMatter } from "../../plan-store.js";
import { assertSharedPlanWriteAllowed } from "../collaboration/lock.js";
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
 */

// ─── Main Function ────────────────────────────────────────────────────

/**
 * Submit a plan for interactive review via the Plannotator browser UI.
 *
 * @param {Object} opts
 * @param {string} opts.cwd - Project root
 * @param {string} opts.planName - Plan filename (without .md)
 * @param {string} opts.planPath - Absolute path to the plan .md file
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} [opts.triageMeta] - Triage metadata to ensure in front matter
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI - UI API for output
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
        plan: planWithFm,
        htmlContent: __deps?.htmlContent,
        startPlanReviewServer: __deps?.startPlanReviewServer,
        openInDefaultBrowser: __deps?.openInDefaultBrowser,
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

        return {
            approved: decision.approved,
            feedback: decision.feedback,
        };
    } finally {
        planReviewCancelBySession.delete(hostedSession);
        if (uiAPI.enableInput) uiAPI.enableInput();
        // Ensure server is stopped regardless of outcome
        await server.stop();
    }
}
