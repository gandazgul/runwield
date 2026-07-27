/**
 * @module shared/session/session-runtime
 * Prompt loop boundary for HostedSession-based interactive turns.
 */

import { AGENTS } from "../../constants.js";
import { resolveResumeAgentName } from "./active-agent-session.js";
import { switchActiveAgent } from "./agent-switching.js";
import {
    abortActiveSession as abortActiveSessionFn,
    expandPromptTemplate,
    expandSkillCommand,
    getRootSessionContextProjection,
    listLoadedAgentMdFiles,
    listPromptTemplates,
    listSkills,
    runIsolatedAgentSession,
    steerRootSessionWithTarget,
} from "./session.js";
import { SessionHost } from "./session-host.js";
import {
    createRootSessionManager,
    exportRootSessionToHtml,
    exportRootSessionToJsonl,
    getRootSessionBranchEntries,
    getRunWieldSessionDir,
    getRunWieldSessionMemoryBackupDir,
    isPathInside,
    listPersistedRootSessions,
    openPersistedRootSession,
} from "./root-session.js";
import {
    createSessionRuntimeEvent,
    emitSystemStatus,
    getRuntimeErrorMessage,
    normalizeRuntimeToolResult,
    normalizeRuntimeUsage,
    RuntimeEventTypes,
} from "./session-runtime-events.js";
import { describeRuntimeTool } from "./tool-event-title.js";
import {
    captureTranscriptEvidence,
    createReplayEvents as createProjectedReplayEvents,
    projectCommittedTranscript,
    syncTranscriptFileAndParent,
    toProjectionFailure,
} from "./session-transcript-projection.js";
import { requestHostedSessionInteraction } from "./session-runtime-interactions.js";
import {
    modelSupportsImageInput,
    persistImageAttachment,
    preflightImageAttachments,
    resolveVisionFallbackModel,
} from "./image-attachments.js";
import { getModelRegistry } from "../models/model-registry.js";
import { buildSessionContextReport } from "./session-context-report.js";
import { getSettingsManager } from "../settings.js";
import { getSessionKeyboardHelp } from "./session-help.js";
import { basename, dirname, isAbsolute } from "@std/path";

export const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeOptions
 * @property {SessionHost} [sessionHost]
 * @property {typeof switchActiveAgent} [switchActiveAgent]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 * @property {(mode: import('./root-session.js').RootSessionStartMode, cwd: string) => Promise<any>} [createRootSessionManager]
 * @property {(options: import('./root-session.js').ResolvePersistedRootSessionOptions) => Promise<{ sessionManager: any, resolved: import('./root-session.js').ResolvedPersistedRootSession }>} [openPersistedRootSession]
 * @property {(sessionManager: any) => Promise<string>} [resolveResumeAgentName]
 * @property {typeof steerRootSessionWithTarget} [steerRootSessionWithTarget]
 * @property {import('../owner-coordination/index.js').OwnerCoordinationStore} [ownerCoordinationStore]
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

export class SessionRuntime {
    /** @type {SessionHost} */
    #sessionHost;
    /** @type {typeof switchActiveAgent} */
    #switchActiveAgent;
    /** @type {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} */
    #abortActiveSession;
    /** @type {(mode: import('./root-session.js').RootSessionStartMode, cwd: string) => Promise<any>} */
    #createRootSessionManager;
    /** @type {(options: import('./root-session.js').ResolvePersistedRootSessionOptions) => Promise<{ sessionManager: any, resolved: import('./root-session.js').ResolvedPersistedRootSession }>} */
    #openPersistedRootSession;
    /** @type {(sessionManager: any) => Promise<string>} */
    #resolveResumeAgentName;
    /** @type {typeof steerRootSessionWithTarget} */
    #steerRootSessionWithTarget;
    /** @type {Map<string, Set<SessionRuntimeEventListener>>} */
    #eventListeners;
    /** @type {Map<string, Promise<void>>} */
    #turnSettlements;
    /** @type {Map<string, RuntimeQueuedMessageState[]>} */
    #queuedMessages;
    /** @type {Map<string, QueueSourceSubscription>} */
    #queueSourceSubscriptions;
    /** @type {Map<string, number>} */
    #busyOperationDepths;
    /** @type {Map<string, import('../owner-coordination/session-activations.js').ActivationProof>} */
    #pendingManagedCreations;
    /** @type {Map<string, { projectId: string }>} */
    #pendingManagedCreationProjects;
    /** @type {import('../owner-coordination/index.js').OwnerCoordinationStore | null} */
    #ownerCoordinationStore;
    /** @type {'workspace' | 'tui' | 'acp' | 'test'} */
    #ownerProcessKind;
    /** @type {string} */
    #ownerInstanceId;

    /** @param {SessionRuntimeOptions} [options] */
    constructor(options = {}) {
        this.#sessionHost = options.sessionHost || new SessionHost();
        this.#switchActiveAgent = options.switchActiveAgent || switchActiveAgent;
        this.#abortActiveSession = options.abortActiveSession || abortActiveSessionFn;
        this.#createRootSessionManager = options.createRootSessionManager || createRootSessionManager;
        this.#openPersistedRootSession = options.openPersistedRootSession || openPersistedRootSession;
        this.#resolveResumeAgentName = options.resolveResumeAgentName || resolveResumeAgentName;
        this.#steerRootSessionWithTarget = options.steerRootSessionWithTarget || steerRootSessionWithTarget;
        this.#eventListeners = new Map();
        this.#turnSettlements = new Map();
        this.#queuedMessages = new Map();
        this.#queueSourceSubscriptions = new Map();
        this.#busyOperationDepths = new Map();
        this.#pendingManagedCreations = new Map();
        this.#pendingManagedCreationProjects = new Map();
        this.#ownerCoordinationStore = options.ownerCoordinationStore || null;
        this.#ownerProcessKind = options.ownerProcessKind || "test";
        this.#ownerInstanceId = options.ownerInstanceId || crypto.randomUUID();
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
        const workflowContext = session.getWorkflowContext() || (managedDormant ? managed?.workflowContext : null) ||
            null;
        const activeExecutionWorkflow = session.getActiveExecutionWorkflow();
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
    #rejectManagedPublicMutation(hostedSession, operation) {
        if (!hostedSession?.getManagedMetadata?.()) return null;
        if (hostedSession.getRootSessionManager?.()) return null;
        return { ok: false, error: "managed_unsupported", operation };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {import('@earendil-works/pi-coding-agent').AgentSession} sourceSession
     */
    #ensureQueueSourceSubscription(hostedSession, sourceSession) {
        const current = this.#queueSourceSubscriptions.get(hostedSession.id);
        if (current?.sourceSession === sourceSession) return;
        current?.unsubscribe();
        const unsubscribe = sourceSession.subscribe((event) => {
            if (event.type !== "queue_update") return;
            this.#reconcileQueuedMessages(hostedSession, sourceSession, event.steering);
        });
        this.#queueSourceSubscriptions.set(hostedSession.id, { sourceSession, unsubscribe });
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
        const subscription = this.#queueSourceSubscriptions.get(sessionId);
        if (subscription?.sourceSession !== sourceSession) return;
        subscription.unsubscribe();
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
     * Queue a steering message in the active root AgentSession and publish the
     * resulting core state. Adapters should render QUEUED_MESSAGE_CHANGED rather
     * than subscribing to AgentSession directly.
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
        const rootSession = /** @type {any} */ (hostedSession.getRootAgentSession());
        if (!rootSession?.isStreaming) return { ok: true, queued: false, reason: "not_streaming" };

        this.#ensureQueueSourceSubscription(hostedSession, rootSession);
        const sourceSession = await this.#steerRootSessionWithTarget(hostedSession, text, images);
        if (!sourceSession) {
            this.#removeQueueSourceSubscription(hostedSession.id, rootSession);
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
     * @returns {SteerSessionResult}
     */
    queueNextTurnMessage(sessionId, text, images = []) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(hostedSession, "queueNextTurnMessage");
        if (managedRejection) return { ...managedRejection, queued: false };
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
                const requeued = await this.#steerRootSessionWithTarget(hostedSession, message.text, message.images);
                if (!requeued) throw new Error("root session stopped streaming while restoring its queue");
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
    clearQueuedMessages(sessionId, reason = "cleared") {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, cleared: 0, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(hostedSession, "clearQueuedMessages");
        if (managedRejection) return { ...managedRejection, cleared: 0 };
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
     * @param {string} sessionId
     * @param {string} name
     */
    renameSession(sessionId, name) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(session, "renameSession");
        if (managedRejection) return managedRejection;
        const normalizedName = String(name || "").trim();
        if (!normalizedName) return { ok: false, error: "invalid_name" };
        session.getRootSessionManager()?.appendSessionInfo?.(normalizedName);
        this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.SESSION_RENAMED, name: normalizedName });
        return { ok: true, name: normalizedName };
    }

    /**
     * @param {string} sessionId
     * @param {string} model
     * @param {string} [provider]
     * @param {boolean} [userOverride]
     */
    setSessionModel(sessionId, model, provider = "", userOverride = true) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        if (session.getManagedMetadata?.() && !session.getRootSessionManager()) {
            session.mergePendingManagedTurnIntent?.({ model, provider });
            session.setActiveModelState(model, provider, userOverride);
            this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
            return { ok: true, model, provider };
        }
        const managedRejection = this.#rejectManagedPublicMutation(session, "setSessionModel");
        if (managedRejection) return managedRejection;
        session.setActiveModelState(model, provider, userOverride);
        this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
        return { ok: true, model, provider };
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
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        if (session.getManagedMetadata?.() && !session.getRootSessionManager()) {
            session.mergePendingManagedTurnIntent?.({ model, provider });
            session.setActiveModelState(model, provider, true);
            this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
            return { ok: true, model, provider };
        }
        const managedRejection = this.#rejectManagedPublicMutation(session, "reconfigureSessionModel");
        if (managedRejection) return managedRejection;
        session.setActiveModelState(model, provider, true);
        const agentName = session.getRootAgentName();
        if (agentName) {
            await this.#activateSessionAgent(session, {
                agentName,
                model: provider ? `${provider}/${model}` : model,
                forceRebuild: true,
            });
        }
        this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.MODEL_CHANGED, model, provider });
        return { ok: true, model, provider };
    }

    /** @param {string} sessionId @param {string} context */
    setProjectStateContext(sessionId, context) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setProjectStateContext(context);
        return { ok: true };
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
     *   agentDef?: any,
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
        if (managedRejection) throw new Error(managedRejection.error);
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
                _agentDefOverride: options.agentDef,
            }));
    }

    /** @param {string} sessionId @param {Record<string, any>} workflow */
    setActiveExecutionWorkflow(sessionId, workflow) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(session, "setActiveExecutionWorkflow");
        if (managedRejection) return managedRejection;
        session.setActiveExecutionWorkflow(/** @type {any} */ (workflow));
        return { ok: true };
    }

    /** @param {string} sessionId */
    clearActiveExecutionWorkflow(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const managedRejection = this.#rejectManagedPublicMutation(session, "clearActiveExecutionWorkflow");
        if (managedRejection) return managedRejection;
        session.clearActiveExecutionWorkflow();
        return { ok: true };
    }

    /**
     * @template T
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {string} operationName
     * @param {Record<string, any>} options
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    async #runWorkflowOperation(session, operationName, options, operation) {
        const managed = session.getManagedMetadata?.();
        if (!managed || session.getRootSessionManager?.()) {
            return await this.#runBusyOperation(session.id, operation);
        }
        if (!this.#ownerCoordinationStore) throw new Error("managed_unsupported");
        this.#ownerCoordinationStore.requireActivationProtocolEnabled();
        const state = this.#ownerCoordinationStore.inspectSessionActivation(managed.runwieldSessionId);
        const expectedGeneration = managed.generation;
        const latestGeneration = state.generation?.generation ?? null;
        if (latestGeneration !== expectedGeneration) throw new Error("refresh_required");
        let activeProof = this.#ownerCoordinationStore.acquireSessionActivation({
            runwieldSessionId: managed.runwieldSessionId,
            projectId: managed.projectId,
            ownerInstanceId: this.#ownerInstanceId,
            ownerProcessKind: this.#ownerProcessKind,
            expectedGeneration,
            phase: "preparing",
        });
        let hydrated = false;
        /** @type {ReturnType<typeof setInterval> | null} */
        let heartbeatTimer = null;
        this.#beginBusyOperation(session.id);
        const heartbeat = () => {
            try {
                this.#ownerCoordinationStore?.heartbeatSessionActivation(activeProof);
            } catch {
                // The next fenced phase or publication will fail closed.
            }
        };
        heartbeatTimer = setInterval(heartbeat, 10_000);
        try {
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "hydrated");
            hydrated = true;
            const { sessionManager } = await this.#openPersistedRootSession({
                cwd: session.cwd,
                sessionId: managed.piSessionId,
                sessionPath: managed.transcriptPath,
            });
            session.setRootSessionManager(sessionManager);
            const pendingIntent = session.getPendingManagedTurnIntent?.() || {};
            if (pendingIntent.model || pendingIntent.provider) {
                session.setActiveModelState(pendingIntent.model || "", pendingIntent.provider || "", true);
            }
            if (pendingIntent.thinkingLevel) session.setThinkingLevel(pendingIntent.thinkingLevel);
            const persistedAgentName = await this.#resolveResumeAgentName(sessionManager);
            const agentName = options.agentName || pendingIntent.agentName || persistedAgentName;
            const pendingModel = pendingIntent.model || pendingIntent.provider
                ? pendingIntent.provider && pendingIntent.model
                    ? `${pendingIntent.provider}/${pendingIntent.model}`
                    : pendingIntent.model || undefined
                : undefined;
            await this.#activateSessionAgent(session, {
                agentName,
                model: pendingModel,
                toolNames: options.toolNames,
                customTools: options.customTools,
                allowReturnToRouter: options.allowReturnToRouter,
                includeEditFallback: options.includeEditFallback,
            });
            session.consumePendingManagedTurnIntent?.();
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "turning");
            const result = await operation();
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "checkpointing");
            const nextManaged = {
                ...managed,
                activeAgent: session.getRootAgentName?.() || agentName || null,
                workflowContext: session.getWorkflowContext?.() || managed.workflowContext || null,
            };
            session.dehydrateManagedSession();
            await syncTranscriptFileAndParent(managed.transcriptPath);
            const evidence = await captureTranscriptEvidence({
                transcriptPath: managed.transcriptPath,
                transcriptCwd: session.cwd,
            });
            const nextGeneration = (expectedGeneration ?? -1) + 1;
            this.#ownerCoordinationStore.publishGenerationAndRelease(activeProof, {
                generation: nextGeneration,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
            });
            session.setManagedMetadata({
                ...nextManaged,
                generation: nextGeneration,
                acknowledgedGeneration: nextGeneration,
            });
            await this.synchronizeManagedSession(session.id, { emitEvents: false });
            return result;
        } catch (error) {
            session.dehydrateManagedSession();
            if (!hydrated) {
                try {
                    this.#ownerCoordinationStore.releaseUnchangedActivation(activeProof);
                } catch {
                    this.#ownerCoordinationStore.markSessionUncertain(activeProof, {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            } else {
                const reason = error instanceof Error ? error.message : String(error);
                this.#ownerCoordinationStore.markSessionUncertain(activeProof, {
                    reason: `${operationName}: ${reason}`,
                });
            }
            throw error;
        } finally {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            this.#endBusyOperation(session.id);
        }
    }

    /** @param {string} sessionId @param {Record<string, any>} options */
    async executePlan(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.executePlan: session not found");
        return await this.#runWorkflowOperation(session, "executePlan", options, async () => {
            const { executePlan } = await import("../workflow/workflow.js");
            return await executePlan(/** @type {any} */ ({ ...options, hostedSession: session }));
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
            const { runSlicerAgent } = await import("../workflow/workflow-slicer.js");
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
    async runValidation(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runValidation: session not found");
        const result = await this.#runWorkflowOperation(session, "runValidation", options, async () => {
            const { runValidationLoop } = await import("../workflow/validation.js");
            return await runValidationLoop(/** @type {any} */ ({ ...options, hostedSession: session }));
        });
        await this.#continueEpicAfterValidation(session, /** @type {any} */ (result));
        return result;
    }

    /** @param {string} sessionId @param {boolean} enabled */
    async setSessionAutoCompaction(sessionId, enabled) {
        const session = this.#sessionHost.getSession(sessionId);
        const managedRejection = this.#rejectManagedPublicMutation(session, "setSessionAutoCompaction");
        if (managedRejection) return managedRejection;
        const rootAgentSession = /** @type {any} */ (session?.getRootAgentSession());
        if (!rootAgentSession?.setAutoCompactionEnabled) return { ok: false, error: "unsupported" };
        rootAgentSession.setAutoCompactionEnabled(enabled);
        await rootAgentSession.settingsManager?.flush?.();
        return { ok: true, enabled };
    }

    /** @param {string} sessionId */
    replaySession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, replayed: 0, error: "not_found" };
        const manager = session.getRootSessionManager();
        const events = createProjectedReplayEvents(sessionId, manager ? getRootSessionBranchEntries(manager) : []);
        for (const event of events) this.#emitSessionEvent(sessionId, /** @type {any} */ (event));
        return { ok: true, replayed: events.length };
    }

    /**
     * @param {string} sessionId
     * @param {import('./types.js').ImageAttachment} image
     */
    async persistSessionImage(sessionId, image) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.persistSessionImage: session not found");
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
            fallbackModelRef = (await resolveVisionFallbackModel(modelRegistry))?.modelRef;
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

    /** @param {string} sessionId */
    cycleSessionThinkingLevel(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        const levels = /** @type {const} */ (["off", "minimal", "low", "medium", "high", "xhigh"]);
        const managed = session.getManagedMetadata?.() || null;
        const managedDormant = Boolean(managed && !session.getRootSessionManager?.());
        const currentLevel = managedDormant && managed?.thinkingLevel
            ? managed.thinkingLevel
            : session.getThinkingLevel();
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
        if (session.getManagedMetadata?.() && !session.getRootSessionManager()) {
            session.mergePendingManagedTurnIntent?.({ thinkingLevel: next });
        }
        this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.THINKING_LEVEL_CHANGED, thinkingLevel: next });
        return { ok: true, thinkingLevel: next };
    }

    /**
     * Execute a consumer-requested local shell command as one Runtime-owned
     * tool lifecycle. The consumer never publishes presentation events.
     *
     * @param {string} sessionId
     * @param {{ command: string, userRequest?: string, persist?: boolean }} options
     */
    async runLocalShellCommand(sessionId, options) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, exitCode: 1, output: "", error: "not_found" };
        const command = String(options?.command || "").trim();
        if (!command) return { ok: false, exitCode: 1, output: "", error: "empty_command" };

        const persist = options.persist !== false && !session.isTurnActive();
        const userRequest = options.userRequest || `!${command}`;
        const toolCallId = `bash-${crypto.randomUUID()}`;
        const startedAt = Date.now();
        const runtimeTool = describeRuntimeTool("bash", { command });
        const interactionId = `local-shell:${toolCallId}`;
        const abortController = new AbortController();
        /** @type {Deno.ChildProcess | null} */
        let child = null;
        let canceled = false;
        let output = "";
        let exitCode = 1;

        const abort = () => {
            canceled = true;
            try {
                child?.kill();
            } catch {
                // The process may have exited between cancellation and kill.
            }
        };
        abortController.signal.addEventListener("abort", abort, { once: true });
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
            const executable = Deno.build.os === "windows" ? "cmd" : "sh";
            const commandFlag = Deno.build.os === "windows" ? "/c" : "-c";
            child = new Deno.Command(executable, {
                args: [commandFlag, command],
                cwd: session.cwd,
                stdout: "piped",
                stderr: "piped",
            }).spawn();

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

            const [status] = await Promise.all([
                child.status,
                readStream(child.stdout),
                readStream(child.stderr),
            ]);
            exitCode = canceled ? 130 : status.success ? 0 : status.code || 1;
        } catch (error) {
            if (!canceled) {
                output += `Error starting process: ${error instanceof Error ? error.message : String(error)}\n`;
            }
            exitCode = canceled ? 130 : 1;
        } finally {
            abortController.signal.removeEventListener("abort", abort);
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
                isError: exitCode !== 0,
            });
        }

        return { ok: !canceled && exitCode === 0, exitCode, output, canceled, toolCallId };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} session
     * @param {{ userRequest: string, toolCallId: string, command: string, output: string, isError: boolean }} exchange
     */
    #recordLocalToolExchange(session, exchange) {
        const manager = /** @type {any} */ (session.getRootSessionManager());
        if (!manager?.addMessage) return { ok: false, error: "not_found" };
        manager.addMessage({ role: "user", content: [{ type: "text", text: exchange.userRequest }] });
        manager.addMessage({
            role: "assistant",
            content: [{
                type: "tool_use",
                id: exchange.toolCallId,
                name: "bash",
                input: { command: exchange.command },
            }],
        });
        manager.addMessage({
            role: "user",
            content: [{
                type: "tool_result",
                tool_use_id: exchange.toolCallId,
                is_error: exchange.isError,
                content: exchange.output,
            }],
        });
        return { ok: true };
    }

    /** @param {string} sessionId @param {string} [instructions] */
    async compactSession(sessionId, instructions = undefined) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.compactSession: session not found");
        const managedRejection = this.#rejectManagedPublicMutation(session, "compactSession");
        if (managedRejection) throw new Error(managedRejection.error);
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        if (!rootAgentSession?.compact) throw new Error("Runtime session cannot be compacted.");
        return await this.#runBusyOperation(session.id, () => rootAgentSession.compact(instructions));
    }

    /** @param {string} sessionId */
    async reloadSession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        if (session.getManagedMetadata?.() && !session.getRootSessionManager()) {
            await getSettingsManager(session.cwd).reload();
            return { ok: true, deferred: true };
        }
        const agentName = session.getRootAgentName();
        if (!agentName) return { ok: false };
        await getSettingsManager(session.cwd).reload();
        await this.#activateSessionAgent(session, { agentName, forceRebuild: true });
        return { ok: true };
    }

    /** @param {string} sessionId */
    getLastAssistantText(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
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

    /** @param {string} sessionId */
    getSessionInfo(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
        const manager = /** @type {any} */ (session.getRootSessionManager());
        const entries = manager?.getEntries?.() || [];
        const info = {
            name: manager?.getSessionName?.() || "",
            file: manager?.getSessionFile?.() || "In-memory",
            persistedId: manager?.getSessionId?.() || sessionId,
            compactionCount: 0,
            userMessages: 0,
            assistantMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            compactionSettings: null,
            contextUsage: null,
        };
        for (const entry of entries) {
            if (entry?.type === "compaction") info.compactionCount++;
            if (entry?.type !== "message" || !entry.message) continue;
            const message = entry.message;
            if (message.role === "user") {
                info.userMessages++;
                info.toolResults += Array.isArray(message.content)
                    ? message.content.filter((/** @type {any} */ block) => block?.type === "tool_result").length
                    : 0;
            }
            if (message.role === "assistant") {
                info.assistantMessages++;
                info.toolCalls += Array.isArray(message.content)
                    ? message.content.filter((/** @type {any} */ block) => block?.type === "tool_use").length
                    : 0;
                const usage = normalizeRuntimeUsage(message.usage);
                info.inputTokens += usage.inputTokens;
                info.outputTokens += usage.outputTokens;
                info.cacheReadTokens += usage.cacheReadTokens;
                info.cacheWriteTokens += usage.cacheWriteTokens;
            }
        }
        const rootAgentSession = /** @type {any} */ (session.getRootAgentSession());
        info.compactionSettings = rootAgentSession?.settingsManager?.getCompactionSettings?.() || null;
        info.contextUsage = rootAgentSession?.getContextUsage?.() || null;
        return info;
    }

    /** @param {string} sessionId */
    getSessionContextReport(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return null;
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
        const manager = session?.getRootSessionManager();
        const persistedId = manager?.getSessionId?.();
        if (!session || !persistedId) throw new Error("Runtime session has no persisted session id.");
        return getRunWieldSessionMemoryBackupDir(session.cwd, persistedId);
    }

    /** @param {string} cwd */
    async listResumableSessions(cwd) {
        if (!cwd || !isAbsolute(cwd)) {
            throw new Error("SessionRuntime.listResumableSessions requires an absolute cwd");
        }
        return await listPersistedRootSessions(cwd);
    }

    /**
     * Inspect the model context of a persisted session without exposing its
     * SessionManager to the consumer.
     *
     * @param {{ cwd: string, sessionId: string, sessionPath?: string }} options
     */
    async inspectResumableSession(options) {
        const { estimateTokens } = await import("@earendil-works/pi-coding-agent");
        const { sessionManager } = await this.#openPersistedRootSession(options);
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
            sessionManager.dispose?.();
        }
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
        const manager = /** @type {any} */ (session?.getRootSessionManager());
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
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, error: "not_found" };
        session.setThinkingLevel(thinkingLevel);
        if (session.getManagedMetadata?.() && !session.getRootSessionManager()) {
            session.mergePendingManagedTurnIntent?.({ thinkingLevel });
        }
        this.#emitSessionEvent(session.id, { type: RuntimeEventTypes.THINKING_LEVEL_CHANGED, thinkingLevel });
        return { ok: true, thinkingLevel };
    }

    /** @param {string} id */
    closeSession(id) {
        const hostedSession = this.#sessionHost.getSession(id);
        if (hostedSession) this.clearQueuedMessages(hostedSession.id, "session_closed");
        const closed = this.#sessionHost.disposeSession(id);
        if (closed) {
            this.#emitSessionEvent(id, { type: RuntimeEventTypes.SESSION_CLOSED });
            this.#eventListeners.delete(id);
            const queueSubscription = this.#queueSourceSubscriptions.get(id);
            queueSubscription?.unsubscribe();
            this.#queueSourceSubscriptions.delete(id);
            this.#queuedMessages.delete(id);
            this.#busyOperationDepths.delete(id);
            this.#pendingManagedCreations.delete(id);
            this.#pendingManagedCreationProjects.delete(id);
        }
        return { ok: true, closed };
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
        return this.closeSession(session.id);
    }

    closeAllSessions() {
        const sessions = this.listSessions();
        for (const session of sessions) {
            try {
                const hostedSession = this.#sessionHost.getSession(session.id);
                if (hostedSession) this.cancelSession(hostedSession.id);
            } catch {
                // Shutdown cleanup is best effort.
            }
            this.closeSession(session.id);
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
                    sessionManager = await this.#createRootSessionManager("new", hostedSession.cwd);
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
        if (!pendingCreation) return await this.#switchActiveAgent(hostedSession, options);
        if (!this.#ownerCoordinationStore) throw new Error("Managed Session requires an owner coordination store");
        let activeProof = pendingCreation;
        let hydrated = false;
        try {
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "hydrated");
            hydrated = true;
            const result = await this.#switchActiveAgent(hostedSession, options);
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "checkpointing");
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
        const piSessionId = sessionManager.getSessionId?.();
        if (!piSessionId) throw new Error("Created managed Session has no Pi session id");
        const sessions = await listPersistedRootSessions(cwd);
        const match = sessions.find((session) => session.id === piSessionId);
        if (match?.path) return match.path;
        const transcriptPath = sessionManager.getSessionFile?.();
        const sessionDir = getRunWieldSessionDir(cwd);
        if (
            !transcriptPath || typeof transcriptPath !== "string" || !isAbsolute(transcriptPath) ||
            !isPathInside(transcriptPath, sessionDir) || !basename(transcriptPath).includes(piSessionId)
        ) {
            throw new Error(`Created Session transcript was not found: ${piSessionId}`);
        }
        await this.#ensureCreatedSessionTranscriptFile(sessionManager, transcriptPath);
        return transcriptPath;
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
                projected = await projectCommittedTranscript({
                    cwd: hostedSession.cwd,
                    sessionDir: dirname(managed.transcriptPath),
                    sessionPath: managed.transcriptPath,
                    runtimeSessionId: sessionId,
                    generation: activationState.generation.generation,
                    byteLength: activationState.generation.byteLength,
                    terminalEntryId: activationState.generation.terminalEntryId,
                    digestHex: activationState.generation.digestHex,
                    cursorEventId,
                    cursorEventOrdinal,
                    limit: options.limit,
                });
                events.push(...(projected.events || []));
                cursorEventId = projected.nextCursor || cursorEventId;
                cursorEventOrdinal = Number.isInteger(projected.nextCursorOrdinal)
                    ? projected.nextCursorOrdinal
                    : cursorEventOrdinal;
            } while (!projected.complete);
            const summary = projected.snapshot || {};
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
            if (emitEvents) {
                for (const event of events) this.#emitSessionEvent(sessionId, /** @type {any} */ (event));
                if (summary.name) {
                    this.#emitSessionEvent(sessionId, { type: RuntimeEventTypes.SESSION_RENAMED, name: summary.name });
                }
                if (summary.attention) {
                    this.#emitSessionEvent(sessionId, {
                        type: RuntimeEventTypes.ATTENTION_REQUESTED,
                        eventId: summary.attention.eventId,
                        reason: summary.attention.reason || "agentStopped",
                        agentName: summary.attention.agentName || undefined,
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
     * @param {PromptSessionOptions & { expectedGeneration: number }} options
     */
    async promptManagedSession(sessionId, options) {
        const hostedSession = this.#sessionHost.getSession(sessionId);
        if (!hostedSession) throw new Error("SessionRuntime.promptManagedSession: session not found");
        const managed = hostedSession.getManagedMetadata?.();
        if (!managed) return await this.promptSession(sessionId, options);
        if (!this.#ownerCoordinationStore) throw new Error("Managed Session requires an owner coordination store");
        this.#ownerCoordinationStore.requireActivationProtocolEnabled();
        const state = this.#ownerCoordinationStore.inspectSessionActivation(managed.runwieldSessionId);
        const latestGeneration = state.generation?.generation ?? null;
        if (latestGeneration !== options.expectedGeneration) {
            return { ok: false, turns: 0, handoffs: 0, handoffLimitReached: false, error: "refresh_required" };
        }
        const proof = this.#ownerCoordinationStore.acquireSessionActivation({
            runwieldSessionId: managed.runwieldSessionId,
            projectId: managed.projectId,
            ownerInstanceId: this.#ownerInstanceId,
            ownerProcessKind: this.#ownerProcessKind,
            expectedGeneration: options.expectedGeneration,
            phase: "preparing",
        });
        let activeProof = proof;
        let hydrated = false;
        /** @type {ReturnType<typeof setInterval> | null} */
        let heartbeatTimer = null;
        this.#beginBusyOperation(sessionId);
        const heartbeat = () => {
            try {
                this.#ownerCoordinationStore?.heartbeatSessionActivation(activeProof);
            } catch {
                // The next fenced phase/publish operation will fail closed and mark uncertainty.
            }
        };
        heartbeatTimer = setInterval(heartbeat, 10_000);
        try {
            const pendingIntent = hostedSession.getPendingManagedTurnIntent?.() || {};
            if (state.generation) {
                const currentEvidence = await captureTranscriptEvidence({
                    transcriptPath: managed.transcriptPath,
                    transcriptCwd: hostedSession.cwd,
                    byteLength: state.generation.byteLength,
                });
                const stat = await Deno.stat(managed.transcriptPath);
                if (
                    stat.size !== state.generation.byteLength ||
                    currentEvidence.digestHex !== state.generation.digestHex ||
                    currentEvidence.terminalEntryId !== state.generation.terminalEntryId
                ) {
                    this.#ownerCoordinationStore.markSessionReconcileRequired({
                        runwieldSessionId: managed.runwieldSessionId,
                        projectId: managed.projectId,
                    }, { reason: "transcript_ahead_or_mismatch" });
                    return {
                        ok: false,
                        turns: 0,
                        handoffs: 0,
                        handoffLimitReached: false,
                        error: "reconcile_required",
                    };
                }
            }
            const acceptedTurnId = options.turnId || crypto.randomUUID();
            const hasPendingImages = (options.initialImages || []).some((image) => !image.path && !image.ref);
            if (!hasPendingImages) {
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
            hydrated = true;
            const { sessionManager } = await this.#openPersistedRootSession({
                cwd: hostedSession.cwd,
                sessionId: managed.piSessionId,
                sessionPath: managed.transcriptPath,
            });
            hostedSession.setRootSessionManager(sessionManager);
            if (pendingIntent.model || pendingIntent.provider) {
                hostedSession.setActiveModelState(pendingIntent.model || "", pendingIntent.provider || "", true);
            }
            if (pendingIntent.thinkingLevel) hostedSession.setThinkingLevel(pendingIntent.thinkingLevel);
            const agentName = options.agentName || pendingIntent.agentName ||
                await this.#resolveResumeAgentName(sessionManager);
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
            });
            hostedSession.consumePendingManagedTurnIntent?.();
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "turning");
            const result = await this.promptSession(sessionId, {
                ...options,
                turnId: acceptedTurnId,
                emitInitialEvents: hasPendingImages,
            });
            activeProof = this.#ownerCoordinationStore.changeSessionActivationPhase(activeProof, "checkpointing");
            hostedSession.dehydrateManagedSession();
            await syncTranscriptFileAndParent(managed.transcriptPath);
            const evidence = await captureTranscriptEvidence({
                transcriptPath: managed.transcriptPath,
                transcriptCwd: hostedSession.cwd,
            });
            this.#ownerCoordinationStore.publishGenerationAndRelease(activeProof, {
                generation: options.expectedGeneration + 1,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
            });
            hostedSession.setManagedMetadata({ ...managed, generation: options.expectedGeneration + 1 });
            await this.synchronizeManagedSession(sessionId, { emitEvents: false });
            return result;
        } catch (error) {
            hostedSession.dehydrateManagedSession();
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
            this.#endBusyOperation(sessionId);
        }
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
        if (this.#ownerCoordinationStore && (options.mode || "new") === "continue") {
            const persistedSessions = await listPersistedRootSessions(options.cwd);
            const latestSession = persistedSessions[0] || null;
            if (latestSession?.id && latestSession?.path) {
                const loaded = await this.loadSession({
                    cwd: options.cwd,
                    sessionId: latestSession.id,
                    sessionPath: latestSession.path,
                });
                return {
                    sessionId: loaded.sessionId,
                    cwd: loaded.cwd,
                    sessionManagerId: loaded.sessionManagerId,
                    startedAt: new Date().toISOString(),
                };
            }
        }
        const managedProject = this.#shouldUseManagedActivation(options) && (options.mode || "new") === "new"
            ? this.#findEnabledManagedProjectForCwd(options.cwd)
            : null;
        const ownerCoordinationStore = this.#ownerCoordinationStore;
        if (managedProject) ownerCoordinationStore?.requireActivationProtocolEnabled();
        const deferManagedCreation = Boolean(
            managedProject && ownerCoordinationStore && options.deferManagedActivationUntilAgentReady,
        );
        const sessionManager = deferManagedCreation
            ? null
            : await this.#createRootSessionManager(options.mode || "new", options.cwd);
        let managedSession = null;
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
                managedProof = ownerCoordinationStore.acquireSessionActivation({
                    runwieldSessionId: managedSession.runwieldSessionId,
                    projectId: managedSession.projectId,
                    ownerInstanceId: this.#ownerInstanceId,
                    ownerProcessKind: this.#ownerProcessKind,
                    expectedGeneration: null,
                    phase: "preparing",
                });
            } catch (error) {
                sessionManager?.dispose?.();
                throw error;
            }
        }
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            sessionManager,
            cwd: options.cwd,
            managed: managedSession
                ? {
                    runwieldSessionId: managedSession.runwieldSessionId,
                    projectId: managedSession.projectId,
                    piSessionId: managedSession.piSessionId,
                    transcriptPath: managedSession.transcriptPath,
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
            this.closeSession(hostedSession.id);
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
        if (this.#ownerCoordinationStore && this.#shouldUseManagedActivation(options) && options.sessionPath) {
            const managedSession = this.#ownerCoordinationStore.findSessionByLocator({
                transcriptPath: options.sessionPath,
            });
            if (managedSession) {
                this.#ownerCoordinationStore.requireActivationProtocolEnabled();
                const inspected = this.#ownerCoordinationStore.inspectSessionActivation(
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
                    sessionManagerId: managedSession.piSessionId,
                    sessionPath: managedSession.transcriptPath,
                };
            }
        }
        const { sessionManager, resolved } = await this.#openPersistedRootSession({
            cwd: options.cwd,
            sessionId: options.sessionId,
            sessionPath: options.sessionPath,
        });
        const agentName = await this.#resolveResumeAgentName(sessionManager);
        const hostedSession = this.#sessionHost.createSession({
            id: crypto.randomUUID(),
            sessionManager,
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
            this.closeSession(hostedSession.id);
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
        return await requestHostedSessionInteraction(session, request, signal);
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} oldSession
     * @param {import('../workflow/validation.js').WorkflowValidationResult | undefined | null} validationResult
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
                "../workflow/epic-continuation.js"
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
            const newSessionId = await this.createPromptReadySession({
                cwd: currentContinuation.projectRoot,
                agentName: action === "plan" ? AGENTS.PLANNER : AGENTS.ENGINEER,
            });
            const newSession = this.#sessionHost.getSession(newSessionId);
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
            this.closeSession(currentOldSession.id);
            latestSessionId = newSessionId;
            const nextResult = await this.#runBusyOperation(newSessionId, () =>
                runEpicChildContinuation({
                    hostedSession: newSession,
                    resolution,
                    sessionManager: /** @type {any} */ (newSession.getRootSessionManager() || undefined),
                }));
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
        if (session.getManagedMetadata?.() && !session.getRootSessionManager()) {
            session.mergePendingManagedTurnIntent?.({ agentName: options.agentName });
            this.#emitSessionEvent(session.id, {
                type: RuntimeEventTypes.AGENT_CHANGED,
                agentName: options.agentName,
                model: options.model,
            });
            return { ok: true, agentName: options.agentName, model: options.model, changed: true };
        }
        return await this.#activateSessionAgent(session, options);
    }

    /** @param {string} sessionId */
    cancelSession(sessionId) {
        const session = this.#sessionHost.getSession(sessionId);
        if (!session) return { ok: false, aborted: false, error: "not_found" };
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
            this.clearQueuedMessages(session.id, "session_cancel");
            agentCanceled = this.#abortActiveSession(session);
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
        /** @type {import('../workflow/validation.js').WorkflowValidationResult | null} */
        let validationResult = null;
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
            if (ok && validationResult?.epicContinuation && result) {
                const replacement = await this.#continueEpicAfterValidation(hostedSession, validationResult);
                if (replacement.sessionId) result.replacementSessionId = replacement.sessionId;
            }
        }
    }
}
