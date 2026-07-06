import { assertEquals } from "@std/assert";
import { createTaskCompletedTool } from "../task-completed.js";

/**
 * @param {{ execute: unknown }} tool
 * @param {{ message?: string }} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: { message?: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown, terminate?: boolean }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("task_completed renders completion message as markdown", async () => {
    /** @type {Array<{ agentName: string, text: string }>} */
    const rendered = [];
    const uiAPI = /** @type {import('../../ui/tui/types.js').UiAPI} */ ({
        appendSystemMessage: () => {},
        appendAgentMessageStart: (agentName) => ({
            appendText: (text) => rendered.push({ agentName, text }),
        }),
        requestRender: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    });
    const tool = createTaskCompletedTool({ uiAPI, agentName: "Engineer" });

    const result = await executeTool(tool, { message: "Fixed **CI**." });

    assertEquals(result.terminate, true);
    assertEquals(result.details, { outcome: "task_completed", message: "Fixed **CI**." });
    assertEquals(rendered, [{ agentName: "Engineer", text: "**Task completed.**\n\nFixed **CI**." }]);
});
