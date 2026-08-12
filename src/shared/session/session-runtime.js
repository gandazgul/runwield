/**
 * @module shared/session/session-runtime
 * Prompt loop boundary for HostedSession-based interactive turns.
 */

import { AGENTS } from "../../constants.js";
import { resolveResumeAgentName } from "./active-agent-session.js";
import { runActiveAgentTurn, switchActiveAgent } from "./agent-switching.js";
import {
    abortActiveSession as abortActiveSessionFn,
    expandPromptTemplate,
    expandSkillCommand,
    getRootSessionContextProjection,
    getRootSessionRebuildOptions,
    listLoadedAgentMdFiles,
    listPromptTemplates,
    listSkills,
    runIsolatedAgentSession,
    steerActiveSessionWithTarget,
    steerAgentSessionWithTarget,
} from "./session.js";
import { SessionHost } from "./session-host.js";
import {
    classifyRootSessionLocator,
    createRootSessionManager,
    exportRootSessionToHtml,
    exportRootSessionToJsonl,
    getRootSessionBranchEntries,
    getRunWieldSessionMemoryBackupDir,
    listCatalogSafeRootSessionLocators,
    listPersistedRootSessions,
    openPersistedRootSession,
    resolveCreatedRootSessionPath,
} from "./root-session.js";
import {
    createSessionRuntimeEvent,
    emitSystemStatus,
    getRuntimeErrorMessage,
    normalizeRuntimeToolResult,
    RuntimeEventTypes,
} from "./session-runtime-events.js";
import { describeRuntimeTool } from "./tool-event-title.js";
import {
    buildProjectedSessionContextProjection,
    buildProjectedSessionInfo,
    captureTranscriptEvidence,
    createReplayEvents as createProjectedReplayEvents,
    exportProjectedTranscript,
    getProjectedLastAssistantText,
    inspectProjectedTranscript,
    syncTranscriptFileAndParent,
    toProjectionFailure,
} from "./session-transcript-projection.js";
import { projectAggregateTranscript } from "./session-transcript-manifest.ts";
import { rollSessionTranscriptSegment } from "./segment-rollover.ts";
import { requestHostedSessionInteraction } from "./session-runtime-interactions.js";
import {
    modelSupportsImageInput,
    persistImageAttachment,
    preflightImageAttachments,
    resolveVisionFallbackModel,
} from "./image-attachments.js";
import { getModelRegistry, SYSTEM_MODEL_DISCOVERY_NETWORK } from "../models/model-registry.ts";
import { spawnForegroundShell } from "../foreground-process.ts";
import { openOwnerCoordinationStore } from "../owner-coordination/index.js";
import { buildSessionContextReport } from "./session-context-report.js";
import { getSettingsManager, setGlobalCompactionSetting } from "../settings.js";
import { getSessionKeyboardHelp } from "./session-help.js";
import {
    deriveWorkflowContextFromExecutionWorkflow,
    readPersistedPendingSegmentContinuationEntry,
} from "./workflow-context-session.js";
import { executePlanAction } from "../workflow/plan-actions.ts";
import { dirname, isAbsolute } from "@std/path";

export const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeComposition
 * @property {SessionHost} sessionHost
 * @property {import('../owner-coordination/index.js').OwnerCoordinationStore | null} ownerCoordinationStore
 * @property {'workspace' | 'tui' | 'acp' | 'test'} ownerProcessKind
 * @property {string} ownerInstanceId
 */

/**
 * @typedef {Object} CreateSessionRuntimeOptions
 * @property {import('../owner-coordination/index.js').OwnerCoordinationStore | null} [ownerCoordinationStore]
 * @property {'workspace' | 'tui' | 'acp' | 'test'} [ownerProcessKind]
 * @property {string} [ownerInstanceId]
 */

/**
 * @typedef {Object} RuntimeContextAgentSession
 * @property {() => import('../types.js').ContextUsageSnapshot | null} [getContextUsage]
 * @property {RuntimeContextModel} [model]
 * @property {RuntimeContextSettingsManager} [settingsManager]
 */

/**
 * @typedef {Object} RuntimeContextModel
 * @property {number} [contextWindow]
 */

/**
 * @typedef {Object} RuntimeCompactionSettings
 * @property {boolean} [enabled]
 */

/**
 * @typedef {Object} RuntimeContextSettingsManager
 * @property {() => RuntimeCompactionSettings | null} [getCompactionSettings]
 */

/**
 * @typedef {Object} RuntimeContextCapacity
 * @property {import('../types.js').ContextUsageSnapshot | null} contextUsage
 * @property {boolean | null} autoCompactionEnabled
 */

/**
 * @typedef {Object} PromptReadySessionOptions
 * @property {string} cwd
 * @property {string} [agentName]
 */

/**
 * @typedef {Object} PromptTurnContext
 * @property {string} turnId
 */

/**
 * @typedef {Object} PromptSessionOptions
 * @property {string} initialRequest
 * @property {import('./types.js').ImageAttachment[]} [initialImages]
 * @property {(context: PromptTurnContext) => void | (() => void)} [onTurnStarted]
 * @property {string} [agentName]
 * @property {string[]} [toolNames]
 * @property {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [customTools]
 * @property {boolean} [allowReturnToRouter]
 * @property {boolean} [includeEditFallback]
 * @property {string} [turnId]
 * @property {boolean} [emitInitialEvents]
 * @property {boolean} [suppressEpicContinuation]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} LoadSessionOptions
 * @property {string} cwd
 * @property {string} sessionId
 * @property {string} [sessionPath]
 * @property {string} [modelOverride]
 * @property {boolean} [enableManagedActivation]
 */

/**
 * @typedef {(event: import('./session-runtime-events.js').SessionRuntimeEvent) => void | Promise<void>} SessionRuntimeEventListener
 */

/**
 * @typedef {Object} SteerSessionResult
 * @property {boolean} ok
 * @property {boolean} queued
 * @property {import('./session-runtime-events.js').RuntimeQueuedMessage} [message]
 * @property {string} [reason]
 * @property {string} [error]
 */

/**
 * @typedef {Object} DequeueQueuedMessageResult
 * @property {boolean} ok
 * @property {import('./session-runtime-events.js').RuntimeQueuedMessage | null} message
 * @property {string} [warning]
 * @property {string} [error]
 */

/**
 * @typedef {Object} RuntimeQueuedMessageState
 * @property {string} id
 * @property {string} text
 * @property {import('./types.js').ImageAttachment[]} images
 * @property {"steer" | "next_turn"} delivery
 * @property {string} queuedAt
 * @property {import('@earendil-works/pi-coding-agent').AgentSession} [sourceSession]
 */

/**
 * @typedef {Object} QueueSourceSubscription
 * @property {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
 * @property {() => void} unsubscribe
 */

/**
 * @typedef {Object} ManagedSyncOptions
 * @property {boolean} [emitEvents]
 * @property {boolean} [replayFromStart]
 * @property {number} [limit]
 */

const MAX_CHAINED_HANDOFFS = 4;

export class SessionTurnInProgressError extends Error {
    /** @param {string} sessionId */
    constructor(sessionId) {
        super(`Session "${sessionId}" already has an active turn`);
        this.name = "SessionTurnInProgressError";
        this.sessionId = sessionId;
    }
}

class ManagedOperationCapability {
    /**
     * @param {{ runtimeSessionId: string, runwieldSessionId: string, operationId: string, proof: import('../owner-coordination/session-activations.js').ActivationProof }} options
     */
    constructor(options) {
        this.runtimeSessionId = options.runtimeSessionId;
        this.runwieldSessionId = options.runwieldSessionId;
        this.operationId = options.operationId;
        this.#proof = options.proof;
    }

    /** @type {import('../owner-coordination/session-activations.js').ActivationProof} */
    #proof;
    #settled = false;
    /** @type {string | null} */
    #heartbeatFailureReason = null;
    #abortController = new AbortController();

    get proof() {
        return this.#proof;
    }

    get settled() {
        return this.#settled;
    }

    get heartbeatFailureReason() {
        return this.#heartbeatFailureReason;
    }

    get signal() {
        return this.#abortController.signal;
    }

    cancel() {
        this.assertLive();
        this.#abortController.abort();
    }

    /** @param {import('../owner-coordination/session-activations.js').ActivationProof} proof */
    updateProof(proof) {
        this.assertLive();
        if (proof.runwieldSessionId !== this.runwieldSessionId || proof.operationId !== this.operationId) {
            throw new Error("Managed operation proof does not match capability");
        }
        this.#proof = proof;
    }

    /** @param {Error | string} error */
    latchHeartbeatFailure(error) {
        if (this.#heartbeatFailureReason) return;
        this.#heartbeatFailureReason = error instanceof Error ? error.message : error;
    }

    assertLive() {
        if (this.#settled) throw new Error("Managed operation capability is settled");
    }

    settle() {
        this.#settled = true;
    }
}

/**
 * @param {RuntimeQueuedMessageState} message
 * @returns {import('./session-runtime-events.js').RuntimeQueuedMessage}
 */
function toRuntimeQueuedMessage(message) {
    return {
        id: message.id,
        text: message.text,
        images: message.images.map((image) => ({ ...image })),
        delivery: message.delivery,
        queuedAt: message.queuedAt,
    };
}

/**
 * Project the context-capacity state of the Agent currently represented by the
 * Runtime. Transient Agents take precedence while they are active, matching the
 * active-agent information exposed in the footer without leaking AgentSession
 * objects across the Runtime boundary.
 *
 * @param {import('./hosted-session.js').HostedSession} session
 * @returns {RuntimeContextCapacity}
 */
function getRuntimeContextCapacity(session) {
    const sessions = [session.getRootAgentSession(), ...session.getSubAgentSessions()].filter(Boolean);
    const activeSession = /** @type {RuntimeContextAgentSession | undefined} */ (sessions.at(-1));
    if (!activeSession) return { contextUsage: null, autoCompactionEnabled: null };

    const rawUsage = activeSession.getContextUsage?.();
    const contextWindow = Number(rawUsage?.contextWindow ?? activeSession.model?.contextWindow ?? 0) || 0;
    const contextUsage = rawUsage
        ? {
            tokens: typeof rawUsage.tokens === "number" ? rawUsage.tokens : null,
            contextWindow,
            percent: typeof rawUsage.percent === "number" ? rawUsage.percent : null,
        }
        : null;
    const compactionSettings = activeSession.settingsManager?.getCompactionSettings?.();

    return {
        contextUsage,
        autoCompactionEnabled: compactionSettings?.enabled !== false,
    };
}

/**
 * Decide whether a projected attention record is newly observed for a session.
 *
 * The projector reports the last attention entry in the entire committed
 * transcript, so the same record repeats on every sync. Matching it against the
 * freshly replayed event batch cannot work: `createReplayEvents` has no branch
 * for `runwield.attention` entries, so that eventId is never present in the
 * batch and the comparison was permanently false. Compare against the id
 * observed on the previous sync instead, and treat "never observed" as a silent
 * seed so adopting a session whose transcript already contains an attention
 * entry does not notify about history.
 *
 * @param {{ attention?: { eventId?: string | null } | null } | null | undefined} summary
 * @param {string | null | undefined} previousAttentionEventId id observed on the
 *   previous sync, `null` when that sync saw none, `undefined` when this session
 *   has never been synchronized
 * @returns {boolean}
 */
export function shouldEmitProjectedAttention(summary, previousAttentionEventId) {
    const attentionEventId = typeof summary?.attention?.eventId === "string" ? summary.attention.eventId : null;
    if (!attentionEventId) return false;
    if (previousAttentionEventId === undefined) return false;
    return attentionEventId !== previousAttentionEventId;
}

/**
 * @param {*} options
 * @param {*} workflow
 * @param {*} handoff
 */
function buildSemanticRepairCiState(options, workflow, handoff) {
    const triageMeta = workflow?.triageMeta || options?.triageMeta || {};
    const state = {
        status: typeof triageMeta.status === "string" ? triageMeta.status : "",
        validationCiAttempts: typeof triageMeta.validationCiAttempts === "number" ? triageMeta.validationCiAttempts : 0,
        validationSemanticRounds: typeof triageMeta.validationSemanticRounds === "number"
            ? triageMeta.validationSemanticRounds
            : handoff.semanticRound,
        semanticRound: handoff.semanticRound,
        lastCompletedPhase: "ci",
        currentPhase: "semantic_review",
    };
    return handoff.ciState ? { ...state, ...handoff.ciState } : state;
}

export class SessionRuntime {
    /** @type {SessionHost} */
    #sessionHost;
    /** @type {Map<string, Set<SessionRuntimeEventListener>>} */
    #eventListeners;
    /** @type {Map<string, Promise<void>>} */
    #turnSettlements;
    /** @type {Map<string, RuntimeQueuedMessageState[]>} */
    #queuedMessages;
    /** @type {Map<string, Map<import('@earendil-works/pi-coding-agent').AgentSession, QueueSourceSubscription>>} */
    #queueSourceSubscriptions;
    /** @type {Map<string, number>} */
    #busyOperationDepths;
    /** @type {Map<string, import('../owner-coordination/session-activations.js').ActivationProof>} */
    #pendingManagedCreations;
    /** @type {Map<string, import('./managed-operation.ts').ManagedOperationCapability>} */
    #currentManagedOperations;
    /** @type {Map<string, Promise<unknown>>} */
    #currentManagedOperationSettlements;
    /** @type {Map<string, { projectId: string }>} */
    #pendingManagedCreationProjects;
    /** @type {Map<string, string | null>} */
    #observedAttentionEventIds;
    /** @type {import('../owner-coordination/index.js').OwnerCoordinationStore | null} */
    #ownerCoordinationStore;
    /** @type {'workspace' | 'tui' | 'acp' | 'test'} */
    #ownerProcessKind;
    /** @type {string} */
    #ownerInstanceId;

    /** @param {SessionRuntimeComposition} composition */
    constructor(composition) {
        this.#sessionHost = composition.sessionHost;
        this.#eventListeners = new Map();
        this.#turnSettlements = new Map();
        this.#queuedMessages = new Map();
        this.#queueSourceSubscriptions = new Map();
        this.#busyOperationDepths = new Map();
        this.#pendingManagedCreations = new Map();
        this.#currentManagedOperations = new Map();
        this.#currentManagedOperationSettlements = new Map();
        this.#pendingManagedCreationProjects = new Map();
        this.#observedAttentionEventIds = new Map();
        this.#ownerCoordinationStore = composition.ownerCoordinationStore;
        this.#ownerProcessKind = composition.ownerProcessKind;
        this.#ownerInstanceId = composition.ownerInstanceId;
    }

    listSessions() {
        return this.#sessionHost.listSessions()
            .map((session) => this.getSessionSnapshot(session.id))
            .filter((snapshot) => snapshot !== null);
    }

    /**
     * @param {string} sessionId
     * @returns {import('../types.js').SessionSnapshot | null}
     */
    getSessionSnapshot(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        const sessionManager = session.getRootSessionManager();
        const managed = session.getManagedMetadata?.() || null;
        const managedDormant = Boolean(managed && !sessionManager);
        const pendingManagedIntent = session.getPendingManagedTurnIntent?.() || {};
        const pendingAgentName = pendingManagedIntent.agentName || "";
        const rawSessionManagerId = sessionManager?.getSessionId?.();
        const sessionManagerId = managed
            ? null
            : typeof rawSessionManagerId === "string" && rawSessionManagerId
            ? rawSessionManagerId
            : null;
        const activeExecutionWorkflow = session.getActiveExecutionWorkflow();
        const workflowContext = session.getWorkflowContext() || (managedDormant ? managed?.workflowContext : null) ||
            deriveWorkflowContextFromExecutionWorkflow(activeExecutionWorkflow) || null;
        const contextCapacity = getRuntimeContextCapacity(session);
        const activeModelState = session.getActiveModelState();
        const managedModel = managedDormant ? managed?.model || "" : "";
        const managedProvider = managedDormant ? managed?.provider || "" : "";
        const managedThinkingLevel = managedDormant ? managed?.thinkingLevel || "" : "";
        return {
            id: session.id,
            cwd: session.cwd,
            sessionManagerId,
            name: sessionManager?.getSessionName?.() || managed?.name || null,
            disposed: session.disposed,
            managed: managed
                ? {
                    runwieldSessionId: managed.runwieldSessionId,
                    projectId: managed.projectId,
                    currentSegmentId: managed.currentSegmentId,
                    generation: managed.generation,
                    acknowledgedGeneration: managed.acknowledgedGeneration ?? managed.generation ?? null,
                    acknowledgedEventId: managed.acknowledgedEventId ?? null,
                    syncState: managed.syncState
                        ? {
                            status: managed.syncState.status,
                            localGeneration: managed.syncState.localGeneration,
                            latestGeneration: managed.syncState.latestGeneration,
                            ...(managed.syncState.owningSurfaceKind
                                ? { owningSurfaceKind: managed.syncState.owningSurfaceKind }
                                : {}),
                            ...(managed.syncState.message ? { message: managed.syncState.message } : {}),
                        }
                        : null,
                    dormant: managedDormant,
                }
                : null,
            activeAgent: pendingAgentName || session.getRootAgentName() ||
                (managedDormant ? managed?.activeAgent || null : null),
            activeAgentInfo: pendingAgentName
                ? { displayName: pendingAgentName, model: "", provider: "", agentName: pendingAgentName }
                : session.getActiveAgentInfo(),
            activeModel: {
                model: pendingManagedIntent.model || activeModelState.model || managedModel,
                provider: pendingManagedIntent.provider || activeModelState.provider || managedProvider,
            },
            thinkingLevel: pendingManagedIntent.thinkingLevel || managedThinkingLevel || session.getThinkingLevel(),
            busy: session.isTurnActive() || (this.#busyOperationDepths.get(session.id) || 0) > 0,
            activeTurnId: session.getActiveTurnId(),
            queuedMessages: this.getQueuedMessages(session.id),
            workflowContext: workflowContext ? { ...workflowContext } : null,
            activeExecutionWorkflow: activeExecutionWorkflow ? { ...activeExecutionWorkflow } : null,
            ...contextCapacity,
        };
    }

    /**
     * Return the Runtime-owned active agent, never the dormant managed projection
     * cache. Dormant local intent is allowed because it is a live user command
     * waiting for activation; committed transcript markers are applied only by
     * hydration paths before activation.
     *
     * @param {string} sessionId
     * @returns {string | null}
     */
    getRuntimeActiveAgentName(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        const pendingAgentName = session.getPendingManagedTurnIntent?.()?.agentName || "";
        if (pendingAgentName) return pendingAgentName;
        if (session.getManagedMetadata?.() && !session.getRootSessionManager?.()) return null;
        return session.getRootAgentName() || null;
    }

    /**
     * Return the live execution workflow owned by Runtime, never a display
     * snapshot. Managed dormant sessions have no live execution workflow until
     * activation hydrates one explicitly.
     *
     * @param {string} sessionId
     * @returns {Record<string, any> | null}
     */
    getRuntimeActiveExecutionWorkflow(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        const workflow = session.getActiveExecutionWorkflow?.() || null;
        return workflow ? { ...workflow } : null;
    }

    /**
     * @param {string} sessionId
     * @returns {boolean}
     */
    isManagedSessionDormant(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        return Boolean(session?.getManagedMetadata?.() && !session.getRootSessionManager?.());
    }

    /**
     * Return the user-facing reason a new root turn should not be submitted
     * right now. Runtime owns this decision because it depends on managed
     * coordination state, not on display snapshots.
     *
     * @param {string} sessionId
     * @returns {string | null}
     */
    getUserTurnSubmissionBlockMessage(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        const syncState = session?.getManagedMetadata?.()?.syncState || null;
        if (!syncState) return null;
        if (syncState.status === "active_elsewhere") {
            return `This managed Session is active in ${
                syncState.owningSurfaceKind || "another surface"
            }. Wait for it to finish before sending from this surface.`;
        }
        if (syncState.status === "blocked" || syncState.status === "degraded") {
            return syncState.message || "This managed Session needs recovery before accepting new input.";
        }
        return null;
    }

    /**
     * @param {string} sessionId
     * @returns {import('./session-runtime-events.js').RuntimeQueuedMessage[]}
     */
    getQueuedMessages(sessionId) {
        return (this.#queuedMessages.get(sessionId) || []).map(toRuntimeQueuedMessage);
    }

    /**
     * Runtime busy state is reference-counted because a public workflow action
     * can nest other Runtime-owned model work. Consumers receive only aggregate
     * idle/busy transitions, never a premature idle event from an inner action.
     *
     * @param {string} sessionId
     * @param {string} [turnId]
     */
    #beginBusyOperation(sessionId, turnId) {
        const depth = this.#busyOperationDepths.get(sessionId) || 0;
        this.#busyOperationDepths.set(sessionId, depth + 1);
        if (depth === 0) {
            this.#emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.BUSY_CHANGED,
                ...(turnId ? { turnId } : {}),
                busy: true,
            });
        }
    }

    /**
     * @param {string} sessionId
     * @param {string} [turnId]
     */
    #endBusyOperation(sessionId, turnId) {
        const depth = this.#busyOperationDepths.get(sessionId) || 0;
        if (depth <= 0) return;
        if (depth > 1) {
            this.#busyOperationDepths.set(sessionId, depth - 1);
            return;
        }
        this.#busyOperationDepths.delete(sessionId);
        this.#emitSessionEvent(sessionId, {
            type: RuntimeEventTypes.BUSY_CHANGED,
            ...(turnId ? { turnId } : {}),
            busy: false,
        });
    }

    /**
     * @template T
     * @param {string} sessionId
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    async #runBusyOperation(sessionId, operation) {
        this.#beginBusyOperation(sessionId);
        try {
            return await operation();
        } finally {
            this.#endBusyOperation(sessionId);
        }
    }

    /**
     * @param {import('./hosted-session.js').HostedSession | null | undefined} hostedSession
     * @param {string} operation
     */
    #rejectManagedPublicMutation(hostedSession, operation, capability = null) {
        if (!hostedSession?.getManagedMetadata?.()) return null;
        const currentCapability = this.#currentManagedOperations.get(hostedSession.id) || null;
        if (currentCapability && currentCapability !== capability) {
            return { ok: false, error: "managed_operation_in_progress", operation };
        }
        if (capability && currentCapability === capability) return null;
        return { ok: false, error: "managed_operation_required", operation };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     */
    #ensureQueueSourceSubscription(hostedSession, sourceSession) {
        let subscriptions = this.#queueSourceSubscriptions.get(hostedSession.id);
        if (!subscriptions) {
            subscriptions = new Map();
            this.#queueSourceSubscriptions.set(hostedSession.id, subscriptions);
        }
        if (subscriptions.has(sourceSession)) return;
        const unsubscribe = sourceSession.subscribe((event) => {
            if (event.type !== "queue_update") return;
            this.#reconcileQueuedMessages(hostedSession, sourceSession, event.steering);
        });
        subscriptions.set(sourceSession, { sourceSession, unsubscribe });
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     * @param {readonly string[] | undefined} steering
     */
    #reconcileQueuedMessages(hostedSession, sourceSession, steering) {
        const sourceMessages = (this.#queuedMessages.get(hostedSession.id) || [])
            .filter((message) => message.sourceSession === sourceSession);
        const consumedCount = Math.max(0, sourceMessages.length - (steering?.length || 0));
        for (const message of sourceMessages.slice(0, consumedCount)) {
            this.#transitionQueuedMessage(hostedSession, message, "consumed");
        }
        const sourceStillQueued = (this.#queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (!sourceStillQueued) this.#removeQueueSourceSubscription(hostedSession.id, sourceSession);
    }

    /**
     * @param {string} sessionId
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     */
    #removeQueueSourceSubscription(sessionId, sourceSession) {
        const subscriptions = this.#queueSourceSubscriptions.get(sessionId);
        if (!subscriptions) return;
        const subscription = subscriptions.get(sourceSession);
        if (!subscription) return;
        subscription.unsubscribe();
        subscriptions.delete(sourceSession);
        if (subscriptions.size === 0) this.#queueSourceSubscriptions.delete(sessionId);
    }

    /** @param {string} sessionId */
    #removeAllQueueSourceSubscriptions(sessionId) {
        const subscriptions = this.#queueSourceSubscriptions.get(sessionId);
        if (!subscriptions) return;
        for (const subscription of subscriptions.values()) subscription.unsubscribe();
        this.#queueSourceSubscriptions.delete(sessionId);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {RuntimeQueuedMessageState} message
     * @param {"consumed" | "dequeued"} status
     * @param {string} [reason]
     */
    #transitionQueuedMessage(hostedSession, message, status, reason) {
        const queue = this.#queuedMessages.get(hostedSession.id);
        const index = queue?.indexOf(message) ?? -1;
        if (!queue || index < 0) return null;
        queue.splice(index, 1);
        if (queue.length === 0) this.#queuedMessages.delete(hostedSession.id);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.#emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
            status,
            message: publicMessage,
            ...(reason ? { reason } : {}),
        });
        if (status === "consumed" && message.delivery === "steer") {
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.USER_MESSAGE,
                messageId: message.id,
                text: message.text,
                images: message.images.map((image) => ({ ...image })),
            });
        }
        return publicMessage;
    }

    /**
     * Queue a steering message in the active foreground AgentSession and publish
     * the resulting core state. Adapters should render QUEUED_MESSAGE_CHANGED
     * rather than subscribing to AgentSession directly.
     *
     * @param {string} sessionId
     * @param {string} text
     * @param {import('./types.js').ImageAttachment[]} [images]
     * @returns {Promise<SteerSessionResult>}
     */
    async steerSession(sessionId, text, images = []) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(hostedSession, "steerSession");
        if (managedRejection) return { ...managedRejection, queued: false };
        const activeTarget = /** @type {any} */ (hostedSession.getActiveSteeringTargetSession?.());
        const rootSession = /** @type {any} */ (hostedSession.getRootAgentSession());
        const expectedTarget = activeTarget?.isStreaming ? activeTarget : rootSession;
        if (!expectedTarget?.isStreaming) return { ok: true, queued: false, reason: "not_streaming" };

        this.#ensureQueueSourceSubscription(hostedSession, expectedTarget);
        const sourceSession = await steerActiveSessionWithTarget(hostedSession, text, images);
        if (!sourceSession) {
            this.#removeQueueSourceSubscription(hostedSession.id, expectedTarget);
            return { ok: true, queued: false, reason: "not_streaming" };
        }

        const message = /** @type {RuntimeQueuedMessageState} */ ({
            id: crypto.randomUUID(),
            text,
            images: images.map((image) => ({ ...image })),
            delivery: "steer",
            queuedAt: new Date().toISOString(),
            sourceSession,
        });
        this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
        const publicMessage = this.#trackQueuedMessage(hostedSession, message);
        const activeSteering = sourceSession.getSteeringMessages?.();
        if (Array.isArray(activeSteering)) {
            this.#reconcileQueuedMessages(hostedSession, sourceSession, activeSteering);
        }
        return { ok: true, queued: true, message: publicMessage };
    }

    /**
     * Queue a message for a later prompt when it could not be accepted as live
     * steering. This state is core-owned so every UI sees the same queue.
     *
     * @param {string} sessionId
     * @param {string} text
     * @param {import('./types.js').ImageAttachment[]} [images]
     * @returns {any}
     */
    queueNextTurnMessage(sessionId, text, images = []) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const managed = hostedSession.getManagedMetadata?.();
        if (managed) {
            if (hostedSession.getRootSessionManager?.()) {
                return { ok: false, queued: false, error: "managed_operation_in_progress" };
            }
            return this.#runManagedStandaloneMutation(sessionId, "submit_user_turn", (activeSession) => {
                const message = /** @type {RuntimeQueuedMessageState} */ ({
                    id: crypto.randomUUID(),
                    text,
                    images: images.map((image) => ({ ...image })),
                    delivery: "next_turn",
                    queuedAt: new Date().toISOString(),
                });
                return { ok: true, queued: true, message: this.#trackQueuedMessage(activeSession, message) };
            }, { activateAgent: false });
        }
        const message = /** @type {RuntimeQueuedMessageState} */ ({
            id: crypto.randomUUID(),
            text,
            images: images.map((image) => ({ ...image })),
            delivery: "next_turn",
            queuedAt: new Date().toISOString(),
        });
        return { ok: true, queued: true, message: this.#trackQueuedMessage(hostedSession, message) };
    }

    /**
     * Claim the oldest deferred message for execution. Removing it emits the
     * same consumed transition as a steering message; promptSession publishes
     * its USER_MESSAGE event when execution begins.
     *
     * @param {string} sessionId
     * @returns {DequeueQueuedMessageResult}
     */
    takeNextTurnMessage(sessionId) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(hostedSession, "takeNextTurnMessage");
        if (managedRejection) return { ...managedRejection, message: null };
        const selected = (this.#queuedMessages.get(hostedSession.id) || [])
            .find((message) => message.delivery === "next_turn");
        if (!selected) return { ok: true, message: null };
        const publicMessage = this.#transitionQueuedMessage(hostedSession, selected, "consumed");
        return { ok: true, message: publicMessage };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {RuntimeQueuedMessageState} message
     */
    #trackQueuedMessage(hostedSession, message) {
        let queue = this.#queuedMessages.get(hostedSession.id);
        if (!queue) {
            queue = [];
            this.#queuedMessages.set(hostedSession.id, queue);
        }
        queue.push(message);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.#emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
            status: "queued",
            message: publicMessage,
        });
        return publicMessage;
    }

    /**
     * Dequeue the latest core-owned message. Deferred messages are removed
     * directly. AgentSession exposes only whole-queue clearing for live
     * steering, so earlier steering and follow-up messages are immediately
     * restored while queue reconciliation is suspended.
     *
     * @param {string} sessionId
     * @returns {Promise<DequeueQueuedMessageResult>}
     */
    async dequeueLastQueuedMessage(sessionId) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(hostedSession, "dequeueLastQueuedMessage");
        if (managedRejection) return { ...managedRejection, message: null };
        const queue = this.#queuedMessages.get(hostedSession.id) || [];
        const selected = queue.at(-1);
        if (!selected) return { ok: true, message: null };

        if (selected.delivery === "next_turn") {
            const publicMessage = this.#transitionQueuedMessage(
                hostedSession,
                selected,
                "dequeued",
                "user_recall",
            );
            return { ok: true, message: publicMessage };
        }

        const sourceSession = selected.sourceSession;
        if (!sourceSession) return { ok: false, message: null, error: "queue_not_mutable" };
        if (typeof sourceSession.clearQueue !== "function") {
            return { ok: false, message: null, error: "queue_not_mutable" };
        }
        const sourceMessages = queue.filter((message) => message.sourceSession === sourceSession);
        this.#removeQueueSourceSubscription(hostedSession.id, sourceSession);
        /** @type {{ steering: string[], followUp: string[] }} */
        let cleared;
        try {
            cleared = sourceSession.clearQueue();
        } catch (error) {
            this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
            return {
                ok: false,
                message: null,
                error: getRuntimeErrorMessage(error),
            };
        }

        let requeueError = "";
        try {
            for (const message of sourceMessages) {
                if (message.id === selected.id) continue;
                const requeued = await steerAgentSessionWithTarget(sourceSession, message.text, message.images);
                if (requeued !== sourceSession) {
                    throw new Error("source session stopped streaming while restoring its queue");
                }
            }
            for (const followUp of cleared.followUp || []) await sourceSession.followUp(followUp);
        } catch (error) {
            requeueError = getRuntimeErrorMessage(error);
        }

        const publicMessage = toRuntimeQueuedMessage(selected);
        if (requeueError) {
            for (const message of sourceMessages) {
                this.#transitionQueuedMessage(
                    hostedSession,
                    message,
                    "dequeued",
                    message.id === selected.id ? "user_recall" : "requeue_failed",
                );
            }
            return { ok: true, message: publicMessage, warning: requeueError };
        }

        this.#transitionQueuedMessage(hostedSession, selected, "dequeued", "user_recall");
        const sourceStillQueued = (this.#queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (sourceStillQueued) this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
        return { ok: true, message: publicMessage };
    }

    /**
     * @param {string} sessionId
     * @param {string} [reason]
     */
    async clearQueuedMessages(sessionId, reason = "cleared") {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, cleared: 0, error: "not_found" };
        const managed = hostedSession.getManagedMetadata?.();
        if (managed && !hostedSession.getRootSessionManager?.()) {
            return await this.#runManagedStandaloneMutation(
                sessionId,
                "submit_user_turn",
                (activeSession) => this.#clearQueuedMessages(activeSession, reason),
                { activateAgent: false },
            );
        }
        const managedRejection = this.#rejectManagedPublicMutation(hostedSession, "clearQueuedMessages");
        if (managedRejection) return { ...managedRejection, cleared: 0 };
        return this.#clearQueuedMessages(hostedSession, reason);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {string} reason
     */
    #clearQueuedMessages(hostedSession, reason) {
        const messages = [...(this.#queuedMessages.get(hostedSession.id) || [])];
        const sources = new Set(messages.map((message) => message.sourceSession).filter(Boolean));
        const clearedSources = new Set();
        for (const sourceSession of sources) {
            if (!sourceSession || typeof sourceSession.clearQueue !== "function") continue;
            this.#removeQueueSourceSubscription(hostedSession.id, sourceSession);
            try {
                sourceSession.clearQueue();
                clearedSources.add(sourceSession);
            } catch {
                this.#ensureQueueSourceSubscription(hostedSession, sourceSession);
            }
        }
        const clearedMessages = messages.filter((message) =>
            message.delivery === "next_turn" ||
            (message.sourceSession && clearedSources.has(message.sourceSession))
        );
        for (const message of clearedMessages) {
            this.#transitionQueuedMessage(hostedSession, message, "dequeued", reason);
        }
        return { ok: true, cleared: clearedMessages.length };
    }

    /**
     * @template T
     * @param {string} sessionId
     * @param {import('./managed-operation.ts').ManagedOperationName} name
     * @param {(session: import('./hosted-session.js').HostedSession, capability: import('./managed-operation.ts').ManagedOperationCapability) => T | Promise<T>} operation
     * @param {{ activateAgent?: boolean }} [options]
     * @returns {Promise<any>}
     */
    async #runManagedStandaloneMutation(sessionId, name, operation, options = {}) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return /** @type {any} */ ({ ok: false, error: "not_found" });
        const managed = session.getManagedMetadata?.();
        if (this.#pendingManagedCreations.has(sessionId) || this.#pendingManagedCreationProjects.has(sessionId)) {
            return { ok: false, error: "managed_operation_in_progress" };
        }
        if (!managed) {
            return await operation(session, /** @type {any} */ (null));
        }
        if (session.getRootSessionManager?.()) {
            return { ok: false, error: "managed_operation_in_progress" };
        }
        return await this.#runManagedOperation(
            sessionId,
            {
                name,
                options: { expectedGeneration: managed.generation ?? undefined },
                activateAgent: options.activateAgent === true,
            },
            async ({ capability }) => await operation(session, capability),
        );
    }

    /**
     * @param {string} sessionId
     * @param {string} name
     */
    async renameSession(sessionId, name) {
        const normalizedName = String(name || "").trim();
        if (!normalizedName) return { ok: false, error: "invalid_name" };
        return await this.#runManagedStandaloneMutation(sessionId, "rename", (session) => {
            session.getRootSessionManager()?.appendSessionInfo?.(normalizedName);
            this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.SESSION_RENAMED, name: normalizedName });
            return { ok: true, name: normalizedName };
        }, { activateAgent: false });
    }

    /**
     * @param {string} sessionId
     * @param {string} model
     * @param {string} [provider]
     * @param {boolean} [userOverride]
     */
    async setSessionModel(sessionId, model, provider = "", userOverride = true) {
        return await this.#runManagedStandaloneMutation(sessionId, "set_model", (session) => {
            session.setActiveModelState(model, provider, userOverride);
            this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
            return { ok: true, model, provider };
        }, { activateAgent: false });
    }

    /**
     * Apply a model override and rebuild the active root agent through the
     * runtime boundary.
     *
     * @param {string} sessionId
     * @param {string} model
     * @param {string} [provider]
     */
    async reconfigureSessionModel(sessionId, model, provider = "") {
        return await this.#runManagedStandaloneMutation(sessionId, "set_model", async (session, capability) => {
            const previousUserOverride = session.isUserModelOverride?.() === true;
            const previousModelState = session.getActiveModelState();
            session.setActiveModelState(model, provider, true);
            const agentName = session.getRootAgentName();
            try {
                if (agentName) {
                    await this.#activateSessionAgent(session, {
                        agentName,
                        model: provider ? `${provider}/${model}` : model,
                        forceRebuild: true,
                        managedOperationCapability: capability,
                    });
                }
            } catch (error) {
                if (previousUserOverride) {
                    session.setActiveModelState(previousModelState.model, previousModelState.provider || "", true);
                } else {
                    session.clearUserModelOverride?.();
                }
                throw error;
            }
            this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
            return { ok: true, model, provider };
        }, { activateAgent: false });
    }

    /** @param {string} sessionId @param {string} context */
    async setProjectStateContext(sessionId, context) {
        return await this.#runManagedStandaloneMutation(sessionId, "workflow_operation", (session) => {
            session.setProjectStateContext(context);
            return { ok: true };
        }, { activateAgent: false });
    }

    /**
     * Run a transient agent inside an existing runtime session. Consumers may
     * select behavior, but the internal HostedSession and Pi manager never
     * cross the runtime boundary.
     *
     * @param {string} sessionId
     * @param {{
     *   agentName: string,
     *   userRequest: string,
     *   subAgentDefinition?: { id: import('./subagent-definitions.ts').SubAgentDefinitionId, options?: import('./subagent-definitions.ts').LoadSubAgentDefinitionOptions },
     *   images?: import('./types.js').ImageAttachment[],
     *   toolNames?: string[],
     *   customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[],
     *   modelOverride?: string,
     *   allowReturnToRouter?: boolean,
     * }} options
     */
    async runIsolatedAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runIsolatedAgent: session not found");
        const managedRejection = this.#rejectManagedPublicMutation(session, "runIsolatedAgent");
        if (managedRejection) throw new Error("managed_operation_required");
        return await this.#runBusyOperation(session.id, () =>
            runIsolatedAgentSession({
                hostedSession: session,
                agentName: options.agentName,
                userRequest: options.userRequest,
                images: options.images || [],
                toolNames: options.toolNames,
                customTools: options.customTools,
                modelOverride: options.modelOverride,
                allowReturnToRouter: options.allowReturnToRouter,
                subAgentDefinition: options.subAgentDefinition,
            }));
    }

    /** @param {string} sessionId @param {Record<string, any>} workflow */
    async setActiveExecutionWorkflow(sessionId, workflow) {
        return await this.#runManagedStandaloneMutation(sessionId, "workflow_operation", (session) => {
            session.setActiveExecutionWorkflow(/** @type {any} */ (workflow));
            return { ok: true };
        }, { activateAgent: false });
    }

    /** @param {string} sessionId */
    async clearActiveExecutionWorkflow(sessionId) {
        return await this.#runManagedStandaloneMutation(sessionId, "workflow_operation", (session) => {
            session.clearActiveExecutionWorkflow();
            return { ok: true };
        }, { activateAgent: false });
    }

    /**
     * @template T
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {string} _operationName
     * @param {Record<string, any>} options
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    async #runWorkflowOperation(session, _operationName, options, operation) {
        const managed = session.getManagedMetadata?.();
        if (!managed) {
            return await this.#runBusyOperation(session.id, operation);
        }
        if (session.getRootSessionManager?.()) {
            throw new Error("managed_operation_in_progress");
        }
        const result = await this.#runManagedOperation(
            session.id,
            {
                name: "workflow_operation",
                options: {
                    ...options,
                    expectedGeneration: managed.generation ?? undefined,
                },
                activateAgent: true,
            },
            async () => await operation(),
        );
        if (result?.ok === false && result.error) throw new Error(result.error);
        return result;
    }

    /**
     * Run a repository-only Plan action under managed Session Activation without hydrating Pi.
     * @param {string} sessionId
     * @param {import('../workflow/plan-actions.ts').PlanActionRequest} request
     */
    async runPlanAction(sessionId, request) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runPlanAction: session not found");
        const managed = session.getManagedMetadata?.();
        if (!managed) return await executePlanAction(session.cwd, request);
        if (session.getRootSessionManager?.()) throw new Error("managed_operation_in_progress");
        const result = await this.#runManagedOperation(
            session.id,
            {
                name: "workflow_operation",
                options: { expectedGeneration: managed.generation ?? undefined },
                activateAgent: false,
                hydrate: false,
                emitPromptEvents: false,
            },
            async () => await executePlanAction(session.cwd, request),
        );
        if (result?.ok === false && result.error === "refresh_required") {
            return {
                kind: "refresh_required",
                message: "Session generation changed. Refresh and retry.",
                evidence: {
                    planId: request.planId,
                    planName: "",
                    revision: request.expectedRevision,
                    status: request.expectedStatus,
                    worktree: request.expectedWorktree,
                },
            };
        }
        if (result?.ok === false && result.error === "managed_operation_in_progress") {
            return {
                kind: "activation_unavailable",
                message: "Session activation is not available for this Plan action.",
            };
        }
        if (result?.ok === false && result.error) throw new Error(result.error);
        return result;
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async executePlan(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.executePlan: session not found");
        const managed = session.getManagedMetadata?.();
        if (!managed) {
            return await this.#runWorkflowOperation(session, "executePlan", options, async () => {
                const { executePlan } = await import("../workflow/workflow.js");
                return await executePlan(/** @type {any} */ ({ ...options, hostedSession: session }));
            });
        }
        const pendingResult = await this.#resumePendingExecutionSegmentHandoff(session, options);
        if (pendingResult) return pendingResult;
        const prepared = await this.#runWorkflowOperation(session, "prepareExecutePlan", options, async () => {
            const { executePlan } = await import("../workflow/workflow.js");
            return await executePlan(
                /** @type {any} */ ({
                    ...options,
                    hostedSession: session,
                    prepareSegmentHandoff: true,
                }),
            );
        });
        if (!prepared?.executionSegmentHandoff) return prepared;
        const latestManaged = session.getManagedMetadata?.() || managed;
        await this.rollManagedSessionSegment(sessionId, {
            kind: "execution",
            continuation: prepared.executionSegmentHandoff,
            expectedGeneration: latestManaged.generation,
        });
        return await this.#resumePendingExecutionSegmentHandoff(session, options) || prepared;
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {*} options
     * @returns {Promise<* | null>}
     */
    async #resumePendingExecutionSegmentHandoff(session, options) {
        const managed = session.getManagedMetadata?.();
        if (!managed) return null;
        return await this.#runWorkflowOperation(session, "resumeExecutionSegmentHandoff", options, async () => {
            const marker = readPersistedPendingSegmentContinuationEntry(
                /** @type {any} */ (session.getRootSessionManager?.()),
            );
            const { resolvePendingSegmentHandoff } = await import("../workflow/execution-segment-handoff.ts");
            const resolved = await resolvePendingSegmentHandoff({
                marker: /** @type {any} */ (marker),
                projectRoot: session.cwd,
                runwieldSessionId: managed.runwieldSessionId,
            });
            if (resolved.kind === "absent" || resolved.kind === "consumed") return null;
            if (resolved.kind === "refresh_required" || resolved.kind === "recovery_required") {
                throw new Error(resolved.message);
            }
            if (resolved.continuation.kind === "semantic_repair") {
                return await this.#runSemanticRepairContinuation(
                    session.id,
                    session,
                    options,
                    resolved.continuation,
                    true,
                );
            }
            const { executePreparedPlanSegmentHandoff } = await import("../workflow/workflow.js");
            return await executePreparedPlanSegmentHandoff(
                /** @type {any} */ ({
                    continuation: resolved.continuation,
                    hostedSession: session,
                }),
            );
        });
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async runPlanningAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runPlanningAgent: session not found");
        return await this.#runWorkflowOperation(session, "runPlanningAgent", options, async () => {
            const { runPlanningAgent } = await import("../workflow/workflow.js");
            return await runPlanningAgent(
                /** @type {any} */ ({
                    ...options,
                    hostedSession: session,
                    sessionManager: /** @type {any} */ (session.getRootSessionManager() || undefined),
                }),
            );
        });
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async runSlicerAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runSlicerAgent: session not found");
        return await this.#runWorkflowOperation(session, "runSlicerAgent", options, async () => {
            const { runSlicerAgent } = await import("../workflow/workflow-slicer.ts");
            return await runSlicerAgent(
                /** @type {any} */ ({
                    ...options,
                    hostedSession: session,
                    sessionManager: /** @type {any} */ (session.getRootSessionManager() || undefined),
                }),
            );
        });
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    /**
     * @param {string} sessionId
     * @param {*} options
     * @returns {Promise<*>}
     */
    async runValidation(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runValidation: session not found");
        const pendingResult = await this.#resumePendingExecutionSegmentHandoff(session, options);
        if (pendingResult) return pendingResult;
        const result = await this.#runWorkflowOperation(session, "runValidation", options, async () => {
            const { runValidationLoop, SYSTEM_SEMANTIC_REVIEW_PORT } = await import("../workflow/validation.ts");
            const { createGitPort } = await import("../git-port.ts");
            const { systemLocalCIPort } = await import("../workflow/validation-local-ci.ts");
            const { SYSTEM_WORK_RECORD_MNEMOSYNE_PORT } = await import("../work-records/mnemosyne-port.ts");
            const { loadPlan } = await import("../../plan-store.js");
            const validationPorts = {
                git: createGitPort(),
                localCI: systemLocalCIPort,
                workRecordMnemosynePort: SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
            };
            let latestResult = await runValidationLoop(
                /** @type {any} */ ({
                    ...options,
                    hostedSession: session,
                    ...validationPorts,
                    semanticReviewPort: SYSTEM_SEMANTIC_REVIEW_PORT,
                    supportsSemanticRepairHandoff: true,
                }),
            );
            for (let phase = 0; phase < 2; phase += 1) {
                if (latestResult?.kind !== "paused") break;
                const plan = await loadPlan(session.cwd, options.planName).catch(() => null);
                if (!plan) break;
                const status = plan.attrs?.status;
                if (status !== "validated_ci" && status !== "validated_reviewer") break;
                latestResult = await runValidationLoop(
                    /** @type {any} */ ({
                        ...options,
                        hostedSession: session,
                        planContent: plan.markdown || plan.body || options.planContent,
                        triageMeta: { ...options.triageMeta, ...plan.attrs },
                        ...validationPorts,
                        semanticReviewPort: SYSTEM_SEMANTIC_REVIEW_PORT,
                        supportsSemanticRepairHandoff: true,
                    }),
                );
            }
            return latestResult;
        });
        if (result?.kind === "semantic_repair_handoff") {
            return await this.#runSemanticRepairSegmentHandoff(sessionId, options, result);
        }
        await this.#continueEpicAfterValidation(session, /** @type {any} */ (result));
        return result;
    }

    /**
     * @param {string} sessionId
     * @param {*} options
     * @param {*} validationResult
     * @returns {Promise<*>}
     */
    async #runSemanticRepairSegmentHandoff(sessionId, options, validationResult) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runSemanticRepairSegmentHandoff: session not found");
        const managed = session.getManagedMetadata?.();
        if (!managed) return validationResult;
        const workflow = session.getActiveExecutionWorkflow?.() ||
            validationResult.semanticRepairHandoff?.activeWorkflow;
        if (!workflow) throw new Error("Semantic repair handoff requires an active execution workflow.");
        const { loadPlanActionEvidence } = await import("../workflow/plan-actions.ts");
        const { getPlanRevisionForText } = await import("../../plan-store.js");
        const { buildSemanticRepairSegmentContinuation } = await import("../workflow/execution-segment-handoff.ts");
        const planId = workflow.triageMeta?.planId || options.triageMeta?.planId;
        if (!planId) throw new Error("Semantic repair handoff requires Plan identity.");
        const evidence = await loadPlanActionEvidence(workflow.projectRoot || session.cwd, planId);
        if (evidence.kind !== "success") throw new Error(evidence.message);
        const handoff = validationResult.semanticRepairHandoff;
        const continuation = buildSemanticRepairSegmentContinuation({
            runwieldSessionId: managed.runwieldSessionId,
            planId,
            planName: options.planName,
            approvedRevision: workflow.triageMeta?.revision || await getPlanRevisionForText(options.planContent || ""),
            approvedStatus: workflow.triageMeta?.status || "implemented",
            approvedMarkdown: options.planContent || "",
            preparedEvidence: evidence.evidence,
            activeWorkflow: { ...workflow, ...handoff.activeWorkflow },
            executionOwner: workflow.executionAgent || AGENTS.ENGINEER,
            semanticRound: handoff.semanticRound,
            reviewLedger: handoff.reviewLedger,
            repairBaselineTree: handoff.repairBaselineTree,
            lastRepairReport: handoff.lastRepairReport,
            executionState: { executionCwd: workflow.executionCwd, baselineTree: workflow.baselineTree },
            ciState: buildSemanticRepairCiState(options, workflow, handoff),
            priorRepairClaims: workflow.lastRepairReport ? [workflow.lastRepairReport] : [],
            diffText: handoff.diffText,
            findingsSection: handoff.findingsSection,
        });
        const latestManaged = session.getManagedMetadata?.() || managed;
        await this.rollManagedSessionSegment(sessionId, {
            kind: "semantic_repair",
            continuation,
            expectedGeneration: latestManaged.generation,
        });
        return await this.#runSemanticRepairContinuation(sessionId, session, options, continuation);
    }

    /**
     * @param {string} sessionId
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {*} options
     * @param {*} continuation
     * @param {boolean} alreadyManaged
     * @returns {Promise<*>}
     */
    async #runSemanticRepairContinuation(sessionId, session, options, continuation, alreadyManaged = false) {
        const workflow = continuation.activeWorkflow || {};
        const projectRoot = workflow.projectRoot || session.cwd;
        const executionCwd = workflow.executionCwd || session.cwd;
        const runRepair = async () => {
            session.setActiveExecutionWorkflow(/** @type {any} */ (continuation.activeWorkflow));
            const { buildValidationRepairPrompt } = await import("../workflow/validation-repair-prompt.ts");
            const { createReviewDiffTool, buildDiffInspectionSection } = await import(
                "../workflow/review-diff-tool.js"
            );
            const { readLatestTaskCompletedMessage, readLatestTaskCompletedOutcome } = await import(
                "../workflow/workflow-results.js"
            );
            const messages = await runActiveAgentTurn({
                hostedSession: session,
                agentName: continuation.executionOwner,
                userRequest: buildValidationRepairPrompt({
                    planName: continuation.plan.planName,
                    projectRoot,
                    executionCwd,
                    repairCwd: executionCwd,
                    planContent: continuation.plan.markdown,
                    worktreeId: workflow.worktreeId,
                    worktreeBranch: workflow.worktreeBranch,
                    worktreeBaseBranch: workflow.worktreeBaseBranch,
                    ciStateSummary: JSON.stringify(continuation.repair.ciState),
                    authorityNote: "A code reviewer found these issues. Fix every finding.",
                    repairsNeeded: [
                        "### Findings",
                        "",
                        continuation.repair.findingsSection || "(no findings text supplied)",
                        "",
                        buildDiffInspectionSection(continuation.repair.diffText),
                    ].join("\n"),
                    completionInstruction: "Report a disposition for every finding, then call task_completed.",
                }),
                cwd: executionCwd,
                allowReturnToRouter: false,
                dispatchKind: "validation_repair",
                customTools: [createReviewDiffTool({ full: continuation.repair.diffText })],
            });
            const completed = readLatestTaskCompletedOutcome(messages);
            const report = readLatestTaskCompletedMessage(messages) || "";
            session.setActiveExecutionWorkflow(
                /** @type {any} */ ({
                    ...continuation.activeWorkflow,
                    lastRepairReport: report,
                }),
            );
            if (!completed) {
                return {
                    kind: "paused",
                    planName: continuation.plan.planName || options.planName,
                    projectRoot,
                    reason: "Semantic repair segment paused before task_completed.",
                };
            }
            return {
                kind: "semantic_repair_completed",
                planName: continuation.plan.planName || options.planName,
                projectRoot,
            };
        };
        const repairResult = alreadyManaged
            ? await runRepair()
            : await this.#runWorkflowOperation(session, "semanticRepairSegment", options, runRepair);
        if (repairResult?.kind === "semantic_repair_completed") {
            return await this.runValidation(sessionId, {
                ...options,
                planName: continuation.plan.planName || options.planName,
                planContent: continuation.plan.markdown || options.planContent,
                executionContext: session.getActiveExecutionWorkflow?.(),
            });
        }
        return repairResult;
    }

    /** @param {string} sessionId @param {boolean} enabled @returns {Promise<any>} */
    async setSessionAutoCompaction(sessionId, enabled) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        await setGlobalCompactionSetting("enabled", enabled);
        const managed = session.getManagedMetadata?.();
        if (managed && !session.getRootSessionManager?.()) {
            return { ok: true, enabled, deferred: true };
        }
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        if (!rootAgentSession?.setAutoCompactionEnabled) return { ok: false, error: "unsupported" };
        rootAgentSession.setAutoCompactionEnabled(enabled);
        await rootAgentSession.settingsManager?.flush?.();
        return { ok: true, enabled };
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<{ ok: true, managed: import('./hosted-session.js').ManagedSessionMetadata, entries: unknown[], projection: any } | { ok: false, error: string, message: string }>}
     */
    async #readManagedCommittedProjection(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        const managed = session?.getManagedMetadata?.() || null;
        if (!session || !managed) return { ok: false, error: "not_managed", message: "Session is not managed." };
        if (!this.#ownerCoordinationStore) {
            return { ok: false, error: "owner_coordination_unavailable", message: "Managed read is unavailable." };
        }
        let inspected;
        try {
            this.#ownerCoordinationStore.requireActivationProtocolEnabled();
            inspected = this.#ownerCoordinationStore.inspectSessionActivation(managed.runwieldSessionId);
        } catch (_error) {
            return { ok: false, error: "managed_read_blocked", message: "Managed read is unavailable." };
        }
        if (!inspected.generation) {
            return { ok: false, error: "committed_generation_unavailable", message: "Managed read is unavailable." };
        }
        try {
            const segments = this.#ownerCoordinationStore.listSessionTranscriptSegments(managed.runwieldSessionId);
            const projection = await projectAggregateTranscript({
                cwd: session.cwd,
                sessionDir: dirname(managed.transcriptPath),
                runwieldSessionId: managed.runwieldSessionId,
                runtimeSessionId: sessionId,
                generation: inspected.generation,
                segments,
            });
            if (!projection.ok) return { ok: false, error: projection.code, message: projection.message };
            const evidence = await captureTranscriptEvidence({
                transcriptPath: managed.transcriptPath,
                transcriptCwd: session.cwd,
                byteLength: inspected.generation.byteLength,
            });
            return { ok: true, managed, entries: evidence.entries, projection };
        } catch (error) {
            const failure = toProjectionFailure(error);
            return { ok: false, error: failure.code, message: failure.message };
        }
    }

    /** @param {string} sessionId */
    async replaySession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, replayed: 0, error: "not_found" };
        const managed = session.getManagedMetadata?.() || null;
        const manager = session.getRootSessionManager();
        if (managed && !manager) {
            const projected = await this.#readManagedCommittedProjection(sessionId);
            if (!projected.ok) return { ok: false, replayed: 0, error: projected.error };
            const events = projected.projection.events || [];
            for (const event of events) this.#emitSessionEvent(sessionId, /** @type {any} */ (event));
            return { ok: true, replayed: events.length };
        }
        const events = createProjectedReplayEvents(sessionId, manager ? getRootSessionBranchEntries(manager) : []);
        for (const event of events) this.#emitSessionEvent(sessionId, /** @type {any} */ (event));
        return { ok: true, replayed: events.length };
    }

    /**
     * @param {string} sessionId
     * @param {import('./types.js').ImageAttachment} image
     * @returns {Promise<any>}
     */
    async persistSessionImage(sessionId, image) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.persistSessionImage: session not found");
        const managed = session.getManagedMetadata?.();
        if (managed && !session.getRootSessionManager?.()) {
            if (!this.#ownerCoordinationStore) {
                throw new Error("Cannot persist image attachment: no active session is available.");
            }
            try {
                return await this.#runManagedOperation(
                    sessionId,
                    {
                        name: "submit_user_turn",
                        options: { expectedGeneration: managed.generation ?? undefined },
                        activateAgent: false,
                    },
                    async () => await this.persistSessionImage(sessionId, image),
                );
            } catch (error) {
                if (
                    String(error instanceof Error ? error.message : error).includes(
                        "activation protocol is not enabled",
                    )
                ) {
                    throw new Error("Cannot persist image attachment: no active session is available.");
                }
                throw error;
            }
        }
        return await this.#persistActiveSessionImage(session, image);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {import('./types.js').ImageAttachment} image
     * @returns {Promise<any>}
     */
    async #persistActiveSessionImage(session, image) {
        const sessionManager = session.getRootSessionManager();
        return await persistImageAttachment(
            image,
            /** @type {any} */ (sessionManager),
            session.cwd,
        );
    }

    /**
     * @param {string} sessionId
     * @param {import('./types.js').ImageAttachment[]} images
     */
    async preflightSessionImages(sessionId, images) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, message: "Runtime session not found." };
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        const modelState = session.getActiveModelState();
        const managed = session.getManagedMetadata?.();
        const modelProvider = modelState.provider || managed?.provider || "";
        const modelId = modelState.model || managed?.model || "";
        const modelRegistry = rootAgentSession?.modelRegistry || getModelRegistry();
        const activeModel = rootAgentSession?.model ||
            (modelProvider && modelId ? modelRegistry.find(modelProvider, modelId) : undefined);
        let fallbackModelRef;
        if (images.length > 0 && !modelSupportsImageInput(activeModel)) {
            fallbackModelRef = (await resolveVisionFallbackModel(modelRegistry, SYSTEM_MODEL_DISCOVERY_NETWORK))
                ?.modelRef;
        }
        return preflightImageAttachments(images, { activeModel, fallbackModelRef });
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('./types.js').ImageAttachment[]} images
     * @returns {Promise<import('./types.js').ImageAttachment[]>}
     */
    async #persistPendingPromptImages(hostedSession, images) {
        if (images.length === 0) return images;
        const sessionManager = hostedSession.getRootSessionManager();
        if (!sessionManager) throw new Error("Cannot persist image attachment: no active session is available.");
        const persisted = [];
        for (const image of images) {
            if (image.path || image.ref) {
                persisted.push(image);
                continue;
            }
            persisted.push(await persistImageAttachment(image, /** @type {any} */ (sessionManager), hostedSession.cwd));
        }
        return persisted;
    }

    /** @param {string} sessionId */
    requestSessionHelp(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const help = getSessionKeyboardHelp();
        this.#emitSessionEvent(sessionId, {
            type: RuntimeEventTypes.KEYBOARD_HELP,
            title: help.title,
            items: help.items,
        });
        return { ok: true };
    }

    /**
     * @param {string} sessionId
     * @returns {any}
     */
    cycleSessionThinkingLevel(sessionId) {
        /** @param {import('./hosted-session.js').HostedSession} session */
        const run = (session) => {
            const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
            const levels = /** @type {const} */ (["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
            const currentLevel = session.getThinkingLevel();
            const next = rootAgentSession?.cycleThinkingLevel?.() ??
                levels[(levels.indexOf(/** @type {any} */ (currentLevel)) + 1) % levels.length];
            if (next === undefined) {
                this.#emitSessionEvent(sessionId, {
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    message: "Current model does not support thinking",
                });
                return { ok: false, error: "unsupported" };
            }
            session.setThinkingLevel(next);
            this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.THINKING_LEVEL_CHANGED, thinkingLevel: next });
            return { ok: true, thinkingLevel: next };
        };
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const managed = session.getManagedMetadata?.();
        if (managed && !session.getRootSessionManager?.()) {
            return /** @type {any} */ (this.#runManagedStandaloneMutation(sessionId, "set_thinking_level", run, {
                activateAgent: true,
            }));
        }
        return run(session);
    }

    /**
     * Execute a consumer-requested local shell command as one Runtime-owned
     * tool lifecycle. The consumer never publishes presentation events.
     *
     * @param {string} sessionId
     * @param {{ command: string, userRequest?: string, persist?: boolean }} options
     * @returns {Promise<any>}
     */
    async runLocalShellCommand(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, exitCode: 1, output: "", error: "not_found" };
        const command = String(options?.command || "").trim();
        if (!command) return { ok: false, exitCode: 1, output: "", error: "empty_command" };
        const managed = session.getManagedMetadata?.();
        if (managed && !session.getRootSessionManager?.()) {
            return await this.#runManagedOperation(
                sessionId,
                {
                    name: "local_shell",
                    options: { expectedGeneration: managed.generation ?? undefined },
                    activateAgent: false,
                },
                async ({ capability }) => await this.#runLocalShellCommandInSession(session, options, capability),
            );
        }
        if (managed) {
            return { ok: false, exitCode: 1, output: "", error: "managed_operation_in_progress" };
        }
        return await this.#runLocalShellCommandInSession(session, options, null);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {{ command: string, userRequest?: string, persist?: boolean }} options
     * @param {import('./managed-operation.ts').ManagedOperationCapability | null} capability
     * @returns {Promise<any>}
     */
    async #runLocalShellCommandInSession(session, options, capability) {
        const sessionId = session.id;
        const command = String(options?.command || "").trim();
        const persist = options.persist !== false && !session.isTurnActive();
        const userRequest = options.userRequest || `!${command}`;
        const toolCallId = `bash-${crypto.randomUUID()}`;
        const startedAt = Date.now();
        const runtimeTool = {
            ...describeRuntimeTool("bash", { command }),
            title: `${userRequest.startsWith("!!") ? "!!" : "!"} ${command}`,
        };
        const interactionId = `local-shell:${toolCallId}`;
        const abortController = new AbortController();
        let canceled = false;
        let output = "";
        let exitCode = 1;

        const abort = () => {
            canceled = true;
            if (!abortController.signal.aborted) abortController.abort();
        };
        abortController.signal.addEventListener("abort", abort, { once: true });
        capability?.signal?.addEventListener("abort", abort, { once: true });
        session.addActiveInteraction(interactionId, { abortController });

        if (persist) {
            this.#emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.USER_MESSAGE,
                text: userRequest,
                images: [],
            });
        }
        this.#emitSessionEvent(sessionId, {
            type: RuntimeEventTypes.TOOL_START,
            toolCallId,
            ...runtimeTool,
            args: { command },
        });

        try {
            // The foreground-process module owns the wrapper shell's process
            // group, so cancellation terminates the whole descendant tree, not
            // only `sh -c`.
            const shell = spawnForegroundShell({
                command,
                cwd: session.cwd,
                env: { PWD: session.cwd },
                signal: abortController.signal,
            });

            /** @param {ReadableStream<Uint8Array>} stream */
            const readStream = async (stream) => {
                const reader = stream.getReader();
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        if (canceled) continue;
                        output += new TextDecoder().decode(value);
                        this.#emitSessionEvent(sessionId, {
                            type: RuntimeEventTypes.TOOL_UPDATE,
                            toolCallId,
                            ...runtimeTool,
                            ...normalizeRuntimeToolResult(output),
                        });
                    }
                } finally {
                    reader.releaseLock();
                }
            };

            // The streams settle when the process tree dies, so final output and
            // active-interaction cleanup never race a still-running descendant.
            const [outcome] = await Promise.all([
                shell.done,
                readStream(shell.stdout),
                readStream(shell.stderr),
            ]);
            if (outcome.terminatedBy) canceled = true;
            exitCode = canceled ? 130 : outcome.exitCode ?? 1;
        } catch (error) {
            if (!canceled) {
                output += `Error starting process: ${error instanceof Error ? error.message : String(error)}\n`;
            }
            exitCode = canceled ? 130 : 1;
        } finally {
            abortController.signal.removeEventListener("abort", abort);
            capability?.signal?.removeEventListener("abort", abort);
            session.removeActiveInteraction(interactionId);
        }

        const finalText = canceled ? `${output}\n[RunWield] Command canceled by user.` : output;
        this.#emitSessionEvent(sessionId, {
            type: RuntimeEventTypes.TOOL_END,
            toolCallId,
            ...runtimeTool,
            ...normalizeRuntimeToolResult(finalText),
            isError: canceled || exitCode !== 0,
            durationMs: Date.now() - startedAt,
        });
        if (canceled) {
            this.#emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.SYSTEM_STATUS,
                message: "Bash command canceled.",
            });
        } else if (persist) {
            this.#recordLocalToolExchange(session, {
                userRequest,
                toolCallId,
                command,
                output,
                exitCode,
                isError: exitCode !== 0,
            });
        }

        return { ok: !canceled && exitCode === 0, exitCode, output, canceled, toolCallId };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {{ userRequest: string, toolCallId: string, command: string, output: string, exitCode: number, isError: boolean }} exchange
     */
    #recordLocalToolExchange(session, exchange) {
        const manager = session.getRootSessionManager();
        const bashResult = {
            output: exchange.output,
            exitCode: exchange.exitCode,
            cancelled: false,
            truncated: false,
        };
        const agentSession =
            /** @type {{ recordBashResult?: (command: string, result: typeof bashResult, options?: { excludeFromContext?: boolean }) => void } | null} */ (
                session.getRootAgentSession()
            );
        if (agentSession?.recordBashResult) {
            agentSession.recordBashResult(exchange.command, bashResult, { excludeFromContext: false });
            return { ok: true };
        }
        const bashMessage = {
            role: "bashExecution",
            command: exchange.command,
            output: bashResult.output,
            exitCode: bashResult.exitCode,
            cancelled: bashResult.cancelled,
            truncated: bashResult.truncated,
            timestamp: Date.now(),
            excludeFromContext: false,
        };
        if (manager?.appendMessage) {
            manager.appendMessage(bashMessage);
            return { ok: true };
        }
        if (manager?.addMessage) {
            manager.addMessage(bashMessage);
            return { ok: true };
        }
        return { ok: false, error: "not_found" };
    }

    /** @param {string} sessionId @param {string} [instructions] */
    async compactSession(sessionId, instructions = undefined) {
        return await this.#runManagedStandaloneMutation(sessionId, "compact", async (session) => {
            const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
            if (!rootAgentSession?.compact) throw new Error("Runtime session cannot be compacted.");
            return await this.#runBusyOperation(session.id, () => rootAgentSession.compact(instructions));
        }, { activateAgent: true });
    }

    /** @param {string} sessionId @returns {Promise<any>} */
    async reloadSession(sessionId) {
        return await this.#runManagedStandaloneMutation(sessionId, "reload", async (session, capability) => {
            const agentName = session.getRootAgentName();
            if (!agentName) return { ok: false };
            const rebuildOptions = getRootSessionRebuildOptions(session);
            await getSettingsManager(session.cwd).reload();
            await this.#activateSessionAgent(session, {
                ...rebuildOptions,
                agentName,
                forceRebuild: true,
                managedOperationCapability: capability,
            });
            return { ok: true };
        }, { activateAgent: true });
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<any>}
     */
    async getLastAssistantText(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        const managed = session?.getManagedMetadata?.() || null;
        if (managed && !session?.getRootSessionManager?.()) {
            const projected = await this.#readManagedCommittedProjection(sessionId);
            return projected.ok ? getProjectedLastAssistantText(projected.entries) : {
                ok: false,
                error: projected.error,
                message: projected.message,
            };
        }
        const messages = /** @type {any[]} */ (
            /** @type {any} */ (session?.getRootAgentSession())?.agent?.state?.messages || []
        );
        for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
            const text = message.content
                .filter((/** @type {any} */ block) => block?.type === "text" && typeof block.text === "string")
                .map((/** @type {any} */ block) => block.text)
                .join("\n")
                .trim();
            if (text) return text;
        }
        return null;
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<any>}
     */
    async getSessionInfo(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        const managed = session.getManagedMetadata?.() || null;
        const manager = /** @type {any} */ (session.getRootSessionManager());
        if (managed && !manager) {
            const projected = await this.#readManagedCommittedProjection(sessionId);
            return projected.ok
                ? buildProjectedSessionInfo(projected.entries, {
                    sessionId: managed.piSessionId,
                    cwd: session.cwd,
                    transcriptPath: managed.transcriptPath,
                })
                : { ok: false, error: projected.error, message: projected.message };
        }
        const entries = manager?.getEntries?.() || [];
        const info = buildProjectedSessionInfo(entries, {
            sessionId: manager?.getSessionId?.() || sessionId,
            cwd: session.cwd,
            transcriptPath: manager?.getSessionFile?.() || "In-memory",
        });
        info.name = manager?.getSessionName?.() || info.name;
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        info.compactionSettings = rootAgentSession?.settingsManager?.getCompactionSettings?.() || null;
        info.contextUsage = rootAgentSession?.getContextUsage?.() || null;
        return info;
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<any>}
     */
    async getSessionContextReport(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        if (session.getManagedMetadata?.() && !session.getRootSessionManager?.()) {
            const projected = await this.#readManagedCommittedProjection(sessionId);
            if (!projected.ok) return { ok: false, error: projected.error, message: projected.message };
            const info = buildProjectedSessionInfo(projected.entries, {
                sessionId,
                cwd: session.cwd,
                transcriptPath: session.getManagedMetadata?.()?.transcriptPath,
            });
            return buildSessionContextReport({
                projection: buildProjectedSessionContextProjection(projected.entries),
                contextUsage: null,
                activeMessageTokens: info.inputTokens + info.outputTokens + info.cacheReadTokens +
                    info.cacheWriteTokens,
                contextWindow: null,
            });
        }
        const projection = getRootSessionContextProjection(session);
        if (!projection) return null;
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        const snapshot = this.getSessionSnapshot(sessionId);
        return buildSessionContextReport({
            agentName: projection.agentName,
            agentDisplayName: projection.agentDisplayName,
            model: snapshot?.activeModel || undefined,
            projection: projection.projection,
            contextUsage: rootAgentSession?.getContextUsage?.() || null,
            activeMessageTokens: projection.activeMessageTokens,
            contextWindow: rootAgentSession?.model?.contextWindow,
        });
    }

    /** @param {string} sessionId */
    getSessionMemoryBackupDir(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        const managed = session?.getManagedMetadata?.() || null;
        const manager = session?.getRootSessionManager();
        const persistedId = managed?.piSessionId || manager?.getSessionId?.();
        if (!session || !persistedId) throw new Error("Runtime session has no persisted session id.");
        return getRunWieldSessionMemoryBackupDir(session.cwd, persistedId);
    }

    /** @param {string} cwd */
    async listResumableSessions(cwd) {
        if (!cwd || !isAbsolute(cwd)) {
            throw new Error("SessionRuntime.listResumableSessions requires an absolute cwd");
        }
        if (!this.#ownerCoordinationStore) {
            return { ok: false, error: "owner_coordination_unavailable", sessions: [] };
        }
        const classified = await classifyRootSessionLocator({
            cwd,
            ownerCoordinationStore: this.#ownerCoordinationStore,
        });
        if (classified.kind === "managed") {
            const listed = await listCatalogSafeRootSessionLocators(cwd);
            return listed.locators.map((locator) => ({
                id: locator.piSessionId,
                path: locator.sessionPath,
                cwd: locator.headerCwd,
                modified: locator.headerTimestamp || undefined,
                messageCount: undefined,
                firstMessage: undefined,
                name: undefined,
            }));
        }
        if (classified.kind === "blocked") {
            return { ok: false, error: classified.reason || "managed_read_blocked", sessions: [] };
        }
        return await listPersistedRootSessions(cwd);
    }

    /**
     * @param {{ cwd: string, sessionId: string, sessionPath?: string }} options
     */
    async #inspectUnmanagedResumableSession(options) {
        const { estimateTokens } = await import("@earendil-works/pi-coding-agent");
        const { sessionManager } = await openPersistedRootSession(options);
        try {
            const context = sessionManager.buildSessionContext?.();
            const messages = Array.isArray(context?.messages) ? context.messages : [];
            let estimatedTokens = 0;
            for (const message of messages) estimatedTokens += estimateTokens(/** @type {any} */ (message));
            const model = context?.model && typeof context.model === "object"
                ? /** @type {{ provider: string, modelId: string }} */ (context.model)
                : null;
            return { estimatedTokens, messageCount: messages.length, model };
        } finally {
            /** @type {any} */ (sessionManager).dispose?.();
        }
    }

    /**
     * Inspect the model context of a persisted session without exposing its
     * SessionManager to the consumer.
     *
     * @param {{ cwd: string, sessionId: string, sessionPath?: string }} options
     */
    async inspectResumableSession(options) {
        if (!this.#ownerCoordinationStore) {
            return {
                estimatedTokens: 0,
                messageCount: 0,
                model: null,
                ok: false,
                error: "owner_coordination_unavailable",
            };
        }
        const classified = await classifyRootSessionLocator({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath: options.sessionPath,
            ownerCoordinationStore: this.#ownerCoordinationStore,
        });
        if (classified.kind === "managed" && classified.session) {
            const inspected = this.#ownerCoordinationStore?.inspectSessionActivation(
                classified.session.runwieldSessionId,
            );
            if (!inspected?.generation) {
                return {
                    estimatedTokens: 0,
                    messageCount: 0,
                    model: null,
                    ok: false,
                    error: "committed_generation_unavailable",
                };
            }
            try {
                const evidence = await captureTranscriptEvidence({
                    transcriptPath: classified.session.transcriptPath,
                    transcriptCwd: classified.session.transcriptCwd,
                    byteLength: inspected.generation.byteLength,
                });
                if (evidence.digestHex !== inspected.generation.digestHex) {
                    return { estimatedTokens: 0, messageCount: 0, model: null, ok: false, error: "evidence_mismatch" };
                }
                if (evidence.terminalEntryId !== inspected.generation.terminalEntryId) {
                    return { estimatedTokens: 0, messageCount: 0, model: null, ok: false, error: "terminal_mismatch" };
                }
                return inspectProjectedTranscript(evidence.entries);
            } catch (error) {
                return {
                    estimatedTokens: 0,
                    messageCount: 0,
                    model: null,
                    ok: false,
                    error: toProjectionFailure(error).code,
                };
            }
        }
        if (classified.kind === "blocked") {
            return {
                estimatedTokens: 0,
                messageCount: 0,
                model: null,
                ok: false,
                error: classified.reason || "managed_read_blocked",
            };
        }
        return await this.#inspectUnmanagedResumableSession(options);
    }

    /** @param {string} sessionId */
    async listSessionPromptTemplates(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.listSessionPromptTemplates: session not found");
        return await listPromptTemplates({ cwd: session.cwd });
    }

    /** @param {string} sessionId */
    async listSessionSkills(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.listSessionSkills: session not found");
        return await listSkills({ cwd: session.cwd });
    }

    /** @param {string} sessionId */
    async listSessionContextFiles(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.listSessionContextFiles: session not found");
        return await listLoadedAgentMdFiles(session.cwd);
    }

    /** @param {string} sessionId @param {string} skillName @param {string} [instructions] */
    async expandSessionSkillCommand(sessionId, skillName, instructions) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.expandSessionSkillCommand: session not found");
        return await expandSkillCommand(skillName, instructions, session.cwd);
    }

    /** @param {string} templatePath @param {string} [instructions] */
    async expandSessionPromptTemplate(templatePath, instructions) {
        return await expandPromptTemplate(templatePath, instructions);
    }

    /** @param {string} sessionId @param {string} outputPath */
    async exportSession(sessionId, outputPath) {
        const session = this.#sessionHost.getSession(sessionId);
        const managed = session?.getManagedMetadata?.() || null;
        const manager = /** @type {any} */ (session?.getRootSessionManager());
        if (managed && !manager) {
            const projected = await this.#readManagedCommittedProjection(sessionId);
            if (!projected.ok) throw new Error(projected.message);
            if (!session) throw new Error("Runtime session has no persistence store.");
            return await exportProjectedTranscript(projected.entries, {
                cwd: session.cwd,
                sessionId: managed.piSessionId,
            }, outputPath);
        }
        if (!manager) throw new Error("Runtime session has no persistence store.");
        return outputPath.toLowerCase().endsWith(".jsonl")
            ? exportRootSessionToJsonl(manager, outputPath)
            : await exportRootSessionToHtml(manager, outputPath);
    }

    /**
     * @param {string} sessionId
     * @param {import('./hosted-session.js').ThinkingLevel} thinkingLevel
     */
    setSessionThinkingLevel(sessionId, thinkingLevel) {
        /** @param {import('./hosted-session.js').HostedSession} session */
        const run = (session) => {
            session.setThinkingLevel(thinkingLevel);
            this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.THINKING_LEVEL_CHANGED, thinkingLevel });
            return { ok: true, thinkingLevel };
        };
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const managed = session.getManagedMetadata?.();
        if (managed && !session.getRootSessionManager?.()) {
            return /** @type {any} */ (this.#runManagedStandaloneMutation(
                sessionId,
                "set_thinking_level",
                run,
                { activateAgent: false },
            ));
        }
        return run(session);
    }

    /** @param {string} id */
    closeSession(id) {
        const hostedSession = this.#sessionHost.getSession(id);
        if (hostedSession && this.#currentManagedOperations.has(hostedSession.id)) {
            return this.#closeSessionAfterManagedOperation(hostedSession.id);
        }
        if (hostedSession) this.#clearQueuedMessages(hostedSession, "session_closed");
        const closed = this.#sessionHost.disposeSession(id);
        if (closed) {
            this.#emitSessionEvent(id, { type: RuntimeEventTypes.SESSION_CLOSED });
            this.#eventListeners.delete(id);
            const queueSubscriptions = this.#queueSourceSubscriptions.get(id);
            for (const queueSubscription of queueSubscriptions?.values() || []) queueSubscription.unsubscribe();
            this.#queueSourceSubscriptions.delete(id);
            this.#queuedMessages.delete(id);
            this.#busyOperationDepths.delete(id);
            this.#pendingManagedCreations.delete(id);
            this.#pendingManagedCreationProjects.delete(id);
            this.#observedAttentionEventIds.delete(id);
        }
        return { ok: true, closed };
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<{ ok: boolean, closed: boolean }>}
     */
    async #closeSessionAfterManagedOperation(sessionId) {
        await this.#awaitManagedOperationSettlement(sessionId);
        return this.closeSession(sessionId);
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async #awaitManagedOperationSettlement(sessionId) {
        while (this.#currentManagedOperations.has(sessionId)) {
            await this.#currentManagedOperationSettlements.get(sessionId)?.catch(() => undefined);
            if (this.#currentManagedOperations.has(sessionId)) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }
    }

    /**
     * Cancel an active turn, wait for the underlying Agent Session prompt to
     * settle, then dispose the Hosted Session.
     *
     * @param {string} sessionId
     */
    async closeSessionWhenIdle(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: true, closed: false };
        if (session.isTurnActive()) {
            this.cancelSession(session.id);
            await this.#turnSettlements.get(session.id);
        }
        await this.#awaitManagedOperationSettlement(session.id);
        return await this.closeSession(session.id);
    }

    async closeAllSessions() {
        const sessions = this.listSessions();
        for (const session of sessions) {
            try {
                const hostedSession = this.#sessionHost.getSession(session.id);
                if (hostedSession) this.cancelSession(hostedSession.id);
            } catch {
                // Shutdown cleanup is best effort.
            }
            await this.closeSession(session.id);
        }
        return { ok: true, closed: sessions.length };
    }

    async closeAllSessionsWhenIdle() {
        const sessions = this.listSessions();
        await Promise.all(sessions.map((session) => this.closeSessionWhenIdle(session.id)));
        return { ok: true, closed: sessions.length };
    }

    /**
     * @param {string} sessionId
     * @param {SessionRuntimeEventListener} listener
     * @returns {() => void}
     */
    subscribeSessionEvents(sessionId, listener) {
        let listeners = this.#eventListeners.get(sessionId);
        if (!listeners) {
            listeners = new Set();
            this.#eventListeners.set(sessionId, listeners);
        }
        listeners.add(listener);
        return () => {
            const current = this.#eventListeners.get(sessionId);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) this.#eventListeners.delete(sessionId);
        };
    }

    /**
     * @param {string} sessionId
     * @param {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} event
     */
    #emitSessionEvent(sessionId, event) {
        const sessionName = event.type === RuntimeEventTypes.ATTENTION_REQUESTED && !("sessionName" in event)
            ? this.#sessionHost.getSession(sessionId)?.getRootSessionManager()?.getSessionName?.() || undefined
            : undefined;
        const enrichedEvent = /** @type {any} */ (sessionName ? { ...event, sessionName } : event);
        const runtimeEvent = createSessionRuntimeEvent(sessionId, enrichedEvent);
        const listeners = this.#eventListeners.get(sessionId);
        if (!listeners) return;
        for (const listener of Array.from(listeners)) {
            try {
                const result = listener(runtimeEvent);
                if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
                    result.catch(() => {});
                }
            } catch {
                // Event subscribers are adapter concerns; a bad adapter listener must not
                // crash an in-flight RunWield prompt.
            }
        }
    }

    /** @param {import('./hosted-session.js').HostedSession} hostedSession */
    #attachRuntimeEventSink(hostedSession) {
        if (!hostedSession) throw new Error("SessionRuntime.attachRuntimeEventSink: session not found");
        hostedSession.setEventSink({
            emit: (
                /** @type {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} */ event,
            ) => {
                this.#emitSessionEvent(hostedSession.id, event);
            },
        });
    }

    /**
     * Commit one matching root Agent Session and Agent Handler pair.
     * Initial activation, resume, user switching, and typed handoffs all use
     * this transaction instead of exposing its internal phases.
     *
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('./agent-switching.js').AgentSwitchOptions} options
     */
    async #activateSessionAgent(hostedSession, options) {
        let pendingCreation = this.#pendingManagedCreations.get(hostedSession.id);
        const pendingProject = this.#pendingManagedCreationProjects.get(hostedSession.id);
        if (!pendingCreation && pendingProject) {
            if (!this.#ownerCoordinationStore) throw new Error("Managed Session requires an owner coordination store");
            let sessionManager = hostedSession.getRootSessionManager();
            let createdSessionManager = false;
            try {
                if (!sessionManager) {
                    sessionManager = /** @type {any} */ (
                        await createRootSessionManager("new", hostedSession.cwd)
                    );
                    hostedSession.setRootSessionManager(sessionManager);
                    createdSessionManager = true;
                }
                if (!sessionManager) throw new Error("Managed Session root manager was not created");
                const activeSessionManager = sessionManager;
                const piSessionId = activeSessionManager.getSessionId?.();
                if (!piSessionId) throw new Error("Created managed Session has no Pi session id");
                const transcriptPath = await this.#resolveCreatedSessionPath(hostedSession.cwd, activeSessionManager);
                const managedSession = await this.#ownerCoordinationStore.ensureSessionCatalogRecord({
                    projectId: pendingProject.projectId,
                    piSessionId,
                    transcriptPath,
                    transcriptCwd: hostedSession.cwd,
                    source: "created",
                });
                const managedSegment = this.#ownerCoordinationStore.getCurrentSessionSegment(
                    managedSession.runwieldSessionId,
                );
                if (!managedSegment) throw new Error("Created managed Session has no current segment");
                pendingCreation = this.#ownerCoordinationStore.acquireSessionActivation({
                    runwieldSessionId: managedSession.runwieldSessionId,
                    projectId: managedSession.projectId,
                    ownerInstanceId: this.#ownerInstanceId,
                    ownerProcessKind: this.#ownerProcessKind,
                    expectedGeneration: null,
                    phase: "preparing",
                });
                hostedSession.setManagedMetadata({
                    runwieldSessionId: managedSession.runwieldSessionId,
                    projectId: managedSession.projectId,
                    piSessionId: managedSession.piSessionId,
                    transcriptPath: managedSession.transcriptPath,
                    currentSegmentId: managedSegment.segmentId,
                    generation: null,
                    acknowledgedGeneration: null,
                    acknowledgedEventId: null,
                    name: managedSession.displayName,
                    activeAgent: null,
                    workflowContext: null,
                    syncState: {
                        type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                        status: "syncing",
                        localGeneration: null,
                        latestGeneration: null,
                    },
                });
                this.#pendingManagedCreationProjects.delete(hostedSession.id);
                this.#pendingManagedCreations.set(hostedSession.id, pendingCreation);
            } catch (error) {
                this.#pendingManagedCreationProjects.delete(hostedSession.id);
                if (createdSessionManager) {
                    sessionManager?.dispose?.();
                    hostedSession.setRootSessionManager(null);
                }
                throw error;
            }
        }
        if (!pendingCreation) return await switchActiveAgent(hostedSession, options);
        if (!this.#ownerCoordinationStore) throw new Error("Managed Session requires an owner coordination store");
        let activeProof = pendingCreation;
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) throw new Error("Managed Session metadata disappeared during creation");
        const capability = new ManagedOperationCapability({
            runtimeSessionId: hostedSession.id,
            runwieldSessionId: managed.runwieldSessionId,
            operationId: activeProof.operationId,
            proof: activeProof,
        });
        this.#currentManagedOperations.set(hostedSession.id, capability);
        /** @type {() => void} */
        let settleManagedCreation = () => {};
        this.#currentManagedOperationSettlements.set(
            hostedSession.id,
            new Promise((resolve) => {
                settleManagedCreation = () => resolve(undefined);
            }),
        );
        hostedSession.setManagedOperationCapability(capability);
        let hydrated = false;
        try {
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "hydrated");
            capability.updateProof(activeProof);
            hydrated = true;
            const result = await switchActiveAgent(hostedSession, {
                ...options,
                managedOperationCapability: capability,
            });
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "checkpointing");
            capability.updateProof(activeProof);
            const managed = hostedSession.getManagedMetadata?.();
            if (!managed) throw new Error("Managed Session metadata disappeared during creation");
            await syncTranscriptFileAndParent(managed.transcriptPath);
            const evidence = await captureTranscriptEvidence({
                transcriptPath: managed.transcriptPath,
                transcriptCwd: hostedSession.cwd,
            });
            this.#ownerCoordinationStore.publishGenerationAndRelease(activeProof, {
                generation: 0,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
                currentSegmentId: managed.currentSegmentId,
            });
            hostedSession.setManagedMetadata({ ...managed, generation: 0, acknowledgedGeneration: 0 });
            this.#pendingManagedCreations.delete(hostedSession.id);
            this.#pendingManagedCreationProjects.delete(hostedSession.id);
            hostedSession.dehydrateManagedSession();
            await this.synchronizeManagedSession(hostedSession.id, { emitEvents: false, replayFromStart: true });
            return result;
        } catch (error) {
            this.#pendingManagedCreations.delete(hostedSession.id);
            this.#pendingManagedCreationProjects.delete(hostedSession.id);
            try {
                if (hydrated) {
                    this.#ownerCoordinationStore.markSessionUncertain(activeProof, {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                } else {
                    this.#ownerCoordinationStore.releaseUnchangedActivation(activeProof);
                }
            } catch {
                // Preserve the original creation/setup failure.
            }
            throw error;
        } finally {
            capability.settle();
            this.#currentManagedOperations.delete(hostedSession.id);
            this.#currentManagedOperationSettlements.delete(hostedSession.id);
            settleManagedCreation();
            hostedSession.setManagedOperationCapability(null);
        }
    }

    /** @param {import('./hosted-session.js').HostedSession} hostedSession */
    async #alignActiveExecutionWorkflowOwner(hostedSession) {
        const workflow = hostedSession.getActiveExecutionWorkflow?.() || null;
        const executionAgent = typeof workflow?.executionAgent === "string" ? workflow.executionAgent.trim() : "";
        if (!executionAgent) return;
        const executionCwd = typeof workflow?.executionCwd === "string" ? workflow.executionCwd : "";
        await this.#activateSessionAgent(hostedSession, {
            agentName: executionAgent,
            allowReturnToRouter: false,
            ...(executionCwd ? { cwd: executionCwd } : {}),
        });
    }

    /** @param {string} cwd */
    #findEnabledManagedProjectForCwd(cwd) {
        if (!this.#ownerCoordinationStore) return null;
        let realCwd = "";
        try {
            realCwd = Deno.realPathSync(cwd);
        } catch {
            return null;
        }
        for (const project of this.#ownerCoordinationStore.listProjects()) {
            if (project.lifecycle !== "enabled" || project.currentRoot !== realCwd) continue;
            this.#ownerCoordinationStore.requireEnabledProjectRoot(project.projectId);
            return project;
        }
        return null;
    }

    /**
     * Managed activation is an explicit Runtime operation mode, not an ambient
     * consequence of having an owner-coordination database or a cataloged
     * transcript. Normal interactive consumers may run inside registered
     * Projects and may resume cataloged transcripts; those flows must remain
     * ordinary live sessions unless their caller explicitly opts into managed
     * fencing.
     *
     * @param {{ enableManagedActivation?: boolean }} options
     * @returns {boolean}
     */
    #shouldUseManagedActivation(options) {
        return options.enableManagedActivation === true;
    }

    /** @param {any} sessionManager @param {string} transcriptPath */
    async #ensureCreatedSessionTranscriptFile(sessionManager, transcriptPath) {
        try {
            const stat = await Deno.stat(transcriptPath);
            if (stat.isFile) return;
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        if (typeof sessionManager?._rewriteFile !== "function") {
            throw new Error(`Created Session transcript was not persisted: ${transcriptPath}`);
        }
        sessionManager._rewriteFile();
        if ("flushed" in sessionManager) sessionManager.flushed = true;
        const stat = await Deno.stat(transcriptPath);
        if (!stat.isFile) throw new Error(`Created Session transcript was not persisted: ${transcriptPath}`);
    }

    /** @param {string} cwd @param {any} sessionManager */
    async #resolveCreatedSessionPath(cwd, sessionManager) {
        return await resolveCreatedRootSessionPath(cwd, sessionManager);
    }

    /**
     * @param {string} sessionId
     * @param {ManagedSyncOptions} [options]
     */
    async synchronizeManagedSession(sessionId, options = {}) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.synchronizeManagedSession: session not found");
        const initialManaged = hostedSession.getManagedMetadata?.() || null;
        if (!initialManaged) return { ok: true, managed: false, events: [] };
        let managed = initialManaged;
        if (hostedSession.getRootSessionManager()) return { ok: true, managed: true, dormant: false, events: [] };
        if (!this.#ownerCoordinationStore) throw new Error("Managed Session requires an owner coordination store");
        const emitEvents = options.emitEvents !== false;
        const emitSyncState = (
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */ state,
        ) => {
            hostedSession.setManagedMetadata({ ...managed, syncState: state });
            managed = hostedSession.getManagedMetadata?.() || managed;
            this.#emitSessionEvent(sessionId, state);
        };
        const sanitizedSurface = (/** @type {unknown} */ processKind) => {
            if (processKind === "workspace" || processKind === "tui" || processKind === "acp") return processKind;
            return "unknown";
        };
        try {
            this.#ownerCoordinationStore.requireActivationProtocolEnabled();
        } catch (_error) {
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */
            const state = {
                type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                status: "blocked",
                localGeneration: managed.acknowledgedGeneration ?? managed.generation ?? null,
                latestGeneration: managed.generation ?? null,
                message: "Managed activation protocol is not enabled.",
            };
            emitSyncState(state);
            return { ok: false, error: "protocol_disabled", state };
        }
        const activationState = this.#ownerCoordinationStore.inspectSessionActivation(managed.runwieldSessionId);
        const latestGeneration = activationState.generation?.generation ?? null;
        const currentLocalGeneration = managed.acknowledgedGeneration ?? managed.generation ?? null;
        const activeOwnerKind = activationState.activation?.ownerProcessKind || null;
        const activeOwnerInstanceId = activationState.activation?.ownerInstanceId || null;
        const activeElsewhere = Boolean(
            activationState.activation?.state === "active" && activeOwnerInstanceId &&
                activeOwnerInstanceId !== this.#ownerInstanceId,
        );
        const owningSurfaceKind = activeElsewhere ? sanitizedSurface(activeOwnerKind) : undefined;
        if (
            activationState.activation?.state === "uncertain" ||
            activationState.activation?.state === "reconcile_required"
        ) {
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */
            const state = {
                type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                status: "blocked",
                localGeneration: currentLocalGeneration,
                latestGeneration,
                message: activationState.activation.blockedReason || activationState.activation.state,
            };
            emitSyncState(state);
            return { ok: false, error: activationState.activation.state, state };
        }
        if (!activationState.generation) {
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */
            const state = {
                type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                status: activeElsewhere ? "active_elsewhere" : "current",
                localGeneration: currentLocalGeneration,
                latestGeneration,
                ...(owningSurfaceKind ? { owningSurfaceKind } : {}),
            };
            emitSyncState(state);
            return { ok: true, events: [], state };
        }
        if (
            !options.replayFromStart && latestGeneration === currentLocalGeneration &&
            (managed.acknowledgedEventId || latestGeneration === null)
        ) {
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */
            const state = {
                type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                status: activeElsewhere ? "active_elsewhere" : "current",
                localGeneration: currentLocalGeneration,
                latestGeneration,
                ...(owningSurfaceKind ? { owningSurfaceKind } : {}),
            };
            emitSyncState(state);
            return { ok: true, events: [], state };
        }
        emitSyncState(
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */ ({
                type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                status: "syncing",
                localGeneration: currentLocalGeneration,
                latestGeneration,
                ...(owningSurfaceKind ? { owningSurfaceKind } : {}),
            }),
        );
        try {
            /** @type {any[]} */
            const events = [];
            let projected;
            let cursorEventId = options.replayFromStart ? null : managed.acknowledgedEventId || null;
            let cursorEventOrdinal = options.replayFromStart
                ? null
                : Number.isInteger(managed.acknowledgedEventOrdinal)
                ? managed.acknowledgedEventOrdinal
                : null;
            do {
                projected = await projectAggregateTranscript({
                    cwd: hostedSession.cwd,
                    sessionDir: dirname(managed.transcriptPath),
                    runwieldSessionId: managed.runwieldSessionId,
                    runtimeSessionId: sessionId,
                    generation: activationState.generation,
                    segments: this.#ownerCoordinationStore.listSessionTranscriptSegments(managed.runwieldSessionId),
                    cursorEventId,
                    cursorEventOrdinal,
                    limit: options.limit,
                });
                if (!projected.ok) throw new Error(projected.message);
                events.push(...(projected.events || []));
                cursorEventId = projected.nextCursor || cursorEventId;
                cursorEventOrdinal = Number.isInteger(projected.nextCursorOrdinal)
                    ? projected.nextCursorOrdinal
                    : cursorEventOrdinal;
            } while (!projected.complete);
            const summary = /** @type {any} */ (projected.snapshot || {});
            /** @type {import('./hosted-session.js').ManagedSessionMetadata} */
            const nextMetadata = {
                ...managed,
                generation: projected.generation,
                acknowledgedGeneration: projected.generation,
                acknowledgedEventId: projected.nextCursor,
                acknowledgedEventOrdinal: projected.nextCursorOrdinal,
                committedSummary: summary,
                name: summary.name ?? managed.name ?? null,
                activeAgent: summary.activeAgent ?? managed.activeAgent ?? null,
                model: summary.model ?? managed.model ?? null,
                provider: summary.provider ?? managed.provider ?? null,
                thinkingLevel: summary.thinkingLevel ?? managed.thinkingLevel ?? null,
                workflowContext: summary.workflowContext ?? managed.workflowContext ?? null,
                syncState: {
                    type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                    status: activeElsewhere ? "active_elsewhere" : "current",
                    localGeneration: projected.generation,
                    latestGeneration,
                    ...(owningSurfaceKind ? { owningSurfaceKind } : {}),
                },
            };
            hostedSession.setManagedMetadata(nextMetadata);
            managed = hostedSession.getManagedMetadata?.() || nextMetadata;
            const projectedAttention = summary.attention || null;
            // Record the observation on every sync, including non-emitting ones, so
            // the adoption sync seeds the baseline and only genuinely new attention
            // records reach the notifier.
            const previousAttentionEventId = this.#observedAttentionEventIds.get(sessionId);
            this.#observedAttentionEventIds.set(sessionId, projectedAttention?.eventId ?? null);
            if (emitEvents) {
                for (const event of events) this.#emitSessionEvent(sessionId, /** @type {any} */ (event));
                if (summary.name) {
                    this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.SESSION_RENAMED, name: summary.name });
                }
                if (projectedAttention && shouldEmitProjectedAttention(summary, previousAttentionEventId)) {
                    this.#emitSessionEvent(sessionId, {
                        type: RuntimeEventTypes.ATTENTION_REQUESTED,
                        eventId: projectedAttention.eventId,
                        reason: projectedAttention.reason || "agentStopped",
                        agentName: projectedAttention.agentName || undefined,
                    });
                }
            }
            if (managed.syncState) this.#emitSessionEvent(sessionId, managed.syncState);
            return { ok: true, events, state: managed.syncState || null, snapshot: summary };
        } catch (error) {
            const failure = toProjectionFailure(error);
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */
            const state = {
                type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                status: "degraded",
                localGeneration: currentLocalGeneration,
                latestGeneration,
                message: failure.message,
            };
            emitSyncState(state);
            return { ok: false, error: failure.code, state };
        }
    }

    /**
     * Adopt a managed Session as a dormant Runtime shell. This path deliberately
     * does not open a writable Pi Session Manager.
     *
     * @param {{ session: import('../owner-coordination/sessions.js').CatalogedSession, generation?: number | null, acknowledgedEventId?: string | null, name?: string | null, activeAgent?: string | null, model?: string | null, provider?: string | null, thinkingLevel?: string | null, workflowContext?: import('./workflow-context-session.js').WorkflowContext | null }} options
     */
    adoptManagedSession(options) {
        const cataloged = options?.session;
        if (!cataloged) throw new Error("SessionRuntime.adoptManagedSession requires a cataloged Session");
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            cwd: cataloged.transcriptCwd,
            sessionManager: null,
            managed: {
                runwieldSessionId: cataloged.runwieldSessionId,
                projectId: cataloged.projectId,
                piSessionId: cataloged.piSessionId,
                transcriptPath: cataloged.transcriptPath,
                currentSegmentId:
                    this.#ownerCoordinationStore?.getCurrentSessionSegment(cataloged.runwieldSessionId)?.segmentId ||
                    "",
                generation: options.generation ?? null,
                acknowledgedGeneration: options.generation ?? null,
                acknowledgedEventId: options.acknowledgedEventId ?? null,
                name: options.name ?? null,
                activeAgent: options.activeAgent ?? null,
                model: options.model ?? null,
                provider: options.provider ?? null,
                thinkingLevel: options.thinkingLevel ?? null,
                workflowContext: options.workflowContext ?? null,
                syncState: {
                    type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                    status: "current",
                    localGeneration: options.generation ?? null,
                    latestGeneration: options.generation ?? null,
                },
            },
        });
        this.#attachRuntimeEventSink(hostedSession);
        this.#emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.SESSION_LOADED,
            cwd: hostedSession.cwd,
            _meta: { managed: true, runwieldSessionId: cataloged.runwieldSessionId },
        });
        return { sessionId: hostedSession.id, cwd: hostedSession.cwd, runwieldSessionId: cataloged.runwieldSessionId };
    }

    /**
     * Submit one user turn through the Runtime-owned authority path. Consumers
     * provide the user's raw editor text; Runtime decides whether the session is
     * managed, which generation fence applies, and how text should be normalized
     * before the active root receives it.
     *
     * @param {string} sessionId
     * @param {PromptSessionOptions} options
     * @returns {Promise<{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string, managed: boolean, submittedRequest: string, restoreDraft: boolean, historyText?: string }>}
     */
    async promptUserTurn(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptUserTurn: session not found");
        const managed = hostedSession.getManagedMetadata?.() || null;
        const isManaged = Boolean(managed);
        const submittedRequest = isManaged ? options.initialRequest : options.initialRequest.trim();
        const requestOptions = { ...options, initialRequest: submittedRequest };
        const buildResult = (
            /** @type {{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string }} */ result,
        ) => ({
            ...result,
            managed: isManaged,
            submittedRequest,
            restoreDraft: isManaged && Boolean(result.error),
            ...(result.ok && submittedRequest.trim() ? { historyText: submittedRequest.trim() } : {}),
        });

        if (!managed) return buildResult(await this.promptSession(sessionId, requestOptions));

        const expectedGenerationSource = managed.acknowledgedGeneration ?? managed.generation;
        const expectedGeneration = Number.isSafeInteger(expectedGenerationSource)
            ? /** @type {number} */ (expectedGenerationSource)
            : 0;
        return buildResult(
            await this.promptManagedSession(sessionId, {
                ...requestOptions,
                expectedGeneration,
            }),
        );
    }

    /**
     * @param {string} sessionId
     * @param {import('./managed-operation.ts').ManagedOperationDescriptor} descriptor
     * @param {(context: { acceptedTurnId: string, hasPendingImages: boolean, capability: import('./managed-operation.ts').ManagedOperationCapability }) => Promise<any>} body
     * @returns {Promise<any>}
     */
    async #runManagedOperation(sessionId, descriptor, body) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.runManagedOperation: session not found");
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) throw new Error("SessionRuntime.runManagedOperation: Session is not managed");
        if (this.#currentManagedOperations.has(sessionId)) {
            return {
                ok: false,
                turns: 0,
                handoffs: 0,
                handoffLimitReached: false,
                error: "managed_operation_in_progress",
            };
        }
        if (!this.#ownerCoordinationStore) throw new Error("Managed Session requires an owner coordination store");
        this.#ownerCoordinationStore.requireActivationProtocolEnabled();
        const state = this.#ownerCoordinationStore.inspectSessionActivation(managed.runwieldSessionId);
        const latestGeneration = state.generation?.generation ?? null;
        const options = descriptor.options || {};
        const expectedGeneration = options.expectedGeneration ?? managed.generation ?? latestGeneration ?? 0;
        if (latestGeneration !== expectedGeneration) {
            return { ok: false, turns: 0, handoffs: 0, handoffLimitReached: false, error: "refresh_required" };
        }
        /** @type {import('../owner-coordination/session-activations.js').ActivationProof} */
        let activeProof;
        try {
            activeProof = this.#ownerCoordinationStore.acquireSessionActivation({
                runwieldSessionId: managed.runwieldSessionId,
                projectId: managed.projectId,
                ownerInstanceId: this.#ownerInstanceId,
                ownerProcessKind: this.#ownerProcessKind,
                expectedGeneration,
                expectedCurrentSegmentId: managed.currentSegmentId ?? state.activation?.currentSegmentId ?? null,
                phase: "preparing",
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("current segment expectation")) {
                return {
                    ok: false,
                    turns: 0,
                    handoffs: 0,
                    handoffLimitReached: false,
                    error: "refresh_required",
                };
            }
            if (message.includes("Session activation is not available") || message.includes("activation race lost")) {
                return {
                    ok: false,
                    turns: 0,
                    handoffs: 0,
                    handoffLimitReached: false,
                    error: "managed_operation_in_progress",
                };
            }
            throw error;
        }
        const capability = new ManagedOperationCapability({
            runtimeSessionId: sessionId,
            runwieldSessionId: managed.runwieldSessionId,
            operationId: activeProof.operationId,
            proof: activeProof,
        });
        this.#currentManagedOperations.set(sessionId, capability);
        /** @type {() => void} */
        let settleManagedOperation = () => {};
        this.#currentManagedOperationSettlements.set(
            sessionId,
            new Promise((resolve) => {
                settleManagedOperation = () => resolve(undefined);
            }),
        );
        hostedSession.setManagedOperationCapability(capability);
        let hydrated = false;
        /** @type {ReturnType<typeof setInterval> | null} */
        let heartbeatTimer = null;
        this.#beginBusyOperation(sessionId);
        const ownerCoordinationStore = this.#ownerCoordinationStore;
        const heartbeat = () => {
            try {
                ownerCoordinationStore.heartbeatSessionActivation(activeProof);
            } catch (error) {
                capability.latchHeartbeatFailure(error instanceof Error ? error : String(error));
            }
        };
        try {
            const pendingIntent = hostedSession.getPendingManagedTurnIntent?.() || {};
            if (state.generation) {
                const generationSegment = this.#ownerCoordinationStore.listSessionTranscriptSegments(
                    managed.runwieldSessionId,
                )
                    .find((segment) => segment.segmentId === state.generation?.currentSegmentId);
                if (!generationSegment) throw new Error("Committed generation current segment is absent from manifest");
                const currentEvidence = await captureTranscriptEvidence({
                    transcriptPath: generationSegment.transcriptPath,
                    transcriptCwd: generationSegment.transcriptCwd,
                    byteLength: state.generation.byteLength,
                });
                const stat = await Deno.stat(generationSegment.transcriptPath);
                if (
                    stat.size !== state.generation.byteLength ||
                    currentEvidence.digestHex !== state.generation.digestHex ||
                    currentEvidence.terminalEntryId !== state.generation.terminalEntryId
                ) {
                    this.#ownerCoordinationStore.markSessionReconcileRequiredWithProof(activeProof, {
                        reason: "transcript_ahead_or_mismatch",
                    });
                    return {
                        ok: false,
                        turns: 0,
                        handoffs: 0,
                        handoffLimitReached: false,
                        error: "reconcile_required",
                    };
                }
            }
            heartbeatTimer = setInterval(heartbeat, 10_000);
            const acceptedTurnId = options.turnId || crypto.randomUUID();
            const hasPendingImages = (options.initialImages || []).some((image) => !image.path && !image.ref);
            if (descriptor.hydrate === false) {
                const result = await body({ acceptedTurnId, hasPendingImages, capability });
                if (capability.heartbeatFailureReason) {
                    try {
                        this.#ownerCoordinationStore.markSessionUncertain(activeProof, {
                            reason: capability.heartbeatFailureReason,
                        });
                    } catch {
                        // Heartbeat expiry already moved the activation out of active state.
                    }
                    return {
                        ok: false,
                        turns: 0,
                        handoffs: 0,
                        handoffLimitReached: false,
                        error: "reconcile_required",
                    };
                }
                this.#ownerCoordinationStore.releaseUnchangedActivation(activeProof);
                return result;
            }
            const shouldEmitPromptEvents = options.initialRequest !== undefined &&
                descriptor.emitPromptEvents !== false;
            if (shouldEmitPromptEvents && !hasPendingImages) {
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.USER_MESSAGE,
                    turnId: acceptedTurnId,
                    text: options.initialRequest,
                    images: (options.initialImages || []).map((image) => ({ ...image })),
                });
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.TURN_START,
                    turnId: acceptedTurnId,
                });
            }
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "hydrated");
            capability.updateProof(activeProof);
            hydrated = true;
            const { sessionManager } = await openPersistedRootSession({
                cwd: hostedSession.cwd,
                sessionId: managed.piSessionId,
                sessionPath: managed.transcriptPath,
            });
            hostedSession.setRootSessionManager(/** @type {any} */ (sessionManager), capability);
            if (pendingIntent.model || pendingIntent.provider) {
                hostedSession.setActiveModelState(pendingIntent.model || "", pendingIntent.provider || "", true);
            }
            if (pendingIntent.thinkingLevel) hostedSession.setThinkingLevel(pendingIntent.thinkingLevel);
            let agentName = options.agentName || pendingIntent.agentName || null;
            if (descriptor.activateAgent !== false) {
                agentName ||= await resolveResumeAgentName(sessionManager);
                const pendingModel = pendingIntent.model || pendingIntent.provider
                    ? pendingIntent.provider && pendingIntent.model
                        ? `${pendingIntent.provider}/${pendingIntent.model}`
                        : pendingIntent.model || undefined
                    : undefined;
                await this.#activateSessionAgent(hostedSession, {
                    agentName,
                    model: pendingModel,
                    toolNames: options.toolNames,
                    customTools: options.customTools,
                    allowReturnToRouter: options.allowReturnToRouter,
                    includeEditFallback: options.includeEditFallback,
                    managedOperationCapability: capability,
                });
            }
            hostedSession.consumePendingManagedTurnIntent?.();
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "turning");
            capability.updateProof(activeProof);
            const result = await body({ acceptedTurnId, hasPendingImages, capability });
            if (capability.heartbeatFailureReason) {
                try {
                    this.#ownerCoordinationStore.markSessionUncertain(activeProof, {
                        reason: capability.heartbeatFailureReason,
                    });
                } catch {
                    // Heartbeat expiry already moved the activation out of active state.
                }
                hostedSession.dehydrateManagedSession();
                this.#removeAllQueueSourceSubscriptions(sessionId);
                return { ok: false, turns: 0, handoffs: 0, handoffLimitReached: false, error: "reconcile_required" };
            }
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "checkpointing");
            capability.updateProof(activeProof);
            const modelState = hostedSession.getActiveModelState?.() || {};
            const nextManaged = {
                ...managed,
                generation: expectedGeneration + 1,
                acknowledgedGeneration: expectedGeneration + 1,
                activeAgent: hostedSession.getRootAgentName?.() || null,
                model: modelState.model || managed.model || "",
                provider: modelState.provider || managed.provider || "",
                thinkingLevel: hostedSession.getThinkingLevel?.() || managed.thinkingLevel || "off",
                workflowContext: hostedSession.getWorkflowContext?.() || managed.workflowContext || null,
            };
            hostedSession.dehydrateManagedSession();
            this.#removeAllQueueSourceSubscriptions(sessionId);
            await syncTranscriptFileAndParent(managed.transcriptPath);
            const evidence = await captureTranscriptEvidence({
                transcriptPath: managed.transcriptPath,
                transcriptCwd: hostedSession.cwd,
            });
            this.#ownerCoordinationStore.publishGenerationAndRelease(activeProof, {
                generation: expectedGeneration + 1,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
                currentSegmentId: managed.currentSegmentId,
            });
            hostedSession.setManagedMetadata(nextManaged);
            await this.synchronizeManagedSession(sessionId, { emitEvents: false });
            return result;
        } catch (error) {
            hostedSession.dehydrateManagedSession();
            this.#removeAllQueueSourceSubscriptions(sessionId);
            if (!hydrated) {
                try {
                    this.#ownerCoordinationStore.releaseUnchangedActivation(activeProof);
                } catch {
                    this.#ownerCoordinationStore.markSessionUncertain(activeProof, {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            } else {
                this.#ownerCoordinationStore.markSessionUncertain(activeProof, {
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
            throw error;
        } finally {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            capability.settle();
            this.#currentManagedOperations.delete(sessionId);
            this.#currentManagedOperationSettlements.delete(sessionId);
            settleManagedOperation();
            hostedSession.setManagedOperationCapability(null);
            this.#endBusyOperation(sessionId);
        }
    }

    /**
     * @param {string} sessionId
     * @param {PromptSessionOptions & { expectedGeneration: number }} options
     */
    async promptManagedSession(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptManagedSession: session not found");
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) return await this.promptSession(sessionId, options);
        const result = await this.#runManagedOperation(
            sessionId,
            { name: "prompt", options },
            async ({ acceptedTurnId, hasPendingImages, capability }) =>
                await this.promptSession(sessionId, {
                    ...options,
                    turnId: acceptedTurnId,
                    emitInitialEvents: hasPendingImages,
                    suppressEpicContinuation: true,
                    signal: capability.signal,
                }),
        );
        if (result?.ok && /** @type {any} */ (result)._validationResult?.epicContinuation) {
            const replacement = await this.#continueEpicAfterValidation(
                hostedSession,
                /** @type {any} */ (result)._validationResult,
            );
            if (replacement.sessionId) result.replacementSessionId = replacement.sessionId;
        }
        delete (/** @type {any} */ (result))._validationResult;
        return result;
    }

    /**
     * @param {string} sessionId
     * @param {{ kind: 'execution' | 'semantic_repair', continuation: import('./segment-rollover.ts').SegmentRolloverResult['continuation'], expectedGeneration?: number | null, lineageGroupKey?: string | null }} options
     */
    async rollManagedSessionSegment(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.rollManagedSessionSegment: session not found");
        if (!this.#ownerCoordinationStore) throw new Error("Managed Session requires an owner coordination store");
        return await rollSessionTranscriptSegment({
            hostedSession,
            ownerCoordinationStore: this.#ownerCoordinationStore,
            ownerInstanceId: this.#ownerInstanceId,
            ownerProcessKind: this.#ownerProcessKind,
            kind: options.kind,
            continuation: options.continuation,
            expectedGeneration: options.expectedGeneration,
            lineageGroupKey: options.lineageGroupKey,
        });
    }

    /**
     * Create the persistence and internal session state used by an interactive
     * consumer. Only the opaque runtime id and public metadata cross the core
     * boundary.
     *
     * @param {{ cwd: string, mode?: "new" | "continue", enableManagedActivation?: boolean, deferManagedActivationUntilAgentReady?: boolean }} options
     */
    async createInteractiveSession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.createInteractiveSession requires an absolute cwd");
        }
        const ownerCoordinationStore = this.#ownerCoordinationStore;
        if (!ownerCoordinationStore) {
            throw new Error("Session Manager access is blocked: owner_coordination_unavailable");
        }
        if ((options.mode || "new") === "continue") {
            const classified = await classifyRootSessionLocator({
                cwd: options.cwd,
                ownerCoordinationStore,
            });
            if (classified.kind === "blocked") {
                throw new Error(`Managed Session continue is blocked: ${classified.reason}`);
            }
            const persistedSessions = classified.kind === "managed"
                ? (await listCatalogSafeRootSessionLocators(options.cwd)).locators.map((locator) => ({
                    id: locator.piSessionId,
                    path: locator.sessionPath,
                    cwd: locator.headerCwd,
                    modified: locator.headerTimestamp || undefined,
                }))
                : await listPersistedRootSessions(options.cwd);
            const latestSession = persistedSessions[0] || null;
            if (latestSession?.id && latestSession?.path) {
                const loaded = await this.loadSession({
                    cwd: options.cwd,
                    sessionId: latestSession.id,
                    sessionPath: latestSession.path,
                    enableManagedActivation: classified.kind === "managed",
                });
                return {
                    sessionId: loaded.sessionId,
                    cwd: loaded.cwd,
                    sessionManagerId: loaded.sessionManagerId,
                    startedAt: new Date().toISOString(),
                };
            }
        }
        const requestedManagedNew = this.#shouldUseManagedActivation(options) && (options.mode || "new") === "new";
        const creationClassification = await classifyRootSessionLocator({
            cwd: options.cwd,
            ownerCoordinationStore,
        });
        if (creationClassification.kind === "blocked") {
            throw new Error(`Session Manager create is blocked: ${creationClassification.reason}`);
        }
        if (creationClassification.kind === "managed" && !requestedManagedNew) {
            throw new Error("Session Manager create is blocked: managed_activation_required");
        }
        if (creationClassification.kind === "unmanaged_proven" && requestedManagedNew) {
            throw new Error("Session Manager create is blocked: managed_project_unavailable");
        }
        const managedProject = requestedManagedNew && creationClassification.kind === "managed"
            ? this.#findEnabledManagedProjectForCwd(options.cwd)
            : null;
        if (requestedManagedNew && creationClassification.kind === "managed" && !managedProject) {
            throw new Error("Session Manager create is blocked: managed_project_unavailable");
        }
        if (managedProject) ownerCoordinationStore.requireActivationProtocolEnabled();
        const deferManagedCreation = Boolean(
            managedProject && ownerCoordinationStore && options.deferManagedActivationUntilAgentReady,
        );
        const sessionManager = deferManagedCreation
            ? null
            : await createRootSessionManager(options.mode || "new", options.cwd);
        let managedSession = null;
        let managedCurrentSegmentId = "";
        let managedProof = null;
        if (managedProject && ownerCoordinationStore && !deferManagedCreation) {
            try {
                const piSessionId = sessionManager?.getSessionId?.();
                if (!piSessionId) throw new Error("Created managed Session has no Pi session id");
                const transcriptPath = await this.#resolveCreatedSessionPath(options.cwd, sessionManager);
                managedSession = await ownerCoordinationStore.ensureSessionCatalogRecord({
                    projectId: managedProject.projectId,
                    piSessionId,
                    transcriptPath,
                    transcriptCwd: options.cwd,
                    source: "created",
                });
                const managedSegment = ownerCoordinationStore.getCurrentSessionSegment(
                    managedSession.runwieldSessionId,
                );
                if (!managedSegment) throw new Error("Created managed Session has no current segment");
                managedCurrentSegmentId = managedSegment.segmentId;
                managedProof = ownerCoordinationStore.acquireSessionActivation({
                    runwieldSessionId: managedSession.runwieldSessionId,
                    projectId: managedSession.projectId,
                    ownerInstanceId: this.#ownerInstanceId,
                    ownerProcessKind: this.#ownerProcessKind,
                    expectedGeneration: null,
                    phase: "preparing",
                });
            } catch (error) {
                /** @type {any} */ (sessionManager)?.dispose?.();
                throw error;
            }
        }
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            sessionManager: /** @type {any} */ (sessionManager),
            cwd: options.cwd,
            managed: managedSession
                ? {
                    runwieldSessionId: managedSession.runwieldSessionId,
                    projectId: managedSession.projectId,
                    piSessionId: managedSession.piSessionId,
                    transcriptPath: managedSession.transcriptPath,
                    currentSegmentId: managedCurrentSegmentId,
                    generation: null,
                    acknowledgedGeneration: null,
                    acknowledgedEventId: null,
                    name: managedSession.displayName,
                    activeAgent: null,
                    workflowContext: null,
                    syncState: {
                        type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                        status: "syncing",
                        localGeneration: null,
                        latestGeneration: null,
                    },
                }
                : null,
        });
        if (managedProof) this.#pendingManagedCreations.set(hostedSession.id, managedProof);
        if (deferManagedCreation && managedProject) {
            this.#pendingManagedCreationProjects.set(
                hostedSession.id,
                /** @type {{ projectId: string }} */ (managedProject),
            );
        }
        this.#attachRuntimeEventSink(hostedSession);
        this.#emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.SESSION_CREATED,
            cwd: hostedSession.cwd,
        });
        return {
            sessionId: hostedSession.id,
            cwd: hostedSession.cwd,
            sessionManagerId: sessionManager?.getSessionId?.() || hostedSession.id,
            startedAt: sessionManager?.getHeader?.()?.timestamp || new Date().toISOString(),
        };
    }

    /**
     * @param {PromptReadySessionOptions} options
     * @returns {Promise<string>}
     */
    async createPromptReadySession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.createPromptReadySession requires an absolute cwd");
        }
        const agentName = options.agentName || AGENTS.ROUTER;
        const created = await this.createInteractiveSession({ cwd: options.cwd, mode: "new" });
        const hostedSession = this.#sessionHost.getSession(created.sessionId);
        if (!hostedSession) throw new Error("SessionRuntime failed to retain the new session");
        try {
            await this.#activateSessionAgent(hostedSession, {
                agentName,
            });
            return hostedSession.id;
        } catch (error) {
            await this.closeSession(hostedSession.id);
            throw error;
        }
    }

    /**
     * @param {LoadSessionOptions} options
     * @returns {Promise<{ sessionId: string, cwd: string, replayEvents: import('./session-runtime-events.js').SessionRuntimeEvent[], sessionManagerId: string, sessionPath: string }>}
     */
    async loadSession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.loadSession requires an absolute cwd");
        }
        if (!options.sessionId || typeof options.sessionId !== "string") {
            throw new Error("SessionRuntime.loadSession requires a session id");
        }
        const ownerCoordinationStore = this.#ownerCoordinationStore;
        if (!ownerCoordinationStore) {
            throw new Error("Session Manager load is blocked: owner_coordination_unavailable");
        }
        const classified = await classifyRootSessionLocator({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath: options.sessionPath,
            ownerCoordinationStore,
        });
        if (classified.kind === "blocked") {
            throw new Error(`Session Manager load is blocked: ${classified.reason}`);
        }
        if (classified.kind === "managed") {
            if (!this.#shouldUseManagedActivation(options)) {
                throw new Error("Session Manager load is blocked: managed_activation_required");
            }
            if (classified.session) {
                const managedSession = classified.session;
                ownerCoordinationStore.requireActivationProtocolEnabled();
                const inspected = ownerCoordinationStore.inspectSessionActivation(
                    managedSession.runwieldSessionId,
                );
                if (!inspected.generation) throw new Error("Managed Session requires bootstrap before load.");
                const adopted = this.adoptManagedSession({
                    session: managedSession,
                    generation: inspected.generation.generation,
                });
                const sync = await this.synchronizeManagedSession(adopted.sessionId, { emitEvents: false });
                return {
                    sessionId: adopted.sessionId,
                    cwd: adopted.cwd,
                    replayEvents: sync.ok
                        ? (sync.events || []).map((event) =>
                            createSessionRuntimeEvent(adopted.sessionId, /** @type {any} */ (event))
                        )
                        : [],
                    sessionManagerId: managedSession.runwieldSessionId,
                    sessionPath: managedSession.transcriptPath,
                };
            }
        }
        const { sessionManager, resolved } = await openPersistedRootSession({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath: options.sessionPath,
        });
        const agentName = await resolveResumeAgentName(sessionManager);
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            sessionManager: /** @type {any} */ (sessionManager),
            cwd: options.cwd,
        });
        this.#attachRuntimeEventSink(hostedSession);
        try {
            await this.#activateSessionAgent(hostedSession, {
                agentName,
                model: options.modelOverride,
            });
            const replayEvents = createProjectedReplayEvents(
                hostedSession.id,
                getRootSessionBranchEntries(sessionManager),
            )
                .map((event) => createSessionRuntimeEvent(hostedSession.id, /** @type {any} */ (event)));
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.SESSION_LOADED,
                cwd: hostedSession.cwd,
                _meta: { sessionManagerId: resolved.sessionId, sessionPath: resolved.sessionPath },
            });
            return {
                sessionId: hostedSession.id,
                cwd: hostedSession.cwd,
                replayEvents,
                sessionManagerId: resolved.sessionId,
                sessionPath: resolved.sessionPath,
            };
        } catch (error) {
            await this.closeSession(hostedSession.id);
            throw error;
        }
    }

    /**
     * @param {string} sessionId
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionAdapter | null} adapter
     */
    setInteractionAdapter(sessionId, adapter) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setInteractionAdapter(adapter);
        return { ok: true };
    }

    /**
     * @param {string} sessionId
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionRequest} request
     * @param {AbortSignal} [signal]
     */
    async requestInteraction(sessionId, request, signal) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { outcome: "unsupported", message: "Session not found." };
        return await requestHostedSessionInteraction(session, request, signal, null);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} oldSession
     * @param {import('../workflow/validation.ts').WorkflowValidationResult | undefined | null} validationResult
     * @returns {Promise<{ replaced: boolean, sessionId?: string }>}
     */
    async #continueEpicAfterValidation(oldSession, validationResult) {
        let currentContinuation = validationResult?.epicContinuation || null;
        if (!currentContinuation) return { replaced: false };
        let currentOldSession = oldSession;
        /** @type {string | undefined} */
        let latestSessionId;
        while (currentContinuation) {
            const { resolveEpicContinuation, runEpicChildContinuation } = await import(
                "../workflow/epic-continuation.ts"
            );
            const resolution = await resolveEpicContinuation({
                cwd: currentContinuation.projectRoot,
                completedPlanName: currentContinuation.completedPlanName,
            });
            if (
                !["plan", "readiness_execute", "execute"].includes(resolution.kind) || !resolution.childPlanName ||
                !resolution.parentPlanName
            ) {
                const message = resolution.kind === "blocked"
                    ? `Epic continuation stopped at ${resolution.childPlanName || "next child"}: ${
                        resolution.reason || "blocked"
                    }.`
                    : `Epic continuation complete: ${resolution.reason || "no remaining work"}.`;
                emitSystemStatus(currentOldSession, message, {
                    level: resolution.kind === "blocked" ? "warning" : "success",
                    header: "RunWield",
                });
                return { replaced: Boolean(latestSessionId), sessionId: latestSessionId };
            }
            const action = /** @type {"plan"|"readiness_execute"|"execute"} */ (resolution.kind);

            const adapter = currentOldSession.getInteractionAdapter();
            const sourceManaged = currentOldSession.getManagedMetadata?.() || null;
            /** @type {string} */
            let newSessionId;
            /** @type {import('./hosted-session.js').HostedSession | null | undefined} */
            let newSession;
            /** @type {any} */
            let nextResult;
            if (!sourceManaged) {
                newSessionId = await this.createPromptReadySession({
                    cwd: currentContinuation.projectRoot,
                    agentName: action === "plan" ? AGENTS.PLANNER : AGENTS.ENGINEER,
                });
                newSession = this.#sessionHost.getSession(newSessionId);
                if (!newSession) throw new Error("Epic continuation replacement session was not retained");
                newSession.setInteractionAdapter(adapter);
                await this.renameSession(newSessionId, `Epic child: ${resolution.childPlanName}`);
                this.#emitSessionEvent(currentOldSession.id, {
                    type: RuntimeEventTypes.SESSION_REPLACED,
                    oldSessionId: currentOldSession.id,
                    newSessionId,
                    reason: "epic_continuation",
                    parentPlanName: resolution.parentPlanName,
                    completedPlanName: resolution.completedPlanName,
                    childPlanName: resolution.childPlanName,
                    action,
                });
                await this.closeSession(currentOldSession.id);
                latestSessionId = newSessionId;
                nextResult = await this.#runBusyOperation(newSessionId, () =>
                    runEpicChildContinuation({
                        hostedSession: /** @type {import('./hosted-session.js').HostedSession} */ (newSession),
                        resolution,
                        sessionManager: /** @type {any} */ (newSession?.getRootSessionManager() || undefined),
                    }));
            } else {
                const created = await this.createInteractiveSession({
                    cwd: currentContinuation.projectRoot,
                    mode: "new",
                    enableManagedActivation: true,
                    deferManagedActivationUntilAgentReady: true,
                });
                newSessionId = created.sessionId;
                newSession = this.#sessionHost.getSession(newSessionId);
                if (!newSession) throw new Error("Epic continuation replacement session was not retained");
                newSession.setInteractionAdapter(adapter);
                await this.#activateSessionAgent(newSession, {
                    agentName: action === "plan" ? AGENTS.PLANNER : AGENTS.ENGINEER,
                });
                await this.renameSession(newSessionId, `Epic child: ${resolution.childPlanName}`);
                this.#emitSessionEvent(currentOldSession.id, {
                    type: RuntimeEventTypes.SESSION_REPLACED,
                    oldSessionId: currentOldSession.id,
                    newSessionId,
                    reason: "epic_continuation",
                    parentPlanName: resolution.parentPlanName,
                    completedPlanName: resolution.completedPlanName,
                    childPlanName: resolution.childPlanName,
                    action,
                });
                await this.closeSession(currentOldSession.id);
                latestSessionId = newSessionId;
                const nextManaged = newSession.getManagedMetadata?.();
                if (!nextManaged) throw new Error("Epic continuation destination is not managed");
                nextResult = await this.#runManagedOperation(
                    newSessionId,
                    {
                        name: "workflow_operation",
                        options: { expectedGeneration: nextManaged.generation ?? undefined },
                        activateAgent: true,
                    },
                    async () =>
                        await runEpicChildContinuation({
                            hostedSession: /** @type {import('./hosted-session.js').HostedSession} */ (newSession),
                            resolution,
                            sessionManager: /** @type {any} */ (newSession?.getRootSessionManager() || undefined),
                        }),
                );
            }
            currentContinuation = nextResult?.epicContinuation || null;
            currentOldSession = newSession;
        }
        return { replaced: Boolean(latestSessionId), sessionId: latestSessionId };
    }

    /**
     * @param {string} sessionId
     * @param {{ agentName: string, model?: string, allowReturnToRouter?: boolean }} options
     */
    async switchAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        if (session.isTurnActive()) throw new SessionTurnInProgressError(session.id);
        if (this.#pendingManagedCreations.has(sessionId) || this.#pendingManagedCreationProjects.has(sessionId)) {
            if (this.#currentManagedOperations.has(sessionId)) {
                return { ok: false, error: "managed_operation_in_progress" };
            }
            return await this.#activateSessionAgent(session, options);
        }
        return await this.#runManagedStandaloneMutation(
            sessionId,
            "switch_agent",
            async (activeSession, capability) => {
                return await this.#activateSessionAgent(activeSession, {
                    ...options,
                    managedOperationCapability: capability,
                });
            },
            { activateAgent: false },
        );
    }

    /** @param {string} sessionId */
    cancelSession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, aborted: false, error: "not_found" };
        const currentOperation = this.#currentManagedOperations.get(session.id) || null;
        if (currentOperation) {
            let aborted = false;
            try {
                currentOperation.cancel?.();
                aborted = true;
                session.suppressNextAgentStoppedAttention();
            } finally {
                this.#emitSessionEvent(session.id, {
                    type: RuntimeEventTypes.CANCELLATION,
                    aborted,
                    reason: "session_cancel",
                    ...(aborted ? { scope: "operation", message: "Operation cancellation requested." } : {}),
                });
            }
            return { ok: true, aborted };
        }
        if (session.getManagedMetadata?.()) {
            this.#emitSessionEvent(session.id, {
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
            const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
            if (rootAgentSession?.isCompacting && rootAgentSession?.abortCompaction) {
                rootAgentSession.abortCompaction();
                operationCanceled = true;
            }
            this.#clearQueuedMessages(session, "session_cancel");
            agentCanceled = abortActiveSessionFn(session);
            if (agentCanceled || turnActive) session.suppressNextAgentStoppedAttention();
            aborted = operationCanceled || agentCanceled;
        } finally {
            this.#emitSessionEvent(session.id, {
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

    /**
     * @param {string} sessionId
     * @param {PromptSessionOptions} options
     * @returns {Promise<{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string }>}
     */
    async promptSession(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptSession: session not found");
        const turnId = options.turnId || crypto.randomUUID();
        const emitInitialEvents = options.emitInitialEvents !== false;
        await this.#alignActiveExecutionWorkflowOwner(hostedSession);
        if (!hostedSession.beginTurn(turnId)) throw new SessionTurnInProgressError(hostedSession.id);
        /** @type {() => void} */
        let cleanupTurn = () => {};
        /** @type {() => void} */
        let settleTurn = () => {};
        const turnSettlement = new Promise((resolve) => {
            settleTurn = () => resolve(undefined);
        });
        this.#turnSettlements.set(hostedSession.id, turnSettlement);
        let request = options.initialRequest;
        let images = options.initialImages || [];
        let turns = 0;
        let handoffs = 0;
        let ok = false;
        let busyStarted = false;
        /** @type {import('../workflow/validation.ts').WorkflowValidationResult | null} */
        let validationResult = null;
        const managedCapability = /** @type {import('./managed-operation.ts').ManagedOperationCapability | null} */ (
            hostedSession.getManagedOperationCapability?.() || null
        );
        let result =
            /** @type {{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string, replacementSessionId?: string } | null} */ (null);

        try {
            const cleanup = options.onTurnStarted?.({ turnId });
            if (typeof cleanup === "function") cleanupTurn = cleanup;
            images = await this.#persistPendingPromptImages(hostedSession, images);
            if (emitInitialEvents) {
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.USER_MESSAGE,
                    turnId,
                    text: request,
                    images: images.map((image) => ({ ...image })),
                });
                this.#emitSessionEvent(hostedSession.id, { type: RuntimeEventTypes.TURN_START, turnId });
            }
            this.#beginBusyOperation(hostedSession.id, turnId);
            busyStarted = true;

            if (!hostedSession.getActiveOnMessage() || !hostedSession.getRootSessionManager()) {
                const message = "Error: No active agent handler or session manager.";
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    turnId,
                    level: "error",
                    message,
                });
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.TERMINAL_ERROR,
                    turnId,
                    message,
                    error: "missing_active_handler_or_session_manager",
                });
                result = {
                    ok: false,
                    turns,
                    handoffs,
                    handoffLimitReached: false,
                    error: "missing_active_handler_or_session_manager",
                };
                return result;
            }

            for (let turn = 0; turn <= MAX_CHAINED_HANDOFFS; turn++) {
                const handler = hostedSession.getActiveOnMessage();
                if (!handler) {
                    const message = "Error: No active agent handler or session manager.";
                    this.#emitSessionEvent(hostedSession.id, {
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        turnId,
                        level: "error",
                        message,
                    });
                    result = {
                        ok: false,
                        turns,
                        handoffs,
                        handoffLimitReached: false,
                        error: "missing_active_handler_or_session_manager",
                    };
                    return result;
                }

                const turnResult = await handler(
                    request,
                    images,
                    hostedSession.getRootSessionManager() || undefined,
                    options.signal || managedCapability?.signal,
                );
                turns++;

                if (!turnResult || turnResult.kind !== "handoff") {
                    validationResult = /** @type {any} */ (turnResult)?.validationResult || null;
                    ok = true;
                    result = { ok: true, turns, handoffs, handoffLimitReached: false };
                    return result;
                }

                if (turn === MAX_CHAINED_HANDOFFS) {
                    this.#emitSessionEvent(hostedSession.id, {
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        turnId,
                        level: "warning",
                        message: HANDOFF_LIMIT_MESSAGE,
                    });
                    ok = true;
                    result = { ok: true, turns, handoffs, handoffLimitReached: true };
                    return result;
                }

                handoffs++;
                await this.#activateSessionAgent(hostedSession, {
                    agentName: turnResult.agentName,
                    model: turnResult.model,
                    managedOperationCapability: managedCapability || undefined,
                });
                request = turnResult.userRequest;
                images = [];
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.USER_MESSAGE,
                    turnId,
                    text: request,
                    images,
                });
            }

            ok = true;
            result = { ok: true, turns, handoffs, handoffLimitReached: false };
            return result;
        } catch (error) {
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.TERMINAL_ERROR,
                turnId,
                message: getRuntimeErrorMessage(error),
                error,
            });
            throw error;
        } finally {
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.TURN_END,
                turnId,
                ok,
                result: result || { turns, handoffs },
            });
            hostedSession.endTurn(turnId);
            if (busyStarted) this.#endBusyOperation(hostedSession.id, turnId);
            try {
                cleanupTurn();
            } catch {
                // Adapter cleanup must not prevent runtime turn settlement.
            }
            settleTurn();
            if (this.#turnSettlements.get(hostedSession.id) === turnSettlement) {
                this.#turnSettlements.delete(hostedSession.id);
            }
            if (validationResult && result) {
                /** @type {any} */ (result)._validationResult = validationResult;
            }
            if (!options.suppressEpicContinuation && ok && validationResult?.epicContinuation && result) {
                const replacement = await this.#continueEpicAfterValidation(hostedSession, validationResult);
                if (replacement.sessionId) result.replacementSessionId = replacement.sessionId;
            }
        }
    }
}

/**
 * Compose a SessionRuntime with RunWield's real in-process session machinery.
 * Callers select only whether managed owner coordination is available.
 *
 * @param {CreateSessionRuntimeOptions} [options]
 * @returns {SessionRuntime}
 */
export function createSessionRuntime(options = {}) {
    return new SessionRuntime({
        sessionHost: new SessionHost(),
        ownerCoordinationStore: options.ownerCoordinationStore ?? openOwnerCoordinationStore(),
        ownerProcessKind: options.ownerProcessKind ?? "test",
        ownerInstanceId: options.ownerInstanceId ?? crypto.randomUUID(),
    });
}
