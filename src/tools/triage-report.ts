/**
 * @module triage-report
 * Custom tool for emitting a structured Triage Report.
 */

import { type Static, StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { HostedSession } from "../shared/session/hosted-session.js";
import { normalizeRoutingIntent, normalizeWorkKind, ROUTING_INTENTS, WORK_KINDS } from "../constants.js";
import { emitSystemStatus } from "../shared/session/session-runtime-events.js";
import { sanitizeSessionName } from "../shared/session/session-name.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";
import { publishWorkflowToolEvent } from "../shared/workflow/workflow-tool-events.ts";

const TRIAGE_COMPLEXITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const PARAMETERS = Type.Object({
    routingIntent: Type.Optional(StringEnum(ROUTING_INTENTS, {
        description:
            "Canonical Routing Intent. INQUIRY: direct informational answer. IDEATION: explicit brainstorming/research/interview/PRD work. OPERATION: direct non-code repository/environment operation. QUICK_FIX: bounded no-plan code implementation. PLANNED_CHANGE: reviewed executable planned work. FEATURE is accepted only as a legacy planned-change workflow label. PROJECT: architecture/Epic plan. Router calls should provide this field; legacy direct calls may provide classification instead.",
    })),
    classification: Type.Optional(StringEnum(ROUTING_INTENTS, {
        description:
            "Legacy compatibility field. Use routingIntent for new calls. FEATURE here is accepted and normalized to PLANNED_CHANGE.",
    })),
    complexity: StringEnum([...TRIAGE_COMPLEXITIES], {
        description: "How complex is this request?",
    }),
    summary: Type.String({
        description: "Brief summary of the request and why it should route there.",
    }),
    sessionName: Type.Optional(Type.String({
        description:
            "Optional short 3-6 word Session Name. If omitted, the Agent can name the Session later via set_session_name.",
    })),
    workKind: Type.Optional(StringEnum(WORK_KINDS, {
        description:
            "Optional Work Kind for PLANNED_CHANGE. BUG_FIX for planned bug fixes, FEATURE for new/enhanced functionality, REFACTOR for structural changes, MAINTENANCE for upkeep, DOCUMENTATION for documentation creation or substantial documentation updates.",
    })),
});

type TriageParameters = Static<typeof PARAMETERS>;

export type TriageRoutingIntent = NonNullable<ReturnType<typeof normalizeRoutingIntent>>;
export type TriageWorkKind = NonNullable<ReturnType<typeof normalizeWorkKind>>;
export type TriageComplexity = typeof TRIAGE_COMPLEXITIES[number];
export type TriageClassification = Extract<TriageRoutingIntent, "PLANNED_CHANGE" | "PROJECT">;

export interface TriageReportDetails {
    routingIntent: TriageRoutingIntent;
    classification?: TriageClassification;
    complexity: TriageComplexity;
    summary: string;
    sessionName?: string;
    workKind?: TriageWorkKind;
}

type TriageReportResult = AgentToolResult<TriageReportDetails> & { terminate: boolean };

interface TriageReportToolOptions {
    hostedSession?: HostedSession | null;
}

function normalizeSessionName(params: TriageParameters): string | undefined {
    return sanitizeSessionName(params.sessionName || "") || undefined;
}

function normalizeTriageComplexity(value: string): TriageComplexity {
    if (value === "LOW" || value === "MEDIUM" || value === "HIGH") return value;
    throw new TypeError("triage_report requires a valid complexity");
}

function normalizeTriageParams(params: TriageParameters): TriageReportDetails {
    const routingIntent = normalizeRoutingIntent(params.routingIntent) || normalizeRoutingIntent(params.classification);
    if (!routingIntent) {
        throw new TypeError("triage_report requires a valid canonical routingIntent");
    }

    const details: TriageReportDetails = {
        routingIntent,
        complexity: normalizeTriageComplexity(params.complexity),
        summary: params.summary,
    };
    const sessionName = normalizeSessionName(params);
    if (sessionName) details.sessionName = sessionName;

    if (routingIntent === "PLANNED_CHANGE") {
        details.classification = "PLANNED_CHANGE";
    } else if (routingIntent === "PROJECT") {
        details.classification = "PROJECT";
    }

    const workKind = normalizeWorkKind(params.workKind);
    if (workKind && routingIntent === "PLANNED_CHANGE") {
        details.workKind = workKind;
    }

    return details;
}

export function createTriageReportTool(
    { hostedSession }: TriageReportToolOptions = {},
) {
    return defineTool<typeof PARAMETERS, TriageReportDetails>({
        name: "triage_report",
        label: "Routing Intent Report",
        description: "Submit your Routing Intent for the user's request. " +
            "You MUST call this tool exactly once after enough discovery to route the request. " +
            "Clearly operational or informational requests may need no codebase exploration before routing. " +
            "Do not output the Routing Intent as freeform text — use this tool.",
        parameters: PARAMETERS,
        async execute(toolCallId, params): Promise<TriageReportResult> {
            const details = normalizeTriageParams(params);
            const { routingIntent, complexity, summary, workKind } = details;

            try {
                hostedSession?.setWorkflowTriageContext?.({ routingIntent, complexity });
            } catch (_caught) {
                // Footer-context persistence is fail-open and must not block triage.
            }

            emitSystemStatus(
                hostedSession || undefined,
                `Routing Intent: ${routingIntent}${
                    workKind ? `, Work Kind: ${workKind}` : ""
                }, Complexity: ${complexity}. Summary: ${summary}`,
                { header: "Triage" },
            );

            if (hostedSession) {
                await recordWorkflowMetric({
                    category: "routing",
                    event: "triage_reported",
                    details: {
                        routingIntent,
                        complexity,
                        classification: details.classification,
                        workKind: details.workKind,
                    },
                }, hostedSession.cwd);
                publishWorkflowToolEvent({
                    hostedSession,
                    toolCallId,
                    kind: "triage_report",
                    payload: details,
                });
            }

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
