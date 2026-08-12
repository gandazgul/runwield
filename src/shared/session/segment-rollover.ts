/*
 * @module shared/session/segment-rollover
 * Transactional Session Transcript Segment Rollover orchestration.
 */

import type { OwnerCoordinationStore } from "../owner-coordination/index.js";
import type { ManagedSessionMetadata } from "./hosted-session.js";
import { createRootSessionManager, openPersistedRootSession, resolveCreatedRootSessionPath } from "./root-session.js";
import { captureTranscriptEvidence, syncTranscriptFileAndParent } from "./session-transcript-projection.js";
import { recordPendingSegmentContinuation, recordSegmentLineageEvidence } from "./workflow-context-session.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type RolloverKind = "execution" | "semantic_repair";

type HostedManagedSession = {
    cwd: string;
    getManagedMetadata: () => ManagedSessionMetadata | null;
    getRootSessionManager: () => { dispose?: () => void | Promise<void> } | null;
    dehydrateManagedSession: () => void;
    replaceManagedTranscriptSegment: (segment: {
        piSessionId: string;
        transcriptPath: string;
        currentSegmentId: string;
        sessionManager: { dispose?: () => void | Promise<void> };
    }) => void;
    setManagedMetadata: (metadata: ManagedSessionMetadata) => void;
};

type RollSessionTranscriptSegmentOptions = {
    hostedSession: HostedManagedSession;
    ownerCoordinationStore: OwnerCoordinationStore;
    ownerInstanceId: string;
    ownerProcessKind: "workspace" | "tui" | "acp" | "test";
    kind: RolloverKind;
    continuation: JsonValue;
    expectedGeneration?: number | null;
    lineageGroupKey?: string | null;
    operationId?: string;
    now?: () => string;
};

export type SegmentRolloverResult = {
    runwieldSessionId: string;
    projectId: string;
    predecessorSegmentId: string;
    successorSegmentId: string;
    piSessionId: string;
    transcriptPath: string;
    generation: number;
    continuation: JsonValue;
};

export type OrphanRolloverCandidate = {
    runwieldSessionId: string;
    projectId: string;
    transcriptPath: string;
    transcriptCwd: string;
    piSessionId: string;
    parentSegmentId: string;
    parentPiSessionId: string | null;
    lineageGroupKey: string | null;
};

async function disposeManager(manager: { dispose?: () => void | Promise<void> } | null) {
    await Promise.resolve(manager?.dispose?.());
}

export async function rollSessionTranscriptSegment(
    options: RollSessionTranscriptSegmentOptions,
): Promise<SegmentRolloverResult> {
    const managed = options.hostedSession.getManagedMetadata();
    if (!managed) throw new Error("Managed Session metadata is required for segment rollover");
    const predecessor = options.ownerCoordinationStore.listSessionTranscriptSegments(managed.runwieldSessionId)
        .find((segment) => segment.segmentId === managed.currentSegmentId);
    if (!predecessor) throw new Error("Managed Session current segment is absent");

    let proof = options.ownerCoordinationStore.acquireSessionActivation({
        runwieldSessionId: managed.runwieldSessionId,
        projectId: managed.projectId,
        ownerInstanceId: options.ownerInstanceId,
        ownerProcessKind: options.ownerProcessKind,
        operationId: options.operationId,
        expectedGeneration: options.expectedGeneration ?? managed.generation,
        expectedCurrentSegmentId: predecessor.segmentId,
        phase: "preparing",
    });
    try {
        await disposeManager(options.hostedSession.getRootSessionManager());
        options.hostedSession.dehydrateManagedSession();
        await syncTranscriptFileAndParent(predecessor.transcriptPath);
        const predecessorEvidence = await captureTranscriptEvidence({
            transcriptPath: predecessor.transcriptPath,
            transcriptCwd: predecessor.transcriptCwd,
        });

        proof = options.ownerCoordinationStore.changeSessionActivationPhase(proof, "hydrated");
        proof = options.ownerCoordinationStore.changeSessionActivationPhase(proof, "checkpointing");
        const successorManager = await createRootSessionManager("new", options.hostedSession.cwd);
        const successorPiSessionId = successorManager.getSessionId();
        const successorTranscriptPath = await resolveCreatedRootSessionPath(
            options.hostedSession.cwd,
            successorManager,
        );
        const successorSegmentId = crypto.randomUUID();
        recordSegmentLineageEvidence(successorManager, {
            segmentId: successorSegmentId,
            runwieldSessionId: managed.runwieldSessionId,
            parentSegmentId: predecessor.segmentId,
            parentPiSessionId: predecessor.piSessionId,
            lineageGroupKey: options.lineageGroupKey ?? predecessor.lineageGroupKey ?? predecessor.segmentId,
        });
        recordPendingSegmentContinuation(successorManager, options.continuation);
        await disposeManager(successorManager as { dispose?: () => void | Promise<void> });
        await syncTranscriptFileAndParent(successorTranscriptPath);
        const successorEvidence = await captureTranscriptEvidence({
            transcriptPath: successorTranscriptPath,
            transcriptCwd: options.hostedSession.cwd,
        });
        const successorSafeLocator = await options.ownerCoordinationStore.validateSuccessorSegmentLocator({
            projectId: managed.projectId,
            piSessionId: successorPiSessionId,
            transcriptPath: successorTranscriptPath,
            transcriptCwd: options.hostedSession.cwd,
        });
        const generation = (managed.generation ?? -1) + 1;
        const committed = options.ownerCoordinationStore.commitSegmentRolloverAndPublish(proof, {
            predecessorSegmentId: predecessor.segmentId,
            predecessorEvidence,
            successor: {
                runwieldSessionId: managed.runwieldSessionId,
                projectId: managed.projectId,
                piSessionId: successorPiSessionId,
                transcriptPath: successorTranscriptPath,
                transcriptCwd: options.hostedSession.cwd,
                kind: options.kind,
                lineageParentSegmentId: predecessor.segmentId,
                lineageParentPiSessionId: predecessor.piSessionId,
                lineageGroupKey: options.lineageGroupKey ?? predecessor.lineageGroupKey ?? predecessor.segmentId,
                idFactory: () => successorSegmentId,
                now: options.now,
            },
            successorSafeLocator,
            generationEvidence: {
                generation,
                byteLength: successorEvidence.byteLength,
                terminalEntryId: successorEvidence.terminalEntryId,
                digestHex: successorEvidence.digestHex,
                currentSegmentId: successorSegmentId,
            },
            now: options.now,
        });
        const successor = committed.successor;
        const { sessionManager: installedSuccessorManager } = await openPersistedRootSession({
            cwd: options.hostedSession.cwd,
            sessionId: successor.piSessionId,
            sessionPath: successor.transcriptPath,
        });
        options.hostedSession.replaceManagedTranscriptSegment({
            piSessionId: successor.piSessionId,
            transcriptPath: successor.transcriptPath,
            currentSegmentId: successor.segmentId,
            sessionManager: installedSuccessorManager as { dispose?: () => void | Promise<void> },
        });
        const nextManaged = options.hostedSession.getManagedMetadata();
        if (nextManaged) {
            options.hostedSession.setManagedMetadata({
                ...nextManaged,
                generation,
                acknowledgedGeneration: generation,
                acknowledgedEventId: null,
                acknowledgedEventOrdinal: null,
            });
        }
        return {
            runwieldSessionId: managed.runwieldSessionId,
            projectId: managed.projectId,
            predecessorSegmentId: predecessor.segmentId,
            successorSegmentId: successor.segmentId,
            piSessionId: successor.piSessionId,
            transcriptPath: successor.transcriptPath,
            generation,
            continuation: options.continuation,
        };
    } catch (error) {
        try {
            options.ownerCoordinationStore.markSessionUncertain(proof, {
                reason: error instanceof Error ? error.message : String(error),
            });
        } catch {
            // If the activation was already released or never acquired, preserve the original failure.
        }
        throw error;
    }
}
