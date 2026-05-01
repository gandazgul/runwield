/**
 * @module shared/session-state
 * Single source of truth for interactive session state.
 */

/** @type {{
 * activeAgentName: string,
 * activeModel: string,
 * activeModelProvider: string,
 * activeOnMessage: import('./types.js').AgentMessageHandler | null,
 * rootSessionManager: import('./session/types.js').SessionManagerLike | null,
 * activeUiAPI: import('./ui/types.js').UiAPI | null,
 * }} */
const state = {
    activeAgentName: "Router",
    activeModel: "",
    activeModelProvider: "",
    activeOnMessage: null,
    rootSessionManager: null,
    activeUiAPI: null,
};

export function getActiveAgentName() {
    return state.activeAgentName;
}

/** @param {string} name */
export function setActiveAgentName(name) {
    state.activeAgentName = name;
}

/**
 * @param {string} model
 * @param {string} [provider]
 */
export function setActiveModelState(model, provider = "") {
    state.activeModel = model;
    if (provider) state.activeModelProvider = provider;
}

export function getActiveModelState() {
    return { model: state.activeModel, provider: state.activeModelProvider };
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
