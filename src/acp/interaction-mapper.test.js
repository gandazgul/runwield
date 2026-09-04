/**
 * @module acp/interaction-mapper.test
 */

import { assertEquals } from "@std/assert";
import { createAcpInteractionAdapter } from "./interaction-mapper.js";

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
