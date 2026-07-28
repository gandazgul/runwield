/**
 * @module tools/review-complete
 * Custom tool for the semantic code reviewer to signal completion with a
 * structured outcome (approved + optional feedback). Analogous to
 * plan_written for planners.
 *
 * The reviewer calls this tool instead of outputting plain-text "APPROVED" or
 * issue lists. The workflow (runValidationLoop) reads the tool result via
 * readLatestReviewOutcome() and decides next steps.
 *
 * terminate: true ensures the tool result acts as a terminal signal — the
 * agent's turn ends after calling it, and no further text or tool calls are
 * expected. If the session is interrupted (Esc) before calling review_complete,
 * no tool result is produced and the workflow stays with the current agent.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { emitReviewResultMessage } from "../shared/session/workflow-messages.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

/**
 * @typedef {Object} ReviewFinding
 * @property {string} [id] - Existing ledger identity, when the Reviewer is referring to a prior round's finding.
 * @property {boolean} resolved - Whether this round independently verified the issue as fixed.
 * @property {string} title
 * @property {string} requirement
 * @property {string} evidence
 */

/**
 * @typedef {Object} ReviewAdvisory
 * @property {string} title
 * @property {string} detail
 */

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

const TOOL_PARAMS = Type.Object({
    approved: Type.Boolean({
        description: "Whether the implementation satisfies the plan requirements with no open blocking issues.",
    }),
    feedback: Type.Optional(Type.String({
        default: "",
        description:
            "Human-readable projection of your decision. When approved is false, summarize the blocking issues. When approved is true, this can be empty or contain brief notes.",
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

/**
 * Create the review_complete custom tool.
 *
 * @param {{
 *   hostedSession: import('../shared/session/hosted-session.js').HostedSession,
 *   agentName?: string,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createReviewCompletedTool(
    { hostedSession, agentName = "reviewer", recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric } =
        /** @type {any} */ ({}),
) {
    if (!hostedSession) throw new Error("createReviewCompletedTool: hostedSession is required");
    return defineTool({
        name: "review_complete",
        label: "Review Complete",
        description: "Signal that the semantic code review is complete with a structured result. " +
            "Call with `approved: true` when the implementation satisfies the plan and no blocking issue remains. " +
            "Call with `approved: false` plus a `findings` array when it does not; each finding is one concrete defect. " +
            "Report non-blocking observations as `advisories` — they never block approval. " +
            "Call this exactly once when you have finished reviewing. Do not output text after calling this tool.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            await Promise.resolve();
            const approved = params.approved === true;
            const feedback = typeof params.feedback === "string" ? params.feedback.trim() : "";
            const findings = normalizeFindings(params.findings);
            const advisories = normalizeAdvisories(params.advisories);
            const openFindings = findings.filter((finding) => !finding.resolved);

            // Fail closed on an internally inconsistent result rather than letting an
            // approval with open blocking issues through.
            if (approved && openFindings.length > 0) {
                const rejection = `Cannot approve with ${openFindings.length} unresolved finding(s). ` +
                    "Either resolve them (resolved: true, after verifying the fix in the code) or call " +
                    "review_complete with approved: false.";
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "review_complete",
                    agentName,
                    details: { outcome: "rejected", reason: "approved_with_open_findings" },
                });
                return {
                    content: [{ type: "text", text: `review_complete rejected: ${rejection}` }],
                    details: { outcome: "rejected", reason: "approved_with_open_findings" },
                    terminate: false,
                };
            }

            const outcome = approved ? "approved" : "feedback";
            const projection = feedback || formatFindingsProjection(openFindings);
            const message = approved
                ? "Semantic review approved — implementation matches the plan."
                : `Semantic review rejected — issues found:\n${projection || "(no feedback provided)"}`;

            emitReviewResultMessage(hostedSession, agentName, message, approved);
            await recordWorkflowMetricImpl({
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
            });

            return {
                content: [{ type: "text", text: message }],
                details: { outcome, approved, feedback: projection, findings, advisories },
                terminate: true,
            };
        },
    });
}

/**
 * @param {unknown} value
 * @returns {ReviewFinding[]}
 */
function normalizeFindings(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const finding = /** @type {Record<string, unknown>} */ (entry);
        const title = typeof finding.title === "string" ? finding.title.trim() : "";
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

/**
 * @param {unknown} value
 * @returns {ReviewAdvisory[]}
 */
function normalizeAdvisories(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const advisory = /** @type {Record<string, unknown>} */ (entry);
        const title = typeof advisory.title === "string" ? advisory.title.trim() : "";
        if (!title) return [];
        return [{
            title,
            detail: typeof advisory.detail === "string" ? advisory.detail.trim() : "",
        }];
    });
}

/**
 * Render open findings as the readable projection when the Reviewer supplied
 * structure but no prose summary.
 *
 * @param {ReviewFinding[]} openFindings
 * @returns {string}
 */
function formatFindingsProjection(openFindings) {
    return openFindings
        .map((finding) => {
            const parts = [`- ${finding.id ? `[${finding.id}] ` : ""}${finding.title}`];
            if (finding.requirement) parts.push(`  Plan: ${finding.requirement}`);
            if (finding.evidence) parts.push(`  Evidence: ${finding.evidence}`);
            return parts.join("\n");
        })
        .join("\n");
}
