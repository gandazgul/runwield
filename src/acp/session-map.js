/**
 * @module acp/session-map
 * ACP session id to HostedSession state mapping.
 */

const ACP_SESSION_PREFIX = "acp-";

/**
 * @typedef {Object} AcpPromptRecord
 * @property {boolean} cancelled
 * @property {Promise<{ stopReason: "cancelled" }>} cancellation
 * @property {() => void} resolveCancellation
 * @property {string} [requestId]
 */

/**
 * @typedef {Object} AcpSessionRecord
 * @property {string} acpSessionId
 * @property {string} hostedSessionId
 * @property {string} cwd
 * @property {AcpPromptRecord | null} activePrompt
 */

export class AcpSessionMap {
    constructor() {
        /** @type {Map<string, AcpSessionRecord>} */
        this.records = new Map();
        /** @type {Map<string, string>} */
        this.acpIdsByHostedSessionId = new Map();
    }

    /**
     * @param {import('../shared/session/hosted-session.js').HostedSession} hostedSession
     * @returns {AcpSessionRecord}
     */
    createRecord(hostedSession) {
        const acpSessionId = `${ACP_SESSION_PREFIX}${hostedSession.id}`;
        const record = {
            acpSessionId,
            hostedSessionId: hostedSession.id,
            cwd: hostedSession.cwd,
            activePrompt: null,
        };
        this.records.set(acpSessionId, record);
        this.acpIdsByHostedSessionId.set(hostedSession.id, acpSessionId);
        return record;
    }

    /** @param {string} acpSessionId */
    getRecord(acpSessionId) {
        return this.records.get(acpSessionId) || null;
    }

    /** @param {string} hostedSessionId */
    getAcpSessionIdForHostedSession(hostedSessionId) {
        return this.acpIdsByHostedSessionId.get(hostedSessionId) || null;
    }

    /**
     * @param {string} acpSessionId
     * @param {import('../shared/session/session-runtime.js').SessionRuntime} runtime
     */
    getHostedSession(acpSessionId, runtime) {
        const record = this.getRecord(acpSessionId);
        if (!record) return null;
        return runtime.getSession(record.hostedSessionId);
    }

    /**
     * @param {string} acpSessionId
     * @param {string} [requestId]
     * @returns {AcpPromptRecord | null}
     */
    beginPrompt(acpSessionId, requestId = undefined) {
        const record = this.getRecord(acpSessionId);
        if (!record || record.activePrompt) return null;
        /** @type {() => void} */
        let resolveCancellation = () => {};
        const cancellation = new Promise((resolve) => {
            resolveCancellation = () => resolve({ stopReason: "cancelled" });
        });
        record.activePrompt = {
            cancelled: false,
            cancellation,
            resolveCancellation,
            ...(requestId ? { requestId } : {}),
        };
        return record.activePrompt;
    }

    /** @param {string} acpSessionId */
    endPrompt(acpSessionId) {
        const record = this.getRecord(acpSessionId);
        if (record) record.activePrompt = null;
    }

    /** @param {string} acpSessionId */
    markCancelled(acpSessionId) {
        const record = this.getRecord(acpSessionId);
        if (!record?.activePrompt) return false;
        record.activePrompt.cancelled = true;
        record.activePrompt.resolveCancellation();
        return true;
    }

    /** @param {string} acpSessionId */
    getCancellation(acpSessionId) {
        return this.getRecord(acpSessionId)?.activePrompt?.cancellation || null;
    }

    /** @param {string} acpSessionId */
    isPromptCancelled(acpSessionId) {
        return Boolean(this.getRecord(acpSessionId)?.activePrompt?.cancelled);
    }

    /** @param {string} acpSessionId */
    hasActivePrompt(acpSessionId) {
        return Boolean(this.getRecord(acpSessionId)?.activePrompt);
    }

    /** @param {string} acpSessionId */
    deleteRecord(acpSessionId) {
        const record = this.records.get(acpSessionId);
        if (!record) return false;
        this.records.delete(acpSessionId);
        this.acpIdsByHostedSessionId.delete(record.hostedSessionId);
        return true;
    }
}
