/**
 * @module attached/claude/mcp
 * MCP stdio carrier for the Attached Workflow Coordinator, used by RunWield Connect for
 * Claude Code. One tool per coordinator operation; framing only, no workflow rules.
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types";
import { runAttachedOperation } from "../../shared/attached/coordinator.ts";
import { ATTACHED_OPERATIONS } from "../../shared/attached/operations.ts";
import plugin from "./plugin/.claude-plugin/plugin.json" with { type: "json" };

/** Serve coordinator operations over stdio until the host closes the stream. */
export async function runAttachedMcpServer(projectRoot: string, version: string): Promise<void> {
    const pluginRoot = Deno.env.get("RUNWIELD_ATTACHED_PLUGIN_ROOT");
    const manifest = pluginRoot
        ? JSON.parse(await Deno.readTextFile(`${pluginRoot}/.claude-plugin/plugin.json`))
        : plugin;
    if (typeof manifest.version !== "string" || !manifest.version.trim()) {
        throw new Error("RunWield plugin manifest must provide a version.");
    }
    const adapterVersion: string = manifest.version;
    const server = new Server({ name: "runwield-attached", version }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: ATTACHED_OPERATIONS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema: {
                ...inputSchema,
                required: inputSchema.required.filter((field) => field !== "evidence"),
                properties: Object.fromEntries(
                    Object.entries(inputSchema.properties).filter(([field]) => field !== "evidence"),
                ),
                type: "object" as const,
            },
        })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const operation = ATTACHED_OPERATIONS.find((entry) => entry.name === request.params.name);
        if (!operation) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        const client = server.getClientVersion();
        const argumentsWithEvidence = operation.name === "status" ? request.params.arguments ?? {} : {
            ...request.params.arguments,
            evidence: {
                host: client?.name ?? "claude-code",
                hostVersion: client?.version ?? "not-reported",
                adapterVersion,
            },
        };
        const inputText = JSON.stringify(argumentsWithEvidence);
        const result = await runAttachedOperation(operation.name, projectRoot, inputText);
        return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
            isError: !result.ok,
        };
    });

    const transport = new StdioServerTransport();
    const closed = new Promise<void>((resolve) => {
        transport.onclose = resolve;
    });
    await server.connect(transport);
    await closed;
}
