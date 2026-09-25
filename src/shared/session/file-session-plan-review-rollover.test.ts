import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createHash } from "node:crypto";
import { openFileSessionStore } from "./file-session-store.ts";
import { encodeCwdForSessionDir } from "./root-session.js";
import { manifestPath } from "./file-session-storage.ts";

async function evidence(path: string) {
    const bytes = await Deno.readFile(path);
    return {
        byteLength: bytes.byteLength,
        digestHex: createHash("sha256").update(bytes).digest("hex"),
        terminalEntryId: null,
    };
}

Deno.test("the latest Plan review reference survives segment rollover and descriptor reconstruction", async () => {
    const root = await Deno.makeTempDir({ prefix: "review-rollover-" });
    const projectRoot = join(root, "project");
    const baseDir = join(root, "sessions");
    await Deno.mkdir(projectRoot);
    const sessionDir = join(baseDir, encodeCwdForSessionDir(await Deno.realPath(projectRoot)));
    await Deno.mkdir(sessionDir, { recursive: true });
    const firstPath = join(sessionDir, "2026-01-01T00-00-00-000Z_first.jsonl");
    const nextPath = join(sessionDir, "2026-01-01T00-01-00-000Z_second.jsonl");
    await Deno.writeTextFile(
        firstPath,
        `${
            JSON.stringify({
                type: "session",
                version: 3,
                id: "first",
                timestamp: "2026-01-01T00:00:00.000Z",
                cwd: projectRoot,
            })
        }\n`,
    );
    const store = openFileSessionStore({ baseDir });
    try {
        const project = store.ensureRuntimeProject({ root: projectRoot });
        const session = await store.ensureSessionCatalogRecord({
            projectId: project.projectId,
            piSessionId: "first",
            transcriptPath: firstPath,
            transcriptCwd: projectRoot,
        });
        const segment = store.getCurrentSessionSegment(session.runwieldSessionId);
        assert(segment);
        let proof = store.acquireSessionActivation({
            runwieldSessionId: session.runwieldSessionId,
            projectId: project.projectId,
            ownerInstanceId: "writer",
            ownerProcessKind: "test",
            expectedCurrentSegmentId: segment.segmentId,
        });
        const reference = store.recordLastPlanReview(proof, {
            planId: "reviewed-plan-id",
            planName: "reviewed-plan",
            planningAgentName: "architect",
        });
        proof = store.changeSessionActivationPhase(proof, "hydrated");
        proof = store.changeSessionActivationPhase(proof, "checkpointing");
        await Deno.writeTextFile(
            nextPath,
            `${
                JSON.stringify({
                    type: "session",
                    version: 3,
                    id: "second",
                    timestamp: "2026-01-01T00:01:00.000Z",
                    cwd: projectRoot,
                })
            }\n`,
        );
        const safe = await store.validateSuccessorSegmentLocator({
            projectId: project.projectId,
            piSessionId: "second",
            transcriptPath: nextPath,
            transcriptCwd: projectRoot,
        });
        const rollover = store.commitSegmentRolloverAndPublish(proof, {
            predecessorSegmentId: segment.segmentId,
            predecessorEvidence: await evidence(firstPath),
            successor: {
                runwieldSessionId: session.runwieldSessionId,
                projectId: project.projectId,
                piSessionId: "second",
                transcriptPath: nextPath,
                transcriptCwd: projectRoot,
                kind: "execution",
                idFactory: () => "next-segment",
            },
            successorSafeLocator: safe,
            generationEvidence: { generation: 0, currentSegmentId: "next-segment", ...await evidence(nextPath) },
        });
        assertEquals(rollover.successor.segmentId, "next-segment");
        assertEquals(store.getLastPlanReview(session.runwieldSessionId, project.projectId), reference);
        store.close();
        const resumed = openFileSessionStore({ baseDir });
        try {
            assertEquals(resumed.getCurrentSessionSegment(session.runwieldSessionId)?.segmentId, "next-segment");
            assertEquals(resumed.getLastPlanReview(session.runwieldSessionId, project.projectId), reference);
        } finally {
            resumed.close();
        }
        await Deno.remove(manifestPath(sessionDir, session.runwieldSessionId));
        const recovered = openFileSessionStore({ baseDir });
        try {
            assertEquals(recovered.getCurrentSessionSegment(session.runwieldSessionId)?.segmentId, "next-segment");
            assertEquals(recovered.getLastPlanReview(session.runwieldSessionId, project.projectId), reference);
        } finally {
            recovered.close();
        }
    } finally {
        store.close();
        await Deno.remove(root, { recursive: true });
    }
});
