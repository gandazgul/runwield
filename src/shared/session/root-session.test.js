import { assertEquals, assertRejects } from "@std/assert";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import {
    getRootSessionBranchEntries,
    getRunWieldSessionDir,
    getRunWieldSessionMemoryBackupDir,
    listCatalogSafeRootSessionLocators,
    listPersistedRootSessions,
    openPersistedRootSession,
    readCatalogSafeRootSessionLocator,
} from "./root-session.js";

Deno.test("root-session persisted helpers list open and guard cwd paths", async () => {
    await withProcessGlobalTestLock(async () => {
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
                /** @type {any} */ ({
                    role: "user",
                    timestamp: Date.now(),
                    content: [{ type: "text", text: "hello" }],
                }),
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
                () =>
                    openPersistedRootSession({
                        cwd,
                        sessionId: "persisted-test",
                        sessionPath: `${home}/outside.jsonl`,
                    }),
                Error,
                "outside the RunWield session directory",
            );
        } finally {
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await Deno.remove(home, { recursive: true });
        }
    });
});

Deno.test("catalog-safe root session locators read only header metadata and preserve transcript bytes", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const home = await Deno.makeTempDir();
        Deno.env.set("HOME", home);
        try {
            const cwd = `${home}/repo`;
            await Deno.mkdir(cwd, { recursive: true });
            const sessionDir = getRunWieldSessionDir(cwd);
            await Deno.mkdir(sessionDir, { recursive: true });
            const sessionPath = `${sessionDir}/2026-01-01T00-00-00-000Z_pi-safe.jsonl`;
            const text = JSON.stringify({
                type: "session",
                version: 3,
                id: "pi-safe",
                timestamp: "2026-01-01T00:00:00.000Z",
                cwd,
            }) + "\n" + JSON.stringify({ type: "message", message: { role: "user", content: "secret" } }) + "\n";
            await Deno.writeTextFile(sessionPath, text);
            const before = await Deno.stat(sessionPath);

            const locator = await readCatalogSafeRootSessionLocator({ cwd, sessionPath });
            const listed = await listCatalogSafeRootSessionLocators(cwd);
            const after = await Deno.stat(sessionPath);

            assertEquals(locator.piSessionId, "pi-safe");
            assertEquals(locator.headerCwd, cwd);
            assertEquals(listed.locators.length, 1);
            assertEquals(listed.diagnostics, []);
            assertEquals(await Deno.readTextFile(sessionPath), text);
            assertEquals(before.mtime?.getTime(), after.mtime?.getTime());
        } finally {
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await Deno.remove(home, { recursive: true });
        }
    });
});

Deno.test("catalog-safe root session locator rejects malformed or out-of-directory files", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const home = await Deno.makeTempDir();
        Deno.env.set("HOME", home);
        try {
            const cwd = `${home}/repo`;
            await Deno.mkdir(cwd, { recursive: true });
            const sessionDir = getRunWieldSessionDir(cwd);
            await Deno.mkdir(sessionDir, { recursive: true });
            const malformed = `${sessionDir}/malformed.jsonl`;
            await Deno.writeTextFile(malformed, "not-json\n");
            const listed = await listCatalogSafeRootSessionLocators(cwd);
            assertEquals(listed.locators, []);
            assertEquals(listed.diagnostics.length, 1);

            await assertRejects(
                () => readCatalogSafeRootSessionLocator({ cwd, sessionPath: `${home}/outside.jsonl` }),
                Error,
                "outside the RunWield session directory",
            );

            const outsideTarget = `${home}/outside-target.jsonl`;
            await Deno.writeTextFile(
                outsideTarget,
                JSON.stringify({ type: "session", version: 3, id: "outside-target", cwd }) + "\n",
            );
            const symlinkPath = `${sessionDir}/2026-01-01T00-00-00-000Z_outside-target.jsonl`;
            await Deno.symlink(outsideTarget, symlinkPath);
            await assertRejects(
                () => readCatalogSafeRootSessionLocator({ cwd, sessionPath: symlinkPath }),
                Error,
                "resolves outside the RunWield session directory",
            );
        } finally {
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await Deno.remove(home, { recursive: true });
        }
    });
});
