/**
 * @module shared/session/session-runtime-interactions
 * Adapter-neutral interaction broker for HostedSession-bound prompts.
 */

import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";

export const RuntimeInteractionTypes = Object.freeze({
    SELECT: "select",
    TEXT: "text",
    APPROVAL: "approval",
    LINK: "link",
    PLAN_REVIEW: "plan_review",
    ARTIFACT_REVIEW: "artifact_review",
    CODE_REVIEW: "code_review",
    PAIR_CHECKPOINT: "pair_checkpoint",
    PLAN_DEVIATION_CONFIRMATION: "plan_deviation_confirmation",
});

export const RuntimeInteractionOutcomes = Object.freeze({
    SELECTED: "selected",
    TEXT: "text",
    ACCEPTED: "accepted",
    CANCELED: "canceled",
    UNSUPPORTED: "unsupported",
    BLOCKED: "blocked",
});

/**
 * @typedef {Object} RuntimeInteractionOption
 * @property {string} value
 * @property {string} label
 * @property {string} [description]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {Object} RuntimeInteractionRequest
 * @property {string} [id]
 * @property {"select"|"text"|"approval"|"link"|"plan_review"|"artifact_review"|"code_review"|"pair_checkpoint"|"plan_deviation_confirmation"} type
 * @property {string} prompt
 * @property {RuntimeInteractionOption[]} [options]
 * @property {string} [otherOptionValue] Choice whose answer can be supplied as free text in the same form.
 * @property {string} [defaultValue]
 * @property {string} [placeholder]
 * @property {boolean} [allowEmpty]
 * @property {string} [toolCallId]
 * @property {string} [reviewUrl]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {Object} RuntimeInteractionResponse
 * @property {"selected"|"text"|"accepted"|"canceled"|"unsupported"|"blocked"} outcome
 * @property {string|boolean} [value]
 * @property {string} [valueLabel]
 * @property {string} [otherText] Free text supplied alongside the selected Other choice.
 * @property {string} [message]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {Object} RuntimeInteractionAdapter
 * @property {(request: RuntimeInteractionRequest, signal?: AbortSignal) => Promise<RuntimeInteractionResponse>|RuntimeInteractionResponse} requestInteraction
 * @property {(type: string) => boolean} [supportsInteraction]
 * @property {() => void} [cancelAll]
 */

/**
 * @param {import('./hosted-session.js').HostedSession | undefined | null} hostedSession
 * @param {string} type
 * @returns {boolean}
 */
export function supportsHostedSessionInteraction(hostedSession, type) {
    const adapter = hostedSession?.getInteractionAdapter?.();
    if (!adapter || typeof adapter.supportsInteraction !== "function") return false;
    try {
        return adapter.supportsInteraction(type) === true;
    } catch {
        return false;
    }
}

/** @param {unknown} value */
function isAbortError(value) {
    return value instanceof DOMException && value.name === "AbortError";
}

/** @returns {string} */
export function createInteractionId() {
    return crypto.randomUUID();
}

/**
 * @param {Partial<RuntimeInteractionResponse>|undefined|null} response
 * @returns {RuntimeInteractionResponse}
 */
export function normalizeInteractionResponse(response) {
    if (!response || typeof response !== "object") {
        return {
            outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
            message: "Interaction adapter returned no response.",
        };
    }
    const outcome = response.outcome;
    if (Object.values(RuntimeInteractionOutcomes).includes(/** @type {any} */ (outcome))) {
        return /** @type {RuntimeInteractionResponse} */ ({ ...response, outcome });
    }
    return {
        outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
        message: `Unsupported interaction outcome: ${String(outcome)}`,
    };
}

/**
 * @param {unknown} error
 * @returns {RuntimeInteractionResponse}
 */
export function interactionErrorToResponse(error) {
    if (isAbortError(error)) return { outcome: RuntimeInteractionOutcomes.CANCELED, message: "Interaction canceled." };
    const message = error instanceof Error ? error.message : String(error || "Interaction failed.");
    return { outcome: RuntimeInteractionOutcomes.UNSUPPORTED, message };
}

/**
 * @param {RuntimeInteractionRequest} request
 * @param {string} value
 * @returns {boolean}
 */
export function isApprovalAcceptedValue(request, value) {
    const options = request.options || [];
    const option = options.find((item) => item.value === value);
    if (option?._meta?.accepted === true || option?._meta?.approvalOutcome === "accepted") return true;
    if (option?._meta?.accepted === false || option?._meta?.approvalOutcome === "declined") return false;
    const acceptedValues = [
        "accept",
        "accepted",
        "approve",
        "approved",
        "yes",
        "true",
        "proceed",
        "continue",
        "confirm",
        "ok",
    ];
    const normalizedValue = value.toLowerCase();
    const normalizedLabel = String(option?.label || "").toLowerCase();
    return acceptedValues.includes(normalizedValue) || acceptedValues.includes(normalizedLabel);
}

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {RuntimeInteractionRequest} request
 * @param {AbortSignal} [signal]
 * @param {import('./managed-operation.ts').ManagedOperationCapability | null} [capability]
 * @returns {Promise<RuntimeInteractionResponse>}
 */
export async function requestHostedSessionInteraction(hostedSession, request, signal, capability = null) {
    const currentCapability = hostedSession.getManagedOperationCapability?.() || null;
    if (hostedSession.getManagedMetadata?.() && (!capability || currentCapability !== capability)) {
        return {
            outcome: RuntimeInteractionOutcomes.BLOCKED,
            message: currentCapability
                ? "Interaction request blocked: another managed operation is active."
                : "Interaction request blocked: managed operation authority is required.",
        };
    }
    capability?.assertLive?.();
    if (request.type === RuntimeInteractionTypes.PLAN_REVIEW && capability) {
        const meta = request._meta || {};
        let planId = meta.reviewContainerPlanId || meta.planId;
        if (
            !planId && meta.triageMeta && typeof meta.triageMeta === "object" &&
            "planId" in meta.triageMeta
        ) {
            planId = meta.triageMeta.planId;
        }
        const planName = meta.reviewContainerPlanName || meta.planName;
        const planningAgentName = meta.planningAgentName;
        if (
            typeof planId !== "string" || !planId.trim() ||
            typeof planName !== "string" || !planName.trim() ||
            typeof planningAgentName !== "string" || !planningAgentName.trim() ||
            !capability.recordLastPlanReview
        ) {
            throw new Error("Plan review requires a Plan ID, name, and planning Agent with writer authority");
        }
        // The file store verifies the current writer proof and syncs the manifest
        // before the adapter can present the review. This is not a pending wait.
        capability.recordLastPlanReview({ planId, planName, planningAgentName });
    }
    const id = request.id || createInteractionId();
    const interaction = { ...request, id };
    if (
        request.type === RuntimeInteractionTypes.PLAN_REVIEW &&
        !Array.isArray(request._meta?.sequenceDocuments) &&
        typeof request._meta?.planPath === "string" &&
        !request._meta?.reviewedSource
    ) {
        // Keep file-backed review authority out of browser bundles that import
        // the shared interaction outcome helpers from this module.
        const { loadPlanFileStrict } = await import("../../plan-store.js");
        const { loadPlanActionEvidence } = await import("../workflow/plan-actions.ts");
        const { resolvePrimaryCheckoutRoot } = await import("../primary-checkout.ts");
        const source = await loadPlanFileStrict(request._meta.planPath);
        if (source.kind !== "loaded") {
            throw new Error("The Plan could not be opened for review. Your files have not been changed.");
        }
        const triage = request._meta.triageMeta;
        const planId = request._meta.reviewContainerPlanId || request._meta.planId ||
            (triage && typeof triage === "object" && "planId" in triage ? triage.planId : null);
        if (typeof planId !== "string" || source.attrs.planId !== planId) {
            throw new Error("The Plan identity changed before review. Reload the Plan and review again.");
        }
        const evidence = await loadPlanActionEvidence(resolvePrimaryCheckoutRoot(hostedSession.cwd), planId);
        if (evidence.kind !== "success") throw new Error(evidence.message);
        if (evidence.evidence.revision !== source.revision) {
            throw new Error("The Plan changed before review. Reload the Plan and review again.");
        }
        interaction._meta = {
            ...request._meta,
            expectedRevision: evidence.evidence.revision,
            expectedStatus: evidence.evidence.status,
            expectedWorktree: evidence.evidence.worktree,
            reviewedSource: {
                planName: request._meta.planName,
                path: source.path,
                markdown: source.markdown,
                revision: source.revision,
                attrs: source.attrs,
            },
        };
    }
    if (request.type === RuntimeInteractionTypes.PLAN_REVIEW) {
        const originalReady = request._meta?.onSurfaceReady;
        /** @param {string | {url: string}} surface */
        const onSurfaceReady = (surface) => {
            const url = typeof surface === "string" ? surface : surface?.url;
            if (typeof url === "string" && url) interaction.reviewUrl = url;
            if (typeof originalReady === "function") return originalReady(surface);
        };
        interaction._meta = { ...interaction._meta, onSurfaceReady };
    }
    const reviewMeta = request.type === RuntimeInteractionTypes.PLAN_REVIEW && request._meta
        ? {
            sequenceDocuments: request._meta.sequenceDocuments,
            planId: typeof request._meta.planId === "string" ? request._meta.planId : undefined,
            planName: typeof request._meta.planName === "string" ? request._meta.planName : undefined,
            classification: typeof request._meta.classification === "string" ? request._meta.classification : undefined,
            expectedRevision: typeof request._meta.expectedRevision === "string"
                ? request._meta.expectedRevision
                : undefined,
            expectedStatus: typeof request._meta.expectedStatus === "string" ? request._meta.expectedStatus : undefined,
            expectedWorktree: request._meta.expectedWorktree && typeof request._meta.expectedWorktree === "object"
                ? request._meta.expectedWorktree
                : undefined,
        }
        : undefined;
    emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.INTERACTION_REQUESTED,
        interactionId: id,
        interactionType: request.type,
        prompt: request.prompt,
        ...(reviewMeta && { review: reviewMeta }),
    });
    const adapter = hostedSession.getInteractionAdapter?.();
    if (!adapter || typeof adapter.requestInteraction !== "function") {
        const response = {
            outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
            message: "No interaction adapter is available for this session.",
        };
        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.INTERACTION_RESOLVED,
            interactionId: id,
            interactionType: request.type,
            outcome: response.outcome,
            message: response.message,
        });
        return response;
    }
    const abortController = new AbortController();
    /** @type {(() => void) | null} */
    let removeAbortListener = null;
    const operationSignal = capability?.signal || null;
    if (signal || operationSignal) {
        const abort = () => abortController.abort();
        signal?.addEventListener("abort", abort, { once: true });
        operationSignal?.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => {
            signal?.removeEventListener("abort", abort);
            operationSignal?.removeEventListener("abort", abort);
        };
    }
    const remoteAnswer = new Promise((resolve) => {
        hostedSession.addActiveInteraction(id, {
            request: interaction,
            abortController,
            answer: (response, source) => {
                if (!hostedSession.getActiveInteractions().has(id)) {
                    throw new Error("This question has already been answered.");
                }
                const normalized = normalizeInteractionResponse(response);
                if (
                    normalized.outcome === "text" && !interaction.allowEmpty && !String(normalized.value || "").trim()
                ) {
                    throw new Error("An answer is required.");
                }
                if (source) hostedSession.notificationSurface = source;
                hostedSession.removeActiveInteraction(id);
                resolve(normalized);
            },
        });
    });
    try {
        if (signal?.aborted || operationSignal?.aborted || abortController.signal.aborted) {
            const response = { outcome: RuntimeInteractionOutcomes.CANCELED, message: "Interaction canceled." };
            emitHostedSessionRuntimeEvent(hostedSession, {
                type: RuntimeEventTypes.INTERACTION_CANCELED,
                interactionId: id,
                interactionType: request.type,
                outcome: response.outcome,
                message: response.message,
            });
            return response;
        }
        const canceled = new Promise((resolve) => {
            abortController.signal.addEventListener(
                "abort",
                () => resolve({ outcome: RuntimeInteractionOutcomes.CANCELED, message: "Interaction canceled." }),
                { once: true },
            );
        });
        const response = normalizeInteractionResponse(
            /** @type {Partial<RuntimeInteractionResponse>} */ (await Promise.race([
                Promise.resolve(adapter.requestInteraction(interaction, abortController.signal)).then((response) => {
                    if (
                        response && ["selected", "text", "accepted"].includes(response.outcome || "") &&
                        hostedSession.getActiveInteractions().has(id) && hostedSession.localInputSurface
                    ) {
                        hostedSession.notificationSurface = hostedSession.localInputSurface;
                    }
                    return response;
                }),
                remoteAnswer,
                canceled,
            ])),
        );
        emitHostedSessionRuntimeEvent(hostedSession, {
            type: response.outcome === RuntimeInteractionOutcomes.CANCELED
                ? RuntimeEventTypes.INTERACTION_CANCELED
                : RuntimeEventTypes.INTERACTION_RESOLVED,
            interactionId: id,
            interactionType: request.type,
            outcome: response.outcome,
            message: response.message,
        });
        return response;
    } catch (error) {
        const response = interactionErrorToResponse(error);
        emitHostedSessionRuntimeEvent(hostedSession, {
            type: response.outcome === RuntimeInteractionOutcomes.CANCELED
                ? RuntimeEventTypes.INTERACTION_CANCELED
                : RuntimeEventTypes.INTERACTION_RESOLVED,
            interactionId: id,
            interactionType: request.type,
            outcome: response.outcome,
            message: response.message,
        });
        return response;
    } finally {
        removeAbortListener?.();
        hostedSession.removeActiveInteraction?.(id);
        // Dismiss the other surface's prompt after either surface answers.
        abortController.abort();
    }
}
