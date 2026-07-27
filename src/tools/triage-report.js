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
import { normalizeRoutingIntent, normalizeWorkKind, ROUTING_INTENTS } from "../constants.js";
import { sanitizeSessionName } from "../shared/session/session-name.js";
import { emitSystemStatus } from "../shared/session/session-runtime-events.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

const TOOL_PARAMS = Type.Object({
    routingIntent: Type.Optional(StringEnum(ROUTING_INTENTS, {
        description:
            "Canonical Routing Intent. INQUIRY: direct informational answer. IDEATION: explicit brainstorming/research/interview/PRD work. OPERATION: direct non-code repository/environment operation. QUICK_FIX: bounded no-plan code implementation. PLANNED_CHANGE: reviewed executable planned work. FEATURE is accepted only as a legacy planned-change workflow label. PROJECT: architecture/Epic plan. Router calls should provide this field; legacy direct calls may provide classification instead.",
    })),
    classification: Type.Optional(StringEnum(ROUTING_INTENTS, {
        description:
            "Legacy compatibility field. Use routingIntent for new calls. FEATURE here is accepted and normalized to PLANNED_CHANGE.",
    })),
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
            "Ordered vertical-slice file list (high signal, not broad dump). Prefer files over directories; no globs. Order: entrypoint -> service/orchestrator -> core logic -> boundary integration -> nearest tests. INQUIRY/IDEATION/OPERATION may use an empty list or directly relevant docs/code paths. QUICK_FIX: 1-3 implementation/test paths, PLANNED_CHANGE/PROJECT: 3-8 paths.",
    }),
    workKind: Type.Optional(StringEnum(["BUG_FIX", "FEATURE", "REFACTOR", "MAINTENANCE"], {
        description:
            "Optional Work Kind for PLANNED_CHANGE. BUG_FIX for planned bug fixes, FEATURE for new/enhanced functionality, REFACTOR for structural changes, MAINTENANCE for upkeep.",
    })),
});

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

    if (routingIntent === "PLANNED_CHANGE") {
        normalized.classification = "PLANNED_CHANGE";
    } else if (routingIntent === "PROJECT") {
        normalized.classification = "PROJECT";
    } else {
        delete normalized.classification;
    }

    const workKind = normalizeWorkKind(params.workKind);
    if (workKind && routingIntent === "PLANNED_CHANGE") {
        normalized.workKind = workKind;
    } else {
        delete normalized.workKind;
    }

    return normalized;
}

/**
 * Create the triage_report tool. The tool only emits the Routing Intent —
 * dispatch to the next Agent happens in the active Agent handler.
 *
 * @param {{
 *   hostedSession?: import('../shared/session/hosted-session.js').HostedSession | null,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [opts]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createTriageReportTool(
    { hostedSession, recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric } = {},
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
            const { routingIntent, complexity, summary, workKind } = details;

            try {
                hostedSession?.setWorkflowTriageContext?.({ routingIntent, complexity });
            } catch (_e) {
                // Footer-context persistence is fail-open and must not block triage.
            }

            emitSystemStatus(
                hostedSession || undefined,
                `Routing Intent: ${routingIntent}${
                    workKind ? `, Work Kind: ${workKind}` : ""
                }, Complexity: ${complexity}. Summary: ${summary}`,
                { header: "Triage" },
            );

            await recordWorkflowMetricImpl({
                category: "routing",
                event: "triage_reported",
                details: {
                    routingIntent,
                    complexity,
                    classification: details.classification,
                    workKind: details.workKind,
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
