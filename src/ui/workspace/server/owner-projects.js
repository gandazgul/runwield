/** @module ui/workspace/server/owner-projects */

import { basename, resolve } from "@std/path";

/** @param {string} root */
export function sanitizeRootLabel(root) {
    const base = basename(String(root || ""));
    return base || "registered Project";
}

/** @param {string} evidence */
function sanitizeHealthEvidence(evidence) {
    const text = String(evidence || "");
    if (/resolves to .*expected /.test(text)) {
        return "Registered root resolves somewhere unexpected; relink this Project root.";
    }
    if (/[/\\]|[A-Za-z]:/.test(text)) return "Project health check reported a local filesystem issue.";
    return text;
}

/** @param {any} project @param {any} health */
export function serializeOwnerProject(project, health) {
    return {
        projectId: project.projectId,
        displayName: project.displayName,
        rootLabel: sanitizeRootLabel(project.registeredRoot || project.currentRoot),
        lifecycle: project.lifecycle,
        healthStatus: health.status,
        healthEvidence: Array.isArray(health.evidence) ? health.evidence.map(sanitizeHealthEvidence) : [],
        enabled: project.lifecycle === "enabled" && health.status === "available",
    };
}

/** @param {any} store */
export function listOwnerProjects(store) {
    return store.listProjects().map((/** @type {any} */ project) =>
        serializeOwnerProject(project, store.getProjectHealth(project.projectId))
    );
}

/** @param {any} store @param {string} projectId */
export function requireOwnerProjectRoot(store, projectId) {
    return store.requireEnabledProjectRoot(projectId);
}

/**
 * Workspace Project IDs and file-authoritative Session Project IDs belong to
 * different identity domains. Membership is the canonical Project root.
 *
 * @param {{ getProjectById: (projectId: string) => { currentRoot: string } | null }} store
 * @param {{ transcriptCwd: string }} session
 * @param {string} projectId
 */
export function sessionBelongsToOwnerProject(store, session, projectId) {
    const project = store.getProjectById(projectId);
    if (!project) return false;
    try {
        return resolve(Deno.realPathSync(session.transcriptCwd)) === resolve(Deno.realPathSync(project.currentRoot));
    } catch {
        return resolve(session.transcriptCwd) === resolve(project.currentRoot);
    }
}
