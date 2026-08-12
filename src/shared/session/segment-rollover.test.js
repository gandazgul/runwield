import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { openOwnerCoordinationStore } from "../owner-coordination/index.js";
import { HostedSession } from "./hosted-session.js";
import { createRootSessionManager, resolveCreatedRootSessionPath } from "./root-session.js";
import { rollSessionTranscriptSegment } from "./segment-rollover.ts";
import { projectAggregateTranscript } from "./session-transcript-manifest.ts";
import { captureTranscriptEvidence, syncTranscriptFileAndParent } from "./session-transcript-projection.js";
import { recordPendingSegmentContinuation, recordSegmentLineageEvidence } from "./workflow-context-session.js";

function idFactory(prefix = "id") {
    let next = 0;
    return () => `${prefix}-${++next}`;
}

async function createManagedFixture() {
    const dir = await Deno.makeTempDir({ prefix: "runwield-segment-rollover-" });
    const root = join(dir, "repo");
    await Deno.mkdir(root);
    const store = openOwnerCoordinationStore({ dbPath: join(dir, "owner.sqlite3") });
    const project = store.registerProject({ root, idFactory: idFactory("project"), now: () => "t0" });
    const manager = await createRootSessionManager("new", root);
    manager.appendMessage({ role: "user", timestamp: Date.now(), content: [{ type: "text", text: "before" }] });
    const piSessionId = manager.getSessionId();
    const transcriptPath = await resolveCreatedRootSessionPath(root, manager);
    await Promise.resolve((/** @type {{ dispose?: () => void | Promise<void> }} */ (manager)).dispose?.());
    await syncTranscriptFileAndParent(transcriptPath);
    const session = await store.ensureSessionCatalogRecord({
        projectId: project.projectId,
        piSessionId,
        transcriptPath,
        transcriptCwd: root,
        source: "created",
    });
    const segment = store.getCurrentSessionSegment(session.runwieldSessionId);
    assert(segment);
    let proof = store.acquireSessionActivation({
        runwieldSessionId: session.runwieldSessionId,
        projectId: project.projectId,
        ownerInstanceId: "owner-1",
        ownerProcessKind: "test",
        expectedGeneration: null,
        expectedCurrentSegmentId: segment.segmentId,
        phase: "preparing",
    });
    proof = store.changeSessionActivationPhase(proof, "hydrated");
    proof = store.changeSessionActivationPhase(proof, "checkpointing");
    const evidence = await captureTranscriptEvidence({ transcriptPath, transcriptCwd: root });
    store.publishGenerationAndRelease(proof, {
        generation: 0,
        byteLength: evidence.byteLength,
        terminalEntryId: evidence.terminalEntryId,
        digestHex: evidence.digestHex,
        currentSegmentId: segment.segmentId,
    });
    const hosted = new HostedSession({
        id: "runtime-session",
        cwd: root,
        sessionManager: null,
        managed: {
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            piSessionId: session.piSessionId,
            transcriptPath: session.transcriptPath,
            currentSegmentId: segment.segmentId,
            generation: 0,
            acknowledgedGeneration: 0,
            acknowledgedEventId: null,
            name: null,
            activeAgent: null,
            workflowContext: null,
        },
    });
    return { dir, root, store, project, session, segment, hosted };
}

/** @param {Awaited<ReturnType<typeof createManagedFixture>>} fixture */
async function cleanupFixture(fixture) {
    fixture.store.close();
    await Deno.remove(fixture.dir, { recursive: true });
}

/** @param {Awaited<ReturnType<typeof createManagedFixture>>} fixture */
async function readProjection(fixture) {
    const state = fixture.store.inspectSessionActivation(fixture.session.runwieldSessionId);
    assert(state.generation);
    return await projectAggregateTranscript({
        cwd: fixture.root,
        runwieldSessionId: fixture.session.runwieldSessionId,
        runtimeSessionId: fixture.hosted.id,
        generation: state.generation,
        segments: fixture.store.listSessionTranscriptSegments(fixture.session.runwieldSessionId),
    });
}

Deno.test("a successor row without a committed generation degrades the aggregate projection", async () => {
    await withProcessGlobalTestLock(async () => {
        const fixture = await createManagedFixture();
        try {
            const evidence = await captureTranscriptEvidence({
                transcriptPath: fixture.segment.transcriptPath,
                transcriptCwd: fixture.segment.transcriptCwd,
            });
            fixture.store.sealSessionTranscriptSegment({
                runwieldSessionId: fixture.session.runwieldSessionId,
                segmentId: fixture.segment.segmentId,
                evidence,
            });
            const successorManager = await createRootSessionManager("new", fixture.root);
            const successorPath = await resolveCreatedRootSessionPath(fixture.root, successorManager);
            await Promise.resolve(
                (/** @type {{ dispose?: () => void | Promise<void> }} */ (successorManager)).dispose?.(),
            );
            await syncTranscriptFileAndParent(successorPath);
            await fixture.store.appendSessionTranscriptSegment({
                runwieldSessionId: fixture.session.runwieldSessionId,
                projectId: fixture.project.projectId,
                piSessionId: successorManager.getSessionId(),
                transcriptPath: successorPath,
                transcriptCwd: fixture.root,
                kind: "execution",
                lineageParentSegmentId: fixture.segment.segmentId,
            });
            const state = fixture.store.inspectSessionActivation(fixture.session.runwieldSessionId);
            assert(state.generation);
            const projected = await projectAggregateTranscript({
                cwd: fixture.root,
                runwieldSessionId: fixture.session.runwieldSessionId,
                runtimeSessionId: fixture.hosted.id,
                generation: state.generation,
                segments: fixture.store.listSessionTranscriptSegments(fixture.session.runwieldSessionId),
            });
            assertEquals(projected.ok, false);
            assertEquals(projected.events, []);
        } finally {
            await cleanupFixture(fixture);
        }
    });
});

Deno.test("segment rollover keeps aggregate projection readable and rolls managed metadata atomically", async () => {
    await withProcessGlobalTestLock(async () => {
        const fixture = await createManagedFixture();
        try {
            const before = await readProjection(fixture);
            assert(before.ok);
            const result = await rollSessionTranscriptSegment({
                hostedSession: fixture.hosted,
                ownerCoordinationStore: fixture.store,
                ownerInstanceId: "owner-1",
                ownerProcessKind: "test",
                kind: "execution",
                continuation: { next: "engineer" },
            });
            const after = await readProjection(fixture);
            assert(after.ok);
            assertEquals(after.events.map((event) => event.type), before.events.map((event) => event.type));
            const managed = fixture.hosted.getManagedMetadata();
            assert(managed);
            assertEquals(managed.piSessionId, result.piSessionId);
            assertEquals(managed.transcriptPath, result.transcriptPath);
            assertEquals(managed.currentSegmentId, result.successorSegmentId);
            assertEquals(managed.generation, 1);
            const postProof = fixture.store.acquireSessionActivation({
                runwieldSessionId: managed.runwieldSessionId,
                projectId: managed.projectId,
                ownerInstanceId: "owner-2",
                ownerProcessKind: "test",
                expectedGeneration: managed.generation,
                expectedCurrentSegmentId: managed.currentSegmentId,
                phase: "preparing",
            });
            fixture.store.releaseUnchangedActivation(postProof);
        } finally {
            await cleanupFixture(fixture);
        }
    });
});

Deno.test("segment rollover uses one generic continuation path for execution and semantic repair", async () => {
    await withProcessGlobalTestLock(async () => {
        const fixture = await createManagedFixture();
        try {
            const execution = await rollSessionTranscriptSegment({
                hostedSession: fixture.hosted,
                ownerCoordinationStore: fixture.store,
                ownerInstanceId: "owner-1",
                ownerProcessKind: "test",
                kind: "execution",
                continuation: { mode: "execution" },
            });
            const repair = await rollSessionTranscriptSegment({
                hostedSession: fixture.hosted,
                ownerCoordinationStore: fixture.store,
                ownerInstanceId: "owner-1",
                ownerProcessKind: "test",
                kind: "semantic_repair",
                continuation: { mode: "repair" },
            });
            assertEquals(execution.continuation, { mode: "execution" });
            assertEquals(repair.continuation, { mode: "repair" });
            assertEquals(
                fixture.store.listSessionTranscriptSegments(fixture.session.runwieldSessionId).map((segment) =>
                    segment.kind
                ),
                [
                    "planning",
                    "execution",
                    "semantic_repair",
                ],
            );
        } finally {
            await cleanupFixture(fixture);
        }
    });
});

Deno.test("consecutive rollovers preserve one unsealed current segment and continuous projection", async () => {
    await withProcessGlobalTestLock(async () => {
        const fixture = await createManagedFixture();
        try {
            for (let index = 0; index < 3; index += 1) {
                await rollSessionTranscriptSegment({
                    hostedSession: fixture.hosted,
                    ownerCoordinationStore: fixture.store,
                    ownerInstanceId: "owner-1",
                    ownerProcessKind: "test",
                    kind: "execution",
                    continuation: { index },
                });
            }
            const segments = fixture.store.listSessionTranscriptSegments(fixture.session.runwieldSessionId);
            assertEquals(segments.map((segment) => segment.ordinal), [0, 1, 2, 3]);
            assertEquals(segments.filter((segment) => !segment.sealedAt).length, 1);
            const generations = fixture.store.inspectSessionActivation(fixture.session.runwieldSessionId);
            assertEquals(generations.generation?.generation, 3);
            const projected = await readProjection(fixture);
            assert(projected.ok);
        } finally {
            await cleanupFixture(fixture);
        }
    });
});

Deno.test("orphan rollover candidates are identifiable and discardable before any row exists", async () => {
    await withProcessGlobalTestLock(async () => {
        const fixture = await createManagedFixture();
        try {
            const orphanManager = await createRootSessionManager("new", fixture.root);
            const orphanPath = await resolveCreatedRootSessionPath(fixture.root, orphanManager);
            recordSegmentLineageEvidence(orphanManager, {
                segmentId: "orphan-segment",
                runwieldSessionId: fixture.session.runwieldSessionId,
                parentSegmentId: fixture.segment.segmentId,
                parentPiSessionId: fixture.segment.piSessionId,
                lineageGroupKey: fixture.segment.segmentId,
            });
            recordPendingSegmentContinuation(orphanManager, { pending: true });
            await Promise.resolve(
                (/** @type {{ dispose?: () => void | Promise<void> }} */ (orphanManager)).dispose?.(),
            );
            await syncTranscriptFileAndParent(orphanPath);
            const candidates = await fixture.store.findOrphanRolloverCandidates({
                runwieldSessionId: fixture.session.runwieldSessionId,
                projectId: fixture.project.projectId,
                transcriptCwd: fixture.root,
            });
            assertEquals(candidates.map((candidate) => candidate.transcriptPath), [orphanPath]);
            await fixture.store.discardOrphanRolloverCandidate({
                runwieldSessionId: fixture.session.runwieldSessionId,
                transcriptCwd: fixture.root,
                transcriptPath: orphanPath,
            });
            const after = await fixture.store.findOrphanRolloverCandidates({
                runwieldSessionId: fixture.session.runwieldSessionId,
                projectId: fixture.project.projectId,
                transcriptCwd: fixture.root,
            });
            assertEquals(after, []);
        } finally {
            await cleanupFixture(fixture);
        }
    });
});
