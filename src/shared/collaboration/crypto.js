/** @module shared/collaboration/crypto */

import { decodeBase64Url, encodeBase64Url } from "./base64url.js";

const AES_GCM_ALGORITHM = "AES-GCM";
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;

/** @returns {Promise<CryptoKey>} */
export function generateContentKey() {
    return crypto.subtle.generateKey({ name: AES_GCM_ALGORITHM, length: KEY_LENGTH_BITS }, true, [
        "encrypt",
        "decrypt",
    ]);
}

/**
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function exportContentKey(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    const bytes = new Uint8Array(raw);
    if (bytes.byteLength !== 32) throw new Error("Content key must be 256-bit AES key material");
    return encodeBase64Url(bytes);
}

/**
 * @param {string} value
 * @returns {Promise<CryptoKey>}
 */
export async function importContentKey(value) {
    const bytes = decodeBase64Url(value);
    if (bytes.byteLength !== 32) throw new Error("Content key must be 32 bytes of base64url key material");
    const keyBytes = new Uint8Array(bytes);
    return await crypto.subtle.importKey(
        "raw",
        keyBytes.buffer,
        { name: AES_GCM_ALGORITHM, length: KEY_LENGTH_BITS },
        true,
        [
            "encrypt",
            "decrypt",
        ],
    );
}

/**
 * @param {unknown} payload
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function encryptJsonPayload(payload, key) {
    const iv = new Uint8Array(IV_LENGTH_BYTES);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: AES_GCM_ALGORITHM, iv }, key, plaintext));
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(ciphertext, iv.byteLength);
    return encodeBase64Url(combined);
}

/**
 * @param {string} encryptedPayload
 * @param {CryptoKey} key
 * @returns {Promise<unknown>}
 */
export async function decryptJsonPayload(encryptedPayload, key) {
    try {
        const combined = decodeBase64Url(encryptedPayload);
        if (combined.byteLength <= IV_LENGTH_BYTES + 16) throw new Error("Encrypted payload is truncated");
        const iv = combined.slice(0, IV_LENGTH_BYTES);
        const ciphertext = combined.slice(IV_LENGTH_BYTES);
        const plaintext = await crypto.subtle.decrypt({ name: AES_GCM_ALGORITHM, iv }, key, ciphertext);
        return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (error) {
        throw new Error(
            `Unable to decrypt collaboration payload: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/** @returns {Promise<string>} */
export async function generateContentKeyString() {
    return exportContentKey(await generateContentKey());
}
