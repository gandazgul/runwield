/**
 * @module acp/server.test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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

    assertEquals(response.protocolVersion, 1);
    assertEquals(response.agentCapabilities, {});
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
        assertEquals(response.result.agentCapabilities, {});
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
