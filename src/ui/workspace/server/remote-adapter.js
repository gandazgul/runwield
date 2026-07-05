/** @module ui/workspace/server/remote-adapter */

import {
    hashCapability,
    MAINTAINER_SCOPE,
    REVIEWER_SCOPE,
    timingSafeEqual,
} from "../../../shared/collaboration/capabilities.js";
import { openRemoteDatabase } from "./remote-db.js";

export class RemoteWorkspaceError extends Error {
    /** @param {string} code @param {string} message @param {number} status */
    constructor(code, message, status) {
        super(message);
        this.name = "RemoteWorkspaceError";
        this.code = code;
        this.status = status;
    }
}

/**
 * @typedef {Object} RemoteWorkspaceAdapter
 * @property {import("./remote-db.js").RemoteDatabase} database
 * @property {(input: { planId: string, payloadCiphertext: string, capabilities: { scope: "reviewer" | "maintainer", capabilityHash: string }[] }) => any} createSharedSpace
 * @property {(spaceId: string, capability: string, requiredScope: "reviewer" | "maintainer") => Promise<void>} verifyCapability
 * @property {(spaceId: string) => any} getSharedSpace
 * @property {(spaceId: string) => any[]} listRevisions
 * @property {(spaceId: string, revision: number) => any} getRevision
 * @property {(spaceId: string, payloadCiphertext: string, expectedRevision?: number) => any} appendRevision
 * @property {(spaceId: string, revision: number) => any[]} listComments
 * @property {(spaceId: string, revision: number, ciphertext: string) => any} appendComment
 * @property {(spaceId: string, commentId: string, action: "resolve" | "reopen") => any} setCommentState
 * @property {(spaceId: string) => any} closeSharedSpace
 * @property {(spaceId: string) => void} deleteSharedSpace
 * @property {() => void} close
 */

/** @param {{ dbPath?: string, database?: import("./remote-db.js").RemoteDatabase }} [options] @returns {RemoteWorkspaceAdapter} */
export function createRemoteWorkspaceAdapter(options = {}) {
    const database = options.database ?? openRemoteDatabase({ dbPath: options.dbPath });
    const db = database.handle;

    return {
        database,
        close: database.close,
        createSharedSpace(input) {
            const spaceId = crypto.randomUUID();
            const now = nowIso();
            return database.transaction(() => {
                db.prepare(
                    "INSERT INTO shared_spaces(id, plan_id, status, latest_revision, created_at, updated_at) VALUES (?, ?, 'open', 1, ?, ?)",
                ).run(spaceId, input.planId, now, now);
                db.prepare(
                    "INSERT INTO space_revisions(space_id, revision, payload_ciphertext, created_at) VALUES (?, 1, ?, ?)",
                ).run(spaceId, input.payloadCiphertext, now);
                const insertCapability = db.prepare(
                    "INSERT INTO space_capabilities(space_id, scope, capability_hash, created_at) VALUES (?, ?, ?, ?)",
                );
                for (const capability of input.capabilities) {
                    insertCapability.run(spaceId, capability.scope, capability.capabilityHash, now);
                }
                return {
                    spaceId,
                    planId: input.planId,
                    status: "open",
                    latestRevision: 1,
                    createdAt: now,
                    updatedAt: now,
                    revisions: [{ spaceId, revision: 1, createdAt: now }],
                };
            });
        },
        async verifyCapability(spaceId, capability, requiredScope) {
            await verifyCapability(db, spaceId, capability, requiredScope);
        },
        getSharedSpace(spaceId) {
            const space = getSpaceRow(db, spaceId);
            return { ...mapSpace(space), revisions: listRevisionMetadata(db, spaceId) };
        },
        listRevisions(spaceId) {
            getSpaceRow(db, spaceId);
            return listRevisionMetadata(db, spaceId);
        },
        getRevision(spaceId, revision) {
            getSpaceRow(db, spaceId);
            const row = db.prepare(
                "SELECT space_id, revision, payload_ciphertext, created_at FROM space_revisions WHERE space_id = ? AND revision = ?",
            ).get(spaceId, revision);
            if (!row) throw notFound("Revision not found.");
            return mapRevision(row, true);
        },
        appendRevision(spaceId, payloadCiphertext, expectedRevision) {
            return database.transaction(() => {
                const space = getSpaceRow(db, spaceId);
                assertOpen(space);
                const nextRevision = Number(space.latest_revision) + 1;
                if (expectedRevision !== undefined && expectedRevision !== nextRevision) {
                    throw conflict("Revision conflict.");
                }
                const now = nowIso();
                db.prepare(
                    "INSERT INTO space_revisions(space_id, revision, payload_ciphertext, created_at) VALUES (?, ?, ?, ?)",
                ).run(spaceId, nextRevision, payloadCiphertext, now);
                db.prepare("UPDATE shared_spaces SET latest_revision = ?, updated_at = ? WHERE id = ?").run(
                    nextRevision,
                    now,
                    spaceId,
                );
                return { spaceId, revision: nextRevision, payloadCiphertext, createdAt: now };
            });
        },
        listComments(spaceId, revision) {
            getRevisionRow(db, spaceId, revision);
            return db.prepare(
                "SELECT id, space_id, revision, ciphertext, resolved, created_at, updated_at FROM space_comments WHERE space_id = ? AND revision = ? ORDER BY created_at, id",
            ).all(spaceId, revision).map(mapComment);
        },
        appendComment(spaceId, revision, ciphertext) {
            return database.transaction(() => {
                const space = getSpaceRow(db, spaceId);
                assertOpen(space);
                getRevisionRow(db, spaceId, revision);
                const id = crypto.randomUUID();
                const now = nowIso();
                db.prepare(
                    "INSERT INTO space_comments(id, space_id, revision, ciphertext, resolved, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
                ).run(id, spaceId, revision, ciphertext, now, now);
                return { id, spaceId, revision, ciphertext, resolved: false, createdAt: now, updatedAt: now };
            });
        },
        setCommentState(spaceId, commentId, action) {
            return database.transaction(() => {
                const space = getSpaceRow(db, spaceId);
                assertOpen(space);
                const row = db.prepare(
                    "SELECT id, space_id, revision, ciphertext, resolved, created_at, updated_at FROM space_comments WHERE space_id = ? AND id = ?",
                ).get(spaceId, commentId);
                if (!row) throw notFound("Comment not found.");
                const resolved = action === "resolve" ? 1 : 0;
                const now = nowIso();
                db.prepare("UPDATE space_comments SET resolved = ?, updated_at = ? WHERE space_id = ? AND id = ?").run(
                    resolved,
                    now,
                    spaceId,
                    commentId,
                );
                return mapComment({ ...row, resolved, updated_at: now });
            });
        },
        closeSharedSpace(spaceId) {
            return database.transaction(() => {
                const space = getSpaceRow(db, spaceId);
                if (space.status === "closed") return mapSpace(space);
                const now = nowIso();
                db.prepare("UPDATE shared_spaces SET status = 'closed', updated_at = ?, closed_at = ? WHERE id = ?")
                    .run(
                        now,
                        now,
                        spaceId,
                    );
                return mapSpace({ ...space, status: "closed", updated_at: now, closed_at: now });
            });
        },
        deleteSharedSpace(spaceId) {
            const result = db.prepare("DELETE FROM shared_spaces WHERE id = ?").run(spaceId);
            if (Number(result.changes) === 0) throw notFound("Shared Space not found or deleted.");
        },
    };
}

/** @param {import("node:sqlite").DatabaseSync} db @param {string} spaceId @param {string} capability @param {"reviewer" | "maintainer"} requiredScope */
async function verifyCapability(db, spaceId, capability, requiredScope) {
    getSpaceRow(db, spaceId);
    const presentedHash = await hashCapability(capability);
    const rows = db.prepare("SELECT scope, capability_hash FROM space_capabilities WHERE space_id = ?").all(spaceId);
    for (const row of rows) {
        const scope = String(row.scope);
        const allowed = requiredScope === REVIEWER_SCOPE || scope === MAINTAINER_SCOPE;
        if (allowed && timingSafeEqual(String(row.capability_hash), presentedHash)) return;
    }
    if (rows.some((row) => timingSafeEqual(String(row.capability_hash), presentedHash))) {
        throw new RemoteWorkspaceError("forbidden", "Capability is not authorized for this operation.", 403);
    }
    throw new RemoteWorkspaceError("forbidden", "Capability is not authorized for this operation.", 403);
}

/** @param {import("node:sqlite").DatabaseSync} db @param {string} spaceId */
function getSpaceRow(db, spaceId) {
    const row = db.prepare(
        "SELECT id, plan_id, status, latest_revision, created_at, updated_at, closed_at FROM shared_spaces WHERE id = ?",
    ).get(spaceId);
    if (!row) throw notFound("Shared Space not found or deleted.");
    return row;
}

/** @param {import("node:sqlite").DatabaseSync} db @param {string} spaceId @param {number} revision */
function getRevisionRow(db, spaceId, revision) {
    const row = db.prepare(
        "SELECT space_id, revision, payload_ciphertext, created_at FROM space_revisions WHERE space_id = ? AND revision = ?",
    ).get(spaceId, revision);
    if (!row) throw notFound("Revision not found.");
    return row;
}

/** @param {import("node:sqlite").DatabaseSync} db @param {string} spaceId */
function listRevisionMetadata(db, spaceId) {
    return db.prepare(
        "SELECT space_id, revision, created_at FROM space_revisions WHERE space_id = ? ORDER BY revision",
    ).all(spaceId).map((row) => mapRevision(row, false));
}

/** @param {any} row */
function mapSpace(row) {
    /** @type {any} */
    const space = {
        spaceId: String(row.id),
        planId: String(row.plan_id),
        status: String(row.status),
        latestRevision: Number(row.latest_revision),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
    if (row.closed_at) space.closedAt = String(row.closed_at);
    return space;
}

/** @param {any} row @param {boolean} includePayload */
function mapRevision(row, includePayload) {
    /** @type {any} */
    const revision = {
        spaceId: String(row.space_id),
        revision: Number(row.revision),
        createdAt: String(row.created_at),
    };
    if (includePayload) revision.payloadCiphertext = String(row.payload_ciphertext);
    return revision;
}

/** @param {any} row */
function mapComment(row) {
    return {
        id: String(row.id),
        spaceId: String(row.space_id),
        revision: Number(row.revision),
        ciphertext: String(row.ciphertext),
        resolved: Number(row.resolved) === 1,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

/** @param {any} space */
function assertOpen(space) {
    if (space.status === "closed") throw conflict("Shared Space is closed.");
}

/** @param {string} message */
function notFound(message) {
    return new RemoteWorkspaceError("not_found", message, 404);
}

/** @param {string} message */
function conflict(message) {
    return new RemoteWorkspaceError("conflict", message, 409);
}

function nowIso() {
    return new Date().toISOString();
}
