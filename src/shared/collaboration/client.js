/** @module shared/collaboration/client */

import { redactSecrets } from "./capabilities.js";
import {
    normalizeAppendCommentPayload,
    normalizeAppendRevisionPayload,
    normalizeCreateSharedSpacePayload,
} from "./protocol.js";
import { buildApiUrl, normalizeServerUrl } from "./urls.js";

/**
 * @typedef {Object} CollaborationClientOptions
 * @property {string} serverUrl
 * @property {string} [bearerCapability]
 * @property {typeof fetch} [fetch]
 */

export class CollaborationApiError extends Error {
    /**
     * @param {string} message
     * @param {{ status?: number, payload?: unknown, secrets?: string[] }} [options]
     */
    constructor(message, options = {}) {
        super(redactSecrets(message, options.secrets));
        this.name = "CollaborationApiError";
        this.status = options.status;
        this.payload = redactPayload(options.payload, options.secrets);
    }
}

export class CollaborationClient {
    /** @param {CollaborationClientOptions} options */
    constructor(options) {
        this.serverUrl = normalizeServerUrl(options.serverUrl);
        this.bearerCapability = options.bearerCapability;
        const fetchFn = options.fetch ?? fetch;
        this.fetch = fetchFn.bind(globalThis);
    }

    /**
     * @param {string} path
     * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, auth?: boolean }} [options]
     * @returns {Promise<unknown>}
     */
    async requestJson(path, options = {}) {
        const url = buildApiUrl(this.serverUrl, path);
        /** @type {Record<string, string>} */
        const headers = {
            Accept: "application/json",
            ...(options.headers ?? {}),
        };
        if (options.auth !== false) {
            if (!this.bearerCapability) {
                throw new CollaborationApiError("Bearer capability is required for this Plan Server request.");
            }
            headers.Authorization = `Bearer ${this.bearerCapability}`;
        }
        /** @type {RequestInit} */
        const init = { method: options.method ?? "GET", headers };
        if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(options.body);
        }

        const secrets = this.bearerCapability ? [this.bearerCapability] : [];
        let response;
        try {
            response = await this.fetch(url, init);
        } catch (error) {
            throw new CollaborationApiError(`Network failure calling ${url}: ${redactSecrets(error, secrets)}`, {
                secrets,
            });
        }

        const text = await response.text();
        const payload = parseJsonOrUndefined(text);
        if (!response.ok) {
            const message = getErrorMessage(payload) ?? (text || response.statusText || "Request failed");
            throw new CollaborationApiError(`Plan Server error ${response.status}: ${message}`, {
                status: response.status,
                payload,
                secrets,
            });
        }
        return payload;
    }

    /** @param {import("./protocol.js").CreateSharedSpacePayload} payload */
    async createSharedSpace(payload) {
        return await this.requestJson("/api/spaces", {
            method: "POST",
            auth: false,
            body: normalizeCreateSharedSpacePayload(payload),
        });
    }

    /** @param {string} spaceId */
    async getSharedSpace(spaceId) {
        return await this.requestJson(`/api/spaces/${encodeURIComponent(spaceId)}`);
    }

    /** @param {string} spaceId @param {number} revision */
    async getRevision(spaceId, revision) {
        return await this.requestJson(`/api/spaces/${encodeURIComponent(spaceId)}/revisions/${revision}`);
    }

    /** @param {string} spaceId @param {import("./protocol.js").AppendRevisionPayload} payload */
    async appendRevision(spaceId, payload) {
        return await this.requestJson(`/api/spaces/${encodeURIComponent(spaceId)}/revisions`, {
            method: "POST",
            body: normalizeAppendRevisionPayload(payload),
        });
    }

    /** @param {string} spaceId @param {number} revision */
    async listComments(spaceId, revision) {
        return await this.requestJson(`/api/spaces/${encodeURIComponent(spaceId)}/revisions/${revision}/comments`);
    }

    /** @param {string} spaceId @param {number} revision @param {import("./protocol.js").AppendCommentPayload} payload */
    async appendComment(spaceId, revision, payload) {
        return await this.requestJson(`/api/spaces/${encodeURIComponent(spaceId)}/revisions/${revision}/comments`, {
            method: "POST",
            body: normalizeAppendCommentPayload(payload),
        });
    }

    /** @param {string} spaceId @param {string} commentId @param {{ action: "resolve" | "reopen" }} payload */
    async setCommentState(spaceId, commentId, payload) {
        return await this.requestJson(
            `/api/spaces/${encodeURIComponent(spaceId)}/comments/${encodeURIComponent(commentId)}/state`,
            {
                method: "POST",
                body: payload,
            },
        );
    }

    /** @param {string} spaceId @param {{ action: "close" | "delete" }} payload */
    async updateSharedSpaceLifecycle(spaceId, payload) {
        return await this.requestJson(`/api/spaces/${encodeURIComponent(spaceId)}/lifecycle`, {
            method: "POST",
            body: payload,
        });
    }
}

/** @param {CollaborationClientOptions} options */
export function createCollaborationClient(options) {
    return new CollaborationClient(options);
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJsonOrUndefined(text) {
    if (text.trim() === "") return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/**
 * @param {unknown} payload
 * @returns {string | undefined}
 */
function getErrorMessage(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    const record = /** @type {Record<string, unknown>} */ (payload);
    return typeof record.message === "string" ? record.message : undefined;
}

/**
 * @param {unknown} payload
 * @param {string[] | undefined} secrets
 * @returns {unknown}
 */
function redactPayload(payload, secrets) {
    if (typeof payload === "string") return redactSecrets(payload, secrets);
    if (!payload || typeof payload !== "object") return payload;
    if (Array.isArray(payload)) return payload.map((item) => redactPayload(item, secrets));
    /** @type {Record<string, unknown>} */
    const redacted = {};
    for (const [key, value] of Object.entries(payload)) redacted[key] = redactPayload(value, secrets);
    return redacted;
}
