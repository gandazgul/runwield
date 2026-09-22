import { validateSequenceReviewDecision } from "../../../shared/workflow/sequence-review.ts";
/* @module ui/workspace/server/session-continuation */

import { mergePlanAssociations } from "../../../shared/session/plan-association.ts";
import { appendLiveSessionEvent } from "../../../shared/session/live-session-events.ts";
import {
    projectLiveSessionInfo,
    readLiveSessionConnection,
    subscribeLiveSessionAttention,
} from "../../../shared/session/live-session-connection.ts";
import { createHash } from "node:crypto";
import { findPlanEvidenceById } from "../../../plan-store.js";
import { getMergedCustomSetting, getSettingsManager } from "../../../shared/settings.js";
import {
    applyUserAgentSelection,
    applyUserModelSelection,
    getDefaultUserAgentOption,
    listUserAgentOptions,
    listUserModelOptions,
    requireUserAgentOption,
    requireUserModelOption,
} from "../../../shared/session/user-selection.ts";
import { normalizeBrowserNotificationPolicy } from "../../../shared/session/notification-content.ts";
import { applySharedPlanReviewDecision } from "../../../shared/workflow/plan-review-actions.ts";
import { getWorktreeReviewDiff, WorktreeReviewTargetError } from "../../../shared/workflow/git-snapshot.js";
import {
    createSessionRuntime,
    deriveManagedSessionContinuationDecision,
    listPromptTemplates,
    listSkills,
} from "../../../shared/session/session-runtime.js";
import { getRunWieldSessionDir } from "../../../shared/session/root-session.js";
import { projectAggregateTranscript } from "../../../shared/session/session-transcript-manifest.ts";
import {
    captureTranscriptEvidence,
    getCommittedTranscriptAuthorityFacts,
    summarizeProjectedEntries,
    summarizeResumableTranscript,
    validateExpiredControlTranscriptEvidence,
} from "../../../shared/session/session-transcript-projection.js";
import { requireOwnerProjectRoot, sessionBelongsToOwnerProject } from "./owner-projects.js";

/** @typedef {"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"} WorkspaceThinkingLevel */
/** @typedef {{ name: string, firstMessage: string }} SessionListInfo */
/** @typedef {{ page?: number, pageSize?: number, includeEmpty?: boolean, includeTotal?: boolean }} SessionListOptions */
/** @typedef {{ operationId: string, status: string, runwieldSessionId: string | null, generation: number | null }} CreateSessionResult */
/** @typedef {{ requestHash: string, settled: Promise<void> }} PendingCreateRequest */
/** @typedef {(value?: void | PromiseLike<void>) => void} VoidResolver */
/** @typedef {{ size: number, mtime: number | undefined, ctime: number | undefined, info: SessionListInfo }} SessionListInfoCacheEntry */
/** @type {Map<string, SessionListInfoCacheEntry>} */
const sessionListInfoCache = new Map();

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
        sequenceDocuments: Array.isArray(meta.sequenceDocuments) ? meta.sequenceDocuments : undefined,
        agentLabel: typeof meta.agentLabel === "string" && meta.agentLabel.trim() ? meta.agentLabel.trim() : "Planner",
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

/** @param {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} request */
function safeCodeReviewReference(request) {
    const meta = request._meta && typeof request._meta === "object" ? request._meta : {};
    const rawPatch = typeof meta.diffText === "string" ? meta.diffText : "";
    const planName = typeof meta.planName === "string" && meta.planName.trim()
        ? meta.planName.trim()
        : "Workspace changes";
    const planTitle = typeof meta.planTitle === "string" && meta.planTitle.trim() ? meta.planTitle.trim() : planName;
    return {
        rawPatch,
        gitRef: `RunWield workflow diff: ${planName}`,
        planName,
        planTitle,
        agentLabel: typeof meta.agentLabel === "string" && meta.agentLabel.trim()
            ? meta.agentLabel.trim()
            : "Reviewer Feedback Engineer",
    };
}

/** @param {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} request */
function safeArtifactReviewReference(request) {
    const meta = request._meta && typeof request._meta === "object" ? request._meta : {};
    const artifactId = typeof meta.artifactId === "string" ? meta.artifactId.trim() : "";
    if (!artifactId) return null;
    return {
        artifactId,
        title: typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : "Session artifact",
        kind: typeof meta.artifactKind === "string" ? meta.artifactKind : "report",
        path: typeof meta.artifactPath === "string" ? meta.artifactPath : "",
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

/** @param {unknown} response @returns {import("../../../shared/session/session-runtime-interactions.js").RuntimeInteractionResponse} */
function acceptedInteractionResponse(response) {
    if (response && typeof response === "object") {
        const source = /** @type {Record<string, unknown>} */ (response);
        const outcome = source.outcome;
        switch (outcome) {
            case "selected":
            case "text":
            case "accepted":
            case "canceled":
            case "unsupported":
            case "blocked":
                return { ...source, outcome };
        }
        return { outcome: "accepted", _meta: source };
    }
    return { outcome: "unsupported", message: "Workspace interaction response is invalid." };
}

/** @param {string} value */
function compactSessionName(value) {
    return value.trim().replace(/\s+/g, " ");
}

/** @param {string} transcriptPath */
async function readSessionListInfo(transcriptPath) {
    try {
        const stat = await Deno.stat(transcriptPath);
        const cached = sessionListInfoCache.get(transcriptPath);
        if (
            cached && cached.size === stat.size && cached.mtime === stat.mtime?.getTime() &&
            cached.ctime === stat.ctime?.getTime()
        ) return cached.info;
        const entries = [];
        const transcript = await Deno.readTextFile(transcriptPath);
        for (const line of transcript.split("\n")) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                entries.push(entry);
            } catch {
                // Use complete records while the active writer appends its next entry.
            }
        }
        const name = summarizeProjectedEntries(entries).name;
        const info = {
            name: typeof name === "string" ? compactSessionName(name) : "",
            firstMessage: compactSessionName(summarizeResumableTranscript(entries).firstMessage || "").slice(0, 100),
        };
        sessionListInfoCache.set(transcriptPath, {
            size: stat.size,
            mtime: stat.mtime?.getTime(),
            ctime: stat.ctime?.getTime(),
            info,
        });
        if (sessionListInfoCache.size > 512) {
            const oldest = sessionListInfoCache.keys().next().value;
            if (oldest) sessionListInfoCache.delete(oldest);
        }
        return info;
    } catch {
        return { name: "", firstMessage: "" };
    }
}

/** @param {string} transcriptPath */
export async function readSessionName(transcriptPath) {
    const info = await readSessionListInfo(transcriptPath);
    return info.name || info.firstMessage;
}

/** @param {string[]} paths */
async function readSessionDisplayName(paths) {
    const infos = await Promise.all(paths.map(readSessionListInfo));
    const savedName = infos.findLast((info) => info.name)?.name || "";
    const name = savedName && !/^untitled(?: session)?$/i.test(savedName) ? savedName : "";
    return name || infos.find((info) => info.firstMessage)?.firstMessage || "";
}

/** @param {import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore} store @param {{ transcriptCwd: string }} session @param {string} projectId */
/**
 * @typedef {Object} WorkspaceOperationRecord
 * @property {string} status
 * @property {string} projectId
 * @property {import("../../../shared/session/session-runtime-events.js").SessionRuntimeEvent[]} events
 * @property {boolean} [remote]
 * @property {import("../../../shared/session/live-session-connection.ts").LiveSessionInfo | null} [sessionInfo]
 * @property {import("../../../shared/session/session-runtime-events.js").RuntimeQueuedMessage[]} [queuedMessages]
 * @property {string} [error]
 * @property {number | null} [generation]
 * @property {string | null} [runwieldSessionId]
 * @property {string} [runtimeSessionId]
 * @property {number} [expectedGeneration]
 * @property {{ agentName?: string, model?: string, provider?: string }} [pendingConfiguration]
 * @property {{ interactionId: string, request: Record<string, unknown> }} [liveInteraction]
 * @property {import('../../../shared/session/notification-content.ts').BrowserNotificationPolicy} [browserNotificationPolicy]
 * @property {{ resolve: (value: import("../../../shared/session/session-runtime-interactions.js").RuntimeInteractionResponse) => void | Promise<void>, reject: (error: Error) => void } | null} [answer]
 */

/**
 * @typedef {Object} WorkspaceAttentionNotification
 * @property {import('../../../shared/session/session-runtime-events.js').RuntimeAttentionRequestedEvent} event
 * @property {string} url
 * @property {import('../../../shared/session/notification-content.ts').BrowserNotificationPolicy} policy
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
        /** @type {Map<string, Set<(snapshot: Record<string, unknown>) => void>>} */
        this.operationListeners = new Map();
        /** @type {Set<(notification: WorkspaceAttentionNotification) => void>} */
        this.notificationListeners = new Set();
        /** @type {Map<string, Promise<() => void>>} */
        this.remoteNotificationStreams = new Map();
        /** @type {Map<string, { requestHash: string, operationId: string }>} */
        this.createRequests = new Map();
        /** @type {Map<string, PendingCreateRequest>} */
        this.pendingCreateRequests = new Map();
        /** @type {Map<string, { cwd: string, targetBranch: string }>} */
        this.codeReviewRefreshContexts = new Map();
    }

    close() {
        this.runtime.closeAllSessionsWhenIdle?.();
        this.operationListeners.clear();
        this.notificationListeners.clear();
        for (const stream of this.remoteNotificationStreams.values()) {
            void stream.then((close) => close()).catch(() => {});
        }
        this.remoteNotificationStreams.clear();
        this.codeReviewRefreshContexts.clear();
    }

    /** @param {string} operationId */
    notifyOperation(operationId) {
        const listeners = this.operationListeners.get(operationId);
        if (!listeners) return;
        const snapshot = this.getOperation(operationId);
        for (const listener of [...listeners]) listener(snapshot);
    }

    /** @param {string} operationId @param {WorkspaceOperationRecord} record */
    setOperation(operationId, record) {
        this.operations.set(operationId, {
            ...record,
            browserNotificationPolicy: this.resolveBrowserNotificationPolicy(record.projectId),
        });
        this.notifyOperation(operationId);
    }

    /** @param {string} operationId @param {import("../../../shared/session/session-runtime-events.js").SessionRuntimeEvent} event */
    appendOperationEvent(operationId, event) {
        const record = this.operations.get(operationId);
        if (!record) return;
        appendLiveSessionEvent(record.events, event);
        if (!record.runwieldSessionId && record.runtimeSessionId) {
            record.runwieldSessionId =
                this.runtime.getSessionSnapshot(record.runtimeSessionId)?.managed?.runwieldSessionId || null;
        }
        this.notifyAttention(record, event);
        this.notifyOperation(operationId);
    }

    /** @param {WorkspaceOperationRecord} record @param {import("../../../shared/session/session-runtime-events.js").SessionRuntimeEvent} event */
    notifyAttention(record, event) {
        if (event.type !== "attention_requested" || event.notificationSurface !== "workspace" || event.eventId) return;
        if (!record.runwieldSessionId) return;
        const notification = {
            event,
            url: `/projects/${encodeURIComponent(record.projectId)}/sessions/${
                encodeURIComponent(record.runwieldSessionId)
            }`,
            policy: this.resolveBrowserNotificationPolicy(record.projectId),
        };
        for (const listener of this.notificationListeners) {
            try {
                listener(notification);
            } catch (error) {
                console.warn("Workspace notification subscriber disconnected:", error);
            }
        }
    }

    /** @param {(notification: WorkspaceAttentionNotification) => void} listener */
    subscribeNotifications(listener) {
        this.notificationListeners.add(listener);
        return () => this.notificationListeners.delete(listener);
    }

    /** @param {string} operationId @param {WorkspaceOperationRecord | undefined} operation */
    async watchRemoteNotifications(operationId, operation) {
        if (!operation?.remote || !operation.runwieldSessionId) return;
        let stream = this.remoteNotificationStreams.get(operationId);
        if (!stream) {
            stream = subscribeLiveSessionAttention(operation.runwieldSessionId, operationId, (event) => {
                this.notifyAttention(operation, event);
            });
            this.remoteNotificationStreams.set(operationId, stream);
        }
        try {
            await stream;
        } catch (error) {
            this.remoteNotificationStreams.delete(operationId);
            throw error;
        }
    }

    /** @param {string} projectId */
    resolveBrowserNotificationPolicy(projectId) {
        const project = typeof this.store.getProjectById === "function" ? this.store.getProjectById(projectId) : null;
        const raw = project ? getMergedCustomSetting("notifications", project.currentRoot) : undefined;
        return normalizeBrowserNotificationPolicy(raw);
    }

    /** @param {string} operationId @param {(snapshot: Record<string, unknown>) => void} listener */
    subscribeOperation(operationId, listener) {
        let listeners = this.operationListeners.get(operationId);
        if (!listeners) {
            listeners = new Set();
            this.operationListeners.set(operationId, listeners);
        }
        listeners.add(listener);
        listener(this.getOperation(operationId));
        return () => {
            const current = this.operationListeners.get(operationId);
            if (!current) return;
            current.delete(listener);
            if (!current.size) this.operationListeners.delete(operationId);
        };
    }

    /**
     * @param {string} projectId
     */
    async listSessionOptions(projectId) {
        const projectRoot = requireOwnerProjectRoot(this.store, projectId);
        const settings = getSettingsManager(projectRoot);
        const agentOptions = await listUserAgentOptions(projectRoot);
        const defaultAgent = await getDefaultUserAgentOption(projectRoot);
        const models = await listUserModelOptions();
        const defaultProvider = settings.getDefaultProvider?.() || "";
        const defaultModel = settings.getDefaultModel?.() || "";
        const defaultThinkingLevel = settings.getDefaultThinkingLevel?.() || "default";
        const [templates, skills, commandRegistry] = await Promise.all([
            listPromptTemplates({ cwd: projectRoot }),
            listSkills({ cwd: projectRoot }),
            import("../../../cmd/registry.js"),
        ]);
        const builtins = commandRegistry.getSlashCommandDefinitions("workspace");
        return {
            defaults: {
                agentName: defaultAgent.name,
                model: defaultAgent.defaults.model || defaultModel,
                provider: defaultAgent.defaults.provider || defaultProvider,
                thinkingLevel: defaultAgent.defaults.thinkingLevel || defaultThinkingLevel,
            },
            agents: agentOptions,
            commands: [
                ...builtins.map((command) => ({
                    name: command.name,
                    description: command.description,
                    kind: "action",
                })),
                ...templates.filter((template) => !commandRegistry.getCommandDefinition(template.name))
                    .map((template) => ({ name: template.name, description: template.description, kind: "prompt" })),
                ...skills.map((skill) => ({
                    name: `skill:${skill.name}`,
                    description: skill.description,
                    kind: "prompt",
                })),
            ],
            models,
            thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        };
    }

    /**
     * @param {string} projectId
     * @param {SessionListOptions} [options]
     */
    async listSessions(projectId, options = {}) {
        const page = typeof options.page === "number" && Number.isInteger(options.page) && options.page >= 0
            ? options.page
            : 0;
        const pageSize =
            typeof options.pageSize === "number" && Number.isInteger(options.pageSize) && options.pageSize > 0
                ? Math.min(options.pageSize, 100)
                : 30;
        const start = page * pageSize;
        // Navigation needs one visible page and a lookahead, not a count of every transcript.
        const visibleLimit = options.includeTotal === false ? start + pageSize + 1 : Infinity;
        const result = await this.store.listProjectSessions(projectId, { page: 0, pageSize: 100, catalog: false });
        let batch = result;
        const visible = [];
        for (let catalogPage = 0;; catalogPage++) {
            // Keep transcript reads bounded; never load all large histories in parallel.
            for (const session of batch.sessions) {
                const segments = this.store.listSessionTranscriptSegments(session.runwieldSessionId);
                const paths = segments.length
                    ? [...segments].sort((a, b) => a.ordinal - b.ordinal).map((segment) => segment.transcriptPath)
                    : [session.transcriptPath].filter(Boolean);
                const displayName = await readSessionDisplayName(paths);
                if (!options.includeEmpty && !displayName) continue;
                visible.push({ ...session, displayName });
                if (visible.length >= visibleLimit) break;
            }
            if (visible.length >= visibleLimit || !batch.hasNext) break;
            batch = await this.store.listProjectSessions(projectId, {
                page: catalogPage + 1,
                pageSize: 100,
                catalog: false,
            });
        }
        return {
            ...result,
            page,
            pageSize,
            total: options.includeTotal === false ? null : visible.length,
            hasNext: start + pageSize < visible.length,
            hasPrevious: page > 0 && start < visible.length,
            diagnostics: result.diagnostics || [],
            sessions: visible.slice(start, start + pageSize).map((session) => {
                const inspected = this.store.inspectSessionActivation(session.runwieldSessionId);
                return {
                    runwieldSessionId: session.runwieldSessionId,
                    projectId,
                    displayName: session.displayName,
                    headerTimestamp: session.headerTimestamp,
                    lastCatalogedAt: session.lastCatalogedAt,
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
            }),
        };
    }

    /**
     * @param {string} runwieldSessionId
     * @param {number} expectedGeneration
     */
    async adoptIdleManagedSession(runwieldSessionId, expectedGeneration) {
        const session = this.store.getSessionById(runwieldSessionId);
        if (!session) throw new Error("Session not found.");
        const inspected = this.store.inspectSessionActivation(runwieldSessionId);
        if (inspected.activation?.state !== "idle") {
            throw new Error("This Session is still busy. Wait for it to finish, then try again.");
        }
        if (!inspected.generation || inspected.generation.generation !== expectedGeneration) {
            throw new Error("Configuration requires the exact committed generation.");
        }
        const projection = await projectAggregateTranscript({
            cwd: session.transcriptCwd,
            sessionDir: getRunWieldSessionDir(session.transcriptCwd),
            runwieldSessionId,
            generation: inspected.generation,
            segments: this.store.listSessionTranscriptSegments(runwieldSessionId),
            limit: 500,
        });
        if (!projection.ok) throw new Error(projection.message);
        const committedFacts = getCommittedTranscriptAuthorityFacts(projection);
        return this.runtime.adoptManagedSession({
            session,
            generation: expectedGeneration,
            activeAgent: committedFacts.activeAgent,
            model: committedFacts.model,
            provider: committedFacts.provider,
            thinkingLevel: committedFacts.thinkingLevel,
            workflowContext:
                /** @type {import('../../../shared/session/workflow-context-session.js').WorkflowContext | null} */ (committedFacts
                    .workflowContext || null),
        });
    }

    /**
     * @param {string} runwieldSessionId
     * @param {{ projectId?: string, cursorEventId?: string, limit?: number, latest?: boolean, beforeEventId?: string }} [options]
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
            ["uncertain", "reconcile_required"].includes(inspected.activation?.state || "") ||
            (!inspected.generation && inspected.activation?.state === "uninitialized")
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
                artifacts: this.store.listSessionArtifacts(runwieldSessionId),
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
            latest: options.latest,
            beforeEventId: options.beforeEventId,
        });
        if (projection.ok) {
            /** @type {import('../../../shared/session/live-session-connection.ts').LiveSessionInfo | null | undefined} */
            let liveInfo = projectLiveSessionInfo(
                this.runtime.listSessions().find((item) =>
                    item.managed?.runwieldSessionId === runwieldSessionId && !item.managed.dormant
                ) || null,
            );
            if (!liveInfo && state === "active" && inspected.activation?.operationId) {
                try {
                    liveInfo = (await readLiveSessionConnection(runwieldSessionId, inspected.activation.operationId))
                        .sessionInfo;
                } catch {
                    // Committed information remains available when the running surface cannot be reached.
                }
            }
            const segments = this.store.listSessionTranscriptSegments(runwieldSessionId);
            const paths = segments.length
                ? [...segments].sort((a, b) => a.ordinal - b.ordinal).map((segment) => segment.transcriptPath)
                : [session.transcriptPath].filter(Boolean);
            if (liveInfo) {
                const planAssociations = mergePlanAssociations(
                    getCommittedTranscriptAuthorityFacts(projection).planAssociations,
                    liveInfo.planAssociations,
                );
                const sessionStats = liveInfo.sessionStats || projection.snapshot.sessionStats;
                Object.assign(projection.snapshot, liveInfo, { planAssociations, sessionStats });
            }
            projection.snapshot.name = liveInfo?.name || await readSessionDisplayName(paths);
            projection.snapshot.contextUsage = liveInfo?.contextUsage || null;
            projection.snapshot.systemContextTokens = liveInfo?.systemContextTokens ?? null;
        }
        return {
            state: state || "idle",
            activeSurface,
            recoveryCategory: state || "idle",
            bootstrapRequired: false,
            artifacts: this.store.listSessionArtifacts(runwieldSessionId),
            ...browserTimelineProjection(projection),
        };
    }

    /**
     * @param {string | undefined} agentName
     * @param {string} projectRoot
     */
    async validateAgentSelection(agentName, projectRoot) {
        if (typeof agentName !== "string" || !agentName) return;
        await requireUserAgentOption(agentName, projectRoot);
    }

    /**
     * @param {string | undefined} model
     * @param {string | undefined} provider
     */
    async validateModelSelection(model, provider) {
        if (typeof model !== "string" || !model) return;
        await requireUserModelOption(model, provider || "");
    }

    /**
     * @param {string | undefined} thinkingLevel
     * @param {{ thinkingLevels: string[] }} sessionOptions
     */
    validateThinkingSelection(thinkingLevel, sessionOptions) {
        if (typeof thinkingLevel !== "string" || !thinkingLevel) return;
        if (!sessionOptions.thinkingLevels.includes(thinkingLevel)) {
            throw new Error("Selected thinking level is not supported.");
        }
    }

    /**
     * @param {string} runwieldSessionId
     * @param {number} expectedGeneration
     * @returns {{ operationId: string, record: WorkspaceOperationRecord } | null}
     */
    findActiveWorkspaceOperation(runwieldSessionId, expectedGeneration) {
        for (const [operationId, record] of this.operations.entries()) {
            if (
                record.runwieldSessionId === runwieldSessionId && record.expectedGeneration === expectedGeneration &&
                record.runtimeSessionId && (record.status === "running" || record.status === "accepted")
            ) {
                return { operationId, record };
            }
        }
        return null;
    }

    /**
     * @param {string} runtimeSessionId
     * @param {{ agentName?: string, model?: string, provider?: string }} pendingConfiguration
     */
    async applyPendingConfiguration(runtimeSessionId, pendingConfiguration) {
        if (pendingConfiguration.agentName) {
            const result = await applyUserAgentSelection(
                this.runtime,
                runtimeSessionId,
                pendingConfiguration.agentName,
            );
            if (!result.ok) throw new Error(result.error || "Selected Agent could not be applied.");
        }
        if (pendingConfiguration.model) {
            const result = await applyUserModelSelection(
                this.runtime,
                runtimeSessionId,
                pendingConfiguration.model,
                pendingConfiguration.provider || "",
            );
            if (!result.ok) throw new Error(result.error || "Selected model could not be applied.");
        }
    }

    /**
     * @param {{ projectId: string, runwieldSessionId: string, expectedGeneration: number, agentName?: string, model?: string, provider?: string, thinkingLevel?: string }} options
     */
    async configureSession(options) {
        const session = this.store.getSessionById(options.runwieldSessionId);
        if (!session || !sessionBelongsToOwnerProject(this.store, session, options.projectId)) {
            throw new Error("Session not found.");
        }
        const projectRoot = requireOwnerProjectRoot(this.store, options.projectId);
        const sessionOptions = await this.listSessionOptions(options.projectId);
        await this.validateAgentSelection(options.agentName, projectRoot);
        await this.validateModelSelection(options.model, options.provider);
        this.validateThinkingSelection(options.thinkingLevel, sessionOptions);
        const activeOperation = this.findActiveWorkspaceOperation(
            options.runwieldSessionId,
            options.expectedGeneration,
        );
        if (activeOperation) {
            const pendingConfiguration = {
                ...(options.agentName ? {} : activeOperation.record.pendingConfiguration || {}),
                ...(options.agentName ? { agentName: options.agentName } : {}),
                ...(options.model ? { model: options.model, provider: options.provider || "" } : {}),
            };
            if (options.thinkingLevel) {
                const runtimeSessionId = activeOperation.record.runtimeSessionId;
                if (!runtimeSessionId) throw new Error("Active Runtime Session is not available.");
                const thinkingLevel = /** @type {WorkspaceThinkingLevel} */ (options.thinkingLevel);
                const result = await this.runtime.setSessionThinkingLevel(runtimeSessionId, thinkingLevel);
                if (!result?.ok) throw new Error(result?.error || "Selected thinking level could not be applied.");
            }
            const hasPendingConfiguration = Object.keys(pendingConfiguration).length > 0;
            this.setOperation(activeOperation.operationId, {
                ...activeOperation.record,
                pendingConfiguration: hasPendingConfiguration ? pendingConfiguration : undefined,
            });
            return {
                ok: true,
                status: hasPendingConfiguration ? "staged" : "applied",
                operationId: activeOperation.operationId,
                pendingConfiguration: hasPendingConfiguration ? pendingConfiguration : null,
                generation: options.expectedGeneration,
            };
        }
        const adopted = await this.adoptIdleManagedSession(options.runwieldSessionId, options.expectedGeneration);
        try {
            if (typeof options.agentName === "string" && options.agentName) {
                const result = await applyUserAgentSelection(this.runtime, adopted.sessionId, options.agentName);
                if (!result.ok) throw new Error(result.error || "Selected Agent could not be applied.");
            }
            if (typeof options.model === "string" && options.model) {
                const result = await applyUserModelSelection(
                    this.runtime,
                    adopted.sessionId,
                    options.model,
                    options.provider || "",
                );
                if (!result.ok) throw new Error(result.error || "Selected model could not be applied.");
            }
            if (typeof options.thinkingLevel === "string" && options.thinkingLevel) {
                const thinkingLevel = /** @type {WorkspaceThinkingLevel} */ (options.thinkingLevel);
                const result = await this.runtime.setSessionThinkingLevel(adopted.sessionId, thinkingLevel);
                if (!result?.ok) throw new Error(result?.error || "Selected thinking level could not be applied.");
            }
            const snapshot = this.runtime.getSessionSnapshot(adopted.sessionId);
            return {
                ok: true,
                status: "applied",
                generation: snapshot?.managed?.generation ?? options.expectedGeneration,
            };
        } finally {
            this.runtime.closeSession(adopted.sessionId);
        }
    }

    /**
     * @param {{ operationId: string }} options
     */
    async cancelOperation(options) {
        const operation = this.operations.get(options.operationId);
        if (operation?.remote && operation.runwieldSessionId) {
            await readLiveSessionConnection(operation.runwieldSessionId, options.operationId, { action: "cancel" });
            return { ok: true };
        }
        if (!operation?.runtimeSessionId) throw new Error("No running turn to stop.");
        return this.runtime.cancelSession(operation.runtimeSessionId);
    }

    /**
     * @typedef {Object} WorkspaceSteeringRequest
     * @property {string} projectId
     * @property {string} operationId
     * @property {string} requestId
     * @property {string} text
     * @property {import('../../../shared/session/types.js').ImageAttachment[]} images
     */
    /** @param {WorkspaceSteeringRequest} options */
    async steerOperation(options) {
        const operation = this.operations.get(options.operationId);
        if (
            operation?.projectId !== options.projectId || operation.status !== "running" || !operation.runwieldSessionId
        ) {
            throw new Error("The turn has finished. Send your message as a follow-up.");
        }
        const activation = this.store.inspectSessionActivation(operation.runwieldSessionId).activation;
        if (activation?.state !== "active" || !activation.operationId) return { ok: true, queued: false };
        await this.watchRemoteNotifications(activation.operationId, operation);
        return await readLiveSessionConnection(operation.runwieldSessionId, activation.operationId, {
            action: "steer",
            inputSurface: "workspace",
            requestId: options.requestId,
            text: options.text,
            images: options.images,
        });
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
     * @param {string} operationId
     * @param {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} request
     * @param {NonNullable<WorkspaceOperationRecord['answer']>} answer
     */
    registerInteraction(operationId, request, answer) {
        const current = this.operations.get(operationId);
        if (!current) throw new Error("The running turn is no longer available.");
        const interactionId = String(request.id);
        const planReview = request.type === "plan_review" ? safePlanReviewReference(request) : null;
        const codeReview = request.type === "code_review" ? safeCodeReviewReference(request) : null;
        const artifactReview = request.type === "artifact_review" ? safeArtifactReviewReference(request) : null;
        if (codeReview) {
            const meta = request._meta && typeof request._meta === "object" ? request._meta : {};
            const executionCwd = typeof meta.executionCwd === "string" ? meta.executionCwd.trim() : "";
            const targetBranch = typeof meta.targetBranch === "string" ? meta.targetBranch.trim() : "";
            if (executionCwd && targetBranch) {
                this.codeReviewRefreshContexts.set(`${operationId}:${interactionId}`, {
                    cwd: executionCwd,
                    targetBranch,
                });
            }
        }
        const reviewUrl = planReview
            ? `/projects/${encodeURIComponent(current.projectId)}/plans/${
                encodeURIComponent(planReview.planId)
            }?session=${encodeURIComponent(current.runwieldSessionId || "")}&operation=${
                encodeURIComponent(operationId)
            }&interaction=${encodeURIComponent(interactionId)}`
            : codeReview
            ? `/projects/${encodeURIComponent(current.projectId)}/sessions/${
                encodeURIComponent(current.runwieldSessionId || "")
            }/review/code?operation=${encodeURIComponent(operationId)}&interaction=${encodeURIComponent(interactionId)}`
            : artifactReview
            ? `/projects/${encodeURIComponent(current.projectId)}/sessions/${
                encodeURIComponent(current.runwieldSessionId || "")
            }/artifacts/${encodeURIComponent(artifactReview.artifactId)}`
            : null;
        if (codeReview && reviewUrl) {
            const meta = request._meta && typeof request._meta === "object" ? request._meta : {};
            if (typeof meta.onSurfaceReady === "function") meta.onSurfaceReady({ url: reviewUrl, opened: false });
        }
        this.setOperation(operationId, {
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
                    ...(codeReview && { codeReview, reviewUrl }),
                    ...(artifactReview && { artifactReview, reviewUrl }),
                },
            },
            answer,
        });
    }

    /**
     * @param {{ operationId: string }} options
     */
    createInteractionAdapter(options) {
        return {
            supportsInteraction: () => true,
            /** @param {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} request @param {AbortSignal} [signal] */
            requestInteraction: (request, signal) => {
                const interactionId = String(request.id || crypto.randomUUID());
                return new Promise((resolve, reject) => {
                    const current = this.operations.get(options.operationId);
                    if (!current || current.status !== "running") {
                        reject(new Error("Workspace operation is not running."));
                        return;
                    }
                    this.registerInteraction(options.operationId, request, { resolve, reject });
                    const abort = () => {
                        const latest = this.operations.get(options.operationId);
                        if (latest?.liveInteraction?.interactionId === interactionId) {
                            this.setOperation(options.operationId, {
                                ...latest,
                                liveInteraction: undefined,
                                answer: null,
                            });
                        }
                        reject(new DOMException("Interaction canceled.", "AbortError"));
                    };
                    signal?.addEventListener("abort", abort, { once: true });
                    if (signal?.aborted) abort();
                });
            },
            cancelAll: () => {
                const current = this.operations.get(options.operationId);
                current?.answer?.reject(new Error("Interaction canceled."));
            },
        };
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, requestId: string, text: string, images?: import("../../../shared/session/types.js").ImageAttachment[], agentName?: string, model?: string, provider?: string, thinkingLevel?: string }} options
     * @returns {Promise<CreateSessionResult>}
     */
    async createSession(options) {
        if (!options.text?.trim() && !options.images?.length) throw new Error("A message or image is required.");
        await Promise.resolve();
        const project = this.store.getProjectById(options.projectId);
        if (!project || project.lifecycle !== "enabled") throw new Error("Project not found.");
        const projectRoot = requireOwnerProjectRoot(this.store, options.projectId);
        const defaultAgent = await getDefaultUserAgentOption(projectRoot);
        const launch = {
            agentName: options.agentName || defaultAgent.name,
            model: options.model || "",
            provider: options.provider || "",
            thinkingLevel: options.thinkingLevel || "default",
        };
        const sessionOptions = await this.listSessionOptions(options.projectId);
        await this.validateAgentSelection(launch.agentName, projectRoot);
        await this.validateModelSelection(launch.model, launch.provider);
        if (launch.thinkingLevel !== "default" && !sessionOptions.thinkingLevels.includes(launch.thinkingLevel)) {
            throw new Error("Selected thinking level is not supported.");
        }
        const requestHash = stableHash({
            kind: "create",
            projectId: options.projectId,
            text: options.text,
            images: options.images || [],
            launch,
        });
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
        const pending = this.pendingCreateRequests.get(createKey);
        if (pending) {
            if (pending.requestHash !== requestHash) {
                throw new Error("Operation request id was reused with different input");
            }
            await pending.settled;
            return await this.createSession(options);
        }
        /** @type {VoidResolver} */
        let releasePending = () => {};
        const reservation = {
            requestHash,
            settled: new Promise((resolve) => {
                releasePending = resolve;
            }),
        };
        this.pendingCreateRequests.set(createKey, reservation);
        try {
            let preparedSessionId = "";
            let preparedModelOverride = "";
            if ((options.images || []).length > 0) {
                try {
                    const created = await this.runtime.createInteractiveSession({
                        cwd: project.currentRoot,
                        mode: "new",
                        deferManagedActivationUntilAgentReady: true,
                    });
                    preparedSessionId = created.sessionId;
                    if (launch.model) {
                        const modelResult = await this.runtime.reconfigureSessionModel(
                            preparedSessionId,
                            launch.model,
                            launch.provider,
                        );
                        if (!modelResult?.ok) throw new Error("Selected model could not be applied.");
                    }
                    if (launch.thinkingLevel !== "default") {
                        const thinkingLevel = /** @type {WorkspaceThinkingLevel} */ (launch.thinkingLevel);
                        const thinkingResult = await this.runtime.setSessionThinkingLevel(
                            preparedSessionId,
                            thinkingLevel,
                        );
                        if (!thinkingResult?.ok) throw new Error("Selected thinking level could not be applied.");
                    }
                    const preflight = await this.runtime.preflightUserTurnImages(preparedSessionId, {
                        initialRequest: options.text,
                        initialImages: options.images || [],
                        agentName: launch.agentName,
                    });
                    if (!preflight.ok) throw new Error(preflight.message);
                    preparedModelOverride = "preparedModelOverride" in preflight
                        ? preflight.preparedModelOverride || ""
                        : "";
                } catch (error) {
                    if (preparedSessionId) this.runtime.closeSessionWhenIdle(preparedSessionId);
                    throw error;
                }
            }
            const repeated = this.createRequests.get(createKey);
            if (repeated) {
                if (preparedSessionId) this.runtime.closeSessionWhenIdle(preparedSessionId);
                if (repeated.requestHash !== requestHash) {
                    throw new Error("Operation request id was reused with different input");
                }
                const operation = this.operations.get(repeated.operationId);
                return {
                    operationId: repeated.operationId,
                    status: operation?.status || "running",
                    runwieldSessionId: operation?.runwieldSessionId || null,
                    generation: operation?.generation ?? null,
                };
            }
            const operationId = crypto.randomUUID();
            this.createRequests.set(createKey, { requestHash, operationId });
            this.setOperation(operationId, {
                status: "running",
                projectId: options.projectId,
                events: [],
                runwieldSessionId: null,
            });
            queueMicrotask(async () => {
                let sessionId = preparedSessionId;
                let unsubscribe = () => {};
                try {
                    if (!sessionId) {
                        const created = await this.runtime.createInteractiveSession({
                            cwd: project.currentRoot,
                            mode: "new",
                            deferManagedActivationUntilAgentReady: true,
                        });
                        sessionId = created.sessionId;
                    }
                    this.setOperation(operationId, {
                        ...(this.operations.get(operationId) || { projectId: options.projectId, events: [] }),
                        status: "running",
                        runtimeSessionId: sessionId,
                        runwieldSessionId: this.runtime.getSessionSnapshot(sessionId)?.managed?.runwieldSessionId ||
                            null,
                    });
                    this.runtime.setInteractionAdapter(sessionId, this.createInteractionAdapter({ operationId }));
                    unsubscribe = this.runtime.subscribeSessionEvents(sessionId, (event) => {
                        this.appendOperationEvent(operationId, event);
                    });
                    if (!preparedSessionId) {
                        if (launch.model) {
                            const modelResult = await applyUserModelSelection(
                                this.runtime,
                                sessionId,
                                launch.model,
                                launch.provider,
                            );
                            if (!modelResult.ok) {
                                throw new Error(modelResult.error || "Selected model could not be applied.");
                            }
                        }
                        if (launch.thinkingLevel !== "default") {
                            const thinkingLevel = /** @type {WorkspaceThinkingLevel} */ (launch.thinkingLevel);
                            const thinkingResult = await this.runtime.setSessionThinkingLevel(sessionId, thinkingLevel);
                            if (!thinkingResult?.ok) throw new Error("Selected thinking level could not be applied.");
                        }
                    }
                    const result = await this.runtime.promptUserTurn(sessionId, {
                        initialRequest: options.text,
                        initialImages: options.images || [],
                        agentName: launch.agentName,
                        preparedModelOverride,
                    });
                    const snapshot = this.runtime.getSessionSnapshot(sessionId);
                    const runwieldSessionId = snapshot?.managed?.runwieldSessionId || null;
                    const generation = snapshot?.managed?.generation ?? (result.ok ? 1 : 0);
                    this.setOperation(operationId, {
                        ...(this.operations.get(operationId) || { projectId: options.projectId, events: [] }),
                        status: result.ok ? "completed" : "failed",
                        generation,
                        runwieldSessionId,
                        error: result.error,
                    });
                } catch (error) {
                    this.setOperation(operationId, {
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
        } finally {
            if (this.pendingCreateRequests.get(createKey) === reservation) {
                this.pendingCreateRequests.delete(createKey);
            }
            releasePending();
        }
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, runwieldSessionId: string, requestId: string, expectedGeneration: number, text: string, images?: Array<{ base64: string, mimeType: string }> }} options
     */
    async startContinuation(options) {
        if (!options.text?.trim() && !options.images?.length) throw new Error("A message or image is required.");
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
        if (!inspected.generation || inspected.generation.generation !== options.expectedGeneration) {
            throw new Error("Continuation requires the exact committed generation.");
        }
        if (inspected.activation?.state === "active") {
            throw new Error("This Session is still busy. Keep the message queued in this browser until it finishes.");
        }
        if (inspected.activation?.state !== "idle") {
            throw new Error("This Session needs recovery before it can accept messages.");
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
        let preflightAdopted = null;
        let preparedModelOverride = "";
        if ((options.images || []).length > 0) {
            try {
                preflightAdopted = this.runtime.adoptManagedSession({
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
                const preflight = await this.runtime.preflightUserTurnImages(preflightAdopted.sessionId, {
                    initialRequest: options.text,
                    initialImages: options.images || [],
                    agentName: decision.agentName,
                });
                if (!preflight.ok) throw new Error(preflight.message);
                preparedModelOverride = "preparedModelOverride" in preflight
                    ? preflight.preparedModelOverride || ""
                    : "";
            } catch (error) {
                if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
                throw error;
            }
        }
        const matchingReceipt = this.store.findOperationReceiptByRequest({
            deviceId: options.deviceId || null,
            requestId: options.requestId,
            requestHash,
            runwieldSessionId: options.runwieldSessionId,
        });
        if (matchingReceipt && matchingReceipt.projectId === options.projectId) {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            return {
                operationId: matchingReceipt.operationId,
                status: this.operations.get(matchingReceipt.operationId)?.status || matchingReceipt.status,
                generation: matchingReceipt.resultGeneration,
            };
        }
        const currentSession = this.store.getSessionById(options.runwieldSessionId);
        if (!currentSession || !sessionBelongsToOwnerProject(this.store, currentSession, options.projectId)) {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            throw new Error("Session not found.");
        }
        const currentState = this.store.inspectSessionActivation(options.runwieldSessionId);
        if (!currentState.generation || currentState.generation.generation !== options.expectedGeneration) {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            throw new Error("Continuation requires the exact committed generation.");
        }
        if (currentState.activation?.state === "active") {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            throw new Error("This Session is still busy. Keep the message queued in this browser until it finishes.");
        }
        if (currentState.activation?.state !== "idle") {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            throw new Error("This Session needs recovery before it can accept messages.");
        }
        let receipt;
        try {
            receipt = requireReceipt(this.store.createOrGetOperationReceipt({
                deviceId: options.deviceId || null,
                requestId: options.requestId,
                requestHash,
                runwieldSessionId: options.runwieldSessionId,
                projectId: options.projectId,
                expectedGeneration: options.expectedGeneration,
                kind: "continuation",
            }));
        } catch (error) {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            throw error;
        }
        if (this.operations.has(receipt.operationId)) {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            return {
                operationId: receipt.operationId,
                status: this.operations.get(receipt.operationId)?.status || "running",
            };
        }
        if (receipt.status !== "accepted") {
            if (preflightAdopted?.sessionId) this.runtime.closeSession(preflightAdopted.sessionId);
            return { operationId: receipt.operationId, status: receipt.status, generation: receipt.resultGeneration };
        }
        this.store.updateOperationReceipt(receipt.operationId, { status: "running" });
        this.setOperation(receipt.operationId, {
            status: "running",
            projectId: options.projectId,
            events: [],
            runwieldSessionId: options.runwieldSessionId,
            expectedGeneration: options.expectedGeneration,
        });
        const adopted = preflightAdopted || this.runtime.adoptManagedSession({
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
        this.setOperation(receipt.operationId, {
            ...(this.operations.get(receipt.operationId) || { projectId: options.projectId, events: [] }),
            status: "running",
            runtimeSessionId: adopted.sessionId,
        });
        this.runtime.setInteractionAdapter(
            adopted.sessionId,
            this.createInteractionAdapter({ operationId: receipt.operationId }),
        );
        const unsubscribe = this.runtime.subscribeSessionEvents(adopted.sessionId, (event) => {
            this.appendOperationEvent(receipt.operationId, event);
        });
        queueMicrotask(async () => {
            try {
                const result = await this.runtime.promptUserTurn(adopted.sessionId, {
                    initialRequest: options.text,
                    initialImages: options.images || [],
                    agentName: decision.agentName,
                    preparedModelOverride,
                });
                let generation = result.ok ? options.expectedGeneration + 1 : options.expectedGeneration;
                /** @type {"completed" | "failed"} */
                let status = result.ok ? "completed" : "failed";
                let error = result.error;
                const pendingConfiguration = this.operations.get(receipt.operationId)?.pendingConfiguration || null;
                if (result.ok && pendingConfiguration && Object.keys(pendingConfiguration).length) {
                    try {
                        await this.applyPendingConfiguration(adopted.sessionId, pendingConfiguration);
                        const snapshot = this.runtime.getSessionSnapshot(adopted.sessionId);
                        generation = snapshot?.managed?.generation ?? generation;
                    } catch (configurationError) {
                        status = "failed";
                        error = configurationError instanceof Error
                            ? configurationError.message
                            : String(configurationError || "Configuration change failed.");
                    }
                }
                this.store.updateOperationReceipt(receipt.operationId, {
                    status,
                    resultGeneration: generation,
                    errorCode: error || null,
                    errorMessage: error || null,
                });
                this.setOperation(receipt.operationId, {
                    ...(this.operations.get(receipt.operationId) || { projectId: options.projectId, events: [] }),
                    status,
                    generation,
                    error,
                    pendingConfiguration: status === "completed" ? undefined : pendingConfiguration || undefined,
                });
            } catch (error) {
                const errorCode = codeFromError(error);
                this.store.updateOperationReceipt(receipt.operationId, {
                    status: "failed",
                    errorCode,
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
                this.setOperation(receipt.operationId, {
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
            if (request?.type === "plan_review" && Array.isArray(planReview?.sequenceDocuments)) {
                const decision = readPlanReviewDecisionMeta(options.response);
                await validateSequenceReviewDecision(
                    requireOwnerProjectRoot(this.store, options.projectId),
                    /** @type {import('../../../shared/workflow/sequence-review.ts').SequenceReviewDocument[]} */ (planReview
                        .sequenceDocuments),
                    /** @type {import('../../../shared/workflow/sequence-review.ts').SequenceReviewDecision} */ (decision),
                );
                runtimeResponse = {
                    outcome: "accepted",
                    _meta: {
                        approved: decision.approved === true,
                        approvalAction: decision.approvalAction,
                        feedback: decision.feedback,
                        sequenceDecision: decision,
                    },
                };
            } else if (request?.type === "plan_review" && planReview) {
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
                    this.setOperation(options.operationId, {
                        ...operation,
                        liveInteraction: undefined,
                        answer: null,
                    });
                    throw new Error(message);
                }
                runtimeResponse = { outcome: "accepted", _meta: { ...actionResult } };
            }
            await operation.answer.resolve(runtimeResponse);
            this.codeReviewRefreshContexts.delete(`${options.operationId}:${options.interactionId}`);
            this.setOperation(options.operationId, { ...operation, liveInteraction: undefined, answer: null });
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
    async getLivePlanReview(options) {
        if (!this.operations.has(options.operationId) || this.operations.get(options.operationId)?.remote) {
            await this.liveSession(options.projectId, options.runwieldSessionId);
        }
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
     * @param {{ projectId: string, operationId: string, interactionId: string, runwieldSessionId: string }} options
     */
    async getLiveCodeReview(options) {
        if (!this.operations.has(options.operationId) || this.operations.get(options.operationId)?.remote) {
            await this.liveSession(options.projectId, options.runwieldSessionId);
        }
        const operation = this.operations.get(options.operationId);
        if (!operation || operation.status !== "running" || operation.projectId !== options.projectId) return null;
        if (operation.runwieldSessionId !== options.runwieldSessionId) return null;
        if (!operation.liveInteraction || operation.liveInteraction.interactionId !== options.interactionId) {
            return null;
        }
        const request = operation.liveInteraction.request || {};
        if (request.type !== "code_review") return null;
        const codeReview = request.codeReview && typeof request.codeReview === "object"
            ? /** @type {Record<string, unknown>} */ (request.codeReview)
            : null;
        if (!codeReview || typeof codeReview.rawPatch !== "string") return null;
        const refresh = this.codeReviewRefreshContexts.get(`${options.operationId}:${options.interactionId}`);
        let rawPatch = String(codeReview.rawPatch);
        if (refresh) {
            try {
                rawPatch = await getWorktreeReviewDiff(refresh.cwd, refresh.targetBranch);
            } catch (error) {
                if (error instanceof WorktreeReviewTargetError) throw error;
                // Keep the last complete interaction patch while the checkout is temporarily unreadable.
            }
        }
        return {
            operationId: options.operationId,
            interactionId: options.interactionId,
            request: { ...request, codeReview: { ...codeReview, rawPatch } },
        };
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
     * @param {{ action?: string, runwieldSessionId: string, projectId: string, expectedGeneration: number, planName: string, planContent?: string, triageMeta?: Record<string, unknown>, reviewFeedback?: string, reviewImages?: Array<{ base64: string, mimeType: string }> }} options
     */
    async startPlanWorkflowHandoff(options) {
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
            const status = String(options.triageMeta.status || "");
            const validationStatus = ["implemented", "validated_ci", "validated_reviewer", "validated"].includes(
                status,
            );
            if (validationStatus || options.action === "recover") {
                return await this.runtime.runValidation(adopted.sessionId, {
                    planName: options.planName,
                    planContent: options.planContent || "",
                    triageMeta: options.triageMeta,
                    trigger: options.action === "recover" ? "repair" : "session_resume",
                    expectedGeneration: options.expectedGeneration,
                });
            }
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

    /** @param {string} projectId @param {string} runwieldSessionId */
    async liveSession(projectId, runwieldSessionId) {
        const session = this.store.getSessionById(runwieldSessionId);
        if (!session || !sessionBelongsToOwnerProject(this.store, session, projectId)) {
            throw new Error("Session not found.");
        }
        const inspected = this.store.inspectSessionActivation(runwieldSessionId);
        const state = inspected.activation?.state || "uninitialized";
        const generation = inspected.generation?.generation ?? null;
        const local = [...this.operations.entries()].find(([, operation]) =>
            !operation.remote && operation.runwieldSessionId === runwieldSessionId && operation.status === "running"
        );
        if (local) return { state, generation, operation: this.getOperation(local[0]) };
        const operationId = inspected.activation?.operationId;
        if (state !== "active" || !operationId) return { state, generation, operation: null };
        let live;
        try {
            live = await readLiveSessionConnection(runwieldSessionId, operationId);
        } catch {
            // The process may still be opening or finishing its turn. Retry on the next observation.
            return { state, generation, operation: null };
        }
        this.setOperation(operationId, {
            status: "running",
            projectId,
            runwieldSessionId,
            remote: true,
            generation,
            events: live.events,
            sessionInfo: live.sessionInfo,
            queuedMessages: live.queuedMessages,
        });
        if (live.interaction) {
            const interactionId = live.interaction.id;
            this.registerInteraction(operationId, live.interaction, {
                resolve: async (response) => {
                    await this.watchRemoteNotifications(operationId, this.operations.get(operationId));
                    await readLiveSessionConnection(runwieldSessionId, operationId, {
                        action: "answer",
                        inputSurface: "workspace",
                        interactionId,
                        response,
                    });
                },
                reject: () => {
                    void readLiveSessionConnection(runwieldSessionId, operationId, {
                        action: "answer",
                        inputSurface: "workspace",
                        interactionId,
                        response: { outcome: "canceled" },
                    }).catch(() => {});
                },
            });
        }
        return { state, generation, operation: this.getOperation(operationId) };
    }

    /** @param {string} operationId */
    async refreshOperation(operationId) {
        const operation = this.operations.get(operationId);
        if (operation?.remote && operation.runwieldSessionId && operation.status === "running") {
            const live = await this.liveSession(operation.projectId, operation.runwieldSessionId);
            if (
                live.operation?.operationId !== operationId &&
                (live.state !== "active" || live.operation || live.generation !== operation.generation)
            ) {
                this.setOperation(operationId, {
                    ...operation,
                    status: live.state === "idle" || live.generation !== operation.generation ? "completed" : "unknown",
                    liveInteraction: undefined,
                    answer: null,
                });
            } else if (!live.operation) {
                this.setOperation(operationId, { ...operation, liveInteraction: undefined, answer: null });
            }
        }
        return this.getOperation(operationId);
    }

    /** @param {string} operationId */
    getOperation(operationId) {
        const live = this.operations.get(operationId);
        const durable = this.store.getOperationReceipt(operationId);
        const sessionInfo = live?.runtimeSessionId
            ? projectLiveSessionInfo(this.runtime.getSessionSnapshot(live.runtimeSessionId))
            : live?.sessionInfo || null;
        if (!durable) {
            if (!live) return { operationId, status: "unknown", events: [] };
            const { answer: _answer, runtimeSessionId: _runtimeSessionId, ...snapshot } = live;
            return {
                operationId,
                ...snapshot,
                sessionInfo,
                queuedMessages: live.runtimeSessionId
                    ? this.runtime.getQueuedMessages(live.runtimeSessionId)
                    : live.queuedMessages || [],
            };
        }
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
            runwieldSessionId: live?.runwieldSessionId || durable.runwieldSessionId,
            status: durable.status,
            generation: durable.resultGeneration,
            error: durable.errorMessage || durable.errorCode,
            events: live?.events || [],
            sessionInfo,
            queuedMessages: live?.runtimeSessionId
                ? this.runtime.getQueuedMessages(live.runtimeSessionId)
                : live?.queuedMessages || [],
            liveInteraction: live?.liveInteraction || null,
            pendingConfiguration: live?.pendingConfiguration || null,
            browserNotificationPolicy: live?.browserNotificationPolicy ||
                (live?.projectId ? this.resolveBrowserNotificationPolicy(live.projectId) : undefined),
        };
    }
}

/** @param {{ store: import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore }} options */
export function createWorkspaceSessionContinuationService(options) {
    return new WorkspaceSessionContinuationService(options);
}
