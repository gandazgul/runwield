import { AGENTS } from "../../../constants.js";
import { abortActiveSession as abortActiveSessionFn } from ".././session.js";
import { resolveNamedInvocation, withNamedInvocationDisplayMessage } from ".././named-invocation.ts";
import { getRuntimeErrorMessage, RuntimeEventTypes } from ".././session-runtime-events.js";
import { rollSessionTranscriptSegment } from ".././segment-rollover.ts";
import { promptTemplateWorkflowConflict, resolvePromptTemplateSettings } from "../prompt-template-settings.ts";
import { recordManualModelSelection } from "../active-agent-session.js";
import { getAgentDisplayName } from "../agents.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from ".././session-runtime-interactions.js";

import {
    getRuntimeRootAgentSession,
    imageReferencesForNamedInvocation,
    isRuntimeRootSessionManager,
    SessionTurnInProgressError,
} from "./support.ts";
import { isManagedOperationFailure } from "./types.ts";
import type { PromptSessionOptions, PromptTurnContext } from "./types.ts";

interface PromptSessionResult {
    ok: boolean;
    turns: number;
    error?: string;
    replacementSessionId?: string;
    templateNewSession?: boolean;
    _validationResult?: import("./workflows.ts").RuntimeValidationResult | null;
    namedInvocation?: {
        kind: string;
        name: string;
        expansionDigest: string;
        profile: import("../named-invocation.ts").NamedInvocationPayload["profile"];
        messageCount: number;
    };
}

interface UserPromptResult extends PromptSessionResult {
    managed: boolean;
    submittedRequest: string;
    restoreDraft: boolean;
    historyText?: string;
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
type RuntimeLifecycleDependency = Pick<
    RuntimeLifecycle,
    "hasPendingProject" | "materializeDeferredManagedShell" | "createInteractiveSession"
>;
type RuntimeManagedOperationsDependency = Pick<
    RuntimeManagedOperations,
    "currentCapability" | "hasOperation" | "runManagedOperation"
>;
type RuntimeQueuesDependency = Pick<RuntimeQueues, "clearQueuedMessagesInternal" | "reconcileQueuedMessageSources">;
type RuntimeImagesDependency = Pick<
    RuntimeImages,
    "persistPendingPromptImages" | "preflightSessionImages" | "preflightUserTurnImages"
>;
type RuntimeAgentSettingsDependency = Pick<
    RuntimeAgentSettings,
    "alignActiveExecutionWorkflowOwner" | "activateSessionAgent" | "setSessionThinkingLevel"
>;
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

    async promptUserTurn(sessionId: string, options: PromptSessionOptions): Promise<UserPromptResult> {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptUserTurn: session not found");
        const namedInvocation = await resolveNamedInvocation({
            cwd: hostedSession.cwd,
            text: options.initialRequest,
            images: options.initialImages || [],
        });
        if (namedInvocation.kind === "prompt_template") {
            const pending = hostedSession.getPendingManagedTurnIntent();
            const selectedAgent = pending.agentName || hostedSession.getActiveAgentInfo()?.agentName ||
                hostedSession.getManagedMetadata()?.activeAgent;
            if (!namedInvocation.agentName || namedInvocation.agentName === selectedAgent) {
                namedInvocation.thinkingLevel ||= pending.thinkingLevel;
            }
            namedInvocation.agentName ||= pending.agentName;
            if (!namedInvocation.model && !namedInvocation.agentName && pending.manualModel && pending.model) {
                namedInvocation.model = pending.provider ? `${pending.provider}/${pending.model}` : pending.model;
            }
            if (!namedInvocation.agentName && options.agentName && options.agentName !== AGENTS.ROUTER) {
                namedInvocation.agentName = options.agentName;
            }
        }
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
            if (!hasInitialImages && namedInvocation.kind !== "prompt_template") {
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
            if (namedInvocation.kind !== "prompt_template") {
                hostedSession.mergePendingManagedTurnIntent?.({ agentName });
            }
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
        let cleanupTurnStart: (() => void) | undefined;
        // Keep surface subscriptions alive across a user-approved Session change.
        const onTurnStarted = (context: PromptTurnContext) => {
            const cleanup = options.onTurnStarted?.(context);
            if (typeof cleanup === "function") cleanupTurnStart = cleanup;
        };
        const requestOptions = deferredFirstTurnId
            ? {
                ...options,
                onTurnStarted,
                initialRequest: displayRequest,
                preparedModelOverride,
                turnId: deferredFirstTurnId,
                emitInitialEvents: deferredBusyStarted ? false : undefined,
            }
            : { ...options, onTurnStarted, initialRequest: displayRequest, preparedModelOverride };
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
            const result = await this.promptManagedSession(sessionId, {
                ...requestOptions,
                expectedGeneration,
                ...(namedInvocation.kind !== "ordinary"
                    ? {
                        modelRequest: namedInvocation.expandedRequest,
                        namedInvocationPayload: namedInvocation.payload,
                        ...(namedInvocation.kind === "prompt_template" ? { promptTemplate: namedInvocation } : {}),
                    }
                    : {}),
            });
            if (result.templateNewSession && namedInvocation.kind === "prompt_template") {
                const created = await this.lifecycle.createInteractiveSession({
                    cwd: hostedSession.cwd,
                    mode: "new",
                    deferManagedActivationUntilAgentReady: true,
                });
                const next = this.services.sessionHost.requireSession(created.sessionId);
                next.setInteractionAdapter(hostedSession.getInteractionAdapter());
                next.notificationSurface = hostedSession.notificationSurface;
                next.localInputSurface = hostedSession.localInputSurface;
                next.setMcpRequestServers(hostedSession.getMcpRequestServers());
                this.events.emitSessionEvent(sessionId, {
                    type: RuntimeEventTypes.SESSION_REPLACED,
                    oldSessionId: sessionId,
                    newSessionId: next.id,
                    reason: "prompt_template",
                    templateName: namedInvocation.name,
                });
                const nextResult = await this.promptUserTurn(next.id, {
                    initialRequest: submittedRequest,
                    initialImages: options.initialImages,
                    inputSurface: options.inputSurface,
                });
                return { ...nextResult, replacementSessionId: next.id };
            }
            return buildResult(result);
        } finally {
            cleanupTurnStart?.();
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
                emitPromptEvents: operationOptions.promptTemplate || operationOptions.emitInitialEvents === false
                    ? false
                    : undefined,
                activateAgent: operationOptions.promptTemplate ? false : undefined,
            },
            async ({ acceptedTurnId, hasPendingImages, capability }) => {
                const template = operationOptions.promptTemplate;
                if (template) {
                    const profile = await resolvePromptTemplateSettings(hostedSession, {
                        ...template,
                        model: operationOptions.preparedModelOverride || template.model,
                    });
                    const conflict = promptTemplateWorkflowConflict(hostedSession, profile.agentName);
                    if (conflict) {
                        const response = await requestHostedSessionInteraction(
                            hostedSession,
                            {
                                type: RuntimeInteractionTypes.SELECT,
                                prompt: `/${template.name} requires ${
                                    getAgentDisplayName(profile.agentName, hostedSession.cwd)
                                }. This session has ${conflict}.`,
                                options: [
                                    { value: "new_session", label: "Open in new session" },
                                    { value: "cancel", label: "Cancel" },
                                ],
                                defaultValue: "cancel",
                            },
                            capability.signal,
                            capability,
                        );
                        if (response.outcome === "selected" && response.value === "new_session") {
                            return { ok: true, turns: 0, templateNewSession: true };
                        }
                        if (response.outcome === "unsupported" || response.outcome === "blocked") {
                            throw new Error(
                                `/${template.name} requires a different Agent during ${conflict}. Open a new session and run /${template.name} there.`,
                            );
                        }
                        return { ok: false, turns: 0, error: "Prompt canceled." };
                    }
                    const previousModel = hostedSession.getActiveModelState();
                    const previousManual = hostedSession.isUserModelOverride();
                    const slash = profile.model.indexOf("/");
                    hostedSession.setActiveModelState(
                        profile.model.slice(slash + 1),
                        profile.model.slice(0, slash),
                        profile.manualModel,
                    );
                    try {
                        await this.settings.activateSessionAgent(hostedSession, {
                            agentName: profile.agentName,
                            model: profile.model,
                            thinkingLevelOverride: profile.thinkingLevel,
                            forceRebuild: true,
                            managedOperationCapability: capability,
                        });
                    } catch (error) {
                        hostedSession.setActiveModelState(previousModel.model, previousModel.provider, previousManual);
                        if (!previousManual) hostedSession.clearUserModelOverride();
                        throw error;
                    }
                    const state = hostedSession.getActiveModelState();
                    this.events.emitSessionEvent(sessionId, {
                        type: RuntimeEventTypes.MODEL_CHANGED,
                        model: state.model,
                        provider: state.provider,
                    });
                    if (profile.manualModel) {
                        hostedSession.setActiveModelState(state.model, state.provider, true);
                        const manager = hostedSession.getRootSessionManager();
                        if (isRuntimeRootSessionManager(manager)) {
                            recordManualModelSelection(manager, state.provider, state.model);
                        }
                    }
                    await this.settings.setSessionThinkingLevel(sessionId, profile.thinkingLevel);
                    template.payload.profile = {
                        agentName: profile.agentName,
                        model: profile.model,
                        thinkingLevel: profile.thinkingLevel,
                    };
                }
                const result = await this.promptSession(sessionId, {
                    ...operationOptions,
                    turnId: acceptedTurnId,
                    onTurnStarted: undefined,
                    emitInitialEvents: template
                        ? true
                        : operationOptions.emitInitialEvents === false
                        ? false
                        : hasPendingImages,
                    suppressEpicContinuation: true,
                    signal: capability.signal,
                }, capability);
                if (template) {
                    result.namedInvocation = {
                        kind: template.kind,
                        name: template.name,
                        expansionDigest: template.payload.expansionDigest,
                        profile: template.payload.profile,
                        messageCount: result.turns,
                    };
                }
                return result;
            },
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
                if (session.isAgentTransitioning?.()) {
                    currentOperation.cancel?.();
                    operationCanceled = Boolean(currentOperation.cancel);
                }
                operationCanceled = Boolean(session.cancelActiveInteractions?.()) || operationCanceled;
                const rootAgentSession = getRuntimeRootAgentSession(session);
                if (rootAgentSession?.isCompacting && rootAgentSession?.abortCompaction) {
                    rootAgentSession.abortCompaction();
                    operationCanceled = true;
                }
                this.queues.clearQueuedMessagesInternal(session, "session_cancel");
                const transitionId = session.getAgentTransitionId?.();
                if (transitionId) session.completeAgentTransition(transitionId);
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
            const transitionId = session.getAgentTransitionId?.();
            if (transitionId) session.completeAgentTransition(transitionId);
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
