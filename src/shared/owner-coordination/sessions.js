/**
 * @module shared/owner-coordination/sessions
 * Stable RunWield Session catalog APIs for owner coordination.
 */

import { isAbsolute, join, resolve } from "@std/path";
import {
    getRunWieldSessionDir,
    isPathInside,
    listCatalogSafeRootSessionLocators,
    readCatalogSafeRootSessionLocator,
} from "../session/root-session.js";
import { getProjectById, listProjectRootEvidence } from "./projects.js";

/**
 * @typedef {Object} CatalogedSession
 * @property {string} runwieldSessionId
 * @property {string} projectId
 * @property {string | null} displayName
 * @property {string} source
 * @property {string} piSessionId
 * @property {string} transcriptPath
 * @property {string} transcriptCwd
 * @property {number | null} headerVersion
 * @property {string | null} headerTimestamp
 * @property {string} firstCatalogedAt
 * @property {string} lastCatalogedAt
 */

/**
 * @typedef {Object} CatalogDiagnostic
 * @property {string} sessionPath
 * @property {string} code
 * @property {string} message
 */

/** @param {unknown} value */
function requireDatabase(value) {
    if (!value || typeof value !== "object" || !("handle" in value)) throw new Error("Owner database is required");
    return /** @type {import('./database.js').OwnerCoordinationDatabase} */ (value);
}

/** @param {() => string} [now] */
function isoNow(now) {
    return now ? now() : new Date().toISOString();
}

/** @param {() => string} [idFactory] */
function newId(idFactory) {
    return idFactory ? idFactory() : crypto.randomUUID();
}

/** @param {any} row */
function sessionFromRow(row) {
    return {
        runwieldSessionId: row.runwield_session_id,
        projectId: row.project_id,
        displayName: row.display_name,
        source: row.source,
        piSessionId: row.pi_session_id,
        transcriptPath: row.transcript_path,
        transcriptCwd: row.transcript_cwd,
        headerVersion: row.header_version,
        headerTimestamp: row.header_timestamp,
        firstCatalogedAt: row.first_cataloged_at,
        lastCatalogedAt: row.last_cataloged_at,
    };
}

/** @param {Date | null} value */
function mtimeMs(value) {
    return value ? Math.trunc(value.getTime()) : null;
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} projectId
 * @returns {Set<string>}
 */
function listKnownTranscriptPaths(database, projectId) {
    const rows = database.handle.prepare(
        "SELECT transcript_path FROM session_transcript_locators WHERE project_id = ?",
    ).all(projectId);
    return new Set(rows.map((row) => resolve(String(row.transcript_path))));
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} projectId
 * @param {string} cwd
 * @param {string} sessionDir
 * @param {number | null} dirMtimeMs
 * @param {number} jsonlCount
 * @returns {boolean}
 */
function shouldIncrementallyScan(database, projectId, cwd, sessionDir, dirMtimeMs, jsonlCount) {
    const row = database.handle.prepare(
        "SELECT last_scanned_dir_mtime_ms, last_scanned_jsonl_count FROM project_session_catalog_scans WHERE project_id = ? AND cwd = ? AND session_dir = ?",
    ).get(projectId, cwd, sessionDir);
    if (!row) return true;
    return Number(row.last_scanned_dir_mtime_ms) !== Number(dirMtimeMs) ||
        Number(row.last_scanned_jsonl_count) !== jsonlCount;
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} projectId
 * @param {string} cwd
 * @param {string} sessionDir
 * @param {number | null} dirMtimeMs
 * @param {number} jsonlCount
 * @param {string} now
 */
function recordCatalogScan(database, projectId, cwd, sessionDir, dirMtimeMs, jsonlCount, now) {
    database.handle.prepare(
        "INSERT INTO project_session_catalog_scans(project_id, cwd, session_dir, last_scanned_dir_mtime_ms, last_scanned_jsonl_count, last_scanned_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, cwd) DO UPDATE SET session_dir = excluded.session_dir, last_scanned_dir_mtime_ms = excluded.last_scanned_dir_mtime_ms, last_scanned_jsonl_count = excluded.last_scanned_jsonl_count, last_scanned_at = excluded.last_scanned_at",
    ).run(projectId, cwd, sessionDir, dirMtimeMs, jsonlCount, now);
}

/** @param {string} path */
async function inspectSessionDirectory(path) {
    try {
        const stat = await Deno.stat(path);
        if (!stat.isDirectory) return null;
        let jsonlCount = 0;
        for await (const entry of Deno.readDir(path)) {
            if ((entry.isFile || entry.isSymlink) && entry.name.endsWith(".jsonl")) jsonlCount++;
        }
        return { stat, jsonlCount };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

/**
 * @param {string} cwd
 * @param {string} sessionDir
 * @param {Set<string>} knownTranscriptPaths
 * @returns {Promise<{ locators: import('../session/root-session.js').CatalogSafeRootSessionLocator[], diagnostics: CatalogDiagnostic[], dirMtimeMs: number | null, scanned: boolean }>}
 */
async function listIncrementalRootSessionLocators(cwd, sessionDir, knownTranscriptPaths) {
    /** @type {import('../session/root-session.js').CatalogSafeRootSessionLocator[]} */
    const locators = [];
    /** @type {CatalogDiagnostic[]} */
    const diagnostics = [];
    let stat;
    try {
        stat = await Deno.stat(sessionDir);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { locators, diagnostics, dirMtimeMs: null, scanned: false };
        throw error;
    }
    for await (const entry of Deno.readDir(sessionDir)) {
        if (!(entry.isFile || entry.isSymlink) || !entry.name.endsWith(".jsonl")) continue;
        const sessionPath = join(sessionDir, entry.name);
        if (knownTranscriptPaths.has(resolve(sessionPath))) continue;
        try {
            locators.push(await readCatalogSafeRootSessionLocator({ cwd, sessionDir, sessionPath }));
        } catch (error) {
            diagnostics.push({
                sessionPath,
                code: "invalid_locator",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    locators.sort((a, b) => a.sessionPath.localeCompare(b.sessionPath));
    return { locators, diagnostics, dirMtimeMs: mtimeMs(stat.mtime), scanned: true };
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ projectId: string, piSessionId: string, transcriptPath: string, transcriptCwd: string }} locator
 */
async function validateGuardedLocator(database, locator) {
    const rootEvidence = listProjectRootEvidence(database, locator.projectId);
    const matchingRoot = rootEvidence.find((root) => isLocatorForRoot(locator.transcriptCwd, root));
    if (!matchingRoot) {
        throw new Error(`Transcript cwd does not match Project root evidence: ${locator.transcriptCwd}`);
    }
    const sessionDir = getRunWieldSessionDir(locator.transcriptCwd);
    if (!isPathInside(locator.transcriptPath, sessionDir)) {
        throw new Error(`Transcript path is outside the RunWield session directory for cwd: ${locator.transcriptPath}`);
    }
    const safeLocator = await readCatalogSafeRootSessionLocator({
        cwd: locator.transcriptCwd,
        sessionDir,
        sessionPath: locator.transcriptPath,
    });
    if (safeLocator.piSessionId !== locator.piSessionId) {
        throw new Error(`Transcript header Pi session id does not match locator: ${locator.piSessionId}`);
    }
    if (!isLocatorForRoot(safeLocator.headerCwd, matchingRoot)) {
        throw new Error(`Transcript header cwd does not match Project root evidence: ${safeLocator.headerCwd}`);
    }
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} runwieldSessionId
 * @returns {CatalogedSession | null}
 */
export function getSessionById(database, runwieldSessionId) {
    const db = requireDatabase(database).handle;
    const row = db.prepare(
        `SELECT runwield_sessions.id AS runwield_session_id,
                runwield_sessions.project_id,
                runwield_sessions.display_name,
                runwield_sessions.source,
                session_transcript_locators.pi_session_id,
                session_transcript_locators.transcript_path,
                session_transcript_locators.transcript_cwd,
                session_transcript_locators.header_version,
                session_transcript_locators.header_timestamp,
                session_transcript_locators.first_cataloged_at,
                session_transcript_locators.last_cataloged_at
           FROM runwield_sessions
           JOIN session_transcript_locators ON session_transcript_locators.runwield_session_id = runwield_sessions.id
          WHERE runwield_sessions.id = ?`,
    ).get(runwieldSessionId);
    return row ? sessionFromRow(row) : null;
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ transcriptPath?: string, projectId?: string, piSessionId?: string }} locator
 * @returns {CatalogedSession | null}
 */
export function findSessionByLocator(database, locator) {
    const db = requireDatabase(database).handle;
    let row;
    if (locator.transcriptPath) {
        row = db.prepare(
            `SELECT runwield_sessions.id AS runwield_session_id,
                    runwield_sessions.project_id,
                    runwield_sessions.display_name,
                    runwield_sessions.source,
                    session_transcript_locators.pi_session_id,
                    session_transcript_locators.transcript_path,
                    session_transcript_locators.transcript_cwd,
                    session_transcript_locators.header_version,
                    session_transcript_locators.header_timestamp,
                    session_transcript_locators.first_cataloged_at,
                    session_transcript_locators.last_cataloged_at
               FROM session_transcript_locators
               JOIN runwield_sessions ON runwield_sessions.id = session_transcript_locators.runwield_session_id
              WHERE session_transcript_locators.transcript_path = ?`,
        ).get(resolve(locator.transcriptPath));
    } else if (locator.projectId && locator.piSessionId) {
        row = db.prepare(
            `SELECT runwield_sessions.id AS runwield_session_id,
                    runwield_sessions.project_id,
                    runwield_sessions.display_name,
                    runwield_sessions.source,
                    session_transcript_locators.pi_session_id,
                    session_transcript_locators.transcript_path,
                    session_transcript_locators.transcript_cwd,
                    session_transcript_locators.header_version,
                    session_transcript_locators.header_timestamp,
                    session_transcript_locators.first_cataloged_at,
                    session_transcript_locators.last_cataloged_at
               FROM session_transcript_locators
               JOIN runwield_sessions ON runwield_sessions.id = session_transcript_locators.runwield_session_id
              WHERE session_transcript_locators.project_id = ? AND session_transcript_locators.pi_session_id = ?`,
        ).get(locator.projectId, locator.piSessionId);
    }
    return row ? sessionFromRow(row) : null;
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ projectId: string, piSessionId: string, transcriptPath: string, transcriptCwd: string, headerVersion?: number | null, headerTimestamp?: string | null, idFactory?: () => string, now?: () => string }} locator
 * @returns {Promise<CatalogedSession>}
 */
export async function ensureSessionCatalogRecord(database, locator) {
    const ownerDb = requireDatabase(database);
    if (!locator?.projectId) throw new Error("projectId is required");
    if (!locator.piSessionId) throw new Error("piSessionId is required");
    if (!locator.transcriptPath || !isAbsolute(locator.transcriptPath)) {
        throw new Error("transcriptPath must be absolute");
    }
    if (!locator.transcriptCwd || !isAbsolute(locator.transcriptCwd)) throw new Error("transcriptCwd must be absolute");
    const transcriptPath = resolve(locator.transcriptPath);
    await validateGuardedLocator(ownerDb, { ...locator, transcriptPath });
    return ownerDb.transaction(() => {
        const project = getProjectById(ownerDb, locator.projectId);
        if (!project) throw new Error(`Project not found: ${locator.projectId}`);
        const existingByPath = findSessionByLocator(ownerDb, { transcriptPath });
        if (existingByPath) {
            if (existingByPath.projectId !== locator.projectId || existingByPath.piSessionId !== locator.piSessionId) {
                throw new Error(`Transcript locator conflict: ${transcriptPath}`);
            }
            return existingByPath;
        }
        const existingByPi = findSessionByLocator(ownerDb, {
            projectId: locator.projectId,
            piSessionId: locator.piSessionId,
        });
        if (existingByPi) {
            if (existingByPi.transcriptPath !== transcriptPath) {
                throw new Error(`Pi session locator conflict: ${locator.piSessionId}`);
            }
            return existingByPi;
        }
        const now = isoNow(locator.now);
        const runwieldSessionId = newId(locator.idFactory);
        const locatorId = newId(locator.idFactory);
        ownerDb.handle.prepare(
            "INSERT INTO runwield_sessions(id, project_id, source, created_at, updated_at) VALUES (?, ?, 'catalog', ?, ?)",
        ).run(runwieldSessionId, locator.projectId, now, now);
        ownerDb.handle.prepare(
            "INSERT INTO session_transcript_locators(id, runwield_session_id, project_id, pi_session_id, transcript_path, transcript_cwd, header_version, header_timestamp, first_cataloged_at, last_cataloged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
            locatorId,
            runwieldSessionId,
            locator.projectId,
            locator.piSessionId,
            transcriptPath,
            locator.transcriptCwd,
            locator.headerVersion ?? null,
            locator.headerTimestamp ?? null,
            now,
            now,
        );
        return /** @type {CatalogedSession} */ (getSessionById(ownerDb, runwieldSessionId));
    });
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} projectId
 * @param {{ catalog?: boolean, fullRescan?: boolean, idFactory?: () => string, now?: () => string }} [options]
 * @returns {Promise<{ sessions: CatalogedSession[], diagnostics: CatalogDiagnostic[] }>}
 */
export async function listProjectSessions(database, projectId, options = {}) {
    const catalogResult = options.catalog !== false ? await catalogProjectSessions(database, projectId, options) : null;
    const db = requireDatabase(database).handle;
    const sessions = db.prepare(
        `SELECT runwield_sessions.id AS runwield_session_id,
                runwield_sessions.project_id,
                runwield_sessions.display_name,
                runwield_sessions.source,
                session_transcript_locators.pi_session_id,
                session_transcript_locators.transcript_path,
                session_transcript_locators.transcript_cwd,
                session_transcript_locators.header_version,
                session_transcript_locators.header_timestamp,
                session_transcript_locators.first_cataloged_at,
                session_transcript_locators.last_cataloged_at
           FROM runwield_sessions
           JOIN session_transcript_locators ON session_transcript_locators.runwield_session_id = runwield_sessions.id
          WHERE runwield_sessions.project_id = ?
          ORDER BY session_transcript_locators.header_timestamp DESC, session_transcript_locators.transcript_path`,
    ).all(projectId).map(sessionFromRow);
    return { sessions, diagnostics: catalogResult?.diagnostics || [] };
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} projectId
 * @param {{ fullRescan?: boolean, idFactory?: () => string, now?: () => string }} [options]
 * @returns {Promise<{ cataloged: CatalogedSession[], diagnostics: CatalogDiagnostic[] }>}
 */
export async function catalogProjectSessions(database, projectId, options = {}) {
    const ownerDb = requireDatabase(database);
    const project = getProjectById(ownerDb, projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const rootEvidence = listProjectRootEvidence(ownerDb, projectId);
    /** @type {Map<string, { enteredRoot: string, canonicalRoot: string }>} */
    const roots = new Map();
    for (const root of rootEvidence) {
        roots.set(root.enteredRoot, root);
        roots.set(root.canonicalRoot, root);
    }
    /** @type {CatalogedSession[]} */
    const cataloged = [];
    /** @type {CatalogDiagnostic[]} */
    const diagnostics = [];
    const seenPaths = new Set();
    const knownTranscriptPaths = listKnownTranscriptPaths(ownerDb, projectId);
    for (const [cwd, evidence] of roots) {
        const sessionDir = getRunWieldSessionDir(cwd);
        let locatorResult;
        let scannedDirMtimeMs = null;
        let scannedJsonlCount = 0;
        let didIncrementalScan = false;
        if (options.fullRescan) {
            locatorResult = await listCatalogSafeRootSessionLocators(cwd, { sessionDir });
        } else {
            const inspection = await inspectSessionDirectory(sessionDir);
            const dirMtimeMs = mtimeMs(inspection?.stat.mtime || null);
            if (
                !inspection ||
                !shouldIncrementallyScan(ownerDb, projectId, cwd, sessionDir, dirMtimeMs, inspection.jsonlCount)
            ) continue;
            locatorResult = await listIncrementalRootSessionLocators(cwd, sessionDir, knownTranscriptPaths);
            scannedDirMtimeMs = locatorResult.dirMtimeMs;
            scannedJsonlCount = inspection.jsonlCount;
            didIncrementalScan = locatorResult.scanned;
        }
        const rootDiagnosticStart = diagnostics.length;
        diagnostics.push(...locatorResult.diagnostics);
        for (const locator of locatorResult.locators) {
            if (seenPaths.has(locator.sessionPath)) continue;
            seenPaths.add(locator.sessionPath);
            if (!isLocatorForRoot(locator.headerCwd, evidence)) {
                diagnostics.push({
                    sessionPath: locator.sessionPath,
                    code: "wrong_cwd",
                    message: `Transcript cwd ${locator.headerCwd} does not match Project root evidence.`,
                });
                continue;
            }
            try {
                const session = await ensureSessionCatalogRecord(ownerDb, {
                    projectId,
                    piSessionId: locator.piSessionId,
                    transcriptPath: locator.sessionPath,
                    transcriptCwd: locator.headerCwd,
                    headerVersion: locator.headerVersion,
                    headerTimestamp: locator.headerTimestamp,
                    idFactory: options.idFactory,
                    now: options.now,
                });
                cataloged.push(session);
                knownTranscriptPaths.add(resolve(locator.sessionPath));
            } catch (error) {
                diagnostics.push({
                    sessionPath: locator.sessionPath,
                    code: "catalog_conflict",
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (!options.fullRescan && didIncrementalScan && diagnostics.length === rootDiagnosticStart) {
            recordCatalogScan(
                ownerDb,
                projectId,
                cwd,
                sessionDir,
                scannedDirMtimeMs,
                scannedJsonlCount,
                isoNow(options.now),
            );
        }
    }
    return { cataloged, diagnostics };
}

/**
 * @param {string} headerCwd
 * @param {{ enteredRoot: string, canonicalRoot: string }} evidence
 */
function isLocatorForRoot(headerCwd, evidence) {
    const resolved = resolve(headerCwd);
    if (resolved === resolve(evidence.enteredRoot) || resolved === resolve(evidence.canonicalRoot)) return true;
    try {
        return Deno.realPathSync(headerCwd) === evidence.canonicalRoot;
    } catch {
        return false;
    }
}
