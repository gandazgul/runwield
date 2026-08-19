/**
 * @module shared/workflow/workflow-prompts
 * User prompts and agent request text used by workflow execution.
 */

import { AGENTS } from "../../constants.js";
import { projectEngineerPlanBody } from "./engineer-plan-projection.ts";

/**
 * @typedef {Object} TriageReportContext
 * @property {string} [routingIntent]
 * @property {string} [classification]
 * @property {string} [workKind]
 * @property {string} [sessionName]
 * @property {string} [complexity]
 * @property {string} [summary]
 * @property {string[]} [affectedPaths]
 */

/**
 * @typedef {Object} SlicerChildSummary
 * @property {string} name
 * @property {number} [order]
 * @property {string} [status]
 * @property {string} [summary]
 * @property {string} [workKind]
 * @property {string[]} [dependencies]
 * @property {string[]} [affectedPaths]
 * @property {import('../ticket-references.js').TicketReference[]} [tickets]
 */

/**
 * Build the structured Router-style triage context shared by specialist
 * handoffs. Planned execution can reconstruct the context from canonical Plan
 * front matter when the original Router Session is not available.
 *
 * @param {TriageReportContext} triage
 * @param {{ plannedExecution?: boolean }} [options]
 * @returns {string}
 */
export function buildTriageReport(triage, options = {}) {
    const inferredPlannedClassification = triage.classification === "PROJECT" ? "PROJECT" : "PLANNED_CHANGE";
    const routingIntent = triage.routingIntent ||
        (options.plannedExecution ? inferredPlannedClassification : undefined);
    const classification = triage.classification ||
        (options.plannedExecution ? inferredPlannedClassification : undefined);
    const lines = ["## Triage Report"];

    if (routingIntent) lines.push(`- Routing Intent: ${routingIntent}`);
    if (classification) lines.push(`- Plan Classification: ${classification}`);
    if (triage.workKind) lines.push(`- Work Kind: ${triage.workKind}`);
    if (triage.sessionName) lines.push(`- Session Name: ${triage.sessionName}`);
    if (triage.complexity) lines.push(`- Complexity: ${triage.complexity}`);
    if (triage.summary) lines.push(`- Summary: ${triage.summary}`);
    if (Array.isArray(triage.affectedPaths)) {
        lines.push(`- Affected paths: ${triage.affectedPaths.join(", ")}`);
    }

    return lines.join("\n");
}

/**
 * Build the first user message after Router dispatch. A single persisted
 * transcript can contain assistant reasoning from several RunWield Agents, so
 * name the newly active Agent explicitly instead of asking the model to infer
 * its role from the conversation history.
 *
 * @param {string} agentDisplayName
 * @param {string} userRequest
 * @param {TriageReportContext} triage
 * @returns {string}
 */
export function buildAgentHandoffRequest(agentDisplayName, userRequest, triage) {
    return [
        "## Active RunWield Agent",
        `You are now ${agentDisplayName}. Follow the ${agentDisplayName} instructions in the system prompt.`,
        "Earlier assistant messages and tool results may belong to a previous RunWield Agent; they are context, not your current role.",
        "",
        "## User Request",
        userRequest,
        "",
        buildTriageReport(triage),
    ].join("\n");
}

/**
 * Build the user-request text handed to the interactive Epic Slicer.
 *
 * @param {{ planName?: string, epicMarkdown?: string, epicBody?: string, epicAttrs?: Partial<import('../../plan-store.js').PlanFrontMatter>, triageMeta?: import('../../tools/plan-written.ts').TriageMeta, children?: SlicerChildSummary[], reviewFeedback?: string } | string} input
 * @param {import('../../tools/plan-written.ts').TriageMeta | undefined} [legacyTriageMeta]
 * @returns {string}
 */
export function buildSlicerRequest(input, legacyTriageMeta) {
    const request = /** @type {{ planName?: string, epicMarkdown?: string, epicBody?: string, epicAttrs?: Partial<import('../../plan-store.js').PlanFrontMatter>, triageMeta?: import('../../tools/plan-written.ts').TriageMeta, children?: SlicerChildSummary[], reviewFeedback?: string }} */
        (typeof input === "string" ? { planName: input, triageMeta: legacyTriageMeta } : input);
    const planName = request.planName || "unknown";
    const attrs = request.epicAttrs || {};
    const triageMeta = request.triageMeta;
    const children = request.children || [];
    const epicText = request.epicBody || request.epicMarkdown || "(Epic body unavailable.)";

    const lines = [
        `## Epic Slicer Session: ${planName}`,
        `## Slice Plan: ${planName}`,
        "",
        "You are resuming an interactive Slicer conversation for this PROJECT Epic.",
        "First propose or refine child planned-change boundaries conversationally. Do not finalize or write child files unless the user explicitly confirms finalization.",
        "Follow the Slicer system prompt: discuss planned-change boundaries first; use the workflow tool for materialization/finalization only when explicitly requested.",
        "",
        "## Epic Lifecycle State",
        `- Plan: docs/plans/${planName}.md`,
        `- Classification: ${attrs.classification || "unknown"}`,
        `- Status: ${attrs.status || "unknown"}`,
    ];

    if (attrs.summary) lines.push(`- Summary: ${attrs.summary}`);
    if (attrs.parentPlan) lines.push(`- Parent plan: ${attrs.parentPlan}`);
    if (attrs.worktreeBaseBranch) lines.push(`- Target branch: ${attrs.worktreeBaseBranch}`);
    if (Array.isArray(attrs.tickets) && attrs.tickets.length) {
        lines.push("- Epic Ticket references (context only; do not copy to every child):");
        for (const ticket of attrs.tickets) {
            if (ticket && typeof ticket.url === "string") lines.push(`  - ${ticket.url}`);
        }
    }
    if (Array.isArray(attrs.dependencies) && attrs.dependencies.length) {
        lines.push(`- Epic dependencies: ${attrs.dependencies.join(", ")}`);
    }
    if (Array.isArray(attrs.affectedPaths) && attrs.affectedPaths.length) {
        lines.push(`- Epic affected paths: ${attrs.affectedPaths.join(", ")}`);
    }
    lines.push("");

    if (triageMeta) {
        lines.push("## Triage Report");
        lines.push("## Triage Metadata");
        if (triageMeta.classification) lines.push(`- Classification: ${triageMeta.classification}`);
        if (triageMeta.workKind) lines.push(`- Work Kind: ${triageMeta.workKind}`);
        if (triageMeta.complexity) lines.push(`- Complexity: ${triageMeta.complexity}`);
        if (triageMeta.summary) lines.push(`- Summary: ${triageMeta.summary}`);
        if (triageMeta.affectedPaths?.length) {
            lines.push(`- Affected paths: ${triageMeta.affectedPaths.join(", ")}`);
        }
        lines.push("");
    }

    if (request.reviewFeedback) {
        lines.push(
            "## Annotations Submitted With Approval",
            "These notes are implementation context carried forward from Plan Review; the Plan remains approved.",
            "",
            request.reviewFeedback,
            "",
        );
    }

    lines.push("## Existing Child Plans");
    if (children.length === 0) {
        lines.push("No child plans exist yet.");
    } else {
        for (const child of children) {
            lines.push(`- ${child.name}`);
            if (child.order !== undefined) lines.push(`  - Order: ${child.order}`);
            if (child.status) lines.push(`  - Status: ${child.status}`);
            if (child.summary) lines.push(`  - Summary: ${child.summary}`);
            if (child.workKind) lines.push(`  - Work Kind: ${child.workKind}`);
            if (child.dependencies?.length) lines.push(`  - Dependencies: ${child.dependencies.join(", ")}`);
            if (child.affectedPaths?.length) lines.push(`  - Affected paths: ${child.affectedPaths.join(", ")}`);
            if (child.tickets?.length) {
                lines.push(`  - Direct Ticket references: ${child.tickets.map((ticket) => ticket.url).join(", ")}`);
            }
        }
    }
    lines.push(
        "",
        "Existing child drafts may contain user edits and direct Ticket References. Do not overwrite or update an existing child draft casually; explain the overwrite risk and ask for confirmation first. When updating a child descriptor, omit tickets to preserve existing direct child Ticket References, use tickets: [] only when explicitly clearing them, and never copy all Epic Ticket References into every child.",
        "",
        "## Epic Markdown",
        epicText,
    );

    return lines.join("\n");
}

/**
 * @typedef {Object} ReAnchorArtifact
 * @property {string} label - How the agent's own prompt refers to its durable artifact.
 * @property {string} sections - The sections worth rereading, in the artifact's own order.
 */

/**
 * The durable artifact each agent must re-anchor on after compaction.
 *
 * The entry carries only the artifact's name and its sections. Why the reread
 * matters belongs to the agent prompt, and duplicating it here is exactly the
 * drift this table exists to avoid. An agent absent from the table has no
 * durable artifact — a Delegated Agent Session has a brief, a Reviewer has a
 * diff — so it is never re-anchored.
 *
 * @type {Readonly<Record<string, ReAnchorArtifact>>}
 */
const RE_ANCHOR_ARTIFACTS = Object.freeze({
    [AGENTS.PLANNER]: {
        label: "draft Plan",
        sections: "Objective, Approach, Implementation Steps, and Verification Plan",
    },
    [AGENTS.ARCHITECT]: {
        label: "Epic",
        sections: "Objective, Vertical Slice Findings, Files to Modify, and Verification Plan",
    },
    [AGENTS.PLAN_ENGINEER]: {
        label: "Plan",
        sections: "Implementation Steps, Verification Plan, and Edge Cases & Considerations",
    },
    [AGENTS.FRONTEND_ENGINEER]: {
        label: "Plan",
        sections: "Implementation Steps, Verification Plan, and Edge Cases & Considerations",
    },
    [AGENTS.REVIEWER_FEEDBACK_ENGINEER]: {
        label: "Plan",
        sections: "Implementation Steps and Verification Plan",
    },
});

/**
 * @typedef {Object} ReAnchorContext
 * @property {string} [agentName]
 * @property {string} [planName] - Normalized Plan name: no `docs/plans/` prefix, no `.md` suffix.
 * @property {string} [planBody] - Parsed Plan body for execution agents. Never includes Front Matter.
 * @property {string} [openReviewItems] - Rendered open Review Issue Ledger items for a repair turn.
 */

/**
 * Build the message injected into the first provider request after compaction,
 * pointing the active agent back at the artifact the discarded context was
 * about.
 *
 * Returns null — and nothing is injected — when the agent has no durable
 * artifact or when no Plan pointer survived, because a re-anchor that names no
 * file is noise.
 *
 * @param {ReAnchorContext} [context]
 * @returns {string | null}
 */
export function buildReAnchorMessage(context = {}) {
    const agentName = typeof context.agentName === "string" ? context.agentName.trim() : "";
    const artifact = RE_ANCHOR_ARTIFACTS[agentName];
    if (!artifact) return null;

    const planName = typeof context.planName === "string" ? context.planName.trim() : "";
    if (!planName) return null;

    const executionAgent = agentName === AGENTS.PLAN_ENGINEER ||
        agentName === AGENTS.FRONTEND_ENGINEER ||
        agentName === AGENTS.REVIEWER_FEEDBACK_ENGINEER;
    const planBody = typeof context.planBody === "string" ? projectEngineerPlanBody(context.planBody) : "";
    if (executionAgent && !planBody) return null;

    const lines = [
        "## Context Re-Anchor",
        "",
        ...(executionAgent
            ? [
                `Context was compacted. Continue from the approved ${artifact.label} body below.`,
                `Focus on ${artifact.sections}. Do not reread the raw Plan file; its Front Matter is orchestration metadata.`,
                "",
                "## Approved Plan Body",
                "",
                planBody,
            ]
            : [
                `Context was compacted. Your ${artifact.label} is \`docs/plans/${planName}.md\`.`,
                `Reread it before continuing: ${artifact.sections}.`,
            ]),
    ];

    if (agentName === AGENTS.REVIEWER_FEEDBACK_ENGINEER) {
        const openReviewItems = typeof context.openReviewItems === "string" ? context.openReviewItems.trim() : "";
        if (openReviewItems && openReviewItems !== "(none)") {
            lines.push("", "## Open Review Issue Ledger", "", openReviewItems);
        }
    }

    return lines.join("\n");
}

/**
 * @param {string} planName
 * @param {string} planBody
 * @param {string} [reviewFeedback]
 * @param {{
 *   collaborationStyle?: "autonomous"|"pair",
 *   routerMessage?: string,
 * }} [options]
 * @returns {string}
 */
export function buildEngineerRequest(planName, planBody, reviewFeedback, options = {}) {
    const lines = [`## Approved Plan: ${planName}`, ""];

    if (options.routerMessage) {
        lines.push(
            "## Router Handoff Message",
            options.routerMessage,
            "",
        );
    }

    if (options.collaborationStyle === "pair") {
        lines.push(
            "## Runtime Collaboration Style",
            "Pair Execution is active.",
            "",
        );
    } else if (options.collaborationStyle === "autonomous") {
        lines.push(
            "## Runtime Collaboration Style",
            "Autonomous execution is active.",
            "",
        );
    }

    lines.push("## Approved Plan Body", "", projectEngineerPlanBody(planBody));

    if (reviewFeedback) {
        lines.push(
            "",
            "## Annotations Submitted With Approval",
            "These notes are implementation context carried forward from Plan Review; the Plan remains approved.",
            "",
            reviewFeedback,
        );
    }
    return lines.join("\n");
}
