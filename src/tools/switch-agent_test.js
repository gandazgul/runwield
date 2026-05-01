import { assertEquals, assertMatch } from "@std/assert";
import { switchAgentTool } from "./switch-agent.js";
import { getActiveModel, setActiveAgent } from "../shared/chat-session.js";

/**
 * @param {any} tool
 * @param {any} params
 */
async function executeTool(tool, params) {
    return await tool.execute("tool-call-1", params, new AbortController().signal, () => {}, {});
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
    setActiveAgent("Router", async () => {}, /** @type {any} */ (null));

    const params = {
        agentName: "engineer",
        reason: "Need coding help",
    };

    const result = await executeTool(switchAgentTool, params);

    assertEquals(result.isError, true);
    assertMatch(result.content[0].text, /requires an active UI session/i);
});

Deno.test("switchAgentTool handles router switch with mock UI API", async () => {
    let systemMessage = "";
    /** @type {any} */
    const mockUiAPI = {
        appendSystemMessage: (/** @type {string} */ msg) => {
            systemMessage = msg;
        },
        requestRender: () => {},
        // Minimal properties to satisfy setActiveAgent if it checks for them
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
    };

    // Set mock UI API
    setActiveAgent("Router", async () => {}, mockUiAPI);

    const params = {
        agentName: "router",
        reason: "Back to start",
    };

    const result = await executeTool(switchAgentTool, params);

    assertEquals(result.isError, undefined);
    assertMatch(result.content[0].text, /Switched back to Router/i);
    assertMatch(systemMessage, /Agent hand-off: User requested return to Router/i);
});

Deno.test("switchAgentTool updates active model when switching to agent with declared model", async () => {
    /** @type {any} */
    const mockUiAPI = {
        appendSystemMessage: () => {},
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
    };

    setActiveAgent("Router", async () => {}, mockUiAPI);

    const params = {
        agentName: "operator",
        reason: "Need to execute a task",
    };

    const result = await executeTool(switchAgentTool, params);

    assertEquals(result.isError, undefined);
    assertEquals(getActiveModel(), "ollama-cloud/qwen3.5:cloud");
});
