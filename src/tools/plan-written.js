/**
 * @module plan-written
 * Custom tool for planning agents (Planner/Architect) to declare the plan filename they created.
 */

import { Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";

export const planWrittenTool = defineTool({
    name: "plan_written",
    label: "Plan Written",
    description: "Declare the plan filename you created in plans/. " +
        "Call this exactly once after creating the plan file. For PROJECT plans, also provide the tasks you mapped out.",
    parameters: Type.Object({
        planName: Type.String({
            description: "Plan filename without extension (kebab-case preferred), e.g. implement-memory-system",
        }),
        tasks: Type.Optional(Type.Array(Type.Object({
            task: Type.Number({ description: "Unique task ID (e.g. 1)" }),
            assignee: Type.String({ description: "Assigned agent role, one of: engineer, doc-writer, tester" }),
            dependencies: Type.String({ description: "Comma-separated list of prerequisite task IDs, or empty string if none" }),
            description: Type.String({ description: "What needs to be done in this task" })
        }), {
            description: "Required for PROJECT plans. Array of tasks reflecting the markdown Tasks table."
        }))
    }),
    async execute(_toolCallId, params) {
        await Promise.resolve();
        return {
            content: [
                {
                    type: "text",
                    text: `Plan declared: ${params.planName}`,
                },
            ],
            details: params,
        };
    },
});
