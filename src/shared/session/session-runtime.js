/**
 * @module shared/session/session-runtime
 * Prompt loop boundary for HostedSession-based interactive turns.
 */

import { AGENTS, SUBAGENTS } from "../../constants.js";
import {
    readPersistedManualModelState,
    readPersistedModelState,
    recordManualModelSelection,
    resolveResumeAgentName,
} from "./active-agent-session.js";
import { resolveActiveWorkflowRuntimeAgent, resolvePlanExecutionRuntimeAgent } from "../workflow/execution-agent.ts";
import { getAgentDisplayName } from "./agents.js";
import { runActiveAgentTurn, switchActiveAgent } from "./agent-switching.js";
import {
    abortActiveSession as abortActiveSessionFn,
    expandPromptTemplate,
    expandSkillCommand,
    getConfiguredAgentModel,
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
import { buildActiveConversationSubmissionMessage } from "./session-user-messages.ts";
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
import { parseProviderModel } from "../models/model-validation.ts";
import { spawnForegroundShell } from "../foreground-process.ts";
import { openFileSessionStore } from "./file-session-store.ts";
import { FileSessionStoreOwner } from "./file-session-store-owner.ts";
import { listRecentResumableSessions } from "./session-resume-list.ts";
import { buildSessionContextReport } from "./session-context-report.js";
import { getSettingsManager, setGlobalCompactionSetting } from "../settings.js";
import { getSessionKeyboardHelp } from "./session-help.js";
import {
    deriveWorkflowContextFromExecutionWorkflow,
    readPersistedPendingSegmentContinuationEntry,
    readPersistedWorkflowContext,
    recordSegmentLineageEvidence,
} from "./workflow-context-session.js";
import { executePlanAction } from "../workflow/plan-actions.ts";
import { dirname, isAbsolute } from "@std/path";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * @typedef {Object} ManagedOperationContext
 * @property {SessionRuntime} runtime
 * @property {string} sessionId
 * @property {import('./managed-operation.ts').ManagedOperationCapability} capability
 */

/** @type {AsyncLocalStorage<ManagedOperationContext>} */
const ACTIVE_MANAGED_OPERATION = new AsyncLocalStorage();

/**
 * Rebuild the workflow-owned root configuration that an active-agent marker
 * alone cannot describe. Slicer needs both its hidden definition and the
 * finalize tool bound to the current Epic.
 *
 * @param {string} agentName
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 * @param {string} cwd
 */
async function resolvePersistedRootConfiguration(agentName, sessionManager, cwd) {
    if (agentName !== AGENTS.SLICER) return {};
    const planName = readPersistedWorkflowContext(sessionManager)?.planName || "";
    if (!planName) {
        throw new Error("Cannot resume Slicer because its Epic context is missing from the Session transcript.");
    }
    const { createSlicerFinalizeTool } = await import("../workflow/workflow-slicer.ts");
    return {
        subAgentDefinition: { id: SUBAGENTS.SLICER },
        customTools: [createSlicerFinalizeTool({ planName, cwd })],
    };
}

/**
 * @typedef {Object} SessionRuntimeComposition
 * @property {SessionHost} sessionHost
 * @property {ReturnType<typeof import('./file-session-store.ts').openFileSessionStore> | null} sessionStore
 * @property {boolean} [ownsSessionStore]
 * @property {'workspace' | 'tui' | 'acp' | 'test'} ownerProcessKind
 * @property {string} ownerInstanceId
 */

/**
 * @typedef {Object} CreateSessionRuntimeOptions
 * @property {ReturnType<typeof import('./file-session-store.ts').openFileSessionStore> | null} [sessionStore]
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
 * @property {boolean} [deferPersistenceUntilFirstMessage]
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
 */

/**
 * @typedef {Object} DisposableSessionManager
 * @property {() => void} [dispose]
 */

/**
 * @typedef {import('@earendil-works/pi-coding-agent').SessionManager & DisposableSessionManager} RuntimeRootSessionManager
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
    #abortController = new AbortController();

    get proof() {
        return this.#proof;
    }

    get settled() {
        return this.#settled;
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
    if (!activeSession) {
        const compactionSettings = getSettingsManager(session.cwd).getCompactionSettings();
        return { contextUsage: null, autoCompactionEnabled: compactionSettings.enabled !== false };
    }

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
 * @param {string | null | undefined} value
 * @returns {import('./hosted-session.js').ThinkingLevel}
 */
function normalizeThinkingLevel(value) {
    switch (value) {
        case "minimal":
        case "low":
        case "medium":
        case "high":
        case "xhigh":
        case "max":
            return value;
        default:
            return "off";
    }
}

/**
 * @param {{ model?: string | null, provider?: string | null }} modelState
 * @param {{ model?: string | null, provider?: string | null }} managed
 * @returns {{ model: string, provider: string }}
 */
function normalizeManagedActiveModelState(modelState, managed) {
    const model = modelState.model || managed.model || "";
    const provider = modelState.provider || managed.provider || "";
    if (model && provider && model.startsWith(`${provider}/`)) {
        const parsed = parseProviderModel(model);
        if (parsed.ok && parsed.provider === provider) return { model: parsed.id, provider };
    }
    return { model, provider };
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 * @returns {string | undefined}
 */
function resolvePersistedResumeModel(sessionManager) {
    const persisted = readPersistedModelState(sessionManager);
    if (!persisted?.provider || !persisted.model) return undefined;
    try {
        const registry = getModelRegistry();
        const model = registry.find(persisted.provider, persisted.model);
        return model && registry.isSelectable(model) ? `${model.provider}/${model.id}` : undefined;
    } catch {
        return undefined;
    }
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
 * @param {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']> | null | undefined} previous
 * @param {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} next
 * @returns {boolean}
 */
function isSameManagedSyncState(previous, next) {
    return previous?.status === next.status && previous.localGeneration === next.localGeneration &&
        previous.latestGeneration === next.latestGeneration && previous.owningSurfaceKind === next.owningSurfaceKind &&
        previous.message === next.message;
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
    /** @type {Map<string, { cwd: string, name?: string }>} */
    #pendingManagedCreationProjects;
    /** @type {Map<string, import('./session-runtime-events.js').SessionRuntimeEvent[]>} */
    #pendingReplayEvents;
    /** @type {Map<string, string | null>} */
    #observedAttentionEventIds;
    /** @type {FileSessionStoreOwner} */
    #sessionStoreOwner;
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
        this.#pendingReplayEvents = new Map();
        this.#observedAttentionEventIds = new Map();
        this.#sessionStoreOwner = new FileSessionStoreOwner(
            composition.sessionStore,
            composition.ownsSessionStore,
        );
        this.#ownerProcessKind = composition.ownerProcessKind;
        this.#ownerInstanceId = composition.ownerInstanceId;
    }

    get #sessionStore() {
        return this.#sessionStoreOwner.current();
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
        const pendingCreation = this.#pendingManagedCreationProjects.get(sessionId) || null;
        const managedDormant = Boolean(managed && !sessionManager);
        const pendingManagedIntent = session.getPendingManagedTurnIntent?.() || {};
        const pendingAgentName = pendingManagedIntent.agentName || "";
        const rawSessionManagerId = sessionManager?.getSessionId?.();
        const sessionManagerId = managed
            ? managed.piSessionId
            : typeof rawSessionManagerId === "string" && rawSessionManagerId
            ? rawSessionManagerId
            : null;
        const activeExecutionWorkflow = session.getActiveExecutionWorkflow();
        const workflowContext = session.getWorkflowContext() || (managedDormant ? managed?.workflowContext : null) ||
            deriveWorkflowContextFromExecutionWorkflow(activeExecutionWorkflow) || null;
        const contextCapacity = getRuntimeContextCapacity(session);
        const activeModelState = session.getActiveModelState();
        const activeAgentInfo = session.getActiveAgentInfo();
        const managedModel = managedDormant ? managed?.model || "" : "";
        const managedProvider = managedDormant ? managed?.provider || "" : "";
        const managedThinkingLevel = managedDormant ? managed?.thinkingLevel || "" : "";
        return {
            id: session.id,
            cwd: session.cwd,
            sessionManagerId,
            name: sessionManager?.getSessionName?.() || managed?.name || pendingCreation?.name || null,
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
            activeAgent: pendingAgentName || session.getRootAgentName() || activeAgentInfo?.agentName ||
                (managedDormant ? managed?.activeAgent || null : null),
            activeAgentInfo: pendingAgentName
                ? { displayName: pendingAgentName, model: "", provider: "", agentName: pendingAgentName }
                : activeAgentInfo,
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
     * @returns {import('./hosted-session.js').ActiveExecutionWorkflow | null}
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
            return buildActiveConversationSubmissionMessage(syncState.owningSurfaceKind);
        }
        if (syncState.status === "blocked" || syncState.status === "degraded") {
            return syncState.message || "This Session needs recovery before accepting new input.";
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
     * @param {import('./managed-operation.ts').ManagedOperationCapability | null} [capability]
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
        const capability = this.#currentManagedOperations.get(sessionId) || null;
        const managedRejection = this.#rejectManagedPublicMutation(hostedSession, "steerSession", capability);
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

        const capability = this.#currentManagedOperations.get(sessionId) || null;
        const managedRejection = this.#rejectManagedPublicMutation(
            hostedSession,
            "dequeueLastQueuedMessage",
            capability,
        );
        if (managedRejection) return { ...managedRejection, message: null };

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
     * @param {{ activateAgent?: boolean, hydrate?: boolean }} [options]
     * @returns {Promise<any>}
     */
    async #runManagedStandaloneMutation(sessionId, name, operation, options = {}) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return /** @type {any} */ ({ ok: false, error: "not_found" });
        const managed = session.getManagedMetadata?.();
        const currentCapability = this.#currentManagedOperations.get(sessionId) || null;
        if (currentCapability) {
            const context = ACTIVE_MANAGED_OPERATION.getStore();
            if (
                context?.runtime === this && context.sessionId === sessionId && context.capability === currentCapability
            ) {
                return await operation(session, currentCapability);
            }
            await this.#awaitManagedOperationSettlement(sessionId);
            return await this.#runManagedStandaloneMutation(sessionId, name, operation, options);
        }
        if (this.#pendingManagedCreations.has(sessionId) || this.#pendingManagedCreationProjects.has(sessionId)) {
            return { ok: false, error: "managed_operation_in_progress" };
        }
        if (!managed) {
            return await operation(session, /** @type {any} */ (null));
        }
        await this.#restoreDormantManagedInvariant(session);
        if (session.getRootSessionManager?.()) {
            return { ok: false, error: "managed_operation_in_progress" };
        }
        return await this.#runManagedOperation(
            sessionId,
            {
                name,
                options: {
                    expectedGeneration: managed.generation ?? undefined,
                    emitBusyEvents: name !== "switch_agent",
                },
                activateAgent: options.activateAgent === true,
                hydrate: options.hydrate !== false,
            },
            async ({ capability }) => await operation(session, capability),
        );
    }

    /**
     * @param {string} sessionId
     * @param {{ agentName?: string, model?: string }} [options]
     */
    markPromptReadyAgent(sessionId, options = {}) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, error: "not_found" };
        if (!this.#pendingManagedCreationProjects.has(sessionId) || hostedSession.getManagedMetadata?.()) {
            return { ok: false, error: "not_unpersisted_new_session" };
        }
        const agentName = options.agentName || AGENTS.ROUTER;
        const displayName = getAgentDisplayName(agentName, hostedSession.cwd);
        const currentModel = hostedSession.getActiveModelState?.() || { model: "", provider: "" };
        const configuredModelRef = options.model ?? getConfiguredAgentModel(agentName, hostedSession.cwd) ?? "";
        const settingsManager = getSettingsManager(hostedSession.cwd);
        let model = currentModel.model || settingsManager.getDefaultModel?.()?.trim() || "";
        let provider = currentModel.provider || settingsManager.getDefaultProvider?.()?.trim() || "";
        if (configuredModelRef) {
            const parsedModel = parseProviderModel(configuredModelRef);
            if (parsedModel.ok) {
                model = parsedModel.id;
                provider = parsedModel.provider;
            } else {
                model = configuredModelRef;
                provider = "";
            }
        }
        hostedSession.resetAgentInfoStack(displayName, model, provider, agentName);
        this.#emitSessionEvent(sessionId, {
            type: RuntimeEventTypes.AGENT_CHANGED,
            agentName,
            model: model || undefined,
        });
        return { ok: true, agentName, model };
    }

    /**
     * @param {string} sessionId
     * @param {string} name
     */
    async renameSession(sessionId, name) {
        const normalizedName = String(name || "").trim();
        if (!normalizedName) return { ok: false, error: "invalid_name" };
        const pendingCreation = this.#pendingManagedCreationProjects.get(sessionId);
        const pendingSession = this.#sessionHost.getSession(sessionId);
        if (pendingCreation && pendingSession && !pendingSession.getManagedMetadata?.()) {
            pendingCreation.name = normalizedName;
            this.#emitSessionEvent(sessionId, {
                type: RuntimeEventTypes.SESSION_RENAMED,
                name: normalizedName,
            });
            return { ok: true, name: normalizedName };
        }
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
        const promptReadySession = this.#sessionHost.getSession(sessionId);
        if (
            promptReadySession &&
            this.#pendingManagedCreationProjects.has(sessionId) &&
            !promptReadySession.getManagedMetadata?.()
        ) {
            promptReadySession.setActiveModelState(model, provider, true);
            promptReadySession.mergePendingManagedTurnIntent?.({ model, provider, manualModel: true });
            this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
            return { ok: true, model, provider };
        }
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
                session.getRootSessionManager?.()?.appendModelChange?.(provider, model);
                recordManualModelSelection(
                    /** @type {import('@earendil-works/pi-coding-agent').SessionManager | undefined} */ (
                        session.getRootSessionManager?.() || undefined
                    ),
                    provider,
                    model,
                );
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
     * }} options
     * @returns {Promise<any>}
     */
    async runIsolatedAgent(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runIsolatedAgent: session not found");
        if (this.#pendingManagedCreations.has(sessionId) || this.#pendingManagedCreationProjects.has(sessionId)) {
            const pendingAgent = session.getPendingManagedTurnIntent?.()?.agentName || session.getRootAgentName?.() ||
                AGENTS.ROUTER;
            const activated = await this.#activateSessionAgent(session, { agentName: pendingAgent });
            if (!activated?.ok) return activated;
            return await this.runIsolatedAgent(sessionId, options);
        }
        return await this.#runManagedStandaloneMutation(
            sessionId,
            "workflow_operation",
            (activeSession, capability) =>
                this.#runBusyOperation(activeSession.id, () =>
                    runIsolatedAgentSession({
                        hostedSession: activeSession,
                        managedOperationCapability: capability,
                        agentName: options.agentName,
                        userRequest: options.userRequest,
                        images: options.images || [],
                        toolNames: options.toolNames,
                        customTools: options.customTools,
                        modelOverride: options.modelOverride,
                        subAgentDefinition: options.subAgentDefinition,
                    })),
            { activateAgent: false },
        );
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
        const currentCapability = this.#currentManagedOperations.get(session.id) || null;
        if (currentCapability) {
            const context = ACTIVE_MANAGED_OPERATION.getStore();
            if (
                context?.runtime === this && context.sessionId === session.id &&
                context.capability === currentCapability
            ) {
                return await this.#runBusyOperation(session.id, operation);
            }
            await this.#awaitManagedOperationSettlement(session.id);
            return await this.#runWorkflowOperation(session, _operationName, options, operation);
        }
        await this.#restoreDormantManagedInvariant(session);
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
     * Run a repository-only Plan action under Session writer protection without hydrating Pi.
     * @param {string} sessionId
     * @param {import('../workflow/plan-actions.ts').PlanActionRequest} request
     */
    async runPlanAction(sessionId, request) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runPlanAction: session not found");
        const managed = session.getManagedMetadata?.();
        if (!managed) return await executePlanAction(session.cwd, request);
        await this.#restoreDormantManagedInvariant(session);
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

    /**
     * A managed Session may only retain an open transcript while its managed
     * operation owns the activation. If an earlier canceled command left the
     * in-memory hydration behind after the activation was released, discard
     * that stale view so the next command can reopen committed state normally.
     *
     * @param {import('./hosted-session.js').HostedSession} session
     * @returns {Promise<boolean>}
     */
    async #restoreDormantManagedInvariant(session) {
        const managed = session.getManagedMetadata?.();
        if (
            !managed ||
            !session.getRootSessionManager?.() ||
            this.#currentManagedOperations.has(session.id) ||
            session.isTurnActive()
        ) return false;
        const activation = this.#sessionStore?.inspectSessionActivation(managed.runwieldSessionId);
        if (activation?.activation?.state === "active") return false;
        console.error("[RunWield] recovered_orphaned_managed_hydration");
        session.dehydrateManagedSession();
        this.#removeAllQueueSourceSubscriptions(session.id);
        await this.ensureInitialSessionGeneration(managed.runwieldSessionId);
        await this.synchronizeManagedSession(session.id, { emitEvents: false });
        return true;
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async executePlan(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.executePlan: session not found");
        return await this.#runBusyOperation(sessionId, async () => {
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
            if (!prepared?.executionSegmentHandoff) {
                if (prepared?.error) {
                    console.error("[RunWield] execution_handoff_preparation_failed", prepared.error);
                }
                return prepared;
            }
            const latestManaged = session.getManagedMetadata?.() || managed;
            await this.rollManagedSessionSegment(sessionId, {
                kind: "execution",
                continuation: prepared.executionSegmentHandoff,
                expectedGeneration: latestManaged.generation,
            });
            return await this.#resumePendingExecutionSegmentHandoff(session, options) || prepared;
        });
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {*} options
     * @returns {Promise<* | null>}
     */
    async #resumePendingExecutionSegmentHandoff(session, options) {
        const managed = session.getManagedMetadata?.();
        if (!managed) return null;
        return await this.#runManagedStandaloneMutation(session.id, "workflow_operation", async (activeSession) => {
            const marker = readPersistedPendingSegmentContinuationEntry(
                /** @type {any} */ (activeSession.getRootSessionManager?.()),
            );
            const { resolvePendingSegmentHandoff } = await import("../workflow/execution-segment-handoff.ts");
            const resolved = await resolvePendingSegmentHandoff({
                marker: /** @type {any} */ (marker),
                projectRoot: activeSession.cwd,
                runwieldSessionId: managed.runwieldSessionId,
            });
            if (resolved.kind === "absent" || resolved.kind === "consumed") return null;
            if (resolved.kind === "refresh_required" || resolved.kind === "recovery_required") {
                throw new Error(resolved.message);
            }
            if (resolved.continuation.kind === "semantic_repair") {
                return await this.#runSemanticRepairContinuation(
                    activeSession.id,
                    activeSession,
                    options,
                    resolved.continuation,
                    true,
                );
            }
            const { executePreparedPlanSegmentHandoff } = await import("../workflow/workflow.js");
            return await executePreparedPlanSegmentHandoff(
                /** @type {any} */ ({
                    continuation: resolved.continuation,
                    hostedSession: activeSession,
                }),
            );
        }, { activateAgent: false });
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
        if (options.skipPendingSegmentResume !== true) {
            const pendingResult = await this.#resumePendingExecutionSegmentHandoff(session, options);
            if (pendingResult) return pendingResult;
        }
        const result = await this.#runWorkflowOperation(session, "runValidation", options, async () => {
            const { SYSTEM_SEMANTIC_REVIEW_PORT } = await import("../workflow/validation.ts");
            const { runWorkflowValidationToStableBoundary } = await import(
                "../workflow/validation-supervisor.ts"
            );
            const { createGitPort } = await import("../git-port.ts");
            const { systemLocalCIPort } = await import("../workflow/validation-local-ci.ts");
            const { SYSTEM_WORK_RECORD_MNEMOSYNE_PORT } = await import("../work-records/mnemosyne-port.ts");
            const validationPorts = {
                git: createGitPort(),
                localCI: systemLocalCIPort,
                workRecordMnemosynePort: SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
            };
            const latestResult = await runWorkflowValidationToStableBoundary(
                /** @type {any} */ ({
                    ...options,
                    hostedSession: session,
                    ...validationPorts,
                    semanticReviewPort: SYSTEM_SEMANTIC_REVIEW_PORT,
                    supportsSemanticRepairHandoff: true,
                }),
            );
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
            runwieldSessionId: managed?.runwieldSessionId || session.id,
            planId,
            planName: options.planName,
            approvedRevision: workflow.triageMeta?.revision || await getPlanRevisionForText(options.planContent || ""),
            approvedStatus: workflow.triageMeta?.status || "implemented",
            approvedMarkdown: options.planContent || "",
            preparedEvidence: evidence.evidence,
            activeWorkflow: { ...workflow, ...handoff.activeWorkflow },
            // The handoff names the Agent that resumes the repair; `activeWorkflow`
            // above still carries the canonical `engineer` owner.
            executionOwner: resolvePlanExecutionRuntimeAgent(workflow.executionAgent),
            semanticRound: handoff.semanticRound,
            repairGeneration: handoff.repairGeneration,
            reviewLedger: handoff.reviewLedger,
            repairBaselineTree: handoff.repairBaselineTree,
            lastRepairReport: handoff.lastRepairReport,
            executionState: { executionCwd: workflow.executionCwd, baselineTree: workflow.baselineTree },
            ciState: buildSemanticRepairCiState(options, workflow, handoff),
            priorRepairClaims: workflow.lastRepairReport ? [workflow.lastRepairReport] : [],
            diffText: handoff.diffText,
            findingsSection: handoff.findingsSection,
        });
        if (managed) {
            const latestManaged = session.getManagedMetadata?.() || managed;
            await this.rollManagedSessionSegment(sessionId, {
                kind: "semantic_repair",
                continuation,
                expectedGeneration: latestManaged.generation,
            });
        }
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
                agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
                userRequest: buildValidationRepairPrompt({
                    executionCwd,
                    repairCwd: executionCwd,
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
                    completionInstruction:
                        "Report a disposition for every finding, then call task_completed. If a finding is still open because something blocked you, stop in plain text instead and name it.",
                }),
                cwd: executionCwd,
                dispatchKind: "validation_repair",
                subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
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
            const { recordValidationRepairCompletion } = await import(
                "../workflow/validation-supervisor.ts"
            );
            await recordValidationRepairCompletion({
                projectRoot: executionCwd,
                planName: continuation.plan.planName,
                repairGeneration: continuation.repair.repairGeneration,
                report,
            });
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
            const { loadPlan } = await import("../../plan-store.js");
            const completedPlan = await loadPlan(
                executionCwd,
                continuation.plan.planName || options.planName,
            );
            if (!completedPlan) throw new Error("Completed semantic repair Plan is unavailable.");
            const refreshedWorkflow = {
                ...(session.getActiveExecutionWorkflow?.() || continuation.activeWorkflow),
                triageMeta: {
                    ...(continuation.activeWorkflow?.triageMeta || options.triageMeta),
                    ...completedPlan.attrs,
                    revision: completedPlan.revision,
                },
            };
            session.setActiveExecutionWorkflow(/** @type {any} */ (refreshedWorkflow));
            return await this.runValidation(sessionId, {
                ...options,
                planName: continuation.plan.planName || options.planName,
                planContent: completedPlan.markdown || options.planContent,
                triageMeta: refreshedWorkflow.triageMeta,
                executionContext: refreshedWorkflow,
                trigger: "repair",
                taskCompletionId: continuation.repair.repairGeneration,
                skipPendingSegmentResume: true,
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
        if (!this.#sessionStore) {
            return { ok: false, error: "session_store_unavailable", message: "This Session is unavailable." };
        }
        let inspected;
        try {
            inspected = this.#sessionStore.inspectSessionActivation(managed.runwieldSessionId);
        } catch (_error) {
            return { ok: false, error: "managed_read_blocked", message: "Managed read is unavailable." };
        }
        if (!inspected.generation) {
            return { ok: false, error: "committed_generation_unavailable", message: "Managed read is unavailable." };
        }
        try {
            const segments = this.#sessionStore.listSessionTranscriptSegments(managed.runwieldSessionId);
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
        const pendingEvents = this.#pendingReplayEvents.get(sessionId);
        if (pendingEvents) {
            this.#pendingReplayEvents.delete(sessionId);
            for (const event of pendingEvents) this.#emitSessionEvent(sessionId, event);
            return { ok: true, replayed: pendingEvents.length };
        }
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
            if (!this.#sessionStore) {
                throw new Error("Cannot persist image attachment: no active session is available.");
            }
            return await this.#runManagedOperation(
                sessionId,
                {
                    name: "submit_user_turn",
                    options: { expectedGeneration: managed.generation ?? undefined },
                    activateAgent: false,
                },
                async () => await this.persistSessionImage(sessionId, image),
            );
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
            session.getRootSessionManager()?.appendThinkingLevelChange?.(next);
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
        if (this.#pendingManagedCreations.has(sessionId) || this.#pendingManagedCreationProjects.has(sessionId)) {
            await this.#activateSessionAgent(session, { agentName: AGENTS.ROUTER });
            return await this.runLocalShellCommand(sessionId, options);
        }
        const managed = session.getManagedMetadata?.();
        const activeCapability = this.#currentManagedOperations.get(sessionId) || null;
        if (managed && activeCapability) {
            return await this.#runLocalShellCommandInSession(session, options, activeCapability);
        }
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
        const promptReadySession = this.#sessionHost.getSession(sessionId);
        if (
            promptReadySession &&
            this.#pendingManagedCreationProjects.has(sessionId) &&
            !promptReadySession.getManagedMetadata?.()
        ) {
            await getSettingsManager(promptReadySession.cwd).reload();
            promptReadySession.clearUserModelOverride?.();
            promptReadySession.mergePendingManagedTurnIntent?.({ model: "", provider: "" });
            const activeAgentInfo = promptReadySession.getActiveAgentInfo?.() || null;
            const agentName = activeAgentInfo?.agentName || AGENTS.ROUTER;
            promptReadySession.resetAgentInfoStack(
                getAgentDisplayName(agentName, promptReadySession.cwd),
                "",
                "",
                agentName,
            );
            const refreshed = this.markPromptReadyAgent(sessionId, { agentName });
            return refreshed.ok ? { ok: true, deferred: true } : refreshed;
        }
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
            const managed = session.getManagedMetadata?.();
            const projected = await this.#readManagedCommittedProjection(sessionId);
            if (!projected.ok) return { ok: false, error: projected.error, message: projected.message };
            const info = buildProjectedSessionInfo(projected.entries, {
                sessionId,
                cwd: session.cwd,
                transcriptPath: session.getManagedMetadata?.()?.transcriptPath,
            });
            return buildSessionContextReport({
                agentName: managed?.activeAgent || "",
                agentDisplayName: managed?.activeAgent ? getAgentDisplayName(managed.activeAgent, session.cwd) : "",
                model: { provider: managed?.provider || "", model: managed?.model || "" },
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
        const sessionStore = this.#sessionStoreOwner.ensure();
        return await listRecentResumableSessions(cwd, sessionStore);
    }

    /**
     * @param {{ cwd: string, sessionId: string, sessionPath?: string }} options
     */
    async #inspectUnmanagedResumableSession(options) {
        const { locators } = await listCatalogSafeRootSessionLocators(options.cwd);
        const locator = locators.find((candidate) =>
            candidate.piSessionId === options.sessionId &&
            (!options.sessionPath || candidate.sessionPath === options.sessionPath)
        );
        if (!locator) throw new Error("The Session transcript is unavailable");
        const evidence = await captureTranscriptEvidence({
            transcriptPath: locator.sessionPath,
            transcriptCwd: locator.headerCwd,
        });
        return inspectProjectedTranscript(evidence.entries);
    }

    /**
     * Inspect the model context of a persisted session without exposing its
     * SessionManager to the consumer.
     *
     * @param {{ cwd: string, sessionId: string, sessionPath?: string }} options
     */
    async inspectResumableSession(options) {
        if (!this.#sessionStore) {
            return {
                estimatedTokens: 0,
                messageCount: 0,
                model: null,
                ok: false,
                error: "session_store_unavailable",
            };
        }
        const classified = await classifyRootSessionLocator({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath: options.sessionPath,
            ownerCoordinationStore: this.#sessionStore,
        });
        if (classified.kind === "managed" && classified.session) {
            const inspected = this.#sessionStore?.inspectSessionActivation(
                classified.session.runwieldSessionId,
            );
            if (!inspected?.generation) {
                return await this.#inspectUnmanagedResumableSession(options);
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
            session.getRootSessionManager()?.appendThinkingLevelChange?.(thinkingLevel);
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
            this.#pendingReplayEvents.delete(id);
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
        try {
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
        } finally {
            this.#sessionStoreOwner.closeOwned();
        }
    }

    async closeAllSessionsWhenIdle() {
        const sessions = this.listSessions();
        try {
            await Promise.all(sessions.map((session) => this.closeSessionWhenIdle(session.id)));
            return { ok: true, closed: sessions.length };
        } finally {
            this.#sessionStoreOwner.closeOwned();
        }
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
     * Create and lock the durable Session state shared by deferred prompt and
     * Agent-activation paths. The caller decides whether to retain or release
     * the activation proof.
     *
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @returns {Promise<{
     *   managed: import('./hosted-session.js').ManagedSessionMetadata,
     *   proof: import('../owner-coordination/session-activations.js').ActivationProof,
     *   createdSessionManager: boolean,
     * } | null>}
     */
    async #prepareDeferredManagedCreation(hostedSession) {
        const pendingProject = this.#pendingManagedCreationProjects.get(hostedSession.id);
        if (!pendingProject) return null;
        const sessionStore = this.#sessionStoreOwner.ensure();
        const managedProject = this.#ensureSessionProjectForCwd(pendingProject.cwd);
        if (!managedProject) throw new Error("Session Manager create is blocked: project_identity_unavailable");
        const existingSessionManager = hostedSession.getRootSessionManager();
        /** @type {RuntimeRootSessionManager | null} */
        let sessionManager = existingSessionManager
            ? /** @type {RuntimeRootSessionManager} */ (existingSessionManager)
            : null;
        let createdSessionManager = false;
        let proof = null;
        try {
            if (!sessionManager) {
                sessionManager = /** @type {RuntimeRootSessionManager} */ (
                    await createRootSessionManager("new", hostedSession.cwd)
                );
                hostedSession.setRootSessionManager(
                    /** @type {import('./hosted-session.js').MinimalSessionManagerLike} */ (sessionManager),
                );
                createdSessionManager = true;
            }
            if (!sessionManager) throw new Error("The Session could not be opened");
            if (pendingProject.name && sessionManager.getSessionName?.() !== pendingProject.name) {
                sessionManager.appendSessionInfo?.(pendingProject.name);
            }
            const piSessionId = sessionManager.getSessionId?.();
            if (!piSessionId) throw new Error("The Session could not be persisted");
            const transcriptPath = await this.#resolveCreatedSessionPath(hostedSession.cwd, sessionManager);
            const acquired = await sessionStore.ensureSessionCatalogRecordAndAcquire({
                locator: {
                    projectId: managedProject.projectId,
                    piSessionId,
                    transcriptPath,
                    transcriptCwd: hostedSession.cwd,
                    source: "created",
                },
                activation: {
                    ownerInstanceId: this.#ownerInstanceId,
                    ownerProcessKind: this.#ownerProcessKind,
                    phase: "preparing",
                },
            });
            proof = acquired.proof;
            const managedSession = acquired.session;
            const managedSegment = acquired.segment;
            recordSegmentLineageEvidence(sessionManager, {
                segmentId: managedSegment.segmentId,
                runwieldSessionId: managedSession.runwieldSessionId,
                parentSegmentId: null,
                parentPiSessionId: null,
                lineageGroupKey: managedSegment.segmentId,
                kind: "planning",
            });
            /** @type {import('./hosted-session.js').ManagedSessionMetadata} */
            const managed = {
                runwieldSessionId: managedSession.runwieldSessionId,
                projectId: managedSession.projectId,
                piSessionId: managedSession.piSessionId,
                transcriptPath: managedSession.transcriptPath,
                currentSegmentId: managedSegment.segmentId,
                generation: null,
                acknowledgedGeneration: null,
                acknowledgedEventId: null,
                name: pendingProject.name || managedSession.displayName,
                activeAgent: null,
                workflowContext: null,
                syncState: {
                    type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                    status: "syncing",
                    localGeneration: null,
                    latestGeneration: null,
                },
            };
            hostedSession.setManagedMetadata(managed);
            return { managed, proof, createdSessionManager };
        } catch (error) {
            if (proof) {
                try {
                    sessionStore.releaseUnchangedActivation(proof);
                } catch {
                    // Preserve the creation failure after best-effort lock release.
                }
            }
            if (createdSessionManager) {
                sessionManager?.dispose?.();
                hostedSession.setRootSessionManager(null);
            }
            throw error;
        }
    }

    /**
     * Create the durable managed shell for the first user turn without creating
     * a root Agent or publishing an empty generation.
     *
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     */
    async #materializeDeferredManagedShell(hostedSession) {
        const prepared = await this.#prepareDeferredManagedCreation(hostedSession);
        if (!prepared) return hostedSession.getManagedMetadata?.() || null;
        if (!this.#sessionStore) throw new Error("Session coordination is unavailable");
        try {
            this.#sessionStore.releaseUnchangedActivation(prepared.proof);
            this.#pendingManagedCreationProjects.delete(hostedSession.id);
            return prepared.managed;
        } catch (error) {
            try {
                this.#sessionStore.releaseUnchangedActivation(prepared.proof);
            } catch {
                // Preserve the materialization failure after best-effort lock release.
            }
            hostedSession.setManagedMetadata(null);
            if (prepared.createdSessionManager) {
                hostedSession.getRootSessionManager()?.dispose?.();
                hostedSession.setRootSessionManager(null);
            }
            throw error;
        }
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
        if (!pendingCreation && this.#pendingManagedCreationProjects.has(hostedSession.id)) {
            const prepared = await this.#prepareDeferredManagedCreation(hostedSession);
            if (!prepared) throw new Error("Session coordination was interrupted during creation");
            pendingCreation = prepared.proof;
            this.#pendingManagedCreationProjects.delete(hostedSession.id);
            this.#pendingManagedCreations.set(hostedSession.id, pendingCreation);
        }
        if (!pendingCreation) return await switchActiveAgent(hostedSession, options);
        if (!this.#sessionStore) throw new Error("Session coordination is unavailable");
        let activeProof = pendingCreation;
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) throw new Error("Session coordination was interrupted during creation");
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
        let activationResult;
        try {
            activeProof = this.#sessionStore.changeSessionActivationPhase(activeProof, "hydrated");
            capability.updateProof(activeProof);
            hydrated = true;
            activationResult = await switchActiveAgent(hostedSession, {
                ...options,
                managedOperationCapability: capability,
            });
            activeProof = this.#sessionStore.changeSessionActivationPhase(activeProof, "checkpointing");
            capability.updateProof(activeProof);
            const managed = hostedSession.getManagedMetadata?.();
            if (!managed) throw new Error("Session coordination was interrupted during creation");
            await syncTranscriptFileAndParent(managed.transcriptPath);
            const evidence = await captureTranscriptEvidence({
                transcriptPath: managed.transcriptPath,
                transcriptCwd: hostedSession.cwd,
            });
            this.#sessionStore.publishGenerationAndRelease(activeProof, {
                generation: 0,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
                currentSegmentId: managed.currentSegmentId,
            });
            const managedModelState = normalizeManagedActiveModelState(
                hostedSession.getActiveModelState?.() || {},
                managed,
            );
            hostedSession.setManagedMetadata({
                ...managed,
                generation: 0,
                acknowledgedGeneration: 0,
                activeAgent: hostedSession.getRootAgentName?.() || null,
                model: managedModelState.model,
                provider: managedModelState.provider,
                thinkingLevel: hostedSession.getThinkingLevel?.() || managed.thinkingLevel || "off",
                workflowContext: hostedSession.getWorkflowContext?.() || managed.workflowContext || null,
            });
            this.#pendingManagedCreations.delete(hostedSession.id);
            this.#pendingManagedCreationProjects.delete(hostedSession.id);
            hostedSession.dehydrateManagedSession();
            await this.synchronizeManagedSession(hostedSession.id, { emitEvents: false, replayFromStart: true });
        } catch (error) {
            this.#pendingManagedCreations.delete(hostedSession.id);
            this.#pendingManagedCreationProjects.delete(hostedSession.id);
            hostedSession.dehydrateManagedSession();
            this.#removeAllQueueSourceSubscriptions(hostedSession.id);
            try {
                if (hydrated) {
                    await syncTranscriptFileAndParent(managed.transcriptPath);
                    this.#sessionStore.markSessionUncertain(activeProof, {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                    await this.ensureInitialSessionGeneration(managed.runwieldSessionId);
                    await this.synchronizeManagedSession(hostedSession.id, { emitEvents: false });
                } else {
                    this.#sessionStore.releaseUnchangedActivation(activeProof);
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
        return activationResult;
    }

    /** @param {import('./hosted-session.js').HostedSession} hostedSession */
    async #alignActiveExecutionWorkflowOwner(hostedSession) {
        const workflow = hostedSession.getActiveExecutionWorkflow?.() || null;
        const executionAgent = resolveActiveWorkflowRuntimeAgent(workflow) || "";
        if (!executionAgent) return;
        const executionCwd = typeof workflow?.executionCwd === "string" ? workflow.executionCwd : "";
        await this.#activateSessionAgent(hostedSession, {
            agentName: executionAgent,
            ...(executionCwd ? { cwd: executionCwd } : {}),
        });
    }

    /** @param {string} cwd */
    #ensureSessionProjectForCwd(cwd) {
        if (!this.#sessionStore) return null;
        try {
            Deno.mkdirSync(cwd, { recursive: true });
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        }
        return this.#sessionStore.ensureRuntimeProject({ root: cwd });
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
        if (!this.#sessionStore) throw new Error("Session coordination is unavailable");
        const emitEvents = options.emitEvents !== false;
        const emitSyncState = (
            /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */ state,
        ) => {
            const previousState = managed.syncState;
            hostedSession.setManagedMetadata({ ...managed, syncState: state });
            managed = hostedSession.getManagedMetadata?.() || managed;
            if (!isSameManagedSyncState(previousState, state)) {
                this.#emitSessionEvent(sessionId, state);
            }
        };
        const sanitizedSurface = (/** @type {unknown} */ processKind) => {
            if (processKind === "workspace" || processKind === "tui" || processKind === "acp") return processKind;
            return "unknown";
        };
        let activationState = this.#sessionStore.inspectSessionActivation(managed.runwieldSessionId);
        if (
            ["uncertain", "reconcile_required"].includes(activationState.activation?.state || "") ||
            (!activationState.generation && activationState.activation?.state === "uninitialized")
        ) {
            await this.ensureInitialSessionGeneration(managed.runwieldSessionId);
            activationState = this.#sessionStore.inspectSessionActivation(managed.runwieldSessionId);
        }
        const latestGeneration = activationState.generation?.generation ?? null;
        const currentLocalGeneration = managed.acknowledgedGeneration ?? managed.generation ?? null;
        const managedAlreadyCurrent = !options.replayFromStart && latestGeneration === currentLocalGeneration &&
            !managed.acknowledgedEventId && !Number.isInteger(managed.acknowledgedEventOrdinal) &&
            managed.syncState?.status === "current" && managed.syncState.localGeneration === currentLocalGeneration &&
            managed.syncState.latestGeneration === latestGeneration;
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
            (managed.acknowledgedEventId || Number.isInteger(managed.acknowledgedEventOrdinal) ||
                latestGeneration === null)
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
        if (!managedAlreadyCurrent) {
            emitSyncState(
                /** @type {NonNullable<import('./hosted-session.js').ManagedSessionMetadata['syncState']>} */ ({
                    type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                    status: "syncing",
                    localGeneration: currentLocalGeneration,
                    latestGeneration,
                    ...(owningSurfaceKind ? { owningSurfaceKind } : {}),
                }),
            );
        }
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
                    segments: this.#sessionStore.listSessionTranscriptSegments(managed.runwieldSessionId),
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
            const previousSyncState = managed.syncState;
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
            if (managed.syncState && !isSameManagedSyncState(previousSyncState, managed.syncState)) {
                this.#emitSessionEvent(sessionId, managed.syncState);
            }
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
     * Publish the complete current transcript after a writer stopped before
     * its checkpoint. For an existing generation, recovery first proves that
     * the committed prefix is unchanged. The file store holds the OS lock and
     * rejects any transcript or fence change during recovery.
     *
     * @param {string} runwieldSessionId
     */
    async ensureInitialSessionGeneration(runwieldSessionId) {
        if (!this.#sessionStore) throw new Error("Session coordination is unavailable");
        const session = this.#sessionStore.getSessionById(runwieldSessionId);
        if (!session) throw new Error("Session identity is unavailable");
        const state = this.#sessionStore.inspectSessionActivation(runwieldSessionId);
        const needsRecovery = ["uncertain", "reconcile_required"].includes(state.activation?.state || "");
        if (state.generation && !needsRecovery) return state;
        const segment = this.#sessionStore.getCurrentSessionSegment(runwieldSessionId);
        if (!segment) throw new Error("The Session transcript is unavailable");
        const evidence = await captureTranscriptEvidence({
            transcriptPath: segment.transcriptPath,
            transcriptCwd: segment.transcriptCwd,
        });
        if (needsRecovery) {
            return this.#sessionStore.recoverSessionControl({
                runwieldSessionId,
                projectId: session.projectId,
                expectedFence: state.activation?.fence ?? 0,
                expectedGeneration: state.generation?.generation ?? null,
                expectedCurrentSegmentId: segment.segmentId,
                ownerInstanceId: this.#ownerInstanceId,
                ownerProcessKind: this.#ownerProcessKind,
                transcriptEvidence: {
                    byteLength: evidence.byteLength,
                    terminalEntryId: evidence.terminalEntryId,
                    digestHex: evidence.digestHex,
                    currentSegmentId: segment.segmentId,
                },
            });
        }
        if (state.activation?.state !== "uninitialized") {
            throw new Error("The Session's initial transcript state is unavailable");
        }
        let proof = this.#sessionStore.acquireSessionActivation({
            runwieldSessionId,
            projectId: session.projectId,
            ownerInstanceId: this.#ownerInstanceId,
            ownerProcessKind: this.#ownerProcessKind,
            expectedGeneration: null,
            expectedCurrentSegmentId: segment.segmentId,
            phase: "bootstrap",
        });
        try {
            proof = this.#sessionStore.changeSessionActivationPhase(proof, "checkpointing");
            return this.#sessionStore.publishGenerationAndRelease(proof, {
                generation: 0,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
                currentSegmentId: segment.segmentId,
            });
        } catch (error) {
            this.#sessionStore.markSessionReconcileRequiredWithProof(proof, {
                reason: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Adopt a Session as a dormant Runtime shell. This path deliberately
     * does not open a writable Pi Session Manager.
     *
     * @param {{ session: import('../owner-coordination/sessions.js').CatalogedSession, generation?: number | null, acknowledgedEventId?: string | null, hostedSessionId?: string | null, name?: string | null, activeAgent?: string | null, model?: string | null, provider?: string | null, thinkingLevel?: string | null, workflowContext?: import('./workflow-context-session.js').WorkflowContext | null }} options
     */
    adoptManagedSession(options) {
        const cataloged = options?.session;
        if (!cataloged) throw new Error("SessionRuntime.adoptManagedSession requires a cataloged Session");
        const hostedSession = this.#sessionHost.createSession({
            id: typeof options.hostedSessionId === "string" && options.hostedSessionId
                ? options.hostedSessionId
                : crypto.randomUUID(),
            cwd: cataloged.transcriptCwd,
            sessionManager: null,
            managed: {
                runwieldSessionId: cataloged.runwieldSessionId,
                projectId: cataloged.projectId,
                piSessionId: cataloged.piSessionId,
                transcriptPath: cataloged.transcriptPath,
                currentSegmentId:
                    this.#sessionStore?.getCurrentSessionSegment(cataloged.runwieldSessionId)?.segmentId ||
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
     * provide the user's raw editor text; Runtime applies the current generation
     * fence before the active root receives it.
     *
     * @param {string} sessionId
     * @param {PromptSessionOptions} options
     * @returns {Promise<{ ok: boolean, turns: number, error?: string, managed: boolean, submittedRequest: string, restoreDraft: boolean, historyText?: string }>}
     */
    async promptUserTurn(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptUserTurn: session not found");
        let managed = hostedSession.getManagedMetadata?.() || null;
        const isDeferredFirstTurn = !managed && this.#pendingManagedCreationProjects.has(sessionId);
        const deferredFirstTurnId = isDeferredFirstTurn ? crypto.randomUUID() : "";
        let deferredBusyStarted = false;
        if (isDeferredFirstTurn) {
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.USER_MESSAGE,
                turnId: deferredFirstTurnId,
                text: options.initialRequest,
                images: (options.initialImages || []).map((image) => ({ ...image })),
            });
            this.#emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.TURN_START,
                turnId: deferredFirstTurnId,
            });
            this.#beginBusyOperation(sessionId, deferredFirstTurnId);
            deferredBusyStarted = true;
            const activeAgentInfo = hostedSession.getActiveAgentInfo?.() || null;
            const agentName = options.agentName || activeAgentInfo?.agentName || AGENTS.ROUTER;
            hostedSession.mergePendingManagedTurnIntent?.({ agentName });
            // Give presentation adapters one event-loop turn to paint the user
            // message and first busy frame before filesystem/session setup begins.
            await new Promise((resolve) => setTimeout(resolve, 0));
            try {
                managed = await this.#materializeDeferredManagedShell(hostedSession);
            } catch (error) {
                this.#emitSessionEvent(hostedSession.id, {
                    type: RuntimeEventTypes.TURN_END,
                    turnId: deferredFirstTurnId,
                    ok: false,
                });
                if (deferredBusyStarted) {
                    this.#endBusyOperation(sessionId, deferredFirstTurnId);
                    deferredBusyStarted = false;
                }
                throw error;
            }
        }
        if (!managed) throw new Error("SessionRuntime.promptUserTurn: segmented Session metadata is unavailable");
        const submittedRequest = options.initialRequest;
        const requestOptions = deferredFirstTurnId
            ? { ...options, initialRequest: submittedRequest, turnId: deferredFirstTurnId, emitInitialEvents: false }
            : { ...options, initialRequest: submittedRequest };
        const buildResult = (
            /** @type {{ ok: boolean, turns: number, error?: string }} */ result,
        ) => ({
            ...result,
            managed: true,
            submittedRequest,
            restoreDraft: Boolean(result.error),
            ...(result.ok && submittedRequest.trim() ? { historyText: submittedRequest.trim() } : {}),
        });

        const expectedGenerationSource = managed.acknowledgedGeneration ?? managed.generation;
        const expectedGeneration = Number.isSafeInteger(expectedGenerationSource)
            ? /** @type {number} */ (expectedGenerationSource)
            : null;
        try {
            return buildResult(
                await this.promptManagedSession(sessionId, {
                    ...requestOptions,
                    expectedGeneration,
                }),
            );
        } finally {
            if (deferredBusyStarted) this.#endBusyOperation(sessionId, deferredFirstTurnId);
        }
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
        this.#pendingReplayEvents.delete(sessionId);
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) throw new Error("SessionRuntime.runManagedOperation: Session is not managed");
        if (this.#currentManagedOperations.has(sessionId)) {
            return {
                ok: false,
                turns: 0,
                error: "managed_operation_in_progress",
            };
        }
        if (!this.#sessionStore) throw new Error("Session coordination is unavailable");
        const state = this.#sessionStore.inspectSessionActivation(managed.runwieldSessionId);
        const latestGeneration = state.generation?.generation ?? null;
        const options = descriptor.options || {};
        const expectedGeneration = options.expectedGeneration ?? managed.generation ?? latestGeneration ?? null;
        const nextGeneration = (expectedGeneration ?? -1) + 1;
        const isUnpublishedInitialGeneration = latestGeneration === null && expectedGeneration === 0;
        if (latestGeneration !== expectedGeneration && !isUnpublishedInitialGeneration) {
            return { ok: false, turns: 0, error: "refresh_required" };
        }
        /** @type {import('../owner-coordination/session-activations.js').ActivationProof} */
        let activeProof;
        try {
            activeProof = this.#sessionStore.acquireSessionActivation({
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
                    error: "refresh_required",
                };
            }
            if (
                message.includes("Session activation is not available") ||
                message.includes("activation race lost") ||
                message.includes("another RunWield surface")
            ) {
                return {
                    ok: false,
                    turns: 0,
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
        /** @type {() => void} */
        let cleanupTurnStart = () => {};
        const shouldEmitBusyEvents = options.emitBusyEvents !== false;
        if (shouldEmitBusyEvents) this.#beginBusyOperation(sessionId);
        try {
            const pendingIntent = hostedSession.getPendingManagedTurnIntent?.() || {};
            if (state.generation) {
                const generationSegment = this.#sessionStore.listSessionTranscriptSegments(
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
                    this.#sessionStore.markSessionReconcileRequiredWithProof(activeProof, {
                        reason: "transcript_ahead_or_mismatch",
                    });
                    return {
                        ok: false,
                        turns: 0,
                        error: "reconcile_required",
                    };
                }
            }
            const acceptedTurnId = options.turnId || crypto.randomUUID();
            const turnStartCleanup = options.onTurnStarted?.({ turnId: acceptedTurnId });
            if (typeof turnStartCleanup === "function") cleanupTurnStart = turnStartCleanup;
            const hasPendingImages = (options.initialImages || []).some((image) => !image.path && !image.ref);
            if (descriptor.hydrate === false) {
                const result = await ACTIVE_MANAGED_OPERATION.run(
                    { runtime: this, sessionId, capability },
                    async () => await body({ acceptedTurnId, hasPendingImages, capability }),
                );
                this.#sessionStore.releaseUnchangedActivation(activeProof);
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
            activeProof = this.#sessionStore.changeSessionActivationPhase(activeProof, "hydrated");
            capability.updateProof(activeProof);
            hydrated = true;
            const { sessionManager } = await openPersistedRootSession({
                cwd: hostedSession.cwd,
                sessionId: managed.piSessionId,
                sessionPath: managed.transcriptPath,
            });
            hostedSession.setRootSessionManager(/** @type {any} */ (sessionManager), capability);
            const pendingModel = pendingIntent.model || pendingIntent.provider
                ? pendingIntent.provider && pendingIntent.model
                    ? `${pendingIntent.provider}/${pendingIntent.model}`
                    : pendingIntent.model || undefined
                : undefined;
            if (pendingIntent.model || pendingIntent.provider) {
                hostedSession.setActiveModelState(pendingIntent.model || "", pendingIntent.provider || "", true);
            }
            if (pendingIntent.manualModel && pendingModel) {
                const parsedPendingModel = parseProviderModel(pendingModel);
                recordManualModelSelection(
                    sessionManager,
                    parsedPendingModel.ok ? parsedPendingModel.provider : "",
                    parsedPendingModel.ok ? parsedPendingModel.id : pendingModel,
                );
            }
            if (pendingIntent.thinkingLevel || managed.thinkingLevel) {
                hostedSession.setThinkingLevel(normalizeThinkingLevel(
                    pendingIntent.thinkingLevel || managed.thinkingLevel,
                ));
            }
            let agentName = options.agentName || pendingIntent.agentName || null;
            if (descriptor.activateAgent !== false) {
                const resumeAgent = await resolveResumeAgentName(sessionManager);
                agentName ||= resumeAgent;
                const persistedManualModel = readPersistedManualModelState(sessionManager, agentName);
                const persistedModel = agentName === resumeAgent
                    ? resolvePersistedResumeModel(sessionManager)
                    : undefined;
                const persistedRootConfiguration = await resolvePersistedRootConfiguration(
                    agentName,
                    sessionManager,
                    hostedSession.cwd,
                );
                await this.#activateSessionAgent(hostedSession, {
                    ...persistedRootConfiguration,
                    agentName,
                    model: pendingModel ||
                        (persistedManualModel
                            ? persistedManualModel.provider
                                ? `${persistedManualModel.provider}/${persistedManualModel.model}`
                                : persistedManualModel.model
                            : persistedModel),
                    toolNames: options.toolNames,
                    customTools: options.customTools || persistedRootConfiguration.customTools,
                    includeEditFallback: options.includeEditFallback,
                    managedOperationCapability: capability,
                });
                if (pendingIntent.model || pendingIntent.provider) {
                    hostedSession.getRootSessionManager?.()?.appendModelChange?.(
                        pendingIntent.provider || "",
                        pendingIntent.model || "",
                    );
                }
            }
            hostedSession.consumePendingManagedTurnIntent?.();
            activeProof = this.#sessionStore.changeSessionActivationPhase(activeProof, "turning");
            capability.updateProof(activeProof);
            const result = await ACTIVE_MANAGED_OPERATION.run(
                { runtime: this, sessionId, capability },
                async () => await body({ acceptedTurnId, hasPendingImages, capability }),
            );
            activeProof = this.#sessionStore.changeSessionActivationPhase(activeProof, "checkpointing");
            capability.updateProof(activeProof);
            const managedModelState = normalizeManagedActiveModelState(
                hostedSession.getActiveModelState?.() || {},
                managed,
            );
            const nextManaged = {
                ...managed,
                generation: nextGeneration,
                acknowledgedGeneration: nextGeneration,
                name: hostedSession.getRootSessionManager?.()?.getSessionName?.() || managed.name || null,
                activeAgent: hostedSession.getRootAgentName?.() || null,
                model: managedModelState.model,
                provider: managedModelState.provider,
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
            this.#sessionStore.publishGenerationAndRelease(activeProof, {
                generation: nextGeneration,
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
                    this.#sessionStore.releaseUnchangedActivation(activeProof);
                } catch {
                    this.#sessionStore.markSessionUncertain(activeProof, {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            } else {
                let uncertaintyRecorded = false;
                try {
                    await syncTranscriptFileAndParent(managed.transcriptPath);
                    this.#sessionStore.markSessionUncertain(activeProof, {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                    uncertaintyRecorded = true;
                    await this.ensureInitialSessionGeneration(managed.runwieldSessionId);
                    await this.synchronizeManagedSession(sessionId, { emitEvents: false });
                } catch (recoveryError) {
                    if (!uncertaintyRecorded) {
                        try {
                            this.#sessionStore.markSessionUncertain(activeProof, {
                                reason: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
                            });
                        } catch {
                            // Preserve the original turn failure when recovery cannot record its own failure.
                        }
                    }
                }
            }
            throw error;
        } finally {
            cleanupTurnStart();
            capability.settle();
            this.#currentManagedOperations.delete(sessionId);
            this.#currentManagedOperationSettlements.delete(sessionId);
            settleManagedOperation();
            hostedSession.setManagedOperationCapability(null);
            if (shouldEmitBusyEvents) this.#endBusyOperation(sessionId);
        }
    }

    /**
     * @param {string} sessionId
     * @param {PromptSessionOptions & { expectedGeneration: number | null }} options
     */
    async promptManagedSession(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptManagedSession: session not found");
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) throw new Error("SessionRuntime.promptManagedSession: segmented Session metadata is unavailable");
        const result = await this.#runManagedOperation(
            sessionId,
            { name: "prompt", options, emitPromptEvents: options.emitInitialEvents === false ? false : undefined },
            async ({ acceptedTurnId, hasPendingImages, capability }) =>
                await this.promptSession(sessionId, {
                    ...options,
                    turnId: acceptedTurnId,
                    onTurnStarted: undefined,
                    emitInitialEvents: options.emitInitialEvents === false ? false : hasPendingImages,
                    suppressEpicContinuation: true,
                    signal: capability.signal,
                }, capability),
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
        if (!this.#sessionStore) throw new Error("Session storage is unavailable");
        return await rollSessionTranscriptSegment({
            hostedSession,
            ownerCoordinationStore: this.#sessionStore,
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
     * @param {{ cwd: string, mode?: "new" | "continue", resumeSessionId?: string, deferManagedActivationUntilAgentReady?: boolean }} options
     */
    async createInteractiveSession(options) {
        if (!options?.cwd || !isAbsolute(options.cwd)) {
            throw new Error("SessionRuntime.createInteractiveSession requires an absolute cwd");
        }
        const ownerCoordinationStore = this.#sessionStore;
        const deferManagedCreation = Boolean(
            (options.mode || "new") === "new" && options.deferManagedActivationUntilAgentReady,
        );
        if (!ownerCoordinationStore && !deferManagedCreation) {
            throw new Error("Session Manager access is blocked: session_store_unavailable");
        }
        const managedProject = deferManagedCreation ? null : this.#ensureSessionProjectForCwd(options.cwd);
        if (!deferManagedCreation && !managedProject) {
            throw new Error("Session Manager create is blocked: project_identity_unavailable");
        }
        if ((options.mode || "new") === "continue") {
            const classified = await classifyRootSessionLocator({
                cwd: options.cwd,
                ownerCoordinationStore,
            });
            if (classified.kind === "blocked") {
                throw new Error(`Session continue is blocked: ${classified.reason}`);
            }
            let selectedSession = null;
            if (options.resumeSessionId) {
                const cataloged = ownerCoordinationStore?.getSessionById(options.resumeSessionId) || null;
                if (cataloged && cataloged.projectId === managedProject?.projectId) {
                    selectedSession = {
                        id: cataloged.piSessionId,
                        path: cataloged.transcriptPath,
                        cwd: cataloged.transcriptCwd,
                    };
                }
                if (!selectedSession) {
                    const located = await classifyRootSessionLocator({
                        cwd: options.cwd,
                        sessionId: options.resumeSessionId,
                        ownerCoordinationStore,
                    });
                    if (
                        located.kind === "managed" && located.session &&
                        located.session.projectId === managedProject?.projectId
                    ) {
                        selectedSession = {
                            id: located.session.piSessionId,
                            path: located.session.transcriptPath,
                            cwd: located.session.transcriptCwd,
                        };
                    }
                }
            } else {
                const persistedSessions = classified.kind === "managed"
                    ? (await listCatalogSafeRootSessionLocators(options.cwd)).locators.map((locator) => ({
                        id: locator.piSessionId,
                        path: locator.sessionPath,
                        cwd: locator.headerCwd,
                        modified: locator.headerTimestamp || undefined,
                    }))
                    : await listPersistedRootSessions(options.cwd);
                selectedSession = persistedSessions[0] || null;
            }
            if (options.resumeSessionId && !selectedSession) {
                throw new Error(`No saved Session was found with ID ${options.resumeSessionId}.`);
            }
            if (selectedSession?.id && selectedSession?.path) {
                const loaded = await this.loadSession({
                    cwd: options.cwd,
                    sessionId: selectedSession.id,
                    sessionPath: selectedSession.path,
                });
                return {
                    sessionId: loaded.sessionId,
                    cwd: loaded.cwd,
                    sessionManagerId: loaded.sessionManagerId,
                    startedAt: new Date().toISOString(),
                };
            }
        }
        const sessionManager = deferManagedCreation
            ? null
            : await createRootSessionManager(options.mode || "new", options.cwd);
        let managedSession = null;
        let managedCurrentSegmentId = "";
        let managedProof = null;
        if (managedProject && ownerCoordinationStore && !deferManagedCreation) {
            try {
                const piSessionId = sessionManager?.getSessionId?.();
                if (!piSessionId) throw new Error("The Session could not be persisted");
                const transcriptPath = await this.#resolveCreatedSessionPath(options.cwd, sessionManager);
                const acquired = await ownerCoordinationStore.ensureSessionCatalogRecordAndAcquire({
                    locator: {
                        projectId: managedProject.projectId,
                        piSessionId,
                        transcriptPath,
                        transcriptCwd: options.cwd,
                        source: "created",
                    },
                    activation: {
                        ownerInstanceId: this.#ownerInstanceId,
                        ownerProcessKind: this.#ownerProcessKind,
                        phase: "preparing",
                    },
                });
                managedSession = acquired.session;
                const managedSegment = acquired.segment;
                managedProof = acquired.proof;
                recordSegmentLineageEvidence(sessionManager, {
                    segmentId: managedSegment.segmentId,
                    runwieldSessionId: managedSession.runwieldSessionId,
                    parentSegmentId: null,
                    parentPiSessionId: null,
                    lineageGroupKey: managedSegment.segmentId,
                    kind: "planning",
                });
                managedCurrentSegmentId = managedSegment.segmentId;
            } catch (error) {
                if (managedProof) {
                    try {
                        ownerCoordinationStore.releaseUnchangedActivation(managedProof);
                    } catch {
                        // Preserve the creation failure after best-effort lock release.
                    }
                }
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
        if (deferManagedCreation) {
            this.#pendingManagedCreationProjects.set(hostedSession.id, { cwd: options.cwd });
        }
        this.#attachRuntimeEventSink(hostedSession);
        if (managedProof && managedSession) {
            if (!ownerCoordinationStore) throw new Error("Session coordination is unavailable");
            let activeProof = managedProof;
            try {
                activeProof = ownerCoordinationStore.changeSessionActivationPhase(activeProof, "hydrated");
                activeProof = ownerCoordinationStore.changeSessionActivationPhase(activeProof, "checkpointing");
                await syncTranscriptFileAndParent(managedSession.transcriptPath);
                const evidence = await captureTranscriptEvidence({
                    transcriptPath: managedSession.transcriptPath,
                    transcriptCwd: hostedSession.cwd,
                });
                ownerCoordinationStore.publishGenerationAndRelease(activeProof, {
                    generation: 0,
                    byteLength: evidence.byteLength,
                    terminalEntryId: evidence.terminalEntryId,
                    digestHex: evidence.digestHex,
                    currentSegmentId: managedCurrentSegmentId,
                });
                const createdMetadata = hostedSession.getManagedMetadata();
                if (!createdMetadata) throw new Error("Session coordination was interrupted during creation");
                hostedSession.setManagedMetadata({
                    ...createdMetadata,
                    generation: 0,
                    acknowledgedGeneration: 0,
                });
                this.#pendingManagedCreations.delete(hostedSession.id);
                hostedSession.dehydrateManagedSession();
                await this.synchronizeManagedSession(hostedSession.id, { emitEvents: false, replayFromStart: true });
            } catch (error) {
                this.#pendingManagedCreations.delete(hostedSession.id);
                try {
                    ownerCoordinationStore.markSessionUncertain(activeProof, {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                } catch {
                    // Preserve the creation failure.
                }
                hostedSession.dehydrateManagedSession();
                throw error;
            }
        }
        this.#emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.SESSION_CREATED,
            cwd: hostedSession.cwd,
        });
        return {
            sessionId: hostedSession.id,
            cwd: hostedSession.cwd,
            sessionManagerId: sessionManager?.getSessionId?.() || null,
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
        const deferPersistence = options.deferPersistenceUntilFirstMessage === true;
        const created = await this.createInteractiveSession({
            cwd: options.cwd,
            mode: "new",
            deferManagedActivationUntilAgentReady: deferPersistence,
        });
        const hostedSession = this.#sessionHost.getSession(created.sessionId);
        if (!hostedSession) throw new Error("SessionRuntime failed to retain the new session");
        try {
            const activated = deferPersistence
                ? this.markPromptReadyAgent(hostedSession.id, { agentName })
                : await this.switchAgent(hostedSession.id, { agentName });
            if (!activated.ok) throw new Error(activated.error || "The Session could not start");
            return hostedSession.id;
        } catch (error) {
            await this.closeSession(hostedSession.id);
            throw error;
        }
    }

    /**
     * Replace a live Session with one rooted at an execution workflow cwd.
     * UI adapters listen to the runtime replacement event and rebind themselves.
     *
     * @param {string} oldSessionId
     * @param {import('../types.js').ActiveExecutionWorkflow} workflow
     * @returns {Promise<string>}
     */
    async replaceSessionForExecutionFollowUp(oldSessionId, workflow) {
        const oldSession = this.#sessionHost.getSession(oldSessionId);
        if (!oldSession) throw new Error("SessionRuntime.replaceSessionForExecutionFollowUp: old session not found");
        const executionCwd = typeof workflow?.executionCwd === "string" ? workflow.executionCwd : "";
        if (!executionCwd || !isAbsolute(executionCwd)) {
            throw new Error("SessionRuntime.replaceSessionForExecutionFollowUp requires an absolute execution cwd");
        }
        const executionAgent = resolveActiveWorkflowRuntimeAgent(workflow);
        if (!executionAgent) {
            throw new Error("SessionRuntime.replaceSessionForExecutionFollowUp requires an execution Agent");
        }
        const created = await this.createInteractiveSession({
            cwd: executionCwd,
            mode: "new",
            deferManagedActivationUntilAgentReady: true,
        });
        const newSessionId = created.sessionId;
        const newSession = this.#sessionHost.getSession(newSessionId);
        if (!newSession) throw new Error("Execution follow-up replacement session was not retained");
        try {
            newSession.setInteractionAdapter(oldSession.getInteractionAdapter());
            await this.#activateSessionAgent(newSession, { agentName: executionAgent });
            newSession.setActiveExecutionWorkflow(workflow);
            if (workflow.planName) await this.renameSession(newSessionId, workflow.planName);
            this.#emitSessionEvent(oldSession.id, {
                type: RuntimeEventTypes.SESSION_REPLACED,
                oldSessionId: oldSession.id,
                newSessionId,
                reason: "execution_follow_up",
                planName: workflow.planName || "Plan follow-up",
            });
            await this.closeSession(oldSession.id);
            return newSessionId;
        } catch (error) {
            await this.closeSession(newSessionId);
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
        const ownerCoordinationStore = this.#sessionStore;
        if (!ownerCoordinationStore) {
            throw new Error("Session Manager load is blocked: session_store_unavailable");
        }
        const managedProject = this.#ensureSessionProjectForCwd(options.cwd);
        if (!managedProject) throw new Error("Session Manager load is blocked: project_identity_unavailable");
        let sessionPath = options.sessionPath;
        if (!sessionPath) {
            const persisted = await listPersistedRootSessions(options.cwd);
            sessionPath = persisted.find((session) => session.id === options.sessionId)?.path;
        }
        const classified = await classifyRootSessionLocator({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath,
            ownerCoordinationStore,
        });
        if (classified.kind === "blocked") {
            throw new Error(`Session Manager load is blocked: ${classified.reason}`);
        }
        if (classified.kind === "managed") {
            if (classified.session) {
                const managedSession = classified.session;
                let inspected = ownerCoordinationStore.inspectSessionActivation(
                    managedSession.runwieldSessionId,
                );
                if (
                    ["uncertain", "reconcile_required"].includes(inspected.activation?.state || "") ||
                    (!inspected.generation && inspected.activation?.state === "uninitialized")
                ) {
                    await this.ensureInitialSessionGeneration(managedSession.runwieldSessionId);
                    inspected = ownerCoordinationStore.inspectSessionActivation(managedSession.runwieldSessionId);
                }
                if (inspected.generation) {
                    const adopted = this.adoptManagedSession({
                        session: managedSession,
                        generation: inspected.generation.generation,
                    });
                    const sync = await this.synchronizeManagedSession(adopted.sessionId, { emitEvents: false });
                    const replayEvents = sync.ok
                        ? (sync.events || []).map((event) =>
                            createSessionRuntimeEvent(adopted.sessionId, /** @type {any} */ (event))
                        )
                        : [];
                    this.#pendingReplayEvents.set(adopted.sessionId, replayEvents);
                    return {
                        sessionId: adopted.sessionId,
                        cwd: adopted.cwd,
                        replayEvents,
                        sessionManagerId: managedSession.piSessionId,
                        sessionPath: managedSession.transcriptPath,
                    };
                }
            }
        }
        if (classified.kind !== "managed" || !classified.session) {
            throw new Error("Session Manager load is blocked: session_identity_unavailable");
        }
        const managedSession = classified.session;
        const managedSegment = ownerCoordinationStore.getCurrentSessionSegment(managedSession.runwieldSessionId);
        if (!managedSegment) throw new Error("Session Manager load is blocked: session_segment_unavailable");
        const managedProof = ownerCoordinationStore.acquireSessionActivation({
            runwieldSessionId: managedSession.runwieldSessionId,
            projectId: managedSession.projectId,
            ownerInstanceId: this.#ownerInstanceId,
            ownerProcessKind: this.#ownerProcessKind,
            expectedGeneration: null,
            phase: "preparing",
        });
        /** @type {Awaited<ReturnType<typeof openPersistedRootSession>> | null} */
        let opened = null;
        let agentName = "";
        try {
            opened = await openPersistedRootSession({
                cwd: options.cwd,
                sessionId: options.sessionId,
                sessionPath,
            });
            const sessionManager = opened.sessionManager;
            recordSegmentLineageEvidence(sessionManager, {
                segmentId: managedSegment.segmentId,
                runwieldSessionId: managedSession.runwieldSessionId,
                parentSegmentId: managedSegment.lineageParentSegmentId,
                parentPiSessionId: managedSegment.lineageParentPiSessionId,
                lineageGroupKey: managedSegment.lineageGroupKey || managedSegment.segmentId,
                kind: /** @type {'planning' | 'execution' | 'semantic_repair'} */ (managedSegment.kind),
            });
            agentName = await resolveResumeAgentName(sessionManager);
        } catch (error) {
            /** @type {DisposableSessionManager} */ (opened?.sessionManager).dispose?.();
            ownerCoordinationStore.releaseUnchangedActivation(managedProof);
            throw error;
        }
        if (!opened) throw new Error("Session coordination was interrupted during load");
        const { sessionManager, resolved } = opened;
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            sessionManager: /** @type {any} */ (sessionManager),
            cwd: options.cwd,
            managed: {
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
            },
        });
        this.#pendingManagedCreations.set(hostedSession.id, managedProof);
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
            this.#pendingReplayEvents.set(hostedSession.id, replayEvents);
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
        const capability = this.#currentManagedOperations.get(sessionId) || null;
        if (capability) return await requestHostedSessionInteraction(session, request, signal, capability);
        if (this.#pendingManagedCreationProjects.has(sessionId) && !session.getManagedMetadata?.()) {
            return await requestHostedSessionInteraction(session, request, signal, null);
        }
        return await this.#runManagedStandaloneMutation(
            sessionId,
            "workflow_operation",
            (activeSession, operationCapability) =>
                requestHostedSessionInteraction(activeSession, request, signal, operationCapability),
            { activateAgent: false, hydrate: false },
        );
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
            const resolution = currentContinuation.resolution || await resolveEpicContinuation({
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
            const created = await this.createInteractiveSession({
                cwd: currentContinuation.projectRoot,
                mode: "new",
                deferManagedActivationUntilAgentReady: true,
            });
            const newSessionId = created.sessionId;
            const newSession = this.#sessionHost.getSession(newSessionId);
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
            const nextResult = await this.#runManagedOperation(
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
            currentContinuation = nextResult?.epicContinuation || null;
            currentOldSession = newSession;
        }
        return { replaced: Boolean(latestSessionId), sessionId: latestSessionId };
    }

    /**
     * @param {string} sessionId
     * @param {{ agentName: string, model?: string, releaseActiveWorkflow?: boolean, customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[], toolNames?: string[] }} options
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
     * @param {import('./managed-operation.ts').ManagedOperationCapability | null} [capability]
     * @returns {Promise<{ ok: boolean, turns: number, error?: string }>}
     */
    async promptSession(sessionId, options, capability = null) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptSession: session not found");
        if (
            (hostedSession.isTurnActive() || this.#currentManagedOperations.has(sessionId)) &&
            capability !== hostedSession.getManagedOperationCapability?.()
        ) {
            throw new SessionTurnInProgressError(hostedSession.id);
        }
        const managed = hostedSession.getManagedMetadata?.() || null;
        if (!managed) throw new Error("SessionRuntime.promptSession: segmented Session metadata is unavailable");
        if (!capability || capability !== hostedSession.getManagedOperationCapability?.()) {
            const expectedGenerationSource = managed.acknowledgedGeneration ?? managed.generation;
            const expectedGeneration = Number.isSafeInteger(expectedGenerationSource)
                ? /** @type {number} */ (expectedGenerationSource)
                : 0;
            return await this.promptManagedSession(sessionId, { ...options, expectedGeneration });
        }
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
        const request = options.initialRequest;
        let images = options.initialImages || [];
        let turns = 0;
        let ok = false;
        let busyStarted = false;
        /** @type {import('../workflow/validation.ts').WorkflowValidationResult | null} */
        let validationResult = null;
        const managedCapability = /** @type {import('./managed-operation.ts').ManagedOperationCapability | null} */ (
            hostedSession.getManagedOperationCapability?.() || null
        );
        let result =
            /** @type {{ ok: boolean, turns: number, error?: string, replacementSessionId?: string } | null} */ (null);

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
                    error: "missing_active_handler_or_session_manager",
                };
                return result;
            }

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
            validationResult = /** @type {any} */ (turnResult)?.validationResult || null;
            ok = true;
            result = { ok: true, turns };
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
                result: result || { turns },
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
 * Callers may provide the file-backed Session store used by their surface.
 *
 * @param {CreateSessionRuntimeOptions} [options]
 * @returns {SessionRuntime}
 */
export function createSessionRuntime(options = {}) {
    /** @type {ReturnType<typeof openFileSessionStore> | null} */
    let sessionStore;
    let ownsSessionStore = false;
    if (Object.hasOwn(options, "sessionStore")) {
        sessionStore = options.sessionStore ?? null;
    } else {
        sessionStore = openFileSessionStore();
        ownsSessionStore = true;
    }
    return new SessionRuntime({
        sessionHost: new SessionHost(),
        sessionStore,
        ownsSessionStore,
        ownerProcessKind: options.ownerProcessKind ?? "test",
        ownerInstanceId: options.ownerInstanceId ?? crypto.randomUUID(),
    });
}

/**
 * @param {{ activation?: { state?: string | null } | null, generation?: { generation?: number | null } | null, projection?: { ok?: boolean, complete?: boolean, snapshot?: { activeAgent?: string | null, workflowContext?: unknown, activeExecutionWorkflow?: unknown } | null } | null, expectedGeneration?: number | null }} facts
 */
export function deriveManagedSessionContinuationDecision(facts) {
    if (facts.activation?.state !== "idle") {
        return { ok: false, code: "active_owner", message: "This Session is not idle." };
    }
    const generation = facts.generation?.generation ?? null;
    if (generation === null || generation !== facts.expectedGeneration) {
        return { ok: false, code: "stale_generation", message: "Refresh the Session before continuing." };
    }
    if (!facts.projection?.ok || facts.projection.complete === false) {
        return { ok: false, code: "incomplete_projection", message: "The committed timeline is not complete." };
    }
    const snapshot = facts.projection.snapshot || {};
    if (snapshot.activeExecutionWorkflow) {
        return {
            ok: false,
            code: "active_workflow_read_only",
            message: "This Session is running work. It becomes available when that work finishes.",
        };
    }
    return {
        ok: true,
        code: "continue",
        agentName: typeof snapshot.activeAgent === "string" && snapshot.activeAgent
            ? snapshot.activeAgent
            : AGENTS.ROUTER,
        message: "This idle conversational Session can continue.",
    };
}
