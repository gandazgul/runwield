import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { getSettingsManager } from "../../shared/settings.js";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { NO_OPEN_BROWSER_PORT } from "../../shared/browser-port.ts";
import { resolveTemplateModel } from "../../shared/models/model-validation.ts";
import { createInteractiveTuiComposition } from "./interactive-tui-composition.ts";
import { VirtualTerminal } from "./testing/virtual-terminal.js";
import {
    getActiveModel,
    persistThinkingLevel,
    recordUserInputHistory,
    runScopedSubmitHandoffLoop,
    type SessionRuntime,
    setActiveModel,
    shouldReplaySessionHistory,
} from "./chat-session.ts";

Deno.test("recordUserInputHistory stores trimmed submitted input", () => {
    const history: string[] = [];
    recordUserInputHistory({ addToHistory: (text) => history.push(text) }, "  /skill:review branch  ");
    recordUserInputHistory({ addToHistory: (text) => history.push(text) }, "   ");
    assertEquals(history, ["/skill:review branch"]);
});

Deno.test("startup replays history only when continuing a persisted session", () => {
    assertEquals(shouldReplaySessionHistory("new"), false);
    assertEquals(shouldReplaySessionHistory(undefined), false);
    assertEquals(shouldReplaySessionHistory("continue"), true);
});

Deno.test("resolveTemplateModel validates provider/id lookup and auth", () => {
    const registry = {
        find: (provider: string, id: string) => provider === "test" && id === "model" ? { provider, id } : null,
        hasConfiguredAuth: (model: { provider: string; id: string } | null) => Boolean(model),
    };
    assertEquals(resolveTemplateModel("not-strict", registry), { ok: false });
    assertEquals(resolveTemplateModel("test/missing", registry), { ok: false });
    assertEquals(resolveTemplateModel("test/model", registry), { ok: true, provider: "test", id: "model" });
});

Deno.test("setActiveModel delegates reconfiguration to SessionRuntime and persists selection", async () => {
    await withRuntimeCommandFixture("chat-session-model-persistence-", async ({ projectRoot }) => {
        const runtime = createSessionRuntime();
        try {
            const { sessionId } = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            await setActiveModel(runtime, sessionId, "model-a", "provider-a");
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, {
                model: "model-a",
                provider: "provider-a",
            });
            assertEquals(getSettingsManager(projectRoot).getDefaultModel(), "model-a");
            assertEquals(getSettingsManager(projectRoot).getDefaultProvider(), "provider-a");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("setActiveModel rejects a missing real Runtime session", async () => {
    await withRuntimeCommandFixture("chat-session-missing-model-session-", async () => {
        const runtime = createSessionRuntime();
        await assertRejects(
            () => setActiveModel(runtime, "missing-session", "model", "test"),
            Error,
            "missing runtime session",
        );
    });
});

Deno.test("getActiveModel reads the real Runtime snapshot", async () => {
    await withRuntimeCommandFixture("chat-session-active-model-", async ({ projectRoot }) => {
        const runtime = createSessionRuntime();
        try {
            const { sessionId } = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            await runtime.setSessionModel(sessionId, "model-a", "provider-a");
            assertEquals(getActiveModel(runtime, sessionId), "model-a");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("persistThinkingLevel stores the selected level", async () => {
    await withRuntimeCommandFixture("chat-session-thinking-persistence-", async ({ projectRoot }) => {
        await persistThinkingLevel("high", projectRoot);
        assertEquals(getSettingsManager(projectRoot).getDefaultThinkingLevel(), "high");
    });
});

Deno.test("chat session starts a real composed TUI through the public composition interface", async () => {
    await withRuntimeCommandFixture("chat-session-composed-startup-", async () => {
        const terminal = new VirtualTerminal({ columns: 100, rows: 30 });
        const readySessions: string[] = [];
        const composition = await createInteractiveTuiComposition(null, {
            browser: NO_OPEN_BROWSER_PORT,
            terminal,
            skipModelWelcome: true,
            sessionStartMode: "new",
            initialAgentName: "operator",
            onSessionReady: (sessionId) => readySessions.push(sessionId),
        });
        try {
            await composition.waitForIdle();
            assertEquals(readySessions, [composition.sessionId]);
            assertEquals(composition.runtime.getSessionSnapshot(composition.sessionId)?.busy, false);
            assertStringIncludes(terminal.getScreenText(), "RunWield");
        } finally {
            await composition.dispose();
        }
    });
});

Deno.test("chat session starts in a Project registered by Workspace", async () => {
    await withRuntimeCommandFixture("chat-session-managed-project-startup-", async ({ projectRoot }) => {
        const store = openOwnerCoordinationStore();
        const terminal = new VirtualTerminal({ columns: 100, rows: 30 });
        const readySessions: string[] = [];
        try {
            store.registerProject({ root: projectRoot, now: () => "2026-01-01T00:00:01.000Z" });
            Deno.chdir(projectRoot);
            const composition = await createInteractiveTuiComposition(null, {
                browser: NO_OPEN_BROWSER_PORT,
                terminal,
                skipModelWelcome: true,
                sessionStartMode: "new",
                initialAgentName: "operator",
                onSessionReady: (sessionId) => readySessions.push(sessionId),
            });
            try {
                await composition.waitForIdle();
                assertEquals(readySessions, [composition.sessionId]);
                const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
                assertEquals(snapshot?.activeAgent, "operator");
                assertEquals(snapshot?.sessionManagerId, null);
                assertEquals(snapshot?.managed, null);
                const project = store.ensureRuntimeProject({ root: projectRoot });
                assertEquals((await store.listProjectSessions(project.projectId)).sessions, []);
                assertStringIncludes(terminal.getScreenText(), "RunWield");
            } finally {
                await composition.dispose();
            }
        } finally {
            store.close();
        }
    });
});

Deno.test("chat session startup does not show busy or thinking output before a turn", async () => {
    await withRuntimeCommandFixture("chat-session-no-phantom-startup-output-", async ({ projectRoot }) => {
        const store = openOwnerCoordinationStore();
        const terminal = new VirtualTerminal({ columns: 100, rows: 30 });
        const transientEvents: string[] = [];
        const busyStates: boolean[] = [];
        let thinkingBlocks = 0;
        let clearMessages = 0;
        try {
            store.registerProject({ root: projectRoot, now: () => "2026-01-01T00:00:01.000Z" });
            Deno.chdir(projectRoot);
            const composition = await createInteractiveTuiComposition(null, {
                browser: NO_OPEN_BROWSER_PORT,
                terminal,
                sessionStartMode: "new",
                configureUiAPI: (uiAPI) => {
                    const originalSetBusy = uiAPI.setBusy?.bind(uiAPI);
                    uiAPI.setBusy = (busy) => {
                        busyStates.push(busy);
                        if (busy) transientEvents.push("busy:true");
                        originalSetBusy?.(busy);
                    };
                    const originalAppendThinkingStart = uiAPI.appendThinkingStart?.bind(uiAPI);
                    uiAPI.appendThinkingStart = () => {
                        thinkingBlocks += 1;
                        transientEvents.push("thinking:start");
                        return originalAppendThinkingStart?.() || { appendDelta: () => {}, end: () => {} };
                    };
                    const originalClearMessages = uiAPI.clearMessages?.bind(uiAPI);
                    uiAPI.clearMessages = () => {
                        clearMessages += 1;
                        transientEvents.push("messages:clear");
                        originalClearMessages?.();
                    };
                    const originalSetManagedSyncStatus = uiAPI.setManagedSyncStatus?.bind(uiAPI);
                    uiAPI.setManagedSyncStatus = (status) => {
                        originalSetManagedSyncStatus?.(status);
                    };
                    const originalSetRunningTasks = uiAPI.setRunningTasks?.bind(uiAPI);
                    uiAPI.setRunningTasks = (tasks) => {
                        if (tasks.length > 0) transientEvents.push("tasks:set");
                        originalSetRunningTasks?.(tasks);
                    };
                    const originalStartToolExecution = uiAPI.startToolExecution?.bind(uiAPI);
                    uiAPI.startToolExecution = (id, toolName, title) => {
                        transientEvents.push(`tool:${toolName}`);
                        return originalStartToolExecution?.(id, toolName, title) || {
                            bodyText: "",
                            startTime: Date.now(),
                            setOutput: () => {},
                            endExecution: () => {},
                        };
                    };
                },
            });
            try {
                await composition.waitForIdle();
                assertEquals(transientEvents, []);
                assertEquals(busyStates.includes(true), false);
                assertEquals(thinkingBlocks, 0);
                assertEquals(clearMessages, 0);
                const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
                assertEquals(snapshot?.activeAgent, "router");
                assertEquals(snapshot?.sessionManagerId, null);
                assertEquals(snapshot?.managed, null);
            } finally {
                await composition.dispose();
            }
        } finally {
            store.close();
        }
    });
});

Deno.test("submit handoff loop invokes one Runtime prompt by opaque id", async () => {
    await withRuntimeCommandFixture("chat-session-handoff-", async ({ projectRoot }) => {
        const runtime = createSessionRuntime();
        try {
            const { sessionId } = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            const calls: string[] = [];
            const originalPromptUserTurn = runtime.promptUserTurn.bind(runtime);
            runtime.promptUserTurn = (async (activeSessionId, options) => {
                calls.push(`${activeSessionId}:${options.initialRequest}:${(options.initialImages || []).length}`);
                return await originalPromptUserTurn(activeSessionId, options);
            }) as SessionRuntime["promptUserTurn"];
            await runScopedSubmitHandoffLoop({
                runtime,
                sessionId,
                uiAPI: {
                    appendSystemMessage: () => {},
                    appendAgentMessageStart: () => ({ appendText: () => {} }),
                    requestRender: () => {},
                    promptSelect: () => Promise.resolve(null),
                    promptText: () => Promise.resolve(null),
                    showModelSelector: () => {},
                    abortActivePrompt: () => {},
                },
                initialRequest: "first request",
                initialImages: [],
            });
            assertEquals(calls, [`${sessionId}:first request:0`]);
        } finally {
            runtime.closeAllSessions();
        }
    });
});
