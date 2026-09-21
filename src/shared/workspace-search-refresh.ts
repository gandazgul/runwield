/** @module shared/workspace-search-refresh */

import { join } from "@std/path";
import { getHomeDir } from "../constants.js";

function refreshDirectory() {
    return join(getHomeDir(), ".runwield-workspace-search-refresh");
}

/** @param {string} root */
export async function getWorkspaceSearchRefreshMarker(root: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(root));
    const key = [...new Uint8Array(digest)].slice(0, 16)
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return join(refreshDirectory(), key);
}

/**
 * Request an early rebuild of derived Workspace search data. Canonical writes
 * stay successful when Workspace is not running or the marker cannot be written.
 * @param {string} root
 */
export async function requestWorkspaceSearchRefresh(root: string) {
    try {
        const path = await getWorkspaceSearchRefreshMarker(root);
        await Deno.mkdir(refreshDirectory(), { recursive: true });
        await Deno.writeTextFile(path, `${Date.now()}\n`);
    } catch {
        // Search is derived data. The bounded background scan remains the fallback.
    }
}
