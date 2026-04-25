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
        "Ordered vertical-slice file list (high signal, not broad dump). Prefer files over directories; no globs. Order: entrypoint -> service/orchestrator -> core logic -> boundary integration -> nearest tests. QUICK_FIX: 1-3 paths, FEATURE/PROJECT: 3-8 paths.",
    }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    await Promise.resolve();
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
