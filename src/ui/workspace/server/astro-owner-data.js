/** @module ui/workspace/server/astro-owner-data */

import { devOwnerProjects } from "./dev-owner-fixtures.ts";

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

export async function loadOwnerProjects() {
    const store = getAstroOwnerWorkspaceStore();
    if (!store && import.meta.env.DEV) return devOwnerProjects();
    if (!store) throw new Error("Owner Workspace store is not available.");
    const { listOwnerProjects } = await import("./owner-projects.js");
    return listOwnerProjects(store);
}

/** @param {string} projectId */
export async function loadOwnerProjectBoard(projectId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store && import.meta.env.DEV) {
        const { loadCanonicalBoard } = await import("./astro-canonical-data.js");
        return await loadCanonicalBoard("workspace-dev/fixture-project");
    }
    if (!store) throw new Error("Owner Workspace store is not available.");
    const [{ requireOwnerProjectRoot }, { loadBoard }] = await Promise.all([
        import("./owner-projects.js"),
        import("./plan-adapter.js"),
    ]);
    const root = requireOwnerProjectRoot(store, projectId);
    return await loadBoard(root);
}

/** @param {string} projectId @param {string} planId */
export async function loadOwnerProjectPlanDetail(projectId, planId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store && import.meta.env.DEV) {
        const { loadCanonicalWorkspaceDetail } = await import("./astro-canonical-data.js");
        return await loadCanonicalWorkspaceDetail("workspace-dev/fixture-project", planId);
    }
    if (!store) throw new Error("Owner Workspace store is not available.");
    const [{ requireOwnerProjectRoot }, { loadWorkspaceDetail }] = await Promise.all([
        import("./owner-projects.js"),
        import("./plan-adapter.js"),
    ]);
    const root = requireOwnerProjectRoot(store, projectId);
    return await loadWorkspaceDetail(root, planId);
}

/** @param {string} projectId @param {string} planId @param {string | null} runwieldSessionId */
export async function loadOwnerProjectPlanProgress(projectId, planId, runwieldSessionId = null) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store) throw new Error("Owner Workspace store is not available.");
    const { loadOwnerPlanProgress } = await import("./owner-plan-progress.ts");
    return await loadOwnerPlanProgress(store, { projectId, planId, runwieldSessionId });
}
