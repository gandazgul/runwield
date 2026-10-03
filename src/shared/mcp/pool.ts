import { Type } from "@earendil-works/pi-ai";
import { type AgentToolResult, defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type CallToolResult, McpClient, StdioTransport, toLlmContent, type Tool } from "@earendil-works/pi-mcp";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio";
import type { JsonMap, McpServerDefinition, McpWarning } from "./config.ts";

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
    client: McpClient;
    transport: StdioTransport;
}

interface RemoteToolInfo {
    server: ConnectedServer;
    remoteName: string;
    alias: string;
    description: string;
    inputSchema: Tool["inputSchema"];
    annotations?: Tool["annotations"];
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
    structuredContent?: CallToolResult["structuredContent"];
}

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

function safeErrorMessage(error: Error | null): string {
    if (error instanceof Deno.errors.NotFound) return "MCP server command was not found.";
    if (error instanceof Deno.errors.PermissionDenied) return "MCP server command could not be started.";
    if (error && error.name && error.name !== "Error") return `MCP server failed with ${error.name}.`;
    return "MCP server failed.";
}

function convertCallResult(
    result: CallToolResult,
    serverName: string,
    toolName: string,
): AgentToolResult<McpToolDetails> {
    // Pi owns MCP content conversion. Preserve RunWield's bound on resource descriptions and
    // structured fallback text, while ordinary text results and images pass through unchanged.
    const content = toLlmContent(result).map((block, index) =>
        block.type === "text" && result.content[index]?.type !== "text"
            ? { ...block, text: block.text.slice(0, MAX_DESCRIPTIVE_TEXT) }
            : block
    );
    const structuredContent = result.structuredContent;
    return {
        content,
        isError: result.isError === true,
        details: {
            server: serverName,
            tool: toolName,
            isError: result.isError === true,
            ...(structuredContent !== undefined ? { structuredContent } : {}),
        },
    };
}

function createTool(info: RemoteToolInfo): ToolDefinition {
    const schema = Type.Unsafe({
        ...info.inputSchema,
        type: "object",
        properties: info.inputSchema.properties ?? {},
    });
    return defineTool({
        name: info.alias,
        label: `MCP: ${info.server.definition.name}/${info.remoteName}`,
        description:
            `External MCP tool from server "${info.server.definition.name}" named "${info.remoteName}". ${info.description}`
                .trim(),
        promptSnippet: `${info.alias}(...): External MCP tool ${info.server.definition.name}/${info.remoteName}.`,
        parameters: schema,
        annotations: info.annotations,
        async execute(_toolCallId, params, signal, onUpdate): Promise<AgentToolResult<McpToolDetails>> {
            const result = await info.server.client.callTool(
                info.remoteName,
                params as JsonMap,
                {
                    signal,
                    onProgress: onUpdate
                        ? (progress) =>
                            onUpdate({
                                content: [{
                                    type: "text",
                                    text: progress.message ?? `MCP progress: ${progress.progress}`,
                                }],
                                details: { server: info.server.definition.name, tool: info.remoteName, isError: false },
                            })
                        : undefined,
                },
            );
            return convertCallResult(result, info.server.definition.name, info.remoteName);
        },
    });
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
        const transport = new StdioTransport({
            command: definition.command,
            args: definition.args,
            env: { ...getDefaultEnvironment(), ...definition.env },
            // Pi inherits the full host environment by default; retain RunWield's minimal
            // inherited environment plus only the credentials explicitly configured here.
            inheritEnv: false,
            cwd: options.cwd,
            stderr: "pipe",
        });
        const client = new McpClient({ name: "runwield", version: "0.0.0", capabilities: {} });
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
            const tools = await client.listTools();
            for (const tool of tools) {
                remoteTools.push({
                    server,
                    remoteName: tool.name,
                    alias: "",
                    description: tool.description || "",
                    inputSchema: tool.inputSchema,
                    annotations: tool.annotations,
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
