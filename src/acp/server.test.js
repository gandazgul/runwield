/**
 * @module acp/server.test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { mapRuntimeEventToAcpUpdate } from "./event-mapper.js";
import { createInitializeResponse, startRunWieldAcpServer } from "./server.js";

/**
 * @typedef {Object} TestServerHandle
 * @property {WritableStreamDefaultWriter<Uint8Array>} inputWriter
 * @property {ReadableStreamDefaultReader<Uint8Array>} outputReader
 * @property {import('@agentclientprotocol/sdk').AgentConnection} connection
 * @property {string[]} diagnostics
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
    assertEquals(capabilities.sessionCapabilities._meta.runwield.implementedMethods, [
        "session/new",
        "session/prompt",
        "session/cancel",
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
    const versionResult = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "scripts/write-version.js"],
        stdout: "null",
        stderr: "null",
    }).output();
    assertEquals(versionResult.code, 0);

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
            const hostedSession = { id: `fake-${nextId++}`, cwd };
            sessions.set(hostedSession.id, hostedSession);
            return Promise.resolve(hostedSession);
        },
        /** @param {string} id */
        getSession(id) {
            return sessions.get(id) || null;
        },
        /** @param {{ id: string }} session @param {(event: any) => void} listener */
        subscribeSessionEvents(session, listener) {
            let set = listeners.get(session.id);
            if (!set) {
                set = new Set();
                listeners.set(session.id, set);
            }
            set.add(listener);
            return () => set.delete(listener);
        },
        /** @param {{ id: string }} session @param {Record<string, unknown>} event */
        emit(session, event) {
            const set = listeners.get(session.id) || new Set();
            for (const listener of set) {
                listener({ sessionId: session.id, timestamp: new Date().toISOString(), ...event });
            }
        },
        /** @param {{ id: string }} session @param {{ initialRequest: string }} options */
        promptSession(session, options) {
            this.emit(session, { type: "user_message", text: options.initialRequest, turnId: "turn-1" });
            this.emit(session, { type: "assistant_text_delta", delta: "hello", turnId: "turn-1" });
            return Promise.resolve({ ok: true, turns: 1, handoffs: 0, handoffLimitReached: false });
        },
        /** @param {{ id: string }} session */
        cancelSession(session) {
            this.emit(session, { type: "cancellation", reason: "session_cancel", aborted: true });
            return { ok: true, aborted: true };
        },
    };
}

Deno.test("ACP initialize advertises implemented MVP prompt/session capabilities only", () => {
    const response = createInitializeResponse({ protocolVersion: 1 });

    const capabilities = /** @type {any} */ (response.agentCapabilities);
    assertEquals(capabilities.promptCapabilities._meta.runwield.contentTypes, ["text", "resource_link"]);
    assertEquals(capabilities.sessionCapabilities._meta.runwield.implementedMethods, [
        "session/new",
        "session/prompt",
        "session/cancel",
    ]);
    assertEquals(capabilities.sessionCapabilities._meta.runwield.updateNotifications, ["session/update"]);
    assertEquals(capabilities.loadSession, undefined);
    assertEquals(capabilities.sessionCapabilities.close, undefined);
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
    blockingRuntime.promptSession = (/** @type {{ id: string }} */ session) =>
        new Promise((resolve) => {
            releasePrompt = () => resolve({ ok: true, turns: 1, handoffs: 0, handoffLimitReached: false });
            blockingRuntime.emit(session, { type: "assistant_text_delta", delta: "working", turnId: "turn-1" });
        });
    const handle = startTestServer({ runtime: blockingRuntime });
    try {
        const relative = await request(handle, {
            jsonrpc: "2.0",
            id: "bad-new",
            method: "session/new",
            params: { cwd: "relative", mcpServers: [] },
        });
        assertEquals(relative.error.code, -32602);

        const objectMcpServers = await request(handle, {
            jsonrpc: "2.0",
            id: "bad-mcp-object",
            method: "session/new",
            params: { cwd: Deno.cwd(), mcpServers: { local: { command: "secret" } } },
        });
        assertEquals(objectMcpServers.error.code, -32602);

        const objectAdditionalDirectories = await request(handle, {
            jsonrpc: "2.0",
            id: "bad-additional-directories-object",
            method: "session/new",
            params: { cwd: Deno.cwd(), additionalDirectories: { docs: Deno.cwd() } },
        });
        assertEquals(objectAdditionalDirectories.error.code, -32602);

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

        const invalidOverlap = await request(handle, {
            jsonrpc: "2.0",
            id: "prompt-invalid-overlap",
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "image", data: "x", mimeType: "image/png" }] },
        });
        assertEquals(invalidOverlap.error.code, -32002);

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

Deno.test("ACP session/cancel settles prompt as cancelled even when runtime abort throws", async () => {
    const runtime = makeFakeRuntime();
    /** @type {any} */
    let activeSession = null;
    let promptCount = 0;
    runtime.promptSession = (
        /** @type {{ id: string }} */ session,
        /** @type {{ initialRequest: string }} */ options,
    ) => {
        activeSession = session;
        promptCount++;
        if (promptCount === 1) return new Promise(() => {});
        runtime.emit(session, { type: "user_message", text: options.initialRequest, turnId: "turn-2" });
        runtime.emit(session, { type: "assistant_text_delta", delta: "next", turnId: "turn-2" });
        return Promise.resolve({ ok: true, turns: 1, handoffs: 0, handoffLimitReached: false });
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
        assertEquals(sawCancellationUpdate, true);
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
        assertEquals(afterCancel?.result.stopReason, "end_turn");
    } finally {
        await closeTestServer(handle);
    }
});

Deno.test("ACP event mapper avoids exposing raw tool arguments and results", () => {
    const toolStart = mapRuntimeEventToAcpUpdate({
        type: "tool_start",
        sessionId: "session-1",
        timestamp: "now",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { token: "secret" },
    });
    const toolUpdate = mapRuntimeEventToAcpUpdate({
        type: "tool_update",
        sessionId: "session-1",
        timestamp: "now",
        toolCallId: "tool-1",
        toolName: "bash",
        partialResult: { password: "secret" },
    });
    const toolEnd = mapRuntimeEventToAcpUpdate({
        type: "tool_end",
        sessionId: "session-1",
        timestamp: "now",
        toolCallId: "tool-1",
        toolName: "bash",
        result: { apiKey: "secret" },
    });

    assertEquals(/** @type {any} */ (toolStart).rawInput, undefined);
    assertEquals(/** @type {any} */ (toolUpdate)._meta?.runwield?.partialResult, undefined);
    assertEquals(/** @type {any} */ (toolEnd).rawOutput, undefined);
});

Deno.test("ACP session/cancel makes the in-flight prompt return cancelled", async () => {
    const runtime = makeFakeRuntime();
    /** @type {any} */
    let activeSession = null;
    let resolvePrompt = /** @type {((value: any) => void) | null} */ (null);
    runtime.promptSession = (/** @type {{ id: string }} */ session) => {
        activeSession = session;
        return new Promise((resolve) => {
            resolvePrompt = resolve;
        });
    };
    runtime.cancelSession = (/** @type {{ id: string }} */ session) => {
        runtime.emit(session, { type: "cancellation", reason: "session_cancel", aborted: true });
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

Deno.test("ACP modules do not import TUI chat-session internals", async () => {
    const command = new Deno.Command("bash", {
        args: [
            "-lc",
            "if /usr/bin/find src/acp src/shared/session -name '*.js' ! -name '*.test.js' -print0 | xargs -0 grep -n 'shared/interactive/chat-session'; then exit 1; else exit 0; fi",
        ],
        stdout: "piped",
        stderr: "piped",
    });
    const { code, stdout } = await command.output();
    const output = decoder.decode(stdout);
    assertEquals(code, 0);
    assertEquals(output, "");
});
