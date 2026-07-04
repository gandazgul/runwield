/** @module shared/collaboration/capabilities */

import { encodeBase64Url } from "./base64url.js";

export const REVIEWER_SCOPE = "reviewer";
export const MAINTAINER_SCOPE = "maintainer";
export const CAPABILITY_SCOPES = Object.freeze([REVIEWER_SCOPE, MAINTAINER_SCOPE]);

/**
 * @param {unknown} scope
 * @returns {"reviewer" | "maintainer"}
 */
export function assertCapabilityScope(scope) {
    if (scope !== REVIEWER_SCOPE && scope !== MAINTAINER_SCOPE) {
        throw new Error("Capability scope must be reviewer or maintainer");
    }
    return scope;
}

/** @returns {string} */
export function generateBearerCapability() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return encodeBase64Url(bytes);
}

/**
 * @param {string} capability
 * @returns {Promise<string>}
 */
export async function hashCapability(capability) {
    if (typeof capability !== "string" || capability.length === 0) {
        throw new Error("Capability must be a non-empty string");
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability));
    return `sha256:${encodeBase64Url(new Uint8Array(digest))}`;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
    const left = new TextEncoder().encode(a);
    const right = new TextEncoder().encode(b);
    let diff = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
    return diff === 0;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function redactCapabilityValue(value) {
    if (typeof value !== "string" || value.length === 0) return "[redacted]";
    if (value.startsWith("sha256:")) return "sha256:[redacted]";
    return "[redacted-capability]";
}

/**
 * @param {unknown} value
 * @param {string[]} [knownSecrets]
 * @returns {string}
 */
export function redactSecrets(value, knownSecrets = []) {
    let text = value instanceof Error ? value.message : String(value);
    text = text.replace(/(Authorization\s*:\s*Bearer\s+)[^\s,}]+/gi, "$1[redacted]");
    text = text.replace(/(cap=)[^&#\s]+/gi, "$1[redacted]");
    text = text.replace(/(key=)[^&#\s]+/gi, "$1[redacted]");
    text = text.replace(/sha256:[A-Za-z0-9_-]+/g, "sha256:[redacted]");
    text = text.replace(/\b[A-Za-z0-9_-]{43}\b/g, "[redacted-capability]");
    for (const secret of knownSecrets) {
        if (typeof secret !== "string" || secret.length === 0) continue;
        text = text.replaceAll(secret, redactCapabilityValue(secret));
    }
    return text;
}
