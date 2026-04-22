/**
 * @module triage-report
 * Custom tool for the Router agent to output a structured triage report.
 * Instead of hoping for parseable JSON in freeform text, this tool
 * forces the LLM to output a structured classification result.
 */

import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";

export const triageReportTool = defineTool({
  name: "triage_report",
  label: "Triage Report",
  description: "Submit your triage classification for the user's request. " +
    "You MUST call this tool exactly once after exploring the codebase. " +
    "Do not output the classification as freeform text — use this tool.",
  parameters: Type.Object({
    classification: StringEnum(["QUICK_FIX", "FEATURE", "PROJECT"], {
      description:
        "QUICK_FIX: 1-2 files, minor change. FEATURE: multiple files, new logic, needs a plan. PROJECT: architectural shift.",
    }),
    complexity: StringEnum(["LOW", "MEDIUM", "HIGH"], {
      description: "How complex is this task?",
    }),
    summary: Type.String({
      description: "Brief summary of what needs to be done and why.",
    }),
    affectedPaths: Type.Array(Type.String(), {
      description:
        "List of file paths that will be created or modified to fulfill the request.",
    }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return {
      content: [
        {
          type: "text",
          text:
            `Triage complete: ${params.classification} (${params.complexity} complexity). Summary: ${params.summary}`,
        },
      ],
      details: params,
    };
  },
});
