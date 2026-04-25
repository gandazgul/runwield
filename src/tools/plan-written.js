/**
 * @module plan-written
 * Custom tool for planning agents to declare the plan filename they created.
 */

import { Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";

export const planWrittenTool = defineTool({
  name: "plan_written",
  label: "Plan Written",
  description: "Declare the plan filename you created in plans/. " +
    "Call this exactly once after creating the plan file.",
  parameters: Type.Object({
    planName: Type.String({
      description:
        "Plan filename without extension (kebab-case preferred), e.g. implement-memory-system",
    }),
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
