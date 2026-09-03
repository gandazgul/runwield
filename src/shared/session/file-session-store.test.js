import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { dirname, join } from "@std/path";
import { createHash } from "node:crypto";
import { classifyRootSessionLocator, encodeCwdForSessionDir } from "./root-session.js";
import { openFileSessionStore } from "./file-session-store.ts";
import { manifestPath } from "./file-session-storage.ts";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

/** @typedef {import("./file-session-store.ts").FileSessionStore} FileSessionStore */

/**
 * @typedef {Object} TestLineage
 * @property {string} runwieldSessionId
 * @property {string} segmentId
 * @property {string | null} parentSegmentId
 * @property {string | null} parentPiSessionId
 * @property {string | null} lineageGroupKey
 * @property {'planning' | 'execution' | 'semantic_repair'} kind
 */

/** @param {string} sessionDir @param {string} cwd @param {string} id @param {TestLineage | null} [lineage] @param {string} [timestamp] */
async function writeTranscript(sessionDir, cwd, id, lineage = null, timestamp = TIMESTAMP) {
    await Deno.mkdir(sessionDir, { recursive: true });
    const path = join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
    const entries = [JSON.stringify({ type: "session", version: 3, id, timestamp, cwd })];
    if (lineage) {
        entries.push(JSON.stringify({ type: "custom", customType: "runwield.segment_lineage", data: lineage }));
    }
    await Deno.writeTextFile(path, `${entries.join("\n")}\n`);
    return path;
}

async function makeFixture() {
    const rootDir = await Deno.makeTempDir({ prefix: "runwield-file-session-store-" });
    const projectRoot = join(rootDir, "project");
    const sessionBaseDir = join(rootDir, "sessions");
    await Deno.mkdir(projectRoot);
    const canonicalProjectRoot = await Deno.realPath(projectRoot);
    const sessionDir = join(sessionBaseDir, encodeCwdForSessionDir(canonicalProjectRoot));
    return { rootDir, projectRoot, sessionBaseDir, sessionDir };
}

Deno.test("Core catalogs every local Session without creating a Workspace database", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "legacy-session");
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const first = await store.listProjectSessions(project.projectId);
        assertEquals(first.sessions.length, 1);
        assertEquals(first.sessions[0].piSessionId, "legacy-session");
        assertEquals(first.sessions[0].transcriptPath, transcriptPath);
        assertEquals(
            store.listSessionTranscriptSegments(first.sessions[0].runwieldSessionId).map((item) => item.kind),
            [
                "planning",
            ],
        );
        assertFalse(await exists(join(fixture.rootDir, "owner-coordination.sqlite3")));
        const stableId = first.sessions[0].runwieldSessionId;
        store.close();

        const reopened = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        assertEquals((await reopened.listProjectSessions(project.projectId)).sessions[0].runwieldSessionId, stableId);
        reopened.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("Project Session listing returns 30 newest Sessions and paginates by date", async () => {
    const fixture = await makeFixture();
    try {
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        for (let index = 0; index < 31; index += 1) {
            const day = String(index + 1).padStart(2, "0");
            await writeTranscript(
                fixture.sessionDir,
                fixture.projectRoot,
                `session-${index}`,
                null,
                `2026-01-${day}T00:00:00.000Z`,
            );
        }

        const firstPage = await store.listProjectSessions(project.projectId, { page: 0, pageSize: 30 });
        const secondPage = await store.listProjectSessions(project.projectId, { page: 1, pageSize: 30 });

        assertEquals(firstPage.sessions.length, 30);
        assertEquals(secondPage.sessions.length, 1);
        assertEquals(firstPage.total, 31);
        assertEquals(firstPage.hasNext, true);
        assertEquals(secondPage.hasNext, false);
        assertEquals(firstPage.sessions[0].piSessionId, "session-30");
        assertEquals(secondPage.sessions[0].piSessionId, "session-0");
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("real and symlinked Project roots share one file authority", async () => {
    const fixture = await makeFixture();
    const linkedRoot = join(fixture.rootDir, "project-link");
    try {
        await Deno.symlink(fixture.projectRoot, linkedRoot);
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const realProject = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const linkedProject = store.ensureRuntimeProject({ root: linkedRoot });
        assertEquals(linkedProject.projectId, realProject.projectId);
        assertEquals(store.listSessionProjects().length, 1);
        const linkedSessionDir = fixture.sessionDir;
        assertEquals(
            (await classifyRootSessionLocator({ cwd: linkedRoot, ownerCoordinationStore: store })).project?.projectId,
            realProject.projectId,
        );
        assertEquals(
            (await classifyRootSessionLocator({ cwd: fixture.projectRoot, ownerCoordinationStore: store })).project
                ?.projectId,
            realProject.projectId,
        );

        const transcriptPath = await writeTranscript(linkedSessionDir, linkedRoot, "linked-session");
        const session = await store.ensureSessionCatalogRecord({
            projectId: linkedProject.projectId,
            piSessionId: "linked-session",
            transcriptPath,
            transcriptCwd: linkedRoot,
            source: "created",
        });
        assertEquals(session.projectId, realProject.projectId);
        assertEquals(session.transcriptPath, transcriptPath);
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("new Session catalog publication acquires its writer lock atomically", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "atomic-session");
        const firstStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const secondStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = firstStore.ensureRuntimeProject({ root: fixture.projectRoot });
        const acquired = await firstStore.ensureSessionCatalogRecordAndAcquire({
            locator: {
                projectId: project.projectId,
                piSessionId: "atomic-session",
                transcriptPath,
                transcriptCwd: fixture.projectRoot,
                source: "created",
            },
            activation: {
                ownerInstanceId: "creator",
                ownerProcessKind: "test",
                operationId: "create-operation",
            },
        });
        assertThrows(
            () =>
                secondStore.acquireSessionActivation({
                    runwieldSessionId: acquired.session.runwieldSessionId,
                    projectId: project.projectId,
                    ownerInstanceId: "racer",
                    ownerProcessKind: "test",
                    expectedGeneration: null,
                    expectedCurrentSegmentId: acquired.segment.segmentId,
                }),
            Error,
            "another RunWield surface",
        );
        firstStore.releaseUnchangedActivation(acquired.proof);
        firstStore.close();
        secondStore.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("active Session turns register durable artifact references without changing the writer phase", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "artifact-session");
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const acquired = await store.ensureSessionCatalogRecordAndAcquire({
            locator: {
                projectId: project.projectId,
                piSessionId: "artifact-session",
                transcriptPath,
                transcriptCwd: fixture.projectRoot,
                source: "created",
            },
            activation: {
                ownerInstanceId: "artifact-writer",
                ownerProcessKind: "test",
                operationId: "artifact-operation",
            },
        });

        const artifact = store.registerSessionArtifact(acquired.proof, {
            kind: "prd",
            path: "docs/prd/session-sidebar.md",
            title: "Session Sidebar",
            registeredBy: "Ideator",
            idFactory: () => "artifact-1",
            now: () => TIMESTAMP,
        });
        const duplicate = store.registerSessionArtifact(acquired.proof, {
            kind: "prd",
            path: "docs/prd/session-sidebar.md",
            title: "Changed title",
            registeredBy: "Ideator",
            idFactory: () => "artifact-2",
        });

        assertEquals(artifact, {
            artifactId: "artifact-1",
            kind: "prd",
            path: "docs/prd/session-sidebar.md",
            title: "Session Sidebar",
            registeredAt: TIMESTAMP,
            registeredBy: "Ideator",
            sourceSegmentId: acquired.segment.segmentId,
        });
        assertEquals(duplicate, artifact);
        assertEquals(store.listSessionArtifacts(acquired.session.runwieldSessionId), [artifact]);
        assertEquals(store.inspectSessionActivation(acquired.session.runwieldSessionId).activation?.phase, "preparing");

        store.releaseUnchangedActivation(acquired.proof);
        store.close();
        const reopened = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        assertEquals(reopened.listSessionArtifacts(acquired.session.runwieldSessionId), [artifact]);
        reopened.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("created and loaded Sessions do not scan unrelated Session manifests", async () => {
    const fixture = await makeFixture();
    const siblingRoot = join(fixture.rootDir, "sibling-project");
    try {
        await Deno.mkdir(siblingRoot);
        const canonicalSiblingRoot = await Deno.realPath(siblingRoot);
        const siblingSessionDir = join(fixture.sessionBaseDir, encodeCwdForSessionDir(canonicalSiblingRoot));
        const siblingTranscript = await writeTranscript(
            siblingSessionDir,
            canonicalSiblingRoot,
            "sibling-session",
        );
        const seedStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const siblingProject = seedStore.ensureRuntimeProject({ root: canonicalSiblingRoot, now: () => TIMESTAMP });
        const sibling = await seedStore.ensureSessionCatalogRecord({
            projectId: siblingProject.projectId,
            piSessionId: "sibling-session",
            transcriptPath: siblingTranscript,
            transcriptCwd: canonicalSiblingRoot,
            source: "created",
            idFactory: () => "sibling-runwield-session",
            now: () => TIMESTAMP,
        });
        seedStore.close();
        const siblingManifest = manifestPath(siblingSessionDir, sibling.runwieldSessionId);
        await Deno.remove(siblingManifest);
        assertFalse(await exists(siblingManifest));

        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "current-session");
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const current = await store.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "current-session",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
            idFactory: () => "current-runwield-session",
        });
        assertFalse(await exists(siblingManifest));
        assertEquals(store.listSessionArtifacts(current.runwieldSessionId), []);
        assertFalse(await exists(siblingManifest));
        store.close();

        const reopened = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        assertEquals(reopened.findSessionByLocator({ transcriptPath })?.runwieldSessionId, current.runwieldSessionId);
        assertFalse(await exists(siblingManifest));
        assertEquals(
            reopened.getSessionById(current.runwieldSessionId, project.projectId)?.runwieldSessionId,
            current.runwieldSessionId,
        );
        assertFalse(await exists(siblingManifest));
        reopened.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("cached Session manifests refresh after another surface publishes a change", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "shared-session");
        const reader = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = reader.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await reader.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "shared-session",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        const segment = reader.getCurrentSessionSegment(session.runwieldSessionId);
        assert(segment);
        assertEquals(reader.listSessionArtifacts(session.runwieldSessionId), []);

        const writer = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const proof = writer.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "artifact-writer",
            ownerProcessKind: "test",
            expectedGeneration: null,
            expectedCurrentSegmentId: segment.segmentId,
        });
        const artifact = writer.registerSessionArtifact(proof, {
            kind: "report",
            path: "reports/fresh.md",
            title: "Fresh report",
            registeredBy: "Reviewer",
            idFactory: () => "fresh-artifact",
            now: () => TIMESTAMP,
        });
        writer.releaseUnchangedActivation(proof);

        assertEquals(reader.listSessionArtifacts(session.runwieldSessionId), [artifact]);
        writer.close();
        reader.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("concurrent legacy migration converges on one Session identity", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "legacy-race");
        const firstStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const secondStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = firstStore.ensureRuntimeProject({ root: fixture.projectRoot });
        /** @param {FileSessionStore} store @param {string} id */
        const migrate = (store, id) =>
            store.ensureSessionCatalogRecord({
                projectId: project.projectId,
                piSessionId: "legacy-race",
                transcriptPath,
                transcriptCwd: fixture.projectRoot,
                source: "catalog",
                idFactory: () => id,
            });
        const [first, second] = await Promise.all([
            migrate(firstStore, "first-identity"),
            migrate(secondStore, "second-identity"),
        ]);
        assertEquals(first.runwieldSessionId, second.runwieldSessionId);
        assertEquals((await firstStore.listProjectSessions(project.projectId)).sessions.length, 1);
        firstStore.close();
        secondStore.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("the Session file lock permits exactly one writer and is released when its store closes", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "locked-session");
        const firstStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = firstStore.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await firstStore.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "locked-session",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        const segment = firstStore.getCurrentSessionSegment(session.runwieldSessionId);
        assert(segment);
        const proof = firstStore.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "first",
            ownerProcessKind: "test",
            expectedGeneration: null,
            expectedCurrentSegmentId: segment.segmentId,
        });

        const secondStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        assertThrows(
            () =>
                secondStore.acquireSessionActivation({
                    runwieldSessionId: session.runwieldSessionId,
                    projectId: project.projectId,
                    ownerInstanceId: "second",
                    ownerProcessKind: "test",
                    expectedGeneration: null,
                    expectedCurrentSegmentId: segment.segmentId,
                }),
            Error,
            "another RunWield surface",
        );
        firstStore.close();

        const recovered = secondStore.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "second",
            ownerProcessKind: "test",
            expectedGeneration: null,
            expectedCurrentSegmentId: segment.segmentId,
        });
        assertEquals(recovered.fence, proof.fence + 1);
        secondStore.releaseUnchangedActivation(recovered);
        secondStore.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("a missing or damaged manifest is restored from transcript-adjacent recovery evidence", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "recover-session");
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await store.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "recover-session",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        const manifestPath = join(
            fixture.sessionDir,
            ".runwield",
            "session-bundles",
            session.runwieldSessionId,
            "manifest.json",
        );
        await Deno.remove(manifestPath);
        assertEquals(store.getSessionById(session.runwieldSessionId)?.runwieldSessionId, session.runwieldSessionId);
        await Deno.writeTextFile(manifestPath, "not json\n");
        assertEquals(store.getSessionById(session.runwieldSessionId)?.runwieldSessionId, session.runwieldSessionId);
        const bundleEntries = [...Deno.readDirSync(dirname(manifestPath))];
        assert(bundleEntries.some((entry) => entry.name.startsWith("manifest.json.damaged-")));
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("recovery descriptor retains the initial writer baseline when the manifest is lost", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "baseline-recovery");
        const firstStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = firstStore.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await firstStore.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "baseline-recovery",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "catalog",
        });
        firstStore.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "interrupted-writer",
            ownerProcessKind: "test",
            expectedGeneration: null,
        });
        await Deno.writeTextFile(
            transcriptPath,
            `${JSON.stringify({ type: "message", message: { role: "user" } })}\n`,
            {
                append: true,
            },
        );
        const manifestPath = join(
            fixture.sessionDir,
            ".runwield",
            "session-bundles",
            session.runwieldSessionId,
            "manifest.json",
        );
        await Deno.remove(manifestPath);
        firstStore.close();

        const recoveredStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        assertThrows(
            () =>
                recoveredStore.acquireSessionActivation({
                    runwieldSessionId: session.runwieldSessionId,
                    projectId: project.projectId,
                    ownerInstanceId: "recovery-writer",
                    ownerProcessKind: "test",
                    expectedGeneration: null,
                }),
            Error,
            "requires recovery",
        );
        recoveredStore.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("transcript lineage reconstructs one ordered Session without a database or manifest", async () => {
    const fixture = await makeFixture();
    try {
        await writeTranscript(fixture.sessionDir, fixture.projectRoot, "planning");
        await writeTranscript(fixture.sessionDir, fixture.projectRoot, "execution", {
            runwieldSessionId: "stable-session",
            segmentId: "execution-segment",
            parentSegmentId: "planning-segment",
            parentPiSessionId: "planning",
            lineageGroupKey: "planning-segment",
            kind: "execution",
        });
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const result = await store.listProjectSessions(project.projectId);
        assertEquals(result.diagnostics, []);
        assertEquals(result.sessions.length, 1);
        assertEquals(result.sessions[0].runwieldSessionId, "stable-session");
        assertEquals(
            store.listSessionTranscriptSegments("stable-session").map((item) => ({
                piSessionId: item.piSessionId,
                kind: item.kind,
                ordinal: item.ordinal,
            })),
            [
                { piSessionId: "planning", kind: "planning", ordinal: 0 },
                { piSessionId: "execution", kind: "execution", ordinal: 1 },
            ],
        );
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("lineage recovery rejects a mismatched parent Pi identity", async () => {
    const fixture = await makeFixture();
    try {
        await writeTranscript(fixture.sessionDir, fixture.projectRoot, "planning", {
            runwieldSessionId: "mismatched-parent",
            segmentId: "planning-segment",
            parentSegmentId: null,
            parentPiSessionId: null,
            lineageGroupKey: "planning-segment",
            kind: "planning",
        });
        await writeTranscript(fixture.sessionDir, fixture.projectRoot, "execution", {
            runwieldSessionId: "mismatched-parent",
            segmentId: "execution-segment",
            parentSegmentId: "planning-segment",
            parentPiSessionId: "different-pi-session",
            lineageGroupKey: "planning-segment",
            kind: "execution",
        });
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const result = await store.listProjectSessions(project.projectId);
        assertEquals(result.sessions, []);
        assert(result.diagnostics.every((item) => item.code === "lineage_recovery_blocked"));
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("malformed lineage is blocked instead of cataloged as a legacy Session", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "malformed-lineage");
        await Deno.writeTextFile(
            transcriptPath,
            `${
                JSON.stringify({ type: "custom", customType: "runwield.segment_lineage", data: { segmentId: "only" } })
            }\n`,
            { append: true },
        );
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const result = await store.listProjectSessions(project.projectId);
        assertEquals(result.sessions, []);
        assertEquals(result.diagnostics.map((item) => item.code), ["lineage_recovery_blocked"]);
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("conflicting lineage entries fail closed", async () => {
    const fixture = await makeFixture();
    try {
        /** @type {TestLineage} */
        const firstLineage = {
            runwieldSessionId: "stable-session",
            segmentId: "planning-segment",
            parentSegmentId: null,
            parentPiSessionId: null,
            lineageGroupKey: "planning-segment",
            kind: "planning",
        };
        const transcriptPath = await writeTranscript(
            fixture.sessionDir,
            fixture.projectRoot,
            "conflicting-lineage",
            firstLineage,
        );
        await Deno.writeTextFile(
            transcriptPath,
            `${
                JSON.stringify({
                    type: "custom",
                    customType: "runwield.segment_lineage",
                    data: { ...firstLineage, runwieldSessionId: "different-session" },
                })
            }\n`,
            { append: true },
        );
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const result = await store.listProjectSessions(project.projectId);
        assertEquals(result.sessions, []);
        assertEquals(result.diagnostics.map((item) => item.code), ["lineage_recovery_blocked"]);
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("recovery rejects evidence that omits trailing transcript entries", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "stale-prefix");
        const original = await Deno.readFile(transcriptPath);
        const firstStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = firstStore.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await firstStore.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "stale-prefix",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        const proof = firstStore.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "abandoned-writer",
            ownerProcessKind: "test",
            expectedGeneration: null,
        });
        firstStore.close();
        await Deno.writeTextFile(
            transcriptPath,
            `${JSON.stringify({ type: "message", message: { role: "user", content: "trailing" } })}\n`,
            { append: true },
        );

        const recoveryStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        assertThrows(
            () =>
                recoveryStore.recoverSessionControl({
                    runwieldSessionId: session.runwieldSessionId,
                    projectId: project.projectId,
                    expectedFence: proof.fence,
                    expectedGeneration: null,
                    ownerInstanceId: "recovery",
                    ownerProcessKind: "test",
                    transcriptEvidence: {
                        byteLength: original.byteLength,
                        terminalEntryId: null,
                        digestHex: createHash("sha256").update(original).digest("hex"),
                    },
                }),
            Error,
            "transcript changed",
        );
        recoveryStore.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("initial recovery blocks a rewritten transcript prefix", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "prefix-original");
        const interruptedStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = interruptedStore.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await interruptedStore.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "prefix-original",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        const proof = interruptedStore.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "interrupted-writer",
            ownerProcessKind: "test",
            expectedGeneration: null,
        });
        interruptedStore.close();

        const rewritten = (await Deno.readTextFile(transcriptPath)).replace("prefix-original", "prefix-modified");
        await Deno.writeTextFile(transcriptPath, rewritten);
        const bytes = await Deno.readFile(transcriptPath);
        const recoveryStore = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        assertThrows(
            () =>
                recoveryStore.recoverSessionControl({
                    runwieldSessionId: session.runwieldSessionId,
                    projectId: project.projectId,
                    expectedFence: proof.fence,
                    expectedGeneration: null,
                    ownerInstanceId: "recovery",
                    ownerProcessKind: "test",
                    transcriptEvidence: {
                        byteLength: bytes.byteLength,
                        terminalEntryId: null,
                        digestHex: createHash("sha256").update(bytes).digest("hex"),
                    },
                }),
            Error,
            "baseline changed",
        );
        recoveryStore.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("initial recovery retains the writer baseline after activation becomes uncertain", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "initial-uncertain");
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await store.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "initial-uncertain",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        const proof = store.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "initial-writer",
            ownerProcessKind: "test",
            expectedGeneration: null,
        });
        await Deno.writeTextFile(
            transcriptPath,
            `${await Deno.readTextFile(transcriptPath)}${
                JSON.stringify({ type: "custom", customType: "writer-output" })
            }\n`,
        );
        store.markSessionUncertain(proof, { reason: "agent activation failed" });

        const bytes = await Deno.readFile(transcriptPath);
        const recovered = store.recoverSessionControl({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            expectedFence: proof.fence,
            expectedGeneration: null,
            ownerInstanceId: "recovery",
            ownerProcessKind: "test",
            transcriptEvidence: {
                byteLength: bytes.byteLength,
                terminalEntryId: null,
                digestHex: createHash("sha256").update(bytes).digest("hex"),
            },
        });
        assertEquals(recovered.activation?.state, "idle");
        assertEquals(recovered.generation?.generation, 0);
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("existing-generation recovery blocks a rewritten committed prefix", async () => {
    const fixture = await makeFixture();
    try {
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "safe-prefix");
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const session = await store.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "safe-prefix",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        const original = await Deno.readFile(transcriptPath);
        let proof = store.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "initial-writer",
            ownerProcessKind: "test",
            expectedGeneration: null,
        });
        proof = store.changeSessionActivationPhase(proof, "hydrated");
        proof = store.changeSessionActivationPhase(proof, "checkpointing");
        store.publishGenerationAndRelease(proof, {
            generation: 0,
            byteLength: original.byteLength,
            terminalEntryId: null,
            digestHex: createHash("sha256").update(original).digest("hex"),
        });
        const interrupted = store.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "interrupted-writer",
            ownerProcessKind: "test",
            expectedGeneration: 0,
        });
        store.markSessionUncertain(interrupted, { reason: "writer stopped before checkpoint" });

        const rewrittenText = (await Deno.readTextFile(transcriptPath)).replace("safe-prefix", "evil-prefix");
        await Deno.writeTextFile(transcriptPath, rewrittenText);
        const rewritten = await Deno.readFile(transcriptPath);
        assertThrows(
            () =>
                store.recoverSessionControl({
                    runwieldSessionId: session.runwieldSessionId,
                    projectId: project.projectId,
                    expectedFence: interrupted.fence,
                    expectedGeneration: 0,
                    ownerInstanceId: "recovery",
                    ownerProcessKind: "test",
                    transcriptEvidence: {
                        byteLength: rewritten.byteLength,
                        terminalEntryId: null,
                        digestHex: createHash("sha256").update(rewritten).digest("hex"),
                    },
                }),
            Error,
            "baseline changed",
        );
        store.close();
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

/** @param {string} path */
async function exists(path) {
    try {
        await Deno.stat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}
