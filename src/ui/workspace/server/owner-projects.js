/** @module ui/workspace/server/owner-projects */

import { basename } from "@std/path";

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
