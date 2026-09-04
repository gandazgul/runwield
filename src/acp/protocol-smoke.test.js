/**
 * @module acp/protocol-smoke.test
 */

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { findAcpSchemaViolations } from "./schema-conformance.ts";

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

Deno.test("ACP method constants include session lifecycle and update methods", () => {
    assertEquals(methods.agent.session.new, "session/new");
    assertEquals(methods.agent.session.load, "session/load");
    assertEquals(methods.agent.session.prompt, "session/prompt");
    assertEquals(methods.agent.session.cancel, "session/cancel");
    assertEquals(methods.agent.session.close, "session/close");
    assertEquals(methods.client.session.update, "session/update");
});

Deno.test("ACP elicitation stayed on the same wire method after it left unstable", () => {
    assertEquals(methods.client.elicitation.create, "elicitation/create");
});

Deno.test("ACP Cost requires an amount and a currency", () => {
    assertEquals(findAcpSchemaViolations("Cost", { amount: 0.5, currency: "USD" }), []);

    for (const invalid of [JSON.parse('{"amount":0.5}'), JSON.parse('{"currency":"USD"}'), 0.5]) {
        assert(
            findAcpSchemaViolations("Cost", invalid).length > 0,
            `ACP Cost should reject ${JSON.stringify(invalid)}`,
        );
    }
});

Deno.test("ACP usage_update carries cost as an object, never a bare number", () => {
    const usageUpdate = { sessionUpdate: "usage_update", used: 12, size: 200 };

    assertEquals(findAcpSchemaViolations("UsageUpdate", usageUpdate), []);
    assertEquals(
        findAcpSchemaViolations("UsageUpdate", { ...usageUpdate, cost: { amount: 1.5, currency: "USD" } }),
        [],
    );
    assert(findAcpSchemaViolations("UsageUpdate", { ...usageUpdate, cost: 1.5 }).length > 0);
});

Deno.test("ACP terminal auth accepts the RunWield login descriptor", () => {
    assertEquals(
        findAcpSchemaViolations("AuthMethod", {
            id: "runwield-terminal-login",
            name: "RunWield Login",
            description: "Open a terminal to configure RunWield credentials and choose a default model.",
            type: "terminal",
            args: ["login"],
        }),
        [],
    );
});
