/**
 * @module shared/session/session-runtime
 * Prompt loop boundary for HostedSession-based interactive turns.
 */

import { abortActiveSession as abortActiveSessionFn } from "./session.js";
import { SessionHost } from "./session-host.js";

export const HANDOFF_LIMIT_MESSAGE =
    "return_to_router handoff limit reached — refusing further chained handoffs in this turn.";

/**
 * @typedef {Object} SessionRuntimeOptions
 * @property {SessionHost} [sessionHost]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession, uiAPI: import('../../ui/tui/types.js').UiAPI | undefined) => Promise<void> | void} [applyPendingRootSwap]
 * @property {(hostedSession: import('./hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 */

/**
 * @typedef {Object} PromptSessionOptions
 * @property {import('../../ui/tui/types.js').UiAPI} [uiAPI]
 * @property {string} initialRequest
 * @property {import('./types.js').ImageAttachment[]} [initialImages]
 */

const MAX_CHAINED_HANDOFFS = 4;

export class SessionRuntime {
    /** @param {SessionRuntimeOptions} [options] */
    constructor(options = {}) {
        this.sessionHost = options.sessionHost || new SessionHost();
        this.applyPendingRootSwap = options.applyPendingRootSwap || (() => {});
        this.abortActiveSession = options.abortActiveSession || abortActiveSessionFn;
    }

    /** @param {import('./session-host.js').CreateSessionOptions} options */
    createSession(options = {}) {
        return this.sessionHost.createSession(options);
    }

    /** @param {import('./hosted-session.js').HostedSession} session */
    adoptSession(session) {
        return this.sessionHost.adoptSession(session);
    }

    listSessions() {
        return this.sessionHost.listSessions();
    }

    /** @param {string} id */
    closeSession(id) {
        return { ok: true, closed: this.sessionHost.disposeSession(id) };
    }

    /** @param {string | import('./hosted-session.js').HostedSession} sessionOrId */
    cancelSession(sessionOrId) {
        const session = typeof sessionOrId === "string" ? this.sessionHost.getSession(sessionOrId) : sessionOrId;
        if (!session) return { ok: false, aborted: false, error: "not_found" };
        return { ok: true, aborted: this.abortActiveSession(session) };
    }

    /**
     * @param {import('./hosted-session.js').HostedSession} hostedSession
     * @param {PromptSessionOptions} options
     * @returns {Promise<{ ok: boolean, turns: number, handoffs: number, handoffLimitReached: boolean, error?: string }>}
     */
    async promptSession(hostedSession, options) {
        const uiAPI = options.uiAPI;
        let request = options.initialRequest;
        let images = options.initialImages || [];
        let turns = 0;
        let handoffs = 0;

        if (!hostedSession.getActiveOnMessage() || !hostedSession.getRootSessionManager()) {
            uiAPI?.appendSystemMessage?.("Error: No active agent handler or session manager.");
            return {
                ok: false,
                turns,
                handoffs,
                handoffLimitReached: false,
                error: "missing_active_handler_or_session_manager",
            };
        }

        for (let turn = 0; turn <= MAX_CHAINED_HANDOFFS; turn++) {
            await this.applyPendingRootSwap(hostedSession, uiAPI);

            const handler = hostedSession.getActiveOnMessage();
            if (!handler) {
                uiAPI?.appendSystemMessage?.("Error: No active agent handler or session manager.");
                return {
                    ok: false,
                    turns,
                    handoffs,
                    handoffLimitReached: false,
                    error: "missing_active_handler_or_session_manager",
                };
            }

            await handler(request, images, uiAPI, hostedSession.getRootSessionManager() || undefined);
            turns++;

            const handoff = hostedSession.consumePendingSwitchHandoff();
            if (!handoff) {
                await this.applyPendingRootSwap(hostedSession, uiAPI);
                return { ok: true, turns, handoffs, handoffLimitReached: false };
            }

            if (turn === MAX_CHAINED_HANDOFFS) {
                uiAPI?.appendSystemMessage?.(HANDOFF_LIMIT_MESSAGE);
                return { ok: true, turns, handoffs, handoffLimitReached: true };
            }

            handoffs++;
            request = handoff.reason;
            images = [];
        }

        return { ok: true, turns, handoffs, handoffLimitReached: false };
    }
}
