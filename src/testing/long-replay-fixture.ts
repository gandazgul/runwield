import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { makeManagedSessionFixture, readTranscriptEvidence } from "./managed-session-fixture.ts";

export async function makeLongReplayFixture(home: string, projectRoot: string) {
    const fixture = await makeManagedSessionFixture({ home, projectRoot });
    let proof = fixture.store.acquireSessionActivation({
        runwieldSessionId: fixture.session.runwieldSessionId,
        projectId: fixture.project.projectId,
        ownerInstanceId: "long-replay-fixture",
        ownerProcessKind: "test",
        expectedGeneration: 0,
        phase: "bootstrap",
    });
    const transcript = await Deno.readTextFile(fixture.transcriptPath);
    const entries = transcript.trim().split("\n").map((line) => JSON.parse(line));
    entries[0].version = 3;
    for (let index = 1; index < entries.length; index++) {
        entries[index].parentId = index === 1 ? null : entries[index - 1].id;
    }
    const texts = Array.from({ length: 450 }, (_, index) => `Saved reply ${String(index + 1).padStart(3, "0")}.`);
    for (const [index, text] of texts.entries()) {
        entries.push({
            type: "message",
            id: `saved-reply-${index}`,
            parentId: entries.at(-1).id,
            timestamp: "2026-01-01T00:00:05.000Z",
            message: fauxAssistantMessage(fauxText(text)),
        });
    }
    await Deno.writeTextFile(fixture.transcriptPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    proof = fixture.store.changeSessionActivationPhase(proof, "checkpointing");
    fixture.store.publishGenerationAndRelease(proof, {
        generation: 1,
        currentSegmentId: fixture.store.getCurrentSessionSegment(fixture.session.runwieldSessionId)?.segmentId ?? null,
        ...await readTranscriptEvidence(fixture.transcriptPath),
    });
    return { ...fixture, texts };
}
