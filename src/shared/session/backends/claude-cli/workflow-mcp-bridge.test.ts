import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { HostedSession } from "../../hosted-session.js";
import { RuntimeEventTypes } from "../../session-runtime-events.js";
import { CLAUDE_CLI_MCP_PROVENANCE, startWorkflowMcpBridge } from "./workflow-mcp-bridge.ts";

interface RecordedCall {
    name: string;
    args: Record<string, unknown>;
}

function makeTestTools() {
    const calls: RecordedCall[] = [];
    const planTool = defineTool({
        name: "plan_written",
        label: "Plan Written",
        description: "Declare a plan.",
        parameters: Type.Object({
            planName: Type.String({ description: "Plan filename without extension." }),
        }),
        execute(_toolCallId, params, _signal, onUpdate) {
            calls.push({ name: "plan_written", args: { ...params } });
            onUpdate?.({
                content: [{ type: "text", text: `plan pending for ${params.planName}` }],
                details: { planName: params.planName, reviewUrl: "http://127.0.0.1/review" },
            });
            return Promise.resolve({
                content: [{ type: "text", text: `plan feedback for ${params.planName}` }],
                details: { outcome: "feedback", feedback: "revise" },
                terminate: false,
            });
        },
    });

    let taskInvocations = 0;
    let releaseAccepted: (() => void) | undefined;
    const acceptedGate = new Promise<void>((resolve) => {
        releaseAccepted = resolve;
    });
    const taskTool = defineTool({
        name: "task_completed",
        label: "Task Completed",
        description: "Declare completion.",
        parameters: Type.Object({
            message: Type.String({ description: "Completion report." }),
        }),
        async execute(_toolCallId, params) {
            calls.push({ name: "task_completed", args: { ...params } });
            taskInvocations += 1;
            await acceptedGate;
            return {
                content: [],
                details: { outcome: "task_completed", message: params.message },
                terminate: true,
            };
        },
    });

    const reviewTool = defineTool({
        name: "review_complete",
        label: "Review Complete",
        description: "Declare review verdict.",
        parameters: Type.Object({
            approved: Type.Boolean({ description: "Whether approved." }),
        }),
        execute(_toolCallId, params) {
            calls.push({ name: "review_complete", args: { ...params } });
            return Promise.resolve({
                content: [{ type: "text", text: "review approved" }],
                details: { outcome: "approved", approved: true, feedback: "", findings: [], advisories: [] },
                terminate: true,
            });
        },
    });

    return {
        calls,
        taskInvocations: () => taskInvocations,
        releaseAccepted: () => releaseAccepted?.(),
        acceptedGate,
        tools: [planTool, taskTool, reviewTool],
    };
}

interface BridgeTestContext {
    manager: SessionManager;
    bridge: Awaited<ReturnType<typeof startWorkflowMcpBridge>>;
    client: Client;
    transport: StreamableHTTPClientTransport;
    mirrored: unknown[];
    runtimeEvents: Array<Record<string, unknown>>;
}

async function withBridge(
    tools: ReturnType<typeof makeTestTools>["tools"],
    callback: (context: BridgeTestContext) => Promise<void>,
): Promise<void> {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-mcp-bridge-" });
    const manager = SessionManager.inMemory(cwd);
    const mirrored: unknown[] = [];
    const runtimeEvents: Array<Record<string, unknown>> = [];
    const hostedSession = new HostedSession({
        id: crypto.randomUUID(),
        cwd,
        eventSink: (event: Record<string, unknown>) => runtimeEvents.push(event),
    });
    const bridge = await startWorkflowMcpBridge({
        tools,
        cwd,
        hostedSession,
        sessionManager: manager,
        onMessage: (message) => {
            mirrored.push(message);
        },
        assistantBase: { api: "anthropic-messages", provider: "anthropic", model: "claude-sonnet" },
    });
    const transport = new StreamableHTTPClientTransport(new URL(bridge.url), {
        requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } },
    });
    const client = new Client({ name: "runwield-bridge-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        await callback({ manager, bridge, client, transport, mirrored, runtimeEvents });
    } finally {
        try {
            await client.close();
        } catch {
            // best effort
        }
        try {
            await transport.close();
        } catch {
            // best effort
        }
        await bridge.close();
        await Deno.remove(cwd, { recursive: true }).catch(() => undefined);
    }
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
    return result.content.map((block) => (block.type === "text" ? block.text || "" : "")).join(" ");
}

function recordedMessages(context: BridgeTestContext): unknown[] {
    return context.manager.getBranch()
        .filter((entry) => entry.type === "message")
        .map((entry) => (entry as { message?: unknown }).message);
}

Deno.test("workflow MCP bridge lists only the eligible prefixed aliases with preserved schemas", async () => {
    await withBridge(makeTestTools().tools, async (context) => {
        const listed = await context.client.listTools();
        const names = listed.tools.map((tool) => tool.name);
        assertEquals(names, ["runwield_plan_written", "runwield_task_completed", "runwield_review_complete"]);
        const taskTool = listed.tools.find((tool) => tool.name === "runwield_task_completed");
        assertEquals(taskTool?.inputSchema.type, "object");
        assertEquals(
            (taskTool?.inputSchema.properties as Record<string, unknown> | undefined)?.message !== undefined,
            true,
        );
        assertEquals(taskTool?.inputSchema.required, ["message"]);
    });
});

Deno.test("workflow MCP bridge rejects requests without the Bearer token before protocol dispatch", async () => {
    await withBridge(makeTestTools().tools, async (context) => {
        const noAuth = await fetch(context.bridge.url, { method: "POST", body: "{}" });
        assertEquals(noAuth.status, 401);
        const wrongAuth = await fetch(context.bridge.url, {
            method: "POST",
            headers: { Authorization: "Bearer wrong" },
            body: "{}",
        });
        assertEquals(wrongAuth.status, 401);
        assertEquals(context.bridge.token.length >= 32, true);
    });
});

Deno.test("workflow MCP bridge records canonical messages, provenance, and a rejected call without advancement", async () => {
    const tools = makeTestTools();
    await withBridge(tools.tools, async (context) => {
        const rejected = await context.client.callTool({
            name: "runwield_task_completed",
            arguments: {},
        });
        assertEquals(rejected.isError, true);
        assertStringIncludes(resultText(rejected as never), "rejected");

        const messages = recordedMessages(context);
        const toolCalls = messages.filter((msg) =>
            (msg as { role?: string }).role === "assistant" &&
            (msg as { content?: Array<{ type?: string }> }).content?.some((block) => block.type === "toolCall")
        );
        const toolResults = messages.filter((msg) => (msg as { role?: string }).role === "toolResult");
        assertEquals(toolCalls.length, 1);
        assertEquals(toolResults.length, 1);
        const callBlock = (toolCalls[0] as { content: Array<{ name?: string; arguments?: unknown }> }).content[0];
        assertEquals(callBlock.name, "task_completed");
        const result = toolResults[0] as { toolName?: string; isError?: boolean; details?: Record<string, unknown> };
        assertEquals(result.toolName, "task_completed");
        assertEquals(result.isError, true);
        assertEquals("outcome" in (result.details || {}), false);
        assertEquals(result.details?.provenance, CLAUDE_CLI_MCP_PROVENANCE);
        assertEquals(tools.taskInvocations(), 0);
    });
});

Deno.test("workflow MCP bridge emits live Runtime tool events for delegated plan_written updates", async () => {
    await withBridge(makeTestTools().tools, async (context) => {
        const result = await context.client.callTool({
            name: "runwield_plan_written",
            arguments: { planName: "runtime-boundary" },
        });
        assertEquals(result.isError, false);

        const toolEvents = context.runtimeEvents.filter((event) =>
            event.type === RuntimeEventTypes.TOOL_START ||
            event.type === RuntimeEventTypes.TOOL_UPDATE ||
            event.type === RuntimeEventTypes.TOOL_END
        );
        assertEquals(toolEvents.map((event) => event.type), [
            RuntimeEventTypes.TOOL_START,
            RuntimeEventTypes.TOOL_UPDATE,
            RuntimeEventTypes.TOOL_END,
        ]);
        assertEquals(toolEvents[0].toolName, "plan_written");
        assertEquals(toolEvents[0].title, "plan_written docs/plans/runtime-boundary.md");
        assertEquals(toolEvents[1].output, "plan pending for runtime-boundary");
        assertEquals(
            (toolEvents[1].details as Record<string, unknown> | null)?.reviewUrl,
            "http://127.0.0.1/review",
        );
        assertEquals(toolEvents[2].output, "plan feedback for runtime-boundary");
    });
});

Deno.test("workflow MCP bridge accepts a delegated result, stamps provenance, and atomically closes the gate", async () => {
    const tools = makeTestTools();
    tools.releaseAccepted();
    await withBridge(tools.tools, async (context) => {
        const accepted = await context.client.callTool({
            name: "runwield_task_completed",
            arguments: { message: "all done" },
        });
        assertEquals(accepted.isError, false);
        assertEquals(tools.taskInvocations(), 1);

        const messages = recordedMessages(context);
        const results = messages.filter((msg) =>
            (msg as { role?: string }).role === "toolResult" &&
            (msg as { toolName?: string }).toolName === "task_completed"
        );
        assertEquals(results.length, 1);
        const details = (results[0] as { details?: Record<string, unknown> }).details;
        assertEquals(details?.outcome, "task_completed");
        assertEquals(details?.message, "all done");
        assertEquals(details?.provenance, CLAUDE_CLI_MCP_PROVENANCE);
        const assistantMsg = messages.find((msg) =>
            (msg as { role?: string }).role === "assistant" &&
            (msg as { content?: Array<{ type?: string; name?: string }> }).content?.some(
                (block) => block.type === "toolCall" && block.name === "task_completed",
            )
        );
        assertEquals(assistantMsg !== undefined, true);
        assertEquals(context.mirrored.length, 2);

        // Gate is closed: later calls are rejected without invoking the tool again.
        const after = await context.client.callTool({
            name: "runwield_task_completed",
            arguments: { message: "second attempt" },
        });
        assertEquals(after.isError, true);
        assertStringIncludes(resultText(after as never), "gate");
        assertEquals(tools.taskInvocations(), 1);
    });
});

Deno.test("workflow MCP bridge serializes concurrent calls so only the first terminal result wins", async () => {
    const tools = makeTestTools();
    await withBridge(tools.tools, async (context) => {
        const first = context.client.callTool({
            name: "runwield_task_completed",
            arguments: { message: "first" },
        });
        const second = context.client.callTool({
            name: "runwield_task_completed",
            arguments: { message: "second" },
        });
        tools.releaseAccepted();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        assertEquals(firstResult.isError, false);
        assertEquals(secondResult.isError, true);
        // Serialization + gate: exactly one invocation reached the tool.
        assertEquals(tools.taskInvocations(), 1);
        const results = recordedMessages(context).filter((msg) =>
            (msg as { role?: string }).role === "toolResult" &&
            (msg as { toolName?: string }).toolName === "task_completed"
        );
        assertEquals(results.length, 2);
    });
});

Deno.test("workflow MCP bridge rejects an unknown tool and closes the listener deterministically", async () => {
    await withBridge(makeTestTools().tools, async (context) => {
        const unknown = await context.client.callTool({
            name: "runwield_bash",
            arguments: {},
        });
        assertEquals(unknown.isError, true);
        assertStringIncludes(resultText(unknown as never), "unknown tool");

        const url = context.bridge.url;
        await context.client.close();
        await context.transport.close();
        await context.bridge.close();
        assertEquals(context.bridge.closed, true);
        await context.bridge.close(); // idempotent
        await assertRejects(() => fetch(url), TypeError);
    });
});
