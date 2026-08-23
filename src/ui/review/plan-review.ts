/**
 * @module ui/review/plan-review
 * Browser plan-review consumer used by the terminal runtime adapter.
 *
 * Launches the review UI through review-launcher.js so a future Workspace-hosted
 * The browser surface is isolated here so core only requests a review.
 */

import { getPlanRevisionForText, injectFrontMatter, parsePlanFrontMatter } from "../../plan-store.js";
import { isAbsolute, resolve } from "node:path";
import { assertSharedPlanWriteAllowed } from "../../shared/collaboration/lock.js";
import { mimeTypeForImagePath } from "../../shared/session/image-attachments.js";
import { isAnsweredPlanReview } from "../../shared/workflow/plan-review-recovery.js";
import { applySharedPlanReviewDecision } from "../../shared/workflow/plan-review-actions.ts";
import { startPlanReviewSurface } from "./review-launcher.ts";
import type { PlanFrontMatter } from "../../plan-store.js";
import type { PlanApprovalAction } from "../../shared/workflow/plan-approval.js";
import type { BrowserPort } from "../../shared/browser-port.ts";

interface ReviewImageInput {
    path?: string;
    name?: string;
}

interface ReviewAnnotationInput {
    images?: ReviewImageInput[];
}

interface LoadedReviewImage {
    base64: string;
    mimeType: string;
    name: string;
}

interface PlanReviewDecision {
    approved?: boolean;
    canceled?: boolean;
    exit?: boolean;
    _cancelled?: boolean;
    feedback?: string;
    approvalAction?: PlanApprovalAction;
    plan?: string;
    savedPath?: string;
    executionAgent?: "engineer" | "frontend-engineer";
    collaborationRecommendation?: "autonomous" | "pair";
    images?: ReviewImageInput[];
    globalAttachments?: ReviewImageInput[];
    annotations?: ReviewAnnotationInput[];
    codeAnnotations?: ReviewAnnotationInput[];
}

export interface PlanReviewResult {
    [key: string]: string | boolean | PlanApprovalAction | PlanFrontMatter | LoadedReviewImage[] | undefined;
    approved: boolean;
    canceled?: boolean;
    cancellationReason?: string;
    feedback?: string;
    approvalAction?: PlanApprovalAction;
    planAttrs?: PlanFrontMatter;
    revision?: string;
    savedPath?: string;
    images?: LoadedReviewImage[];
}

interface ReviewServerOutput {
    stream: "stdout" | "stderr";
    text: string;
}

interface ReviewSurfaceReady {
    url: string;
    opened: boolean;
}

interface SubmitPlanForReviewOptions {
    cwd: string;
    planName: string;
    planPath: string;
    previousPlan?: string;
    planVersions?: Array<{ plan: string; timestamp: string }>;
    triageMeta?: Partial<PlanFrontMatter>;
    onOutput?(output: ReviewServerOutput): void;
    onSurfaceReady?(surface: ReviewSurfaceReady): void;
    signal?: AbortSignal;
    browser: BrowserPort;
}

const MAX_REVIEW_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Read image attachments while the review decision and its temp files are
 * still available. Invalid attachments stay fail-soft so text feedback is not
 * lost when one image cannot be loaded.
 */
async function loadReviewFeedbackImages(
    decision: PlanReviewDecision,
    cwd: string,
): Promise<LoadedReviewImage[]> {
    const attachments = collectReviewImageAttachments(decision);
    const images: LoadedReviewImage[] = [];
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

function collectReviewImageAttachments(decision: PlanReviewDecision): Array<{ path: string; name: string }> {
    const candidates = [
        ...readReviewImageAttachments(decision?.images),
        ...readReviewImageAttachments(decision?.globalAttachments),
        ...(Array.isArray(decision?.annotations) ? decision.annotations.flatMap(readAnnotationImageAttachments) : []),
        ...(Array.isArray(decision?.codeAnnotations)
            ? decision.codeAnnotations.flatMap(readAnnotationImageAttachments)
            : []),
    ];
    const seen = new Set<string>();
    return candidates.filter((image) => {
        if (seen.has(image.path)) return false;
        seen.add(image.path);
        return true;
    });
}

function readAnnotationImageAttachments(annotation: ReviewAnnotationInput): Array<{ path: string; name: string }> {
    return readReviewImageAttachments(annotation?.images);
}

function readReviewImageAttachments(value?: ReviewImageInput[]): Array<{ path: string; name: string }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((image) => {
        const path = typeof image.path === "string" ? image.path.trim() : "";
        if (!path) return [];
        const name = typeof image?.name === "string" && image.name.trim() ? image.name.trim() : "image";
        return [{ path, name }];
    });
}

function bytesToBase64(bytes: Uint8Array): string {
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return btoa(chunks.join(""));
}

// ─── Main Function ────────────────────────────────────────────────────

/**
 * Submit a plan for interactive review via the browser review surface.
 */
export async function submitPlanForReview({
    cwd,
    planName,
    planPath,
    previousPlan,
    planVersions,
    triageMeta,
    onOutput,
    onSurfaceReady,
    signal,
    browser,
}: SubmitPlanForReviewOptions): Promise<PlanReviewResult> {
    // 1. Read plan
    const planContent = await Deno.readTextFile(planPath);
    const planRevision = await getPlanRevisionForText(planContent);

    // 2. Ensure front matter is present and up to date
    const { attrs, body } = parsePlanFrontMatter(planContent);
    assertSharedPlanWriteAllowed(attrs);
    const fmOverrides: Partial<PlanFrontMatter> = {
        ...attrs,
        updatedAt: new Date().toISOString(),
    };

    if (triageMeta) {
        if (triageMeta.classification) {
            fmOverrides.classification = triageMeta.classification;
        }
        if (triageMeta.workKind) fmOverrides.workKind = triageMeta.workKind;
        if (triageMeta.complexity) fmOverrides.complexity = triageMeta.complexity;
        if (triageMeta.summary) fmOverrides.summary = triageMeta.summary;
        if (triageMeta.affectedPaths) {
            fmOverrides.affectedPaths = triageMeta.affectedPaths;
        }
    }

    const trustedClassification = fmOverrides.classification;
    const trustedWorkKind = fmOverrides.workKind;
    const planWithFm = injectFrontMatter(body, fmOverrides);

    // 4. Start the real review surface; only browser opening crosses the port.
    const server = await startPlanReviewSurface<PlanReviewDecision>({
        cwd,
        plan: planWithFm,
        planPath,
        previousPlan,
        planVersions,
        browser,
        onOutput,
        onSurfaceReady,
    });

    try {
        const canceled = new Promise<PlanReviewDecision>((resolveCanceled) => {
            if (signal?.aborted) {
                resolveCanceled({ _cancelled: true });
                return;
            }
            signal?.addEventListener("abort", () => resolveCanceled({ _cancelled: true }), { once: true });
        });
        const decision: PlanReviewDecision = await (
            signal ? Promise.race([server.waitForDecision(), canceled]) : server.waitForDecision()
        );

        // Handle cancellation triggered from the TUI or review timeout/exit before
        // writing edited review content or recording Plan Review lifecycle events.
        if (decision._cancelled) {
            return {
                approved: false,
                canceled: true,
                feedback: "Cancelled by user (Esc)",
                cancellationReason: "abort_signal",
            };
        }
        if (decision?.canceled || decision?.exit) {
            return {
                approved: false,
                canceled: true,
                feedback: typeof decision.feedback === "string" ? decision.feedback : "",
                cancellationReason: decision.exit ? "review_exit" : "review_canceled",
            };
        }
        if (!isAnsweredPlanReview(decision)) {
            return {
                approved: false,
                feedback: typeof decision?.feedback === "string" ? decision.feedback : "",
                cancellationReason: "malformed_review_response",
            };
        }

        const actionResult = await applySharedPlanReviewDecision({
            cwd,
            planName,
            planPath,
            planWithFrontMatter: planWithFm,
            planRevision,
            originalAttrs: attrs,
            trustedClassification,
            trustedWorkKind,
            decision,
        });

        const images = await loadReviewFeedbackImages(decision, cwd);
        return {
            ...actionResult,
            ...(decision.savedPath && { savedPath: decision.savedPath }),
            ...(images.length > 0 && { images }),
        };
    } finally {
        // Ensure server is stopped regardless of outcome
        await server.stop();
    }
}
