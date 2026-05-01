/**
 * @module shared/session-state
 * Single source of truth for interactive session state.
 */

/** @type {{
 * activeAgentName: string,
 * activeModel: string,
 * activeModelProvider: string,
 * activeOnMessage: ((userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI, sessionManager: import('@mariozechner/pi-coding-agent').SessionManager) => Promise<void>) | null,
 * rootSessionManager: import('@mariozechner/pi-coding-agent').SessionManager | null,
 * activeUiAPI: import('./workflow.js').UiAPI | null,
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

/** @param {((userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI, sessionManager: import('@mariozechner/pi-coding-agent').SessionManager) => Promise<void>) | null} handler */
export function setActiveOnMessage(handler) {
    state.activeOnMessage = handler;
}

export function getActiveOnMessage() {
    return state.activeOnMessage;
}

/** @param {import('@mariozechner/pi-coding-agent').SessionManager | null} sessionManager */
export function setRootSessionManager(sessionManager) {
    state.rootSessionManager = sessionManager;
}

export function getRootSessionManager() {
    return state.rootSessionManager;
}

/** @param {import('./workflow.js').UiAPI | null} uiAPI */
export function setActiveUiAPI(uiAPI) {
    state.activeUiAPI = uiAPI;
}

export function getActiveUiAPIState() {
    return state.activeUiAPI;
}
