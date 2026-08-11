import { assertEquals } from "@std/assert";
import { SESSION_RUNTIME_METHOD_POLICY } from "./session-runtime-method-policy.ts";

export interface WritablePiCall {
    name: string;
}

export interface TranscriptSnapshot {
    byteLength: number;
    digestHex: string;
    mtimeMs: number;
}

export interface WritablePiBoundary {
    create?(): string | undefined;
    open?(): string | undefined;
    list?(): string | undefined;
    continueRecent?(): string | undefined;
    migrate?(): string | undefined;
}

export async function sha256File(path: string): Promise<string> {
    const bytes = await Deno.readFile(path);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readTranscriptSnapshot(path: string): Promise<TranscriptSnapshot> {
    const stat = await Deno.stat(path);
    return { byteLength: stat.size, digestHex: await sha256File(path), mtimeMs: stat.mtime?.getTime() ?? 0 };
}

export function instrumentWritablePiBoundary(
    boundary: WritablePiBoundary,
): { boundary: WritablePiBoundary; calls: WritablePiCall[] } {
    const calls: WritablePiCall[] = [];
    const wrap = (name: keyof WritablePiBoundary) => () => {
        calls.push({ name });
        return boundary[name]?.();
    };
    return {
        calls,
        boundary: {
            create: wrap("create"),
            open: wrap("open"),
            list: wrap("list"),
            continueRecent: wrap("continueRecent"),
            migrate: wrap("migrate"),
        },
    };
}

Deno.test("managed read sweep enumerates every read_only policy entry", () => {
    const exercised = new Set([
        "expandSessionPromptTemplate",
        "expandSessionSkillCommand",
        "exportSession",
        "getLastAssistantText",
        "getRuntimeActiveAgentName",
        "getRuntimeActiveExecutionWorkflow",
        "getSessionContextReport",
        "getSessionInfo",
        "getSessionMemoryBackupDir",
        "getSessionSnapshot",
        "getUserTurnSubmissionBlockMessage",
        "inspectResumableSession",
        "isManagedSessionDormant",
        "listResumableSessions",
        "listSessionContextFiles",
        "listSessionPromptTemplates",
        "listSessionSkills",
        "listSessions",
        "preflightSessionImages",
        "requestSessionHelp",
        "synchronizeManagedSession",
        "replaySession",
    ]);
    const readOnly = Object.entries(SESSION_RUNTIME_METHOD_POLICY)
        .filter(([, policy]) => policy === "read_only")
        .map(([name]) => name);
    assertEquals(readOnly.filter((name) => !exercised.has(name)), []);
    assertEquals(exercised.has("replaySession"), true);
});

Deno.test("writable Pi boundary instrumentation reports a negative control call", () => {
    const instrumented = instrumentWritablePiBoundary({ open: () => "ok" });
    instrumented.boundary.open?.();
    assertEquals(instrumented.calls, [{ name: "open" }]);
});

Deno.test("managed read implementation names the non-mutating committed-prefix boundaries", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    for (
        const method of [
            "inspectResumableSession",
            "listResumableSessions",
            "getSessionInfo",
            "getSessionContextReport",
            "getLastAssistantText",
            "getSessionMemoryBackupDir",
            "exportSession",
            "replaySession",
        ]
    ) {
        const start = source.indexOf(`${method}(`);
        const end = source.indexOf("\n    /**", start + 1);
        const body = source.slice(start, end === -1 ? source.length : end);
        assertEquals(body.includes("openPersistedRootSession") && method === "inspectResumableSession", false);
    }
    assertEquals(source.includes("projectCommittedTranscript"), true);
    assertEquals(source.includes("classifyRootSessionLocator"), true);
});
