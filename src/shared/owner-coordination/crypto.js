/**
 * @module shared/owner-coordination/crypto
 * Secret generation and hashing helpers for owner-only coordination state.
 */

import { createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

const HUMAN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** @param {Uint8Array} bytes */
export function base64Url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** @param {number} byteLength */
export function randomBase64Url(byteLength) {
    return base64Url(randomBytes(byteLength));
}

/**
 * @param {number} length
 * @param {() => number} [random]
 */
export function randomHumanCode(length = 6, random) {
    if (random) {
        let code = "";
        for (let i = 0; i < length; i += 1) {
            code += HUMAN_CODE_ALPHABET[Math.floor(random() * HUMAN_CODE_ALPHABET.length) % HUMAN_CODE_ALPHABET.length];
        }
        return code;
    }
    let code = "";
    const limit = Math.floor(256 / HUMAN_CODE_ALPHABET.length) * HUMAN_CODE_ALPHABET.length;
    while (code.length < length) {
        for (const byte of randomBytes(length)) {
            if (byte >= limit) continue;
            code += HUMAN_CODE_ALPHABET[byte % HUMAN_CODE_ALPHABET.length];
            if (code.length === length) break;
        }
    }
    return code;
}

/** @param {string} value */
export function hashSecret(value) {
    return `sha256:${createHash("sha256").update(value).digest("base64url")}`;
}

/** @param {string} a @param {string} b */
export function timingSafeSecretEqual(a, b) {
    const left = new TextEncoder().encode(a);
    const right = new TextEncoder().encode(b);
    if (left.byteLength !== right.byteLength) return false;
    return nodeTimingSafeEqual(left, right);
}

/** @param {string} value */
export function normalizePairingCode(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
