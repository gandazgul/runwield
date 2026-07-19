/** @module ui/workspace/server/remote-db */

import { DatabaseSync } from "node:sqlite";
import { REMOTE_SCHEMA_V1_SQL, REMOTE_SCHEMA_V2_SQL, REMOTE_SCHEMA_VERSION } from "./remote-schema.js";

/**
 * @typedef {Object} RemoteDatabase
 * @property {DatabaseSync} handle
 * @property {() => void} close
 * @property {<T>(callback: () => T) => T} transaction
 */

/**
 * @param {{ dbPath?: string }} [options]
 * @returns {RemoteDatabase}
 */
export function openRemoteDatabase(options = {}) {
    const db = new DatabaseSync(options.dbPath ?? ":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    if (options.dbPath && options.dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    runRemoteMigrations(db);
    return {
        handle: db,
        close: () => db.close(),
        transaction(callback) {
            db.exec("BEGIN IMMEDIATE");
            try {
                const result = callback();
                db.exec("COMMIT");
                return result;
            } catch (error) {
                db.exec("ROLLBACK");
                throw error;
            }
        },
    };
}

/** @param {DatabaseSync} db */
export function runRemoteMigrations(db) {
    db.exec("BEGIN IMMEDIATE");
    try {
        db.exec(REMOTE_SCHEMA_V1_SQL);
        const latestVersion = getLatestSchemaVersion(db);
        if (latestVersion > REMOTE_SCHEMA_VERSION) {
            throw new Error(
                `Remote Workspace database schema ${latestVersion} is newer than supported schema ${REMOTE_SCHEMA_VERSION}.`,
            );
        }
        recordMigration(db, 1);
        if (latestVersion < 2) {
            db.exec(REMOTE_SCHEMA_V2_SQL);
            recordMigration(db, 2);
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

/** @param {DatabaseSync} db */
function getLatestSchemaVersion(db) {
    const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
    return Number(row?.version ?? 0);
}

/** @param {DatabaseSync} db @param {number} version */
function recordMigration(db, version) {
    const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
    if (row) return;
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
    );
}
