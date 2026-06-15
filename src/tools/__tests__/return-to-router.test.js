import { assertEquals, assertMatch } from "@std/assert";
import { executeReturnToRouter, returnToRouterTool } from "../return-to-router.js";
import { setActiveAgent } from "../../shared/interactive/chat-session.js";
import { loadAgentDef } from "../../shared/session/agents.js";
import { consumePendingSwitchHandoff, getPendingRootSwap } from "../../shared/session/session-state.js";
import { AGENTS } from "../../constants.js";

/**
 * @param {{ execute: unknown }} tool
 * @param {{ reason: string }} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: { reason: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown, terminate?: boolean }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("returnToRouterTool exposes expected metadata", () => {
    assertEquals(returnToRouterTool.name, "return_to_router");
    assertEquals(returnToRouterTool.label, "Return to Router");
    assertMatch(returnToRouterTool.description, /return the conversation to router/i);
    assertEquals(typeof returnToRouterTool.execute, "function");
    assertEquals(typeof returnToRouterTool.parameters, "object");
});

Deno.test("returnToRouterTool returns error when no UI API is active", async () => {
    setActiveAgent(AGENTS.ROUTER, async () => {}, undefined);
    consumePendingSwitchHandoff();

    const result = await executeTool(returnToRouterTool, {
        reason: "The user wants you to triage a larger change.",
    });

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /requires an active UI session/i,
    );
});

Deno.test("returnToRouterTool terminates the calling turn and records a Router handoff", async () => {
    let systemMessage = "";
    /** @type {import('../../shared/ui/types.js').UiAPI} */
    const mockUiAPI = {
        appendSystemMessage: (/** @type {string} */ msg) => {
            systemMessage = msg;
        },
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    };

    setActiveAgent(AGENTS.PLANNER, async () => {}, mockUiAPI);
    consumePendingSwitchHandoff();

    const reason = "The user wants you to review the architecture of the auth module.";
    const result = await executeReturnToRouter({ reason }, mockUiAPI);

    assertEquals(result.terminate, true);
    assertEquals(result.content.length, 0);
    assertEquals(/** @type {{ agentName: string, reason: string }} */ (result.details).agentName, AGENTS.ROUTER);
    assertEquals(/** @type {{ agentName: string, reason: string }} */ (result.details).reason, reason);
    assertMatch(systemMessage, /Agent hand-off: Returning to Router/i);

    const handoff = consumePendingSwitchHandoff();
    assertEquals(handoff?.agentName, AGENTS.ROUTER);
    assertEquals(handoff?.reason, reason);
});

Deno.test("returnToRouterTool queues Router's model on the pending root swap", async () => {
    /** @type {import('../../shared/ui/types.js').UiAPI} */
    const mockUiAPI = {
        appendSystemMessage: () => {},
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    };

    setActiveAgent(AGENTS.ENGINEER, async () => {}, mockUiAPI);
    consumePendingSwitchHandoff();

    await executeTool(returnToRouterTool, {
        reason: "The user wants you to triage this request from scratch.",
    });

    const routerDef = await loadAgentDef(AGENTS.ROUTER);
    const pending = getPendingRootSwap();
    assertEquals(pending?.agentName, AGENTS.ROUTER);
    assertEquals(pending?.model, routerDef.model || undefined);
});
