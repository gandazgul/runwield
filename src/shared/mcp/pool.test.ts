import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { dirname, fromFileUrl, join } from "@std/path";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { SessionHost } from "../session/session-host.js";
import { createSessionRuntime } from "../session/session-runtime.ts";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { McpToolPool, startMcpToolPool } from "./pool.ts";

const fixtureServer = join(dirname(fromFileUrl(import.meta.url)), "fixture-server.ts");

function callFixtureTool(
    tool: ToolDefinition,
    marker: string,
    onUpdate?: Parameters<ToolDefinition["execute"]>[3],
) {
    const context = {} as Parameters<ToolDefinition["execute"]>[4];
    return tool.execute(`call-${marker}`, { marker }, undefined, onUpdate, context);
}

async function readLog(path: string): Promise<string[]> {
    try {
        return (await Deno.readTextFile(path)).trim().split("\n").filter(Boolean);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
}

async function startFixturePool(env: Record<string, string> = {}) {
    const logPath = await Deno.makeTempFile({ prefix: "runwield-mcp-log-" });
    const poolResult = await startMcpToolPool({
        cwd: Deno.cwd(),
        servers: [{
            name: "fixture",
            command: Deno.execPath(),
            args: ["run", "-A", fixtureServer],
            env: { RUNWIELD_MCP_FIXTURE_LOG: logPath, ...env },
            source: "request",
        }],
    });
    return { ...poolResult, logPath };
}

Deno.test("MCP pool exposes a real stdio tool and forwards arguments", async () => {
    const poolResult = await startFixturePool();
    try {
        assertEquals(poolResult.warnings, []);
        const tools = poolResult.pool.getTools();
        assertEquals(tools.map((tool) => tool.name), ["mcp_fixture_fixture_echo"]);
        const context = {} as Parameters<typeof tools[0]["execute"]>[4];
        const result = await tools[0].execute("call-1", { marker: "real-call" }, undefined, undefined, context);
        assertEquals(result.content, [{ type: "text", text: "fixture-result:real-call" }]);
        const logLines = await readLog(poolResult.logPath);
        assertStringIncludes(logLines.join("\n"), '"event":"call"');
        assertStringIncludes(logLines.join("\n"), '"marker":"real-call"');
    } finally {
        await poolResult.pool.close();
        await Deno.remove(poolResult.logPath).catch(() => {});
    }
});

Deno.test("root Pi turns can call a real MCP fixture tool", async () => {
    await withRuntimeCommandFixture("runwield-root-mcp-call-", async (fixture) => {
        const logPath = await Deno.makeTempFile({ prefix: "runwield-root-mcp-log-" });
        const runtime = createSessionRuntime();
        let sawToolResultInTurn = false;
        let sawErrorResultInTurn = false;
        fixture.setModelResponseFactories([
            () => {
                return fauxAssistantMessage([
                    fauxToolCall("mcp_fixture_fixture_echo", { marker: "root-pi" }),
                    fauxToolCall("mcp_fixture_fixture_echo", { marker: "error" }),
                ]);
            },
            (context) => {
                sawToolResultInTurn = JSON.stringify(context.messages).includes("fixture-result:root-pi");
                sawErrorResultInTurn = context.messages.some((message) =>
                    message.role === "toolResult" && message.toolName === "mcp_fixture_fixture_echo" &&
                    message.isError === true
                );
                return fauxAssistantMessage(fauxText("Root MCP turn complete."));
            },
        ]);
        try {
            const sessionId = await runtime.createPromptReadySession({
                cwd: fixture.projectRoot,
                mcpServers: [{
                    name: "fixture",
                    command: Deno.execPath(),
                    args: ["run", "-A", fixtureServer],
                    env: { RUNWIELD_MCP_FIXTURE_LOG: logPath },
                    source: "request",
                }],
            });
            const result = await runtime.promptSession(sessionId, { initialRequest: "Call the MCP fixture." });
            assertEquals(result.ok, true);
            assertEquals(sawToolResultInTurn, true);
            assertEquals(sawErrorResultInTurn, true);
            const logLines = await readLog(logPath);
            assertStringIncludes(logLines.join("\n"), '"marker":"root-pi"');
        } finally {
            await runtime.closeAllSessionsWhenIdle?.();
            await Deno.remove(logPath).catch(() => {});
        }
    });
});

Deno.test("Pi MCP client follows paginated tool lists and retains tool annotations", async () => {
    const poolResult = await startFixturePool({
        RUNWIELD_MCP_FIXTURE_PAGINATED: "1",
        RUNWIELD_MCP_FIXTURE_TOOLS: "first,second",
    });
    try {
        const tools = poolResult.pool.getTools();
        assertEquals(tools.map((tool) => tool.name), ["mcp_fixture_first", "mcp_fixture_second"]);
        assertEquals(tools.map((tool) => tool.annotations), [{ readOnlyHint: true }, { readOnlyHint: true }]);
        assertStringIncludes((await readLog(poolResult.logPath)).join("\n"), '"cursor":"second-page"');
        const result = await callFixtureTool(tools[1], "paginated");
        assertEquals(result.content, [{ type: "text", text: "fixture-result:paginated" }]);
    } finally {
        await poolResult.pool.close();
        await Deno.remove(poolResult.logPath).catch(() => {});
    }
});

Deno.test("Pi MCP content conversion preserves structured results, errors, and embedded images", async () => {
    const poolResult = await startFixturePool();
    try {
        const [tool] = poolResult.pool.getTools();
        const structured = await callFixtureTool(tool, "structured");
        assertEquals(structured.content, [{
            type: "text",
            text: JSON.stringify({ marker: "structured", count: 2 }, null, 2),
        }]);
        assertEquals(structured.details, {
            server: "fixture",
            tool: "fixture_echo",
            isError: false,
            structuredContent: { marker: "structured", count: 2 },
        });
        const failed = await callFixtureTool(tool, "error");
        assertEquals(failed.isError, true);
        assertEquals(failed.details, { server: "fixture", tool: "fixture_echo", isError: true });
        assertEquals(failed.content, [{ type: "text", text: "fixture-error" }]);
        const image = await callFixtureTool(tool, "image-resource");
        assertEquals(image.content, [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
    } finally {
        await poolResult.pool.close();
        await Deno.remove(poolResult.logPath).catch(() => {});
    }
});

Deno.test("Pi MCP progress reaches the RunWield tool update callback", async () => {
    const poolResult = await startFixturePool();
    try {
        const [tool] = poolResult.pool.getTools();
        const updates: string[] = [];
        const result = await callFixtureTool(tool, "progress", (update) => {
            for (const block of update.content) if (block.type === "text") updates.push(block.text);
        });
        assertEquals(updates, ["Fixture halfway done."]);
        assertEquals(result.content, [{ type: "text", text: "fixture-result:progress" }]);
    } finally {
        await poolResult.pool.close();
        await Deno.remove(poolResult.logPath).catch(() => {});
    }
});

Deno.test("Pi MCP transport inherits only RunWield's minimal environment and configured credentials", async () => {
    await withProcessGlobalTestLock(async () => {
        const prior = Deno.env.get("RUNWIELD_MCP_UNCONFIGURED_SECRET");
        Deno.env.set("RUNWIELD_MCP_UNCONFIGURED_SECRET", "host-secret");
        try {
            const poolResult = await startFixturePool({ RUNWIELD_MCP_CONFIGURED_SECRET: "configured-secret" });
            try {
                const [tool] = poolResult.pool.getTools();
                const result = await callFixtureTool(tool, "environment");
                assertEquals(result.content, [{
                    type: "text",
                    text: JSON.stringify({ inherited: null, configured: "configured-secret" }),
                }]);
            } finally {
                await poolResult.pool.close();
                await Deno.remove(poolResult.logPath).catch(() => {});
            }
        } finally {
            if (prior === undefined) Deno.env.delete("RUNWIELD_MCP_UNCONFIGURED_SECRET");
            else Deno.env.set("RUNWIELD_MCP_UNCONFIGURED_SECRET", prior);
        }
    });
});

Deno.test("root Agent handoff keeps the MCP fixture tool available", async () => {
    await withRuntimeCommandFixture("runwield-root-mcp-handoff-", async (fixture) => {
        const logPath = await Deno.makeTempFile({ prefix: "runwield-root-mcp-handoff-log-" });
        const runtime = createSessionRuntime();
        let sawToolResultAfterHandoff = false;
        fixture.setModelResponseFactories([
            () => fauxAssistantMessage(fauxToolCall("mcp_fixture_fixture_echo", { marker: "handoff" })),
            (context) => {
                sawToolResultAfterHandoff = JSON.stringify(context.messages).includes("fixture-result:handoff");
                return fauxAssistantMessage(fauxText("Planner MCP turn complete."));
            },
        ]);
        try {
            const sessionId = await runtime.createPromptReadySession({
                cwd: fixture.projectRoot,
                mcpServers: [{
                    name: "fixture",
                    command: Deno.execPath(),
                    args: ["run", "-A", fixtureServer],
                    env: { RUNWIELD_MCP_FIXTURE_LOG: logPath },
                    source: "request",
                }],
            });
            const switched = await runtime.switchAgent(sessionId, { agentName: "planner" });
            assertEquals(switched.ok, true);

            const result = await runtime.promptSession(sessionId, { initialRequest: "Use MCP after Agent handoff." });

            assertEquals(result.ok, true);
            assertEquals(sawToolResultAfterHandoff, true);
            assertStringIncludes((await readLog(logPath)).join("\n"), '"marker":"handoff"');
        } finally {
            await runtime.closeAllSessionsWhenIdle?.();
            await Deno.remove(logPath).catch(() => {});
        }
    });
});

Deno.test("two Runtime Sessions own and close their MCP pools independently", async () => {
    await withRuntimeCommandFixture("runwield-mcp-two-session-", async (fixture) => {
        const firstLog = await Deno.makeTempFile({ prefix: "runwield-mcp-first-log-" });
        const secondLog = await Deno.makeTempFile({ prefix: "runwield-mcp-second-log-" });
        const runtime = createSessionRuntime();
        const serverFor = (logPath: string) => ({
            name: "fixture",
            command: Deno.execPath(),
            args: ["run", "-A", fixtureServer],
            env: { RUNWIELD_MCP_FIXTURE_LOG: logPath },
            source: "request" as const,
        });
        try {
            const firstId = await runtime.createPromptReadySession({
                cwd: fixture.projectRoot,
                mcpServers: [serverFor(firstLog)],
            });
            const secondId = await runtime.createPromptReadySession({
                cwd: fixture.projectRoot,
                mcpServers: [serverFor(secondLog)],
            });
            await runtime.closeSession(firstId);
            fixture.setModelMessages([
                fauxAssistantMessage(fauxToolCall("mcp_fixture_fixture_echo", { marker: "second-live" })),
                fauxAssistantMessage(fauxText("Second Session MCP turn complete.")),
            ]);

            const result = await runtime.promptSession(secondId, { initialRequest: "Use the second MCP pool." });

            assertEquals(result.ok, true);
            assertStringIncludes((await readLog(firstLog)).join("\n"), '"event":"shutdown"');
            assertStringIncludes((await readLog(secondLog)).join("\n"), '"marker":"second-live"');
        } finally {
            await runtime.closeAllSessionsWhenIdle?.();
            await Deno.remove(firstLog).catch(() => {});
            await Deno.remove(secondLog).catch(() => {});
        }
    });
});

Deno.test("HostedSession dehydration keeps MCP ownership and direct disposal closes only its pool", async () => {
    const host = new SessionHost();
    const first = await startFixturePool();
    const second = await startFixturePool();
    const firstSession = host.createSession({
        id: "first-mcp-owner",
        cwd: Deno.cwd(),
        managed: {
            runwieldSessionId: "runwield-first",
            projectId: "project",
            piSessionId: "pi-first",
            transcriptPath: first.logPath,
            currentSegmentId: "segment-first",
            generation: 0,
            name: null,
            activeAgent: null,
            workflowContext: null,
        },
    });
    const secondSession = host.createSession({
        id: "second-mcp-owner",
        cwd: Deno.cwd(),
        managed: {
            runwieldSessionId: "runwield-second",
            projectId: "project",
            piSessionId: "pi-second",
            transcriptPath: second.logPath,
            currentSegmentId: "segment-second",
            generation: 0,
            name: null,
            activeAgent: null,
            workflowContext: null,
        },
    });
    try {
        await firstSession.setMcpToolPool(first.pool);
        await secondSession.setMcpToolPool(second.pool);
        firstSession.dehydrateManagedSession();
        const [firstTool] = firstSession.getMcpRootTools();
        const context = {} as Parameters<typeof firstTool["execute"]>[4];
        const dehydratedResult = await firstTool.execute(
            "call-dehydrated",
            { marker: "dehydrated-owner" },
            undefined,
            undefined,
            context,
        );
        assertEquals(dehydratedResult.content, [{ type: "text", text: "fixture-result:dehydrated-owner" }]);

        await host.disposeSession(firstSession.id);
        assertStringIncludes((await readLog(first.logPath)).join("\n"), '"event":"shutdown"');
        assertEquals((await readLog(second.logPath)).join("\n").includes('"event":"shutdown"'), false);

        const [secondTool] = secondSession.getMcpRootTools();
        const secondContext = {} as Parameters<typeof secondTool["execute"]>[4];
        const liveResult = await secondTool.execute(
            "call-second-live",
            { marker: "second-owned" },
            undefined,
            undefined,
            secondContext,
        );
        assertEquals(liveResult.content, [{ type: "text", text: "fixture-result:second-owned" }]);
    } finally {
        await host.dispose();
        await Deno.remove(first.logPath).catch(() => {});
        await Deno.remove(second.logPath).catch(() => {});
    }
});

Deno.test("Runtime replacement carries MCP ownership to the new Session", async () => {
    await withRuntimeCommandFixture("runwield-mcp-replacement-", async (fixture) => {
        const logPath = await Deno.makeTempFile({ prefix: "runwield-mcp-replacement-log-" });
        const runtime = createSessionRuntime();
        fixture.setModelMessages([
            fauxAssistantMessage(fauxToolCall("mcp_fixture_fixture_echo", { marker: "replacement" })),
            fauxAssistantMessage(fauxText("Replacement MCP turn complete.")),
        ]);
        try {
            const sessionId = await runtime.createPromptReadySession({
                cwd: fixture.projectRoot,
                mcpServers: [{
                    name: "fixture",
                    command: Deno.execPath(),
                    args: ["run", "-A", fixtureServer],
                    env: { RUNWIELD_MCP_FIXTURE_LOG: logPath },
                    source: "request",
                }],
            });
            const replacementId = await runtime.replaceSessionForExecutionFollowUp(sessionId, {
                planName: "mcp-replacement",
                triageMeta: { classification: "FEATURE", complexity: "LOW" },
                executionAgent: "engineer",
                executionCwd: fixture.projectRoot,
            });

            const result = await runtime.promptSession(replacementId, { initialRequest: "Use the carried MCP tool." });
            assertEquals(result.ok, true);
            assertStringIncludes((await readLog(logPath)).join("\n"), '"marker":"replacement"');
            await runtime.closeAllSessionsWhenIdle?.();
            assertStringIncludes((await readLog(logPath)).join("\n"), '"event":"shutdown"');
        } finally {
            await runtime.closeAllSessionsWhenIdle?.();
            await Deno.remove(logPath).catch(() => {});
        }
    });
});

Deno.test("MCP pool warnings name the failed stage without exposing raw server text", async () => {
    const spawnFailure = await startMcpToolPool({
        cwd: Deno.cwd(),
        servers: [{ name: "dead", command: "/definitely/not/runwield-mcp", args: [], env: {}, source: "request" }],
    });
    try {
        assertEquals(spawnFailure.pool.getTools(), []);
        assertEquals(spawnFailure.warnings[0].serverName, "dead");
        assertEquals(spawnFailure.warnings[0].stage, "spawn");
        assertEquals(spawnFailure.warnings[0].message.includes("/definitely/not"), false);
    } finally {
        await spawnFailure.pool.close();
    }

    const initFailure = await startFixturePool({ RUNWIELD_MCP_FIXTURE_INIT_ERROR: "1" });
    try {
        assertEquals(initFailure.pool.getTools(), []);
        assertEquals(initFailure.warnings[0].stage, "initialization");
        assertEquals(initFailure.warnings[0].message.includes("TOKEN=abc"), false);
        assertEquals(initFailure.warnings[0].message.includes("--secret"), false);
    } finally {
        await initFailure.pool.close();
        await Deno.remove(initFailure.logPath).catch(() => {});
    }

    const listFailure = await startFixturePool({ RUNWIELD_MCP_FIXTURE_LIST_ERROR: "1" });
    try {
        assertEquals(listFailure.pool.getTools(), []);
        assertEquals(listFailure.warnings[0].stage, "tool-list");
        assertEquals(listFailure.warnings[0].message.includes("TOKEN=abc"), false);
        assertEquals(listFailure.warnings[0].message.includes("--flag"), false);
    } finally {
        await listFailure.pool.close();
        await Deno.remove(listFailure.logPath).catch(() => {});
    }
});

Deno.test("MCP pool uses stable aliases for normalized-name collisions", async () => {
    const first = await startFixturePool({ RUNWIELD_MCP_FIXTURE_TOOLS: "same-name,same_name" });
    const second = await startFixturePool({ RUNWIELD_MCP_FIXTURE_TOOLS: "same_name,same-name" });
    try {
        const firstAliases = new Map(first.pool.getTools().map((tool) => [tool.label, tool.name]));
        const secondAliases = new Map(second.pool.getTools().map((tool) => [tool.label, tool.name]));
        assertEquals(firstAliases, secondAliases);
        assert([...firstAliases.values()].every((name) => /^mcp_fixture_same_name_[a-z0-9]{6}$/.test(name)));
    } finally {
        await first.pool.close();
        await second.pool.close();
        await Deno.remove(first.logPath).catch(() => {});
        await Deno.remove(second.logPath).catch(() => {});
    }
});

Deno.test("MCP pool bounds descriptive text for unsupported resource content", async () => {
    const poolResult = await startFixturePool();
    try {
        const [tool] = poolResult.pool.getTools();
        const context = {} as Parameters<typeof tool["execute"]>[4];
        const resource = await tool.execute("call-resource", { marker: "resource" }, undefined, undefined, context);
        assertEquals(resource.content[0].type, "text");
        assert((resource.content[0] as { type: "text"; text: string }).text.length <= 12_000);
        const resourceLink = await tool.execute(
            "call-resource-link",
            { marker: "resource-link" },
            undefined,
            undefined,
            context,
        );
        assert((resourceLink.content[0] as { type: "text"; text: string }).text.length <= 12_000);
    } finally {
        await poolResult.pool.close();
        await Deno.remove(poolResult.logPath).catch(() => {});
    }
});

Deno.test("MCP pool close waits for fixture server shutdown", async () => {
    const poolResult = await startFixturePool();
    await poolResult.pool.close();
    const logLines = await readLog(poolResult.logPath);
    assertStringIncludes(logLines.join("\n"), '"event":"shutdown"');
    await Deno.remove(poolResult.logPath).catch(() => {});
});

Deno.test("MCP pool close falls back to transport close and settles", async () => {
    let transportClosed = false;
    type PoolServer = ConstructorParameters<typeof McpToolPool>[0][number];
    const pool = new McpToolPool([
        {
            client: { close: () => Promise.reject(new Error("client close failed")) },
            transport: {
                close: () => {
                    transportClosed = true;
                    return Promise.resolve();
                },
            },
            definition: { name: "broken-close", command: "fixture", args: [], env: {}, source: "request" },
        } as never as PoolServer,
    ], []);

    await pool.close();

    assertEquals(transportClosed, true);
});

Deno.test("MCP tool calls honor cancellation signals and shut down cleanly", async () => {
    const poolResult = await startFixturePool();
    try {
        const [tool] = poolResult.pool.getTools();
        const context = {} as Parameters<typeof tool["execute"]>[4];
        const controller = new AbortController();
        const pending = tool.execute("call-slow", { marker: "slow" }, controller.signal, undefined, context);
        controller.abort();
        await assertRejects(() => pending);
        await poolResult.pool.close();
        assertStringIncludes((await readLog(poolResult.logPath)).join("\n"), '"event":"shutdown"');
    } finally {
        await poolResult.pool.close();
        await Deno.remove(poolResult.logPath).catch(() => {});
    }
});
