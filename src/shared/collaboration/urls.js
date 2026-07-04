/** @module shared/collaboration/urls */

import { assertCapabilityScope, redactSecrets } from "./capabilities.js";
import { assertNonEmptyString } from "./protocol.js";

/**
 * @typedef {Object} CollaborationUrlParts
 * @property {string} serverUrl
 * @property {string} apiBaseUrl
 * @property {string} spaceId
 * @property {string} contentKey
 * @property {string} bearerCapability
 * @property {"reviewer" | "maintainer"} role
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeServerUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Plan Server URL must be http or https");
    if (url.search) throw new Error("Plan Server URL must not include query parameters");
    if (url.hash) throw new Error("Plan Server URL must not include a fragment");
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}

/**
 * @param {{ serverUrl: string, spaceId: string, contentKey: string, bearerCapability: string, role: "reviewer" | "maintainer" }} parts
 * @returns {string}
 */
export function buildCollaborationUrl(parts) {
    const serverUrl = normalizeServerUrl(parts.serverUrl);
    const spaceId = encodeURIComponent(assertNonEmptyString(parts.spaceId, "spaceId"));
    const url = new URL(`${serverUrl}/p/${spaceId}`);
    const fragment = new URLSearchParams();
    fragment.set("key", assertNonEmptyString(parts.contentKey, "contentKey"));
    fragment.set("cap", assertNonEmptyString(parts.bearerCapability, "bearerCapability"));
    fragment.set("role", assertCapabilityScope(parts.role));
    url.hash = fragment.toString();
    return url.toString();
}

/**
 * @param {string} value
 * @returns {CollaborationUrlParts}
 */
export function parseCollaborationUrl(value) {
    const url = new URL(value);
    const match = /^(.*)\/p\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) throw new Error("Collaboration URL path must be /p/<space-id>");
    const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const contentKey = fragment.get("key");
    const bearerCapability = fragment.get("cap");
    const role = fragment.get("role");
    if (!contentKey || !bearerCapability || !role) {
        throw new Error("Collaboration URL fragment must include key, cap, and role");
    }
    url.hash = "";
    url.pathname = match[1] || "";
    url.search = "";
    const serverUrl = normalizeServerUrl(url.toString());
    return {
        serverUrl,
        apiBaseUrl: serverUrl,
        spaceId: decodeURIComponent(match[2]),
        contentKey,
        bearerCapability,
        role: assertCapabilityScope(role),
    };
}

/**
 * @param {string} value
 * @returns {string}
 */
export function redactCollaborationUrl(value) {
    return redactSecrets(value).replace(/#.*$/, "#[redacted]");
}

/**
 * @param {string} serverUrl
 * @param {string} path
 * @returns {string}
 */
export function buildApiUrl(serverUrl, path) {
    const normalizedPath = normalizeApiPath(path);
    const base = `${normalizeServerUrl(serverUrl)}/`;
    const url = new URL(normalizedPath, base);
    url.hash = "";
    return url.toString();
}

/**
 * @param {string} path
 * @returns {string}
 */
function normalizeApiPath(path) {
    const trimmed = assertNonEmptyString(path, "path");
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) || trimmed.startsWith("//") || trimmed.includes("\\")) {
        throw new Error("API path must be relative to the Plan Server URL");
    }
    const normalizedPath = trimmed.replace(/^\/+/, "");
    if (normalizedPath.split("/").some((segment) => segment === "." || segment === "..")) {
        throw new Error("API path must stay within the Plan Server URL");
    }
    return normalizedPath;
}
