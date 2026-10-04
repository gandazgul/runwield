import { assertEquals } from "@std/assert";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { getCwd } from "../../../constants.js";
import { AGY_CLI_MCP_PROVENANCE, startRunWieldMcpBridge } from "./mcp-bridge.ts";
import { RUNWIELD_MCP_BRIDGE_TOKEN_ENV, RUNWIELD_MCP_BRIDGE_URL_ENV } from "./stdio-transport.ts";

Deno.test("wld mcp agy-cli forwards tools/list and tools/call over stdio to the parent bridge", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-stdio-bridge-" });
    const manager = SessionManager.inMemory(cwd);
    const calls: Array<{ message: string }> = [];
    const tool = defineTool({
        name: "task_completed",
        label: "Task Completed",
        description: "Declare completion.",
        parameters: Type.Object({
            message: Type.String({ description: "Completion report." }),
        }),
        execute(_toolCallId, params) {
            calls.push({ message: params.message });
            return Promise.resolve({
                content: [{ type: "text", text: `done: ${params.message}` }],
                details: { outcome: "task_completed", message: params.message },
                terminate: true,
            });
        },
    });
    const bridge = await startRunWieldMcpBridge({
        tools: [tool],
        cwd,
        sessionManager: manager,
        assistantBase: { api: "agy-cli", provider: "agy-cli", model: "fixture-model" },
        provenance: AGY_CLI_MCP_PROVENANCE,
    });
    const transport = new StdioClientTransport({
        command: Deno.execPath(),
        args: ["run", "-A", "--unstable-no-legacy-abort", `${getCwd()}/src/cli.ts`, "mcp", "agy-cli"],
        env: {
            [RUNWIELD_MCP_BRIDGE_URL_ENV]: bridge.url,
            [RUNWIELD_MCP_BRIDGE_TOKEN_ENV]: bridge.token,
        },
        stderr: "pipe",
    });
    const client = new Client({ name: "runwield-stdio-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const listed = await client.listTools();
        assertEquals(listed.tools.map((entry) => entry.name), ["runwield_task_completed"]);
        const result = await client.callTool({ name: "runwield_task_completed", arguments: { message: "stdio-ok" } });
        assertEquals(result.isError, false);
        assertEquals(calls, [{ message: "stdio-ok" }]);
        const toolResult = manager.getBranch().find((entry) =>
            entry.type === "message" && (entry as { message?: { role?: string } }).message?.role === "toolResult"
        ) as { message?: { details?: { provenance?: string } } } | undefined;
        assertEquals(toolResult?.message?.details?.provenance, AGY_CLI_MCP_PROVENANCE);
    } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
        await bridge.close();
        await Deno.remove(cwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("Agy stdio review calls survive sixty elapsed seconds and preserve structured output", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-stdio-long-review-" });
    const advancePath = `${cwd}/advance`;
    const advancedPath = `${cwd}/advanced`;
    const started = Promise.withResolvers<void>();
    const decision = Promise.withResolvers<void>();
    let cancelled = false;
    const outputSchema = Type.Object({ approved: Type.Boolean() });
    const tool = defineTool({
        name: "plan_written",
        label: "Plan Written",
        description: "Wait for Plan Review.",
        parameters: Type.Object({}),
        outputSchema,
        async execute(_id, _params, signal) {
            signal?.addEventListener("abort", () => cancelled = true, { once: true });
            started.resolve();
            await decision.promise;
            return {
                content: [{ type: "text", text: "approved" }],
                details: {},
                structuredContent: { approved: true },
            };
        },
    });
    const bridge = await startRunWieldMcpBridge({
        tools: [tool],
        cwd,
        sessionManager: SessionManager.inMemory(cwd),
        assistantBase: { api: "agy-cli", provider: "agy-cli", model: "fixture-model" },
        provenance: AGY_CLI_MCP_PROVENANCE,
    });
    const fixture = new URL("./testing/stdio-clock-fixture.ts", import.meta.url).pathname;
    const transport = new StdioClientTransport({
        command: Deno.execPath(),
        args: ["run", "-A", fixture, advancePath, advancedPath],
        env: { [RUNWIELD_MCP_BRIDGE_URL_ENV]: bridge.url, [RUNWIELD_MCP_BRIDGE_TOKEN_ENV]: bridge.token },
        stderr: "pipe",
    });
    const client = new Client({ name: "runwield-stdio-long-review-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        assertEquals((await client.listTools()).tools[0].outputSchema, JSON.parse(JSON.stringify(outputSchema)));
        const pending = client.callTool({ name: "runwield_plan_written", arguments: {} });
        // Attach the rejection handler immediately so a regressed timeout is a test failure.
        const settled = pending.then((result) => ({ result }), (error: Error) => ({ error }));
        await started.promise;
        await Deno.writeTextFile(advancePath, "advance");
        const deadline = Date.now() + 5_000;
        let advanced = false;
        while (!advanced && Date.now() < deadline) {
            advanced = await Deno.stat(advancedPath).then(() => true, () => false);
            if (!advanced) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assertEquals(advanced, true);
        decision.resolve();
        const outcome = await settled;
        if ("error" in outcome) throw outcome.error;
        assertEquals(outcome.result.structuredContent, { approved: true });
        assertEquals(cancelled, false);
    } finally {
        decision.resolve();
        await client.close();
        await transport.close();
        await bridge.close();
        await Deno.remove(cwd, { recursive: true });
    }
});
