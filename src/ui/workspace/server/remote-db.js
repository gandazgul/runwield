/** @module ui/workspace/server/remote-db */

import { DatabaseSync } from "node:sqlite";
import { REMOTE_SCHEMA_SQL, REMOTE_SCHEMA_VERSION } from "./remote-schema.js";

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
    db.exec(REMOTE_SCHEMA_SQL);
    const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(REMOTE_SCHEMA_VERSION);
    if (!row) {
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
            REMOTE_SCHEMA_VERSION,
            new Date().toISOString(),
        );
    }
}
