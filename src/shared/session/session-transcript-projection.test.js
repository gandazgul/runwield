import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { encodeCwdForSessionDir } from "./root-session.js";
import {
    captureTranscriptEvidence,
    projectCommittedTranscript,
    selectProjectedEventsAfterCursor,
} from "./session-transcript-projection.js";

/** @param {(home: string) => Promise<void>} callback */
async function withHome(callback) {
    const previousHome = Deno.env.get("HOME");
    const home = await Deno.makeTempDir({ prefix: "runwield-projection-home-" });
    Deno.env.set("HOME", home);
    try {
        return await callback(home);
    } finally {
        if (previousHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", previousHome);
        await Deno.remove(home, { recursive: true });
    }
}

Deno.test("committed projection verifies exact prefix and ignores later tail", async () => {
    await withHome(async (home) => {
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const sessionDir = join(home, ".wld", "sessions", encodeCwdForSessionDir(cwd));
        await Deno.mkdir(sessionDir, { recursive: true });
        const sessionPath = join(sessionDir, "pi-1.jsonl");
        const committed = [
            { type: "session", id: "pi-1", cwd, timestamp: "2026-01-01T00:00:00.000Z" },
            {
                type: "message",
                id: "entry-user",
                timestamp: "2026-01-01T00:00:01.000Z",
                message: { role: "user", content: "hello" },
            },
            {
                type: "message",
                id: "entry-assistant",
                timestamp: "2026-01-01T00:00:02.000Z",
                message: { role: "assistant", content: "hi" },
            },
        ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
        await Deno.writeTextFile(
            sessionPath,
            committed +
                JSON.stringify({ type: "message", id: "tail", message: { role: "assistant", content: "hidden" } }) +
                "\n",
        );
        const evidence = await captureTranscriptEvidence({
            transcriptPath: sessionPath,
            transcriptCwd: cwd,
            byteLength: new TextEncoder().encode(committed).byteLength,
        });
        const projected = await projectCommittedTranscript({
            cwd,
            sessionDir,
            sessionPath,
            generation: 0,
            byteLength: evidence.byteLength,
            terminalEntryId: evidence.terminalEntryId,
            digestHex: evidence.digestHex,
        });
        assertEquals(projected.events.map((event) => event.eventId), [
            "entry-user:user_message:0",
            "entry-assistant:assistant_text_delta:0",
        ]);
        assertEquals(projected.events.map((event) => event.type), ["user_message", "assistant_text_delta"]);
    });
});

Deno.test("committed projection rejects mismatched evidence", async () => {
    await withHome(async (home) => {
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const sessionDir = join(home, ".wld", "sessions", encodeCwdForSessionDir(cwd));
        await Deno.mkdir(sessionDir, { recursive: true });
        const sessionPath = join(sessionDir, "pi-1.jsonl");
        const content = JSON.stringify({ type: "session", id: "pi-1", cwd }) + "\n";
        await Deno.writeTextFile(sessionPath, content);
        await assertRejects(
            () =>
                projectCommittedTranscript({
                    cwd,
                    sessionDir,
                    sessionPath,
                    generation: 0,
                    byteLength: new TextEncoder().encode(content).byteLength,
                    terminalEntryId: null,
                    digestHex: "0".repeat(64),
                }),
            Error,
            "digest",
        );
    });
});

Deno.test("projection cursor selection returns only later events and advances summary-only generations", () => {
    const events = [
        { type: "user_message", eventId: "one" },
        { type: "assistant_text_delta", eventId: "two" },
        { type: "assistant_text_delta", eventId: "three" },
    ];
    const selected = selectProjectedEventsAfterCursor({ events, cursorEventId: "two" });
    assertEquals(selected.events.map((event) => event.eventId), ["three"]);
    assertEquals(selected.nextCursor, "three");
    const summaryOnly = selectProjectedEventsAfterCursor({ events: [], cursorEventId: null });
    assertEquals(summaryOnly.events, []);
    assertEquals(summaryOnly.nextCursor, null);
});

Deno.test("projection cursor selection fails closed when the prior cursor is absent", () => {
    const events = [{ type: "user_message", eventId: "one" }];
    assertThrows(
        () => selectProjectedEventsAfterCursor({ events, cursorEventId: "missing" }),
        Error,
        "Timeline cursor",
    );
});
