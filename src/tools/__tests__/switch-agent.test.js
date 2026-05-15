import { assertEquals, assertMatch } from "@std/assert";
import { executeSwitchAgent, switchAgentTool } from "../switch-agent.js";
import { setActiveAgent } from "../../shared/interactive/chat-session.js";
import { loadAgentDef } from "../../shared/session/agents.js";
import { consumePendingSwitchHandoff, getPendingRootSwap } from "../../shared/session/session-state.js";
import { AGENTS } from "../../constants.js";

/**
 * @param {{ execute: unknown }} tool
 * @param {{ agentName: string, reason: string }} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: { agentName: string, reason: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown, terminate?: boolean }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("switchAgentTool exposes expected metadata", () => {
    assertEquals(switchAgentTool.name, "switch_agent");
    assertEquals(switchAgentTool.label, "Switch Agent");
    assertMatch(switchAgentTool.description, /hand off the conversation/i);
    assertEquals(typeof switchAgentTool.execute, "function");
    assertEquals(typeof switchAgentTool.parameters, "object");
});

Deno.test("switchAgentTool returns error when no UI API is active", async () => {
    // Ensure no active UI API
    setActiveAgent(AGENTS.ROUTER, async () => {}, undefined);
    consumePendingSwitchHandoff();

    const params = {
        agentName: AGENTS.ENGINEER,
        reason: "Need coding help",
    };

    const result = await executeTool(switchAgentTool, params);

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /requires an active UI session/i,
    );
});

Deno.test("switchAgentTool terminates the calling turn and records a handoff", async () => {
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
    const result = await executeSwitchAgent(
        { agentName: AGENTS.ROUTER, reason },
        mockUiAPI,
    );

    // Terminates the calling agent's turn.
    assertEquals(result.terminate, true);
    // Content is empty on success — terminate:true halts generation, no text needed.
    assertEquals(result.content.length, 0);
    // The reason is preserved on the result details for inspection.
    assertEquals(/** @type {{ agentName: string, reason: string }} */ (result.details).reason, reason);
    assertMatch(systemMessage, /Agent hand-off: Switching to Router/i);

    // The chat-session loop will read this handoff and feed `reason` to the new agent.
    const handoff = consumePendingSwitchHandoff();
    assertEquals(handoff?.agentName, AGENTS.ROUTER);
    assertEquals(handoff?.reason, reason);
});

Deno.test("switchAgentTool queues the target agent's model on the pending root swap", async () => {
    /** @type {import('../../shared/ui/types.js').UiAPI} */
    const mockUiAPI = {
        appendSystemMessage: () => {},
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    };

    setActiveAgent(AGENTS.PLANNER, async () => {}, mockUiAPI);
    consumePendingSwitchHandoff();

    const params = {
        agentName: AGENTS.OPERATOR,
        reason: "Run the failing tests and report which assertion broke.",
    };

    await executeTool(switchAgentTool, params);

    // The footer/model state changes only when the root session is actually
    // rebuilt by applyPendingRootSwap. Until then, the swap (with the target
    // model) sits in the pending queue.
    const operatorDef = await loadAgentDef(AGENTS.OPERATOR);
    const pending = getPendingRootSwap();
    assertEquals(pending?.agentName, AGENTS.OPERATOR);
    assertEquals(pending?.model, operatorDef.model);
});

Deno.test("executeSwitchAgent returns unknown-agent error with available list", async () => {
    /** @type {import('../../shared/ui/types.js').UiAPI} */
    const mockUiAPI = {
        appendSystemMessage: () => {},
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    };

    const result = await executeSwitchAgent(
        { agentName: "not-real-agent", reason: "test" },
        mockUiAPI,
    );

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /Unknown agent "not-real-agent"/i,
    );
});
