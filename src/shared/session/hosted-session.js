/**
 * @module shared/session/hosted-session
 * Per-conversation runtime state owned by a SessionHost entry.
 */

import { isAbsolute } from "@std/path";
import { MAX_DELEGATED_READERS } from "../../constants.js";
import {
    readPersistedWorkflowContext,
    recordWorkflowPlanName,
    recordWorkflowTriageContext,
    workflowContextsEqual,
} from "./workflow-context-session.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";

/**
 * @typedef {Object} AgentInfo
 * @property {string} displayName
 * @property {string} model
 * @property {string} provider
 * @property {string} [agentName]
 */

/**
 * @typedef {AgentInfo & { sessionInfoId: string }} AgentInfoRecord
 */

/**
 * @typedef {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"} ThinkingLevel
 */

/**
 * @typedef {Object} ActiveExecutionWorkflow
 * @property {string} planName
 * @property {any} triageMeta
 * @property {"engineer"|"frontend-engineer"} executionAgent
 * @property {boolean} [executionStarted]
 * @property {number} [executionAttemptStartedAtMs]
 * @property {"autonomous"|"pair"} [collaborationStyle]
 * @property {"autonomous"|"pair"} [collaborationRecommendation]
 * @property {number} [pairCheckpointCount]
 * @property {boolean} [pairSwitchedToAutonomous]
 * @property {boolean} [pairCapabilityLost]
 * @property {"stop"|"canceled"} [pairPauseReason]
 * @property {boolean} [pairStopRequested]
 * @property {string} [baselineTree]
 * @property {string} [projectRoot]
 * @property {string} [executionCwd]
 * @property {string} [worktreeId]
 * @property {string} [worktreeBranch]
 * @property {string} [worktreeBaseBranch]
 * @property {boolean} [nonGitInPlace]
 * @property {boolean} [validationContinuation]
 * @property {string} [manualQaName]
 * @property {string} [manualQaContext]
 */

/**
 * @typedef {Object} DisposableLike
 * @property {() => void | Promise<void>} [dispose]
 */

/**
 * @typedef {Object} MinimalSessionManagerLike
 * @property {() => string} [getSessionId]
 * @property {() => string} [getCwd]
 * @property {() => string | undefined} [getSessionName]
 * @property {(name: string) => void} [appendSessionInfo]
 * @property {() => unknown[]} [getBranch]
 * @property {() => unknown[]} [getEntries]
 * @property {(customType: string, data: unknown) => void} [appendCustomEntry]
 * @property {() => void | Promise<void>} [dispose]
 */

/**
 * @typedef {Object} ActiveInteractionRecord
 * @property {import('./session-runtime-interactions.js').RuntimeInteractionRequest} [request]
 * @property {AbortController} [abortController]
 */

/**
 * @typedef {Object} HostedSessionOptions
 * @property {string} [id]
 * @property {string} [cwd]
 * @property {MinimalSessionManagerLike | null} [sessionManager]
 * @property {unknown} [eventSink]
 * @property {import('./session-runtime-interactions.js').RuntimeInteractionAdapter} [interactionAdapter]
 */

/** @param {unknown} value */
function getSessionManagerId(value) {
    if (!value || typeof value !== "object" || !("getSessionId" in value) || typeof value.getSessionId !== "function") {
        return null;
    }
    const id = value.getSessionId();
    return typeof id === "string" && id ? id : null;
}

/** @param {unknown} value */
function getSessionManagerCwd(value) {
    if (!value || typeof value !== "object" || !("getCwd" in value) || typeof value.getCwd !== "function") {
        return null;
    }
    const cwd = value.getCwd();
    return typeof cwd === "string" && cwd ? cwd : null;
}

/**
 * @param {string | null | undefined} cwd
 * @param {string} source
 * @returns {string}
 */
function requireAbsoluteProjectRoot(cwd, source) {
    if (!cwd) throw new Error(`HostedSession requires an absolute project root (${source})`);
    if (!isAbsolute(cwd)) throw new Error(`HostedSession project root must be absolute: ${cwd}`);
    return cwd;
}

/** @param {unknown} value */
function disposeIfPresent(value) {
    if (!value || typeof value !== "object" || !("dispose" in value) || typeof value.dispose !== "function") return;
    try {
        value.dispose();
    } catch {
        // Disposal is best-effort so one bad runtime object does not prevent
        // the HostedSession from clearing the rest of its owned references.
    }
}

export class HostedSession {
    /**
     * @param {HostedSessionOptions} options
     */
    constructor(options) {
        const id = options?.id || getSessionManagerId(options?.sessionManager);
        if (!id) throw new Error("HostedSession requires an id");
        this.id = id;
        const sessionManagerCwd = getSessionManagerCwd(options.sessionManager);
        this.cwd = requireAbsoluteProjectRoot(
            sessionManagerCwd || options.cwd,
            sessionManagerCwd ? "sessionManager" : "cwd",
        );
        this.disposed = false;

        /** @type {AgentInfoRecord[]} */
        this.agentInfoStack = [];
        this.agentInfoSequence = 0;
        this.userModelOverrideId = "";
        this.userModelOverrideProvider = "";
        this.userModelOverride = false;
        /** @type {ThinkingLevel} */
        this.activeThinkingLevel = "off";
        /** @type {Function | null} */
        this.activeOnMessage = null;
        /** @type {MinimalSessionManagerLike | null} */
        this.rootSessionManager = options.sessionManager || null;
        /** @type {unknown} */
        this.eventSink = options.eventSink || null;
        /** @type {import('./session-runtime-interactions.js').RuntimeInteractionAdapter | null} */
        this.interactionAdapter = options.interactionAdapter || null;
        /** @type {Map<string, ActiveInteractionRecord>} */
        this.activeInteractions = new Map();
        /** @type {DisposableLike | null} */
        this.rootAgentSession = null;
        /** @type {string | null} */
        this.rootAgentName = null;
        /** @type {Set<DisposableLike>} */
        this.subAgentSessions = new Set();
        this.delegatedReaderCount = 0;
        this.delegatedWriterActive = false;
        this.projectStateContext = "";
        /** @type {import('./workflow-context-session.js').WorkflowContext | null} */
        this.workflowContext = readPersistedWorkflowContext(
            /** @type {import('@earendil-works/pi-coding-agent').SessionManager | null} */ (this.rootSessionManager),
        );
        /** @type {ActiveExecutionWorkflow | null} */
        this.activeExecutionWorkflow = null;
        /** @type {string | null} */
        this.activeTurnId = null;
    }

    assertActive() {
        if (this.disposed) throw new Error(`HostedSession "${this.id}" is disposed`);
    }

    /**
     * @param {string} displayName
     * @param {string} [model]
     * @param {string} [provider]
     * @param {string} [agentName]
     * @returns {string}
     */
    pushAgentInfo(displayName, model = "", provider = "", agentName = "") {
        this.assertActive();
        const sessionInfoId = `agent-info-${++this.agentInfoSequence}`;
        this.agentInfoStack.push({ sessionInfoId, displayName, model, provider, ...(agentName ? { agentName } : {}) });
        return sessionInfoId;
    }

    /** @param {string} [sessionInfoId] */
    popAgentInfo(sessionInfoId = "") {
        this.assertActive();
        if (!sessionInfoId) {
            this.agentInfoStack.pop();
            return;
        }
        const index = this.agentInfoStack.findIndex((agentInfo) => agentInfo.sessionInfoId === sessionInfoId);
        if (index >= 0) this.agentInfoStack.splice(index, 1);
    }

    /** @param {string} displayName @param {string} [model] @param {string} [provider] @param {string} [agentName] */
    resetAgentInfoStack(displayName, model = "", provider = "", agentName = "") {
        this.assertActive();
        const sessionInfoId = `agent-info-${++this.agentInfoSequence}`;
        this.agentInfoStack = [{ sessionInfoId, displayName, model, provider, ...(agentName ? { agentName } : {}) }];
    }

    getAgentInfoStack() {
        return this.agentInfoStack.map(({ sessionInfoId: _sessionInfoId, ...agentInfo }) => ({ ...agentInfo }));
    }

    getActiveAgentInfo() {
        if (this.agentInfoStack.length === 0) return null;
        const { sessionInfoId: _sessionInfoId, ...agentInfo } = this.agentInfoStack[this.agentInfoStack.length - 1];
        return { ...agentInfo };
    }

    getActiveAgentName() {
        return this.getActiveAgentInfo()?.displayName || "";
    }

    /** @param {string} model @param {string} [provider] @param {boolean} [isUserOverride] */
    setActiveModelState(model, provider = "", isUserOverride = false) {
        this.assertActive();
        if (isUserOverride) {
            this.userModelOverrideId = model;
            this.userModelOverrideProvider = provider;
            this.userModelOverride = true;
            return;
        }
        if (this.agentInfoStack.length > 0) {
            const top = this.agentInfoStack[this.agentInfoStack.length - 1];
            top.model = model;
            top.provider = provider;
        }
    }

    getActiveModelState() {
        if (this.userModelOverride) {
            return { model: this.userModelOverrideId, provider: this.userModelOverrideProvider };
        }
        if (this.agentInfoStack.length === 0) return { model: "", provider: "" };
        const top = this.agentInfoStack[this.agentInfoStack.length - 1];
        return { model: top.model, provider: top.provider };
    }

    isUserModelOverride() {
        return this.userModelOverride;
    }

    clearUserModelOverride() {
        this.assertActive();
        this.userModelOverride = false;
        this.userModelOverrideId = "";
        this.userModelOverrideProvider = "";
    }

    /** @param {Function | null} handler */
    setActiveOnMessage(handler) {
        this.assertActive();
        this.activeOnMessage = handler;
    }

    getActiveOnMessage() {
        return this.activeOnMessage;
    }

    /** @param {MinimalSessionManagerLike | null} sessionManager */
    setRootSessionManager(sessionManager) {
        this.assertActive();
        this.rootSessionManager = sessionManager;
    }

    getRootSessionManager() {
        return this.rootSessionManager;
    }

    /** @param {unknown} eventSink */
    setEventSink(eventSink) {
        this.assertActive();
        this.eventSink = eventSink;
    }

    getEventSink() {
        return this.eventSink;
    }

    /**
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionAdapter | null} adapter
     */
    setInteractionAdapter(adapter) {
        this.assertActive();
        this.interactionAdapter = adapter;
    }

    getInteractionAdapter() {
        return this.interactionAdapter;
    }

    /** @param {string} id @param {ActiveInteractionRecord} record */
    addActiveInteraction(id, record) {
        this.assertActive();
        this.activeInteractions.set(id, record);
    }

    /** @param {string} id */
    removeActiveInteraction(id) {
        this.activeInteractions.delete(id);
    }

    getActiveInteractions() {
        return new Map(this.activeInteractions);
    }

    cancelActiveInteractions() {
        const canceled = this.activeInteractions.size > 0;
        for (const record of this.activeInteractions.values()) {
            record.abortController?.abort();
        }
        this.interactionAdapter?.cancelAll?.();
        this.activeInteractions.clear();
        return canceled;
    }

    /** @param {DisposableLike | null} session */
    setRootAgentSession(session) {
        this.assertActive();
        this.rootAgentSession = session;
    }

    getRootAgentSession() {
        return this.rootAgentSession;
    }

    /** @param {string | null} agentName */
    setRootAgentName(agentName) {
        this.assertActive();
        this.rootAgentName = agentName;
    }

    getRootAgentName() {
        return this.rootAgentName;
    }

    /** @param {DisposableLike} session */
    addSubAgentSession(session) {
        this.assertActive();
        this.subAgentSessions.add(session);
    }

    /** @param {DisposableLike} session */
    removeSubAgentSession(session) {
        this.assertActive();
        this.subAgentSessions.delete(session);
    }

    getSubAgentSessions() {
        return new Set(this.subAgentSessions);
    }

    /**
     * @param {"read" | "write"} mode
     * @returns {() => void}
     */
    acquireDelegatedAgentLease(mode) {
        this.assertActive();
        if (mode === "read") {
            if (this.delegatedWriterActive) {
                throw new Error("A delegated writer is already running; read delegations must wait.");
            }
            if (this.delegatedReaderCount >= MAX_DELEGATED_READERS) {
                throw new Error(`Too many delegated readers are running; maximum is ${MAX_DELEGATED_READERS}.`);
            }
            this.delegatedReaderCount++;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                this.delegatedReaderCount = Math.max(0, this.delegatedReaderCount - 1);
            };
        }

        if (this.delegatedWriterActive || this.delegatedReaderCount > 0) {
            throw new Error(
                "A delegated reader or writer is already running; write delegation requires exclusive access.",
            );
        }
        this.delegatedWriterActive = true;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.delegatedWriterActive = false;
        };
    }

    getDelegatedAgentLeaseState() {
        return { readers: this.delegatedReaderCount, writer: this.delegatedWriterActive };
    }

    getThinkingLevel() {
        return this.activeThinkingLevel;
    }

    /** @param {ThinkingLevel} level */
    setThinkingLevel(level) {
        this.assertActive();
        this.activeThinkingLevel = level;
    }

    /** @param {string} context */
    setProjectStateContext(context) {
        this.assertActive();
        this.projectStateContext = context;
    }

    getProjectStateContext() {
        return this.projectStateContext;
    }

    getWorkflowContext() {
        return this.workflowContext ? { ...this.workflowContext } : null;
    }

    /** @param {{ routingIntent: unknown, complexity: unknown }} details */
    setWorkflowTriageContext(details) {
        if (this.disposed) return;
        const previous = this.workflowContext;
        try {
            this.workflowContext = recordWorkflowTriageContext(
                /** @type {import('@earendil-works/pi-coding-agent').SessionManager | null} */ (this
                    .rootSessionManager),
                details,
            );
        } catch (_e) {
            // Footer-context persistence is fail-open and must not block triage.
            return;
        }
        if (workflowContextsEqual(previous, this.workflowContext) || !this.workflowContext) return;
        emitHostedSessionRuntimeEvent(this, {
            type: RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED,
            workflowContext: { ...this.workflowContext },
        });
    }

    /** @param {unknown} planName */
    setWorkflowPlanName(planName) {
        if (this.disposed) return;
        const previous = this.workflowContext;
        try {
            this.workflowContext = recordWorkflowPlanName(
                /** @type {import('@earendil-works/pi-coding-agent').SessionManager | null} */ (this
                    .rootSessionManager),
                planName,
            );
        } catch (_e) {
            // Footer-context persistence is fail-open and must not block planning.
            return;
        }
        if (workflowContextsEqual(previous, this.workflowContext) || !this.workflowContext) return;
        emitHostedSessionRuntimeEvent(this, {
            type: RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED,
            workflowContext: { ...this.workflowContext },
        });
    }

    /** @param {ActiveExecutionWorkflow | null} workflow */
    setActiveExecutionWorkflow(workflow) {
        this.assertActive();
        if (workflow) {
            const owner = workflow.executionAgent;
            if (owner !== "engineer" && owner !== "frontend-engineer") {
                throw new Error(
                    "setActiveExecutionWorkflow: active execution workflow requires executionAgent engineer or frontend-engineer",
                );
            }
            if (workflow.executionStarted !== undefined && typeof workflow.executionStarted !== "boolean") {
                throw new Error("setActiveExecutionWorkflow: executionStarted must be boolean");
            }
            if (
                workflow.executionAttemptStartedAtMs !== undefined &&
                (!Number.isFinite(workflow.executionAttemptStartedAtMs) || workflow.executionAttemptStartedAtMs < 0)
            ) {
                throw new Error(
                    "setActiveExecutionWorkflow: executionAttemptStartedAtMs must be a non-negative number",
                );
            }
            if (
                workflow.collaborationStyle !== undefined && workflow.collaborationStyle !== "autonomous" &&
                workflow.collaborationStyle !== "pair"
            ) {
                throw new Error("setActiveExecutionWorkflow: collaborationStyle must be autonomous or pair");
            }
            if (
                workflow.collaborationRecommendation !== undefined &&
                workflow.collaborationRecommendation !== "autonomous" && workflow.collaborationRecommendation !== "pair"
            ) {
                throw new Error(
                    "setActiveExecutionWorkflow: collaborationRecommendation must be autonomous or pair",
                );
            }
            if (
                workflow.pairCheckpointCount !== undefined &&
                (!Number.isInteger(workflow.pairCheckpointCount) || workflow.pairCheckpointCount < 0)
            ) {
                throw new Error("setActiveExecutionWorkflow: pairCheckpointCount must be a non-negative integer");
            }
            if (
                workflow.pairPauseReason !== undefined && workflow.pairPauseReason !== "stop" &&
                workflow.pairPauseReason !== "canceled"
            ) {
                throw new Error("setActiveExecutionWorkflow: pairPauseReason must be stop or canceled");
            }
        }
        this.activeExecutionWorkflow = workflow;
    }

    getActiveExecutionWorkflow() {
        return this.activeExecutionWorkflow;
    }

    getActiveExecutionCwd() {
        return this.activeExecutionWorkflow?.executionCwd || this.cwd;
    }

    clearActiveExecutionWorkflow() {
        this.assertActive();
        this.activeExecutionWorkflow = null;
    }

    /** @param {string} turnId */
    beginTurn(turnId) {
        this.assertActive();
        if (this.activeTurnId) return false;
        this.activeTurnId = turnId;
        return true;
    }

    /** @param {string} turnId */
    endTurn(turnId) {
        if (this.activeTurnId !== turnId) return false;
        this.activeTurnId = null;
        return true;
    }

    getActiveTurnId() {
        return this.activeTurnId;
    }

    isTurnActive() {
        return Boolean(this.activeTurnId);
    }

    dispose() {
        if (this.disposed) return;
        disposeIfPresent(this.rootAgentSession);
        for (const session of this.subAgentSessions) disposeIfPresent(session);
        disposeIfPresent(this.rootSessionManager);
        this.agentInfoStack = [];
        this.userModelOverrideId = "";
        this.userModelOverrideProvider = "";
        this.userModelOverride = false;
        this.activeThinkingLevel = "off";
        this.activeOnMessage = null;
        this.rootSessionManager = null;
        this.eventSink = null;
        this.interactionAdapter?.cancelAll?.();
        this.interactionAdapter = null;
        this.activeInteractions.clear();
        this.rootAgentSession = null;
        this.rootAgentName = null;
        this.subAgentSessions.clear();
        this.delegatedReaderCount = 0;
        this.delegatedWriterActive = false;
        this.projectStateContext = "";
        this.workflowContext = null;
        this.activeExecutionWorkflow = null;
        this.activeTurnId = null;
        this.disposed = true;
    }
}
