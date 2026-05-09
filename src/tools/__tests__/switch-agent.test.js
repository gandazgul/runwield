import { assertEquals, assertMatch } from "@std/assert";
import { executeSwitchAgent, switchAgentTool } from "../switch-agent.js";
import { getActiveModel, setActiveAgent } from "../../shared/interactive/chat-session.js";
import { loadAgentDef } from "../../shared/session/session.js";

/**
 * @param {{ execute: unknown }} tool
 * @param {{ agentName: string, reason: string }} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: { agentName: string, reason: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("switchAgentTool exposes expected metadata", () => {
    assertEquals(switchAgentTool.name, "switch_agent");
    assertEquals(switchAgentTool.label, "Switch Agent");
    assertMatch(switchAgentTool.description, /Switch the active agent/i);
    assertEquals(typeof switchAgentTool.execute, "function");
    assertEquals(typeof switchAgentTool.parameters, "object");
});

Deno.test("switchAgentTool returns error when no UI API is active", async () => {
    // Ensure no active UI API
    setActiveAgent("Router", async () => {}, undefined);

    const params = {
        agentName: "engineer",
        reason: "Need coding help",
    };

    const result = await executeTool(switchAgentTool, params);

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /requires an active UI session/i,
    );
});

Deno.test("switchAgentTool handles router switch with mock UI API", async () => {
    let systemMessage = "";
    /** @type {import('../../shared/ui/types.js').UiAPI} */
    const mockUiAPI = {
        appendSystemMessage: (/** @type {string} */ msg) => {
            systemMessage = msg;
        },
        requestRender: () => {},
        // Minimal properties to satisfy setActiveAgent if it checks for them
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    };

    // Set mock UI API
    setActiveAgent("Router", async () => {}, mockUiAPI);

    const params = {
        agentName: "router",
        reason: "Back to start",
    };

    const result = await executeTool(switchAgentTool, params);

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /Switched to Router\. Reason: Back to start/i,
    );
    assertMatch(systemMessage, /Agent hand-off: Switching to router/i);
});

Deno.test("switchAgentTool updates active model when switching to agent with declared model", async () => {
    /** @type {import('../../shared/ui/types.js').UiAPI} */
    const mockUiAPI = {
        appendSystemMessage: () => {},
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    };

    setActiveAgent("Router", async () => {}, mockUiAPI);

    const params = {
        agentName: "operator",
        reason: "Need to execute a task",
    };

    await executeTool(switchAgentTool, params);

    const operatorDef = await loadAgentDef("operator");
    assertEquals(getActiveModel(), operatorDef.model);
});

Deno.test("executeSwitchAgent succeeds when given a direct uiAPI without global state", async () => {
    let systemMessage = "";
    /** @type {string | null} */
    let triggeredAgent = null;
    /** @type {string | null} */
    let triggeredReason = null;
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

    // Ensure global state is NOT set
    setActiveAgent("Router", async () => {}, undefined);

    const params = {
        agentName: "router",
        reason: "Back to start",
    };

    const result = await executeSwitchAgent(
        params,
        mockUiAPI,
        undefined,
        (target, reason) => {
            triggeredAgent = target;
            triggeredReason = reason;
            return Promise.resolve();
        },
    );

    assertMatch(/** @type {{ type: "text", text: string }} */ (result.content[0]).text, /Switched to Router/i);
    assertMatch(systemMessage, /Agent hand-off: Switching to router/i);
    assertEquals(triggeredAgent, "router");
    assertEquals(triggeredReason, "Back to start");
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
        undefined,
    );

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /Unknown agent "not-real-agent"/i,
    );
});
