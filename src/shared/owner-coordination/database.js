/*
 * @module shared/owner-coordination/database
 * SQLite opener and migration runner for owner-only coordination state.
 */

import { DatabaseSync } from "node:sqlite";
import { dirname, extname } from "@std/path";
import { ensureOwnerDatabaseDirectory, getOwnerCoordinationDatabasePath } from "./paths.js";
import {
    OWNER_COORDINATION_SCHEMA_V1_SQL,
    OWNER_COORDINATION_SCHEMA_V2_SQL,
    OWNER_COORDINATION_SCHEMA_V3_SQL,
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
        db.exec("PRAGMA synchronous = FULL");
        runOwnerCoordinationMigrations(db, { dbPath, now: options.now });
        if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA synchronous = FULL");
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
 * @param {{ dbPath?: string, now?: () => string }} [options]
 */
export function runOwnerCoordinationMigrations(db, options = {}) {
    const latestVersion = getLatestSchemaVersionIfPresent(db);
    if (latestVersion > OWNER_COORDINATION_SCHEMA_VERSION) {
        throw new Error(
            `Owner coordination database schema ${latestVersion} is newer than supported schema ${OWNER_COORDINATION_SCHEMA_VERSION}.`,
        );
    }
    if (latestVersion > 0 && latestVersion < OWNER_COORDINATION_SCHEMA_VERSION && options.dbPath) {
        backupOwnerDatabase(db, options.dbPath, latestVersion, options.now);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
        const versionAtLock = getLatestSchemaVersionIfPresent(db);
        if (versionAtLock > OWNER_COORDINATION_SCHEMA_VERSION) {
            throw new Error(
                `Owner coordination database schema ${versionAtLock} is newer than supported schema ${OWNER_COORDINATION_SCHEMA_VERSION}.`,
            );
        }
        if (versionAtLock < 1) {
            db.exec(OWNER_COORDINATION_SCHEMA_V1_SQL);
            recordMigration(db, 1, options.now);
        }
        if (versionAtLock < 2) {
            db.exec(OWNER_COORDINATION_SCHEMA_V2_SQL);
            recordMigration(db, 2, options.now);
        }
        if (versionAtLock < 3) {
            db.exec(OWNER_COORDINATION_SCHEMA_V3_SQL);
            ensureDatabaseEpoch(db, options.now);
            recordMigration(db, 3, options.now);
        } else if (versionAtLock >= 3) {
            ensureDatabaseEpoch(db, options.now);
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
 * @returns {string | null}
 */
export function getOwnerCoordinationDatabaseEpoch(db) {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'owner_metadata'").get();
    if (!table) return null;
    const row = db.prepare("SELECT value FROM owner_metadata WHERE key = 'database_epoch'").get();
    return typeof row?.value === "string" ? row.value : null;
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
 * @param {DatabaseSync} db
 * @param {() => string} [now]
 */
function ensureDatabaseEpoch(db, now) {
    const existing = getOwnerCoordinationDatabaseEpoch(db);
    if (existing) return;
    db.prepare("INSERT INTO owner_metadata(key, value, updated_at) VALUES ('database_epoch', ?, ?)").run(
        crypto.randomUUID(),
        now ? now() : new Date().toISOString(),
    );
}

/** @param {string} path */
function fileExists(path) {
    try {
        return Deno.statSync(path).isFile;
    } catch {
        return false;
    }
}

/** @param {string} value */
function quoteSqlString(value) {
    return `'${value.replaceAll("'", "''")}'`;
}

/**
 * @param {string} dbPath
 * @param {number} sourceVersion
 * @param {() => string} [now]
 */
function backupPathFor(dbPath, sourceVersion, now) {
    const stamp = (now ? now() : new Date().toISOString()).replace(/[:.]/g, "-");
    const suffix = extname(dbPath) || ".sqlite3";
    const base = dbPath.slice(0, dbPath.length - suffix.length);
    return `${base}.backup-v${sourceVersion}-${stamp}${suffix}`;
}

/**
 * @param {DatabaseSync} db
 * @param {string} dbPath
 * @param {number} sourceVersion
 * @param {() => string} [now]
 */
function backupOwnerDatabase(db, dbPath, sourceVersion, now) {
    if (!dbPath || dbPath === ":memory:" || !fileExists(dbPath)) return;
    const backupPath = backupPathFor(dbPath, sourceVersion, now);
    Deno.mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
    db.exec(`VACUUM INTO ${quoteSqlString(backupPath)}`);
    try {
        Deno.chmodSync(backupPath, 0o600);
    } catch {
        // Some filesystems do not support chmod; creation location is still owner-only best effort.
    }
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
        const quickCheck = /** @type {{ quick_check: string }} */ (backup.prepare("PRAGMA quick_check").get());
        if (quickCheck.quick_check !== "ok") {
            throw new Error(`Owner coordination backup failed quick_check: ${backupPath}`);
        }
        const observedVersion = getLatestSchemaVersionIfPresent(backup);
        if (observedVersion !== sourceVersion) {
            throw new Error(
                `Owner coordination backup schema ${observedVersion} did not match source schema ${sourceVersion}: ${backupPath}`,
            );
        }
    } finally {
        backup.close();
    }
}
