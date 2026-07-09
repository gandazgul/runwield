/**
 * @module shared/session/hosted-session
 * Per-conversation runtime state owned by a SessionHost entry.
 */

import { CWD } from "../../constants.js";

/**
 * @typedef {Object} PendingRootSwap
 * @property {string} agentName
 * @property {string} displayName
 * @property {string} [model]
 * @property {boolean} [allowReturnToRouter]
 */

/**
 * @typedef {Object} PendingSwitchHandoff
 * @property {string} agentName
 * @property {string} reason
 */

/**
 * @typedef {Object} AgentInfo
 * @property {string} displayName
 * @property {string} model
 * @property {string} provider
 */

/**
 * @typedef {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"} ThinkingLevel
 */

/**
 * @typedef {Object} ActiveExecutionWorkflow
 * @property {string} planName
 * @property {any} triageMeta
 * @property {string} [baselineTree]
 * @property {string} [projectRoot]
 * @property {string} [executionCwd]
 * @property {string} [worktreeId]
 * @property {string} [worktreeBranch]
 * @property {string} [worktreeBaseBranch]
 * @property {boolean} [nonGitInPlace]
 * @property {boolean} [validationContinuation]
 */

/**
 * @typedef {Object} DisposableLike
 * @property {() => void | Promise<void>} [dispose]
 */

/**
 * @typedef {Object} MinimalSessionManagerLike
 * @property {() => string} [getSessionId]
 * @property {() => string} [getCwd]
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
 * @property {unknown} [uiAPI]
 * @property {unknown} [eventSink]
 * @property {import('./session-runtime-interactions.js').RuntimeInteractionAdapter} [interactionAdapter]
 * @property {import('./session-runtime-interactions.js').RuntimeInteractionAdapterMeta} [interactionAdapterMeta]
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
        const id = getSessionManagerId(options?.sessionManager) || options?.id;
        if (!id) throw new Error("HostedSession requires an id");
        this.id = id;
        this.cwd = getSessionManagerCwd(options.sessionManager) || options.cwd || CWD;
        this.disposed = false;

        /** @type {AgentInfo[]} */
        this.agentInfoStack = [];
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
        this.activeUiAPI = options.uiAPI || null;
        /** @type {unknown} */
        this.eventSink = options.eventSink || null;
        /** @type {import('./session-runtime-interactions.js').RuntimeInteractionAdapter | null} */
        this.interactionAdapter = options.interactionAdapter || null;
        /** @type {import('./session-runtime-interactions.js').RuntimeInteractionAdapterMeta | null} */
        this.interactionAdapterMeta = options.interactionAdapterMeta || null;
        /** @type {Map<string, ActiveInteractionRecord>} */
        this.activeInteractions = new Map();
        /** @type {DisposableLike | null} */
        this.rootAgentSession = null;
        /** @type {string | null} */
        this.rootAgentName = null;
        /** @type {Set<DisposableLike>} */
        this.subAgentSessions = new Set();
        /** @type {PendingRootSwap | null} */
        this.pendingRootSwap = null;
        /** @type {PendingSwitchHandoff | null} */
        this.pendingSwitchHandoff = null;
        this.projectStateContext = "";
        /** @type {ActiveExecutionWorkflow | null} */
        this.activeExecutionWorkflow = null;
    }

    assertActive() {
        if (this.disposed) throw new Error(`HostedSession "${this.id}" is disposed`);
    }

    /** @param {string} displayName @param {string} [model] @param {string} [provider] */
    pushAgentInfo(displayName, model = "", provider = "") {
        this.assertActive();
        this.agentInfoStack.push({ displayName, model, provider });
    }

    popAgentInfo() {
        this.assertActive();
        this.agentInfoStack.pop();
    }

    /** @param {string} displayName @param {string} [model] @param {string} [provider] */
    resetAgentInfoStack(displayName, model = "", provider = "") {
        this.assertActive();
        this.agentInfoStack = [{ displayName, model, provider }];
    }

    getAgentInfoStack() {
        return this.agentInfoStack.map((agentInfo) => ({ ...agentInfo }));
    }

    getActiveAgentName() {
        if (this.agentInfoStack.length === 0) return "";
        return this.agentInfoStack[this.agentInfoStack.length - 1].displayName;
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

    /** @param {unknown} uiAPI */
    setActiveUiAPI(uiAPI) {
        this.assertActive();
        this.activeUiAPI = uiAPI;
    }

    getActiveUiAPIState() {
        return this.activeUiAPI;
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
     * @param {import('./session-runtime-interactions.js').RuntimeInteractionAdapterMeta | null} [meta]
     */
    setInteractionAdapter(adapter, meta = null) {
        this.assertActive();
        this.interactionAdapter = adapter;
        this.interactionAdapterMeta = meta;
    }

    getInteractionAdapter() {
        return this.interactionAdapter;
    }

    getInteractionAdapterMeta() {
        return this.interactionAdapterMeta;
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
        for (const record of this.activeInteractions.values()) {
            record.abortController?.abort();
        }
        this.interactionAdapter?.cancelAll?.();
        this.activeInteractions.clear();
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

    /** @param {PendingRootSwap | null} swap */
    setPendingRootSwap(swap) {
        this.assertActive();
        this.pendingRootSwap = swap;
    }

    getPendingRootSwap() {
        return this.pendingRootSwap;
    }

    /** @param {PendingSwitchHandoff | null} handoff */
    setPendingSwitchHandoff(handoff) {
        this.assertActive();
        this.pendingSwitchHandoff = handoff;
    }

    /** @returns {PendingSwitchHandoff | null} */
    consumePendingSwitchHandoff() {
        const handoff = this.pendingSwitchHandoff;
        if (!this.disposed) this.pendingSwitchHandoff = null;
        return handoff;
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

    /** @param {ActiveExecutionWorkflow | null} workflow */
    setActiveExecutionWorkflow(workflow) {
        this.assertActive();
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
        this.activeUiAPI = null;
        this.eventSink = null;
        this.interactionAdapter?.cancelAll?.();
        this.interactionAdapter = null;
        this.interactionAdapterMeta = null;
        this.activeInteractions.clear();
        this.rootAgentSession = null;
        this.rootAgentName = null;
        this.subAgentSessions.clear();
        this.pendingRootSwap = null;
        this.pendingSwitchHandoff = null;
        this.projectStateContext = "";
        this.activeExecutionWorkflow = null;
        this.disposed = true;
    }
}
