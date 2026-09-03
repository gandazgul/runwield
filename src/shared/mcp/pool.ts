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

interface RemoteToolAliasInfo {
    tool: RemoteToolInfo;
    baseAlias: string;
    stableKey: string;
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

function buildBaseAlias(serverName: string, toolName: string): string {
    return `mcp_${normalizeToolName(serverName)}_${normalizeToolName(toolName)}`.slice(0, MAX_TOOL_NAME_LENGTH);
}

function buildSuffixedAlias(baseAlias: string, stableKey: string, used: Set<string>): string {
    let suffixSeed = stableKey;
    let alias = "";
    do {
        const suffix = `_${stableSuffix(suffixSeed)}`;
        alias = `${baseAlias.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
        suffixSeed = `${stableKey}:${alias}`;
    } while (used.has(alias));
    used.add(alias);
    return alias;
}

function assignAliases(remoteTools: RemoteToolInfo[]): void {
    const aliasInfos: RemoteToolAliasInfo[] = remoteTools.map((tool) => ({
        tool,
        baseAlias: buildBaseAlias(tool.server.definition.name, tool.remoteName),
        stableKey: `${tool.server.definition.source}:${tool.server.definition.name}:${tool.remoteName}`,
    }));
    const baseCounts = new Map<string, number>();
    for (const info of aliasInfos) baseCounts.set(info.baseAlias, (baseCounts.get(info.baseAlias) || 0) + 1);
    const used = new Set<string>();
    for (const info of aliasInfos.sort((left, right) => left.stableKey.localeCompare(right.stableKey))) {
        if (baseCounts.get(info.baseAlias) === 1 && !used.has(info.baseAlias)) {
            info.tool.alias = info.baseAlias;
            used.add(info.baseAlias);
        } else {
            info.tool.alias = buildSuffixedAlias(info.baseAlias, info.stableKey, used);
        }
    }
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

function boundedText(value: string): string {
    return value.slice(0, MAX_DESCRIPTIVE_TEXT);
}

function contentToText(value: JsonValue): string {
    if (typeof value === "string") return boundedText(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value === null) return "null";
    return boundedText(JSON.stringify(value, null, 2));
}

function safeErrorMessage(error: Error | null): string {
    if (error instanceof Deno.errors.NotFound) return "MCP server command was not found.";
    if (error instanceof Deno.errors.PermissionDenied) return "MCP server command could not be started.";
    if (error && error.name && error.name !== "Error") return `MCP server failed with ${error.name}.`;
    return "MCP server failed.";
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
        return { type: "text", text: boundedText(`[MCP resource link: ${label} <${block.uri}>]`) };
    }
    if (block.type === "resource" && isJsonMap(block.resource)) {
        const resource = block.resource;
        const uri = typeof resource.uri === "string" ? resource.uri : "unknown";
        if (typeof resource.text === "string") {
            return { type: "text", text: boundedText(`[MCP resource ${uri}]\n${resource.text}`) };
        }
        return { type: "text", text: boundedText(`[MCP resource ${uri}: binary content omitted]`) };
    }
    if (block.type === "audio") return { type: "text", text: "[MCP audio content is not supported]" };
    return { type: "text", text: boundedText(`[Unsupported MCP content: ${contentToText(block)}]`) };
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
        await Promise.all(this.servers.map(async (server) => {
            try {
                await server.client.close();
            } catch {
                // Transport close below is the final cleanup path.
            }
            try {
                await server.transport.close();
            } catch {
                // Continue closing the rest of the pool.
            }
        }));
    }
}

export async function startMcpToolPool(options: McpPoolStartOptions): Promise<McpPoolStartResult> {
    const warnings: McpWarning[] = [];
    const connected: ConnectedServer[] = [];
    const remoteTools: RemoteToolInfo[] = [];
    for (const definition of options.servers) {
        const transport = new StdioClientTransport({
            command: definition.command,
            args: definition.args,
            env: { ...getDefaultEnvironment(), ...definition.env },
            cwd: options.cwd,
            stderr: "pipe",
        });
        const client = new Client({ name: "runwield", version: "0.0.0" }, { capabilities: {} });
        const originalStart = transport.start.bind(transport);
        let failureStage = "spawn";
        transport.start = async () => {
            await originalStart();
            failureStage = "initialization";
        };
        let server: ConnectedServer | null = null;
        try {
            await client.connect(transport);
            server = { definition, client, transport };
            connected.push(server);
        } catch (error) {
            try {
                await client.close();
            } catch {
                try {
                    await transport.close();
                } catch {
                    // Keep the original connection failure.
                }
            }
            const failure = error instanceof Error ? error : null;
            warnings.push(warning(definition, failureStage, safeErrorMessage(failure)));
            continue;
        }
        try {
            const tools = await listAllTools(client);
            for (const tool of tools) {
                remoteTools.push({
                    server,
                    remoteName: tool.name,
                    alias: "",
                    description: tool.description || "",
                    inputSchema: tool.inputSchema,
                });
            }
        } catch (error) {
            const failure = error instanceof Error ? error : null;
            warnings.push(warning(definition, "tool-list", safeErrorMessage(failure)));
            const index = connected.indexOf(server);
            if (index >= 0) connected.splice(index, 1);
            try {
                await client.close();
            } catch {
                try {
                    await transport.close();
                } catch {
                    // Keep the original tool-list failure.
                }
            }
        }
    }
    assignAliases(remoteTools);
    return { pool: new McpToolPool(connected, remoteTools.map(createTool)), warnings };
}
