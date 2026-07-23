/**
 * @module shared/owner-coordination
 * Adapter-neutral owner coordination APIs.
 *
 * Slice boundaries:
 * - Workspace UI consumes these Project and Session catalog services for registration,
 *   health, restoration, relinking, and repair actions.
 * - Later activation/generation, device, checkpoint, Plan Workflow Lease, and
 *   attention slices add their own migrations and APIs here.
 * - Runtime adapters and browser services must call shared APIs rather than
 *   issuing owner-database SQL directly.
 */

import { openOwnerCoordinationDatabase } from "./database.js";
import { getOwnerCoordinationDatabasePath, OWNER_COORDINATION_DB_FILENAME } from "./paths.js";
import { OWNER_COORDINATION_SCHEMA_VERSION } from "./schema.js";
import {
    getProjectById,
    getProjectHealth,
    listProjectRootEvidence,
    listProjects,
    registerProject,
    relinkProject,
    removeProject,
    requireEnabledProjectRoot,
    restoreProject,
    setProjectEnabled,
} from "./projects.js";
import {
    catalogProjectSessions,
    ensureSessionCatalogRecord,
    findSessionByLocator,
    getSessionById,
    listProjectSessions,
} from "./sessions.js";

export { getOwnerCoordinationDatabasePath, OWNER_COORDINATION_DB_FILENAME, OWNER_COORDINATION_SCHEMA_VERSION };

/**
 * @typedef {Object} OwnerCoordinationStore
 * @property {string} path
 * @property {() => void} close
 * @property {(options: Parameters<typeof registerProject>[1]) => ReturnType<typeof registerProject>} registerProject
 * @property {() => ReturnType<typeof listProjects>} listProjects
 * @property {(projectId: string) => ReturnType<typeof getProjectById>} getProjectById
 * @property {(projectId: string) => ReturnType<typeof getProjectHealth>} getProjectHealth
 * @property {(projectId: string) => ReturnType<typeof listProjectRootEvidence>} listProjectRootEvidence
 * @property {(projectId: string, enabled: boolean, options?: Parameters<typeof setProjectEnabled>[3]) => ReturnType<typeof setProjectEnabled>} setProjectEnabled
 * @property {(projectId: string, options?: Parameters<typeof removeProject>[2]) => ReturnType<typeof removeProject>} removeProject
 * @property {(projectId: string, options?: Parameters<typeof restoreProject>[2]) => ReturnType<typeof restoreProject>} restoreProject
 * @property {(options: Parameters<typeof relinkProject>[1]) => ReturnType<typeof relinkProject>} relinkProject
 * @property {(projectId: string) => ReturnType<typeof requireEnabledProjectRoot>} requireEnabledProjectRoot
 * @property {(locator: Parameters<typeof ensureSessionCatalogRecord>[1]) => ReturnType<typeof ensureSessionCatalogRecord>} ensureSessionCatalogRecord
 * @property {(locator: Parameters<typeof findSessionByLocator>[1]) => ReturnType<typeof findSessionByLocator>} findSessionByLocator
 * @property {(runwieldSessionId: string) => ReturnType<typeof getSessionById>} getSessionById
 * @property {(projectId: string, options?: Parameters<typeof listProjectSessions>[2]) => ReturnType<typeof listProjectSessions>} listProjectSessions
 * @property {(projectId: string, options?: Parameters<typeof catalogProjectSessions>[2]) => ReturnType<typeof catalogProjectSessions>} catalogProjectSessions
 */

/**
 * Open the public owner coordination store without exposing raw SQLite handles.
 * Internal migration tests and service modules may import database.js directly;
 * adapters should consume this narrow method surface.
 *
 * @param {import('./database.js').OpenOwnerDatabaseOptions} [options]
 * @returns {OwnerCoordinationStore}
 */
export function openOwnerCoordinationStore(options = {}) {
    const database = openOwnerCoordinationDatabase(options);
    return {
        path: database.path,
        close: () => database.close(),
        registerProject: (projectOptions) => registerProject(database, projectOptions),
        listProjects: () => listProjects(database),
        getProjectById: (projectId) => getProjectById(database, projectId),
        getProjectHealth: (projectId) => getProjectHealth(database, projectId),
        listProjectRootEvidence: (projectId) => listProjectRootEvidence(database, projectId),
        setProjectEnabled: (projectId, enabled, projectOptions) =>
            setProjectEnabled(database, projectId, enabled, projectOptions),
        removeProject: (projectId, projectOptions) => removeProject(database, projectId, projectOptions),
        restoreProject: (projectId, projectOptions) => restoreProject(database, projectId, projectOptions),
        relinkProject: (projectOptions) => relinkProject(database, projectOptions),
        requireEnabledProjectRoot: (projectId) => requireEnabledProjectRoot(database, projectId),
        ensureSessionCatalogRecord: (locator) => ensureSessionCatalogRecord(database, locator),
        findSessionByLocator: (locator) => findSessionByLocator(database, locator),
        getSessionById: (runwieldSessionId) => getSessionById(database, runwieldSessionId),
        listProjectSessions: (projectId, sessionOptions) => listProjectSessions(database, projectId, sessionOptions),
        catalogProjectSessions: (projectId, sessionOptions) =>
            catalogProjectSessions(database, projectId, sessionOptions),
    };
}
