/**
 * @module triage-report
 * Custom tool for emitting a structured Triage Report.
 *
 * The tool captures Routing Intent + summary + affectedPaths and surfaces them
 * via the tool result. Post-triage dispatch is handled by the active Agent
 * handler after the Agent Session ends.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ROUTING_INTENTS } from "../constants.js";
import { sanitizeSessionName } from "../ui/tui/terminal-title.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

const PLAN_CLASSIFICATIONS = ["FEATURE", "PROJECT"];

const TOOL_PARAMS = Type.Object({
    routingIntent: StringEnum(ROUTING_INTENTS, {
        description:
            "Canonical Routing Intent. INQUIRY: direct informational answer. IDEATION: explicit brainstorming/research/interview/PRD work. OPERATION: direct non-code repository/environment operation. QUICK_FIX: bounded no-plan code implementation. FEATURE: needs a feature plan. PROJECT: architecture/Epic plan. Router calls must provide this field; legacy direct calls may be normalized internally.",
    }),
    complexity: StringEnum(["LOW", "MEDIUM", "HIGH"], {
        description: "How complex is this request?",
    }),
    summary: Type.String({
        description: "Brief summary of the request and why it should route there.",
    }),
    sessionName: Type.String({
        description:
            "Short 3-6 word Session Name suitable for /session display and the terminal tab title. Use concise noun phrases, not a sentence.",
    }),
    affectedPaths: Type.Array(Type.String(), {
        description:
            "Ordered vertical-slice file list (high signal, not broad dump). Prefer files over directories; no globs. Order: entrypoint -> service/orchestrator -> core logic -> boundary integration -> nearest tests. INQUIRY/IDEATION/OPERATION may use an empty list or directly relevant docs/code paths. QUICK_FIX: 1-3 implementation/test paths, FEATURE/PROJECT: 3-8 paths.",
    }),
});

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeRoutingIntent(value) {
    if (typeof value !== "string") return null;
    return ROUTING_INTENTS.includes(value) ? value : null;
}

/**
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function normalizeSessionName(params) {
    return sanitizeSessionName(params.sessionName) || sanitizeSessionName(params.summary) || "RunWield session";
}

/**
 * @param {Record<string, unknown>} params
 * @returns {Record<string, unknown>}
 */
function normalizeTriageParams(params) {
    const routingIntent = normalizeRoutingIntent(params.routingIntent) || normalizeRoutingIntent(params.classification);
    if (!routingIntent) {
        throw new TypeError("triage_report requires a valid canonical routingIntent");
    }

    /** @type {Record<string, unknown>} */
    const normalized = {
        ...params,
        routingIntent,
        sessionName: normalizeSessionName(params),
    };

    if (PLAN_CLASSIFICATIONS.includes(routingIntent)) {
        normalized.classification = routingIntent;
    } else {
        delete normalized.classification;
    }

    return normalized;
}

/**
 * Create the triage_report tool. The tool only emits the Routing Intent —
 * dispatch to the next Agent happens in the active Agent handler.
 *
 * @param {{
 *   uiAPI?: import('../shared/workflow/workflow.js').UiAPI,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [opts]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createTriageReportTool(
    { uiAPI, recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric } = {},
) {
    return defineTool({
        name: "triage_report",
        label: "Routing Intent Report",
        description: "Submit your Routing Intent for the user's request. " +
            "You MUST call this tool exactly once after enough discovery to route the request. " +
            "Clearly operational or informational requests may need no codebase exploration before routing. " +
            "Do not output the Routing Intent as freeform text — use this tool.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const details = normalizeTriageParams(/** @type {Record<string, unknown>} */ (params));
            const { routingIntent, complexity, summary } = details;

            uiAPI?.appendSystemMessage(
                `Routing Intent: ${routingIntent}, Complexity: ${complexity}. Summary: ${summary}`,
                false,
                "Triage",
            );

            await recordWorkflowMetricImpl({
                category: "routing",
                event: "triage_reported",
                details: {
                    routingIntent,
                    complexity,
                    classification: details.classification,
                    affectedPaths: details.affectedPaths,
                    affectedPathCount: Array.isArray(details.affectedPaths) ? details.affectedPaths.length : 0,
                    hasSessionName: Boolean(details.sessionName),
                },
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `Triage complete.`,
                    },
                ],
                details,
                terminate: true,
            };
        },
    });
}
