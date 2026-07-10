import { assertEquals, assertRejects } from "@std/assert";
import {
    getRootSessionBranchEntries,
    getRunWieldSessionDir,
    getRunWieldSessionMemoryBackupDir,
    listPersistedRootSessions,
    openPersistedRootSession,
} from "./root-session.js";

Deno.test("root-session persisted helpers list open and guard cwd paths", async () => {
    const previousHome = Deno.env.get("HOME");
    const home = await Deno.makeTempDir();
    Deno.env.set("HOME", home);
    try {
        const { SessionManager } = await import("@earendil-works/pi-coding-agent");
        const cwd = `${home}/repo`;
        await Deno.mkdir(cwd, { recursive: true });
        const sessionDir = getRunWieldSessionDir(cwd);
        assertEquals(
            getRunWieldSessionMemoryBackupDir(cwd, "persisted-test"),
            `${sessionDir}/persisted-test_memory-backups`,
        );
        const manager = SessionManager.create(cwd, sessionDir, { id: "persisted-test" });
        manager.appendMessage(
            /** @type {any} */ ({ role: "user", timestamp: Date.now(), content: [{ type: "text", text: "hello" }] }),
        );
        manager.appendMessage(
            /** @type {any} */ ({
                role: "assistant",
                timestamp: Date.now(),
                api: "test",
                provider: "test",
                model: "test",
                usage: {},
                cost: {},
                stopReason: "end_turn",
                content: [{ type: "text", text: "hi" }],
            }),
        );

        const sessions = await listPersistedRootSessions(cwd);
        assertEquals(sessions.length, 1);
        assertEquals(sessions[0].id, "persisted-test");

        const opened = await openPersistedRootSession({ cwd, sessionId: "persisted-test" });
        assertEquals(opened.resolved.sessionId, "persisted-test");
        assertEquals(opened.sessionManager.getSessionId(), "persisted-test");
        assertEquals(getRootSessionBranchEntries(opened.sessionManager).length, 2);

        await assertRejects(
            () => openPersistedRootSession({ cwd, sessionId: "persisted-test", sessionPath: `${home}/outside.jsonl` }),
            Error,
            "outside the RunWield session directory",
        );
    } finally {
        if (previousHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", previousHome);
        await Deno.remove(home, { recursive: true });
    }
});
