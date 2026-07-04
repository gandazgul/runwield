/** @module shared/collaboration/client */

import { redactSecrets } from "./capabilities.js";
import { buildApiUrl, normalizeServerUrl } from "./urls.js";

/**
 * @typedef {Object} CollaborationClientOptions
 * @property {string} serverUrl
 * @property {string} bearerCapability
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
        this.fetch = options.fetch ?? fetch;
    }

    /**
     * @param {string} path
     * @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [options]
     * @returns {Promise<unknown>}
     */
    async requestJson(path, options = {}) {
        const url = buildApiUrl(this.serverUrl, path);
        /** @type {Record<string, string>} */
        const headers = {
            Accept: "application/json",
            Authorization: `Bearer ${this.bearerCapability}`,
            ...(options.headers ?? {}),
        };
        /** @type {RequestInit} */
        const init = { method: options.method ?? "GET", headers };
        if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(options.body);
        }

        let response;
        try {
            response = await this.fetch(url, init);
        } catch (error) {
            throw new CollaborationApiError(
                `Network failure calling ${url}: ${redactSecrets(error, [this.bearerCapability])}`,
                {
                    secrets: [this.bearerCapability],
                },
            );
        }

        const text = await response.text();
        const payload = parseJsonOrUndefined(text);
        if (!response.ok) {
            const message = getErrorMessage(payload) ?? (text || response.statusText || "Request failed");
            throw new CollaborationApiError(`Plan Server error ${response.status}: ${message}`, {
                status: response.status,
                payload,
                secrets: [this.bearerCapability],
            });
        }
        return payload;
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
