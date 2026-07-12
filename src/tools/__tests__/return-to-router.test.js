import { assertEquals, assertMatch } from "@std/assert";
import { AGENTS } from "../../constants.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { getAgentDisplayName } from "../../shared/session/agents.js";
import { readLatestReturnToRouterOutcome } from "../../shared/workflow/workflow-results.js";
import { executeReturnToRouter, returnToRouterTool } from "../return-to-router.js";

/** @param {{ execute: unknown }} tool @param {{ reason: string }} params @param {object} [context] */
async function executeTool(tool, params, context = {}) {
    const execute =
        /** @type {(id: string, params: { reason: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown, terminate?: boolean }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, context);
}

function makeMockUiAPI() {
    return /** @type {import('../../shared/types.js').SessionUiPort} */ ({
        appendSystemMessage: () => {},
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    });
}

Deno.test("returnToRouterTool exposes expected metadata", () => {
    assertEquals(returnToRouterTool.name, "return_to_router");
    assertEquals(returnToRouterTool.label, `Return to ${getAgentDisplayName(AGENTS.ROUTER)}`);
    assertMatch(
        returnToRouterTool.description,
        new RegExp(`return the conversation to ${getAgentDisplayName(AGENTS.ROUTER)}`, "i"),
    );
});

Deno.test("returnToRouterTool returns error when no HostedSession context is active", async () => {
    const result = await executeTool(returnToRouterTool, {
        reason: "The user wants you to triage a larger change.",
    });

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /requires an active UI session/i,
    );
});

Deno.test("returnToRouterTool terminates with adapter-neutral Router handoff details", async () => {
    const hostedSession = new HostedSession({ id: "return-router-session", cwd: Deno.cwd() });
    const reason = "The user wants you to review the architecture of the auth module.";
    /** @type {any[]} */
    const metrics = [];

    const result = await executeReturnToRouter({ reason }, makeMockUiAPI(), hostedSession, {
        recordWorkflowMetric: (metric) => {
            metrics.push(metric);
            return Promise.resolve(null);
        },
    });

    assertEquals(result.terminate, true);
    assertEquals(result.content.length, 0);
    assertEquals(result.details, { agentName: AGENTS.ROUTER, reason });
    assertEquals(hostedSession.getActiveOnMessage(), null);
    assertEquals(hostedSession.getRootAgentName(), null);
    assertEquals(metrics[0].event, "return_to_router");
});

Deno.test("readLatestReturnToRouterOutcome reads only current-turn Router handoffs", () => {
    const messages = /** @type {import('@earendil-works/pi-agent-core').AgentMessage[]} */ ([
        { role: "toolResult", toolName: "return_to_router", details: { agentName: AGENTS.ROUTER, reason: "old" } },
        { role: "assistant", content: [{ type: "text", text: "later" }] },
        { role: "toolResult", toolName: "return_to_router", details: { agentName: AGENTS.ROUTER, reason: "new" } },
    ]);

    assertEquals(readLatestReturnToRouterOutcome(messages, 1), { agentName: AGENTS.ROUTER, reason: "new" });
    assertEquals(readLatestReturnToRouterOutcome(messages, 3), null);
});

Deno.test("returnToRouterTool uses HostedSession and UI from tool context", async () => {
    const hostedSession = new HostedSession({ id: "context-session", cwd: Deno.cwd() });
    const reason = "The user wants you to triage this request from scratch.";

    const result = await executeTool(returnToRouterTool, { reason }, { uiAPI: makeMockUiAPI(), hostedSession });

    assertEquals(result.terminate, true);
    assertEquals(result.details, { agentName: AGENTS.ROUTER, reason });
});
