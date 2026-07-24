/* @module ui/workspace/server/session-continuation */

import { createHash } from "node:crypto";
import { SessionRuntime } from "../../../shared/session/session-runtime.js";
import { getRunWieldSessionDir } from "../../../shared/session/root-session.js";
import {
    captureTranscriptEvidence,
    projectCommittedTranscript,
} from "../../../shared/session/session-transcript-projection.js";

/** @param {unknown} value */
function stableHash(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** @param {unknown} error */
function codeFromError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not enabled")) return "rollout_disabled";
    if (message.includes("reconcile")) return "reconcile_required";
    if (message.includes("activation")) return "activation_unavailable";
    return "invalid_state";
}

export class WorkspaceSessionContinuationService {
    /**
     * @param {{ store: import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore }} options
     */
    constructor(options) {
        this.store = options.store;
        this.ownerInstanceId = crypto.randomUUID();
        this.runtime = new SessionRuntime({
            ownerCoordinationStore: this.store,
            ownerProcessKind: "workspace",
            ownerInstanceId: this.ownerInstanceId,
        });
        /** @type {Map<string, { status: string, events: unknown[], error?: string, generation?: number | null }>} */
        this.operations = new Map();
    }

    close() {
        this.runtime.closeAllSessionsWhenIdle?.();
    }

    /** @param {string} projectId */
    async listSessions(projectId) {
        const protocol = this.store.getActivationProtocolStatus();
        const { sessions, diagnostics } = await this.store.listProjectSessions(projectId, { catalog: true });
        return {
            protocol,
            diagnostics,
            sessions: sessions.map((session) => {
                const inspected = this.store.inspectSessionActivation(session.runwieldSessionId);
                return {
                    runwieldSessionId: session.runwieldSessionId,
                    projectId: session.projectId,
                    displayName: session.displayName,
                    state: inspected.activation?.state || "missing_activation",
                    generation: inspected.generation?.generation ?? null,
                    activeSurface: inspected.activation?.state === "active"
                        ? inspected.activation.ownerProcessKind
                        : null,
                    bootstrapRequired: inspected.activation?.state === "uninitialized",
                };
            }),
        };
    }

    /**
     * @param {string} runwieldSessionId
     * @param {{ cursorEventId?: string, limit?: number }} [options]
     */
    async timeline(runwieldSessionId, options = {}) {
        const session = this.store.getSessionById(runwieldSessionId);
        if (!session) throw new Error("Session not found.");
        const inspected = this.store.inspectSessionActivation(runwieldSessionId);
        if (!inspected.generation) {
            return { state: inspected.activation?.state || "uninitialized", bootstrapRequired: true, events: [] };
        }
        const projection = await projectCommittedTranscript({
            cwd: session.transcriptCwd,
            sessionDir: getRunWieldSessionDir(session.transcriptCwd),
            sessionPath: session.transcriptPath,
            generation: inspected.generation.generation,
            byteLength: inspected.generation.byteLength,
            terminalEntryId: inspected.generation.terminalEntryId,
            digestHex: inspected.generation.digestHex,
            cursorEventId: options.cursorEventId,
            limit: options.limit,
        });
        return { state: inspected.activation?.state || "idle", bootstrapRequired: false, ...projection };
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, runwieldSessionId: string, requestId: string }} options
     */
    async bootstrap(options) {
        this.store.requireActivationProtocolEnabled();
        const session = this.store.getSessionById(options.runwieldSessionId);
        if (!session || session.projectId !== options.projectId) throw new Error("Session not found.");
        const receipt = this.store.createOrGetOperationReceipt({
            deviceId: options.deviceId || null,
            requestId: options.requestId,
            requestHash: stableHash({ kind: "bootstrap", session: options.runwieldSessionId }),
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            expectedGeneration: null,
            kind: "bootstrap",
        });
        const existing = this.store.inspectSessionActivation(options.runwieldSessionId);
        if (existing.generation) {
            return {
                operationId: receipt.operationId,
                generation: existing.generation.generation,
                status: "completed",
            };
        }
        const proof = this.store.acquireSessionActivation({
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            ownerInstanceId: this.ownerInstanceId,
            ownerProcessKind: "workspace",
            operationId: receipt.operationId,
            expectedGeneration: null,
            phase: "bootstrap",
        });
        try {
            const evidence = await captureTranscriptEvidence({
                transcriptPath: session.transcriptPath,
                transcriptCwd: session.transcriptCwd,
            });
            this.store.publishGenerationAndRelease(proof, {
                generation: 0,
                byteLength: evidence.byteLength,
                terminalEntryId: evidence.terminalEntryId,
                digestHex: evidence.digestHex,
            });
            return { operationId: receipt.operationId, generation: 0, status: "completed" };
        } catch (error) {
            this.store.markSessionReconcileRequired({
                runwieldSessionId: options.runwieldSessionId,
                projectId: options.projectId,
            }, { reason: codeFromError(error) });
            throw error;
        }
    }

    /**
     * @param {{ deviceId?: string | null, projectId: string, runwieldSessionId: string, requestId: string, expectedGeneration: number, text: string }} options
     */
    startContinuation(options) {
        this.store.requireActivationProtocolEnabled();
        const session = this.store.getSessionById(options.runwieldSessionId);
        if (!session || session.projectId !== options.projectId) throw new Error("Session not found.");
        if (!options.text || typeof options.text !== "string") throw new Error("Continuation text is required.");
        const requestHash = stableHash({
            kind: "continuation",
            session: options.runwieldSessionId,
            expectedGeneration: options.expectedGeneration,
            text: options.text,
        });
        const receipt = this.store.createOrGetOperationReceipt({
            deviceId: options.deviceId || null,
            requestId: options.requestId,
            requestHash,
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            expectedGeneration: options.expectedGeneration,
            kind: "continuation",
        });
        if (this.operations.has(receipt.operationId)) {
            return {
                operationId: receipt.operationId,
                status: this.operations.get(receipt.operationId)?.status || "running",
            };
        }
        this.operations.set(receipt.operationId, { status: "running", events: [] });
        const adopted = this.runtime.adoptManagedSession({ session, generation: options.expectedGeneration });
        const unsubscribe = this.runtime.subscribeSessionEvents(adopted.sessionId, (event) => {
            const record = this.operations.get(receipt.operationId);
            if (record && record.events.length < 500) record.events.push(event);
        });
        queueMicrotask(async () => {
            try {
                const result = await this.runtime.promptManagedSession(adopted.sessionId, {
                    initialRequest: options.text,
                    initialImages: [],
                    expectedGeneration: options.expectedGeneration,
                });
                const generation = result.ok ? options.expectedGeneration + 1 : options.expectedGeneration;
                this.operations.set(receipt.operationId, {
                    ...(this.operations.get(receipt.operationId) || { events: [] }),
                    status: result.ok ? "completed" : "failed",
                    generation,
                    error: result.error,
                });
            } catch (error) {
                this.operations.set(receipt.operationId, {
                    ...(this.operations.get(receipt.operationId) || { events: [] }),
                    status: "failed",
                    error: codeFromError(error),
                });
            } finally {
                unsubscribe();
                this.runtime.closeSession(adopted.sessionId);
            }
        });
        return { operationId: receipt.operationId, status: "running" };
    }

    /** @param {string} operationId */
    getOperation(operationId) {
        return this.operations.get(operationId) || { status: "unknown", events: [] };
    }
}

/** @param {{ store: import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore }} options */
export function createWorkspaceSessionContinuationService(options) {
    return new WorkspaceSessionContinuationService(options);
}
