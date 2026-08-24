// @ts-nocheck: Workspace service is JavaScript and returns projected event records.
import { assertEquals, assertRejects } from "@std/assert";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { makeManagedSessionFixture } from "../../testing/managed-session-fixture.ts";
import { WorkspaceSessionContinuationService } from "./server/session-continuation.js";

async function waitForOperation(service, operationId) {
    for (let index = 0; index < 80; index++) {
        const operation = service.getOperation(operationId);
        if (operation.status !== "running" && operation.status !== "accepted") return operation;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return service.getOperation(operationId);
}

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
