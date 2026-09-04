/**
 * @module acp/session-map
 * ACP session id to SessionRuntime session-id mapping.
 */

const ACP_SESSION_PREFIX = "acp-";

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function normalizeAcpSessionIdForLoad(sessionId) {
    return sessionId.startsWith(ACP_SESSION_PREFIX) ? sessionId.slice(ACP_SESSION_PREFIX.length) : sessionId;
}

/**
 * @typedef {Object} AcpPromptRecord
 * @property {boolean} cancelled
 * @property {string} turnId
 * @property {string} [requestId]
 */

/**
 * @typedef {Object} AcpSessionRecord
 * @property {string} acpSessionId
 * @property {string} runtimeSessionId
 * @property {string} cwd
 * @property {AcpPromptRecord | null} activePrompt
 * @property {boolean} loaded
 * @property {number} usageCostUsd
 * @property {string} [persistedSessionId]
 * @property {string} [sessionPath]
 */

/**
 * @typedef {Object} CreateAcpSessionRecordOptions
 * @property {string} [acpSessionId]
 * @property {boolean} [loaded]
 * @property {string} [persistedSessionId]
 * @property {string} [sessionPath]
 */

export class AcpSessionMap {
    constructor() {
        /** @type {Map<string, AcpSessionRecord>} */
        this.records = new Map();
        /** @type {Map<string, string>} */
        this.acpIdsByRuntimeSessionId = new Map();
    }

    /**
     * @param {{ sessionId: string, cwd: string }} session
     * @param {CreateAcpSessionRecordOptions} [options]
     * @returns {AcpSessionRecord}
     */
    createRecord(session, options = {}) {
        const acpSessionId = options.acpSessionId ||
            `${ACP_SESSION_PREFIX}${options.persistedSessionId || session.sessionId}`;
        if (this.records.has(acpSessionId)) throw new Error(`ACP session already exists: ${acpSessionId}`);
        const record = {
            acpSessionId,
            runtimeSessionId: session.sessionId,
            cwd: session.cwd,
            activePrompt: null,
            loaded: Boolean(options.loaded),
            usageCostUsd: 0,
            ...(options.persistedSessionId ? { persistedSessionId: options.persistedSessionId } : {}),
            ...(options.sessionPath ? { sessionPath: options.sessionPath } : {}),
        };
        this.records.set(acpSessionId, record);
        this.acpIdsByRuntimeSessionId.set(session.sessionId, acpSessionId);
        return record;
    }

    /** @param {string} acpSessionId */
    getRecord(acpSessionId) {
        return this.records.get(acpSessionId) || null;
    }

    listRecords() {
        return Array.from(this.records.values());
    }

    /** @param {string} runtimeSessionId */
    getAcpSessionIdForRuntimeSession(runtimeSessionId) {
        return this.acpIdsByRuntimeSessionId.get(runtimeSessionId) || null;
    }

    /**
     * @param {string} acpSessionId
     */
    getRuntimeSessionId(acpSessionId) {
        return this.getRecord(acpSessionId)?.runtimeSessionId || null;
    }

    /**
     * @param {string} acpSessionId
     * @param {string} turnId
     * @param {string} [requestId]
     * @returns {AcpPromptRecord | null}
     */
    beginPrompt(acpSessionId, turnId, requestId = undefined) {
        const record = this.getRecord(acpSessionId);
        if (!record) return null;
        record.activePrompt = {
            cancelled: false,
            turnId,
            ...(requestId ? { requestId } : {}),
        };
        return record.activePrompt;
    }

    /**
     * Add one usage event's cost to the Session total and return the new total.
     *
     * ACP reports `cost.amount` as the cumulative Session cost, while the Runtime
     * emits the cost of a single assistant message, so the adapter keeps the sum.
     * The total belongs to the ACP Session, so it survives Runtime replacement.
     *
     * @param {string} acpSessionId
     * @param {number | undefined} costUsd
     * @returns {number}
     */
    addUsageCost(acpSessionId, costUsd) {
        const record = this.getRecord(acpSessionId);
        if (!record) return 0;
        if (typeof costUsd === "number" && Number.isFinite(costUsd)) record.usageCostUsd += costUsd;
        return record.usageCostUsd;
    }

    /**
     * @param {string} acpSessionId
     * @param {AcpPromptRecord} prompt
     */
    endPrompt(acpSessionId, prompt) {
        const record = this.getRecord(acpSessionId);
        if (!record || record.activePrompt !== prompt) return false;
        record.activePrompt = null;
        return true;
    }

    /**
     * @param {string} acpSessionId
     * @param {AcpPromptRecord} prompt
     */
    isCurrentPrompt(acpSessionId, prompt) {
        return this.getRecord(acpSessionId)?.activePrompt === prompt;
    }

    /**
     * Atomically remap a stable ACP id to a replacement Runtime session id.
     *
     * @param {string} acpSessionId
     * @param {{ sessionId: string, cwd?: string }} session
     */
    replaceRuntimeSession(acpSessionId, session) {
        const record = this.getRecord(acpSessionId);
        if (!record) return null;
        this.acpIdsByRuntimeSessionId.delete(record.runtimeSessionId);
        record.runtimeSessionId = session.sessionId;
        if (session.cwd) record.cwd = session.cwd;
        this.acpIdsByRuntimeSessionId.set(session.sessionId, acpSessionId);
        return record;
    }

    /** @param {string} acpSessionId */
    markCancelled(acpSessionId) {
        const record = this.getRecord(acpSessionId);
        if (!record?.activePrompt) return false;
        record.activePrompt.cancelled = true;
        return true;
    }

    /** @param {string} acpSessionId */
    deleteRecord(acpSessionId) {
        const record = this.records.get(acpSessionId);
        if (!record) return false;
        this.records.delete(acpSessionId);
        this.acpIdsByRuntimeSessionId.delete(record.runtimeSessionId);
        return true;
    }
}
