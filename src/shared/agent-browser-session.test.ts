import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { createAgentBrowserSessionCleanup } from "./agent-browser-session.ts";

Deno.test("agent-browser cleanup uses a unique wld namespace and runs once", () => {
    const env: Record<string, string> = {};
    let cleanupRuns = 0;
    const cleanup = createAgentBrowserSessionCleanup({
        envSet(name, value) {
            env[name] = value;
        },
        spawnCleanup() {
            cleanupRuns += 1;
        },
    });

    cleanup.initialize();
    cleanup.cleanupSync();
    cleanup.cleanupSync();

    assertMatch(env.AGENT_BROWSER_NAMESPACE, /^wld-[0-9a-f-]{36}$/);
    assertEquals(env.AGENT_BROWSER_NAMESPACE, cleanup.namespace);
    assertEquals(cleanupRuns, 1);
});

Deno.test("separate agent-browser cleanups cannot share a namespace", () => {
    const runtime = {
        envSet() {},
        spawnCleanup() {},
    };

    const first = createAgentBrowserSessionCleanup(runtime);
    const second = createAgentBrowserSessionCleanup(runtime);

    assertNotEquals(first.namespace, second.namespace);
});

Deno.test("agent-browser cleanup tolerates an unavailable helper", () => {
    const cleanup = createAgentBrowserSessionCleanup({
        envSet() {},
        spawnCleanup() {
            throw new Error("agent-browser is unavailable");
        },
    });

    cleanup.cleanupSync();
});
