import { assertEquals } from "@std/assert";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
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
        args: ["run", "-A", "--unstable-no-legacy-abort", `${Deno.cwd()}/src/cli.ts`, "mcp", "agy-cli"],
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
