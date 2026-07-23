/**
 * @module shared/owner-coordination/devices
 * Revocable paired browser device credentials for owner Workspace.
 */

import { hashSecret, randomBase64Url, timingSafeSecretEqual } from "./crypto.js";

export const OWNER_DEVICE_COOKIE = "rw_owner_device";
export const OWNER_CSRF_COOKIE = "rw_owner_csrf";
export const OWNER_DEVICE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const OWNER_DEVICE_LAST_SEEN_TOUCH_INTERVAL_MS = 60_000;

/** @param {unknown} value */
function requireDatabase(value) {
    if (!value || typeof value !== "object" || !("handle" in value)) throw new Error("Owner database is required");
    return /** @type {import('./database.js').OwnerCoordinationDatabase} */ (value);
}

/** @param {() => string} [now] */
function isoNow(now) {
    return now ? now() : new Date().toISOString();
}

/** @param {unknown} value */
function timeMs(value) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
}

/** @param {() => string} [idFactory] */
function newId(idFactory) {
    return idFactory ? idFactory() : crypto.randomUUID();
}

/** @param {string} label */
export function normalizeDeviceLabel(label) {
    const normalized = String(label || "").replace(/\s+/g, " ").trim();
    return normalized.slice(0, 80) || "Browser device";
}

/** @param {any} row */
function deviceFromRow(row) {
    return {
        deviceId: row.id,
        label: row.label,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at,
        revokedReason: row.revoked_reason,
    };
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ label: string, idFactory?: () => string, now?: () => string, credentialFactory?: () => string, csrfFactory?: () => string }} options
 */
export function createPairedDevice(database, options) {
    const ownerDb = requireDatabase(database);
    const credential = options.credentialFactory ? options.credentialFactory() : randomBase64Url(32);
    const csrf = options.csrfFactory ? options.csrfFactory() : randomBase64Url(32);
    const deviceId = newId(options.idFactory);
    const now = isoNow(options.now);
    ownerDb.handle.prepare(
        "INSERT INTO paired_devices(id, label, credential_hash, csrf_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(deviceId, normalizeDeviceLabel(options.label), hashSecret(credential), hashSecret(csrf), now);
    return { deviceId, credential, csrf, device: getDeviceById(ownerDb, deviceId) };
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} deviceId
 */
export function getDeviceById(database, deviceId) {
    const row = requireDatabase(database).handle.prepare("SELECT * FROM paired_devices WHERE id = ?").get(deviceId);
    return row ? deviceFromRow(row) : null;
}

/** @param {import('./database.js').OwnerCoordinationDatabase} database */
export function listDevices(database) {
    return requireDatabase(database).handle.prepare("SELECT * FROM paired_devices ORDER BY created_at DESC").all().map(
        deviceFromRow,
    );
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} credential
 * @param {{ now?: () => string, touch?: boolean, touchIntervalMs?: number }} [options]
 */
export function verifyDeviceCredential(database, credential, options = {}) {
    const ownerDb = requireDatabase(database);
    const presentedHash = hashSecret(credential || "");
    const rows = ownerDb.handle.prepare("SELECT * FROM paired_devices WHERE revoked_at IS NULL").all();
    const row = rows.find((candidate) => timingSafeSecretEqual(String(candidate.credential_hash), presentedHash));
    if (!row) return null;
    if (options.touch !== false) {
        const now = isoNow(options.now);
        const touchIntervalMs = options.touchIntervalMs ?? OWNER_DEVICE_LAST_SEEN_TOUCH_INTERVAL_MS;
        if (!row.last_seen_at || timeMs(now) - timeMs(row.last_seen_at) >= touchIntervalMs) {
            ownerDb.handle.prepare("UPDATE paired_devices SET last_seen_at = ? WHERE id = ?").run(now, row.id);
            row.last_seen_at = now;
        }
    }
    return deviceFromRow(row);
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} deviceId
 * @param {string} csrf
 */
export function verifyDeviceCsrf(database, deviceId, csrf) {
    const row = requireDatabase(database).handle.prepare(
        "SELECT csrf_hash, revoked_at FROM paired_devices WHERE id = ?",
    ).get(deviceId);
    if (!row || row.revoked_at) return false;
    return timingSafeSecretEqual(String(row.csrf_hash), hashSecret(csrf || ""));
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} deviceId
 * @param {{ now?: () => string, reason?: string }} [options]
 */
export function revokeDevice(database, deviceId, options = {}) {
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    ownerDb.handle.prepare(
        "UPDATE paired_devices SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, ?) WHERE id = ?",
    ).run(now, String(options.reason || "revoked"), deviceId);
    return getDeviceById(ownerDb, deviceId);
}
