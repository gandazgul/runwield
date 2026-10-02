import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { HostedSession } from "./hosted-session.js";
import { openLiveSessionConnection, readLiveSessionConnection, type LiveSessionRuntime } from "./live-session-connection.ts";
import type { SteerSessionResult } from "./runtime/types.ts";
import type { RegisterSessionArtifactOptions, SessionArtifactReference } from "./file-session-store-types.ts";

function fakeManagedOperationCapability() {
    return {
        runtimeSessionId: "runtime-session",
        runwieldSessionId: "umbrella-session",
        operationId: "operation-1",
        proof: {
            runwieldSessionId: "umbrella-session",
            projectId: "project-1",
            ownerInstanceId: "owner-1",
            ownerProcessKind: "test" as const,
            operationId: "operation-1",
            fence: 1,
            phase: "turning" as const,
            expectedGeneration: 0,
        },
        settled: false,
        assertLive() {},
        updateProof() {},
        settle() {},
        registerArtifact(options: RegisterSessionArtifactOptions): SessionArtifactReference {
            return {
                artifactId: "artifact-1",
                kind: options.kind,
                path: options.path,
                title: options.title,
                registeredAt: "2026-01-01T00:00:00.000Z",
                registeredBy: options.registeredBy,
                sourceSegmentId: "segment-1",
            };
        },
    };
}

async function fixture(steerSession: LiveSessionRuntime["steerSession"]) {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-live-session-" });
    const session = new HostedSession({ id: "runtime-session", cwd });
    session.setManagedMetadata({
        runwieldSessionId: "umbrella-session",
        projectId: "project-1",
        piSessionId: "pi-session",
        transcriptPath: `${cwd}/session.jsonl`,
        generation: 0,
        name: "Live Session",
        activeAgent: "ideator",
        workflowContext: null,
    });
    session.setManagedOperationCapability(fakeManagedOperationCapability());
    const runtime: LiveSessionRuntime = {
        getSessionSnapshot: () => null,
        getQueuedMessages: () => [],
        steerSession,
        cancelSession: () => ({ ok: true, aborted: false }),
        subscribeSessionEvents: () => () => {},
    };
    const operationId = "operation-1";
    const close = await openLiveSessionConnection(runtime, session, operationId, []);
    return {
        operationId,
        close,
        cleanup: async () => {
            await close();
            await Deno.remove(cwd, { recursive: true });
        },
    };
}

Deno.test("a connection retry with the same requestId does not steer twice", async () => {
    let calls = 0;
    const steerSession: LiveSessionRuntime["steerSession"] = () => {
        calls++;
        const result: SteerSessionResult = { ok: true, queued: true };
        return Promise.resolve(result);
    };
    const f = await fixture(steerSession);
    try {
        const command = { action: "steer" as const, requestId: "retry-1", text: "change direction" };
        const first = await readLiveSessionConnection("umbrella-session", f.operationId, command);
        const second = await readLiveSessionConnection("umbrella-session", f.operationId, command);
        assertEquals(calls, 1);
        assertEquals(first, second);
    } finally {
        await f.cleanup();
    }
});

// The removed five-minute timer deleted a receipt out from under a still-live operation. A
// connection retry arriving after that window must still dedupe against the original request
// instead of invoking runtime.steerSession() again. This drives fake time past the old window to
// prove the receipt no longer expires, independent of a real five-minute wait.
Deno.test("a retry after five elapsed minutes still does not steer twice", async () => {
    let calls = 0;
    const steerSession: LiveSessionRuntime["steerSession"] = () => {
        calls++;
        const result: SteerSessionResult = { ok: true, queued: true };
        return Promise.resolve(result);
    };
    const f = await fixture(steerSession);
    const time = new FakeTime();
    try {
        const command = { action: "steer" as const, requestId: "retry-1", text: "change direction" };
        const first = await readLiveSessionConnection("umbrella-session", f.operationId, command);
        time.tick(5 * 60 * 1000 + 1);
        const second = await readLiveSessionConnection("umbrella-session", f.operationId, command);
        assertEquals(calls, 1);
        assertEquals(first, second);
    } finally {
        time.restore();
        await f.cleanup();
    }
});
