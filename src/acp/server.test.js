/**
 * @module acp/server.test
 * ACP protocol coverage over the real RunWield Session Runtime.
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { withRuntimeCommandFixture } from "../cmd/testing/runtime-command-fixture.ts";
import { mapRuntimeEventToAcpUpdate } from "./event-mapper.js";
import { createAcpInteractionAdapter } from "./interaction-mapper.js";
import { createInitializeResponse, startRunWieldAcpServer, validateNewSessionParams } from "./server.js";

/**
 * @typedef {Object} TestServerHandle
 * @property {WritableStreamDefaultWriter<Uint8Array>} inputWriter
 * @property {ReadableStreamDefaultReader<Uint8Array>} outputReader
 * @property {import('@agentclientprotocol/sdk').AgentConnection} connection
 * @property {string[]} diagnostics
 */

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "../..");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** @returns {TestServerHandle} */
function startTestServer() {
    const input = new TransformStream();
    const output = new TransformStream();
    /** @type {string[]} */
    const diagnostics = [];
    const connection = startRunWieldAcpServer(input.readable, output.writable, {
        diagnostic: (message) => {
            diagnostics.push(message);
        },
    });
    return {
        inputWriter: input.writable.getWriter(),
        outputReader: output.readable.getReader(),
        connection,
        diagnostics,
    };
}

/**
 * @param {TestServerHandle} handle
 * @param {Record<string, unknown>} message
 */
async function sendMessage(handle, message) {
    await handle.inputWriter.write(encoder.encode(`${JSON.stringify(message)}\n`));
}

/** @param {TestServerHandle} handle */
async function readMessage(handle) {
    const chunk = await handle.outputReader.read();
    assert(!chunk.done, "server should write a message");
    const firstLine = decoder.decode(chunk.value).trim().split("\n")[0];
    return /** @type {Record<string, any>} */ (JSON.parse(firstLine));
}

/**
 * @param {TestServerHandle} handle
 * @param {Record<string, unknown>} message
 */
async function request(handle, message) {
    await sendMessage(handle, message);
    return await readMessage(handle);
}

/**
 * @param {TestServerHandle} handle
 * @param {string | number} requestId
 * @param {number} [limit]
 */
async function readThroughResponse(handle, requestId, limit = 80) {
    /** @type {Record<string, any>[]} */
    const messages = [];
    for (let index = 0; index < limit; index++) {
        const message = await readMessage(handle);
        messages.push(message);
        if (message.id === requestId) return { response: message, messages };
    }
    throw new Error(`ACP response ${requestId} was not received after ${limit} messages`);
}

/** @param {Record<string, any>[]} messages */
function joinedAgentText(messages) {
    return messages
        .filter((message) => message.params?.update?.sessionUpdate === "agent_message_chunk")
        .map((message) => String(message.params?.update?.content?.text || ""))
        .join("");
}

/** @param {TestServerHandle} handle */
async function closeTestServer(handle) {
    await handle.inputWriter.close();
    handle.connection.close();
    await handle.connection.closed;
    handle.outputReader.releaseLock();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {TestServerHandle} handle
 * @param {string} cwd
 */
async function createSession(handle, cwd) {
    const response = await request(handle, {
        jsonrpc: "2.0",
        id: "new",
        method: "session/new",
        params: { cwd, mcpServers: [] },
    });
    assert(response.result, JSON.stringify(response));
    return {
        sessionId: /** @type {string} */ (response.result.sessionId),
        persistedSessionId: /** @type {string} */ (response.result._meta.runwield.persistedSessionId),
    };
}

Deno.test("createInitializeResponse advertises only implemented ACP capabilities", () => {
    const response = createInitializeResponse({ protocolVersion: 1 });
    const capabilities = /** @type {any} */ (response.agentCapabilities);

    assertEquals(response.protocolVersion, 1);
    assertEquals(capabilities.promptCapabilities._meta.runwield.contentTypes, ["text", "resource_link"]);
    assertEquals(capabilities.loadSession, true);
    assertEquals(capabilities.sessionCapabilities.close, {});
    assertEquals(capabilities.sessionCapabilities._meta.runwield.implementedMethods, [
        "session/new",
        "session/load",
        "session/prompt",
        "session/cancel",
        "session/close",
    ]);
    assertEquals(response.authMethods, []);
    assertEquals(response.agentInfo?.name, "RunWield");
});

Deno.test("createInitializeResponse advertises Terminal Auth only to capable clients", () => {
    const terminalMethod = {
        id: "runwield-terminal-login",
        name: "RunWield Login",
        description: "Open a terminal to configure RunWield credentials and choose a default model.",
        type: "terminal",
        args: ["login"],
    };

    assertEquals(
        createInitializeResponse({ protocolVersion: 1, clientCapabilities: { auth: { terminal: true } } }).authMethods,
        [terminalMethod],
    );
    assertEquals(
        createInitializeResponse({ protocolVersion: 1, clientCapabilities: { _meta: { "terminal-auth": true } } })
            .authMethods,
        [terminalMethod],
    );
    assertEquals(createInitializeResponse({ protocolVersion: 1, clientCapabilities: {} }).authMethods, []);
    assertEquals(
        createInitializeResponse({ protocolVersion: 1, clientCapabilities: { auth: { terminal: false } } }).authMethods,
        [],
    );
    assertEquals(
        createInitializeResponse({ protocolVersion: 1, clientCapabilities: { terminal: true } }).authMethods,
        [],
    );
});

Deno.test("ACP server handles initialize without mixing diagnostics into protocol output", async () => {
    const handle = startTestServer();
    try {
        assertEquals(handle.diagnostics, ["RunWield ACP stdio server started"]);
        const response = await request(handle, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } },
        });
        assertEquals(response.id, 1);
        assertEquals(response.result.agentInfo.name, "RunWield");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP server returns structured errors for unimplemented session methods", async () => {
    const handle = startTestServer();
    try {
        const response = await request(handle, {
            jsonrpc: "2.0",
            id: "session-list",
            method: "session/list",
            params: {},
        });
        assertEquals(response.error.code, -32004);
        assertStringIncludes(response.error.message, "not implemented yet");
        assertEquals(response.error.data.phase, "session-runtime-acp-mvp");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("CLI --mode acp routes to ACP stdio without stdout diagnostics", async () => {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "src/cli.ts", "--mode", "acp"],
        cwd: REPO_ROOT,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(encoder.encode(`${
        JSON.stringify({
            jsonrpc: "2.0",
            id: 7,
            method: "initialize",
            params: { protocolVersion: 1, clientCapabilities: {} },
        })
    }\n`));
    await writer.close();

    const { code, stdout, stderr } = await child.output();
    const stdoutText = decoder.decode(stdout).trim();
    const response = JSON.parse(stdoutText);
    assertEquals(code, 0);
    assertEquals(response.result.agentInfo.name, "RunWield");
    assert(!stdoutText.includes("RunWield ACP"), "stdout should contain protocol JSON only");
    assertStringIncludes(decoder.decode(stderr), "RunWield ACP");
});

Deno.test("ACP session/new requires login and a usable default model", async () => {
    await withRuntimeCommandFixture("runwield-acp-auth-required-", async (fixture) => {
        const handle = startTestServer();
        try {
            const response = await request(handle, {
                jsonrpc: "2.0",
                id: "new-without-model",
                method: "session/new",
                params: { cwd: fixture.projectRoot, mcpServers: [] },
            });
            assertEquals(response.error.code, -32000);
            assertStringIncludes(response.error.message, "login and default model setup");
        } finally {
            await closeTestServer(handle);
        }
    }, { providerState: "none" });
});

Deno.test("ACP session/new and session/prompt exercise the real Runtime and stream canonical updates", async () => {
    await withRuntimeCommandFixture("runwield-acp-prompt-", async (fixture) => {
        fixture.setModelResponse("hello from the fixture model");
        const handle = startTestServer();
        try {
            const created = await createSession(handle, fixture.projectRoot);
            assertEquals(created.sessionId, `acp-${created.persistedSessionId}`);

            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "hi" }] },
            });
            const { response, messages } = await readThroughResponse(handle, "prompt");

            assert(messages.some((message) => message.params?.update?.sessionUpdate === "user_message_chunk"));
            assertStringIncludes(joinedAgentText(messages), "hello from the fixture model");
            assertEquals(response.result, { stopReason: "end_turn" });
        } finally {
            await closeTestServer(handle);
        }
    });
});

Deno.test("ACP session/prompt resolves Prompt Template invocations through Core", async () => {
    await withRuntimeCommandFixture("runwield-acp-named-invocation-", async (fixture) => {
        const promptDir = join(fixture.projectRoot, ".wld", "prompts");
        await Deno.mkdir(promptDir, { recursive: true });
        await Deno.writeTextFile(
            join(promptDir, "acp-template.md"),
            ["---", "agent: operator", "---", "ACP expanded request for {{input}}"].join("\n"),
        );
        /** @type {string[]} */
        const modelRequests = [];
        fixture.setModelResponseFactory((context) => {
            modelRequests.push(JSON.stringify(context.messages));
            return fauxAssistantMessage(fauxText("named ACP response"));
        });
        const handle = startTestServer();
        try {
            const created = await createSession(handle, fixture.projectRoot);
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "named-prompt",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "/acp-template evidence" }] },
            });
            const { response, messages } = await readThroughResponse(handle, "named-prompt");

            assertEquals(response.result, { stopReason: "end_turn" });
            assertStringIncludes(JSON.stringify(messages), "/acp-template evidence");
            assertStringIncludes(modelRequests[0] || "", "ACP expanded request for {{input}}\\n\\nevidence");
            assert(!modelRequests[0]?.includes("/acp-template evidence"));
            assertStringIncludes(joinedAgentText(messages), "named ACP response");
        } finally {
            await closeTestServer(handle);
        }
    });
});

Deno.test("ACP session/load replays a real persisted Session and accepts another prompt", async () => {
    await withRuntimeCommandFixture("runwield-acp-load-", async (fixture) => {
        fixture.setModelResponseFactories([
            () => fauxAssistantMessage(fauxText("first fixture response")),
            () => fauxAssistantMessage(fauxText("continued fixture response")),
        ]);

        const firstHandle = startTestServer();
        const created = await createSession(firstHandle, fixture.projectRoot);
        await sendMessage(firstHandle, {
            jsonrpc: "2.0",
            id: "first-prompt",
            method: "session/prompt",
            params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "persist me" }] },
        });
        await readThroughResponse(firstHandle, "first-prompt");
        await closeTestServer(firstHandle);

        const secondHandle = startTestServer();
        try {
            await sendMessage(secondHandle, {
                jsonrpc: "2.0",
                id: "load",
                method: "session/load",
                params: { sessionId: created.sessionId, cwd: fixture.projectRoot, mcpServers: [] },
            });
            const loaded = await readThroughResponse(secondHandle, "load");
            assert(
                loaded.messages.some((message) =>
                    message.method === "session/update" &&
                    message.params?.update?.sessionUpdate === "user_message_chunk"
                ),
                JSON.stringify(loaded.messages),
            );
            assert(
                loaded.messages.some((message) =>
                    message.method === "session/update" &&
                    message.params?.update?.sessionUpdate === "agent_message_chunk"
                ),
            );
            const stablePersistedSessionId = loaded.response.result._meta.runwield.persistedSessionId;
            assert(typeof stablePersistedSessionId === "string" && stablePersistedSessionId.length > 0);
            assert(stablePersistedSessionId !== created.persistedSessionId);

            await sendMessage(secondHandle, {
                jsonrpc: "2.0",
                id: "prompt-loaded",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "continue" }] },
            });
            const continued = await readThroughResponse(secondHandle, "prompt-loaded");
            assertEquals(continued.response.result.stopReason, "end_turn");
            assertStringIncludes(joinedAgentText(continued.messages), "continued fixture response");
        } finally {
            await closeTestServer(secondHandle);
        }
    });
});

Deno.test("ACP rejects overlapping prompts and cancels the real in-flight Runtime turn", async () => {
    await withRuntimeCommandFixture("runwield-acp-cancel-", async (fixture) => {
        fixture.setModelResponse("working ".repeat(1_000));
        const handle = startTestServer();
        try {
            const created = await createSession(handle, fixture.projectRoot);
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt-1",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "wait" }] },
            });

            let sawStreamingUpdate = false;
            while (!sawStreamingUpdate) {
                const message = await readMessage(handle);
                sawStreamingUpdate = message.method === "session/update";
            }

            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt-2",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "overlap" }] },
            });
            const overlap = await readThroughResponse(handle, "prompt-2");
            assertEquals(overlap.response.error.code, -32002);

            await sendMessage(handle, {
                jsonrpc: "2.0",
                method: "session/cancel",
                params: { sessionId: created.sessionId },
            });
            const cancelled = await readThroughResponse(handle, "prompt-1", 1_000);
            assertEquals(cancelled.response.result.stopReason, "cancelled");
        } finally {
            await closeTestServer(handle);
        }
    });
});

Deno.test("ACP session/close disposes a real Runtime session and rejects later prompts", async () => {
    await withRuntimeCommandFixture("runwield-acp-close-", async (fixture) => {
        const handle = startTestServer();
        try {
            const created = await createSession(handle, fixture.projectRoot);
            const closed = await request(handle, {
                jsonrpc: "2.0",
                id: "close",
                method: "session/close",
                params: { sessionId: created.sessionId },
            });
            assertEquals(closed.result._meta.runwield.closed, true);

            const afterClose = await request(handle, {
                jsonrpc: "2.0",
                id: "after-close",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "nope" }] },
            });
            assertEquals(afterClose.error.code, -32001);
        } finally {
            await closeTestServer(handle);
        }
    });
});

Deno.test("ACP validates new/load inputs and maps missing persisted Sessions", async () => {
    assertThrows(() => validateNewSessionParams({ cwd: "relative", mcpServers: [] }));
    assertThrows(() => validateNewSessionParams({ cwd: REPO_ROOT, mcpServers: { local: { command: "secret" } } }));

    await withRuntimeCommandFixture("runwield-acp-invalid-", async (fixture) => {
        const handle = startTestServer();
        try {
            const badCwd = await request(handle, {
                jsonrpc: "2.0",
                id: "bad-cwd",
                method: "session/load",
                params: { sessionId: "persisted-1", cwd: "relative", mcpServers: [] },
            });
            assertEquals(badCwd.error.code, -32602);

            const missing = await request(handle, {
                jsonrpc: "2.0",
                id: "missing",
                method: "session/load",
                params: { sessionId: "acp-missing", cwd: fixture.projectRoot, mcpServers: [] },
            });
            assertEquals(missing.error.code, -32001);
        } finally {
            await closeTestServer(handle);
        }
    });
});

Deno.test("ACP event mapper forwards canonical Runtime tool metadata", () => {
    const toolStart = mapRuntimeEventToAcpUpdate({
        type: "tool_start",
        sessionId: "session-1",
        timestamp: "now",
        toolCallId: "tool-1",
        toolName: "bash",
        title: "$ echo safe",
        kind: "execute",
        args: { token: "secret" },
    });
    const toolEnd = mapRuntimeEventToAcpUpdate({
        type: "tool_end",
        sessionId: "session-1",
        timestamp: "now",
        toolCallId: "tool-1",
        toolName: "bash",
        title: "$ echo safe",
        kind: "execute",
        content: [{ type: "text", text: "safe output" }],
        output: "safe output",
        details: { truncated: false },
        isError: false,
        durationMs: 25,
    });
    assertEquals(/** @type {any} */ (toolStart).rawInput, { token: "secret" });
    assertEquals(/** @type {any} */ (toolEnd)._meta?.runwield?.durationMs, 25);
});

Deno.test("ACP event mapper forwards structured validation progress", () => {
    const progress = /** @type {import('../shared/session/session-runtime-events.js').RuntimeValidationProgress} */ ({
        kind: "workflow",
        outcome: "paused",
        stage: "engineer_repair",
        cycle: 1,
        maxCycles: 3,
        totalCycle: 1,
        repairAttempt: 1,
        maxRepairAttempts: 3,
        checks: { ci: "failed", semanticReview: "pending", humanReview: "pending", merge: "pending" },
        message: "Awaiting Engineer continuation.",
    });
    const update = mapRuntimeEventToAcpUpdate({
        type: "system_status",
        sessionId: "session-1",
        timestamp: "now",
        messageId: "status-1",
        message: "Validation paused.",
        level: "warning",
        validationProgress: progress,
    });
    assertEquals(/** @type {any} */ (update)._meta?.runwield?.validationProgress, progress);
});

Deno.test("ACP production modules do not import TUI adapter code", async () => {
    /** @type {string[]} */
    const violations = [];
    for await (const entry of Deno.readDir(new URL(".", import.meta.url))) {
        if (!entry.isFile || !entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) continue;
        const path = `src/acp/${entry.name}`;
        const source = await Deno.readTextFile(path);
        if (/from\s+["'][^"']*(?:\/ui\/|shared\/interactive)/.test(source)) violations.push(path);
        if (/import\(["'][^"']*(?:\/ui\/|shared\/interactive)/.test(source)) violations.push(path);
    }
    assertEquals(violations, []);
});

Deno.test("ACP interaction adapter withholds Pair capability", async () => {
    /** @type {unknown[]} */
    const requests = [];
    const adapter = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: {
            request: (/** @type {unknown} */ request) => {
                requests.push(request);
                return Promise.resolve({ action: "accept", content: { answer: "continue" } });
            },
        },
    });
    assertEquals(adapter.supportsInteraction?.("pair_checkpoint"), false);
    assertEquals(
        await adapter.requestInteraction({
            id: "interaction-pair",
            type: "pair_checkpoint",
            prompt: "Review the increment",
        }),
        {
            outcome: "unsupported",
            message: "ACP does not support Pair Execution checkpoints.",
        },
    );
    assertEquals(requests, []);
});

Deno.test("ACP interaction adapter maps valid selections and rejects invalid ones", async () => {
    const accepted = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: { request: () => Promise.resolve({ action: "accept", content: { answer: "yes" } }) },
    });
    assertEquals(
        await accepted.requestInteraction({
            id: "interaction-1",
            type: "select",
            prompt: "Proceed?",
            options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
        }),
        { outcome: "selected", value: "yes", valueLabel: "Yes" },
    );

    const invalid = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: { request: () => Promise.resolve({ action: "accept", content: { answer: "invalid" } }) },
    });
    const response = await invalid.requestInteraction({
        id: "interaction-2",
        type: "select",
        prompt: "Proceed?",
        options: [{ value: "yes", label: "Yes" }],
    });
    assertEquals(response.outcome, "unsupported");
    assertEquals(response.message, "ACP elicitation returned invalid option: invalid");
});

Deno.test("ACP interaction adapter distinguishes approval acceptance from decline", async () => {
    const makeAdapter = (/** @type {string} */ answer) =>
        createAcpInteractionAdapter({
            acpSessionId: "acp-1",
            clientCapabilities: { elicitation: { form: {} } },
            context: { request: () => Promise.resolve({ action: "accept", content: { answer } }) },
        });
    const request = {
        id: "interaction-1",
        type: /** @type {'approval'} */ ("approval"),
        prompt: "Approve?",
        options: [{ value: "approve", label: "Approve" }, { value: "deny", label: "Deny" }],
    };
    assertEquals(await makeAdapter("approve").requestInteraction(request), {
        outcome: "accepted",
        value: true,
    });
    assertEquals(await makeAdapter("deny").requestInteraction(request), {
        outcome: "canceled",
        value: false,
        valueLabel: "Deny",
        message: "Approval was not accepted.",
    });
});

Deno.test("ACP interaction adapter returns unsupported without form capabilities", async () => {
    const adapter = createAcpInteractionAdapter({ acpSessionId: "acp-1", clientCapabilities: {}, context: {} });
    assertEquals((await adapter.requestInteraction({ type: "text", prompt: "Name?" })).outcome, "unsupported");
});

Deno.test("ACP event mapper maps Plan review links without maintainer secrets", () => {
    const update = mapRuntimeEventToAcpUpdate({
        type: "plan_review_link",
        sessionId: "s1",
        timestamp: "2026-07-07T00:00:00.000Z",
        messageId: "review-link-1",
        planName: "p",
        reviewerUrl: "https://plans.example/#key=review&cap=reviewer&role=reviewer",
        spaceId: "space-1",
        message: "review it",
    });
    assertEquals(update?.sessionUpdate, "agent_message_chunk");
    assertStringIncludes(JSON.stringify(update), "reviewer");
    assertEquals(JSON.stringify(update).includes("maintainer"), false);
});
