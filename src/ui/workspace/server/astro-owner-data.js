/** @module ui/workspace/server/astro-owner-data */

import { requireOwnerProjectRoot } from "./owner-projects.js";
import { loadBoard } from "./plan-adapter.js";

export const OWNER_WORKSPACE_STORE_KEY = Symbol.for("runwield.workspace.owner-store");

/** @param {any} store */
export function setAstroOwnerWorkspaceStore(store) {
    /** @type {any} */ (globalThis)[OWNER_WORKSPACE_STORE_KEY] = store;
}

/** @returns {any} */
export function getAstroOwnerWorkspaceStore() {
    return /** @type {any} */ (globalThis)[OWNER_WORKSPACE_STORE_KEY] || null;
}

/** @param {string} projectId */
export async function loadOwnerProjectBoard(projectId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store) throw new Error("Owner Workspace store is not available.");
    const root = requireOwnerProjectRoot(store, projectId);
    return await loadBoard(root);
}
