/**
 * @module shared/session/session-host
 * Registry and lifecycle owner for in-process Hosted Sessions.
 */

import { HostedSession } from "./hosted-session.js";

/**
 * @typedef {Object} SessionHostOptions
 * @property {() => string} [idFactory]
 */

/**
 * @typedef {Object} CreateSessionOptions
 * @property {string} [id]
 * @property {string} [cwd]
 * @property {import('./hosted-session.js').MinimalSessionManagerLike | null} [sessionManager]
 * @property {unknown} [uiAPI]
 * @property {unknown} [eventSink]
 */

/**
 * @typedef {Object} HostedSessionMetadata
 * @property {string} id
 * @property {string} cwd
 * @property {string | null} sessionManagerId
 * @property {boolean} disposed
 */

/** @param {unknown} sessionManager */
function getSessionManagerId(sessionManager) {
    if (
        !sessionManager || typeof sessionManager !== "object" || !("getSessionId" in sessionManager) ||
        typeof sessionManager.getSessionId !== "function"
    ) {
        return null;
    }
    const id = sessionManager.getSessionId();
    return typeof id === "string" && id ? id : null;
}

function createDefaultSessionId() {
    return crypto.randomUUID();
}

export class SessionHost {
    /** @param {SessionHostOptions} [options] */
    constructor(options = {}) {
        this.idFactory = options.idFactory || createDefaultSessionId;
        /** @type {Map<string, HostedSession>} */
        this.sessions = new Map();
    }

    /** @param {CreateSessionOptions} options */
    createSession(options = {}) {
        const id = getSessionManagerId(options.sessionManager) || options.id || this.idFactory();
        const hostedSession = new HostedSession({ ...options, id });
        return this.adoptSession(hostedSession);
    }

    /** @param {HostedSession} session */
    adoptSession(session) {
        if (!(session instanceof HostedSession)) throw new Error("SessionHost can only adopt HostedSession instances");
        if (this.sessions.has(session.id)) throw new Error(`HostedSession "${session.id}" already exists`);
        this.sessions.set(session.id, session);
        return session;
    }

    /** @param {string} id */
    getSession(id) {
        return this.sessions.get(id) || null;
    }

    /** @param {string} id */
    requireSession(id) {
        const session = this.getSession(id);
        if (!session) throw new Error(`HostedSession "${id}" was not found`);
        return session;
    }

    /** @returns {HostedSessionMetadata[]} */
    listSessions() {
        return Array.from(this.sessions.values()).map((session) => ({
            id: session.id,
            cwd: session.cwd,
            sessionManagerId: getSessionManagerId(session.getRootSessionManager()),
            disposed: session.disposed,
        }));
    }

    /** @param {string} id */
    disposeSession(id) {
        const session = this.sessions.get(id);
        if (!session) return false;
        session.dispose();
        this.sessions.delete(id);
        return true;
    }

    dispose() {
        for (const id of Array.from(this.sessions.keys())) this.disposeSession(id);
    }
}
