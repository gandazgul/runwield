/**
 * @module acp/protocol-smoke.test
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

Deno.test("ACP SDK import exposes agent and NDJSON stream primitives under Deno", () => {
    const app = agent({ name: "RunWield ACP smoke" });
    const transport = new TransformStream();
    const stream = ndJsonStream(transport.writable, transport.readable);

    assertEquals(methods.agent.initialize, "initialize");
    assertStrictEquals(PROTOCOL_VERSION, 1);
    assertEquals(typeof app.connect, "function");
    assertEquals(typeof stream.readable.getReader, "function");
    assertEquals(typeof stream.writable.getWriter, "function");
});

Deno.test("ACP method constants include session new prompt cancel and update", () => {
    assertEquals(methods.agent.session.new, "session/new");
    assertEquals(methods.agent.session.prompt, "session/prompt");
    assertEquals(methods.agent.session.cancel, "session/cancel");
    assertEquals(methods.client.session.update, "session/update");
});
