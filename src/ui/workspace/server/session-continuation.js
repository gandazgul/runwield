/* @module ui/workspace/server/session-continuation */

import { createHash } from "node:crypto";
import { AGENTS } from "../../../constants.js";
import { findPlanEvidenceById } from "../../../plan-store.js";
import { applySharedPlanReviewDecision } from "../../../shared/workflow/plan-review-actions.ts";
import {
    createSessionRuntime,
    deriveManagedSessionContinuationDecision,
} from "../../../shared/session/session-runtime.js";
import { getRunWieldSessionDir } from "../../../shared/session/root-session.js";
import { projectAggregateTranscript } from "../../../shared/session/session-transcript-manifest.ts";
import {
    captureTranscriptEvidence,
    getCommittedTranscriptAuthorityFacts,
    validateExpiredControlTranscriptEvidence,
} from "../../../shared/session/session-transcript-projection.js";
import { requireOwnerProjectRoot, sessionBelongsToOwnerProject } from "./owner-projects.js";

/** @param {unknown} value */
function stableHash(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** @param {unknown} error */
function codeFromError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not enabled")) return "rollout_disabled";
    if (message.includes("reconcile")) return "reconcile_required";
    if (message.includes("activation")) return "activation_unavailable";
    return "invalid_state";
}

/** @template T @param {T | null} receipt @returns {T} */
function requireReceipt(receipt) {
    if (!receipt) throw new Error("Operation receipt was not created.");
    return receipt;
}

/** @param {{ ok: boolean, events?: unknown[], segments?: unknown[] }} projection */
function browserTimelineProjection(projection) {
    if (!projection.ok) return projection;
    return {
        ...projection,
        events: Array.isArray(projection.events)
            ? projection.events.map((event) => {
                if (!event || typeof event !== "object") return event;
                const { _meta, ...safeEvent } = /** @type {Record<string, unknown>} */ (event);
                return safeEvent;
            })
            : projection.events,
        segments: Array.isArray(projection.segments) ? projection.segments : [],
    };
}

/** @param {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} request */
function safePlanReviewReference(request) {
    const meta = request._meta && typeof request._meta === "object" ? request._meta : {};
    const planId = typeof meta.planId === "string" && meta.planId.trim()
        ? meta.planId.trim()
        : typeof meta.planName === "string" && meta.planName.trim()
        ? meta.planName.trim()
        : "";
    if (!planId) return null;
    const planName = typeof meta.planName === "string" && meta.planName.trim() ? meta.planName.trim() : planId;
    const triageMeta = meta.triageMeta && typeof meta.triageMeta === "object"
        ? /** @type {Record<string, unknown>} */ (meta.triageMeta)
        : {};
    const classification = typeof meta.classification === "string" && meta.classification.trim()
        ? meta.classification.trim()
        : typeof triageMeta.classification === "string"
        ? triageMeta.classification
        : "PLANNED_CHANGE";
    return {
        planId,
        planName,
        classification,
        expectedRevision: typeof meta.expectedRevision === "string" ? meta.expectedRevision : null,
        expectedStatus: typeof meta.expectedStatus === "string" ? meta.expectedStatus : null,
        expectedWorktree: meta.expectedWorktree && typeof meta.expectedWorktree === "object"
            ? meta.expectedWorktree
            : null,
        previousPlan: typeof meta.previousPlan === "string" && meta.previousPlan.trim() ? meta.previousPlan : null,
        planVersions: Array.isArray(meta.planVersions)
            ? meta.planVersions.flatMap((entry) =>
                entry && typeof entry === "object" && typeof entry.plan === "string"
                    ? [{
                        plan: entry.plan,
                        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
                    }]
                    : []
            )
            : [],
    };
}

/** @param {unknown} response */
function readPlanReviewDecisionMeta(response) {
    if (!response || typeof response !== "object") return {};
    const source = /** @type {Record<string, unknown>} */ (response);
    return source._meta && typeof source._meta === "object"
        ? /** @type {Record<string, unknown>} */ (source._meta)
        : source;
}

/** @param {unknown} response */
function acceptedInteractionResponse(response) {
    if (response && typeof response === "object") {
        const source = /** @type {Record<string, unknown>} */ (response);
        if (source.outcome === "accepted" && source._meta && typeof source._meta === "object") return source;
        return { outcome: "accepted", _meta: source };
    }
    return { outcome: "unsupported", message: "Plan review response is invalid." };
}

/** @param {import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore} store @param {{ transcriptCwd: string }} session @param {string} projectId */
/**
 * @typedef {Object} WorkspaceOperationRecord
 * @property {string} status
 * @property {string} projectId
 * @property {unknown[]} events
 * @property {string} [error]
 * @property {number | null} [generation]
 * @property {string | null} [runwieldSessionId]
 * @property {{ interactionId: string, request: Record<string, unknown> }} [liveInteraction]
 * @property {{ resolve: (value: unknown) => void, reject: (error: Error) => void } | null} [answer]
 */

export class WorkspaceSessionContinuationService {
    /**
     * @param {{ store: import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore }} options
     */
    constructor(options) {
        this.store = options.store;
        this.ownerInstanceId = crypto.randomUUID();
        this.runtime = createSessionRuntime({
            sessionStore: this.store,
            ownerProcessKind: "workspace",
            ownerInstanceId: this.ownerInstanceId,
        });
        /** @type {Map<string, WorkspaceOperationRecord>} */
        this.operations = new Map();
        /** @type {Map<string, { requestHash: string, operationId: string }>} */
        this.createRequests = new Map();
    }

    close() {
        this.runtime.closeAllSessionsWhenIdle?.();
    }

    /** @param {string} projectId */
    async listSessions(projectId) {
        const { sessions, diagnostics } = await this.store.listProjectSessions(projectId, { catalog: true });
        return {
            diagnostics,
            sessions: await Promise.all(sessions.map(async (session) => {
                let inspected = this.store.inspectSessionActivation(session.runwieldSessionId);
                if (
                    !inspected.generation &&
                    ["uninitialized", "uncertain", "reconcile_required"].includes(inspected.activation?.state || "")
                ) {
                    try {
                        await this.runtime.ensureInitialSessionGeneration(session.runwieldSessionId);
                        inspected = this.store.inspectSessionActivation(session.runwieldSessionId);
                    } catch {
                        // A genuinely damaged transcript stays blocked and visible.
                    }
                }
                return {
                    runwieldSessionId: session.runwieldSessionId,
                    projectId,
                    displayName: session.displayName,
                    state: inspected.activation?.state || "missing_activation",
                    generation: inspected.generation?.generation ?? null,
                    activeSurface: inspected.activation?.state === "active"
                        ? inspected.activation.ownerProcessKind
                        : null,
                    recoveryCategory: inspected.activation?.state === "active"
                        ? "wait_for_owner"
                        : inspected.activation?.state || "idle",
                    bootstrapRequired: inspected.activation?.state === "uninitialized",
                };
            })),
        };
    }

    /**
     * @param {string} runwieldSessionId
     * @param {{ projectId?: string, cursorEventId?: string, limit?: number }} [options]
     */
    async timeline(runwieldSessionId, options = {}) {
        const session = this.store.getSessionById(runwieldSessionId);
        if (
            !session || (options.projectId && !sessionBelongsToOwnerProject(this.store, session, options.projectId))
        ) {
            throw new Error("Session not found.");
        }
        let inspected = this.store.inspectSessionActivation(runwieldSessionId);
        if (
            !inspected.generation &&
            ["uninitialized", "uncertain", "reconcile_required"].includes(inspected.activation?.state || "")
        ) {
            await this.runtime.ensureInitialSessionGeneration(runwieldSessionId);
            inspected = this.store.inspectSessionActivation(runwieldSessionId);
        }
        const state = inspected.activation?.state || "uninitialized";
        const activeSurface = state === "active" ? inspected.activation?.ownerProcessKind || null : null;
        if (!inspected.generation) {
            return {
                state,
                activeSurface,
                recoveryCategory: state,
                bootstrapRequired: true,
                generation: null,
                complete: true,
                events: [],
            };
        }
        const projection = await projectAggregateTranscript({
            cwd: session.transcriptCwd,
            sessionDir: getRunWieldSessionDir(session.transcriptCwd),
            runwieldSessionId,
            generation: inspected.generation,
            segments: this.store.listSessionTranscriptSegments(runwieldSessionId),
            cursorEventId: options.cursorEventId,
            limit: options.limit,
        });
        return {
            state: state || "idle",
            activeSurface,
            recoveryCategory: state || "idle",
            bootstrapRequired: false,
            ...browserTimelineProjection(projection),
        };
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, runwieldSessionId: string, requestId: string }} options
     */
    async bootstrap(options) {
        const session = this.store.getSessionById(options.runwieldSessionId);
        if (!session || !sessionBelongsToOwnerProject(this.store, session, options.projectId)) {
            throw new Error("Session not found.");
        }
        const receipt = requireReceipt(this.store.createOrGetOperationReceipt({
            deviceId: options.deviceId || null,
            requestId: options.requestId,
            requestHash: stableHash({ kind: "bootstrap", session: options.runwieldSessionId }),
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            expectedGeneration: null,
            kind: "bootstrap",
        }));
        const existing = this.store.inspectSessionActivation(options.runwieldSessionId);
        if (existing.generation) {
            return {
                operationId: receipt.operationId,
                generation: existing.generation.generation,
                status: "completed",
            };
        }
        if (["uncertain", "reconcile_required"].includes(existing.activation?.state || "")) {
            const recovered = await this.runtime.ensureInitialSessionGeneration(options.runwieldSessionId);
            const generation = recovered.generation?.generation ?? 0;
            this.store.updateOperationReceipt(receipt.operationId, {
                status: "completed",
                resultGeneration: generation,
            });
            return { operationId: receipt.operationId, generation, status: "completed" };
        }
        const proof = this.store.acquireSessionActivation({
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            ownerInstanceId: this.ownerInstanceId,
            ownerProcessKind: "workspace",
            operationId: receipt.operationId,
            expectedGeneration: null,
            phase: "bootstrap",
        });
        try {
            const evidence = await captureTranscriptEvidence({
                transcriptPath: session.transcriptPath,
                transcriptCwd: session.transcriptCwd,
            });
            const checkpointProof = this.store.changeSessionActivationPhase(proof, "checkpointing");
            this.store.publishGenerationAndRelease(checkpointProof, {
                generation: 0,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
            });
            this.store.updateOperationReceipt(receipt.operationId, { status: "completed", resultGeneration: 0 });
            return { operationId: receipt.operationId, generation: 0, status: "completed" };
        } catch (error) {
            const errorCode = codeFromError(error);
            this.store.markSessionReconcileRequired({
                runwieldSessionId: options.runwieldSessionId,
                projectId: options.projectId,
            }, { reason: errorCode });
            this.store.updateOperationReceipt(receipt.operationId, {
                status: "failed",
                errorCode,
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * @param {{ operationId: string }} options
     */
    createInteractionAdapter(options) {
        return {
            supportsInteraction: () => true,
            /** @param {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} request */
            requestInteraction: (request) => {
                const interactionId = String(request.id || crypto.randomUUID());
                return new Promise((resolve, reject) => {
                    const current = this.operations.get(options.operationId);
                    if (!current || current.status !== "running") {
                        reject(new Error("Workspace operation is not running."));
                        return;
                    }
                    const planReview = request.type === "plan_review" ? safePlanReviewReference(request) : null;
                    const reviewUrl = planReview
                        ? `/projects/${encodeURIComponent(current.projectId)}/plans/${
                            encodeURIComponent(planReview.planId)
                        }?session=${encodeURIComponent(current.runwieldSessionId || "")}&operation=${
                            encodeURIComponent(options.operationId)
                        }&interaction=${encodeURIComponent(interactionId)}`
                        : null;
                    this.operations.set(options.operationId, {
                        ...current,
                        liveInteraction: {
                            interactionId,
                            request: {
                                id: interactionId,
                                type: request.type,
                                prompt: request.prompt,
                                options: Array.isArray(request.options)
                                    ? request.options.map(
                                        /** @param {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionOption} option */ (
                                            option,
                                        ) => ({
                                            value: option.value,
                                            label: option.label,
                                            description: option.description,
                                        }),
                                    )
                                    : [],
                                defaultValue: request.defaultValue,
                                placeholder: request.placeholder,
                                allowEmpty: request.allowEmpty === true,
                                ...(planReview && { planReview, reviewUrl }),
                            },
                        },
                        answer: { resolve, reject },
                    });
                });
            },
            cancelAll: () => {
                const current = this.operations.get(options.operationId);
                current?.answer?.reject(new Error("Interaction canceled."));
            },
        };
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, requestId: string, text: string }} options
     */
    async createSession(options) {
        if (!options.text || typeof options.text !== "string") throw new Error("User Request is required.");
        await Promise.resolve();
        const project = this.store.getProjectById(options.projectId);
        if (!project || project.lifecycle !== "enabled") throw new Error("Project not found.");
        const requestHash = stableHash({ kind: "create", projectId: options.projectId, text: options.text });
        const createKey = `${options.deviceId || ""}:${options.projectId}:${options.requestId}`;
        const existing = this.createRequests.get(createKey);
        if (existing) {
            if (existing.requestHash !== requestHash) {
                throw new Error("Operation request id was reused with different input");
            }
            const operation = this.operations.get(existing.operationId);
            return {
                operationId: existing.operationId,
                status: operation?.status || "running",
                runwieldSessionId: operation?.runwieldSessionId || null,
                generation: operation?.generation ?? null,
            };
        }
        const operationId = crypto.randomUUID();
        this.createRequests.set(createKey, { requestHash, operationId });
        this.operations.set(operationId, {
            status: "running",
            projectId: options.projectId,
            events: [],
            runwieldSessionId: null,
        });
        queueMicrotask(async () => {
            let sessionId = "";
            let unsubscribe = () => {};
            try {
                const created = await this.runtime.createInteractiveSession({
                    cwd: project.currentRoot,
                    mode: "new",
                    deferManagedActivationUntilAgentReady: true,
                });
                sessionId = created.sessionId;
                this.runtime.setInteractionAdapter(sessionId, this.createInteractionAdapter({ operationId }));
                unsubscribe = this.runtime.subscribeSessionEvents(sessionId, (event) => {
                    const record = this.operations.get(operationId);
                    if (record && record.events.length < 500) record.events.push(event);
                });
                const result = await this.runtime.promptUserTurn(sessionId, {
                    initialRequest: options.text,
                    initialImages: [],
                    agentName: AGENTS.ROUTER,
                });
                const snapshot = this.runtime.getSessionSnapshot(sessionId);
                const runwieldSessionId = snapshot?.managed?.runwieldSessionId || null;
                const generation = snapshot?.managed?.generation ?? (result.ok ? 1 : 0);
                this.operations.set(operationId, {
                    ...(this.operations.get(operationId) || { projectId: options.projectId, events: [] }),
                    status: result.ok ? "completed" : "failed",
                    generation,
                    runwieldSessionId,
                    error: result.error,
                });
            } catch (error) {
                this.operations.set(operationId, {
                    ...(this.operations.get(operationId) || { projectId: options.projectId, events: [] }),
                    status: "failed",
                    error: codeFromError(error),
                });
            } finally {
                unsubscribe();
                if (sessionId) this.runtime.closeSessionWhenIdle(sessionId);
            }
        });
        return { operationId, status: "running", runwieldSessionId: null, generation: null };
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, runwieldSessionId: string, requestId: string, expectedGeneration: number, text: string, images?: Array<{ base64: string, mimeType: string }> }} options
     */
    async startContinuation(options) {
        if (!options.text || typeof options.text !== "string") throw new Error("Continuation text is required.");
        const requestHash = stableHash({
            kind: "continuation",
            session: options.runwieldSessionId,
            expectedGeneration: options.expectedGeneration,
            text: options.text,
            images: options.images || [],
        });
        const existingReceipt = this.store.findOperationReceiptByRequest({
            deviceId: options.deviceId || null,
            requestId: options.requestId,
            requestHash,
            runwieldSessionId: options.runwieldSessionId,
        });
        if (existingReceipt && existingReceipt.projectId === options.projectId) {
            return {
                operationId: existingReceipt.operationId,
                status: this.operations.get(existingReceipt.operationId)?.status || existingReceipt.status,
                generation: existingReceipt.resultGeneration,
            };
        }
        const session = this.store.getSessionById(options.runwieldSessionId);
        if (!session || !sessionBelongsToOwnerProject(this.store, session, options.projectId)) {
            throw new Error("Session not found.");
        }
        const inspected = this.store.inspectSessionActivation(options.runwieldSessionId);
        if (inspected.activation?.state !== "idle") {
            throw new Error("This Session is still busy. Wait for it to finish, then try again.");
        }
        if (!inspected.generation || inspected.generation.generation !== options.expectedGeneration) {
            throw new Error("Continuation requires the exact committed generation.");
        }
        const projection = await projectAggregateTranscript({
            cwd: session.transcriptCwd,
            sessionDir: getRunWieldSessionDir(session.transcriptCwd),
            runwieldSessionId: options.runwieldSessionId,
            generation: inspected.generation,
            segments: this.store.listSessionTranscriptSegments(options.runwieldSessionId),
            limit: 500,
        });
        if (!projection.ok) throw new Error(projection.message);
        const committedFacts = getCommittedTranscriptAuthorityFacts(projection);
        const decision = deriveManagedSessionContinuationDecision({
            activation: inspected.activation,
            generation: inspected.generation,
            projection,
            expectedGeneration: options.expectedGeneration,
        });
        if (!decision.ok) throw new Error(decision.message);
        const receipt = requireReceipt(this.store.createOrGetOperationReceipt({
            deviceId: options.deviceId || null,
            requestId: options.requestId,
            requestHash,
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            expectedGeneration: options.expectedGeneration,
            kind: "continuation",
        }));
        if (this.operations.has(receipt.operationId)) {
            return {
                operationId: receipt.operationId,
                status: this.operations.get(receipt.operationId)?.status || "running",
            };
        }
        if (receipt.status !== "accepted") {
            return { operationId: receipt.operationId, status: receipt.status, generation: receipt.resultGeneration };
        }
        this.store.updateOperationReceipt(receipt.operationId, { status: "running" });
        this.operations.set(receipt.operationId, {
            status: "running",
            projectId: options.projectId,
            events: [],
            runwieldSessionId: options.runwieldSessionId,
        });
        const adopted = this.runtime.adoptManagedSession({
            session,
            generation: options.expectedGeneration,
            activeAgent: committedFacts.activeAgent,
            model: committedFacts.model,
            provider: committedFacts.provider,
            thinkingLevel: committedFacts.thinkingLevel,
            workflowContext:
                /** @type {import('../../../shared/session/workflow-context-session.js').WorkflowContext | null} */ (committedFacts
                    .workflowContext || null),
        });
        this.runtime.setInteractionAdapter(
            adopted.sessionId,
            this.createInteractionAdapter({ operationId: receipt.operationId }),
        );
        const unsubscribe = this.runtime.subscribeSessionEvents(adopted.sessionId, (event) => {
            const record = this.operations.get(receipt.operationId);
            if (record && record.events.length < 500) record.events.push(event);
        });
        queueMicrotask(async () => {
            try {
                const result = await this.runtime.promptUserTurn(adopted.sessionId, {
                    initialRequest: options.text,
                    initialImages: options.images || [],
                    agentName: decision.agentName,
                });
                const generation = result.ok ? options.expectedGeneration + 1 : options.expectedGeneration;
                const status = result.ok ? "completed" : "failed";
                this.store.updateOperationReceipt(receipt.operationId, {
                    status,
                    resultGeneration: generation,
                    errorCode: result.error || null,
                });
                this.operations.set(receipt.operationId, {
                    ...(this.operations.get(receipt.operationId) || { projectId: options.projectId, events: [] }),
                    status,
                    generation,
                    error: result.error,
                });
            } catch (error) {
                const errorCode = codeFromError(error);
                this.store.updateOperationReceipt(receipt.operationId, {
                    status: "failed",
                    errorCode,
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
                this.operations.set(receipt.operationId, {
                    ...(this.operations.get(receipt.operationId) || { projectId: options.projectId, events: [] }),
                    status: "failed",
                    error: errorCode,
                });
            } finally {
                unsubscribe();
                this.runtime.closeSession(adopted.sessionId);
            }
        });
        return { operationId: receipt.operationId, status: "running" };
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, operationId: string, interactionId: string, runwieldSessionId?: string | null, requestId: string, response: unknown }} options
     */
    async answerInteraction(options) {
        const operation = this.operations.get(options.operationId);
        const durable = this.store.getOperationReceipt(options.operationId);
        const operationProjectId = operation?.projectId || durable?.projectId || null;
        if (operationProjectId !== options.projectId) {
            throw new Error("Live Workspace interaction is not available for this Project.");
        }
        const requestHash = stableHash({
            kind: "interaction_answer",
            operationId: options.operationId,
            interactionId: options.interactionId,
            response: options.response,
        });
        const operationSessionId = operation?.runwieldSessionId || options.runwieldSessionId || null;
        const existingReceipt = operationSessionId
            ? this.store.findOperationReceiptByRequest({
                deviceId: options.deviceId || null,
                requestId: options.requestId,
                requestHash,
                runwieldSessionId: operationSessionId,
            })
            : null;
        if (existingReceipt?.status === "completed" && existingReceipt.resultBody) return existingReceipt.resultBody;
        if (existingReceipt && existingReceipt.status !== "accepted") {
            throw new Error("Interaction answer request is already in progress.");
        }
        if (!operation || operation.status !== "running" || !operation.liveInteraction || !operation.answer) {
            throw new Error("Live Workspace interaction is not available.");
        }
        if (operation.liveInteraction.interactionId !== options.interactionId) {
            throw new Error("Interaction id does not match the live Workspace operation.");
        }
        if (options.runwieldSessionId && operation.runwieldSessionId !== options.runwieldSessionId) {
            throw new Error("Interaction Session does not match the live Workspace operation.");
        }
        if (!operation.runwieldSessionId) throw new Error("Live Workspace interaction is missing Session evidence.");
        const receipt = existingReceipt || requireReceipt(this.store.createOrGetOperationReceipt({
            deviceId: options.deviceId || null,
            requestId: options.requestId,
            requestHash,
            runwieldSessionId: operation.runwieldSessionId,
            projectId: options.projectId,
            expectedGeneration: null,
            kind: "plan_action",
        }));
        this.store.updateOperationReceipt(receipt.operationId, { status: "running" });
        try {
            let runtimeResponse = acceptedInteractionResponse(options.response);
            const request = operation.liveInteraction.request;
            const planReview = request?.planReview && typeof request.planReview === "object"
                ? /** @type {Record<string, unknown>} */ (request.planReview)
                : null;
            if (request?.type === "plan_review" && planReview) {
                const root = requireOwnerProjectRoot(this.store, options.projectId);
                const planId = String(planReview.planId || "");
                const plan = await findPlanEvidenceById(root, planId);
                const decision = readPlanReviewDecisionMeta(options.response);
                const actionResult = await applySharedPlanReviewDecision({
                    cwd: root,
                    planName: plan.planName,
                    planPath: plan.path,
                    planWithFrontMatter: plan.markdown,
                    planRevision: String(planReview.expectedRevision || plan.revision),
                    originalAttrs: plan.attrs,
                    trustedClassification:
                        /** @type {import('../../../plan-store.js').PlanFrontMatter['classification']} */ (planReview
                            .classification),
                    trustedWorkKind:
                        /** @type {import('../../../plan-store.js').PlanFrontMatter['workKind']} */ (plan.attrs
                            .workKind),
                    expectedSessionId: operation.runwieldSessionId,
                    reviewEvidence: {
                        planId,
                        runwieldSessionId: operation.runwieldSessionId,
                        status: String(planReview.expectedStatus || ""),
                        worktree:
                            /** @type {import('../../../shared/workflow/plan-actions.ts').PlanWorktreeExpectation} */ (planReview
                                .expectedWorktree),
                    },
                    decision:
                        /** @type {import('../../../shared/workflow/plan-review-actions.ts').SharedPlanReviewDecision} */ (decision),
                });
                if (actionResult.recoveryRequired) {
                    const result = {
                        status: "recovery_required",
                        message: actionResult.recoveryRequired.message,
                        entryIds: actionResult.recoveryRequired.entryIds,
                    };
                    this.store.updateOperationReceipt(receipt.operationId, {
                        status: "completed",
                        resultBody: { result },
                    });
                    return result;
                }
                if (actionResult.cancellationReason) {
                    const message = actionResult.feedback ||
                        "Plan review evidence is stale. Reload the Plan and review again.";
                    operation.answer.reject(new Error(message));
                    this.operations.set(options.operationId, {
                        ...operation,
                        liveInteraction: undefined,
                        answer: null,
                    });
                    throw new Error(message);
                }
                runtimeResponse = { outcome: "accepted", _meta: actionResult };
            }
            operation.answer.resolve(runtimeResponse);
            this.operations.set(options.operationId, { ...operation, liveInteraction: undefined, answer: null });
            const result = { status: "accepted" };
            this.store.updateOperationReceipt(receipt.operationId, { status: "completed", resultBody: result });
            return result;
        } catch (error) {
            this.store.updateOperationReceipt(receipt.operationId, {
                status: "failed",
                errorCode: "interaction_answer_failed",
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * @param {{ projectId: string, operationId: string, interactionId: string, runwieldSessionId: string, planId: string }} options
     */
    getLivePlanReview(options) {
        const operation = this.operations.get(options.operationId);
        if (!operation || operation.status !== "running" || operation.projectId !== options.projectId) return null;
        if (operation.runwieldSessionId !== options.runwieldSessionId) return null;
        if (!operation.liveInteraction || operation.liveInteraction.interactionId !== options.interactionId) {
            return null;
        }
        const request = operation.liveInteraction.request || {};
        if (request.type !== "plan_review") return null;
        const planReview = request.planReview && typeof request.planReview === "object"
            ? /** @type {Record<string, unknown>} */ (request.planReview)
            : null;
        if (!planReview || planReview.planId !== options.planId) return null;
        return { operationId: options.operationId, interactionId: options.interactionId, request };
    }

    /**
     * @param {{ projectId: string, runwieldSessionId: string, expectedGeneration: number, expectedCurrentSegmentId?: string | null }} options
     */
    async forceRecoverSessionControl(options) {
        const session = this.store.getSessionById(options.runwieldSessionId);
        if (!session || !sessionBelongsToOwnerProject(this.store, session, options.projectId)) {
            throw new Error("Session not found.");
        }
        const inspected = this.store.inspectSessionActivation(options.runwieldSessionId);
        if (!inspected.generation) {
            return await this.runtime.ensureInitialSessionGeneration(options.runwieldSessionId);
        }
        const projection = await projectAggregateTranscript({
            cwd: session.transcriptCwd,
            sessionDir: getRunWieldSessionDir(session.transcriptCwd),
            runwieldSessionId: options.runwieldSessionId,
            generation: inspected.generation,
            segments: this.store.listSessionTranscriptSegments(options.runwieldSessionId),
            limit: 1,
        });
        if (!projection.ok) throw new Error(projection.message);
        const currentSegment = this.store.listSessionTranscriptSegments(options.runwieldSessionId)
            .find((segment) => segment.segmentId === inspected.generation?.currentSegmentId);
        if (!currentSegment) throw new Error("Current transcript segment is missing.");
        const evidence = await validateExpiredControlTranscriptEvidence({
            transcriptPath: currentSegment.transcriptPath,
            transcriptCwd: currentSegment.transcriptCwd,
            committedGeneration: inspected.generation,
        });
        return this.store.recoverSessionControl({
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            expectedFence: inspected.activation?.fence ?? 0,
            expectedGeneration: options.expectedGeneration,
            expectedCurrentSegmentId: options.expectedCurrentSegmentId ?? inspected.generation.currentSegmentId,
            ownerInstanceId: this.ownerInstanceId,
            ownerProcessKind: "workspace",
            transcriptEvidence: { ...evidence, currentSegmentId: inspected.generation.currentSegmentId },
        });
    }

    /**
     * @param {{ runwieldSessionId: string, projectId: string, expectedGeneration: number, planName: string, triageMeta?: Record<string, unknown>, reviewFeedback?: string, reviewImages?: Array<{ base64: string, mimeType: string }> }} options
     */
    async startPlanExecutionHandoff(options) {
        const session = this.store.getSessionById(options.runwieldSessionId);
        if (!session || !sessionBelongsToOwnerProject(this.store, session, options.projectId)) {
            throw new Error("Session not found.");
        }
        const inspected = this.store.inspectSessionActivation(options.runwieldSessionId);
        if (!inspected.generation || inspected.generation.generation !== options.expectedGeneration) {
            throw new Error("Plan execution requires the exact committed generation.");
        }
        if (!options.triageMeta) throw new Error("Plan execution handoff requires approval-time Plan action evidence.");
        const adopted = this.runtime.adoptManagedSession({ session, generation: options.expectedGeneration });
        try {
            return await this.runtime.executePlan(adopted.sessionId, {
                planName: options.planName,
                triageMeta: options.triageMeta,
                reviewFeedback: options.reviewFeedback,
                reviewImages: options.reviewImages,
                expectedGeneration: options.expectedGeneration,
            });
        } finally {
            this.runtime.closeSessionWhenIdle(adopted.sessionId);
        }
    }

    /** @param {string} operationId */
    getOperation(operationId) {
        const live = this.operations.get(operationId);
        const durable = this.store.getOperationReceipt(operationId);
        if (!durable) return live ? { operationId, ...live } : { operationId, status: "unknown", events: [] };
        if (!live && (durable.status === "accepted" || durable.status === "running")) {
            return {
                operationId,
                status: "unknown",
                generation: durable.resultGeneration,
                error: "operation_not_running",
                events: [],
            };
        }
        return {
            operationId,
            status: durable.status,
            generation: durable.resultGeneration,
            error: durable.errorCode,
            events: live?.events || [],
            liveInteraction: live?.liveInteraction || null,
        };
    }
}

/** @param {{ store: import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore }} options */
export function createWorkspaceSessionContinuationService(options) {
    return new WorkspaceSessionContinuationService(options);
}
