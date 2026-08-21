import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { NO_OPEN_BROWSER_PORT } from "../../shared/browser-port.ts";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { getRunWieldSessionDir } from "../../shared/session/root-session.js";
import { createInteractiveTuiComposition, type InteractiveTuiComposition } from "./interactive-tui-composition.ts";
import { createInteractiveCompositionHarness } from "./testing/interactive-composition-fixture.ts";
import { VirtualTerminal } from "./testing/virtual-terminal.js";
import { ClaudeCliBackendError } from "../../shared/session/backends/claude-cli/failure.ts";

interface DeferredSignal {
    promise: Promise<void>;
    resolve(): void;
}

interface ResumeManagedFixture {
    runwieldSessionId: string;
    projectId: string;
}

function deferredSignal(): DeferredSignal {
    let resolvePromise: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

async function waitFor(
    predicate: () => boolean,
    description: string,
    timeoutMs = 5_000,
): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${description}.`);
}

async function submitText(terminal: VirtualTerminal, text: string): Promise<void> {
    terminal.typeText(text);
    terminal.pressEnter();
    await terminal.flush();
}

async function countSessionTranscripts(projectRoot: string): Promise<number> {
    let count = 0;
    try {
        for await (const entry of Deno.readDir(getRunWieldSessionDir(projectRoot))) {
            if (entry.isFile && entry.name.endsWith(".jsonl")) count++;
        }
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return 0;
        throw error;
    }
    return count;
}

async function startComposition(
    sessionStartMode: "new" | "continue" = "new",
): Promise<{ composition: InteractiveTuiComposition; terminal: VirtualTerminal }> {
    const terminal = new VirtualTerminal({ columns: 100, rows: 30 });
    const composition = await createInteractiveTuiComposition(null, {
        browser: NO_OPEN_BROWSER_PORT,
        terminal,
        skipModelWelcome: false,
        sessionStartMode,
        initialAgentName: "operator",
    });
    await composition.waitForIdle();
    return { composition, terminal };
}

async function seedActiveElsewhereManagedSession(
    projectRoot: string,
): Promise<ReturnType<typeof openOwnerCoordinationStore>> {
    const store = openOwnerCoordinationStore();
    try {
        store.registerProject({ root: projectRoot, now: () => "2026-01-01T00:00:01.000Z" });
        const runtime = createSessionRuntime({
            sessionStore: store,
            ownerProcessKind: "test",
            ownerInstanceId: "chat-input-managed-seed",
        });
        try {
            const created = await runtime.createInteractiveSession({
                cwd: projectRoot,
                mode: "new",
            });
            await runtime.switchAgent(created.sessionId, { agentName: "operator" });
            const managed = runtime.getSessionSnapshot(created.sessionId)?.managed;
            if (!managed) throw new Error("Managed Session seed did not create managed metadata.");
            store.acquireSessionActivation({
                runwieldSessionId: managed.runwieldSessionId,
                projectId: managed.projectId,
                ownerInstanceId: "chat-input-workspace-owner",
                ownerProcessKind: "workspace",
                expectedGeneration: managed.generation,
                phase: "turning",
            });
        } finally {
            await runtime.closeAllSessionsWhenIdle?.();
        }
        return store;
    } catch (error) {
        store.close();
        throw error;
    }
}

async function installFakeClipboardCommands(projectRoot: string): Promise<string> {
    const previousPath = Deno.env.get("PATH") || "";
    const binDir = `${projectRoot}/clipboard-bin`;
    await Deno.mkdir(binDir, { recursive: true });
    const osascriptPath = `${binDir}/osascript`;
    await Deno.writeTextFile(
        osascriptPath,
        [
            "#!/bin/sh",
            'script="$2"',
            "if printf '%s' \"$script\" | grep -q 'return \"image\"'; then",
            "  echo image",
            "  exit 0",
            "fi",
            "temp_file=$(printf '%s' \"$script\" | sed -n 's/^[[:space:]]*set tempFile to \"\\(.*\\)\"$/\\1/p')",
            'printf fixture-png > "$temp_file"',
            "exit 0",
            "",
        ].join("\n"),
    );
    await Deno.chmod(osascriptPath, 0o755);
    Deno.env.set("PATH", `${binDir}:${previousPath}`);
    return previousPath;
}

Deno.test("chat input controller sends accepted editor input through the real composed Runtime", async () => {
    await withRuntimeCommandFixture("chat-input-real-submit-", async ({ setModelResponseFactory }) => {
        const modelRequests: string[] = [];
        setModelResponseFactory((context) => {
            modelRequests.push(JSON.stringify(context.messages));
            return fauxAssistantMessage(fauxText("Fixture response."));
        });
        const { composition, terminal } = await startComposition();
        try {
            await submitText(terminal, "hello from tui");
            await waitFor(() => modelRequests.some((request) => request.includes("hello from tui")), "model request");
            await composition.waitForIdle();
            assert(modelRequests.some((request) => request.includes("hello from tui")));
        } finally {
            await composition.dispose();
        }
    });
});

Deno.test("slash new replaces the TUI with an unpersisted shell until its first message", async () => {
    await withRuntimeCommandFixture("chat-input-slash-new-lazy-", async ({ setModelResponseFactory }) => {
        const modelRequests: string[] = [];
        const releaseModel = deferredSignal();
        setModelResponseFactory(async (context) => {
            modelRequests.push(JSON.stringify(context.messages));
            await releaseModel.promise;
            return fauxAssistantMessage(fauxText("New Session response."));
        });
        const { composition, terminal } = await startComposition();
        try {
            const originalSessionId = composition.sessionId;
            const sessionRoot = composition.runtime.getSessionSnapshot(originalSessionId)?.cwd;
            if (!sessionRoot) throw new Error("Composed Session root is unavailable");
            assertEquals(await countSessionTranscripts(sessionRoot), 0);

            await submitText(terminal, "/new quick notes");
            await waitFor(() => composition.sessionId !== originalSessionId, "new in-memory Session replacement");

            const replacement = composition.runtime.getSessionSnapshot(composition.sessionId);
            assertEquals(replacement?.name, "quick notes");
            assertEquals(replacement?.activeAgent, "router");
            assertEquals(replacement?.sessionManagerId, null);
            assertEquals(replacement?.managed, null);
            assertEquals(await countSessionTranscripts(sessionRoot), 0);

            await submitText(terminal, "persist this Session now");
            await waitFor(
                () => modelRequests.some((request) => request.includes("persist this Session now")),
                "new Session model request",
            );
            await waitFor(
                () =>
                    terminal.getScreenText().includes("persist this Session now") &&
                    terminal.getScreenText().includes("Thinking..."),
                "first message and thinking frame",
            );
            assertStringIncludes(terminal.getScreenText(), "persist this Session now");
            assertStringIncludes(terminal.getScreenText(), "Thinking...");
            releaseModel.resolve();
            await composition.waitForIdle();
            assertEquals(
                typeof composition.runtime.getSessionSnapshot(composition.sessionId)?.sessionManagerId,
                "string",
            );
            assertEquals(await countSessionTranscripts(sessionRoot), 1);
        } finally {
            releaseModel.resolve();
            await composition.dispose();
        }
    });
});

Deno.test("slash resume restores conversation after an interrupted checkpoint", async () => {
    await withRuntimeCommandFixture("chat-input-slash-resume-recovery-", async ({ setModelResponse }) => {
        setModelResponse("Persisted answer restored in the TUI.");
        const seeded = await startComposition();
        let managed: ResumeManagedFixture;
        let expectedModel = "";
        try {
            await submitText(seeded.terminal, "restore this conversation");
            await seeded.composition.waitForIdle();
            const snapshot = seeded.composition.runtime.getSessionSnapshot(seeded.composition.sessionId);
            if (!snapshot?.managed) throw new Error("Seeded Session was not persisted");
            managed = snapshot.managed;
            expectedModel = snapshot.activeModel.model || "";
        } finally {
            await seeded.composition.dispose();
        }

        const store = openOwnerCoordinationStore();
        try {
            const state = store.inspectSessionActivation(managed.runwieldSessionId);
            const segment = store.getCurrentSessionSegment(managed.runwieldSessionId);
            if (!segment) throw new Error("Seeded Session segment is unavailable");
            const proof = store.acquireSessionActivation({
                runwieldSessionId: managed.runwieldSessionId,
                projectId: managed.projectId,
                ownerInstanceId: "slash-resume-interrupted-fixture",
                ownerProcessKind: "test",
                expectedGeneration: state.generation?.generation ?? null,
                expectedCurrentSegmentId: segment.segmentId,
            });
            await Deno.writeTextFile(
                segment.transcriptPath,
                `${
                    JSON.stringify({
                        type: "custom",
                        id: crypto.randomUUID(),
                        customType: "runwield.request_attempt",
                        data: { status: "failed" },
                    })
                }\n`,
                { append: true },
            );
            store.markSessionUncertain(proof, { reason: "interrupted after a failed request" });
        } finally {
            store.close();
        }

        const resumed = await startComposition();
        try {
            await submitText(resumed.terminal, "/resume");
            await waitFor(
                () => resumed.terminal.getScreenText().includes("Select a session to resume:"),
                "resume selector",
            );
            resumed.terminal.pressEnter();
            await waitFor(
                () =>
                    resumed.terminal.getScreenText().includes("restore this conversation") &&
                    resumed.terminal.getScreenText().includes("Persisted answer restored in the TUI."),
                "restored conversation",
            );
            assertStringIncludes(resumed.terminal.getScreenText(), "restore this conversation");
            assertStringIncludes(resumed.terminal.getScreenText(), "Persisted answer restored in the TUI.");
            const resumedSnapshot = resumed.composition.runtime.getSessionSnapshot(resumed.composition.sessionId);
            assertEquals(resumedSnapshot?.activeAgent, "operator");
            assertEquals(resumedSnapshot?.activeModel.model, expectedModel);
        } finally {
            await resumed.composition.dispose();
        }
    });
});

Deno.test("chat input controller runs local commands while a real Runtime turn is active", async () => {
    await withRuntimeCommandFixture("chat-input-real-bash-", async ({ setModelResponseFactory }) => {
        const releaseModel = deferredSignal();
        let modelStarted = false;
        setModelResponseFactory(async () => {
            modelStarted = true;
            await releaseModel.promise;
            return fauxAssistantMessage(fauxText("Delayed response."));
        });
        const { composition, terminal } = await startComposition();
        try {
            await submitText(terminal, "hold turn");
            await waitFor(() => modelStarted, "active model turn");
            await submitText(terminal, "!printf local-output");
            await waitFor(() => terminal.getScrollbackText().includes("local-output"), "local command output");
            assertStringIncludes(terminal.getScrollbackText(), "local-output");
            assertEquals(composition.runtime.getQueuedMessages(composition.sessionId).length, 0);
            releaseModel.resolve();
            await composition.waitForIdle();
        } finally {
            releaseModel.resolve();
            await composition.dispose();
        }
    });
});

Deno.test("chat input controller queues deferred slash input for the next turn during a real Runtime turn", async () => {
    await withRuntimeCommandFixture("chat-input-real-slash-queue-", async ({ setModelResponseFactory }) => {
        const releaseModel = deferredSignal();
        let modelStarted = false;
        setModelResponseFactory(async () => {
            modelStarted = true;
            await releaseModel.promise;
            return fauxAssistantMessage(fauxText("Delayed response."));
        });
        const { composition, terminal } = await startComposition();
        try {
            await submitText(terminal, "hold turn");
            await waitFor(() => modelStarted, "active model turn");
            await submitText(terminal, "/not-a-command args");
            await waitFor(
                () =>
                    composition.runtime.getQueuedMessages(composition.sessionId).some((item) =>
                        item.text === "/not-a-command args" && item.delivery === "next_turn"
                    ),
                "queued deferred slash message",
            );
            assertEquals(composition.runtime.getQueuedMessages(composition.sessionId).map((item) => item.text), [
                "/not-a-command args",
            ]);
            assertEquals(composition.runtime.getQueuedMessages(composition.sessionId)[0]?.delivery, "next_turn");
            releaseModel.resolve();
            await composition.waitForIdle();
        } finally {
            releaseModel.resolve();
            await composition.dispose();
        }
    });
});

Deno.test("chat input controller restores the last queued draft through real keybindings", async () => {
    await withRuntimeCommandFixture("chat-input-real-restore-", async () => {
        const { composition, terminal } = await startComposition();
        try {
            composition.runtime.queueNextTurnMessage(composition.sessionId, "restore me", []);
            terminal.input("\x1b[A");
            await terminal.flush();
            await waitFor(() => terminal.getScreenText().includes("restore me"), "restored draft");
            assertStringIncludes(terminal.getScreenText(), "restore me");
            assertEquals(composition.runtime.getQueuedMessages(composition.sessionId).length, 0);
        } finally {
            await composition.dispose();
        }
    });
});

Deno.test("chat input controller recalls queued steering into the editor oldest to newest on Escape", async () => {
    await withRuntimeCommandFixture("chat-input-real-escape-steering-", async ({ setModelResponseFactory }) => {
        const releaseModel = deferredSignal();
        let modelStarted = false;
        setModelResponseFactory(async () => {
            modelStarted = true;
            await releaseModel.promise;
            return fauxAssistantMessage(fauxText("Delayed response."));
        });
        const { composition, terminal } = await startComposition();
        try {
            await submitText(terminal, "hold turn");
            await waitFor(() => modelStarted, "active model turn");
            await submitText(terminal, "oldest steering");
            await submitText(terminal, "newest steering");
            await waitFor(
                () => composition.runtime.getQueuedMessages(composition.sessionId).length === 2,
                "two queued steering messages",
            );

            terminal.pressEscape();
            await terminal.flush();
            await waitFor(() => terminal.getScreenText().includes("oldest steering"), "recalled steering");

            const screen = terminal.getScreenText();
            assert(screen.indexOf("oldest steering") < screen.indexOf("newest steering"));
            assertEquals(composition.runtime.getQueuedMessages(composition.sessionId).length, 0);
        } finally {
            releaseModel.resolve();
            await composition.dispose();
        }
    });
});

Deno.test("chat input controller preflights pasted image attachments through the composed TUI", async () => {
    await withRuntimeCommandFixture(
        "chat-input-real-image-preflight-",
        async ({ projectRoot, setModelResponseFactory }) => {
            if (Deno.build.os !== "darwin") return;
            const previousPath = await installFakeClipboardCommands(projectRoot);
            const modelRequests: string[] = [];
            setModelResponseFactory((context) => {
                modelRequests.push(JSON.stringify(context.messages));
                return fauxAssistantMessage(fauxText("Saw image."));
            });
            const { composition, terminal } = await startComposition();
            try {
                terminal.input("\x16");
                await terminal.flush();
                await new Promise((resolve) => setTimeout(resolve, 500));
                await terminal.flush();
                await submitText(terminal, "describe pasted image");
                await waitFor(
                    () =>
                        modelRequests.some((request) =>
                            request.includes("describe pasted image") &&
                            (request.includes("image/png") || request.includes("attachment:"))
                        ),
                    "model request with pasted image",
                );
                assert(
                    modelRequests.some((request) =>
                        request.includes("describe pasted image") &&
                        (request.includes("image/png") || request.includes("attachment:"))
                    ),
                );
            } finally {
                Deno.env.set("PATH", previousPath);
                await composition.dispose();
            }
        },
    );
});

Deno.test("chat input controller shows safe text when submit fails", async () => {
    await withRuntimeCommandFixture("chat-input-safe-submit-error-", async () => {
        const { composition, terminal } = await startComposition();
        try {
            const rawMessage = "Session Manager create is blocked: project_identity_unavailable";
            composition.runtime.promptUserTurn = () => Promise.reject(new Error(rawMessage));
            await submitText(terminal, "keep this draft");
            await waitFor(
                () => terminal.getScrollbackText().includes("RunWield could not send that message"),
                "safe submit failure message",
            );
            assertStringIncludes(terminal.getScrollbackText(), "RunWield could not send that message");
            await waitFor(() => terminal.getScreenText().includes("keep this draft"), "restored failed-submit draft");
            assertStringIncludes(terminal.getScreenText(), "keep this draft");
            assertEquals(terminal.getScrollbackText().includes("project_identity_unavailable"), false);
        } finally {
            await composition.dispose();
        }
    });
});

Deno.test("chat input controller does not replace a reported Claude failure", async () => {
    await withRuntimeCommandFixture("chat-input-claude-submit-error-", async () => {
        const { composition, terminal } = await startComposition();
        try {
            composition.runtime.promptUserTurn = () =>
                Promise.reject(
                    new ClaudeCliBackendError("non_zero_exit", {
                        message: "You've hit your monthly spend limit",
                    }),
                );
            await submitText(terminal, "keep this draft");
            await waitFor(() => terminal.getScreenText().includes("keep this draft"), "restored Claude-failure draft");
            assertEquals(terminal.getScrollbackText().includes("RunWield could not send that message"), false);
        } finally {
            await composition.dispose();
        }
    });
});

Deno.test("chat input controller preserves input while model setup blocks through the composed TUI", async () => {
    await withRuntimeCommandFixture("chat-input-real-model-block-", async () => {
        const harness = createInteractiveCompositionHarness({});
        try {
            await harness.waitForScreen("Only showing models from configured providers");
            await harness.pressKey("escape");
            await harness.waitForScreen("No model was selected");
            await harness.waitForComposition(20_000);
            await harness.type("keep me");
            await waitFor(() => harness.terminal.getScreenText().includes("keep me"), "typed blocked draft");
            await harness.type("\r");
            await waitFor(
                () => harness.terminal.getScrollbackText().includes("Choose a default model"),
                "model setup block message",
            );
            assertStringIncludes(harness.terminal.getScreenText(), "keep me");
            assertStringIncludes(harness.terminal.getScrollbackText(), "Choose a default model");
        } finally {
            await harness.dispose();
        }
    }, { providerState: "provider-no-model" });
});

Deno.test("chat input controller preserves input while another surface is active", async () => {
    await withRuntimeCommandFixture("chat-input-real-managed-block-", async ({ alternateRoot }) => {
        const activeStore = await seedActiveElsewhereManagedSession(alternateRoot);
        const { composition, terminal } = await startComposition("continue");
        try {
            await composition.runtime.synchronizeManagedSession(composition.sessionId);
            assertEquals(
                composition.runtime.getUserTurnSubmissionBlockMessage(composition.sessionId),
                "This conversation is still running in RunWield Workspace. Continue there, or wait for its current turn to finish before sending here.",
            );
            await submitText(terminal, "keep managed draft");
            await waitFor(() => terminal.getScreenText().includes("keep managed draft"), "typed managed draft");
            assertStringIncludes(
                terminal.getScreenText(),
                "This conversation is running in RunWield Workspace.",
            );
            assertStringIncludes(terminal.getScreenText(), "keep managed draft");
            assertEquals(composition.runtime.getQueuedMessages(composition.sessionId).length, 0);
        } finally {
            await composition.dispose();
            activeStore.close();
        }
    });
});

Deno.test("chat input controller connects Ctrl+C pending-exit state through real keybindings", async () => {
    await withRuntimeCommandFixture("chat-input-real-ctrl-c-", async () => {
        const { composition, terminal } = await startComposition();
        try {
            terminal.pressCtrlC();
            await terminal.flush();
            await waitFor(
                () => terminal.getScreenText().includes("Ctrl+C - Press again to exit"),
                "pending exit notice",
            );
            assertStringIncludes(terminal.getScreenText(), "Ctrl+C - Press again to exit");
        } finally {
            await composition.dispose();
        }
    });
});
