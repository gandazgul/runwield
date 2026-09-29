/**
 * @module shared/owner-coordination/paths
 * Path helpers for the owner-only coordination database.
 */

import { dirname, join } from "@std/path";
import { getHomeDir } from "../../constants.js";

export const OWNER_COORDINATION_DB_FILENAME = "owner-coordination.sqlite3";

export interface OwnerCoordinationPathOptions {
    home?: string;
}

/**
 * Resolve the default owner database path at call time.
 *
 * @param options
 */
export function getOwnerCoordinationDatabasePath(options: OwnerCoordinationPathOptions = {}) {
    const home = options.home || getHomeDir() || "~";
    return join(home, ".wld", OWNER_COORDINATION_DB_FILENAME);
}

/**
 * Ensure the parent directory for an on-disk owner database exists.
 *
 * @param dbPath
 */
export function ensureOwnerDatabaseDirectory(dbPath: string) {
    if (!dbPath || dbPath === ":memory:") return;
    Deno.mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    try {
        Deno.chmodSync(dirname(dbPath), 0o700);
    } catch {
        // Some filesystems do not support chmod; creation mode remains best effort.
    }
}
