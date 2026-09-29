import { withSessionViewFixture } from "./testing/session-view-fixture.ts";
import { assert, assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { createSessionRuntime, type SessionRuntime } from "../../shared/session/session-runtime.ts";
import { createSessionSnapshotWindow } from "./session-snapshot-window.ts";

async function withSessions(run: (runtime: SessionRuntime, first: string, second: string) => void) {
    await withRuntimeCommandFixture("snapshot-window-", async ({ projectRoot }) => {
        const runtime = createSessionRuntime();
        try {
            const first = await runtime.createInteractiveSession({
                cwd: projectRoot,
                deferManagedActivationUntilAgentReady: true,
            });
            const second = await runtime.createInteractiveSession({
                cwd: projectRoot,
                deferManagedActivationUntilAgentReady: true,
            });
            run(runtime, first.sessionId, second.sessionId);
        } finally {
            await runtime.closeAllSessions();
        }
    });
}

Deno.test("snapshot window reuses one snapshot inside the TTL", async () => {
    await withSessions((runtime, first) => {
        const window = createSessionSnapshotWindow(runtime, () => first, 60_000);
        const snapshot = window.read();
        assert(snapshot);
        assertStrictEquals(window.read(), snapshot);
    });
});

Deno.test("snapshot window refreshes after invalidate", async () => {
    await withSessions((runtime, first) => {
        const window = createSessionSnapshotWindow(runtime, () => first, 60_000);
        const snapshot = window.read();
        window.invalidate();
        assertNotStrictEquals(window.read(), snapshot);
        assertEquals(window.read()?.id, first);
    });
});

Deno.test("snapshot window tracks session switches through the id reader", async () => {
    await withSessions((runtime, first, second) => {
        let id = first;
        const window = createSessionSnapshotWindow(runtime, () => id, 60_000);
        assertEquals(window.read()?.id, first);
        id = second;
        assertEquals(window.read()?.id, second);
    });
});

Deno.test("replacement Session events invalidate a warmed snapshot", async () => {
    await withSessions((runtime, first, second) => {
        let id = first;
        const window = createSessionSnapshotWindow(runtime, () => id, 60_000);
        window.read();
        id = second;
        window.invalidate();
        const warmed = window.read();
        assertEquals(runtime.markPromptReadyAgent(second, { agentName: "guide" }).ok, true);
        assertNotStrictEquals(window.read(), warmed);
        assertEquals(window.read()?.activeAgentInfo?.agentName, "guide");
    });
});

Deno.test("snapshot window expires exactly at the TTL boundary", async () => {
    await withSessions((runtime, first) => {
        const realNow = Date.now;
        let now = realNow();
        Date.now = () => now;
        const window = createSessionSnapshotWindow(runtime, () => first, 500);
        try {
            const snapshot = window.read();
            now += 499;
            assertStrictEquals(window.read(), snapshot);
            now++;
            assertNotStrictEquals(window.read(), snapshot);
        } finally {
            window.dispose();
            Date.now = realNow;
        }
    });
});

Deno.test("snapshot window removes the old Session subscription on rebind", async () => {
    await withSessions((runtime, first, second) => {
        let id = first;
        const window = createSessionSnapshotWindow(runtime, () => id, 60_000);
        try {
            window.read();
            id = second;
            window.rebind();
            const warmed = window.read();
            assertEquals(runtime.markPromptReadyAgent(first, { agentName: "guide" }).ok, true);
            assertStrictEquals(window.read(), warmed);
        } finally {
            window.dispose();
        }
    });
});

Deno.test("snapshot window disposal removes its subscription and does not reattach on read", async () => {
    await withSessions((runtime, first, second) => {
        let id = first;
        const window = createSessionSnapshotWindow(runtime, () => id, 60_000);
        const warmed = window.read();
        window.dispose();
        assertEquals(runtime.markPromptReadyAgent(first, { agentName: "guide" }).ok, true);
        assertStrictEquals(window.read(), warmed);
        id = second;
        window.rebind();
        assertStrictEquals(window.read(), warmed);
        assertEquals(runtime.markPromptReadyAgent(second, { agentName: "guide" }).ok, true);
        assertStrictEquals(window.read(), warmed);
        window.dispose();
    });
});

Deno.test("snapshot window caches null until invalidation", async () => {
    await withSessionViewFixture(({ runtime, host, projectRoot }) => {
        const id = crypto.randomUUID();
        const window = createSessionSnapshotWindow(runtime, () => id, 60_000);
        try {
            assertEquals(window.read(), null);
            host.createSession({ id, cwd: projectRoot });
            assertEquals(window.read(), null);
            window.invalidate();
            assertEquals(window.read()?.id, id);
        } finally {
            window.dispose();
        }
    });
});
