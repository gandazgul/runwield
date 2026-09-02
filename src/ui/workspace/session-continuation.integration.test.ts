// @ts-nocheck: Workspace service is JavaScript and returns projected event records.
import { assertEquals, assertRejects } from "@std/assert";
import { AGENTS } from "../../constants.js";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { makeManagedSessionFixture } from "../../testing/managed-session-fixture.ts";
import { readSessionName, WorkspaceSessionContinuationService } from "./server/session-continuation.js";

async function waitForOperation(service, operationId) {
    for (let index = 0; index < 400; index++) {
        const operation = service.getOperation(operationId);
        if (operation.status !== "running" && operation.status !== "accepted") return operation;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return service.getOperation(operationId);
}

Deno.test("Workspace Session names prefer real metadata before first-message fallback", async () => {
    const namedPath = await Deno.makeTempFile({ prefix: "runwield-named-session-", suffix: ".jsonl" });
    const fallbackPath = await Deno.makeTempFile({ prefix: "runwield-fallback-session-", suffix: ".jsonl" });
    try {
        await Deno.writeTextFile(
            namedPath,
            [
                { type: "session", id: "pi-1", name: "Real Session Name", timestamp: "2026-01-01T00:00:00.000Z" },
                { type: "message", message: { role: "user", content: "first message text" } },
            ].map((entry) => JSON.stringify(entry)).join("\n"),
        );
        await Deno.writeTextFile(
            fallbackPath,
            [
                { type: "session", id: "pi-2", timestamp: "2026-01-01T00:00:00.000Z" },
                {
                    type: "message",
                    message: { role: "user", content: [{ type: "text", text: "fallback first message" }] },
                },
            ].map((entry) => JSON.stringify(entry)).join("\n"),
        );

        assertEquals(await readSessionName(namedPath), "Real Session Name");
        assertEquals(await readSessionName(fallbackPath), "fallback first message");
    } finally {
        await Deno.remove(namedPath).catch(() => undefined);
        await Deno.remove(fallbackPath).catch(() => undefined);
    }
});

Deno.test("Workspace continuation publishes once and a TUI observer resumes from the new cursor", async () => {
    await withRuntimeCommandFixture(
        "workspace-continuation-",
        async ({ homeDir, projectRoot, setModelResponseFactory }) => {
            const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
            const workspaceStore = fixture.openStore();
            const service = new WorkspaceSessionContinuationService({ store: workspaceStore });
            const tuiObserver = fixture.openStore();
            try {
                setModelResponseFactory(fixture.recordedModelResponse("Workspace turn."));
                const initialActivation = workspaceStore.inspectSessionActivation(fixture.session.runwieldSessionId);
                const initialTimeline = await service.timeline(fixture.session.runwieldSessionId, {
                    projectId: fixture.project.projectId,
                    limit: 20,
                });
                assertEquals(
                    workspaceStore.inspectSessionActivation(fixture.session.runwieldSessionId).activation?.state,
                    initialActivation.activation?.state,
                );

                await assertRejects(
                    () =>
                        service.startContinuation({
                            runwieldSessionId: fixture.session.runwieldSessionId,
                            projectId: fixture.project.projectId,
                            expectedGeneration: 99,
                            requestId: "stale-generation",
                            deviceId: "workspace-device",
                            text: "Stale view.",
                        }),
                    Error,
                    "exact committed generation",
                );
                const activeProof = workspaceStore.acquireSessionActivation({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    ownerInstanceId: "workspace-negative-owner",
                    ownerProcessKind: "workspace",
                    operationId: "workspace-negative-active",
                    expectedGeneration: 0,
                    expectedCurrentSegmentId: initialActivation.generation?.currentSegmentId ?? null,
                    phase: "preparing",
                });
                await assertRejects(
                    () =>
                        service.startContinuation({
                            runwieldSessionId: fixture.session.runwieldSessionId,
                            projectId: fixture.project.projectId,
                            expectedGeneration: 0,
                            requestId: "not-idle",
                            deviceId: "workspace-device",
                            text: "Not idle.",
                        }),
                    Error,
                    "still busy",
                );
                workspaceStore.releaseUnchangedActivation(activeProof);

                const pending = workspaceStore.createOrGetOperationReceipt({
                    deviceId: "workspace-device",
                    requestId: "pending-after-process-loss",
                    requestHash: "pending-hash",
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    expectedGeneration: 0,
                    kind: "continuation",
                });
                const recoveryService = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
                try {
                    const recoveredPending = recoveryService.getOperation(pending.operationId);
                    assertEquals(recoveredPending.status, "unknown");
                    assertEquals(recoveredPending.error, "operation_not_running");
                } finally {
                    recoveryService.close();
                    recoveryService.store.close();
                }

                const started = await service.startContinuation({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    expectedGeneration: 0,
                    requestId: "continue-once",
                    deviceId: "workspace-device",
                    text: "Continue from Workspace.",
                });
                const duplicate = await service.startContinuation({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    expectedGeneration: 0,
                    requestId: "continue-once",
                    deviceId: "workspace-device",
                    text: "Continue from Workspace.",
                });
                assertEquals(duplicate.operationId, started.operationId);

                const completed = await waitForOperation(service, started.operationId);
                assertEquals(completed.status, "completed");
                assertEquals(fixture.modelRequests.length, 1);

                const observedGeneration =
                    tuiObserver.inspectSessionActivation(fixture.session.runwieldSessionId).generation;
                const resumed = await service.timeline(fixture.session.runwieldSessionId, {
                    projectId: fixture.project.projectId,
                    cursorEventId: initialTimeline.nextCursor,
                    limit: 20,
                });
                const restartedService = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
                try {
                    const recovered = restartedService.getOperation(started.operationId);
                    assertEquals(recovered.status, "completed");
                } finally {
                    restartedService.close();
                    restartedService.store.close();
                }

                assertEquals(observedGeneration?.generation, 1);
                assertEquals(resumed.generation, 1);
                assertEquals(resumed.events.some((event) => JSON.stringify(event).includes("Workspace turn.")), true);
            } finally {
                service.close();
                workspaceStore.close();
                tuiObserver.close();
                await fixture.cleanup();
            }
        },
    );
});

Deno.test("Workspace configuration stages Agent changes during a local active operation", async () => {
    await withRuntimeCommandFixture(
        "workspace-active-config-",
        async ({ homeDir, projectRoot, setModelResponseFactory }) => {
            const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
            const workspaceStore = fixture.openStore();
            const service = new WorkspaceSessionContinuationService({ store: workspaceStore });
            let releaseTurn = () => {};
            const turnReleased = new Promise((resolve) => {
                releaseTurn = resolve;
            });
            try {
                setModelResponseFactory(async (context) => {
                    fixture.recordFixtureModelRequest({ messages: JSON.stringify(context.messages) });
                    await turnReleased;
                    return fixture.recordedModelResponse("Workspace turn after staged config.")(context);
                });
                const started = await service.startContinuation({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    expectedGeneration: 0,
                    requestId: "stage-agent-during-turn",
                    deviceId: "workspace-device",
                    text: "Continue while settings change.",
                });
                const staged = await service.configureSession({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    expectedGeneration: 0,
                    agentName: AGENTS.ROUTER,
                });
                assertEquals(staged.status, "staged");
                assertEquals(staged.pendingConfiguration?.agentName, AGENTS.ROUTER);
                assertEquals(service.getOperation(started.operationId).pendingConfiguration?.agentName, AGENTS.ROUTER);

                const thinkingChanged = await service.configureSession({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    expectedGeneration: 0,
                    thinkingLevel: "low",
                });
                assertEquals(thinkingChanged.status, "staged");
                assertEquals(thinkingChanged.pendingConfiguration?.agentName, AGENTS.ROUTER);

                releaseTurn();
                const completed = await waitForOperation(service, started.operationId);
                assertEquals(completed.status, "completed");
                assertEquals(completed.pendingConfiguration, null);
                const timeline = await service.timeline(fixture.session.runwieldSessionId, {
                    projectId: fixture.project.projectId,
                    limit: 20,
                });
                assertEquals(timeline.snapshot.activeAgent, AGENTS.ROUTER);
                assertEquals(timeline.snapshot.thinkingLevel, "low");
                assertEquals(timeline.generation > 1, true);
            } finally {
                releaseTurn();
                service.close();
                workspaceStore.close();
                await fixture.cleanup();
            }
        },
    );
});
