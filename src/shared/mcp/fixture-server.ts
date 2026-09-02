import type { JsonMap } from "./config.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
function getLogPath(): string {
    return Deno.env.get("RUNWIELD_MCP_FIXTURE_LOG") || "";
}

async function log(entry: Record<string, string | number | boolean | string[]>): Promise<void> {
    const logPath = getLogPath();
    if (!logPath) return;
    await Deno.writeTextFile(logPath, `${JSON.stringify(entry)}\n`, { append: true, create: true });
}

function send(message: JsonMap): void {
    Deno.stdout.writeSync(encoder.encode(`${JSON.stringify(message)}\n`));
}

let buffer = "";
await log({ event: "started", pid: Deno.pid });
addEventListener("unload", () => {
    const logPath = getLogPath();
    if (logPath) {
        Deno.writeTextFileSync(logPath, `${JSON.stringify({ event: "shutdown", pid: Deno.pid })}\n`, {
            append: true,
            create: true,
        });
    }
});

for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
            const message = JSON.parse(line) as {
                id?: string | number;
                method?: string;
                params?: { name?: string; arguments?: Record<string, string> };
            };
            if (message.method === "initialize") {
                send({
                    jsonrpc: "2.0",
                    id: message.id ?? null,
                    result: {
                        protocolVersion: "2025-06-18",
                        capabilities: { tools: {} },
                        serverInfo: { name: "runwield-fixture", version: "1.0.0" },
                    },
                });
            } else if (message.method === "tools/list") {
                send({
                    jsonrpc: "2.0",
                    id: message.id ?? null,
                    result: {
                        tools: [{
                            name: "fixture_echo",
                            description: "Echo a marker from the RunWield MCP fixture.",
                            inputSchema: {
                                type: "object",
                                properties: { marker: { type: "string" } },
                                required: ["marker"],
                            },
                        }],
                    },
                });
            } else if (message.method === "tools/call") {
                const marker = message.params?.arguments?.marker || "";
                await log({ event: "call", pid: Deno.pid, marker });
                send({
                    jsonrpc: "2.0",
                    id: message.id ?? null,
                    result: { content: [{ type: "text", text: `fixture-result:${marker}` }], isError: false },
                });
            }
        }
        newline = buffer.indexOf("\n");
    }
}
