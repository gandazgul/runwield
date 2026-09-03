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

function logSync(entry: Record<string, string | number | boolean | string[]>): void {
    const logPath = getLogPath();
    if (!logPath) return;
    Deno.writeTextFileSync(logPath, `${JSON.stringify(entry)}\n`, { append: true, create: true });
}

function send(message: JsonMap): void {
    Deno.stdout.writeSync(encoder.encode(`${JSON.stringify(message)}\n`));
}

function fixtureShouldListError(): boolean {
    return Deno.env.get("RUNWIELD_MCP_FIXTURE_LIST_ERROR") === "1";
}

function fixtureShouldInitError(): boolean {
    return Deno.env.get("RUNWIELD_MCP_FIXTURE_INIT_ERROR") === "1";
}

function fixtureTools(): JsonMap[] {
    const names = (Deno.env.get("RUNWIELD_MCP_FIXTURE_TOOLS") || "fixture_echo")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    return names.map((name) => ({
        name,
        description: `Fixture tool ${name}.`,
        inputSchema: {
            type: "object",
            properties: { marker: { type: "string" } },
            required: ["marker"],
        },
    }));
}

let buffer = "";
await log({ event: "started", pid: Deno.pid });
function logShutdown(): void {
    logSync({ event: "shutdown", pid: Deno.pid });
}
addEventListener("unload", logShutdown);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    Deno.addSignalListener(signal, () => {
        logShutdown();
        Deno.exit(0);
    });
}

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
                if (fixtureShouldInitError()) {
                    send({
                        jsonrpc: "2.0",
                        id: message.id ?? null,
                        error: { code: -32000, message: "permission denied TOKEN=abc --secret" },
                    });
                } else {
                    send({
                        jsonrpc: "2.0",
                        id: message.id ?? null,
                        result: {
                            protocolVersion: "2025-06-18",
                            capabilities: { tools: {} },
                            serverInfo: { name: "runwield-fixture", version: "1.0.0" },
                        },
                    });
                }
            } else if (message.method === "tools/list") {
                if (fixtureShouldListError()) {
                    send({
                        jsonrpc: "2.0",
                        id: message.id ?? null,
                        error: { code: -32000, message: "raw secret TOKEN=abc --flag" },
                    });
                } else {
                    send({ jsonrpc: "2.0", id: message.id ?? null, result: { tools: fixtureTools() } });
                }
            } else if (message.method === "tools/call") {
                const marker = message.params?.arguments?.marker || "";
                await log({ event: "call", pid: Deno.pid, marker });
                if (marker === "slow") await new Promise((resolve) => setTimeout(resolve, 5_000));
                if (marker === "resource") {
                    send({
                        jsonrpc: "2.0",
                        id: message.id ?? null,
                        result: {
                            content: [{
                                type: "resource",
                                resource: {
                                    uri: `file:///${"u".repeat(20_000)}`,
                                    mimeType: "text/plain",
                                    text: "r".repeat(20_000),
                                },
                            }],
                            isError: false,
                        },
                    });
                } else if (marker === "resource-link") {
                    send({
                        jsonrpc: "2.0",
                        id: message.id ?? null,
                        result: {
                            content: [{
                                type: "resource_link",
                                name: "resource-link",
                                title: "t".repeat(20_000),
                                uri: `file:///${"u".repeat(20_000)}`,
                            }],
                            isError: false,
                        },
                    });
                } else {
                    send({
                        jsonrpc: "2.0",
                        id: message.id ?? null,
                        result: { content: [{ type: "text", text: `fixture-result:${marker}` }], isError: false },
                    });
                }
            }
        }
        newline = buffer.indexOf("\n");
    }
}
