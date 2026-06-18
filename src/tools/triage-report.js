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

const PLAN_CLASSIFICATIONS = ["FEATURE", "PROJECT"];

const TOOL_PARAMS = Type.Object({
    routingIntent: StringEnum(ROUTING_INTENTS, {
        description:
            "Canonical Routing Intent. INQUIRY: direct informational answer. IDEATION: explicit brainstorming/research/interview/PRD work. QUICK_FIX: small edit/operation. FEATURE: needs a feature plan. PROJECT: architecture/Epic plan. Router calls must provide this field; legacy direct calls may be normalized internally.",
    }),
    complexity: StringEnum(["LOW", "MEDIUM", "HIGH"], {
        description: "How complex is this request?",
    }),
    summary: Type.String({
        description: "Brief summary of the request and why it should route there.",
    }),
    affectedPaths: Type.Array(Type.String(), {
        description:
            "Ordered vertical-slice file list (high signal, not broad dump). Prefer files over directories; no globs. Order: entrypoint -> service/orchestrator -> core logic -> boundary integration -> nearest tests. INQUIRY/IDEATION may use an empty list or directly relevant docs/code paths. QUICK_FIX: 1-3 paths, FEATURE/PROJECT: 3-8 paths.",
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
 * }} [opts]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createTriageReportTool({ uiAPI } = {}) {
    return defineTool({
        name: "triage_report",
        label: "Routing Intent Report",
        description: "Submit your Routing Intent for the user's request. " +
            "You MUST call this tool exactly once after enough discovery to route the request. " +
            "Clearly operational or informational requests may need no codebase exploration before routing. " +
            "Do not output the Routing Intent as freeform text — use this tool.",
        parameters: TOOL_PARAMS,
        // deno-lint-ignore require-await
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const details = normalizeTriageParams(/** @type {Record<string, unknown>} */ (params));
            const { routingIntent, complexity, summary } = details;

            uiAPI?.appendSystemMessage(
                `Routing Intent: ${routingIntent}, Complexity: ${complexity}. Summary: ${summary}`,
                false,
                "Triage",
            );

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
