import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createHash } from "node:crypto";
import { openFileSessionStore } from "./file-session-store.ts";
import { findPlanAssociatedSessions } from "./plan-session-lookup.ts";
import { encodeCwdForSessionDir } from "./root-session.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

async function makeFixture() {
    const rootDir = await Deno.makeTempDir({ prefix: "runwield-plan-session-lookup-" });
    const projectRoot = join(rootDir, "project");
    const sessionBaseDir = join(rootDir, "sessions");
    await Deno.mkdir(projectRoot);
    const canonicalProjectRoot = await Deno.realPath(projectRoot);
    const sessionDir = join(sessionBaseDir, encodeCwdForSessionDir(canonicalProjectRoot));
    await Deno.mkdir(sessionDir, { recursive: true });
    return { rootDir, projectRoot, sessionBaseDir, sessionDir };
}

async function writeTranscript(sessionDir: string, cwd: string, id: string) {
    const path = join(sessionDir, `${TIMESTAMP.replace(/[:.]/g, "-")}_${id}.jsonl`);
    await Deno.writeTextFile(
        path,
        `${JSON.stringify({ type: "session", version: 3, id, timestamp: TIMESTAMP, cwd })}\n`,
    );
    return path;
}

async function publishAssociation(
    store: ReturnType<typeof openFileSessionStore>,
    session: Awaited<ReturnType<ReturnType<typeof openFileSessionStore>["ensureSessionCatalogRecord"]>>,
    projectId: string,
    purpose: "planning" | "review" | "execution" | "recovery" = "planning",
) {
    let proof = store.acquireSessionActivation({
        runwieldSessionId: session.runwieldSessionId,
        projectId,
        ownerInstanceId: "owner",
        ownerProcessKind: "test",
    });
    const segment = store.getCurrentSessionSegment(session.runwieldSessionId);
    assert(segment);
    store.stagePlanAssociation(proof, {
        planId: "plan-1",
        planName: "example-plan",
        purpose,
        segmentId: segment.segmentId,
        segmentKind: segment.kind,
        recordedAt: TIMESTAMP,
    });
    proof = store.changeSessionActivationPhase(proof, "hydrated");
    proof = store.changeSessionActivationPhase(proof, "checkpointing");
    const bytes = await Deno.readFile(session.transcriptPath);
    store.publishGenerationAndRelease(proof, {
        generation: 0,
        byteLength: bytes.byteLength,
        terminalEntryId: null,
        digestHex: createHash("sha256").update(bytes).digest("hex"),
    });
}

Deno.test("findPlanAssociatedSessions returns safe planning candidates from manifests", async () => {
    const fixture = await makeFixture();
    try {
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "safe-session");
        const session = await store.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "safe-session",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        await publishAssociation(store, session, project.projectId);

        const candidates = await findPlanAssociatedSessions(store, { cwd: fixture.projectRoot, planId: "plan-1" });

        assertEquals(candidates.length, 1);
        assertEquals(candidates[0].runwieldSessionId, session.runwieldSessionId);
        assertEquals(candidates[0].safePlanningResume, true);
        assertEquals(candidates[0].reason, null);
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});

Deno.test("findPlanAssociatedSessions ignores raw transcript associations that were not published", async () => {
    const fixture = await makeFixture();
    try {
        const store = openFileSessionStore({ baseDir: fixture.sessionBaseDir });
        const project = store.ensureRuntimeProject({ root: fixture.projectRoot });
        const transcriptPath = await writeTranscript(fixture.sessionDir, fixture.projectRoot, "raw-tail-session");
        await store.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "raw-tail-session",
            transcriptPath,
            transcriptCwd: fixture.projectRoot,
            source: "created",
        });
        await Deno.writeTextFile(
            transcriptPath,
            `${
                JSON.stringify({
                    type: "custom",
                    customType: "runwield.plan_association",
                    data: {
                        planId: "plan-1",
                        planName: "example-plan",
                        purpose: "planning",
                        segmentId: "segment-tail",
                        segmentKind: "planning",
                        recordedAt: TIMESTAMP,
                    },
                })
            }\n`,
            { append: true },
        );

        assertEquals(await findPlanAssociatedSessions(store, { cwd: fixture.projectRoot, planId: "plan-1" }), []);
    } finally {
        await Deno.remove(fixture.rootDir, { recursive: true });
    }
});
