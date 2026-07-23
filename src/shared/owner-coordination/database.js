/**
 * @module shared/owner-coordination/database
 * SQLite opener and migration runner for owner-only coordination state.
 */

import { DatabaseSync } from "node:sqlite";
import { dirname, extname } from "@std/path";
import { ensureOwnerDatabaseDirectory, getOwnerCoordinationDatabasePath } from "./paths.js";
import {
    OWNER_COORDINATION_SCHEMA_V1_SQL,
    OWNER_COORDINATION_SCHEMA_V2_SQL,
    OWNER_COORDINATION_SCHEMA_VERSION,
} from "./schema.js";

/**
 * @typedef {Object} OwnerCoordinationDatabase
 * @property {DatabaseSync} handle
 * @property {string} path
 * @property {() => void} close
 * @property {<T>(callback: () => T) => T} transaction
 */

/**
 * @typedef {Object} OpenOwnerDatabaseOptions
 * @property {string} [dbPath]
 * @property {() => string} [now]
 */

/**
 * @param {OpenOwnerDatabaseOptions} [options]
 * @returns {OwnerCoordinationDatabase}
 */
export function openOwnerCoordinationDatabase(options = {}) {
    const dbPath = options.dbPath || getOwnerCoordinationDatabasePath();
    ensureOwnerDatabaseDirectory(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
        db.exec("PRAGMA foreign_keys = ON");
        db.exec("PRAGMA busy_timeout = 5000");
        runOwnerCoordinationMigrations(db, { dbPath, now: options.now });
        if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
        return {
            handle: db,
            path: dbPath,
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
    } catch (error) {
        db.close();
        throw error;
    }
}

/**
 * @param {DatabaseSync} db
 * @param {{ dbPath?: string, existed?: boolean, now?: () => string }} [options]
 */
export function runOwnerCoordinationMigrations(db, options = {}) {
    const latestVersion = getLatestSchemaVersionIfPresent(db);
    if (latestVersion > OWNER_COORDINATION_SCHEMA_VERSION) {
        throw new Error(
            `Owner coordination database schema ${latestVersion} is newer than supported schema ${OWNER_COORDINATION_SCHEMA_VERSION}.`,
        );
    }
    db.exec("BEGIN IMMEDIATE");
    try {
        if (latestVersion > 0 && latestVersion < OWNER_COORDINATION_SCHEMA_VERSION && options.dbPath) {
            backupOwnerDatabase(options.dbPath, options.now);
        }
        if (latestVersion < 1) {
            db.exec(OWNER_COORDINATION_SCHEMA_V1_SQL);
            recordMigration(db, 1, options.now);
        }
        if (latestVersion < 2) {
            db.exec(OWNER_COORDINATION_SCHEMA_V2_SQL);
            recordMigration(db, 2, options.now);
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

/**
 * @param {DatabaseSync} db
 * @returns {number}
 */
export function getLatestOwnerCoordinationSchemaVersion(db) {
    return getLatestSchemaVersionIfPresent(db);
}

/**
 * @param {DatabaseSync} db
 * @returns {number}
 */
function getLatestSchemaVersionIfPresent(db) {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
        .get();
    if (!table) return 0;
    const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
    return Number(row?.version ?? 0);
}

/**
 * @param {DatabaseSync} db
 * @param {number} version
 * @param {() => string} [now]
 */
function recordMigration(db, version, now) {
    const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
    if (row) return;
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
        version,
        now ? now() : new Date().toISOString(),
    );
}

/**
 * @param {string} dbPath
 * @param {() => string} [now]
 */
/** @param {string} path */
function fileExists(path) {
    try {
        return Deno.statSync(path).isFile;
    } catch {
        return false;
    }
}

/**
 * @param {string} dbPath
 * @param {() => string} [now]
 */
function backupOwnerDatabase(dbPath, now) {
    if (!dbPath || dbPath === ":memory:" || !fileExists(dbPath)) return;
    const stamp = (now ? now() : new Date().toISOString()).replace(/[:.]/g, "-");
    const suffix = extname(dbPath) || ".sqlite3";
    const base = dbPath.slice(0, dbPath.length - suffix.length);
    const backupPath = `${base}.backup-${stamp}${suffix}`;
    Deno.mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
    Deno.copyFileSync(dbPath, backupPath);
}
