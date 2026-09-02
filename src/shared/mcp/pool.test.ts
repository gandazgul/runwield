import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { startMcpToolPool } from "./pool.ts";

const fixtureServer = join(dirname(fromFileUrl(import.meta.url)), "fixture-server.ts");

async function readLog(path: string): Promise<string[]> {
    try {
        return (await Deno.readTextFile(path)).trim().split("\n").filter(Boolean);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
}

Deno.test("MCP pool exposes a real stdio tool and forwards arguments", async () => {
    const logPath = await Deno.makeTempFile({ prefix: "runwield-mcp-log-" });
    const poolResult = await startMcpToolPool({
        cwd: Deno.cwd(),
        servers: [{
            name: "fixture",
            command: Deno.execPath(),
            args: ["run", "-A", fixtureServer],
            env: { RUNWIELD_MCP_FIXTURE_LOG: logPath },
            source: "request",
        }],
    });
    try {
        assertEquals(poolResult.warnings, []);
        const tools = poolResult.pool.getTools();
        assertEquals(tools.map((tool) => tool.name), ["mcp_fixture_fixture_echo"]);
        const context = {} as Parameters<typeof tools[0]["execute"]>[4];
        const result = await tools[0].execute("call-1", { marker: "real-call" }, undefined, undefined, context);
        assertEquals(result.content, [{ type: "text", text: "fixture-result:real-call" }]);
        const logLines = await readLog(logPath);
        assertStringIncludes(logLines.join("\n"), '"event":"call"');
        assertStringIncludes(logLines.join("\n"), '"marker":"real-call"');
    } finally {
        await poolResult.pool.close();
        await Deno.remove(logPath).catch(() => {});
    }
});

Deno.test("MCP pool omits a failed server and keeps the session usable", async () => {
    const poolResult = await startMcpToolPool({
        cwd: Deno.cwd(),
        servers: [{ name: "dead", command: "/definitely/not/runwield-mcp", args: [], env: {}, source: "request" }],
    });
    try {
        assertEquals(poolResult.pool.getTools(), []);
        assertEquals(poolResult.warnings.length, 1);
        assertEquals(poolResult.warnings[0].serverName, "dead");
    } finally {
        await poolResult.pool.close();
    }
});
