/**
 * @module shared/session/backends/claude-cli/testing/fake-claude-mcp-client
 *
 * Test-only fake `claude` executable body. The test fixtures install a tiny
 * `claude` shim on PATH that execs this script with the real argv, so module
 * resolution (including the real MCP SDK client) runs from the workspace
 * instead of a temp dir.
 *
 * Non-MCP mode reproduces the old inline fixture exactly: it logs the argv,
 * stdin, and appended system prompt, then emits a stream-json assistant
 * message plus result line.
 *
 * MCP mode (when `--mcp-config` is present) additionally reads the generated
 * Claude MCP config, connects a real MCP SDK client over loopback HTTP with
 * the config's Bearer token, lists the advertised tools, and executes the
 * calls described by `RUNWIELD_CLAUDE_FIXTURE_MCP_CALLS` (a JSON array of
 * `{ name, arguments }`). Everything is appended to the fixture log as JSON
 * lines for the test to assert against.
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";

interface FixtureMcpCall {
    name: string;
    arguments?: JsonObject;
}

/** Concrete JSON value shape for fixture log entries. */
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject {
    [key: string]: JsonValue;
}

async function readTextFile(path: string | undefined): Promise<string> {
    if (!path) return "";
    try {
        return await Deno.readTextFile(path);
    } catch {
        return "";
    }
}

async function appendLogLine(entry: JsonObject): Promise<void> {
    const logPath = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG");
    if (!logPath) return;
    await Deno.writeTextFile(logPath, JSON.stringify(entry) + "\n", { append: true });
}

async function runMcpCalls(configPath: string): Promise<void> {
    const config = JSON.parse(await readTextFile(configPath)) as {
        mcpServers?: Record<string, { url?: string; headers?: Record<string, string> }>;
    };
    const server = config.mcpServers?.runwield;
    if (!server?.url) {
        await appendLogLine({ mcp: { error: "missing runwield mcp server in config" } });
        return;
    }
    let configMode: number | null = null;
    try {
        configMode = (await Deno.stat(configPath)).mode;
    } catch {
        // Mode unavailable on this platform.
    }
    await appendLogLine({
        mcp: {
            config: {
                url: server.url,
                authHeaderPresent: typeof server.headers?.Authorization === "string",
                configMode,
            },
        },
    });
    const unauthorized = await fetch(server.url, { method: "POST", body: "{}" });
    const wrongToken = await fetch(server.url, {
        method: "POST",
        headers: { Authorization: "Bearer not-the-token" },
        body: "{}",
    });
    await appendLogLine({ mcp: { unauthorizedStatus: unauthorized.status, wrongTokenStatus: wrongToken.status } });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: {
            headers: {
                ...(server.headers ? server.headers : {}),
            },
        },
    });
    const client = new Client({ name: "runwield-claude-fixture", version: "1.0.0" });
    try {
        await client.connect(transport);
        const listed = await client.listTools();
        await appendLogLine({ mcp: { tools: listed.tools.map((tool) => tool.name) } });
        const callsJson = await readTextFile(Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_MCP_CALLS"));
        const calls = (callsJson ? JSON.parse(callsJson) : []) as FixtureMcpCall[];
        const results: JsonValue[] = [];
        for (const call of calls) {
            try {
                const result = await client.callTool({
                    name: call.name,
                    arguments: call.arguments ?? {},
                });
                results.push({
                    name: call.name,
                    isError: result.isError === true,
                    text: extractCallResultText(result.content as { type: string; text?: string }[]),
                });
            } catch (error) {
                results.push({
                    name: call.name,
                    isError: true,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        await appendLogLine({ mcp: { calls: results } });
    } finally {
        try {
            await client.close();
        } catch {
            // Transport teardown best-effort.
        }
        try {
            await transport.close();
        } catch {
            // Transport teardown best-effort.
        }
    }
}

function extractCallResultText(content: { type: string; text?: string }[]): string {
    if (!Array.isArray(content)) return "";
    return content.flatMap((block) => {
        if (block.type !== "text") return [];
        return typeof block.text === "string" ? [block.text] : [];
    }).join("\n");
}

async function main(): Promise<void> {
    const stdin = await new Response(Deno.stdin.readable).text();
    const promptIndex = Deno.args.indexOf("--append-system-prompt-file");
    const promptPath = promptIndex >= 0 ? Deno.args[promptIndex + 1] : "";
    const promptText = await readTextFile(promptPath);
    await appendLogLine({ args: Deno.args, stdin, promptText });

    const mcpConfigIndex = Deno.args.indexOf("--mcp-config");
    if (mcpConfigIndex >= 0) {
        await runMcpCalls(Deno.args[mcpConfigIndex + 1]);
    }

    const output = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_OUTPUT") || "";
    const text = output
        ? (JSON.parse(output) as { result?: string }).result || "fixture"
        : Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_TEXT") || "fixture reply";
    console.log(JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text }] },
    }));
    console.log(JSON.stringify({
        type: "result",
        result: text,
        session_id: "external-1",
        usage: { input_tokens: 1, output_tokens: 2 },
    }));
}

await main();
