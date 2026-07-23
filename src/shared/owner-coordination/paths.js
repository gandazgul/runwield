/**
 * @module shared/owner-coordination/paths
 * Path helpers for the owner-only coordination database.
 */

import { dirname, join } from "@std/path";

export const OWNER_COORDINATION_DB_FILENAME = "owner-coordination.sqlite3";

/**
 * Resolve the default owner database path at call time.
 *
 * @param {{ home?: string }} [options]
 * @returns {string}
 */
export function getOwnerCoordinationDatabasePath(options = {}) {
    const home = options.home || Deno.env.get("HOME") || "~";
    return join(home, ".wld", OWNER_COORDINATION_DB_FILENAME);
}

/**
 * Ensure the parent directory for an on-disk owner database exists.
 *
 * @param {string} dbPath
 */
export function ensureOwnerDatabaseDirectory(dbPath) {
    if (!dbPath || dbPath === ":memory:") return;
    Deno.mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    try {
        Deno.chmodSync(dirname(dbPath), 0o700);
    } catch {
        // Some filesystems do not support chmod; creation mode remains best effort.
    }
}
