/**
 * @module acp/server.test
 * ACP protocol coverage over the real RunWield Session Runtime.
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { withRuntimeCommandFixture } from "../cmd/testing/runtime-command-fixture.ts";
import { openFileSessionStore } from "../shared/session/file-session-store.ts";
import { createRootSessionManager, resolveCreatedRootSessionPath } from "../shared/session/root-session.js";
import { VERSION } from "../shared/version.js";
import { mapRuntimeEventToAcpUpdate } from "./event-mapper.js";
import { createAcpInteractionAdapter } from "./interaction-mapper.js";
import { assertAcpFrameSchema, assertAcpSchema } from "./schema-conformance.ts";
import { AcpSessionMap } from "./session-map.js";
import {
    createInitializeResponse,
    mapEventWithSessionCost,
    startRunWieldAcpServer,
    validateNewSessionParams,
} from "./server.js";

/**
 * @typedef {Object} TestServerHandle
 * @property {WritableStreamDefaultWriter<Uint8Array>} inputWriter
 * @property {ReadableStreamDefaultReader<Uint8Array>} outputReader
 * @property {import('@agentclientprotocol/sdk').AgentConnection} connection
 * @property {string[]} diagnostics
 * @property {string[]} frames raw NDJSON lines the server wrote, in order
 * @property {Promise<void>} [heldResponseStarted]
 * @property {() => void} [releaseHeldResponse]
 */

/**
 * @typedef {Object} StartTestServerOptions
 * @property {string | number} [holdResponseId]
 */

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "../..");
const MCP_FIXTURE_SERVER = join(dirname(fromFileUrl(import.meta.url)), "../shared/mcp/fixture-server.ts");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TERMINAL_AUTH_METHOD = {
    id: "runwield-terminal-login",
    name: "RunWield Login",
    description: "Open a terminal to configure RunWield credentials and choose a default model.",
    type: "terminal",
    args: ["login"],
};
const ACP_REGISTRY_INITIALIZE_REQUEST = {
    jsonrpc: "2.0",
    id: "registry-initialize",
    method: "initialize",
    params: {
        protocolVersion: 1,
        clientCapabilities: { _meta: { "terminal-auth": true } },
        clientInfo: { name: "ACP Registry" },
    },
};

/**
 * @param {Uint8Array} chunk
 * @param {string | number} responseId
 */
function chunkIncludesResponseId(chunk, responseId) {
    return decoder.decode(chunk).split("\n").some((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        return JSON.parse(trimmed).id === responseId;
    });
}

/**
 * @param {string | number} responseId
 */
function createHeldOutput(responseId) {
    /** @type {PromiseWithResolvers<void>} */
    const heldResponseStarted = Promise.withResolvers();
    /** @type {PromiseWithResolvers<void>} */
    const releaseHeldResponse = Promise.withResolvers();
    /** @type {ReadableStreamDefaultController<Uint8Array> | null} */
    let outputController = null;
    let held = false;
    const readable = new ReadableStream({
        start(controller) {
            outputController = controller;
        },
    });
    const writable = new WritableStream({
        write(chunk) {
            if (!held && chunkIncludesResponseId(chunk, responseId)) {
                held = true;
                heldResponseStarted.resolve(undefined);
                return releaseHeldResponse.promise.then(() => outputController?.enqueue(chunk));
            }
            outputController?.enqueue(chunk);
        },
        close() {
            outputController?.close();
        },
        abort(reason) {
            outputController?.error(reason);
        },
    });
    return {
        readable,
        writable,
        heldResponseStarted: heldResponseStarted.promise,
        releaseHeldResponse: () => releaseHeldResponse.resolve(undefined),
    };
}

/**
 * @param {StartTestServerOptions} [options]
 * @returns {TestServerHandle}
 */
function startTestServer(options = {}) {
    const input = new TransformStream();
    /** @type {ReadableStream<Uint8Array>} */
    let outputReadable;
    /** @type {WritableStream<Uint8Array>} */
    let outputWritable;
    /** @type {Promise<void> | undefined} */
    let heldResponseStarted;
    /** @type {(() => void) | undefined} */
    let releaseHeldResponse;
    if (options.holdResponseId !== undefined) {
        const output = createHeldOutput(options.holdResponseId);
        outputReadable = output.readable;
        outputWritable = output.writable;
        heldResponseStarted = output.heldResponseStarted;
        releaseHeldResponse = output.releaseHeldResponse;
    } else {
        const output = new TransformStream();
        outputReadable = output.readable;
        outputWritable = output.writable;
    }
    /** @type {string[]} */
    const diagnostics = [];
    const connection = startRunWieldAcpServer(input.readable, outputWritable, {
        diagnostic: (message) => {
            diagnostics.push(message);
        },
    });
    return {
        inputWriter: input.writable.getWriter(),
        outputReader: outputReadable.getReader(),
        connection,
        diagnostics,
        frames: [],
        ...(heldResponseStarted ? { heldResponseStarted } : {}),
        ...(releaseHeldResponse ? { releaseHeldResponse } : {}),
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
    handle.frames.push(firstLine);
    return /** @type {Record<string, any>} */ (JSON.parse(firstLine));
}

/**
 * Raw NDJSON lines whose parsed message satisfies a predicate.
 *
 * Selection parses, but callers validate the original serialized text so the
 * assertion covers what a strict Client actually reads off the wire.
 *
 * @param {TestServerHandle} handle
 * @param {(message: Record<string, any>) => boolean} predicate
 */
function framesMatching(handle, predicate) {
    return handle.frames.filter((frame) => predicate(JSON.parse(frame)));
}

/**
 * @param {TestServerHandle} handle
 * @param {string} sessionUpdate
 */
function sessionUpdateFrames(handle, sessionUpdate) {
    return framesMatching(
        handle,
        (message) => message.method === "session/update" && message.params?.update?.sessionUpdate === sessionUpdate,
    );
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
    const frame = handle.frames.at(-1);
    assert(frame, "session/new response frame should be captured");
    assertAcpFrameSchema("NewSessionResponse", frame, (message) => message.result);
    return {
        sessionId: /** @type {string} */ (response.result.sessionId),
        persistedSessionId: /** @type {string} */ (response.result._meta.runwield.persistedSessionId),
    };
}

/**
 * @param {string} directory
 * @param {string} runwieldSessionId
 * @returns {Promise<string | null>}
 */
async function findManifestPath(directory, runwieldSessionId) {
    for await (const entry of Deno.readDir(directory)) {
        const path = join(directory, entry.name);
        if (entry.isDirectory) {
            const found = await findManifestPath(path, runwieldSessionId);
            if (found) return found;
            continue;
        }
        if (entry.name !== "manifest.json") continue;
        const manifest = JSON.parse(await Deno.readTextFile(path));
        if (manifest.runwieldSessionId === runwieldSessionId) return path;
    }
    return null;
}

/**
 * @param {ReturnType<typeof openFileSessionStore>} store
 * @param {string} runwieldSessionId
 */
async function forceActivationToRequireHydration(store, runwieldSessionId) {
    const path = await findManifestPath(store.path, runwieldSessionId);
    assert(path, `manifest not found for ${runwieldSessionId}`);
    const manifest = JSON.parse(await Deno.readTextFile(path));
    manifest.activation.state = "idle";
    await Deno.writeTextFile(path, `${JSON.stringify(manifest, null, 4)}\n`);
}

/** @param {string} cwd */
async function createIdleUngeneratedPersistedSession(cwd) {
    const store = openFileSessionStore();
    const manager = await createRootSessionManager("new", cwd);
    try {
        const project = store.ensureRuntimeProject({ root: cwd });
        const piSessionId = manager.getSessionId();
        assert(typeof piSessionId === "string" && piSessionId.length > 0);
        const transcriptPath = await resolveCreatedRootSessionPath(cwd, manager);
        manager.appendCustomEntry("runwield.active_agent", { agentName: "router" });
        manager.appendMessage({
            role: "user",
            timestamp: Date.now(),
            content: [{ type: "text", text: "load this session" }],
        });
        const acquired = await store.ensureSessionCatalogRecordAndAcquire({
            locator: {
                projectId: project.projectId,
                piSessionId,
                transcriptPath,
                transcriptCwd: cwd,
                source: "created",
            },
            activation: {
                ownerInstanceId: "acp-load-auth-test",
                ownerProcessKind: "test",
                phase: "preparing",
            },
        });
        store.releaseUnchangedActivation(acquired.proof);
        await forceActivationToRequireHydration(store, acquired.session.runwieldSessionId);
        return { piSessionId, transcriptPath };
    } finally {
        await Promise.resolve((/** @type {{ dispose?: () => void | Promise<void> }} */ (manager)).dispose?.());
        store.close();
    }
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
    assertEquals(
        createInitializeResponse({ protocolVersion: 1, clientCapabilities: { auth: { terminal: true } } }).authMethods,
        [TERMINAL_AUTH_METHOD],
    );
    assertEquals(
        createInitializeResponse({ protocolVersion: 1, clientCapabilities: { _meta: { "terminal-auth": true } } })
            .authMethods,
        [TERMINAL_AUTH_METHOD],
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

Deno.test("ACP server handles the registry initialize request with one Terminal Auth method", async () => {
    const handle = startTestServer();
    try {
        assertEquals(handle.diagnostics, ["RunWield ACP stdio server started"]);
        const response = await request(handle, ACP_REGISTRY_INITIALIZE_REQUEST);
        assertEquals(response.id, "registry-initialize");
        assertEquals(response.result.agentInfo.name, "RunWield");
        assertEquals(response.result.authMethods, [TERMINAL_AUTH_METHOD]);
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP initialize answers with the version RunWield speaks, not the one requested", async () => {
    const handle = startTestServer();
    try {
        for (const requested of [1, 99]) {
            const response = await request(handle, {
                jsonrpc: "2.0",
                id: `initialize-${requested}`,
                method: "initialize",
                params: { protocolVersion: requested, clientCapabilities: {} },
            });
            assertEquals(response.result.protocolVersion, 1, `requested ${requested}`);
        }
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP agentInfo reports the same build version as wld --version", async () => {
    const runCli = async (/** @type {string[]} */ args, /** @type {string} */ stdin) => {
        const child = new Deno.Command(Deno.execPath(), {
            args: ["run", "-A", "src/cli.ts", ...args],
            cwd: REPO_ROOT,
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        const writer = child.stdin.getWriter();
        if (stdin) await writer.write(encoder.encode(stdin));
        await writer.close();
        const { stdout } = await child.output();
        return decoder.decode(stdout).trim();
    };

    const versionOutput = await runCli(["--version"], "");
    const acpOutput = await runCli(["--mode", "acp"], `${JSON.stringify(ACP_REGISTRY_INITIALIZE_REQUEST)}\n`);

    const cliVersion = versionOutput.match(/^runwield (\S+) \(/)?.[1];
    const acpVersion = JSON.parse(acpOutput).result.agentInfo.version;

    assertEquals(cliVersion, VERSION, `--version printed ${versionOutput}`);
    assertEquals(acpVersion, VERSION);
    const oldMvpVersion = ["0.0.0", "acp", "mvp"].join("-");
    assert(VERSION && VERSION !== oldMvpVersion, `generated version should be real, got ${VERSION}`);
});

Deno.test("ACP initialize and prompt responses satisfy the published ACP schema", async () => {
    const handle = startTestServer();
    try {
        const response = await request(handle, ACP_REGISTRY_INITIALIZE_REQUEST);
        const initializeFrame = framesMatching(handle, (message) => message.id === "registry-initialize")[0];
        assert(initializeFrame, "initialize response frame should be captured");
        assertAcpFrameSchema("InitializeResponse", initializeFrame, (message) => message.result);
        const authFrame = JSON.stringify({
            jsonrpc: "2.0",
            id: "auth-method",
            result: JSON.parse(initializeFrame).result.authMethods[0],
        });
        assertAcpFrameSchema("AuthMethod", authFrame, (message) => message.result);
        assertAcpSchema("AuthMethod", response.result.authMethods[0]);
    } finally {
        await closeTestServer(handle);
    }

    assertAcpSchema("PromptResponse", { stopReason: "cancelled" });
    assertAcpSchema("PromptResponse", { stopReason: "end_turn" });
});

Deno.test("ACP schema checker rejects published numeric and map constraints", () => {
    assertThrows(() => assertAcpSchema("ProtocolVersion", 65_536), Error, "above maximum 65535");
    assertThrows(() => assertAcpSchema("RequestId", 1e100), Error, "format int64");
    assertThrows(
        () => assertAcpSchema("AuthMethodTerminal", { ...TERMINAL_AUTH_METHOD, env: { RUNWIELD_TOKEN: 1 } }),
        Error,
        "expected type string",
    );
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
    await writer.write(encoder.encode(`${JSON.stringify(ACP_REGISTRY_INITIALIZE_REQUEST)}\n`));
    await writer.close();

    const { code, stdout, stderr } = await child.output();
    const stdoutText = decoder.decode(stdout).trim();
    const response = JSON.parse(stdoutText);
    assertEquals(code, 0);
    assertEquals(response.result.agentInfo.name, "RunWield");
    assertEquals(response.result.authMethods, [TERMINAL_AUTH_METHOD]);
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

Deno.test("ACP session/new sends setup MCP warnings to the client", async () => {
    await withRuntimeCommandFixture("runwield-acp-mcp-warning-", async (fixture) => {
        const handle = startTestServer();
        try {
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "new-warning",
                method: "session/new",
                params: {
                    cwd: fixture.projectRoot,
                    mcpServers: [{
                        name: "dead",
                        command: "/definitely/not/runwield-mcp",
                        args: [],
                        env: [],
                    }],
                },
            });
            const { response, messages } = await readThroughResponse(handle, "new-warning");
            assert(response.result, JSON.stringify(response));
            const warningText = joinedAgentText(messages);
            assertStringIncludes(warningText, "MCP warning (spawn/dead)");
            assertStringIncludes(warningText, "MCP server failed");
            assertEquals(warningText.includes("/definitely/not"), false);
        } finally {
            await closeTestServer(handle);
        }
    });
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

Deno.test("ACP session/new and session/prompt can invoke a real MCP fixture tool", async () => {
    await withRuntimeCommandFixture("runwield-acp-mcp-call-", async (fixture) => {
        const logPath = await Deno.makeTempFile({ prefix: "runwield-acp-mcp-log-" });
        fixture.setModelResponseFactories([
            () => fauxAssistantMessage(fauxToolCall("mcp_fixture_fixture_echo", { marker: "acp-root" })),
            () => fauxAssistantMessage(fauxText("ACP MCP turn complete.")),
        ]);
        const handle = startTestServer();
        try {
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "new-mcp",
                method: "session/new",
                params: {
                    cwd: fixture.projectRoot,
                    mcpServers: [{
                        name: "fixture",
                        command: Deno.execPath(),
                        args: ["run", "-A", MCP_FIXTURE_SERVER],
                        env: [{ name: "RUNWIELD_MCP_FIXTURE_LOG", value: logPath }],
                    }],
                },
            });
            const created = await readThroughResponse(handle, "new-mcp");
            assert(created.response.result, JSON.stringify(created.response));
            const sessionId = created.response.result.sessionId;

            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt-mcp",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "Use MCP." }] },
            });
            const { response, messages } = await readThroughResponse(handle, "prompt-mcp");
            assertEquals(response.result, { stopReason: "end_turn" });
            assertStringIncludes(joinedAgentText(messages), "ACP MCP turn complete.");
            assertStringIncludes(await Deno.readTextFile(logPath), '"marker":"acp-root"');
        } finally {
            await closeTestServer(handle);
            await Deno.remove(logPath).catch(() => {});
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
        const logPath = await Deno.makeTempFile({ prefix: "runwield-acp-load-mcp-log-" });
        let sawLoadedMcpResultInTurn = false;
        fixture.setModelResponseFactories([
            () => fauxAssistantMessage(fauxText("first fixture response")),
            () => fauxAssistantMessage(fauxToolCall("mcp_fixture_fixture_echo", { marker: "acp-loaded" })),
            (context) => {
                sawLoadedMcpResultInTurn = JSON.stringify(context.messages).includes("fixture-result:acp-loaded");
                return fauxAssistantMessage(fauxText("continued fixture response"));
            },
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
                params: {
                    sessionId: created.sessionId,
                    cwd: fixture.projectRoot,
                    mcpServers: [{
                        name: "fixture",
                        command: Deno.execPath(),
                        args: ["run", "-A", MCP_FIXTURE_SERVER],
                        env: [{ name: "RUNWIELD_MCP_FIXTURE_LOG", value: logPath }],
                    }],
                },
            });
            const loaded = await readThroughResponse(secondHandle, "load");
            const loadFrame = framesMatching(secondHandle, (message) => message.id === "load")[0];
            assert(loadFrame, "session/load response frame should be captured");
            assertAcpFrameSchema("LoadSessionResponse", loadFrame, (message) => message.result);
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
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "continue with MCP" }] },
            });
            const continued = await readThroughResponse(secondHandle, "prompt-loaded");
            assertEquals(continued.response.result.stopReason, "end_turn");
            assertEquals(sawLoadedMcpResultInTurn, true);
            assertStringIncludes(joinedAgentText(continued.messages), "continued fixture response");
            assertStringIncludes(await Deno.readTextFile(logPath), '"marker":"acp-loaded"');
        } finally {
            await closeTestServer(secondHandle);
            await Deno.remove(logPath).catch(() => {});
        }
    });
});

Deno.test("ACP rejects overlapping prompts and cancels the real in-flight Runtime turn", async () => {
    await withRuntimeCommandFixture("runwield-acp-cancel-", async (fixture) => {
        fixture.setModelResponseFactories([
            () => fauxAssistantMessage(fauxText("working ".repeat(5_000))),
            () => fauxAssistantMessage(fauxText("turn after cancellation")),
        ]);
        const handle = startTestServer();
        try {
            const created = await createSession(handle, fixture.projectRoot);
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt-1",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "wait" }] },
            });

            // Wait for the agent to actually stream. A user_message_chunk arrives during turn
            // setup, before the agent session exists, and cancelling then has nothing to abort.
            let sawAgentStreaming = false;
            while (!sawAgentStreaming) {
                const message = await readMessage(handle);
                sawAgentStreaming = message.params?.update?.sessionUpdate === "agent_message_chunk" &&
                    String(message.params?.update?.content?.text || "").includes("working");
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
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt-3",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "while cancel settles" }] },
            });
            const settlingOverlap = await readThroughResponse(handle, "prompt-3");
            assertEquals(settlingOverlap.response.error.code, -32002);
            assertEquals(settlingOverlap.messages.some((message) => message.id === "prompt-1"), false);

            const cancelled = await readThroughResponse(handle, "prompt-1", 10_000);
            assertEquals(cancelled.response.result.stopReason, "cancelled");
            const cancelledFrame = framesMatching(handle, (message) => message.id === "prompt-1")[0];
            assert(cancelledFrame, "cancelled prompt response frame should be captured");
            assertAcpFrameSchema("PromptResponse", cancelledFrame, (message) => message.result);

            // The Runtime's own cancellation message is mapped like any other update, so it
            // has to reach the Client before the response that ends the turn. The overlap
            // request can read some of those pending updates before it gets its own error.
            const cancelSequence = [...settlingOverlap.messages, ...cancelled.messages];
            const promptResponseIndex = cancelSequence.findIndex((message) => message.id === "prompt-1");
            const cancellationIndex = cancelSequence.findIndex((message) =>
                message.method === "session/update" &&
                String(message.params?.update?.content?.text || "").includes("Agent run canceled.")
            );
            assert(
                cancellationIndex >= 0,
                `the Runtime cancellation message should be streamed: ${
                    JSON.stringify(cancelSequence.slice(-8).map((m) => [m.method, m.id, m.params?.update]))
                }`,
            );
            assertEquals(cancellationIndex < promptResponseIndex, true);
            assertEquals(cancelled.messages.at(-1)?.id, "prompt-1");

            // After the Client receives the cancelled response, the next prompt is accepted,
            // and nothing from the cancelled turn trails behind it.
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt-4",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "after cancel" }] },
            });
            const resumed = await readThroughResponse(handle, "prompt-4", 1_000);
            assertEquals(resumed.response.result.stopReason, "end_turn");
            assertStringIncludes(joinedAgentText(resumed.messages), "turn after cancellation");
        } finally {
            await closeTestServer(handle);
        }
    });
});

Deno.test("ACP rejects a prompt sent before the Client receives the cancelled response for request ID 0", async () => {
    await withRuntimeCommandFixture("runwield-acp-cancel-response-held-", async (fixture) => {
        fixture.setModelResponseFactories([
            () => fauxAssistantMessage(fauxText("working ".repeat(5_000))),
            () => fauxAssistantMessage(fauxText("should not run before cancelled response")),
        ]);
        const handle = startTestServer({ holdResponseId: 0 });
        assert(handle.heldResponseStarted);
        assert(handle.releaseHeldResponse);
        try {
            const created = await createSession(handle, fixture.projectRoot);
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: 0,
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "wait" }] },
            });

            let sawAgentStreaming = false;
            while (!sawAgentStreaming) {
                const message = await readMessage(handle);
                sawAgentStreaming = message.params?.update?.sessionUpdate === "agent_message_chunk" &&
                    String(message.params?.update?.content?.text || "").includes("working");
            }

            await sendMessage(handle, {
                jsonrpc: "2.0",
                method: "session/cancel",
                params: { sessionId: created.sessionId },
            });
            await handle.heldResponseStarted;

            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "prompt-2",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "too soon" }] },
            });
            handle.releaseHeldResponse();

            const overlap = await readThroughResponse(handle, "prompt-2", 10_000);
            const cancelled = overlap.messages.find((message) => message.id === 0);
            assertEquals(cancelled?.result?.stopReason, "cancelled");
            assertEquals(overlap.response.error.code, -32002);
        } finally {
            await closeTestServer(handle);
        }
    });
});

/**
 * A Runtime usage event carrying one message's cost, as the Runtime emits it.
 *
 * @param {number} costUsd
 */
function usageEvent(costUsd) {
    return /** @type {any} */ ({
        type: "usage",
        sessionId: "runtime-1",
        timestamp: "now",
        usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 100,
            costUsd,
        },
    });
}

Deno.test("ACP usage_update reports the Session's cumulative cost, not the last turn's", () => {
    const sessionMap = new AcpSessionMap();
    sessionMap.createRecord(/** @type {any} */ ({ sessionId: "runtime-1", cwd: "/repo" }), { acpSessionId: "acp-1" });

    // The Runtime prices each message on its own; ACP wants the running Session total.
    const notifications = [0.25, 0.25, 0.5].map((costUsd) =>
        mapEventWithSessionCost(sessionMap, "acp-1", usageEvent(costUsd))
    );

    assertEquals(notifications.map((notification) => /** @type {any} */ (notification).update.cost), [
        { amount: 0.25, currency: "USD" },
        { amount: 0.5, currency: "USD" },
        { amount: 1, currency: "USD" },
    ]);
    for (const notification of notifications) {
        assertAcpSchema("SessionNotification", JSON.parse(JSON.stringify(notification)));
    }
    const costedUsageFrame = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: notifications[2] });
    assertAcpFrameSchema("SessionNotification", costedUsageFrame, (message) => message.params);
});

Deno.test("ACP replayed usage events keep adding to the same Session total", () => {
    const sessionMap = new AcpSessionMap();
    sessionMap.createRecord(/** @type {any} */ ({ sessionId: "runtime-1", cwd: "/repo" }), { acpSessionId: "acp-1" });

    // session/load replays the transcript's priced turns before the next prompt runs.
    for (const costUsd of [0.25, 0.25]) mapEventWithSessionCost(sessionMap, "acp-1", usageEvent(costUsd));
    sessionMap.replaceRuntimeSession("acp-1", { sessionId: "runtime-2", cwd: "/repo" });
    const afterLoad = mapEventWithSessionCost(sessionMap, "acp-1", usageEvent(0.25));

    assertEquals(/** @type {any} */ (afterLoad).update.cost, { amount: 0.75, currency: "USD" });
});

Deno.test("ACP non-usage events do not disturb the Session cost total", () => {
    const sessionMap = new AcpSessionMap();
    sessionMap.createRecord(/** @type {any} */ ({ sessionId: "runtime-1", cwd: "/repo" }), { acpSessionId: "acp-1" });

    mapEventWithSessionCost(sessionMap, "acp-1", usageEvent(0.25));
    mapEventWithSessionCost(
        sessionMap,
        "acp-1",
        /** @type {any} */ ({
            type: "assistant_text_delta",
            sessionId: "runtime-1",
            timestamp: "now",
            messageId: "m1",
            delta: "hello",
        }),
    );

    assertEquals(sessionMap.getRecord("acp-1")?.usageCostUsd, 0.25);
});

Deno.test("ACP streams schema-valid usage updates from a real Runtime turn", async () => {
    await withRuntimeCommandFixture("runwield-acp-usage-", async (fixture) => {
        fixture.setModelResponse("a free fixture turn");
        const handle = startTestServer();
        try {
            const created = await createSession(handle, fixture.projectRoot);
            await sendMessage(handle, {
                jsonrpc: "2.0",
                id: "usage-prompt",
                method: "session/prompt",
                params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "hi" }] },
            });
            await readThroughResponse(handle, "usage-prompt");

            const frames = sessionUpdateFrames(handle, "usage_update");
            assert(frames.length > 0, "a real turn should report usage");
            for (const frame of frames) {
                const update = JSON.parse(frame).params.update;
                assertAcpFrameSchema("SessionNotification", frame, (message) => message.params);
                // The fixture model is free, so the Session total stays 0 and cost stays off the wire.
                assertEquals(Object.hasOwn(update, "cost"), false);
            }
        } finally {
            await closeTestServer(handle);
        }
    });
});

Deno.test("ACP usage_update omits cost while the Session has no priced turn", () => {
    const usageEvent = /** @type {any} */ ({
        type: "usage",
        sessionId: "session-1",
        timestamp: "now",
        usage: { inputTokens: 10, contextWindow: 100, costUsd: 0 },
    });

    const withoutCost = mapRuntimeEventToAcpUpdate(usageEvent, 0);
    assertEquals(withoutCost, { sessionUpdate: "usage_update", used: 10, size: 100 });
    assertEquals(Object.hasOwn(/** @type {any} */ (withoutCost), "cost"), false);

    assertEquals(/** @type {any} */ (mapRuntimeEventToAcpUpdate(usageEvent, 0.25)).cost, {
        amount: 0.25,
        currency: "USD",
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
    assertThrows(() => validateNewSessionParams({ cwd: REPO_ROOT }));
    assertThrows(() => validateNewSessionParams({ cwd: REPO_ROOT, mcpServers: { local: { command: "secret" } } }));
    assertThrows(() =>
        validateNewSessionParams({
            cwd: REPO_ROOT,
            mcpServers: [{ type: "http", name: "web", url: "https://example.test", headers: [] }],
        })
    );
    assertThrows(() =>
        validateNewSessionParams({
            cwd: REPO_ROOT,
            mcpServers: [{ name: "stdio", command: "/bin/echo", args: ["ok"] }],
        })
    );
    const validMcp = validateNewSessionParams({
        cwd: REPO_ROOT,
        mcpServers: [{ name: "stdio", command: "/bin/echo", args: ["ok"], env: [{ name: "TOKEN", value: "secret" }] }],
    });
    assertEquals(validMcp.runwieldMcpServers, [{
        name: "stdio",
        command: "/bin/echo",
        args: ["ok"],
        env: { TOKEN: "secret" },
        source: "request",
    }]);

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

Deno.test("ACP session/load maps a persisted Session with no configured model to authentication required", async () => {
    await withRuntimeCommandFixture("runwield-acp-load-no-model-", async (fixture) => {
        const persisted = await createIdleUngeneratedPersistedSession(fixture.projectRoot);
        const handle = startTestServer();
        try {
            const response = await request(handle, {
                jsonrpc: "2.0",
                id: "load-auth-required",
                method: "session/load",
                params: {
                    sessionId: persisted.piSessionId,
                    cwd: fixture.projectRoot,
                    mcpServers: [],
                    _meta: { runwield: { sessionPath: persisted.transcriptPath } },
                },
            });
            assertEquals(response.error.code, -32000);
            assertStringIncludes(response.error.message, "login and default model setup");
        } finally {
            await closeTestServer(handle);
        }
    }, { providerState: "none" });
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
