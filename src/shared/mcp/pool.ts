import { Type } from "@earendil-works/pi-ai";
import { type AgentToolResult, defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import type { JsonMap, JsonValue, McpServerDefinition, McpWarning } from "./config.ts";

export interface McpPoolStartOptions {
    cwd: string;
    servers: McpServerDefinition[];
}

export interface McpPoolStartResult {
    pool: McpToolPool;
    warnings: McpWarning[];
}

interface ConnectedServer {
    definition: McpServerDefinition;
    client: Client;
    transport: StdioClientTransport;
}

interface RemoteToolInfo {
    server: ConnectedServer;
    remoteName: string;
    alias: string;
    description: string;
    inputSchema: JsonMap;
}

interface McpToolDetails {
    server: string;
    tool: string;
    isError: boolean;
    structuredContent?: JsonValue;
}

type McpResultContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string };

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_DESCRIPTIVE_TEXT = 12000;

function warning(server: McpServerDefinition, stage: string, message: string): McpWarning {
    return { source: server.source, serverName: server.name, stage, message };
}

function normalizeToolName(value: string): string {
    const normalized = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return normalized || "tool";
}

function stableSuffix(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 6).padStart(6, "0");
}

function buildAlias(serverName: string, toolName: string, used: Set<string>): string {
    const base = `mcp_${normalizeToolName(serverName)}_${normalizeToolName(toolName)}`;
    let alias = base.slice(0, MAX_TOOL_NAME_LENGTH);
    if (!used.has(alias)) {
        used.add(alias);
        return alias;
    }
    const suffix = `_${stableSuffix(`${serverName}:${toolName}`)}`;
    alias = `${base.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
    while (used.has(alias)) alias = `${alias.slice(0, MAX_TOOL_NAME_LENGTH - 7)}_${stableSuffix(alias)}`;
    used.add(alias);
    return alias;
}

function isJsonMap(value: JsonValue): value is JsonMap {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: Exclude<JsonValue, never>): JsonValue {
    return value;
}

function toJsonMap(value: JsonValue): JsonMap {
    return isJsonMap(value) ? value : { type: "object" };
}

function contentToText(value: JsonValue): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value === null) return "null";
    return JSON.stringify(value, null, 2).slice(0, MAX_DESCRIPTIVE_TEXT);
}

function convertContentBlock(block: JsonMap): McpResultContent {
    if (block.type === "text" && typeof block.text === "string") return { type: "text", text: block.text };
    if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
        return { type: "image", data: block.data, mimeType: block.mimeType };
    }
    if (block.type === "resource_link" && typeof block.uri === "string") {
        const label = typeof block.title === "string"
            ? block.title
            : typeof block.name === "string"
            ? block.name
            : block.uri;
        return { type: "text", text: `[MCP resource link: ${label} <${block.uri}>]` };
    }
    if (block.type === "resource" && isJsonMap(block.resource)) {
        const resource = block.resource;
        const uri = typeof resource.uri === "string" ? resource.uri : "unknown";
        if (typeof resource.text === "string") return { type: "text", text: `[MCP resource ${uri}]\n${resource.text}` };
        return { type: "text", text: `[MCP resource ${uri}: binary content omitted]` };
    }
    if (block.type === "audio") return { type: "text", text: "[MCP audio content is not supported]" };
    return { type: "text", text: `[Unsupported MCP content: ${contentToText(block)}]` };
}

function convertCallResult(result: JsonMap, serverName: string, toolName: string): AgentToolResult<McpToolDetails> {
    const content: McpResultContent[] = [];
    const rawContent = Array.isArray(result.content) ? result.content : [];
    for (const item of rawContent) {
        if (isJsonMap(item)) content.push(convertContentBlock(item));
    }
    if (content.length === 0 && result.toolResult !== undefined) {
        content.push({ type: "text", text: contentToText(result.toolResult) });
    }
    if (content.length === 0 && result.structuredContent !== undefined) {
        content.push({ type: "text", text: contentToText(result.structuredContent) });
    }
    const structuredContent = result.structuredContent !== undefined
        ? toJsonValue(result.structuredContent)
        : undefined;
    return {
        content,
        details: {
            server: serverName,
            tool: toolName,
            isError: result.isError === true,
            ...(structuredContent !== undefined ? { structuredContent } : {}),
        },
    };
}

function createTool(info: RemoteToolInfo): ToolDefinition {
    const schema = Type.Unsafe(info.inputSchema);
    return defineTool({
        name: info.alias,
        label: `MCP: ${info.server.definition.name}/${info.remoteName}`,
        description:
            `External MCP tool from server "${info.server.definition.name}" named "${info.remoteName}". ${info.description}`
                .trim(),
        promptSnippet: `${info.alias}(...): External MCP tool ${info.server.definition.name}/${info.remoteName}.`,
        parameters: schema,
        async execute(_toolCallId, params, signal): Promise<AgentToolResult<McpToolDetails>> {
            const result = await info.server.client.callTool(
                { name: info.remoteName, arguments: params as JsonMap },
                undefined,
                { signal },
            ) as JsonMap;
            return convertCallResult(result, info.server.definition.name, info.remoteName);
        },
    });
}

async function listAllTools(client: Client): Promise<{ name: string; description?: string; inputSchema: JsonMap }[]> {
    const tools: { name: string; description?: string; inputSchema: JsonMap }[] = [];
    let cursor: string | undefined;
    do {
        const result = await client.listTools(cursor ? { cursor } : undefined) as {
            tools: { name: string; description?: string; inputSchema: JsonValue }[];
            nextCursor?: string;
        };
        for (const tool of result.tools) {
            tools.push({ name: tool.name, description: tool.description, inputSchema: toJsonMap(tool.inputSchema) });
        }
        cursor = result.nextCursor;
    } while (cursor);
    return tools;
}

export class McpToolPool {
    private readonly servers: ConnectedServer[];
    private readonly toolDefinitions: ToolDefinition[];
    private closed = false;

    constructor(servers: ConnectedServer[], toolDefinitions: ToolDefinition[]) {
        this.servers = servers;
        this.toolDefinitions = toolDefinitions;
    }

    getTools(): ToolDefinition[] {
        return [...this.toolDefinitions];
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        const results = await Promise.allSettled(this.servers.map((server) => server.client.close()));
        const failed = results.find((result) => result.status === "rejected");
        if (failed && failed.status === "rejected") throw failed.reason;
    }
}

export async function startMcpToolPool(options: McpPoolStartOptions): Promise<McpPoolStartResult> {
    const warnings: McpWarning[] = [];
    const connected: ConnectedServer[] = [];
    const remoteTools: RemoteToolInfo[] = [];
    const aliases = new Set<string>();
    for (const definition of options.servers) {
        const transport = new StdioClientTransport({
            command: definition.command,
            args: definition.args,
            env: { ...getDefaultEnvironment(), ...definition.env },
            cwd: options.cwd,
            stderr: "pipe",
        });
        const client = new Client({ name: "runwield", version: "0.0.0" }, { capabilities: {} });
        try {
            await client.connect(transport);
            const server: ConnectedServer = { definition, client, transport };
            connected.push(server);
            const tools = await listAllTools(client);
            for (const tool of tools) {
                remoteTools.push({
                    server,
                    remoteName: tool.name,
                    alias: buildAlias(definition.name, tool.name, aliases),
                    description: tool.description || "",
                    inputSchema: tool.inputSchema,
                });
            }
        } catch (error) {
            try {
                await client.close();
            } catch {
                try {
                    await transport.close();
                } catch {
                    // Keep the original startup failure.
                }
            }
            const message = error instanceof Error ? error.message : "MCP server could not start.";
            warnings.push(warning(definition, "startup", message));
        }
    }
    return { pool: new McpToolPool(connected, remoteTools.map(createTool)), warnings };
}
