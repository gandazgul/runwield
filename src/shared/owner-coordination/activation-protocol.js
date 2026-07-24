/*
 * @module shared/owner-coordination/activation-protocol
 * Owner-wide opt-in marker for Session activation protocol rollout.
 */

import { dirname, join } from "@std/path";
import { getOwnerCoordinationDatabaseEpoch } from "./database.js";

export const SESSION_ACTIVATION_PROTOCOL_VERSION = 1;
export const SESSION_ACTIVATION_MARKER_FILENAME = "session-activation-protocol.json";

/**
 * @typedef {Object} ActivationProtocolStatus
 * @property {boolean} enabled
 * @property {'enabled' | 'not_acknowledged' | 'missing_database_epoch' | 'missing_marker' | 'invalid_marker' | 'epoch_mismatch' | 'unsupported_version'} state
 * @property {string | null} databaseEpoch
 * @property {number | null} markerVersion
 * @property {string | null} markerEpoch
 * @property {string} markerPath
 */

/** @param {string} dbPath */
export function getActivationProtocolMarkerPath(dbPath) {
    return join(dirname(dbPath), SESSION_ACTIVATION_MARKER_FILENAME);
}

/** @param {string} markerPath */
function readMarker(markerPath) {
    try {
        return JSON.parse(Deno.readTextFileSync(markerPath));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        return { invalid: true };
    }
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @returns {ActivationProtocolStatus}
 */
export function getActivationProtocolStatus(database) {
    const databaseEpoch = getOwnerCoordinationDatabaseEpoch(database.handle);
    const markerPath = getActivationProtocolMarkerPath(database.path);
    if (!databaseEpoch) {
        return {
            enabled: false,
            state: "missing_database_epoch",
            databaseEpoch,
            markerVersion: null,
            markerEpoch: null,
            markerPath,
        };
    }
    const marker = readMarker(markerPath);
    if (!marker) {
        return {
            enabled: false,
            state: "missing_marker",
            databaseEpoch,
            markerVersion: null,
            markerEpoch: null,
            markerPath,
        };
    }
    if (marker.invalid || !marker || typeof marker !== "object") {
        return {
            enabled: false,
            state: "invalid_marker",
            databaseEpoch,
            markerVersion: null,
            markerEpoch: null,
            markerPath,
        };
    }
    const markerVersion = Number(marker.protocolVersion);
    const markerEpoch = typeof marker.databaseEpoch === "string" ? marker.databaseEpoch : null;
    if (markerVersion !== SESSION_ACTIVATION_PROTOCOL_VERSION) {
        return {
            enabled: false,
            state: "unsupported_version",
            databaseEpoch,
            markerVersion: Number.isFinite(markerVersion) ? markerVersion : null,
            markerEpoch,
            markerPath,
        };
    }
    if (markerEpoch !== databaseEpoch) {
        return { enabled: false, state: "epoch_mismatch", databaseEpoch, markerVersion, markerEpoch, markerPath };
    }
    return { enabled: true, state: "enabled", databaseEpoch, markerVersion, markerEpoch, markerPath };
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ now?: () => string }} [options]
 * @returns {ActivationProtocolStatus}
 */
export function acknowledgeActivationProtocol(database, options = {}) {
    const databaseEpoch = getOwnerCoordinationDatabaseEpoch(database.handle);
    if (!databaseEpoch) throw new Error("Owner database is missing an activation protocol epoch");
    const markerPath = getActivationProtocolMarkerPath(database.path);
    const body = JSON.stringify(
        {
            markerSchema: 1,
            protocolVersion: SESSION_ACTIVATION_PROTOCOL_VERSION,
            databaseEpoch,
            acknowledgedAt: options.now ? options.now() : new Date().toISOString(),
        },
        null,
        2,
    ) + "\n";
    Deno.mkdirSync(dirname(markerPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${markerPath}.${crypto.randomUUID()}.tmp`;
    Deno.writeTextFileSync(temporaryPath, body, { mode: 0o600 });
    try {
        Deno.chmodSync(temporaryPath, 0o600);
    } catch {
        // Best effort on filesystems without chmod.
    }
    Deno.renameSync(temporaryPath, markerPath);
    return getActivationProtocolStatus(database);
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @returns {ActivationProtocolStatus}
 */
export function requireActivationProtocolEnabled(database) {
    const status = getActivationProtocolStatus(database);
    if (!status.enabled) {
        throw new Error(`Session activation protocol is not enabled: ${status.state}`);
    }
    return status;
}
