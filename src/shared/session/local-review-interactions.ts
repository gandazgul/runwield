// @ts-nocheck: local review bridge forwards JS Runtime interaction metadata to review launchers.
/**
 * @module shared/session/local-review-interactions
 * Runs local browser review surfaces for adapter-neutral Runtime interactions.
 */

import { SYSTEM_BROWSER_PORT } from "../browser-port.ts";
import { RuntimeInteractionOutcomes, RuntimeInteractionTypes } from "./session-runtime-interactions.js";
import { runCodeReview } from "../../ui/review/code-review.ts";
import { submitPlanForReview } from "../../ui/review/plan-review.ts";
import { startArtifactReadSurface } from "../../ui/review/review-launcher.ts";

/**
 * @param {import('./session-runtime-interactions.js').RuntimeInteractionRequest} request
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<import('./session-runtime-interactions.js').RuntimeInteractionResponse>}
 */
export async function requestLocalReviewInteraction(request, signal) {
    const meta = /** @type {Record<string, any>} */ (request._meta || {});
    if (request.type === RuntimeInteractionTypes.PLAN_REVIEW) {
        const result = await submitPlanForReview({
            cwd: meta.cwd,
            sequenceDocuments: meta.sequenceDocuments,
            planName: meta.planName,
            planPath: meta.planPath,
            previousPlan: typeof meta.previousPlan === "string" ? meta.previousPlan : undefined,
            planVersions: Array.isArray(meta.planVersions) ? meta.planVersions : undefined,
            reviewConversation: meta.reviewConversation,
            agentLabel: typeof meta.agentLabel === "string" ? meta.agentLabel : undefined,
            triageMeta: meta.triageMeta,
            onOutput: typeof meta.onOutput === "function" ? meta.onOutput : undefined,
            onSurfaceReady: typeof meta.onSurfaceReady === "function" ? meta.onSurfaceReady : undefined,
            signal,
            browser: SYSTEM_BROWSER_PORT,
        });
        return {
            outcome: result.canceled
                ? RuntimeInteractionOutcomes.CANCELED
                : result.approved
                ? RuntimeInteractionOutcomes.ACCEPTED
                : RuntimeInteractionOutcomes.SELECTED,
            _meta: result,
        };
    }
    if (request.type === RuntimeInteractionTypes.CODE_REVIEW) {
        const result = await runCodeReview({
            planName: meta.planName,
            planTitle: meta.planTitle,
            diffText: meta.diffText,
            planContent: meta.planContent,
            planAttrs: meta.planAttrs,
            executionCwd: meta.executionCwd,
            baselineTree: typeof meta.baselineTree === "string" ? meta.baselineTree : undefined,
            guidedReview: meta.guidedReview,
            reviewConversation: meta.reviewConversation,
            agentLabel: typeof meta.agentLabel === "string" ? meta.agentLabel : undefined,
            signal,
            browser: SYSTEM_BROWSER_PORT,
            onSurfaceReady: typeof meta.onSurfaceReady === "function" ? meta.onSurfaceReady : undefined,
        });
        return {
            outcome: result.canceled || result.exit
                ? RuntimeInteractionOutcomes.CANCELED
                : result.approved
                ? RuntimeInteractionOutcomes.ACCEPTED
                : RuntimeInteractionOutcomes.SELECTED,
            _meta: result,
        };
    }
    if (request.type === RuntimeInteractionTypes.ARTIFACT_REVIEW) {
        const supportedKinds = new Set(["plan", "prd", "adr", "work-record", "epic-artifact", "report"]);
        const artifactKind = supportedKinds.has(meta.artifactKind) ? meta.artifactKind : "report";
        const surface = await startArtifactReadSurface({
            cwd: meta.cwd,
            markdown: meta.markdown,
            artifactKind,
            title: meta.title,
            path: meta.artifactPath,
            browser: SYSTEM_BROWSER_PORT,
        });
        try {
            return {
                outcome: RuntimeInteractionOutcomes.TEXT,
                value: "",
                _meta: { url: surface.url },
            };
        } finally {
            await surface.stop();
        }
    }
    return {
        outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
        message: `Unsupported review interaction type: ${request.type}`,
    };
}
