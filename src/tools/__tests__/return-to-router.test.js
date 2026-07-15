import { assertEquals, assertMatch } from "@std/assert";
import { AGENTS } from "../../constants.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { getAgentDisplayName } from "../../shared/session/agents.js";
import { readLatestReturnToRouterOutcome } from "../../shared/workflow/workflow-results.js";
import { executeReturnToRouter, returnToRouterTool } from "../return-to-router.js";

/** @param {{ execute: unknown }} tool @param {{ reason: string }} params @param {object} [context] */
async function executeTool(tool, params, context = {}) {
    const execute = /** @type {any} */ (tool.execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, context);
}

Deno.test("returnToRouterTool exposes Router handoff metadata", () => {
    assertEquals(returnToRouterTool.name, "return_to_router");
    assertEquals(returnToRouterTool.label, `Return to ${getAgentDisplayName(AGENTS.ROUTER)}`);
});

Deno.test("returnToRouterTool requires HostedSession context", async () => {
    const result = await executeTool(returnToRouterTool, { reason: "Retriage this request." });
    assertMatch(result.content[0].text, /requires an active hosted session/i);
});

Deno.test("executeReturnToRouter returns an adapter-neutral terminal handoff", async () => {
    const hostedSession = new HostedSession({ id: "return-router", cwd: Deno.cwd() });
    const metrics = /** @type {any[]} */ ([]);
    const reason = "The user wants you to review the auth architecture.";
    const result = await executeReturnToRouter({ reason }, hostedSession, {
        recordWorkflowMetric: (metric) => {
            metrics.push(metric);
            return Promise.resolve(/** @type {any} */ (null));
        },
    });

    assertEquals(result, {
        content: [],
        details: { agentName: AGENTS.ROUTER, reason },
        terminate: true,
    });
    assertEquals(metrics[0].event, "return_to_router");
});

Deno.test("returnToRouterTool reads only HostedSession from tool context", async () => {
    const hostedSession = new HostedSession({ id: "context-session", cwd: Deno.cwd() });
    const result = await executeTool(returnToRouterTool, { reason: "Retriage." }, { hostedSession });
    assertEquals(result.details, { agentName: AGENTS.ROUTER, reason: "Retriage." });
});

Deno.test("readLatestReturnToRouterOutcome reads current-turn handoffs", () => {
    const messages = /** @type {import('@earendil-works/pi-agent-core').AgentMessage[]} */ ([
        { role: "toolResult", toolName: "return_to_router", details: { agentName: AGENTS.ROUTER, reason: "old" } },
        { role: "assistant", content: [{ type: "text", text: "later" }] },
        { role: "toolResult", toolName: "return_to_router", details: { agentName: AGENTS.ROUTER, reason: "new" } },
    ]);
    assertEquals(readLatestReturnToRouterOutcome(messages, 1), { agentName: AGENTS.ROUTER, reason: "new" });
    assertEquals(readLatestReturnToRouterOutcome(messages, 3), null);
});
