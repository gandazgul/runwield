/**
 * @module tools/review-complete
 * Custom tool for the semantic code reviewer to signal completion with a
 * structured outcome (approved + optional feedback). Analogous to
 * plan_written for planners.
 *
 * The reviewer calls this tool instead of outputting plain-text "APPROVED" or
 * issue lists. The workflow (runValidationLoop) reads the tool result via
 * readLatestReviewOutcome() and decides next steps.
 *
 * terminate: true ensures the tool result acts as a terminal signal — the
 * agent's turn ends after calling it, and no further text or tool calls are
 * expected. If the session is interrupted (Esc) before calling review_complete,
 * no tool result is produced and the workflow stays with the current agent.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { appendReviewResultMessage } from "../ui/tui/task-completed-message.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

const TOOL_PARAMS = Type.Object({
    approved: Type.Boolean({
        description: "Whether the implementation fully satisfies the plan requirements.",
    }),
    feedback: Type.Optional(Type.String({
        default: "",
        description:
            "Optional feedback text. When approved is false, this should contain a concise bulleted list of issues the Engineer needs to fix. When approved is true, this can be empty or contain brief positive notes.",
    })),
});

/**
 * Create the review_complete custom tool.
 *
 * @param {{
 *   uiAPI: import('../shared/workflow/workflow.js').UiAPI,
 *   agentName?: string,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createReviewCompletedTool(
    { uiAPI, agentName = "reviewer", recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric } =
        /** @type {any} */ ({}),
) {
    if (!uiAPI) throw new Error("createReviewCompletedTool: uiAPI is required");
    return defineTool({
        name: "review_complete",
        label: "Review Complete",
        description: "Signal that the semantic code review is complete with a structured result. " +
            "Call with `approved: true` when the implementation fully satisfies the plan. " +
            "Call with `approved: false` and a `feedback` string containing a concise bulleted list of semantic issues " +
            "when the implementation does not match the plan. " +
            "Call this exactly once when you have finished reviewing. Do not output text after calling this tool.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            await Promise.resolve();
            const approved = params.approved === true;
            const feedback = typeof params.feedback === "string" ? params.feedback.trim() : "";

            const outcome = approved ? "approved" : "feedback";
            const message = approved
                ? "Semantic review approved — implementation matches the plan."
                : `Semantic review rejected — issues found:\n${feedback || "(no feedback provided)"}`;

            appendReviewResultMessage(uiAPI, agentName, message, approved);
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "review_complete",
                agentName,
                details: { outcome, approved, hasFeedback: Boolean(feedback) },
            });

            return {
                content: [{ type: "text", text: message }],
                details: { outcome, approved, feedback },
                terminate: true,
            };
        },
    });
}
