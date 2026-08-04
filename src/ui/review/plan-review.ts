/**
 * @module ui/review/plan-review
 * Browser plan-review consumer used by the terminal runtime adapter.
 *
 * Launches the review UI through review-launcher.js so a future Workspace-hosted
 * The browser surface is isolated here so core only requests a review.
 */

import {
    getPlanRevisionForText,
    getStoredPlanPath,
    injectFrontMatter,
    loadPlan,
    parsePlanFrontMatter,
    StalePlanWriteError,
    writePlanMarkdownWithRevision,
} from "../../plan-store.js";
import { isAbsolute, resolve } from "node:path";
import { assertSharedPlanWriteAllowed } from "../../shared/collaboration/lock.js";
import { mimeTypeForImagePath } from "../../shared/session/image-attachments.js";
import {
    buildPlanEventUpdates,
    isPlanReviewableWithoutReopen,
    recordPlanEvent,
} from "../../shared/workflow/plan-lifecycle.js";
import { runPlanReviewDecisionTransition } from "../../shared/workflow/state-transition.ts";
import {
    findById as findWorktreeById,
    updateEntry as updateWorktreeRegistryEntry,
} from "../../shared/worktree-registry.js";
import { isAnsweredPlanReview } from "../../shared/workflow/plan-review-recovery.js";
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

/** */
function readApprovedExecutionPolicy(
    decision: PlanReviewDecision,
): { executionAgent: "engineer" | "frontend-engineer"; collaborationRecommendation: "autonomous" | "pair" } | null {
    const executionAgent = decision?.executionAgent;
    const collaborationRecommendation = decision?.collaborationRecommendation;
    if (executionAgent !== "engineer" && executionAgent !== "frontend-engineer") return null;
    if (collaborationRecommendation !== "autonomous" && collaborationRecommendation !== "pair") return null;
    return { executionAgent, collaborationRecommendation };
}

// ─── Main Function ────────────────────────────────────────────────────

/**
 * Submit a plan for interactive review via the browser review surface.
 */
export async function submitPlanForReview({
    cwd,
    planName,
    planPath,
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

        const approved = decision.approved === true;
        let reviewedPlan = typeof decision.plan === "string" ? decision.plan : planWithFm;
        const approvedPolicy = readApprovedExecutionPolicy(decision);
        const canonicalReviewOverrides = {
            classification: trustedClassification,
            ...(trustedWorkKind ? { workKind: trustedWorkKind } : {}),
        };
        if (trustedClassification === "PROJECT") {
            Object.assign(canonicalReviewOverrides, {
                executionAgent: null,
                collaborationRecommendation: null,
                frontend: null,
            });
        } else if (approved && approvedPolicy) {
            Object.assign(canonicalReviewOverrides, {
                executionAgent: approvedPolicy.executionAgent,
                collaborationRecommendation: approvedPolicy.collaborationRecommendation,
                frontend: null,
            });
        }
        reviewedPlan = injectFrontMatter(reviewedPlan, canonicalReviewOverrides);
        const reviewedAttrs = parsePlanFrontMatter(reviewedPlan).attrs;
        const canonicalPlanPath = getStoredPlanPath(cwd, planName);
        let lifecycleMeta: PlanFrontMatter = reviewedAttrs;
        let committedRevision: string | undefined;
        if (resolve(canonicalPlanPath) === resolve(planPath)) {
            // Reviewing a Plan that already ran detaches it from its execution
            // generation. That detachment is two writes — the Plan's Front Matter and
            // the registry entry — and they belong to one transaction: an approval
            // that landed while the entry stayed live leaves the next execution
            // pointing at a worktree the Plan no longer owns.
            const reopenWorktreeId = isPlanReviewableWithoutReopen(attrs.status)
                ? undefined
                : attrs.worktreeId ?? undefined;
            const reviewTransition = await runPlanReviewDecisionTransition({
                projectRoot: cwd,
                planName,
                approved,
                worktreeId: reopenWorktreeId,
                expectedRevision: planRevision,
                decide: async ({ beforePlan, markEffect, registerRollback }) => {
                    if (!beforePlan) throw new Error(`Plan not found: ${planName}`);
                    if (beforePlan.revision !== planRevision) {
                        throw new Error(
                            "Plan changed after review opened; reload the review before applying this decision.",
                        );
                    }
                    let nextMarkdown = reviewedPlan;
                    let nextAttrs = reviewedAttrs;
                    let status = beforePlan.attrs.status;
                    if (!isPlanReviewableWithoutReopen(status)) {
                        const reopenUpdates = buildPlanEventUpdates("review_reopened", status, {
                            triageMeta: nextAttrs,
                        });
                        nextMarkdown = injectFrontMatter(nextMarkdown, reopenUpdates);
                        nextAttrs = parsePlanFrontMatter(nextMarkdown).attrs;
                        status = "feedback";
                        if (reopenWorktreeId) {
                            const before = await findWorktreeById(cwd, reopenWorktreeId);
                            registerRollback(`restore worktree registry status for ${reopenWorktreeId}`, async () => {
                                if (before?.status) {
                                    await updateWorktreeRegistryEntry(cwd, reopenWorktreeId, {
                                        status: before.status,
                                    });
                                }
                            });
                            await updateWorktreeRegistryEntry(cwd, reopenWorktreeId, { status: "abandoned" });
                            await markEffect("worktree_registry_abandoned", { worktreeId: reopenWorktreeId });
                        }
                    }
                    const event = approved ? "review_approved" : "review_feedback";
                    const eventUpdates = buildPlanEventUpdates(event, status, {
                        triageMeta: nextAttrs,
                        failureReason: decision.feedback,
                    });
                    nextMarkdown = injectFrontMatter(nextMarkdown, eventUpdates);
                    nextAttrs = parsePlanFrontMatter(nextMarkdown).attrs;
                    const revision = await writePlanMarkdownWithRevision(
                        beforePlan.path,
                        nextMarkdown,
                        beforePlan.revision,
                    );
                    return { attrs: nextAttrs, revision };
                },
            });
            if (reviewTransition.status !== "committed") {
                return {
                    approved: false,
                    feedback: reviewTransition.message ||
                        "Plan changed while review was open. Reload the Plan and review again.",
                    cancellationReason: "stale_plan_review",
                };
            }
            const transitionValue = reviewTransition.value as
                | { attrs?: PlanFrontMatter; revision?: string }
                | undefined;
            lifecycleMeta = transitionValue?.attrs || reviewedAttrs;
            committedRevision = transitionValue?.revision;
        } else {
            try {
                committedRevision = await writePlanMarkdownWithRevision(planPath, reviewedPlan, planRevision);
            } catch (error) {
                if (error instanceof StalePlanWriteError) {
                    return {
                        approved: false,
                        feedback: "Plan changed while review was open. Reload the Plan and review again.",
                        cancellationReason: "stale_plan_review",
                    };
                }
                throw error;
            }

            // External/non-canonical review paths keep the legacy two-step behavior.
            const STATUS_ALLOWS_REVIEW = isPlanReviewableWithoutReopen(attrs.status);
            if (!STATUS_ALLOWS_REVIEW) {
                const reopenedMeta = await recordPlanEvent({
                    cwd,
                    planName,
                    event: "review_reopened",
                    currentStatus: attrs.status,
                    details: { triageMeta: lifecycleMeta },
                    expectedRevision: committedRevision,
                });
                if (reopenedMeta) lifecycleMeta = { ...lifecycleMeta, ...reopenedMeta };
            }
            const postReopenStatus = STATUS_ALLOWS_REVIEW ? attrs.status : "feedback";
            if (approved) {
                const approvedMeta = await recordPlanEvent({
                    cwd,
                    planName,
                    event: "review_approved",
                    currentStatus: postReopenStatus,
                    details: { triageMeta: lifecycleMeta },
                    expectedRevision: committedRevision,
                });
                if (approvedMeta) lifecycleMeta = { ...lifecycleMeta, ...approvedMeta };
            } else {
                const feedbackMeta = await recordPlanEvent({
                    cwd,
                    planName,
                    event: "review_feedback",
                    currentStatus: postReopenStatus,
                    details: { triageMeta: lifecycleMeta, failureReason: decision.feedback },
                    expectedRevision: committedRevision,
                });
                if (feedbackMeta) lifecycleMeta = { ...lifecycleMeta, ...feedbackMeta };
            }
            const latestPlan = await loadPlan(cwd, planName).catch(() => null);
            if (latestPlan?.revision) committedRevision = latestPlan.revision;
        }

        const images = await loadReviewFeedbackImages(decision, cwd);
        return {
            approved,
            feedback: decision.feedback,
            ...(decision.approvalAction && { approvalAction: decision.approvalAction }),
            ...(approved && { planAttrs: lifecycleMeta }),
            ...(committedRevision && { revision: committedRevision }),
            ...(decision.savedPath && { savedPath: decision.savedPath }),
            ...(images.length > 0 && { images }),
        };
    } finally {
        // Ensure server is stopped regardless of outcome
        await server.stop();
    }
}
