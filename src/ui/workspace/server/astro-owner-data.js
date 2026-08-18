/** @module ui/workspace/server/astro-owner-data */

import { requireOwnerProjectRoot } from "./owner-projects.js";
import { loadBoard, loadWorkspaceDetail } from "./plan-adapter.js";

export const OWNER_WORKSPACE_STORE_KEY = Symbol.for("runwield.workspace.owner-store");
export const OWNER_WORKSPACE_SESSION_CONTINUATION_KEY = Symbol.for("runwield.workspace.session-continuation");

/** @param {any} store */
export function setAstroOwnerWorkspaceStore(store) {
    /** @type {any} */ (globalThis)[OWNER_WORKSPACE_STORE_KEY] = store;
}

/** @param {any} sessionContinuation */
export function setAstroOwnerWorkspaceSessionContinuation(sessionContinuation) {
    /** @type {any} */ (globalThis)[OWNER_WORKSPACE_SESSION_CONTINUATION_KEY] = sessionContinuation;
}

/** @returns {any} */
export function getAstroOwnerWorkspaceStore() {
    return /** @type {any} */ (globalThis)[OWNER_WORKSPACE_STORE_KEY] || null;
}

/** @returns {any} */
export function getAstroOwnerWorkspaceSessionContinuation() {
    return /** @type {any} */ (globalThis)[OWNER_WORKSPACE_SESSION_CONTINUATION_KEY] || null;
}

/** @param {string} projectId */
export async function loadOwnerProjectBoard(projectId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store) throw new Error("Owner Workspace store is not available.");
    const root = requireOwnerProjectRoot(store, projectId);
    return await loadBoard(root);
}

/** @param {string} projectId @param {string} planId */
export async function loadOwnerProjectPlanDetail(projectId, planId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store) throw new Error("Owner Workspace store is not available.");
    const root = requireOwnerProjectRoot(store, projectId);
    return await loadWorkspaceDetail(root, planId);
}
