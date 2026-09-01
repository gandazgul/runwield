import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { SessionRuntime } from "./session-runtime.js";
import { SessionHost } from "./session-host.js";
import { openFileSessionStore } from "./file-session-store.ts";

function makeRuntime() {
    return new SessionRuntime({
        sessionHost: new SessionHost(),
        sessionStore: openFileSessionStore(),
        ownerProcessKind: "test",
        ownerInstanceId: crypto.randomUUID(),
    });
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
            setModelResponseFactories([recordToolRequest, recordTextRequest, recordTextRequest]);

            const runtime = makeRuntime();
            const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            const sessionId = created.sessionId;
            await runtime.switchAgent(sessionId, { agentName: "engineer" });

            const first = await runtime.promptSession(sessionId, {
                initialRequest: "Remember active fact ACTIVE-SEGMENT-ALPHA.",
                initialImages: [],
            });
            assertEquals(first.ok, true);

            const second = await runtime.promptUserTurn(sessionId, {
                initialRequest: "/use-active-fact What fact did I give you?",
                initialImages: [],
            });
            assertEquals(second.ok, true);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "engineer");
            assertEquals(modelRequests.length, 3);

            const auxiliaryRequest = modelRequests[2];
            assertStringIncludes(auxiliaryRequest, "Remember active fact ACTIVE-SEGMENT-ALPHA.");
            assertStringIncludes(auxiliaryRequest, "ACTIVE-TOOL-EXCHANGE");
            assertStringIncludes(auxiliaryRequest, "fixture response 2");
            assertStringIncludes(
                auxiliaryRequest,
                "Use the active-session fact to answer this request: {{input}}\\n\\nWhat fact did I give you?",
            );
            assert(
                !auxiliaryRequest.includes("/use-active-fact What fact did I give you?"),
                "the model receives the resolved expansion, not the compact slash command",
            );
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
