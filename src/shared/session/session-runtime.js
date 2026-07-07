/**
 * @module shared/session/session-runtime
 * Adapter-neutral runtime façade over SessionHost and HostedSession.
 */

import { abortActiveSession } from "./session.js";
import { applyPendingRootSwap } from "./agent-switching.js";
import { HostedSession } from "./hosted-session.js";
import { SessionHost } from "./session-host.js";

const DEFAULT_HANDOFF_LIMIT = 4;
const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeOptions
 * @property {SessionHost} [sessionHost]
 * @property {number} [handoffLimit]
 * @property {(hostedSession: HostedSession, uiAPI?: any) => Promise<void>} [applyPendingRootSwap]
 * @property {(hostedSession: HostedSession) => boolean} [abortActiveSession]
 */

/**
 * @typedef {Object} RuntimePromptOptions
 * @property {string} [request]
 * @property {string} [initialRequest]
 * @property {import('./types.js').ImageAttachment[]} [images]
 * @property {import('./types.js').ImageAttachment[]} [initialImages]
 * @property {any} [uiAPI]
 */

/**
 * @typedef {Object} RuntimePromptResult
 * @property {boolean} ok
 * @property {number} turns
 * @property {number} handoffs
 * @property {boolean} handoffLimitReached
 * @property {string} [error]
 */

/**
 * @typedef {Object} RuntimeCancelResult
 * @property {boolean} ok
 * @property {boolean} aborted
 * @property {string} [error]
 */

/**
 * @typedef {Object} RuntimeCloseResult
 * @property {boolean} ok
 * @property {boolean} closed
 * @property {string} [error]
 */

/**
 * @param {HostedSession | string} sessionOrId
 * @returns {sessionOrId is HostedSession}
 */
function isHostedSession(sessionOrId) {
    return sessionOrId instanceof HostedSession;
}

export class SessionRuntime {
    /** @param {SessionRuntimeOptions} [options] */
    constructor(options = {}) {
        this.sessionHost = options.sessionHost || new SessionHost();
        this.handoffLimit = options.handoffLimit ?? DEFAULT_HANDOFF_LIMIT;
        this.applyPendingRootSwap = options.applyPendingRootSwap || applyPendingRootSwap;
        this.abortActiveSession = options.abortActiveSession || abortActiveSession;
    }

    /** @param {import('./session-host.js').CreateSessionOptions} [options] */
    createSession(options = {}) {
        return this.sessionHost.createSession(options);
    }

    /** @param {HostedSession} session */
    adoptSession(session) {
        return this.sessionHost.adoptSession(session);
    }

    /** @param {string} id */
    getSession(id) {
        return this.sessionHost.getSession(id);
    }

    /** @param {string} id */
    requireSession(id) {
        return this.sessionHost.requireSession(id);
    }

    listSessions() {
        return this.sessionHost.listSessions();
    }

    /**
     * @param {string} id
     * @returns {RuntimeCloseResult}
     */
    closeSession(id) {
        return { ok: true, closed: this.sessionHost.disposeSession(id) };
    }

    dispose() {
        this.sessionHost.dispose();
    }

    /**
     * @param {HostedSession | string} sessionOrId
     * @returns {HostedSession | null}
     */
    resolveSession(sessionOrId) {
        return isHostedSession(sessionOrId) ? sessionOrId : this.sessionHost.getSession(sessionOrId);
    }

    /**
     * Submit a prompt turn through the HostedSession's active Agent handler.
     *
     * @param {HostedSession | string} sessionOrId
     * @param {RuntimePromptOptions} options
     * @returns {Promise<RuntimePromptResult>}
     */
    async promptSession(sessionOrId, options) {
        const hostedSession = this.resolveSession(sessionOrId);
        if (!hostedSession) return { ok: false, turns: 0, handoffs: 0, handoffLimitReached: false, error: "not_found" };

        const uiAPI = options.uiAPI;
        let currentRequest = options.initialRequest ?? options.request ?? "";
        let currentImages = options.initialImages ?? options.images ?? [];
        let isHandoff = false;
        let handoffsLeft = this.handoffLimit;
        let turns = 0;
        let handoffs = 0;
        let handoffLimitReached = false;
        let error = "";

        try {
            while (true) {
                await this.applyPendingRootSwap(hostedSession, uiAPI);
                const activeOnMessage = hostedSession.getActiveOnMessage();
                const rootSessionManager = hostedSession.getRootSessionManager();
                if (!activeOnMessage || !rootSessionManager) {
                    error = "missing_active_handler_or_session_manager";
                    uiAPI?.appendSystemMessage?.("Error: No active agent handler or session manager.");
                    break;
                }
                hostedSession.setActiveUiAPI(uiAPI);
                if (isHandoff) {
                    uiAPI?.appendSystemMessage?.(currentRequest, false, "Handoff:");
                }
                turns++;
                await activeOnMessage(currentRequest, currentImages, uiAPI, rootSessionManager);

                const handoff = hostedSession.consumePendingSwitchHandoff();
                if (!handoff) break;
                if (handoffsLeft-- <= 0) {
                    handoffLimitReached = true;
                    uiAPI?.appendSystemMessage?.(HANDOFF_LIMIT_MESSAGE);
                    break;
                }
                handoffs++;
                currentRequest = handoff.reason;
                currentImages = [];
                isHandoff = true;
            }
        } finally {
            await this.applyPendingRootSwap(hostedSession, uiAPI);
        }

        return { ok: !error && !handoffLimitReached, turns, handoffs, handoffLimitReached, error: error || undefined };
    }

    /**
     * @param {HostedSession | string} sessionOrId
     * @returns {RuntimeCancelResult}
     */
    cancelSession(sessionOrId) {
        const hostedSession = this.resolveSession(sessionOrId);
        if (!hostedSession) return { ok: false, aborted: false, error: "not_found" };
        return { ok: true, aborted: this.abortActiveSession(hostedSession) };
    }
}

export { HANDOFF_LIMIT_MESSAGE };
