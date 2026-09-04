import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { SessionRuntime } from "./session-runtime.js";
import { SessionHost } from "./session-host.js";
import { openFileSessionStore } from "./file-session-store.ts";

interface NamedInvocationPromptResult {
    ok: boolean;
    namedInvocation?: {
        profile?: {
            agentName?: string;
            model?: string;
            thinkingLevel?: string;
        };
    };
}

interface NamedInvocationImageReference {
    ref?: string;
    path?: string;
    base64?: string;
    mimeType?: string;
}

interface PersistedNamedInvocationPayload {
    imageReferences?: NamedInvocationImageReference[];
}

interface PersistedTranscriptEntry {
    type?: string;
    customType?: string;
    data?: PersistedNamedInvocationPayload;
}

function makeRuntime(sessionStore = openFileSessionStore()) {
    return new SessionRuntime({
        sessionHost: new SessionHost(),
        sessionStore,
        ownerProcessKind: "test",
        ownerInstanceId: crypto.randomUUID(),
    });
}

async function installClaudeCliFixture(binDir: string, logPath: string): Promise<void> {
    await Deno.mkdir(binDir, { recursive: true });
    const fixturePath = new URL("./backends/claude-cli/testing/fake-claude-mcp-client.ts", import.meta.url).pathname;
    const script = `#!/bin/sh\nexec deno run -A ${JSON.stringify(fixturePath)} "$@"\n`;
    const path = join(binDir, "claude");
    await Deno.writeTextFile(path, script);
    await Deno.chmod(path, 0o755);
    await Deno.writeTextFile(logPath, "");
}

async function readNamedInvocationPayloads(transcriptPath: string): Promise<PersistedNamedInvocationPayload[]> {
    const text = await Deno.readTextFile(transcriptPath);
    return text.trim().split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PersistedTranscriptEntry)
        .filter((entry) => entry.type === "custom" && entry.customType === "runwield.named_invocation")
        .map((entry) => entry.data || {});
}

Deno.test("Prompt Template invocation sends active Segment history plus the exact expansion", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-active-segment-",
        async ({ projectRoot, setModelResponseFactories }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "use-active-fact.md"),
                [
                    "---",
                    "agent: operator",
                    "---",
                    "Use the active-session fact to answer this request: {{input}}",
                    "",
                ].join("\n"),
            );

            const modelRequests: string[] = [];
            const recordToolRequest = (context: Context) => {
                modelRequests.push(JSON.stringify(context.messages));
                return fauxAssistantMessage(fauxToolCall("write", {
                    path: "tool-proof.txt",
                    content: "ACTIVE-TOOL-EXCHANGE\n",
                }));
            };
            const recordTextRequest = (context: Context) => {
                modelRequests.push(JSON.stringify(context.messages));
                return fauxAssistantMessage(fauxText(`fixture response ${modelRequests.length}`));
            };
            setModelResponseFactories([recordTextRequest, recordToolRequest, recordTextRequest, recordTextRequest]);

            const store = openFileSessionStore();
            const runtime = makeRuntime(store);
            try {
                const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                const sessionId = created.sessionId;
                await runtime.switchAgent(sessionId, { agentName: "engineer" });

                const predecessor = await runtime.promptSession(sessionId, {
                    initialRequest: "SEALED-PREDECESSOR-SENTINEL must stay out of the active segment.",
                    initialImages: [],
                });
                assertEquals(predecessor.ok, true);
                const managedBeforeRoll = runtime.getSessionSnapshot(sessionId)?.managed;
                if (!managedBeforeRoll) throw new Error("expected managed Session metadata");
                await runtime.rollManagedSessionSegment(sessionId, {
                    kind: "semantic_repair",
                    continuation: { agentName: "engineer" },
                    expectedGeneration: managedBeforeRoll.generation,
                });
                await runtime.switchAgent(sessionId, { agentName: "engineer" });
                const managedAfterRoll = runtime.getSessionSnapshot(sessionId)?.managed;
                if (!managedAfterRoll) throw new Error("expected managed Session metadata after rollover");
                const segments = store.listSessionTranscriptSegments(managedAfterRoll.runwieldSessionId);
                assertEquals(segments.length, 2);
                assertEquals(typeof segments[0].sealedAt, "string");
                assertEquals(segments[1].segmentId, managedAfterRoll.currentSegmentId);
                assertEquals(segments[1].sealedAt, null);

                const active = await runtime.promptUserTurn(sessionId, {
                    initialRequest: "Remember active fact ACTIVE-SEGMENT-ALPHA.",
                    initialImages: [],
                });
                assertEquals(active.ok, true);

                const second = await runtime.promptUserTurn(sessionId, {
                    initialRequest: "/use-active-fact What fact did I give you?",
                    initialImages: [],
                });
                assertEquals(second.ok, true);
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "engineer");
                assertEquals(modelRequests.length, 4);

                const auxiliaryRequest = modelRequests[3];
                assertStringIncludes(auxiliaryRequest, "Remember active fact ACTIVE-SEGMENT-ALPHA.");
                assertStringIncludes(auxiliaryRequest, "ACTIVE-TOOL-EXCHANGE");
                assertStringIncludes(auxiliaryRequest, "fixture response 3");
                assertStringIncludes(
                    auxiliaryRequest,
                    "Use the active-session fact to answer this request: {{input}}\\n\\nWhat fact did I give you?",
                );
                assert(
                    !auxiliaryRequest.includes("SEALED-PREDECESSOR-SENTINEL"),
                    "the model does not receive sealed predecessor segment text",
                );
                assert(
                    !auxiliaryRequest.includes("/use-active-fact What fact did I give you?"),
                    "the model receives the resolved expansion, not the compact slash command",
                );
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
                store.close();
            }
        },
    );
});

Deno.test("Prompt Template invocation sends active Segment history plus the exact expansion through Claude CLI", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-claude-cli-",
        async ({ projectRoot, homeDir, setModelResponseFactories }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "claude-template.md"),
                [
                    "---",
                    "agent: operator",
                    "model: claude-cli/sonnet",
                    "thinkingLevel: off",
                    "---",
                    "Use the Claude CLI expansion: {{input}}",
                    "",
                ].join("\n"),
            );
            const binDir = join(homeDir, "claude-bin");
            const logPath = join(homeDir, "claude-log.jsonl");
            await installClaudeCliFixture(binDir, logPath);
            const previousPath = Deno.env.get("PATH");
            const previousLog = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG");
            Deno.env.set("PATH", `${binDir}:${previousPath || ""}`);
            Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", logPath);

            const modelRequests: string[] = [];
            const recordToolRequest = (context: Context) => {
                modelRequests.push(JSON.stringify(context.messages));
                return fauxAssistantMessage(fauxToolCall("write", {
                    path: "claude-tool-proof.txt",
                    content: "ACTIVE-CLI-TOOL-EXCHANGE\n",
                }));
            };
            const recordTextRequest = (context: Context) => {
                modelRequests.push(JSON.stringify(context.messages));
                return fauxAssistantMessage(fauxText(`claude fixture response ${modelRequests.length}`));
            };
            setModelResponseFactories([recordTextRequest, recordToolRequest, recordTextRequest]);

            const store = openFileSessionStore();
            const runtime = makeRuntime(store);
            const events: Array<{ type: string; model?: string; provider?: string; thinkingLevel?: string }> = [];
            try {
                const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                const sessionId = created.sessionId;
                await runtime.switchAgent(sessionId, { agentName: "engineer" });
                const predecessor = await runtime.promptSession(sessionId, {
                    initialRequest: "SEALED-CLI-PREDECESSOR-SENTINEL must stay out of the active segment.",
                    initialImages: [],
                });
                assertEquals(predecessor.ok, true);
                const managedBeforeRoll = runtime.getSessionSnapshot(sessionId)?.managed;
                if (!managedBeforeRoll) throw new Error("expected managed Session metadata");
                await runtime.rollManagedSessionSegment(sessionId, {
                    kind: "semantic_repair",
                    continuation: { agentName: "engineer" },
                    expectedGeneration: managedBeforeRoll.generation,
                });
                await runtime.switchAgent(sessionId, { agentName: "engineer" });
                const managedAfterRoll = runtime.getSessionSnapshot(sessionId)?.managed;
                if (!managedAfterRoll) throw new Error("expected managed Session metadata after rollover");
                const segments = store.listSessionTranscriptSegments(managedAfterRoll.runwieldSessionId);
                assertEquals(segments.length, 2);
                assertEquals(typeof segments[0].sealedAt, "string");
                assertEquals(segments[1].segmentId, managedAfterRoll.currentSegmentId);
                assertEquals(segments[1].sealedAt, null);

                const active = await runtime.promptUserTurn(sessionId, {
                    initialRequest: "Remember active Claude fact ACTIVE-CLI-SEGMENT-ALPHA.",
                    initialImages: [],
                });
                assertEquals(active.ok, true);
                const beforeSnapshot = runtime.getSessionSnapshot(sessionId);
                runtime.subscribeSessionEvents(sessionId, (event) => {
                    if (
                        event.type === "agent_changed" || event.type === "model_changed" ||
                        event.type === "thinking_level_changed"
                    ) events.push(event);
                });

                const result: NamedInvocationPromptResult = await runtime.promptUserTurn(sessionId, {
                    initialRequest: "/claude-template inspect this fixture",
                    initialImages: [],
                });

                assertEquals(result.ok, true);
                assertEquals(result.namedInvocation?.profile, {
                    agentName: "operator",
                    model: "claude-cli/sonnet",
                    thinkingLevel: "off",
                });
                assertEquals(modelRequests.length, 3);
                const log = JSON.parse((await Deno.readTextFile(logPath)).trim().split("\n")[0]);
                assertStringIncludes(log.stdin, "Remember active Claude fact ACTIVE-CLI-SEGMENT-ALPHA.");
                assertStringIncludes(log.stdin, "Tool call write");
                assertStringIncludes(log.stdin, "ACTIVE-CLI-TOOL-EXCHANGE");
                assertStringIncludes(log.stdin, "Tool result write");
                assertStringIncludes(log.stdin, "claude fixture response 3");
                assertStringIncludes(log.stdin, "Use the Claude CLI expansion: {{input}}\n\ninspect this fixture");
                assert(
                    !log.stdin.includes("SEALED-CLI-PREDECESSOR-SENTINEL"),
                    "Claude CLI does not receive sealed predecessor segment text",
                );
                assert(
                    !log.stdin.includes("/claude-template inspect this fixture"),
                    "Claude CLI receives the expanded request, not the compact command",
                );
                assertEquals(
                    events.some((event) =>
                        event.type === "model_changed" && event.provider === "claude-cli" &&
                        (event.model === "sonnet" || event.model === "claude-cli/sonnet")
                    ),
                    true,
                );
                assertEquals(
                    events.some((event) => event.type === "thinking_level_changed" && event.thinkingLevel === "off"),
                    true,
                );
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, beforeSnapshot?.activeAgent);
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, beforeSnapshot?.activeModel);
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
                store.close();
                if (previousPath === undefined) Deno.env.delete("PATH");
                else Deno.env.set("PATH", previousPath);
                if (previousLog === undefined) Deno.env.delete("RUNWIELD_CLAUDE_FIXTURE_LOG");
                else Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", previousLog);
            }
        },
    );
});

Deno.test("Prompt Template invocation rejects unsupported Claude CLI thinking before process launch", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-claude-cli-thinking-",
        async ({ projectRoot, homeDir }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "claude-deep.md"),
                [
                    "---",
                    "agent: operator",
                    "model: claude-cli/sonnet",
                    "thinkingLevel: high",
                    "---",
                    "Think deeply through Claude CLI about {{input}}",
                    "",
                ].join("\n"),
            );
            const binDir = join(homeDir, "claude-thinking-bin");
            const logPath = join(homeDir, "claude-thinking-log.jsonl");
            await installClaudeCliFixture(binDir, logPath);
            const previousPath = Deno.env.get("PATH");
            const previousLog = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG");
            Deno.env.set("PATH", `${binDir}:${previousPath || ""}`);
            Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", logPath);

            const store = openFileSessionStore();
            const runtime = makeRuntime(store);
            try {
                const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                const sessionId = created.sessionId;
                await runtime.switchAgent(sessionId, { agentName: "engineer" });
                const beforeSnapshot = runtime.getSessionSnapshot(sessionId);

                await assertRejects(
                    () =>
                        runtime.promptUserTurn(sessionId, {
                            initialRequest: "/claude-deep this fixture",
                            initialImages: [],
                        }),
                    Error,
                    'does not support thinkingLevel "high" for RunWield named invocations',
                );

                assertEquals(await Deno.readTextFile(logPath), "");
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, beforeSnapshot?.activeAgent);
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, beforeSnapshot?.activeModel);
                assertEquals(
                    runtime.getSessionSnapshot(sessionId)?.activeExecutionWorkflow,
                    beforeSnapshot?.activeExecutionWorkflow,
                );
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
                store.close();
                if (previousPath === undefined) Deno.env.delete("PATH");
                else Deno.env.set("PATH", previousPath);
                if (previousLog === undefined) Deno.env.delete("RUNWIELD_CLAUDE_FIXTURE_LOG");
                else Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", previousLog);
            }
        },
    );
});

Deno.test("Prompt Template invocation fails oversized Claude CLI requests before process launch", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-claude-capacity-",
        async ({ projectRoot, homeDir }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "too-large.md"),
                [
                    "---",
                    "agent: operator",
                    "model: claude-cli/sonnet",
                    "---",
                    "x ".repeat(900_000),
                ].join("\n"),
            );
            const binDir = join(homeDir, "claude-capacity-bin");
            const logPath = join(homeDir, "claude-capacity-log.jsonl");
            await installClaudeCliFixture(binDir, logPath);
            const previousPath = Deno.env.get("PATH");
            const previousLog = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG");
            Deno.env.set("PATH", `${binDir}:${previousPath || ""}`);
            Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", logPath);
            const runtime = makeRuntime();
            try {
                const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                await assertRejects(
                    () =>
                        runtime.promptUserTurn(created.sessionId, {
                            initialRequest: "/too-large",
                            initialImages: [],
                        }),
                    Error,
                    "The current Session history does not fit claude-cli/sonnet",
                );
                assertEquals(await Deno.readTextFile(logPath), "");
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
                if (previousPath === undefined) Deno.env.delete("PATH");
                else Deno.env.set("PATH", previousPath);
                if (previousLog === undefined) Deno.env.delete("RUNWIELD_CLAUDE_FIXTURE_LOG");
                else Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", previousLog);
            }
        },
    );
});

Deno.test("Prompt Template invocation stores persisted image references", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-image-reference-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "inspect-image.md"),
                ["---", "agent: operator", "---", "Inspect the attached image."].join("\n"),
            );
            setModelResponseFactory(() => fauxAssistantMessage(fauxText("image inspected")));
            const store = openFileSessionStore();
            const runtime = makeRuntime(store);
            try {
                const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                const result = await runtime.promptUserTurn(created.sessionId, {
                    initialRequest: "/inspect-image",
                    initialImages: [{ base64: btoa("fresh-image"), mimeType: "image/png" }],
                });
                assertEquals(result.ok, true);
                const managed = runtime.getSessionSnapshot(created.sessionId)?.managed;
                if (!managed) throw new Error("expected managed Session metadata");
                const segment = store.getCurrentSessionSegment(managed.runwieldSessionId);
                if (!segment) throw new Error("expected active segment");
                const payloads = await readNamedInvocationPayloads(segment.transcriptPath);
                assertEquals(payloads.length, 1);
                const reference = payloads[0].imageReferences?.[0];
                assertEquals(reference?.mimeType, "image/png");
                assertStringIncludes(reference?.ref || "", "attachment:");
                assertStringIncludes(reference?.path || "", ".wld");
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
                store.close();
            }
        },
    );
});

Deno.test("Prompt Template invocation rejects unsupported thinking before a model call", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-unsupported-thinking-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "deep.md"),
                ["---", "agent: operator", "thinkingLevel: high", "---", "Think deeply about {{input}}"].join("\n"),
            );
            let modelCalls = 0;
            setModelResponseFactory((context: Context) => {
                modelCalls += 1;
                return fauxAssistantMessage(fauxText(JSON.stringify(context.messages)));
            });

            const runtime = makeRuntime();
            const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            await assertRejects(
                () =>
                    runtime.promptUserTurn(created.sessionId, {
                        initialRequest: "/deep this fixture",
                        initialImages: [],
                    }),
                Error,
                'does not support thinkingLevel "high"',
            );
            assertEquals(modelCalls, 0);
        },
    );
});

Deno.test("Prompt Template auxiliary turns cannot advance an active workflow", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-no-workflow-authority-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "finish-work.md"),
                ["---", "agent: engineer", "---", "Try to complete the workflow."].join("\n"),
            );
            setModelResponseFactory(() =>
                fauxAssistantMessage(fauxToolCall("task_completed", { message: "- Should not be accepted." }))
            );

            const runtime = makeRuntime();
            const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            const sessionId = created.sessionId;
            await runtime.switchAgent(sessionId, { agentName: "engineer" });
            await runtime.setActiveExecutionWorkflow(sessionId, {
                planName: "fixture-plan",
                triageMeta: { classification: "QUICK_FIX" },
                executionAgent: "engineer",
                executionCwd: projectRoot,
            });
            const beforeWorkflow = runtime.getSessionSnapshot(sessionId)?.activeExecutionWorkflow;
            await runtime.promptUserTurn(sessionId, {
                initialRequest: "/finish-work",
                initialImages: [],
            });

            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeExecutionWorkflow, beforeWorkflow);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "engineer");
        },
    );
});

Deno.test("Prompt Template model override is one-shot and does not replace the root model", async () => {
    await withRuntimeCommandFixture(
        "named-invocation-one-shot-model-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const promptDir = join(projectRoot, ".wld", "prompts");
            await Deno.mkdir(promptDir, { recursive: true });
            await Deno.writeTextFile(
                join(promptDir, "alt-model.md"),
                [
                    "---",
                    "agent: operator",
                    "model: runtime-command-fixture/alternate-fixture-model",
                    "---",
                    "Use the alternate model for {{input}}",
                ].join("\n"),
            );
            const usedModels: string[] = [];
            setModelResponseFactory((_context, _options, _state, model) => {
                usedModels.push(`${model.provider}/${model.id}`);
                return fauxAssistantMessage(fauxText("alternate model response"));
            });

            const runtime = makeRuntime();
            const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            await runtime.switchAgent(created.sessionId, { agentName: "operator" });
            const beforeModel = runtime.getSessionSnapshot(created.sessionId)?.activeModel;
            const result = await runtime.promptUserTurn(created.sessionId, {
                initialRequest: "/alt-model this turn",
                initialImages: [],
            });

            assertEquals(result.ok, true);
            assertEquals(usedModels, ["runtime-command-fixture/alternate-fixture-model"]);
            assertEquals(runtime.getSessionSnapshot(created.sessionId)?.activeModel, beforeModel);
        },
        { additionalModels: [{ id: "alternate-fixture-model", name: "Alternate Fixture Model" }] },
    );
});
