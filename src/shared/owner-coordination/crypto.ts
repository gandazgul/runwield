/**
 * @module shared/owner-coordination/crypto
 * Secret generation and hashing helpers for owner-only coordination state.
 */

import { createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

const HUMAN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function base64Url(bytes: Uint8Array) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomBase64Url(byteLength: number) {
    return base64Url(randomBytes(byteLength));
}

/**
 * @param length
 * @param random
 */
export function randomHumanCode(length = 6, random?: () => number) {
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

export function hashSecret(value: string) {
    return `sha256:${createHash("sha256").update(value).digest("base64url")}`;
}

export function timingSafeSecretEqual(a: string, b: string) {
    const left = new TextEncoder().encode(a);
    const right = new TextEncoder().encode(b);
    if (left.byteLength !== right.byteLength) return false;
    return nodeTimingSafeEqual(left, right);
}

export function normalizePairingCode(value: string) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
