import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { getHomeDir } from "../../constants.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { openFileSessionStore } from "./file-session-store.ts";
import { getRunWieldSessionDir } from "./root-session.js";
import { listRecentResumableSessions, RECENT_SESSION_LIMIT } from "./session-resume-list.ts";

function transcriptText(id: string, cwd: string, timestamp: string, index: number): string {
    return [
        JSON.stringify({ type: "session", version: 3, id, timestamp, cwd }),
        JSON.stringify({
            type: "message",
            id: `message-${index}`,
            parentId: null,
            timestamp,
            message: { role: "user", content: `Session ${index}`, timestamp },
        }),
        "",
    ].join("\n");
}

Deno.test("resume listing reads only the 30 newest transcripts and returns them newest first", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-recent-session-list-" });
        Deno.env.set("HOME", home);
        const cwd = join(home, "project");
        await Deno.mkdir(cwd, { recursive: true });
        const store = openFileSessionStore();
        try {
            store.ensureRuntimeProject({ root: cwd });
            const sessionDir = getRunWieldSessionDir(cwd);
            await Deno.mkdir(sessionDir, { recursive: true });
            for (let index = 0; index < 64; index++) {
                const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
                const id = `pi-${String(index).padStart(2, "0")}`;
                const filename = `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`;
                const transcriptPath = join(sessionDir, filename);
                await Deno.writeTextFile(
                    transcriptPath,
                    transcriptText(id, cwd, timestamp, index),
                );
                const modified = new Date(Date.UTC(2026, 1, 1, 0, 0, index));
                await Deno.utime(transcriptPath, modified, modified);
            }

            const listed = await listRecentResumableSessions(cwd, store);

            assertEquals(listed.length, RECENT_SESSION_LIMIT);
            assertEquals(
                listed.map((session) => session.id),
                Array.from({ length: RECENT_SESSION_LIMIT }, (_, offset) => `pi-${63 - offset}`),
            );
            assertEquals(listed[0].firstMessage, "Session 63");
            assertEquals(listed.at(-1)?.firstMessage, "Session 34");
        } finally {
            store.close();
            Deno.env.set("HOME", previousHome);
            await Deno.remove(home, { recursive: true });
        }
    });
});

Deno.test("resume listing hides a conversation while another TUI holds its lock", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-active-session-list-" });
        Deno.env.set("HOME", home);
        const cwd = join(home, "project");
        await Deno.mkdir(cwd, { recursive: true });
        const holderStore = openFileSessionStore();
        const listingStore = openFileSessionStore();
        try {
            const project = holderStore.ensureRuntimeProject({ root: cwd });
            const sessionDir = getRunWieldSessionDir(cwd);
            await Deno.mkdir(sessionDir, { recursive: true });
            const timestamp = "2026-01-01T00:00:00.000Z";
            const piSessionId = "pi-active-tui";
            const transcriptPath = join(
                sessionDir,
                `${timestamp.replace(/[:.]/g, "-")}_${piSessionId}.jsonl`,
            );
            await Deno.writeTextFile(transcriptPath, transcriptText(piSessionId, cwd, timestamp, 1));
            const session = await holderStore.ensureSessionCatalogRecord({
                projectId: project.projectId,
                piSessionId,
                transcriptPath,
                transcriptCwd: cwd,
                source: "created",
            });
            const segment = holderStore.getCurrentSessionSegment(session.runwieldSessionId);
            if (!segment) throw new Error("Fixture Session segment is unavailable");
            const proof = holderStore.acquireSessionActivation({
                runwieldSessionId: session.runwieldSessionId,
                projectId: project.projectId,
                ownerInstanceId: "older-tui",
                ownerProcessKind: "tui",
                expectedGeneration: null,
                expectedCurrentSegmentId: segment.segmentId,
                phase: "turning",
            });

            const whileActive = await listRecentResumableSessions(cwd, listingStore);
            assertEquals(whileActive, []);

            holderStore.releaseUnchangedActivation(proof);
            const afterRelease = await listRecentResumableSessions(cwd, listingStore);
            assertEquals(afterRelease.map((entry) => entry.id), [piSessionId]);
        } finally {
            listingStore.close();
            holderStore.close();
            Deno.env.set("HOME", previousHome);
            await Deno.remove(home, { recursive: true });
        }
    });
});

Deno.test("resume listing ignores an unrelated parent Project record", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-parent-project-resume-list-" });
        Deno.env.set("HOME", home);
        const parentRoot = join(home, "projects");
        const cwd = join(parentRoot, "brandchef.ai");
        await Deno.mkdir(cwd, { recursive: true });
        const store = openFileSessionStore();
        try {
            store.ensureRuntimeProject({ root: parentRoot });
            const sessionDir = getRunWieldSessionDir(cwd);
            await Deno.mkdir(sessionDir, { recursive: true });
            const timestamp = "2026-08-16T17:00:00.000Z";
            const piSessionId = "brandchef-session";
            await Deno.writeTextFile(
                join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${piSessionId}.jsonl`),
                transcriptText(piSessionId, cwd, timestamp, 1),
            );

            const listed = await listRecentResumableSessions(cwd, store);

            assertEquals(listed.map((session) => session.id), [piSessionId]);
        } finally {
            store.close();
            Deno.env.set("HOME", previousHome);
            await Deno.remove(home, { recursive: true });
        }
    });
});
