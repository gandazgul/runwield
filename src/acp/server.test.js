/**
 * @module acp/server.test
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { SessionTurnInProgressError } from "../shared/session/session-runtime.js";
import { createSessionRuntimeEvent } from "../shared/session/session-runtime-events.js";
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

/**
 * @typedef {Object} FakePromptTurnContext
 * @property {string} turnId
 */

/**
 * @typedef {Object} FakePromptOptions
 * @property {string} initialRequest
 * @property {(context: FakePromptTurnContext) => void | (() => void)} [onTurnStarted]
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @returns {TestServerHandle}
 */
function startTestServer(options = {}) {
    const input = new TransformStream();
    const output = new TransformStream();
    /** @type {string[]} */
    const diagnostics = [];
    const connection = startRunWieldAcpServer(input.readable, output.writable, {
        ...options,
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
 * @returns {Promise<Record<string, any>>}
 */
async function request(handle, message) {
    await handle.inputWriter.write(encoder.encode(`${JSON.stringify(message)}\n`));
    const chunk = await handle.outputReader.read();
    assert(!chunk.done, "server should write a response");
    return JSON.parse(decoder.decode(chunk.value));
}

/**
 * @param {TestServerHandle} handle
 * @returns {Promise<void>}
 */
async function closeTestServer(handle) {
    await handle.inputWriter.close();
    handle.connection.close();
    await handle.connection.closed;
    handle.outputReader.releaseLock();
}

Deno.test("createInitializeResponse advertises only safe MVP capabilities", () => {
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
    assertEquals(capabilities.sessionCapabilities._meta.runwield.updateNotifications, ["session/update"]);
    assertEquals(response.authMethods, []);
    assertEquals(response.agentInfo?.name, "RunWield");
});

Deno.test("ACP server handles initialize", async () => {
    const handle = startTestServer();
    try {
        const response = await request(handle, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "test" } },
        });

        assertEquals(response.id, 1);
        assertEquals(response.result.protocolVersion, 1);
        assertEquals(response.result.agentCapabilities.sessionCapabilities._meta.runwield.updateNotifications, [
            "session/update",
        ]);
        assertEquals(response.result.authMethods, []);
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

        assertEquals(response.id, "session-list");
        assertEquals(response.error.code, -32004);
        assertStringIncludes(response.error.message, "not implemented yet");
        assertEquals(response.error.data.method, "session/list");
        assertEquals(response.error.data.phase, "session-runtime-acp-mvp");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP server shutdown disposes mapped sessions without stdout diagnostics", async () => {
    const runtime = makeFakeRuntime();
    let closeAllCount = 0;
    runtime.closeAllSessions = () => {
        closeAllCount++;
        return { ok: true, closed: 0 };
    };
    const handle = startTestServer({ runtime });
    try {
        await request(handle, {
            jsonrpc: "2.0",
            id: "new-before-shutdown",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
    } finally {
        await closeTestServer(handle);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(closeAllCount, 1);
});

Deno.test("ACP server diagnostics stay out of protocol output", async () => {
    const handle = startTestServer();
    try {
        assertEquals(handle.diagnostics, ["RunWield ACP stdio server started"]);
        const response = await request(handle, {
            jsonrpc: "2.0",
            id: 2,
            method: "initialize",
            params: { protocolVersion: 1, clientCapabilities: {} },
        });

        assertEquals(response.id, 2);
        assertEquals(response.result.agentInfo.name, "RunWield");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("CLI --mode acp routes to ACP stdio without stdout diagnostics", async () => {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "src/cli.js", "--mode", "acp"],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    const writer = child.stdin.getWriter();
    await writer.write(encoder.encode(
        `${
            JSON.stringify({
                jsonrpc: "2.0",
                id: 7,
                method: "initialize",
                params: { protocolVersion: 1, clientCapabilities: {} },
            })
        }\n`,
    ));
    await writer.close();

    const { code, stdout, stderr } = await child.output();
    const stdoutText = decoder.decode(stdout).trim();
    const stderrText = decoder.decode(stderr);
    const response = JSON.parse(stdoutText);

    assertEquals(code, 0);
    assertEquals(response.id, 7);
    assertEquals(response.result.agentInfo.name, "RunWield");
    assert(!stdoutText.includes("RunWield ACP"), "stdout should contain protocol JSON only");
    assertStringIncludes(stderrText, "RunWield ACP");
});

/**
 * @param {TestServerHandle} handle
 * @returns {Promise<Record<string, any>>}
 */
async function readMessage(handle) {
    const chunk = await handle.outputReader.read();
    assert(!chunk.done, "server should write a message");
    const text = decoder.decode(chunk.value).trim();
    const firstLine = text.split("\n")[0];
    return JSON.parse(firstLine);
}

/** @returns {any} */
function makeFakeRuntime() {
    const sessions = new Map();
    const listeners = new Map();
    let nextId = 1;
    return {
        /** @param {{ cwd: string }} options */
        createPromptReadySession({ cwd }) {
            const sessionId = `fake-${nextId++}`;
            sessions.set(sessionId, { sessionId, cwd, sessionManagerId: sessionId });
            return Promise.resolve(sessionId);
        },
        /** @param {string} id */
        getSessionSnapshot(id) {
            return sessions.get(id) || null;
        },
        /** @param {string} sessionId @param {(event: any) => void} listener */
        subscribeSessionEvents(sessionId, listener) {
            let set = listeners.get(sessionId);
            if (!set) {
                set = new Set();
                listeners.set(sessionId, set);
            }
            set.add(listener);
            return () => set.delete(listener);
        },
        /** @param {string} sessionId @param {Record<string, unknown>} event */
        emit(sessionId, event) {
            const set = listeners.get(sessionId) || new Set();
            for (const listener of set) {
                listener(createSessionRuntimeEvent(sessionId, /** @type {any} */ (event)));
            }
        },
        /** @param {string} sessionId @param {FakePromptOptions} options */
        promptSession(sessionId, options) {
            const cleanup = options.onTurnStarted?.({ turnId: "turn-1" });
            this.emit(sessionId, { type: "user_message", text: options.initialRequest, turnId: "turn-1" });
            this.emit(sessionId, {
                type: "assistant_text_delta",
                delta: "hello",
                agentName: "Guide",
                messageKind: "assistant",
                turnId: "turn-1",
            });
            return Promise.resolve({ ok: true, turns: 1, handoffs: 0, handoffLimitReached: false }).finally(() => {
                cleanup?.();
            });
        },
        /** @param {string} sessionId */
        cancelSession(sessionId) {
            this.emit(sessionId, { type: "cancellation", reason: "session_cancel", aborted: true });
            return { ok: true, aborted: true };
        },
        setInteractionAdapter() {
            return { ok: true };
        },
        /** @param {string} id */
        closeSession(id) {
            const closed = sessions.delete(id);
            listeners.delete(id);
            return { ok: true, closed };
        },
        closeAllSessions() {
            const closed = sessions.size;
            sessions.clear();
            listeners.clear();
            return { ok: true, closed };
        },
        /** @param {{ cwd: string, sessionId: string }} options */
        loadSession(options) {
            const sessionId = `fake-loaded-${nextId++}`;
            sessions.set(sessionId, { sessionId, cwd: options.cwd, sessionManagerId: options.sessionId });
            return Promise.resolve({
                sessionId,
                cwd: options.cwd,
                sessionManagerId: options.sessionId,
                sessionPath: `/sessions/${options.sessionId}.jsonl`,
                replayEvents: [
                    {
                        type: "user_message",
                        sessionId,
                        timestamp: "2026-07-08T00:00:00.000Z",
                        messageId: "entry-user",
                        text: "loaded user",
                        images: [],
                        _meta: { replay: true, entryId: "entry-user", entryType: "message", role: "user" },
                    },
                    {
                        type: "assistant_text_delta",
                        sessionId,
                        timestamp: "2026-07-08T00:00:01.000Z",
                        messageId: "entry-assistant",
                        delta: "loaded assistant",
                        agentName: "Guide",
                        messageKind: "assistant",
                        _meta: { replay: true, entryId: "entry-assistant", entryType: "message", role: "assistant" },
                    },
                ],
            });
        },
    };
}

Deno.test("ACP initialize advertises implemented MVP prompt/session capabilities only", () => {
    const response = createInitializeResponse({ protocolVersion: 1 });

    const capabilities = /** @type {any} */ (response.agentCapabilities);
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
    assertEquals(capabilities.sessionCapabilities._meta.runwield.updateNotifications, ["session/update"]);
});

Deno.test("ACP server clears per-prompt interaction adapter after prompt settles", async () => {
    const runtime = makeFakeRuntime();
    /** @type {unknown[]} */
    const adapterCalls = [];
    runtime.setInteractionAdapter = (
        /** @type {string} */ _sessionId,
        /** @type {unknown} */ adapter,
    ) => {
        adapterCalls.push(adapter);
        return { ok: true };
    };
    const handle = startTestServer({ runtime });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: 20,
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        assert(newResponse.result, JSON.stringify(newResponse));
        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: 21,
                method: "session/prompt",
                params: { sessionId: newResponse.result.sessionId, prompt: [{ type: "text", text: "hello" }] },
            })
        }\n`));
        for (let i = 0; i < 4; i++) {
            const message = await readMessage(handle);
            if (message.id === 21) break;
        }

        assertEquals(adapterCalls.length, 2);
        assert(adapterCalls[0]);
        assertEquals(adapterCalls[1], null);
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP server ends prompt when interaction adapter setup fails", async () => {
    const runtime = makeFakeRuntime();
    let setupAttempts = 0;
    runtime.setInteractionAdapter = (
        /** @type {unknown} */ _session,
        /** @type {unknown} */ adapter,
        /** @type {unknown} */ _meta,
    ) => {
        if (adapter) {
            setupAttempts++;
            if (setupAttempts === 1) throw new Error("adapter setup failed");
        }
        return { ok: true };
    };
    const handle = startTestServer({ runtime });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;

        const failed = await request(handle, {
            jsonrpc: "2.0",
            id: "prompt-fails-during-adapter-setup",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "text", text: "first" }] },
        });
        assertEquals(failed.error.code, -32603);

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt-after-adapter-setup-failure",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "second" }] },
            })
        }\n`));
        /** @type {Record<string, any> | null} */
        let response = null;
        for (let i = 0; i < 4 && !response; i++) {
            const message = await readMessage(handle);
            if (message.id === "prompt-after-adapter-setup-failure") response = message;
        }

        assertEquals(response?.result.stopReason, "end_turn");
        assertEquals(setupAttempts, 2);
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP server ends prompt when interaction adapter cleanup fails", async () => {
    const runtime = makeFakeRuntime();
    runtime.promptSession = (
        /** @type {string} */ _sessionId,
        /** @type {FakePromptOptions} */ options,
    ) => {
        const cleanup = options.onTurnStarted?.({ turnId: "turn-1" });
        return Promise.resolve({ ok: true, turns: 1, handoffs: 0, handoffLimitReached: false }).finally(() => {
            cleanup?.();
        });
    };
    let cleanupAttempts = 0;
    runtime.setInteractionAdapter = (
        /** @type {unknown} */ _session,
        /** @type {unknown} */ adapter,
        /** @type {unknown} */ _meta,
    ) => {
        if (!adapter) {
            cleanupAttempts++;
            if (cleanupAttempts === 1) throw new Error("adapter cleanup failed");
        }
        return { ok: true };
    };
    const handle = startTestServer({ runtime });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;

        const failed = await request(handle, {
            jsonrpc: "2.0",
            id: "prompt-fails-during-adapter-cleanup",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "text", text: "first" }] },
        });
        assertEquals(failed.error.code, -32603);

        const next = await request(handle, {
            jsonrpc: "2.0",
            id: "prompt-after-adapter-cleanup-failure",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "text", text: "second" }] },
        });

        assertEquals(next.result.stopReason, "end_turn");
        assertEquals(cleanupAttempts, 2);
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP session/load replays updates before load response and loaded session accepts prompts", async () => {
    const handle = startTestServer({ runtime: makeFakeRuntime() });
    try {
        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "load",
                method: "session/load",
                params: { sessionId: "persisted-1", cwd: Deno.cwd(), mcpServers: [] },
            })
        }\n`));

        const first = await readMessage(handle);
        const second = await readMessage(handle);
        const third = await readMessage(handle);
        assertEquals(first.method, "session/update");
        assertEquals(first.params.sessionId, "persisted-1");
        assertEquals(first.params.update.sessionUpdate, "user_message_chunk");
        assertEquals(first.params.update._meta.runwield.replay, true);
        assertEquals(second.method, "session/update");
        assertEquals(second.params.update.sessionUpdate, "agent_message_chunk");
        assertEquals(third.id, "load");
        assertEquals(third.result._meta.runwield.persistedSessionId, "persisted-1");

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt-loaded",
                method: "session/prompt",
                params: { sessionId: "persisted-1", prompt: [{ type: "text", text: "continue" }] },
            })
        }\n`));
        /** @type {Record<string, any> | null} */
        let response = null;
        for (let i = 0; i < 4 && !response; i++) {
            const message = await readMessage(handle);
            if (message.id === "prompt-loaded") response = message;
        }
        assertEquals(response?.result.stopReason, "end_turn");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP session/load accepts ACP-facing session ids from earlier session/new responses", async () => {
    const runtime = makeFakeRuntime();
    /** @type {string[]} */
    const loadedIds = [];
    const originalLoadSession = runtime.loadSession.bind(runtime);
    runtime.loadSession = (/** @type {{ cwd: string, sessionId: string }} */ options) => {
        loadedIds.push(options.sessionId);
        return originalLoadSession(options);
    };
    const handle = startTestServer({ runtime });
    try {
        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "load-acp-id",
                method: "session/load",
                params: { sessionId: "acp-persisted-1", cwd: Deno.cwd(), mcpServers: [] },
            })
        }\n`));

        const first = await readMessage(handle);
        const second = await readMessage(handle);
        const third = await readMessage(handle);
        assertEquals(loadedIds, ["persisted-1"]);
        assertEquals(first.params.sessionId, "acp-persisted-1");
        assertEquals(second.params.sessionId, "acp-persisted-1");
        assertEquals(third.id, "load-acp-id");
        assertEquals(third.result._meta.runwield.persistedSessionId, "persisted-1");

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt-loaded-acp-id",
                method: "session/prompt",
                params: { sessionId: "acp-persisted-1", prompt: [{ type: "text", text: "continue" }] },
            })
        }\n`));
        /** @type {Record<string, any> | null} */
        let response = null;
        for (let i = 0; i < 4 && !response; i++) {
            const message = await readMessage(handle);
            if (message.id === "prompt-loaded-acp-id") response = message;
        }
        assertEquals(response?.result.stopReason, "end_turn");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP session/load validates params and maps unknown persisted sessions", async () => {
    const runtime = makeFakeRuntime();
    runtime.loadSession = () => Promise.reject(new Error("Persisted session not found for cwd"));
    const handle = startTestServer({ runtime });
    try {
        const badCwd = await request(handle, {
            jsonrpc: "2.0",
            id: "bad-cwd",
            method: "session/load",
            params: { sessionId: "persisted-1", cwd: "relative", mcpServers: [] },
        });
        assertEquals(badCwd.error.code, -32602);

        const badMeta = await request(handle, {
            jsonrpc: "2.0",
            id: "bad-meta",
            method: "session/load",
            params: {
                sessionId: "persisted-1",
                cwd: Deno.cwd(),
                mcpServers: [],
                _meta: { runwield: { sessionPath: 1 } },
            },
        });
        assertEquals(badMeta.error.code, -32602);

        const missing = await request(handle, {
            jsonrpc: "2.0",
            id: "missing",
            method: "session/load",
            params: { sessionId: "missing", cwd: Deno.cwd(), mcpServers: [] },
        });
        assertEquals(missing.error.code, -32001);
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP session/close disposes sessions and rejects later prompts", async () => {
    const runtime = makeFakeRuntime();
    const handle = startTestServer({ runtime });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new-close",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;
        const closed = await request(handle, {
            jsonrpc: "2.0",
            id: "close",
            method: "session/close",
            params: { sessionId },
        });
        assertEquals(closed.result._meta.runwield.closed, true);

        const afterClose = await request(handle, {
            jsonrpc: "2.0",
            id: "after-close",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "text", text: "nope" }] },
        });
        assertEquals(afterClose.error.code, -32001);
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP session/close cancels an active prompt", async () => {
    const runtime = makeFakeRuntime();
    let promptStarted = false;
    runtime.promptSession = (
        /** @type {string} */ _sessionId,
        /** @type {FakePromptOptions} */ options,
    ) => {
        options.onTurnStarted?.({ turnId: "turn-1" });
        promptStarted = true;
        return new Promise(() => {});
    };
    const handle = startTestServer({ runtime });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new-active-close",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;
        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt-active-close",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "wait" }] },
            })
        }\n`));
        while (!promptStarted) await new Promise((resolve) => setTimeout(resolve, 0));
        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "close-active",
                method: "session/close",
                params: { sessionId },
            })
        }\n`));

        /** @type {Record<string, any> | null} */
        let promptResponse = null;
        /** @type {Record<string, any> | null} */
        let closeResponse = null;
        for (let i = 0; i < 4 && (!promptResponse || !closeResponse); i++) {
            const message = await readMessage(handle);
            if (message.id === "prompt-active-close") promptResponse = message;
            if (message.id === "close-active") closeResponse = message;
        }
        assertEquals(promptResponse?.result.stopReason, "cancelled");
        assertEquals(closeResponse?.result._meta.runwield.closed, true);
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP server creates sessions and streams prompt updates", async () => {
    const handle = startTestServer({ runtime: makeFakeRuntime() });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;
        assertStringIncludes(sessionId, "acp-fake-");

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "hi" }] },
            })
        }\n`));

        const first = await readMessage(handle);
        const second = await readMessage(handle);
        const third = await readMessage(handle);
        const messages = [first, second, third];

        assert(messages.some((message) => message.method === "session/update"));
        assert(messages.some((message) => message.params?.update?.sessionUpdate === "user_message_chunk"));
        assert(messages.some((message) => message.params?.update?.sessionUpdate === "agent_message_chunk"));
        assertEquals(/** @type {any} */ (messages.at(-1)).result, { stopReason: "end_turn" });
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP server rejects invalid new prompt and overlap inputs", async () => {
    const blockingRuntime = makeFakeRuntime();
    let releasePrompt = /** @type {(() => void) | null} */ (null);
    let promptActive = false;
    let promptCalls = 0;
    blockingRuntime.promptSession = (
        /** @type {string} */ sessionId,
        /** @type {FakePromptOptions} */ options,
    ) => {
        promptCalls++;
        if (promptActive) return Promise.reject(new SessionTurnInProgressError(sessionId));
        promptActive = true;
        const turnId = `turn-${promptCalls}`;
        const cleanup = options.onTurnStarted?.({ turnId });
        return new Promise((resolve) => {
            releasePrompt = () => {
                promptActive = false;
                cleanup?.();
                resolve({ ok: true, turns: 1, handoffs: 0, handoffLimitReached: false });
            };
            blockingRuntime.emit(sessionId, {
                type: "assistant_text_delta",
                delta: "working",
                agentName: "Guide",
                messageKind: "assistant",
                turnId: "turn-1",
            });
        });
    };
    const handle = startTestServer({ runtime: blockingRuntime });
    try {
        const relative = await request(handle, {
            jsonrpc: "2.0",
            id: "bad-new",
            method: "session/new",
            params: { cwd: "relative", mcpServers: [] },
        });
        assertEquals(relative.error.code, -32602);

        const objectMcpServersError = assertThrows(() =>
            validateNewSessionParams({ cwd: Deno.cwd(), mcpServers: { local: { command: "secret" } } })
        );
        assertEquals(/** @type {any} */ (objectMcpServersError).code, -32602);

        const objectAdditionalDirectoriesError = assertThrows(() =>
            validateNewSessionParams({ cwd: Deno.cwd(), additionalDirectories: { docs: Deno.cwd() } })
        );
        assertEquals(/** @type {any} */ (objectAdditionalDirectoriesError).code, -32602);

        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt-1",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "wait" }] },
            })
        }\n`));
        await readMessage(handle); // streamed update from prompt-1

        const overlap = await request(handle, {
            jsonrpc: "2.0",
            id: "prompt-2",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "text", text: "again" }] },
        });
        assertEquals(overlap.error.code, -32002);
        assertEquals(promptCalls, 2, "overlapping prompts must be rejected by the runtime");

        const invalidOverlap = await request(handle, {
            jsonrpc: "2.0",
            id: "prompt-invalid-overlap",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "image", data: "x", mimeType: "image/png" }] },
        });
        assertEquals(invalidOverlap.error.code, -32602);
        assertEquals(promptCalls, 2, "invalid ACP input must not reach the runtime");

        releasePrompt?.();
        const done = await readMessage(handle);
        assertEquals(done.id, "prompt-1");
        assertEquals(done.result.stopReason, "end_turn");

        const unsupported = await request(handle, {
            jsonrpc: "2.0",
            id: "bad-content",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "image", data: "x", mimeType: "image/png" }] },
        });
        assertEquals(unsupported.error.code, -32602);

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "after-bad-content",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "still works" }] },
            })
        }\n`));
        await readMessage(handle); // streamed update proves prompt was accepted instead of rejected as overlap
        releasePrompt?.();
        const afterUnsupported = await readMessage(handle);
        assertEquals(afterUnsupported.id, "after-bad-content");
        assertEquals(afterUnsupported.result.stopReason, "end_turn");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP session/cancel keeps the turn reserved when runtime abort throws", async () => {
    const runtime = makeFakeRuntime();
    /** @type {any} */
    let activeSession = null;
    let promptCount = 0;
    let promptActive = false;
    runtime.promptSession = (
        /** @type {string} */ sessionId,
        /** @type {FakePromptOptions} */ options,
    ) => {
        promptCount++;
        if (promptActive) return Promise.reject(new SessionTurnInProgressError(sessionId));
        promptActive = true;
        activeSession = sessionId;
        options.onTurnStarted?.({ turnId: "turn-1" });
        return new Promise(() => {});
    };
    runtime.cancelSession = () => {
        throw new Error("abort failed");
    };

    const handle = startTestServer({ runtime });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "long" }] },
            })
        }\n`));
        while (!activeSession) await new Promise((resolve) => setTimeout(resolve, 0));
        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                method: "session/cancel",
                params: { sessionId },
            })
        }\n`));

        /** @type {Record<string, any> | null} */
        let response = null;
        let sawCancellationUpdate = false;
        for (let i = 0; i < 3 && !response; i++) {
            const message = await readMessage(handle);
            if (message.method === "session/update") {
                sawCancellationUpdate ||= message.params?.update?.sessionUpdate === "agent_message_chunk" &&
                    message.params?.update?._meta?.runwield?.type === "cancellation";
            } else if (message.id === "prompt") {
                response = message;
            }
        }
        assertEquals(sawCancellationUpdate, false, "ACP must not fabricate Runtime cancellation events");
        assertEquals(response?.result.stopReason, "cancelled");

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "after-cancel",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "after cancel" }] },
            })
        }\n`));
        /** @type {Record<string, any> | null} */
        let afterCancel = null;
        for (let i = 0; i < 4 && !afterCancel; i++) {
            const message = await readMessage(handle);
            if (message.id === "after-cancel") afterCancel = message;
        }
        assertEquals(afterCancel?.error.code, -32002);
        assertEquals(promptCount, 2, "the runtime must retain the turn reservation after failed cancellation");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP event mapper forwards the complete canonical Runtime tool descriptor and result", () => {
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
    const toolUpdate = mapRuntimeEventToAcpUpdate({
        type: "tool_update",
        sessionId: "session-1",
        timestamp: "now",
        toolCallId: "tool-1",
        toolName: "bash",
        title: "$ echo safe",
        kind: "execute",
        content: [{ type: "text", text: "safe output" }],
        output: "safe output",
        details: { truncated: false },
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
    assertEquals(/** @type {any} */ (toolStart).kind, "execute");
    assertEquals(/** @type {any} */ (toolUpdate).content, [
        { type: "content", content: { type: "text", text: "safe output" } },
    ]);
    assertEquals(/** @type {any} */ (toolEnd).rawOutput, {
        content: [{ type: "text", text: "safe output" }],
        details: { truncated: false },
    });
    assertEquals(/** @type {any} */ (toolEnd)._meta?.runwield?.durationMs, 25);
});

Deno.test("ACP event mapper forwards structured validation progress metadata on system status", () => {
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

Deno.test("ACP session/cancel makes the in-flight prompt return cancelled", async () => {
    const runtime = makeFakeRuntime();
    /** @type {any} */
    let activeSession = null;
    let resolvePrompt = /** @type {((value: any) => void) | null} */ (null);
    runtime.promptSession = (
        /** @type {string} */ sessionId,
        /** @type {FakePromptOptions} */ options,
    ) => {
        const cleanup = options.onTurnStarted?.({ turnId: "turn-1" });
        activeSession = sessionId;
        return new Promise((resolve) => {
            resolvePrompt = resolve;
        }).finally(() => {
            cleanup?.();
        });
    };
    runtime.cancelSession = (/** @type {string} */ sessionId) => {
        runtime.emit(sessionId, { type: "cancellation", reason: "session_cancel", aborted: true });
        resolvePrompt?.({ ok: true, turns: 0, handoffs: 0, handoffLimitReached: false });
        return { ok: true, aborted: true };
    };

    const handle = startTestServer({ runtime });
    try {
        const newResponse = await request(handle, {
            jsonrpc: "2.0",
            id: "new",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: [] },
        });
        const sessionId = newResponse.result.sessionId;

        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                id: "prompt",
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "long" }] },
            })
        }\n`));
        while (!activeSession) await new Promise((resolve) => setTimeout(resolve, 0));
        await handle.inputWriter.write(encoder.encode(`${
            JSON.stringify({
                jsonrpc: "2.0",
                method: "session/cancel",
                params: { sessionId },
            })
        }\n`));

        /** @type {Record<string, any> | null} */
        let response = null;
        for (let i = 0; i < 4 && !response; i++) {
            const message = await readMessage(handle);
            if (message.id === "prompt") response = message;
        }
        assertEquals(response?.id, "prompt");
        assertEquals(response?.result.stopReason, "cancelled");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP production modules do not import TUI adapter code", async () => {
    /** @type {string[]} */
    const violations = [];
    for await (const entry of Deno.readDir("src/acp")) {
        if (!entry.isFile || !entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) continue;
        const path = `src/acp/${entry.name}`;
        const source = await Deno.readTextFile(path);
        if (/from\s+["'][^"']*(?:\/ui\/|shared\/interactive)/.test(source)) violations.push(path);
        if (/import\(["'][^"']*(?:\/ui\/|shared\/interactive)/.test(source)) violations.push(path);
    }
    assertEquals(violations, []);
});

Deno.test("ACP interaction adapter withholds Pair capability and checkpoints", async () => {
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
    assertEquals(adapter.supportsInteraction?.("select"), false);
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

Deno.test("ACP interaction adapter maps form elicitation answers", async () => {
    /** @type {unknown[]} */
    const requests = [];
    const adapter = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: {
            request: (/** @type {string} */ method, /** @type {unknown} */ params) => {
                requests.push({ method, params });
                return Promise.resolve({ action: "accept", content: { answer: "yes" } });
            },
        },
    });

    const response = await adapter.requestInteraction({
        id: "interaction-1",
        type: "select",
        prompt: "Proceed?",
        options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    });

    assertEquals(response.outcome, "selected");
    assertEquals(response.value, "yes");
    assertEquals(/** @type {any} */ (requests[0]).method, "elicitation/create");
    assertEquals(/** @type {any} */ (requests[0]).params.sessionId, "acp-1");
});

Deno.test("ACP interaction adapter rejects invalid selected options", async () => {
    const adapter = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: {
            request: () => Promise.resolve({ action: "accept", content: { answer: "invalid" } }),
        },
    });

    const response = await adapter.requestInteraction({
        id: "interaction-1",
        type: "select",
        prompt: "Proceed?",
        options: [{ value: "yes", label: "Yes" }],
    });

    assertEquals(response.outcome, "unsupported");
    assertEquals(response.message, "ACP elicitation returned invalid option: invalid");
});

Deno.test("ACP interaction adapter maps declined approval choices to canceled outcome", async () => {
    const adapter = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: {
            request: () => Promise.resolve({ action: "accept", content: { answer: "deny" } }),
        },
    });

    const response = await adapter.requestInteraction({
        id: "interaction-1",
        type: "approval",
        prompt: "Approve?",
        options: [{ value: "approve", label: "Approve" }, { value: "deny", label: "Deny" }],
    });

    assertEquals(response.outcome, "canceled");
    assertEquals(response.value, false);
});

Deno.test("ACP interaction adapter does not auto-accept arbitrary single approval options", async () => {
    const adapter = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: {
            request: () => Promise.resolve({ action: "accept", content: { answer: "deny" } }),
        },
    });

    const response = await adapter.requestInteraction({
        id: "interaction-1",
        type: "approval",
        prompt: "Approve?",
        options: [{ value: "deny", label: "Deny" }],
    });

    assertEquals(response.outcome, "canceled");
    assertEquals(response.value, false);
});

Deno.test("ACP interaction adapter maps approval acceptance to accepted outcome", async () => {
    const adapter = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: { elicitation: { form: {} } },
        context: {
            request: () => Promise.resolve({ action: "accept", content: { answer: "approve" } }),
        },
    });

    const response = await adapter.requestInteraction({
        id: "interaction-1",
        type: "approval",
        prompt: "Approve?",
        options: [{ value: "approve", label: "Approve" }],
    });

    assertEquals(response.outcome, "accepted");
    assertEquals(response.value, true);
});

Deno.test("ACP interaction adapter returns unsupported without form capabilities", async () => {
    const adapter = createAcpInteractionAdapter({
        acpSessionId: "acp-1",
        clientCapabilities: {},
        context: {},
    });
    const response = await adapter.requestInteraction({ type: "text", prompt: "Name?" });
    assertEquals(response.outcome, "unsupported");
});

Deno.test("ACP event mapper maps plan review links without maintainer secrets", () => {
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
