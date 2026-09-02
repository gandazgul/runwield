/**
 * @module tools/review-complete
 * Custom tool for the semantic code reviewer to signal completion with a
 * structured outcome (approved + optional feedback). Analogous to
 * plan_written for planners.
 */

import { type Static, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { HostedSession } from "../shared/session/hosted-session.js";
import { emitReviewResultMessage } from "../shared/session/workflow-messages.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";
import { publishWorkflowToolEvent } from "../shared/workflow/workflow-tool-events.ts";

export interface ReviewFinding {
    id?: string;
    resolved: boolean;
    title: string;
    requirement: string;
    evidence: string;
}

export interface ReviewAdvisory {
    title: string;
    detail: string;
}

const FINDING_PARAMS = Type.Object({
    id: Type.Optional(Type.String({
        description:
            'Existing ledger identity this finding refers to (e.g. "R1-2"). Omit for a newly discovered issue; RunWield assigns the identity. Never invent or renumber identities.',
    })),
    resolved: Type.Optional(Type.Boolean({
        default: false,
        description:
            "Set true only when re-reviewing an existing identity you have independently verified as fixed in the code. An Engineer's claim that it was fixed is evidence, not resolution.",
    })),
    title: Type.String({
        description: "One-line statement of the defect.",
        minLength: 1,
    }),
    requirement: Type.Optional(Type.String({
        description:
            "The specific Plan requirement this diverges from, or the concrete defect class if not plan-derived.",
    })),
    evidence: Type.Optional(Type.String({
        description: "Where to look: changed file and hunk, or the code location that demonstrates the problem.",
    })),
});

const ADVISORY_PARAMS = Type.Object({
    title: Type.String({
        description: "One-line statement of the non-blocking observation.",
        minLength: 1,
    }),
    detail: Type.Optional(Type.String({
        description: "Why it was raised, and any interpretation chosen or future clarification worth recording.",
    })),
});

const PARAMETERS = Type.Object({
    approved: Type.Boolean({
        description: "Whether the implementation satisfies the plan requirements with no open blocking issues.",
    }),
    feedback: Type.Optional(Type.String({
        default: "",
        description:
            "Optional brief note about your decision. Leave this empty when you supply `findings` — RunWield renders the open findings itself. Do not restate resolved items here; they are shown as resolved from the structured result.",
    })),
    findings: Type.Optional(Type.Array(FINDING_PARAMS, {
        default: [],
        description:
            "Blocking Review Issues. Include every still-open issue each round, marking resolved ones with resolved: true. Approving with unresolved findings is rejected.",
    })),
    advisories: Type.Optional(Type.Array(ADVISORY_PARAMS, {
        default: [],
        description:
            "Non-blocking Review Advisories: code smells, maintainability observations, and genuine Plan ambiguity. These never block approval.",
    })),
});

type ReviewFindingParam = Static<typeof FINDING_PARAMS>;
type ReviewAdvisoryParam = Static<typeof ADVISORY_PARAMS>;

type ReviewCompleteDetails =
    | { outcome: "rejected"; reason: "approved_with_open_findings" }
    | {
        outcome: "approved" | "feedback";
        approved: boolean;
        feedback: string;
        findings: ReviewFinding[];
        advisories: ReviewAdvisory[];
    };

type ReviewCompleteResult = AgentToolResult<ReviewCompleteDetails> & { terminate: boolean };

interface ReviewCompletedToolOptions {
    hostedSession: HostedSession;
    agentName?: string;
}

export function createReviewCompletedTool(
    { hostedSession, agentName = "reviewer" }: ReviewCompletedToolOptions,
) {
    if (!hostedSession) throw new Error("createReviewCompletedTool: hostedSession is required");
    return defineTool<typeof PARAMETERS, ReviewCompleteDetails>({
        name: "review_complete",
        label: "Review Complete",
        description: "Signal that the semantic code review is complete with a structured result. " +
            "Call with `approved: true` when the implementation satisfies the plan and no blocking issue remains. " +
            "Call with `approved: false` plus a `findings` array when it does not; each finding is one concrete defect. " +
            "Report non-blocking observations as `advisories` — they never block approval. " +
            "Call this exactly once when you have finished reviewing. Do not output text after calling this tool.",
        parameters: PARAMETERS,
        async execute(toolCallId, params): Promise<ReviewCompleteResult> {
            await Promise.resolve();
            const approved = params.approved === true;
            const feedback = typeof params.feedback === "string" ? params.feedback.trim() : "";
            const findings = normalizeFindings(params.findings);
            const advisories = normalizeAdvisories(params.advisories);
            const openFindings = findings.filter((finding) => !finding.resolved);

            if (approved && openFindings.length > 0) {
                const rejection = `Cannot approve with ${openFindings.length} unresolved finding(s). ` +
                    "Either resolve them (resolved: true, after verifying the fix in the code) or call " +
                    "review_complete with approved: false.";
                await recordWorkflowMetric({
                    category: "validation",
                    event: "review_complete",
                    agentName,
                    details: { outcome: "rejected", reason: "approved_with_open_findings" },
                }, hostedSession.cwd);
                return {
                    content: [{ type: "text", text: `review_complete rejected: ${rejection}` }],
                    details: { outcome: "rejected", reason: "approved_with_open_findings" },
                    terminate: false,
                };
            }

            const outcome: "approved" | "feedback" = approved ? "approved" : "feedback";
            const resolvedCount = findings.length - openFindings.length;
            const projection = findings.length > 0 ? formatFindingsProjection(openFindings) : feedback;
            const openLabel = openFindings.length === 1 ? "1 issue open" : `${openFindings.length} issues open`;
            const resolvedNote = resolvedCount > 0 ? `, ${resolvedCount} resolved this round` : "";
            const message = approved
                ? "Semantic review approved — implementation matches the plan."
                : `Semantic review rejected — ${
                    findings.length > 0 ? `${openLabel}${resolvedNote}` : "issues found"
                }:\n${projection || "(no feedback provided)"}`;

            emitReviewResultMessage(hostedSession, agentName, message, approved);
            await recordWorkflowMetric({
                category: "validation",
                event: "review_complete",
                agentName,
                details: {
                    outcome,
                    approved,
                    hasFeedback: Boolean(projection),
                    findingCount: findings.length,
                    openFindingCount: openFindings.length,
                    resolvedFindingCount: findings.length - openFindings.length,
                    advisoryCount: advisories.length,
                },
            }, hostedSession.cwd);

            const details = { outcome, approved, feedback: projection, findings, advisories };
            publishWorkflowToolEvent({
                hostedSession,
                toolCallId,
                kind: "review_complete",
                payload: details,
            });
            return {
                content: [{ type: "text", text: message }],
                details,
                terminate: true,
            };
        },
    });
}

function normalizeFindings(value: ReviewFindingParam[] | undefined): ReviewFinding[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((finding) => {
        const title = finding.title.trim();
        if (!title) return [];
        return [{
            id: typeof finding.id === "string" && finding.id.trim() ? finding.id.trim() : undefined,
            resolved: finding.resolved === true,
            title,
            requirement: typeof finding.requirement === "string" ? finding.requirement.trim() : "",
            evidence: typeof finding.evidence === "string" ? finding.evidence.trim() : "",
        }];
    });
}

function normalizeAdvisories(value: ReviewAdvisoryParam[] | undefined): ReviewAdvisory[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((advisory) => {
        const title = advisory.title.trim();
        if (!title) return [];
        return [{
            title,
            detail: typeof advisory.detail === "string" ? advisory.detail.trim() : "",
        }];
    });
}

function formatFindingsProjection(openFindings: ReviewFinding[]): string {
    return openFindings
        .map((finding) => {
            const parts = [`- ${finding.id ? `${finding.id} — ` : ""}${finding.title}`];
            if (finding.requirement) parts.push(`  Plan: ${finding.requirement}`);
            if (finding.evidence) parts.push(`  Evidence: ${finding.evidence}`);
            return parts.join("\n");
        })
        .join("\n");
}
