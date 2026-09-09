// @ts-nocheck: Workspace service is JavaScript and returns projected event records.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { AGENTS } from "../../constants.js";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { setCustomSetting } from "../../shared/settings.js";
import { manifestPath } from "../../shared/session/file-session-storage.ts";
import {
    appendTranscriptEntry,
    makeManagedSessionFixture,
    readTranscriptEvidence,
} from "../../testing/managed-session-fixture.ts";
import {
    disposeOperationBrowserNotifications,
    observeOperationBrowserNotifications,
    syncOperationBrowserNotificationLifecycle,
} from "./islands/SessionSurface.jsx";
import { readSessionName, WorkspaceSessionContinuationService } from "./server/session-continuation.js";

class BrowserNotification {
    static permission = "granted";
    static created = [];
    closed = false;
    onclick = null;

    constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        BrowserNotification.created.push(this);
    }

    close() {
        this.closed = true;
    }
}

function installBrowserNotifications() {
    BrowserNotification.created = [];
    Reflect.set(globalThis, "Notification", BrowserNotification);
    Reflect.set(globalThis, "document", { visibilityState: "hidden", hasFocus: () => false });
    Reflect.set(globalThis, "focus", () => {});
    return {
        created: BrowserNotification.created,
        cleanup() {
            disposeOperationBrowserNotifications();
            Reflect.deleteProperty(globalThis, "Notification");
            Reflect.deleteProperty(globalThis, "document");
            Reflect.deleteProperty(globalThis, "focus");
        },
    };
}

async function waitForOperation(service, operationId) {
    for (let index = 0; index < 400; index++) {
        const operation = service.getOperation(operationId);
        if (operation.status !== "running" && operation.status !== "accepted") return operation;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return service.getOperation(operationId);
}

Deno.test("Workspace Session names use saved renames and never substitute the first message", async () => {
    const namedPath = await Deno.makeTempFile({ prefix: "runwield-named-session-", suffix: ".jsonl" });
    const fallbackPath = await Deno.makeTempFile({ prefix: "runwield-fallback-session-", suffix: ".jsonl" });
    try {
        await Deno.writeTextFile(
            namedPath,
            [
                { type: "session", id: "pi-1", name: "Real Session Name", timestamp: "2026-01-01T00:00:00.000Z" },
                { type: "message", message: { role: "user", content: "first message text" } },
                { type: "session_info", name: "Renamed Session" },
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

        assertEquals(await readSessionName(namedPath), "Renamed Session");
        await Deno.writeTextFile(namedPath, '\n{"type":"session_info","name":"Renamed again"}\n{"type":', {
            append: true,
        });
        assertEquals(await readSessionName(namedPath), "Renamed again");
        assertEquals(await readSessionName(fallbackPath), "Untitled Session");
    } finally {
        await Deno.remove(namedPath).catch(() => undefined);
        await Deno.remove(fallbackPath).catch(() => undefined);
    }
});

Deno.test("Workspace Session list prefers transcript name before stale catalog fallback", async () => {
    const fixture = await makeManagedSessionFixture();
    const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
    try {
        const path = manifestPath(fixture.sessionDir, fixture.session.runwieldSessionId);
        const manifest = JSON.parse(await Deno.readTextFile(path));
        manifest.displayName = "Hello";
        await Deno.writeTextFile(path, `${JSON.stringify(manifest, null, 2)}\n`);

        const result = await service.listSessions(fixture.project.projectId);
        assertEquals(result.sessions[0].displayName, "Managed fixture");
    } finally {
        service.close();
        service.store.close();
        await fixture.cleanup();
    }
});

Deno.test("Workspace hides only unnamed empty Sessions and paginates the visible list", async () => {
    const fixture = await makeManagedSessionFixture();
    const store = fixture.openStore();
    const service = new WorkspaceSessionContinuationService({ store });
    try {
        for (const [index, name, content] of [[1, "", ""], [2, "Named empty", ""], [3, "", "Hello"]]) {
            const transcriptPath = `${fixture.sessionDir}/2026-01-0${index + 1}T00-00-00-000Z_list-${index}.jsonl`;
            const entries = [{
                type: "session",
                id: `list-${index}`,
                cwd: fixture.projectRoot,
                timestamp: `2026-01-0${index + 1}T00:00:00.000Z`,
            }];
            if (name) entries.push({ type: "session_info", name });
            if (content) entries.push({ type: "message", message: { role: "user", content } });
            await Deno.writeTextFile(transcriptPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
            await store.ensureSessionCatalogRecord({
                projectId: fixture.project.projectId,
                piSessionId: `list-${index}`,
                transcriptPath,
                transcriptCwd: fixture.projectRoot,
                source: "catalog",
            });
        }
        const first = await service.listSessions(fixture.project.projectId, { pageSize: 1 });
        const second = await service.listSessions(fixture.project.projectId, { pageSize: 1, page: 1 });
        const third = await service.listSessions(fixture.project.projectId, { pageSize: 1, page: 2 });
        assertEquals(first.total, 3);
        assertEquals(first.sessions[0].displayName, "Untitled Session");
        assertEquals(second.sessions[0].displayName, "Named empty");
        assertEquals(third.sessions[0].displayName, "Managed fixture");
        assertEquals(third.hasNext, false);
        assertEquals((await service.listSessions(fixture.project.projectId, { includeEmpty: true })).total, 4);
    } finally {
        service.close();
        store.close();
        await fixture.cleanup();
    }
});

Deno.test("Workspace snapshots deliver Agent-stop browser notifications once through the Session observer", async () => {
    const fixture = await makeManagedSessionFixture();
    const browser = installBrowserNotifications();
    await setCustomSetting(
        "notifications",
        {
            enabled: true,
            events: { agentStopped: true, userInterview: false },
            suppressWhenFocused: false,
            terminalBell: false,
        },
        "project",
        fixture.projectRoot,
    );
    const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
    try {
        service.setOperation("operation-full", { status: "running", projectId: fixture.project.projectId, events: [] });
        for (let index = 0; index < 1100; index += 1) {
            service.appendOperationEvent("operation-full", { type: "system_status", message: `event ${index}` });
        }
        service.appendOperationEvent("operation-full", { type: "system_status", message: "latest progress" });
        service.appendOperationEvent("operation-full", {
            type: "attention_requested",
            reason: "agentStopped",
            agentName: "Guide",
            sessionName: "Managed fixture",
        });

        const getSnapshot = service.getOperation("operation-full");
        assertEquals(getSnapshot.browserNotificationPolicy, {
            enabled: true,
            events: { agentStopped: true },
            suppressWhenFocused: false,
        });
        assertEquals(getSnapshot.events.length, 1000);
        assertEquals(getSnapshot.events.at(-1), {
            type: "attention_requested",
            reason: "agentStopped",
            agentName: "Guide",
            sessionName: "Managed fixture",
        });

        let streamed = null;
        const unsubscribe = service.subscribeOperation("operation-full", (snapshot) => streamed = snapshot);
        unsubscribe();
        assertEquals(streamed.events.length, 1000);
        assertEquals(streamed.events.at(-1), getSnapshot.events.at(-1));

        const cursorRef = { current: null };
        const operationKeyRef = { current: null };
        const scopeKey = fixture.project.projectId;
        const current = { operationId: "operation-full", attempts: 0, scopeKey };
        syncOperationBrowserNotificationLifecycle({
            operationId: current.operationId,
            scopeKey,
            operationKeyRef,
            cursorRef,
        });
        observeOperationBrowserNotifications(current, streamed, cursorRef);
        observeOperationBrowserNotifications(current, streamed, cursorRef);
        observeOperationBrowserNotifications({ ...current, attempts: 1 }, getSnapshot, cursorRef);
        assertEquals(browser.created.length, 1);
        assertEquals(browser.created[0].title, "Guide: Agent stopped — Managed fixture");

        observeOperationBrowserNotifications(
            { ...current, operationId: "operation-restored", restored: true },
            getSnapshot,
            { current: null },
        );
        assertEquals(browser.created.length, 1);

        for (let index = 0; index < 1100; index++) {
            service.appendOperationEvent("operation-full", { type: "system_status", message: `later ${index}` });
        }
        service.appendOperationEvent("operation-full", {
            type: "attention_requested",
            reason: "agentStopped",
            agentName: "Guide",
            sessionName: "Done",
        });
        const terminalSnapshot = service.getOperation("operation-full");
        observeOperationBrowserNotifications(current, terminalSnapshot, cursorRef);
        syncOperationBrowserNotificationLifecycle({ operationId: null, scopeKey, operationKeyRef, cursorRef });
        assertEquals(browser.created.length, 2);
        assertEquals(browser.created[1].closed, false);

        syncOperationBrowserNotificationLifecycle({
            operationId: "operation-next",
            scopeKey,
            operationKeyRef,
            cursorRef,
        });
        assertEquals(browser.created[1].closed, true);
    } finally {
        browser.cleanup();
        service.close();
        service.store.close();
        await fixture.cleanup();
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
                assertEquals(initialTimeline.snapshot.sessionStats, {
                    userMessages: 1,
                    assistantMessages: 1,
                    toolCalls: 0,
                    compactionCount: 0,
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
                assertEquals(completed.status, "completed", JSON.stringify(completed));
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

Deno.test("Workspace Session options and timeline expose supported Agy model facts", async () => {
    await withRuntimeCommandFixture("workspace-agy-options-", async ({ homeDir, projectRoot }) => {
        const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
        const workspaceStore = fixture.openStore();
        const service = new WorkspaceSessionContinuationService({ store: workspaceStore });
        try {
            const options = await service.listSessionOptions(fixture.project.projectId);
            assertEquals(
                options.models
                    .filter((model) => model.provider === "agy-cli")
                    .map((model) => ({ id: model.id, backend: model.executionBackend })),
                [
                    { id: "gemini-3.8-flash", backend: "agy-cli" },
                    { id: "gemini-3.1-pro", backend: "agy-cli" },
                ],
            );
            assertEquals(options.thinkingLevels, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

            const activation = workspaceStore.inspectSessionActivation(fixture.session.runwieldSessionId);
            const proof = workspaceStore.acquireSessionActivation({
                runwieldSessionId: fixture.session.runwieldSessionId,
                projectId: fixture.project.projectId,
                ownerInstanceId: "workspace-agy-facts",
                ownerProcessKind: "workspace",
                expectedGeneration: 0,
                expectedCurrentSegmentId: activation.generation?.currentSegmentId ?? null,
                phase: "checkpointing",
            });
            await Deno.writeTextFile(
                fixture.transcriptPath,
                [
                    { type: "model_change", id: "agy-model", provider: "agy-cli", modelId: "gemini-3.8-flash" },
                    { type: "thinking_level_change", id: "agy-thinking", thinkingLevel: "high" },
                    {
                        type: "custom",
                        id: "agy-backend",
                        customType: "runwield.execution_backend",
                        data: {
                            version: 1,
                            backend: "agy-cli",
                            provider: "agy-cli",
                            model: "gemini-3.8-flash",
                            thinkingLevel: "high",
                            effort: "high",
                            backendModel: "gemini-3.8-flash-high",
                        },
                    },
                ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
                { append: true },
            );
            workspaceStore.publishGenerationAndRelease(proof, {
                generation: 1,
                currentSegmentId: activation.generation?.currentSegmentId ?? null,
                ...await readTranscriptEvidence(fixture.transcriptPath),
            });

            const timeline = await service.timeline(fixture.session.runwieldSessionId, {
                projectId: fixture.project.projectId,
                limit: 20,
            });
            assertEquals(timeline.snapshot.provider, "agy-cli");
            assertEquals(timeline.snapshot.model, "gemini-3.8-flash");
            assertEquals(timeline.snapshot.thinkingLevel, "high");
            assertEquals(timeline.snapshot.executionBackend, {
                backend: "agy-cli",
                provider: "agy-cli",
                model: "gemini-3.8-flash",
                thinkingLevel: "high",
                effort: "high",
                backendModel: "gemini-3.8-flash-high",
            });
            assertEquals(JSON.stringify(timeline.events).includes("_meta"), false);
        } finally {
            service.close();
            workspaceStore.close();
            await fixture.cleanup();
        }
    });
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
                assertEquals(completed.status, "completed", JSON.stringify(completed));
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

Deno.test("Workspace answers a live question in a separate TUI process", async () => {
    await withRuntimeCommandFixture("workspace-live-tui-", async ({ homeDir, projectRoot }) => {
        const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
        const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
        const storeUrl = new URL("../../shared/owner-coordination/index.js", import.meta.url).href;
        const runtimeUrl = new URL("../../shared/session/session-runtime.js", import.meta.url).href;
        const code = `
            import { openOwnerCoordinationStore } from ${JSON.stringify(storeUrl)};
            import { createSessionRuntime } from ${JSON.stringify(runtimeUrl)};
            const store = openOwnerCoordinationStore({ dbPath: ${JSON.stringify(fixture.dbPath)} });
            const runtime = createSessionRuntime({ sessionStore: store, ownerProcessKind: "tui" });
            const session = store.getSessionById(${JSON.stringify(fixture.session.runwieldSessionId)});
            const adopted = runtime.adoptManagedSession({ session, generation: 0 });
            let dismissed = false;
            runtime.setInteractionAdapter(adopted.sessionId, {
                supportsInteraction: () => true,
                requestInteraction: (_request, signal) => new Promise(resolve => {
                    signal.addEventListener("abort", () => { dismissed = true; resolve({ outcome: "canceled" }); }, { once: true });
                }),
            });
            try {
                const answer = await runtime.requestInteraction(adopted.sessionId, { type: "text", prompt: "What should we build?" });
                console.log(JSON.stringify({ answer, dismissed }));
            } finally {
                await runtime.closeAllSessionsWhenIdle();
                store.close();
            }
        `;
        const child = new Deno.Command(Deno.execPath(), {
            args: ["eval", "--config", new URL("../../../deno.json", import.meta.url).pathname, code],
            cwd: projectRoot,
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        const outputPromise = child.output();
        let finished = false;
        try {
            let live;
            for (let index = 0; index < 400; index++) {
                live = await service.liveSession(fixture.project.projectId, fixture.session.runwieldSessionId);
                if (live.operation?.liveInteraction) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            assert(live?.operation?.liveInteraction, "The TUI question should appear in Workspace.");
            const operation = live.operation;
            assertEquals(operation.remote, true);
            const answer = {
                projectId: fixture.project.projectId,
                runwieldSessionId: fixture.session.runwieldSessionId,
                operationId: operation.operationId,
                interactionId: operation.liveInteraction.interactionId,
                requestId: "phone-answer",
                response: { outcome: "text", value: "A simple session screen." },
            };
            assertEquals((await service.answerInteraction(answer)).status, "accepted");
            // A lost HTTP response can retry without answering twice.
            assertEquals((await service.answerInteraction(answer)).status, "accepted");
            const output = await outputPromise;
            finished = true;
            assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
            assertEquals(JSON.parse(new TextDecoder().decode(output.stdout).trim()), {
                answer: { outcome: "text", value: "A simple session screen." },
                dismissed: true,
            });
            assertEquals((await service.refreshOperation(operation.operationId)).status, "completed");
            assertEquals(
                (await service.liveSession(fixture.project.projectId, fixture.session.runwieldSessionId)).operation,
                null,
            );
            await assertRejects(
                () => service.answerInteraction({ ...answer, requestId: "late-answer" }),
                Error,
                "not available",
            );
        } finally {
            if (!finished) {
                try {
                    child.kill();
                } catch { /* already stopped */ }
                await outputPromise;
            }
            await service.runtime.closeAllSessionsWhenIdle();
            service.close();
            service.store.close();
            await fixture.cleanup();
        }
    });
});

Deno.test("long Workspace history stays sendable and an open TUI continues the new conversation", async () => {
    await withRuntimeCommandFixture(
        "workspace-long-history-",
        async ({ homeDir, projectRoot, setModelResponseFactory }) => {
            const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
            const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
            let tui;
            try {
                let proof = fixture.store.acquireSessionActivation({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    ownerInstanceId: "history-fixture",
                    ownerProcessKind: "test",
                    expectedGeneration: 0,
                    phase: "bootstrap",
                });
                const entries = Array.from({ length: 1700 }, (_, index) => ({
                    type: "message",
                    id: `long-${index}`,
                    parentId: index ? `long-${index - 1}` : "entry-assistant",
                    timestamp: new Date(1700000000000 + index).toISOString(),
                    message: {
                        role: index % 2 ? "assistant" : "user",
                        content: [{ type: "text", text: `History message ${index}` }],
                    },
                }));
                await Deno.writeTextFile(
                    fixture.transcriptPath,
                    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
                    { append: true },
                );
                proof = fixture.store.changeSessionActivationPhase(proof, "checkpointing");
                fixture.store.publishGenerationAndRelease(proof, {
                    generation: 1,
                    currentSegmentId:
                        fixture.store.getCurrentSessionSegment(fixture.session.runwieldSessionId).segmentId,
                    ...await readTranscriptEvidence(fixture.transcriptPath),
                });
                tui = fixture.openRuntime("tui", "idle-tui");
                const latest = await service.timeline(fixture.session.runwieldSessionId, {
                    projectId: fixture.project.projectId,
                    latest: true,
                    limit: 200,
                });
                assertEquals(latest.events.length, 200);
                assert(latest.previousCursor);
                assertEquals(latest.complete, false);
                assert(JSON.stringify(latest.events).includes("History message 1699"));
                const earlier = await service.timeline(fixture.session.runwieldSessionId, {
                    projectId: fixture.project.projectId,
                    beforeEventId: latest.previousCursor,
                    limit: 200,
                });
                assertEquals(earlier.events.length, 200);
                assertEquals(
                    earlier.events.some((event) => latest.events.some((next) => event.eventId === next.eventId)),
                    false,
                );
                setModelResponseFactory(fixture.recordedModelResponse("I replied from Workspace."));
                const started = await service.startContinuation({
                    projectId: fixture.project.projectId,
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    expectedGeneration: 1,
                    requestId: "long-history-message",
                    text: "Continue from my phone.",
                });
                assertEquals((await waitForOperation(service, started.operationId)).status, "completed");
                setModelResponseFactory(fixture.recordedModelResponse("Back at the terminal."));
                const result = await tui.runtime.promptUserTurn(tui.adoptedSessionId, {
                    initialRequest: "Continue here.",
                });
                assertEquals(result.ok, true);
                assertEquals(fixture.modelRequests.length, 2);
                assert(fixture.modelRequests[1].messages.includes("I replied from Workspace."));
                assert(fixture.modelRequests[1].messages.includes("Continue from my phone."));
                assertEquals(
                    fixture.store.inspectSessionActivation(fixture.session.runwieldSessionId).generation.generation,
                    3,
                );
            } finally {
                await tui?.close();
                await service.runtime.closeAllSessionsWhenIdle();
                service.close();
                service.store.close();
                await fixture.cleanup();
            }
        },
    );
});

Deno.test("Workspace steering reaches the running Agent once and appears in the conversation", async () => {
    await withRuntimeCommandFixture(
        "workspace-steering-",
        async ({ homeDir, projectRoot, setModelResponseFactories }) => {
            const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
            const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
            let release = () => {};
            const held = new Promise((resolve) => {
                release = resolve;
            });
            let modelStarted = false;
            try {
                setModelResponseFactories([async (context) => {
                    if (!modelStarted) {
                        modelStarted = true;
                        await held;
                    }
                    return fixture.recordedModelResponse("Starting your work.")(context);
                }, fixture.recordedModelResponse("Responding to your direction.")]);
                const started = await service.startContinuation({
                    projectId: fixture.project.projectId,
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    requestId: "start-steer-turn",
                    expectedGeneration: 0,
                    text: "Start working.",
                });
                for (let index = 0; index < 400 && !modelStarted; index++) {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
                assert(modelStarted, JSON.stringify(service.getOperation(started.operationId)));
                const request = {
                    projectId: fixture.project.projectId,
                    operationId: started.operationId,
                    requestId: "steer-once",
                    text: "Use the existing implementation.",
                    images: [],
                };
                const results = await Promise.all([service.steerOperation(request), service.steerOperation(request)]);
                assertEquals(results.map((result) => result.queued), [true, true]);
                const live = await service.liveSession(fixture.project.projectId, fixture.session.runwieldSessionId);
                assertEquals(live.operation.queuedMessages.filter((message) => message.delivery === "steer").length, 1);
                release();
                assertEquals((await waitForOperation(service, started.operationId)).status, "completed");
                assertEquals(fixture.modelRequests.length, 2);
                assert(fixture.modelRequests[1].messages.includes("Use the existing implementation."));
                const timeline = await service.timeline(fixture.session.runwieldSessionId, {
                    projectId: fixture.project.projectId,
                });
                assertEquals(
                    timeline.events.filter((event) => event.type === "user_message" && event.text === request.text)
                        .length,
                    1,
                );
            } finally {
                release();
                await service.runtime.closeAllSessionsWhenIdle();
                service.close();
                service.store.close();
                await fixture.cleanup();
            }
        },
    );
});

Deno.test("a new Workspace Session is discoverable before its first response finishes", async () => {
    await withRuntimeCommandFixture(
        "workspace-first-message-",
        async ({ homeDir, projectRoot, setModelResponseFactory }) => {
            const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
            const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
            let release = () => {};
            const held = new Promise((resolve) => {
                release = resolve;
            });
            try {
                setModelResponseFactory(async (context) => {
                    await held;
                    return fixture.recordedModelResponse("Your new Session is ready.")(context);
                });
                const started = await service.createSession({
                    projectId: fixture.project.projectId,
                    requestId: "first-message",
                    text: "Start here.",
                    agentName: AGENTS.IDEATOR,
                });
                let operation;
                for (let index = 0; index < 400; index++) {
                    operation = service.getOperation(started.operationId);
                    if (operation.runwieldSessionId || operation.status !== "running") break;
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
                assert(operation.runwieldSessionId, JSON.stringify(operation));
                assertEquals(operation.status, "running");
                assertEquals(
                    (await service.liveSession(fixture.project.projectId, operation.runwieldSessionId)).operation
                        .operationId,
                    started.operationId,
                );
                release();
                assertEquals((await waitForOperation(service, started.operationId)).status, "completed");
                const timeline = await service.timeline(operation.runwieldSessionId, {
                    projectId: fixture.project.projectId,
                });
                assert(timeline.events.some((event) => event.type === "user_message" && event.text === "Start here."));
            } finally {
                release();
                await service.runtime.closeAllSessionsWhenIdle();
                service.close();
                service.store.close();
                await fixture.cleanup();
            }
        },
    );
});

Deno.test("Workspace opens an interrupted Session directly from its saved conversation", async () => {
    await withRuntimeCommandFixture("workspace-restart-", async ({ homeDir, projectRoot, setModelResponseFactory }) => {
        const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
        const writer = fixture.openStore();
        let writerClosed = false;
        const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
        try {
            writer.acquireSessionActivation({
                runwieldSessionId: fixture.session.runwieldSessionId,
                projectId: fixture.project.projectId,
                expectedGeneration: 0,
                ownerInstanceId: "stopped-container",
                ownerProcessKind: "tui",
                operationId: "interrupted-turn",
                phase: "preparing",
            });
            await appendTranscriptEntry(
                fixture.transcriptPath,
                "last-saved-message",
                "Saved before the process stopped.",
            );
            writer.close();
            writerClosed = true;
            const timeline = await service.timeline(fixture.session.runwieldSessionId, {
                projectId: fixture.project.projectId,
                latest: true,
            });
            assertEquals(timeline.state, "idle");
            assertEquals(timeline.generation, 1);
            assert(
                timeline.events.some((event) => JSON.stringify(event).includes("Saved before the process stopped.")),
            );
            setModelResponseFactory(fixture.recordedModelResponse("Continuing after restart."));
            const started = await service.startContinuation({
                projectId: fixture.project.projectId,
                runwieldSessionId: fixture.session.runwieldSessionId,
                expectedGeneration: timeline.generation,
                requestId: "continue-after-restart",
                text: "Continue from here.",
            });
            const completed = await waitForOperation(service, started.operationId);
            assertEquals(completed.status, "completed", JSON.stringify(completed));
            assert(fixture.modelRequests[0].messages.includes("Saved before the process stopped."));
        } finally {
            if (!writerClosed) writer.close();
            await service.runtime.closeAllSessionsWhenIdle();
            service.close();
            service.store.close();
            await fixture.cleanup();
        }
    });
});
