/**
 * @module shared/owner-coordination
 * Adapter-neutral owner coordination APIs.
 *
 * Slice boundaries:
 * - Workspace UI consumes these Project and Session catalog services for registration,
 *   health, restoration, relinking, and repair actions.
 * - Later activation/generation, checkpoint, Plan Workflow Lease, and attention
 *   slices add their own migrations and APIs here.
 * - Runtime adapters and browser services must call shared APIs rather than
 *   issuing owner-database SQL directly.
 */

import { getOwnerCoordinationDatabaseEpoch, openOwnerCoordinationDatabase } from "./database.js";
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
import { listDevices, revokeDevice, verifyDeviceCredential, verifyDeviceCsrf } from "./devices.js";
import {
    approvePairingRequest,
    claimPairingRequest,
    createPairingRequest,
    getPairingRequestByProof,
} from "./pairing.js";
import {
    acknowledgeActivationProtocol,
    getActivationProtocolStatus,
    requireActivationProtocolEnabled,
} from "./activation-protocol.js";
import {
    acquireSessionActivation,
    changeSessionActivationPhase,
    createOrGetOperationReceipt,
    heartbeatSessionActivation,
    inspectSessionActivation,
    markSessionReconcileRequired,
    markSessionUncertain,
    publishGenerationAndRelease,
    releaseUnchangedActivation,
} from "./session-activations.js";

export { getOwnerCoordinationDatabasePath, OWNER_COORDINATION_DB_FILENAME, OWNER_COORDINATION_SCHEMA_VERSION };
export { OWNER_CSRF_COOKIE, OWNER_DEVICE_COOKIE, OWNER_DEVICE_MAX_AGE_SECONDS } from "./devices.js";

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
 * @property {(options?: Parameters<typeof createPairingRequest>[1]) => ReturnType<typeof createPairingRequest>} createPairingRequest
 * @property {(code: string, options?: Parameters<typeof approvePairingRequest>[2]) => ReturnType<typeof approvePairingRequest>} approvePairingRequest
 * @property {(proof: string, options?: Parameters<typeof getPairingRequestByProof>[2]) => ReturnType<typeof getPairingRequestByProof>} getPairingRequestByProof
 * @property {(proof: string, options?: Parameters<typeof claimPairingRequest>[2]) => ReturnType<typeof claimPairingRequest>} claimPairingRequest
 * @property {() => ReturnType<typeof listDevices>} listDevices
 * @property {(credential: string, options?: Parameters<typeof verifyDeviceCredential>[2]) => ReturnType<typeof verifyDeviceCredential>} verifyDeviceCredential
 * @property {(deviceId: string, csrf: string) => ReturnType<typeof verifyDeviceCsrf>} verifyDeviceCsrf
 * @property {(deviceId: string, options?: Parameters<typeof revokeDevice>[2]) => ReturnType<typeof revokeDevice>} revokeDevice
 * @property {() => string | null} getDatabaseEpoch
 * @property {() => ReturnType<typeof getActivationProtocolStatus>} getActivationProtocolStatus
 * @property {(options?: Parameters<typeof acknowledgeActivationProtocol>[1]) => ReturnType<typeof acknowledgeActivationProtocol>} acknowledgeActivationProtocol
 * @property {() => ReturnType<typeof requireActivationProtocolEnabled>} requireActivationProtocolEnabled
 * @property {(runwieldSessionId: string) => ReturnType<typeof inspectSessionActivation>} inspectSessionActivation
 * @property {(options: Parameters<typeof acquireSessionActivation>[1]) => ReturnType<typeof acquireSessionActivation>} acquireSessionActivation
 * @property {(proof: Parameters<typeof heartbeatSessionActivation>[1], options?: Parameters<typeof heartbeatSessionActivation>[2]) => ReturnType<typeof heartbeatSessionActivation>} heartbeatSessionActivation
 * @property {(proof: Parameters<typeof changeSessionActivationPhase>[1], nextPhase: Parameters<typeof changeSessionActivationPhase>[2], options?: Parameters<typeof changeSessionActivationPhase>[3]) => ReturnType<typeof changeSessionActivationPhase>} changeSessionActivationPhase
 * @property {(proof: Parameters<typeof publishGenerationAndRelease>[1], evidence: Parameters<typeof publishGenerationAndRelease>[2], options?: Parameters<typeof publishGenerationAndRelease>[3]) => ReturnType<typeof publishGenerationAndRelease>} publishGenerationAndRelease
 * @property {(proof: Parameters<typeof releaseUnchangedActivation>[1], options?: Parameters<typeof releaseUnchangedActivation>[2]) => ReturnType<typeof releaseUnchangedActivation>} releaseUnchangedActivation
 * @property {(session: Parameters<typeof markSessionReconcileRequired>[1], options?: Parameters<typeof markSessionReconcileRequired>[2]) => ReturnType<typeof markSessionReconcileRequired>} markSessionReconcileRequired
 * @property {(proof: Parameters<typeof markSessionUncertain>[1], options?: Parameters<typeof markSessionUncertain>[2]) => ReturnType<typeof markSessionUncertain>} markSessionUncertain
 * @property {(options: Parameters<typeof createOrGetOperationReceipt>[1]) => ReturnType<typeof createOrGetOperationReceipt>} createOrGetOperationReceipt
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
        createPairingRequest: (pairingOptions) => createPairingRequest(database, pairingOptions),
        approvePairingRequest: (code, pairingOptions) => approvePairingRequest(database, code, pairingOptions),
        getPairingRequestByProof: (proof, pairingOptions) => getPairingRequestByProof(database, proof, pairingOptions),
        claimPairingRequest: (proof, pairingOptions) => claimPairingRequest(database, proof, pairingOptions),
        listDevices: () => listDevices(database),
        verifyDeviceCredential: (credential, deviceOptions) =>
            verifyDeviceCredential(database, credential, deviceOptions),
        verifyDeviceCsrf: (deviceId, csrf) => verifyDeviceCsrf(database, deviceId, csrf),
        revokeDevice: (deviceId, deviceOptions) => revokeDevice(database, deviceId, deviceOptions),
        getDatabaseEpoch: () => getOwnerCoordinationDatabaseEpoch(database.handle),
        getActivationProtocolStatus: () => getActivationProtocolStatus(database),
        acknowledgeActivationProtocol: (protocolOptions) => acknowledgeActivationProtocol(database, protocolOptions),
        requireActivationProtocolEnabled: () => requireActivationProtocolEnabled(database),
        inspectSessionActivation: (runwieldSessionId) => inspectSessionActivation(database, runwieldSessionId),
        acquireSessionActivation: (activationOptions) => acquireSessionActivation(database, activationOptions),
        heartbeatSessionActivation: (proof, heartbeatOptions) =>
            heartbeatSessionActivation(database, proof, heartbeatOptions),
        changeSessionActivationPhase: (proof, nextPhase, activationOptions) =>
            changeSessionActivationPhase(database, proof, nextPhase, activationOptions),
        publishGenerationAndRelease: (proof, evidence, activationOptions) =>
            publishGenerationAndRelease(database, proof, evidence, activationOptions),
        releaseUnchangedActivation: (proof, activationOptions) =>
            releaseUnchangedActivation(database, proof, activationOptions),
        markSessionReconcileRequired: (session, activationOptions) =>
            markSessionReconcileRequired(database, session, activationOptions),
        markSessionUncertain: (proof, activationOptions) => markSessionUncertain(database, proof, activationOptions),
        createOrGetOperationReceipt: (operationOptions) => createOrGetOperationReceipt(database, operationOptions),
    };
}
