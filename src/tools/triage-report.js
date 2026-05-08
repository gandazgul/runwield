/**
 * @module triage-report
 * Custom tool for the Router to output a structured triage report.
 *
 * The tool only captures classification + summary + affectedPaths and surfaces
 * them via the tool result. Post-triage dispatch (Operator/Planner/Architect)
 * is handled by the router orchestrator in `src/cmd/router/index.js`, which
 * reads the latest triage_report outcome after the router session ends.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

const TOOL_PARAMS = Type.Object({
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
});

/**
 * Create the triage_report tool. The tool only emits the classification —
 * dispatch to the next agent happens in the router orchestrator.
 *
 * @param {{
 *   uiAPI?: import('../shared/workflow/workflow.js').UiAPI,
 * }} [opts]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createTriageReportTool({ uiAPI } = {}) {
    return defineTool({
        name: "triage_report",
        label: "Triage Report",
        description: "Submit your triage classification for the user's request. " +
            "You MUST call this tool exactly once after exploring the codebase. " +
            "Do not output the classification as freeform text — use this tool.",
        parameters: TOOL_PARAMS,
        // deno-lint-ignore require-await
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const { classification, complexity, summary } = params;

            uiAPI?.appendSystemMessage(
                `Classification: ${classification}, Complexity: ${complexity}. Summary: ${summary}`,
                false,
                "Router",
            );

            return {
                content: [
                    {
                        type: "text",
                        text: `Triage complete.`,
                    },
                ],
                details: params,
                terminate: true,
            };
        },
    });
}
