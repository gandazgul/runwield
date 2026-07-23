/**
 * @module shared/workflow/workflow-prompts
 * User prompts and agent request text used by workflow execution.
 */

/**
 * @typedef {Object} SlicerChildSummary
 * @property {string} name
 * @property {number} [order]
 * @property {string} [status]
 * @property {string} [summary]
 * @property {string[]} [dependencies]
 * @property {string[]} [affectedPaths]
 * @property {import('../ticket-references.js').TicketReference[]} [tickets]
 */

/**
 * Build the user-request text handed to the interactive Epic Slicer.
 *
 * @param {{ planName?: string, epicMarkdown?: string, epicBody?: string, epicAttrs?: Partial<import('../../plan-store.js').PlanFrontMatter>, triageMeta?: import('../../tools/plan-written.js').TriageMeta, children?: SlicerChildSummary[], reviewFeedback?: string } | string} input
 * @param {import('../../tools/plan-written.js').TriageMeta | undefined} [legacyTriageMeta]
 * @returns {string}
 */
export function buildSlicerRequest(input, legacyTriageMeta) {
    const request = /** @type {{ planName?: string, epicMarkdown?: string, epicBody?: string, epicAttrs?: Partial<import('../../plan-store.js').PlanFrontMatter>, triageMeta?: import('../../tools/plan-written.js').TriageMeta, children?: SlicerChildSummary[], reviewFeedback?: string }} */
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
        "First propose or refine child FEATURE boundaries conversationally. Do not finalize or write child files unless the user explicitly confirms finalization.",
        "Follow the Slicer system prompt: discuss FEATURE boundaries first; use the workflow tool for materialization/finalization only when explicitly requested.",
        "",
        "## Epic Lifecycle State",
        `- Plan: plans/${planName}.md`,
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

    lines.push("## Existing Child FEATURE Plans");
    if (children.length === 0) {
        lines.push("No child FEATURE plans exist yet.");
    } else {
        for (const child of children) {
            lines.push(`- ${child.name}`);
            if (child.order !== undefined) lines.push(`  - Order: ${child.order}`);
            if (child.status) lines.push(`  - Status: ${child.status}`);
            if (child.summary) lines.push(`  - Summary: ${child.summary}`);
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
 * @param {"autonomous"|"pair"} recommendation
 * @returns {string}
 */
export function buildCollaborationStylePrompt(recommendation) {
    const recommended = recommendation === "pair" ? "Pair Execution" : "Autonomous execution";
    return [
        "Choose the Frontend Engineer execution style for this approved Plan.",
        `Planner recommendation: ${recommended}.`,
        "Pair Execution pauses after coherent visible increments for your direction; autonomous execution runs AFK and verifies at the end.",
    ].join("\n");
}

/**
 * @param {string} planName
 * @param {string} planBody
 * @param {string} [reviewFeedback]
 * @param {{ collaborationStyle?: "autonomous"|"pair" }} [options]
 * @returns {string}
 */
export function buildEngineerRequest(planName, planBody, reviewFeedback, options = {}) {
    const lines = [
        `## Approved Plan: ${planName}`,
        "",
        "Execute the following plan step by step. This is a FEATURE request. Complete all Implementation Steps and the Verification Plan, then call task_completed with a concise bullet-point success or failure report.",
        "",
    ];
    if (options.collaborationStyle === "pair") {
        lines.push(
            "## Runtime Collaboration Style",
            "Pair Execution is active. Work in coherent visible increments, inspect the headed browser before each checkpoint, call pair_checkpoint for user direction after each meaningful increment, and do not call task_completed until the full Plan and final verification are complete.",
            "",
        );
    } else if (options.collaborationStyle === "autonomous") {
        lines.push(
            "## Runtime Collaboration Style",
            "Autonomous execution is active. Do not use Pair checkpoint ceremony; complete the Plan and final verification before task_completed.",
            "",
        );
    }
    lines.push(
        planBody,
    );
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
