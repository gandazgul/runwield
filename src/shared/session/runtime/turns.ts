import { AGENTS } from "../../../constants.js";
import { abortActiveSession as abortActiveSessionFn, runIsolatedAgentSession } from ".././session.js";
import { resolveNamedInvocation, withNamedInvocationDisplayMessage } from ".././named-invocation.ts";
import { getRuntimeErrorMessage, RuntimeEventTypes } from ".././session-runtime-events.js";
import { rollSessionTranscriptSegment } from ".././segment-rollover.ts";
import { RuntimeInteractionTypes } from ".././session-runtime-interactions.js";

import {
    getRuntimeRootAgentSession,
    imageReferencesForNamedInvocation,
    isRuntimeRootSessionManager,
    normalizeThinkingLevel,
    SessionTurnInProgressError,
} from "./support.ts";
import { isManagedOperationFailure } from "./types.ts";
import type { PromptSessionOptions } from "./types.ts";

interface PromptSessionResult {
    ok: boolean;
    turns: number;
    error?: string;
    replacementSessionId?: string;
    _validationResult?: import("./workflows.ts").RuntimeValidationResult | null;
    namedInvocation?: {
        kind: string;
        name: string;
        expansionDigest: string;
        profile: import("../named-invocation.ts").NamedInvocationPayload["profile"];
        messageCount: number;
    };
}

import type { RuntimeServices } from "./base.ts";
import type { RuntimeEvents } from "./events.ts";
import type { RuntimeLifecycle } from "./lifecycle.ts";
import type { RuntimeManagedOperations } from "./managed-operations.ts";
import type { RuntimeQueues } from "./queues.ts";
import type { RuntimeImages } from "./images.ts";
import type { RuntimeAgentSettings } from "./agent-settings.ts";
import type { RuntimeManagedSync } from "./managed-sync.ts";
import type { RuntimeWorkflows } from "./workflows.ts";

type RuntimeEventsDependency = Pick<RuntimeEvents, "beginBusyOperation" | "emitSessionEvent" | "endBusyOperation">;
type RuntimeLifecycleDependency = Pick<RuntimeLifecycle, "hasPendingProject" | "materializeDeferredManagedShell">;
type RuntimeManagedOperationsDependency = Pick<
    RuntimeManagedOperations,
    "currentCapability" | "hasOperation" | "runManagedOperation"
>;
type RuntimeQueuesDependency = Pick<RuntimeQueues, "clearQueuedMessagesInternal" | "reconcileQueuedMessageSources">;
type RuntimeImagesDependency = Pick<
    RuntimeImages,
    "persistPendingPromptImages" | "preflightSessionImages" | "preflightUserTurnImages"
>;
type RuntimeAgentSettingsDependency = Pick<RuntimeAgentSettings, "alignActiveExecutionWorkflowOwner">;
type RuntimeManagedSyncDependency = Pick<RuntimeManagedSync, "synchronizeManagedSession">;
type RuntimeWorkflowsDependency = Pick<
    RuntimeWorkflows,
    "continueEpicAfterValidation" | "runSemanticRepairSegmentHandoff"
>;

export class RuntimeTurns {
    private events!: RuntimeEventsDependency;
    private lifecycle!: RuntimeLifecycleDependency;
    private managedOperations!: RuntimeManagedOperationsDependency;
    private queues!: RuntimeQueuesDependency;
    private images!: RuntimeImagesDependency;
    private settings!: RuntimeAgentSettingsDependency;
    private sync!: RuntimeManagedSyncDependency;
    private workflows!: RuntimeWorkflowsDependency;

    constructor(private readonly services: RuntimeServices) {}

    connect(
        events: RuntimeEventsDependency,
        lifecycle: RuntimeLifecycleDependency,
        managedOperations: RuntimeManagedOperationsDependency,
        queues: RuntimeQueuesDependency,
        images: RuntimeImagesDependency,
        settings: RuntimeAgentSettingsDependency,
        sync: RuntimeManagedSyncDependency,
        workflows: RuntimeWorkflowsDependency,
    ) {
        this.events = events;
        this.lifecycle = lifecycle;
        this.managedOperations = managedOperations;
        this.queues = queues;
        this.images = images;
        this.settings = settings;
        this.sync = sync;
        this.workflows = workflows;
    }
    private turnSettlements = new Map<string, Promise<void>>();

    async awaitSettlement(sessionId: string) {
        await this.turnSettlements.get(sessionId);
    }

    async promptNamedTemplateTurn(
        sessionId: string,
        invocation: import(".././named-invocation.ts").PromptTemplateInvocation,
        options: PromptSessionOptions & { expectedGeneration: number | null },
    ) {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptNamedTemplateTurn: session not found");
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) {
            throw new Error("SessionRuntime.promptNamedTemplateTurn: segmented Session metadata is unavailable");
        }
        const previousAgentInfo = hostedSession.getActiveAgentInfo?.() || null;
        const previousModelState = hostedSession.getActiveModelState?.() || { model: "", provider: "" };
        const previousUserModelOverride = hostedSession.isUserModelOverride?.() === true;
        const previousThinkingLevel = hostedSession.getThinkingLevel?.() || "off";
        const previousWorkflow = hostedSession.getActiveExecutionWorkflow?.() || null;
        const previousPendingTaskCompletion = hostedSession.getPendingTaskCompletionForRestore?.() || null;
        let temporaryProfilePublished = false;
        let restored = false;
        const emitActiveProfile = () => {
            const activeAgent = hostedSession.getActiveAgentInfo?.() || null;
            if (activeAgent?.agentName) {
                this.events.emitSessionEvent(sessionId, {
                    type: RuntimeEventTypes.AGENT_CHANGED,
                    agentName: activeAgent.agentName,
                    model: activeAgent.model || undefined,
                });
            }
            const activeModel = hostedSession.getActiveModelState?.() || { model: "", provider: "" };
            if (activeModel.model) {
                this.events.emitSessionEvent(sessionId, {
                    type: RuntimeEventTypes.MODEL_CHANGED,
                    model: activeModel.model,
                    provider: activeModel.provider,
                });
            }
            this.events.emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.THINKING_LEVEL_CHANGED,
                thinkingLevel: hostedSession.getThinkingLevel?.() || "off",
            });
        };
        const restorePromptInvocationState = () => {
            if (restored) return;
            restored = true;
            if (previousAgentInfo) {
                hostedSession.resetAgentInfoStack(
                    previousAgentInfo.displayName,
                    previousAgentInfo.model,
                    previousAgentInfo.provider,
                    previousAgentInfo.agentName || "",
                );
            }
            if (previousUserModelOverride) {
                hostedSession.setActiveModelState(previousModelState.model, previousModelState.provider, true);
            } else {
                hostedSession.clearUserModelOverride?.();
                hostedSession.setActiveModelState(previousModelState.model, previousModelState.provider, false);
            }
            hostedSession.setThinkingLevel?.(previousThinkingLevel);
            hostedSession.restoreActiveExecutionWorkflow?.(previousWorkflow, previousPendingTaskCompletion);
            if (temporaryProfilePublished) emitActiveProfile();
        };
        try {
            return await this.managedOperations.runManagedOperation(
                sessionId,
                { name: "prompt", options, emitPromptEvents: options.emitInitialEvents === false ? false : undefined },
                async ({ acceptedTurnId, hasPendingImages, capability }) => {
                    const turnId = acceptedTurnId;
                    let ok = false;
                    let result: PromptSessionResult | null = null;
                    if (!hostedSession.beginTurn(turnId)) throw new SessionTurnInProgressError(hostedSession.id);
                    try {
                        const imagePreflight = await this.images.preflightUserTurnImages(hostedSession.id, {
                            initialRequest: invocation.payload.compactInvocation,
                            initialImages: options.initialImages || [],
                            agentName: invocation.agentName,
                            preparedModelOverride: options.preparedModelOverride,
                            modelOverride: invocation.model,
                        });
                        if (!imagePreflight.ok) throw new Error(imagePreflight.message);
                        const images = await this.images.persistPendingPromptImages(
                            hostedSession,
                            options.initialImages || [],
                        );
                        invocation.payload.imageReferences = imageReferencesForNamedInvocation(images);
                        if (hasPendingImages && options.emitInitialEvents !== false) {
                            this.events.emitSessionEvent(hostedSession.id, {
                                type: RuntimeEventTypes.USER_MESSAGE,
                                turnId,
                                text: invocation.payload.compactInvocation,
                                images: images.map((image) => ({ ...image })),
                            });
                            this.events.emitSessionEvent(hostedSession.id, {
                                type: RuntimeEventTypes.TURN_START,
                                turnId,
                            });
                        }
                        const sessionManager = hostedSession.getRootSessionManager?.() || null;
                        if (!isRuntimeRootSessionManager(sessionManager)) {
                            result = { ok: false, turns: 0, error: "missing_active_session_manager" };
                            return result;
                        }
                        const cwd = hostedSession.getActiveExecutionCwd?.() || hostedSession.cwd;
                        const messages = await withNamedInvocationDisplayMessage(
                            sessionManager,
                            invocation.payload,
                            async () =>
                                await runIsolatedAgentSession({
                                    hostedSession,
                                    agentName: invocation.agentName,
                                    userRequest: invocation.expandedRequest,
                                    images,
                                    sessionManager,
                                    cwd,
                                    modelOverride: options.preparedModelOverride || invocation.model,
                                    thinkingLevelOverride: invocation.thinkingLevel,
                                    workflowAuthority: false,
                                    ignoreManualModelOverride: true,
                                    updateHostedThinkingLevel: false,
                                    persistModelChange: false,
                                    disableAutoCompaction: true,
                                    managedOperationCapability: capability,
                                    signal: capability.signal,
                                    onExecutionSessionBuilt: (built) => {
                                        const resolvedModel = built.resolvedModel
                                            ? `${built.resolvedModel.provider}/${built.resolvedModel.id}`
                                            : invocation.model;
                                        const resolvedThinkingLevel = normalizeThinkingLevel(
                                            built.resolvedThinkingLevel,
                                        );
                                        invocation.payload.profile = {
                                            agentName: invocation.agentName,
                                            ...(resolvedModel ? { model: resolvedModel } : {}),
                                            thinkingLevel: resolvedThinkingLevel,
                                        };
                                        hostedSession.clearUserModelOverride?.();
                                        hostedSession.setThinkingLevel?.(resolvedThinkingLevel);
                                        temporaryProfilePublished = true;
                                        emitActiveProfile();
                                    },
                                }),
                            { persistModelChange: false },
                        );
                        ok = true;
                        result = {
                            ok: true,
                            turns: 1,
                            namedInvocation: {
                                kind: invocation.kind,
                                name: invocation.name,
                                expansionDigest: invocation.payload.expansionDigest,
                                profile: invocation.payload.profile,
                                messageCount: Array.isArray(messages) ? messages.length : 0,
                            },
                        };
                        return result;
                    } catch (error) {
                        this.events.emitSessionEvent(hostedSession.id, {
                            type: RuntimeEventTypes.TERMINAL_ERROR,
                            turnId,
                            message: getRuntimeErrorMessage(error),
                            error,
                        });
                        throw error;
                    } finally {
                        this.events.emitSessionEvent(hostedSession.id, {
                            type: RuntimeEventTypes.TURN_END,
                            turnId,
                            ok,
                            result: result || { turns: 0 },
                        });
                        hostedSession.endTurn(turnId);
                        restorePromptInvocationState();
                    }
                },
            );
        } finally {
            restorePromptInvocationState();
        }
    }

    async promptUserTurn(sessionId: string, options: PromptSessionOptions) {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptUserTurn: session not found");
        const namedInvocation = await resolveNamedInvocation({
            cwd: hostedSession.cwd,
            text: options.initialRequest,
            images: options.initialImages || [],
        });
        const submittedRequest = options.initialRequest;
        let displayRequest = submittedRequest;
        if (namedInvocation.kind === "prompt_template") displayRequest = namedInvocation.expandedRequest;
        if (namedInvocation.kind === "skill") displayRequest = namedInvocation.payload.compactInvocation;
        let preparedModelOverride = options.preparedModelOverride;
        if ((options.initialImages || []).length > 0) {
            const imagePreflight = await this.images.preflightUserTurnImages(sessionId, options);
            if (!imagePreflight.ok) throw new Error(imagePreflight.message);
            if ("preparedModelOverride" in imagePreflight) {
                preparedModelOverride ||= imagePreflight.preparedModelOverride;
            }
        }
        let managed = hostedSession.getManagedMetadata?.() || null;
        const isDeferredFirstTurn = !managed && this.lifecycle.hasPendingProject(sessionId);
        const deferredFirstTurnId = isDeferredFirstTurn ? crypto.randomUUID() : "";
        let deferredBusyStarted = false;
        if (isDeferredFirstTurn) {
            const hasInitialImages = (options.initialImages || []).length > 0;
            if (!hasInitialImages) {
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.USER_MESSAGE,
                    turnId: deferredFirstTurnId,
                    text: displayRequest,
                    images: (options.initialImages || []).map((image) => ({ ...image })),
                });
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.TURN_START,
                    turnId: deferredFirstTurnId,
                });
                this.events.beginBusyOperation(sessionId, deferredFirstTurnId);
                deferredBusyStarted = true;
            }
            const activeAgentInfo = hostedSession.getActiveAgentInfo?.() || null;
            const agentName = options.agentName || activeAgentInfo?.agentName || AGENTS.ROUTER;
            hostedSession.mergePendingManagedTurnIntent?.({ agentName });
            // Give presentation adapters one event-loop turn to paint the user
            // message and first busy frame before filesystem/session setup begins.
            await new Promise((resolve) => setTimeout(resolve, 0));
            try {
                managed = await this.lifecycle.materializeDeferredManagedShell(hostedSession);
            } catch (error) {
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.TURN_END,
                    turnId: deferredFirstTurnId,
                    ok: false,
                });
                if (deferredBusyStarted) {
                    this.events.endBusyOperation(sessionId, deferredFirstTurnId);
                    deferredBusyStarted = false;
                }
                throw error;
            }
        }
        if (!managed) throw new Error("SessionRuntime.promptUserTurn: segmented Session metadata is unavailable");
        if (!isDeferredFirstTurn && !this.managedOperations.hasOperation(sessionId)) {
            await this.sync.synchronizeManagedSession(sessionId);
            managed = hostedSession.getManagedMetadata() || managed;
        }
        options = { ...options, inputSurface: options.inputSurface || this.services.ownerProcessKind };
        const requestOptions = deferredFirstTurnId
            ? {
                ...options,
                initialRequest: displayRequest,
                preparedModelOverride,
                turnId: deferredFirstTurnId,
                emitInitialEvents: (options.initialImages || []).length > 0 ? undefined : false,
            }
            : { ...options, initialRequest: displayRequest, preparedModelOverride };
        const buildResult = (
            result: PromptSessionResult,
        ) => ({
            ...result,
            managed: true,
            submittedRequest,
            restoreDraft: Boolean(result.error),
            ...(result.ok && submittedRequest.trim() ? { historyText: submittedRequest.trim() } : {}),
        });

        const expectedGenerationSource = managed.acknowledgedGeneration ?? managed.generation;
        const expectedGeneration = Number.isSafeInteger(expectedGenerationSource) ? expectedGenerationSource : null;
        try {
            if (namedInvocation.kind === "prompt_template") {
                return buildResult(
                    await this.promptNamedTemplateTurn(sessionId, namedInvocation, {
                        ...requestOptions,
                        expectedGeneration,
                    }),
                );
            }
            return buildResult(
                await this.promptManagedSession(sessionId, {
                    ...requestOptions,
                    expectedGeneration,
                    ...(namedInvocation.kind === "skill"
                        ? {
                            modelRequest: namedInvocation.expandedRequest,
                            namedInvocationPayload: namedInvocation.payload,
                        }
                        : {}),
                }),
            );
        } finally {
            if (deferredBusyStarted) this.events.endBusyOperation(sessionId, deferredFirstTurnId);
        }
    }

    async promptManagedSession(
        sessionId: string,
        options: PromptSessionOptions & { expectedGeneration: number | null },
    ): Promise<PromptSessionResult> {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptManagedSession: session not found");
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) throw new Error("SessionRuntime.promptManagedSession: segmented Session metadata is unavailable");
        let operationOptions = options;
        if ((options.initialImages || []).length > 0 && !options.preparedModelOverride) {
            const imagePreflight = await this.images.preflightUserTurnImages(sessionId, options);
            if (!imagePreflight.ok) throw new Error(imagePreflight.message);
            operationOptions = {
                ...options,
                preparedModelOverride: "preparedModelOverride" in imagePreflight
                    ? imagePreflight.preparedModelOverride
                    : undefined,
            };
        }
        const result = await this.managedOperations.runManagedOperation(
            sessionId,
            {
                name: "prompt",
                options: operationOptions,
                emitPromptEvents: operationOptions.emitInitialEvents === false ? false : undefined,
            },
            async ({ acceptedTurnId, hasPendingImages, capability }) =>
                await this.promptSession(sessionId, {
                    ...operationOptions,
                    turnId: acceptedTurnId,
                    onTurnStarted: undefined,
                    emitInitialEvents: operationOptions.emitInitialEvents === false ? false : hasPendingImages,
                    suppressEpicContinuation: true,
                    signal: capability.signal,
                }, capability),
        );
        if (isManagedOperationFailure(result)) return { ...result, turns: result.turns ?? 0 };
        const validationResult = result._validationResult;
        if (
            result.ok && validationResult?.kind === "semantic_repair_handoff" &&
            validationResult.semanticRepairHandoff
        ) {
            const workflow = hostedSession.getActiveExecutionWorkflow?.() || null;
            result._validationResult = await this.workflows.runSemanticRepairSegmentHandoff(
                hostedSession.id,
                {
                    planName: validationResult.planName || workflow?.planName || options.planName || "",
                    planContent: options.planContent,
                    triageMeta: workflow?.triageMeta || options.triageMeta || {},
                },
                {
                    ...validationResult,
                    kind: "semantic_repair_handoff",
                    semanticRepairHandoff: validationResult.semanticRepairHandoff,
                },
            );
        }
        const settledValidationResult = result._validationResult;
        if (result.ok && settledValidationResult?.epicContinuation) {
            const replacement = await this.workflows.continueEpicAfterValidation(
                hostedSession,
                settledValidationResult,
            );
            if (replacement.sessionId) result.replacementSessionId = replacement.sessionId;
        }
        delete result._validationResult;
        return result;
    }

    async rollManagedSessionSegment(
        sessionId: string,
        options: {
            kind: "execution" | "semantic_repair";
            transcriptCwd?: string;
            continuation: import(".././segment-rollover.ts").SegmentRolloverResult["continuation"];
            expectedGeneration?: number | null;
            lineageGroupKey?: string | null;
        },
    ) {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.rollManagedSessionSegment: session not found");
        if (!this.services.sessionStore) throw new Error("Session storage is unavailable");
        return await rollSessionTranscriptSegment({
            hostedSession,
            ownerCoordinationStore: this.services.sessionStore,
            ownerInstanceId: this.services.ownerInstanceId,
            ownerProcessKind: this.services.ownerProcessKind,
            kind: options.kind,
            transcriptCwd: options.transcriptCwd,
            continuation: options.continuation,
            expectedGeneration: options.expectedGeneration,
            lineageGroupKey: options.lineageGroupKey,
        });
    }

    cancelSession(sessionId: string) {
        const session = this.services.sessionHost.getSession(sessionId);
        if (!session) return { ok: false, aborted: false, error: "not_found" };
        const currentOperation = this.managedOperations.currentCapability(session.id);
        const activeInteractions = session.getActiveInteractions?.() || new Map();
        const onlyPlanReviewInteraction = activeInteractions.size > 0 &&
            [...activeInteractions.values()].every((record) =>
                record.request?.type === RuntimeInteractionTypes.PLAN_REVIEW
            );
        if (currentOperation) {
            let aborted = false;
            let operationCanceled = false;
            let agentCanceled = false;
            const turnActive = session.isTurnActive();
            try {
                operationCanceled = Boolean(session.cancelActiveInteractions?.());
                const rootAgentSession = getRuntimeRootAgentSession(session);
                if (rootAgentSession?.isCompacting && rootAgentSession?.abortCompaction) {
                    rootAgentSession.abortCompaction();
                    operationCanceled = true;
                }
                this.queues.clearQueuedMessagesInternal(session, "session_cancel");
                if (!onlyPlanReviewInteraction) {
                    agentCanceled = abortActiveSessionFn(session);
                    if (agentCanceled || turnActive) session.suppressNextAgentStoppedAttention();
                }
                aborted = operationCanceled || agentCanceled;
            } finally {
                this.events.emitSessionEvent(session.id, {
                    type: RuntimeEventTypes.CANCELLATION,
                    aborted,
                    reason: "session_cancel",
                    ...(aborted
                        ? {
                            scope: operationCanceled ? "operation" : "agent",
                            message: operationCanceled ? "Operation canceled." : "Agent run canceled.",
                        }
                        : {}),
                });
            }
            return { ok: true, aborted };
        }
        if (session.getManagedMetadata?.()) {
            this.events.emitSessionEvent(session.id, {
                type: RuntimeEventTypes.CANCELLATION,
                aborted: false,
                reason: "session_cancel",
            });
            return { ok: true, aborted: false };
        }
        let aborted = false;
        let operationCanceled = false;
        let agentCanceled = false;
        const turnActive = session.isTurnActive();
        try {
            operationCanceled = Boolean(session.cancelActiveInteractions?.());
            const rootAgentSession = getRuntimeRootAgentSession(session);
            if (rootAgentSession?.isCompacting && rootAgentSession?.abortCompaction) {
                rootAgentSession.abortCompaction();
                operationCanceled = true;
            }
            this.queues.clearQueuedMessagesInternal(session, "session_cancel");
            if (!onlyPlanReviewInteraction) {
                agentCanceled = abortActiveSessionFn(session);
                if (agentCanceled || turnActive) session.suppressNextAgentStoppedAttention();
            }
            aborted = operationCanceled || agentCanceled;
        } finally {
            this.events.emitSessionEvent(session.id, {
                type: RuntimeEventTypes.CANCELLATION,
                aborted,
                reason: "session_cancel",
                ...(aborted
                    ? {
                        scope: operationCanceled ? "operation" : "agent",
                        message: operationCanceled ? "Operation canceled." : "Agent run canceled.",
                    }
                    : {}),
            });
        }
        return { ok: true, aborted };
    }

    async promptSession(
        sessionId: string,
        options: PromptSessionOptions,
        capability: import(".././managed-operation.ts").ManagedOperationCapability | null = null,
    ): Promise<PromptSessionResult> {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptSession: session not found");
        if (
            (hostedSession.isTurnActive() || this.managedOperations.hasOperation(sessionId)) &&
            capability !== hostedSession.getManagedOperationCapability?.()
        ) {
            throw new SessionTurnInProgressError(hostedSession.id);
        }
        const managed = hostedSession.getManagedMetadata?.() || null;
        if (!managed) throw new Error("SessionRuntime.promptSession: segmented Session metadata is unavailable");
        if (!capability || capability !== hostedSession.getManagedOperationCapability?.()) {
            const expectedGenerationSource = managed.acknowledgedGeneration ?? managed.generation;
            const expectedGeneration = Number.isSafeInteger(expectedGenerationSource) ? expectedGenerationSource : 0;
            return await this.promptManagedSession(sessionId, { ...options, expectedGeneration });
        }
        const turnId = options.turnId || crypto.randomUUID();
        const emitInitialEvents = options.emitInitialEvents !== false;
        await this.settings.alignActiveExecutionWorkflowOwner(hostedSession);
        if (!hostedSession.beginTurn(turnId)) throw new SessionTurnInProgressError(hostedSession.id);
        let cleanupTurn = () => {};
        let settleTurn = () => {};
        const turnSettlement = new Promise<void>((resolve) => {
            settleTurn = () => resolve(undefined);
        });
        this.turnSettlements.set(hostedSession.id, turnSettlement);
        const request = options.initialRequest;
        const modelRequest = options.modelRequest || request;
        let images = options.initialImages || [];
        let turns = 0;
        let ok = false;
        let busyStarted = false;
        let validationResult = null;
        const managedCapability = hostedSession.getManagedOperationCapability?.() || null;
        let result: PromptSessionResult | null = null;

        try {
            const imagePreflight = await this.images.preflightSessionImages(sessionId, images);
            if (!imagePreflight.ok) throw new Error(imagePreflight.message);
            hostedSession.localInputSurface = this.services.ownerProcessKind;
            hostedSession.notificationSurface = options.inputSurface || hostedSession.notificationSurface ||
                this.services.ownerProcessKind;
            const cleanup = options.onTurnStarted?.({ turnId });
            if (typeof cleanup === "function") cleanupTurn = cleanup;
            images = await this.images.persistPendingPromptImages(hostedSession, images);
            if (options.namedInvocationPayload) {
                options.namedInvocationPayload.imageReferences = imageReferencesForNamedInvocation(images);
            }
            if (emitInitialEvents) {
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.USER_MESSAGE,
                    turnId,
                    text: request,
                    images: images.map((image) => ({ ...image })),
                });
                this.events.emitSessionEvent(hostedSession.id, { type: RuntimeEventTypes.TURN_START, turnId });
            }
            this.events.beginBusyOperation(hostedSession.id, turnId);
            busyStarted = true;

            if (!hostedSession.getActiveOnMessage() || !hostedSession.getRootSessionManager()) {
                const message = "Error: No active agent handler or session manager.";
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    turnId,
                    level: "error",
                    message,
                });
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.TERMINAL_ERROR,
                    turnId,
                    message,
                    error: "missing_active_handler_or_session_manager",
                });
                result = {
                    ok: false,
                    turns,
                    error: "missing_active_handler_or_session_manager",
                };
                return result;
            }

            const handler = hostedSession.getActiveOnMessage();
            if (!handler) {
                const message = "Error: No active agent handler or session manager.";
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    turnId,
                    level: "error",
                    message,
                });
                result = {
                    ok: false,
                    turns,
                    error: "missing_active_handler_or_session_manager",
                };
                return result;
            }

            const rootSessionManager = hostedSession.getRootSessionManager() || null;
            if (!isRuntimeRootSessionManager(rootSessionManager)) {
                throw new Error("Runtime session manager is unavailable.");
            }
            const runHandler = async () =>
                await handler(
                    modelRequest,
                    images,
                    rootSessionManager || undefined,
                    options.signal || managedCapability?.signal,
                );
            const turnResult = options.namedInvocationPayload && rootSessionManager
                ? await withNamedInvocationDisplayMessage(
                    rootSessionManager,
                    options.namedInvocationPayload,
                    runHandler,
                )
                : await runHandler();
            turns++;
            validationResult = turnResult?.validationResult || null;
            ok = true;
            result = { ok: true, turns };
            return result;
        } catch (error) {
            this.events.emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.TERMINAL_ERROR,
                turnId,
                message: getRuntimeErrorMessage(error),
                error,
            });
            throw error;
        } finally {
            this.queues.reconcileQueuedMessageSources(hostedSession);
            if (
                hostedSession.notificationSurface === "workspace" &&
                hostedSession.agentStoppedAttentionTurnId !== turnId
            ) {
                this.events.emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.ATTENTION_REQUESTED,
                    reason: "agentStopped",
                    agentName: hostedSession.getRootAgentName() || undefined,
                });
            }
            this.events.emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.TURN_END,
                turnId,
                ok,
                result: result || { turns },
            });
            hostedSession.endTurn(turnId);
            if (busyStarted) this.events.endBusyOperation(hostedSession.id, turnId);
            try {
                cleanupTurn();
            } catch {
                // Adapter cleanup must not prevent runtime turn settlement.
            }
            settleTurn();
            if (this.turnSettlements.get(hostedSession.id) === turnSettlement) {
                this.turnSettlements.delete(hostedSession.id);
            }
            if (validationResult && result) {
                result._validationResult = validationResult;
            }
            if (!options.suppressEpicContinuation && ok && validationResult?.epicContinuation && result) {
                const replacement = await this.workflows.continueEpicAfterValidation(hostedSession, validationResult);
                if (replacement.sessionId) result.replacementSessionId = replacement.sessionId;
            }
        }
    }
}
