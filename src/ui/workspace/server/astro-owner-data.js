/** @module ui/workspace/server/astro-owner-data */

import { devOwnerProjects } from "./dev-owner-fixtures.ts";
import { currentWorkspaceCwd } from "./cwd.js";
import { loadOwnerPlanProgress } from "./owner-plan-progress.ts";
import { listOwnerProjects, requireOwnerProjectRoot, sessionBelongsToOwnerProject } from "./owner-projects.js";
import * as planAdapter from "./plan-adapter.js";
import { dirname, relative, resolve, sep as SEPARATOR } from "node:path";

const BUNDLED_PLAN_ADAPTER_KEY = Symbol.for("runwield.workspace.plan-adapter-module");
Reflect.set(globalThis, BUNDLED_PLAN_ADAPTER_KEY, planAdapter);

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
    return await listOwnerProjects(store);
}

/** @param {string} projectId */
export async function loadOwnerProjectBoard(projectId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store && import.meta.env.DEV) {
        const { loadCanonicalBoard } = await import("./astro-canonical-data.js");
        return await loadCanonicalBoard(currentWorkspaceCwd());
    }
    if (!store) throw new Error("Owner Workspace store is not available.");
    const root = requireOwnerProjectRoot(store, projectId);
    return await planAdapter.loadBoard(root);
}

/** @param {string} projectId @param {string} planId */
export async function loadOwnerProjectPlanDetail(projectId, planId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store && import.meta.env.DEV) {
        const { loadCanonicalWorkspaceDetail } = await import("./astro-canonical-data.js");
        return await loadCanonicalWorkspaceDetail(currentWorkspaceCwd(), planId);
    }
    if (!store) throw new Error("Owner Workspace store is not available.");
    const root = requireOwnerProjectRoot(store, projectId);
    return await planAdapter.loadWorkspaceDetail(root, planId);
}

/** @param {string} projectId @param {string} planId @param {string | null} runwieldSessionId */
export async function loadOwnerProjectPlanProgress(projectId, planId, runwieldSessionId = null) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store) throw new Error("Owner Workspace store is not available.");
    return await loadOwnerPlanProgress(store, { projectId, planId, runwieldSessionId });
}

/** @param {string} projectId @param {string} runwieldSessionId @param {string} artifactId */
export async function loadOwnerSessionArtifact(projectId, runwieldSessionId, artifactId) {
    const store = getAstroOwnerWorkspaceStore();
    if (!store) throw new Error("Owner Workspace store is not available.");
    const root = requireOwnerProjectRoot(store, projectId);
    const session = store.getSessionById(runwieldSessionId);
    if (!session || !sessionBelongsToOwnerProject(store, session, projectId)) throw new Error("Session not found.");
    const artifact = store.listSessionArtifacts(runwieldSessionId)
        .find(
            /** @param {import('../../../shared/session/file-session-store-types.ts').SessionArtifactReference} candidate */
            (candidate) => candidate.artifactId === artifactId,
        );
    if (!artifact) throw new Error("Session artifact not found.");
    const canonicalRoot = await Deno.realPath(root);
    const absolutePath = await Deno.realPath(resolve(canonicalRoot, artifact.path));
    const artifactRelativePath = relative(canonicalRoot, absolutePath);
    if (!artifactRelativePath || artifactRelativePath === ".." || artifactRelativePath.startsWith(`..${SEPARATOR}`)) {
        throw new Error("Session artifact is outside its Project.");
    }
    return {
        ...artifact,
        markdown: await Deno.readTextFile(absolutePath),
        imageBaseDir: dirname(absolutePath),
    };
}
