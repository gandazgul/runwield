import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { encodeCwdForSessionDir } from "./root-session.js";
import {
    captureTranscriptEvidence,
    createReplayEvents,
    getCommittedTranscriptAuthorityFacts,
    projectCommittedTranscript,
    selectProjectedEventsAfterCursor,
    summarizeProjectedEntries,
} from "./session-transcript-projection.js";

/** @param {string} path */
async function removeTempDir(path) {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await Deno.remove(path, { recursive: true });
            return;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return;
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        }
    }
    throw lastError;
}

/** @param {(home: string) => Promise<void>} callback */
async function withHome(callback) {
    return await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const home = await Deno.makeTempDir({ prefix: "runwield-projection-home-" });
        Deno.env.set("HOME", home);
        try {
            return await callback(home);
        } finally {
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
}

Deno.test("committed projection verifies exact prefix and ignores later tail", async () => {
    await withHome(async (home) => {
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const sessionDir = join(home, ".wld", "sessions", encodeCwdForSessionDir(cwd));
        await Deno.mkdir(sessionDir, { recursive: true });
        const sessionPath = join(sessionDir, "2026-01-01T00-00-00-000Z_pi-1.jsonl");
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

Deno.test("committed projection replays Claude CLI final messages as ordinary transcript text", async () => {
    await withHome(async (home) => {
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const sessionDir = join(home, ".wld", "sessions", encodeCwdForSessionDir(cwd));
        await Deno.mkdir(sessionDir, { recursive: true });
        const sessionPath = join(sessionDir, "2026-01-01T00-00-00-000Z_claude.jsonl");
        const committed = [
            { type: "session", id: "claude", cwd, timestamp: "2026-01-01T00:00:00.000Z" },
            {
                type: "custom",
                id: "backend",
                customType: "runwield.execution_backend",
                data: { backend: "claude-cli" },
            },
            { type: "message", id: "user", message: { role: "user", content: [{ type: "text", text: "hi claude" }] } },
            { type: "model_change", id: "model", provider: "claude-cli", modelId: "sonnet" },
            {
                type: "message",
                id: "assistant",
                message: { role: "assistant", content: [{ type: "text", text: "stream complete" }] },
            },
        ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
        await Deno.writeTextFile(sessionPath, committed);
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
        assertEquals(projected.events.map((event) => event.type), ["user_message", "assistant_text_delta"]);
        assertEquals(
            projected.events.map((event) => "text" in event ? event.text : "delta" in event ? event.delta : ""),
            ["hi claude", "stream complete"],
        );
    });
});

Deno.test("committed projection rejects mismatched evidence", async () => {
    await withHome(async (home) => {
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const sessionDir = join(home, ".wld", "sessions", encodeCwdForSessionDir(cwd));
        await Deno.mkdir(sessionDir, { recursive: true });
        const sessionPath = join(sessionDir, "2026-01-01T00-00-00-000Z_pi-1.jsonl");
        const content = JSON.stringify({
            type: "session",
            id: "pi-1",
            cwd,
            timestamp: "2026-01-01T00:00:00.000Z",
        }) + "\n";
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

Deno.test("projection resolves active agent machine names to display names", () => {
    const events = createReplayEvents("projection", [
        { type: "custom", id: "agent", customType: "runwield.active_agent", data: { agentName: "frontend-engineer" } },
        {
            type: "message",
            id: "reply",
            message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
        },
    ], { projectRoot: Deno.cwd() });
    assertEquals(events.find((event) => event.type === "assistant_text_delta")?.agentName, "Frontend Engineer");
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

Deno.test("projection summary preserves stable attention event identity", () => {
    const first = summarizeProjectedEntries([
        { type: "custom", id: "agent-entry", customType: "runwield.active_agent", data: { agentName: "Ideator" } },
        {
            type: "custom",
            id: "attention-entry",
            customType: "runwield.attention",
            data: { reason: "agentStopped", agentName: "Ideator" },
        },
    ]);
    const second = summarizeProjectedEntries([
        { type: "custom", id: "agent-entry", customType: "runwield.active_agent", data: { agentName: "Ideator" } },
        {
            type: "custom",
            id: "attention-entry",
            customType: "runwield.attention",
            data: { reason: "agentStopped", agentName: "Ideator" },
        },
    ]);

    assertEquals(first.attention, {
        eventId: "attention-entry:attention_requested:0",
        reason: "agentStopped",
        agentName: "Ideator",
    });
    assertEquals(second.attention?.eventId, first.attention?.eventId);
});

Deno.test("committed transcript authority facts are explicit projection extracts", () => {
    const facts = getCommittedTranscriptAuthorityFacts({
        snapshot: {
            activeAgent: "Ideator",
            model: "gpt-test",
            provider: "openai",
            thinkingLevel: "high",
            workflowContext: { routingIntent: "FEATURE", complexity: "LOW" },
        },
    });

    assertEquals(facts, {
        activeAgent: "Ideator",
        model: "gpt-test",
        provider: "openai",
        thinkingLevel: "high",
        workflowContext: { routingIntent: "FEATURE", complexity: "LOW" },
        planAssociations: [],
    });
    assertEquals(getCommittedTranscriptAuthorityFacts(null), {
        activeAgent: null,
        model: null,
        provider: null,
        thinkingLevel: null,
        workflowContext: null,
        planAssociations: [],
    });
});

Deno.test("projection cursor selection fails closed when the prior cursor is absent", () => {
    const events = [{ type: "user_message", eventId: "one" }];
    assertThrows(
        () => selectProjectedEventsAfterCursor({ events, cursorEventId: "missing" }),
        Error,
        "Timeline cursor",
    );
});

Deno.test("projection cursor selection validates prefix ordinal continuity", () => {
    const events = [
        { type: "user_message", eventId: "one" },
        { type: "assistant_text_delta", eventId: "inserted" },
        { type: "assistant_text_delta", eventId: "two" },
    ];
    assertThrows(
        () => selectProjectedEventsAfterCursor({ events, cursorEventId: "two", cursorEventOrdinal: 1 }),
        Error,
        "prefix-continuous",
    );
    const selected = selectProjectedEventsAfterCursor({ events, cursorEventId: "two", cursorEventOrdinal: 2 });
    assertEquals(selected.events, []);
    assertEquals(selected.nextCursorOrdinal, 2);
});

Deno.test("^projection replays Claude backend failure entries as display-only status$", () => {
    const entries = [
        { type: "custom", id: "active", customType: "runwield.active_agent", data: { agentName: "Engineer" } },
        {
            type: "custom",
            id: "backend-failure",
            customType: "runwield.backend_status",
            data: {
                version: 1,
                backend: "claude-cli",
                kind: "auth_failed",
                exitCode: 1,
                message: "Claude Code authentication failed. Sign in to Claude Code, then retry this turn.",
            },
        },
        {
            type: "custom",
            id: "backend-canceled",
            customType: "runwield.backend_status",
            data: {
                version: 1,
                backend: "claude-cli",
                kind: "canceled",
                exitCode: null,
                message: "Claude Code turn canceled.",
            },
        },
    ];
    const events = createReplayEvents("projection", entries);
    assertEquals(events.map((event) => ({ type: event.type, level: event.level, messageId: event.messageId })), [
        { type: "system_status", level: "error", messageId: "backend-failure" },
        { type: "system_status", level: "warning", messageId: "backend-canceled" },
    ]);
    assertEquals(events[0].message, "Claude Code authentication failed. Sign in to Claude Code, then retry this turn.");
    assertEquals(getCommittedTranscriptAuthorityFacts({ snapshot: summarizeProjectedEntries(entries) }), {
        activeAgent: "engineer",
        workflowContext: null,
        model: null,
        provider: null,
        thinkingLevel: null,
        planAssociations: [],
    });
});

Deno.test("summarizeProjectedEntries exposes Plan Associations and ignores legacy planName-only context", () => {
    const association = {
        planId: "plan-1",
        planName: "example-plan",
        purpose: "planning",
        segmentId: "segment-1",
        segmentKind: "planning",
        recordedAt: "2026-01-01T00:00:00.000Z",
    };
    const summary = summarizeProjectedEntries([
        { type: "custom", customType: "runwield.workflow_context", data: { planName: "example-plan" } },
        { type: "custom", customType: "runwield.plan_association", data: association },
    ]);

    assertEquals(summary.workflowContext, { planName: "example-plan" });
    assertEquals(summary.planAssociations, [association]);
    assertEquals(
        summarizeProjectedEntries([
            { type: "custom", customType: "runwield.workflow_context", data: { planName: "example-plan" } },
        ]).planAssociations,
        [],
    );
});
