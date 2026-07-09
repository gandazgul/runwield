import { assertEquals } from "@std/assert";
import { createReviewCompletedTool } from "../review-complete.js";

/**
 * @param {{ execute: unknown }} tool
 * @param {{ approved: boolean, feedback?: string }} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: { approved: boolean, feedback?: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown, terminate?: boolean }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("review_complete renders rejected feedback once as reviewer result markdown", async () => {
    /** @type {Array<{ agentName: string, markdown: string, approved: boolean }>} */
    const rendered = [];
    const uiAPI = /** @type {import('../../ui/tui/types.js').UiAPI} */ ({
        appendSystemMessage: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        appendReviewResult: (agentName, markdown, approved) => rendered.push({ agentName, markdown, approved }),
        requestRender: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    });
    /** @type {any[]} */
    const metrics = [];
    const tool = createReviewCompletedTool({
        uiAPI,
        agentName: "Reviewer",
        recordWorkflowMetric: (metric) => {
            metrics.push(metric);
            return Promise.resolve(null);
        },
    });

    const result = await executeTool(tool, { approved: false, feedback: "- missing requirement" });

    assertEquals(result.terminate, true);
    assertEquals(result.details, { outcome: "feedback", approved: false, feedback: "- missing requirement" });
    assertEquals(rendered, [{
        agentName: "Reviewer",
        markdown: "Semantic review rejected — issues found:\n- missing requirement",
        approved: false,
    }]);
    assertEquals(metrics, [{
        category: "validation",
        event: "review_complete",
        agentName: "Reviewer",
        details: { outcome: "feedback", approved: false, hasFeedback: true },
    }]);
});

Deno.test("review_complete renders approved result with success state", async () => {
    /** @type {Array<{ agentName: string, markdown: string, approved: boolean }>} */
    const rendered = [];
    const uiAPI = /** @type {import('../../ui/tui/types.js').UiAPI} */ ({
        appendSystemMessage: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        appendReviewResult: (agentName, markdown, approved) => rendered.push({ agentName, markdown, approved }),
        requestRender: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    });
    const tool = createReviewCompletedTool({
        uiAPI,
        agentName: "Reviewer",
        recordWorkflowMetric: () => Promise.resolve(null),
    });

    await executeTool(tool, { approved: true });

    assertEquals(rendered, [{
        agentName: "Reviewer",
        markdown: "Semantic review approved — implementation matches the plan.",
        approved: true,
    }]);
});
