/**
 * @module shared/session-state
 * Single source of truth for interactive session state.
 */

/**
 * @typedef {Object} PendingRootSwap
 * @property {string} agentName  Internal agent name (lowercase, matches agent definition filename).
 * @property {string} displayName  Display name as shown in the UI.
 * @property {string} [model]  Optional explicit model in provider/id format.
 */

/**
 * @typedef {Object} PendingSwitchHandoff
 * @property {string} agentName  Internal agent name of the target agent.
 * @property {string} reason  Message the calling agent crafted to seed the
 *   next agent's first turn. Sent as a user message after the root swap.
 */

/**
 * @typedef {Object} AgentInfo
 * @property {string} displayName
 * @property {string} model
 * @property {string} provider
 */

/** @type {{
 * agentInfoStack: AgentInfo[],
 * userModelOverrideId: string,
 * userModelOverrideProvider: string,
 * userModelOverride: boolean,
 * activeThinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
 * activeOnMessage: import('./types.js').AgentMessageHandler | null,
 * rootSessionManager: import('./session/types.js').SessionManagerLike | null,
 * activeUiAPI: import('./ui/types.js').UiAPI | null,
 * rootAgentSession: import('@earendil-works/pi-coding-agent').AgentSession | null,
 * rootAgentName: string | null,
 * subAgentSessions: Set<import('@earendil-works/pi-coding-agent').AgentSession>,
 * pendingRootSwap: PendingRootSwap | null,
 * pendingSwitchHandoff: PendingSwitchHandoff | null,
 * activeExecutionWorkflow: { planName: string, triageMeta: any, baselineTree?: string } | null,
 * }} */
const state = {
    // Initial placeholder; overwritten by startInteractiveSession() once the
    // agent definitions have been loaded and the real display name is known.
    agentInfoStack: [],
    userModelOverrideId: "",
    userModelOverrideProvider: "",
    userModelOverride: false,
    activeThinkingLevel: "off",
    activeOnMessage: null,
    rootSessionManager: null, // conversation history / persistence (pi SessionManager)
    rootAgentSession: null, // long-lived AgentSession for the user-facing agent (pi AgentSession)
    rootAgentName: null, // internal name of the agent the rootAgentSession was built for
    subAgentSessions: new Set(), // transient AgentSessions (workflow sub-agents, return_to_router triggers)
    pendingRootSwap: null, // recorded when setActiveAgent is called during an in-flight turn
    pendingSwitchHandoff: null, // recorded by return_to_router to seed Router's first turn
    activeUiAPI: null,
    activeExecutionWorkflow: null, // tracks FEATURE/PROJECT execution context until validation starts
};

/**
 * @param {string} displayName
 * @param {string} [model=""]
 * @param {string} [provider=""]
 */
export function pushAgentInfo(displayName, model = "", provider = "") {
    state.agentInfoStack.push({ displayName, model, provider });
}

export function popAgentInfo() {
    state.agentInfoStack.pop();
}

/**
 * @param {string} displayName
 * @param {string} [model=""]
 * @param {string} [provider=""]
 */
export function resetAgentInfoStack(displayName, model = "", provider = "") {
    state.agentInfoStack = [{ displayName, model, provider }];
}

export function getActiveAgentName() {
    if (state.agentInfoStack.length === 0) return "";
    return state.agentInfoStack[state.agentInfoStack.length - 1].displayName;
}

/**
 * @param {string} model
 * @param {string} [provider]
 * @param {boolean} [isUserOverride] - true when set explicitly via /model
 */
export function setActiveModelState(model, provider = "", isUserOverride = false) {
    if (isUserOverride) {
        state.userModelOverrideId = model;
        state.userModelOverrideProvider = provider;
        state.userModelOverride = true;
    } else {
        if (state.agentInfoStack.length > 0) {
            const top = state.agentInfoStack[state.agentInfoStack.length - 1];
            top.model = model;
            top.provider = provider;
        }
    }
}

export function getActiveModelState() {
    if (state.userModelOverride) {
        return { model: state.userModelOverrideId, provider: state.userModelOverrideProvider };
    }
    if (state.agentInfoStack.length === 0) return { model: "", provider: "" };
    const top = state.agentInfoStack[state.agentInfoStack.length - 1];
    return { model: top.model, provider: top.provider };
}

/** @returns {boolean} true when the active model was explicitly chosen by the user via /model */
export function isUserModelOverride() {
    return state.userModelOverride;
}

export function clearUserModelOverride() {
    state.userModelOverride = false;
    state.userModelOverrideId = "";
    state.userModelOverrideProvider = "";
}

/** @param {import('./types.js').AgentMessageHandler | null} handler */
export function setActiveOnMessage(handler) {
    state.activeOnMessage = handler;
}

export function getActiveOnMessage() {
    return state.activeOnMessage;
}

/** @param {import('./types.js').SessionManagerLike | null} sessionManager */
export function setRootSessionManager(sessionManager) {
    state.rootSessionManager = sessionManager;
}

export function getRootSessionManager() {
    return state.rootSessionManager;
}

/** @param {import('../ui/types.js').UiAPI | null} uiAPI */
export function setActiveUiAPI(uiAPI) {
    state.activeUiAPI = uiAPI;
}

export function getActiveUiAPIState() {
    return state.activeUiAPI;
}

/** @param {import('@earendil-works/pi-coding-agent').AgentSession | null} session */
export function setRootAgentSession(session) {
    state.rootAgentSession = session;
}

export function getRootAgentSession() {
    return state.rootAgentSession;
}

/** @param {string | null} agentName */
export function setRootAgentName(agentName) {
    state.rootAgentName = agentName;
}

export function getRootAgentName() {
    return state.rootAgentName;
}

/** @param {import('@earendil-works/pi-coding-agent').AgentSession} session */
export function addSubAgentSession(session) {
    state.subAgentSessions.add(session);
}

/** @param {import('@earendil-works/pi-coding-agent').AgentSession} session */
export function removeSubAgentSession(session) {
    state.subAgentSessions.delete(session);
}

export function getSubAgentSessions() {
    return state.subAgentSessions;
}

/** @param {PendingRootSwap | null} swap */
export function setPendingRootSwap(swap) {
    state.pendingRootSwap = swap;
}

export function getPendingRootSwap() {
    return state.pendingRootSwap;
}

/** @param {PendingSwitchHandoff | null} handoff */
export function setPendingSwitchHandoff(handoff) {
    state.pendingSwitchHandoff = handoff;
}

/**
 * Read and clear the pending return_to_router handoff (if any). Used by the
 * chat-session loop to feed Router's first turn after a return_to_router tool
 * call halts the previous agent.
 *
 * @returns {PendingSwitchHandoff | null}
 */
export function consumePendingSwitchHandoff() {
    const handoff = state.pendingSwitchHandoff;
    state.pendingSwitchHandoff = null;
    return handoff;
}

/**
 * @returns {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"}
 */
export function getThinkingLevel() {
    return state.activeThinkingLevel;
}

/**
 * @param {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"} level
 */
export function setThinkingLevel(level) {
    state.activeThinkingLevel = level;
}

export function getActiveExecutionWorkflow() {
    return state.activeExecutionWorkflow;
}

/** @param {{ planName: string, triageMeta: any, baselineTree?: string } | null} workflow */
export function setActiveExecutionWorkflow(workflow) {
    state.activeExecutionWorkflow = workflow;
}

export function clearActiveExecutionWorkflow() {
    state.activeExecutionWorkflow = null;
}
