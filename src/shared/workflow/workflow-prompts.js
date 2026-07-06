/**
 * @module shared/workflow/workflow-prompts
 * User prompts and agent request text used by workflow execution.
 */

import { CWD } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
import { getAgentDisplayName } from "../session/agents.js";
import { extractTasks, parseTaskDependencies, validateProjectTasks } from "./task-scheduling.js";

/**
 * @typedef {Object} SlicerChildSummary
 * @property {string} name
 * @property {number} [order]
 * @property {string} [status]
 * @property {string} [summary]
 * @property {string[]} [dependencies]
 * @property {string[]} [affectedPaths]
 */

/**
 * Build the user-request text handed to the interactive Epic Slicer.
 *
 * @param {{ planName?: string, epicMarkdown?: string, epicBody?: string, epicAttrs?: Partial<import('../../plan-store.js').PlanFrontMatter>, triageMeta?: import('../../tools/plan-written.js').TriageMeta, children?: SlicerChildSummary[] } | string} input
 * @param {import('../../tools/plan-written.js').TriageMeta | undefined} [legacyTriageMeta]
 * @returns {string}
 */
export function buildSlicerRequest(input, legacyTriageMeta) {
    const request = /** @type {{ planName?: string, epicMarkdown?: string, epicBody?: string, epicAttrs?: Partial<import('../../plan-store.js').PlanFrontMatter>, triageMeta?: import('../../tools/plan-written.js').TriageMeta, children?: SlicerChildSummary[] }} */
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
        `- Type: ${attrs.type || "unknown"}`,
        `- Status: ${attrs.status || "unknown"}`,
    ];

    if (attrs.summary) lines.push(`- Summary: ${attrs.summary}`);
    if (attrs.parentPlan) lines.push(`- Parent plan: ${attrs.parentPlan}`);
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
        }
    }
    lines.push(
        "",
        "Existing child drafts may contain user edits. Do not overwrite or update an existing child draft casually; explain the overwrite risk and ask for confirmation first.",
        "",
        "## Epic Markdown",
        epicText,
    );

    return lines.join("\n");
}

/**
 * Ask user what to do after plan approval.
 *
 * @param {string} planName
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<"proceed" | "save">}
 */
export async function askPostApproval(planName, uiAPI) {
    const title = `Plan "${planName}" approved! What next?`;
    const options = [
        { value: "proceed", label: "Proceed with execution" },
        { value: "save", label: "Save for later" },
    ];
    const choice = await uiAPI.promptSelect(title, options);
    return choice === "proceed" ? "proceed" : "save";
}

/**
 * Ask user whether to start PROJECT decomposition now or save the ready Epic for later.
 *
 * @param {string} planName
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<"proceed" | "save">}
 */
export async function askProjectDecompositionApproval(planName, uiAPI) {
    const title = `Project plan "${planName}" approved! What next?`;
    const options = [
        { value: "proceed", label: "Start Slicer decomposition now" },
        { value: "save", label: "Save for later" },
    ];
    const choice = await uiAPI.promptSelect(title, options);
    return choice === "proceed" ? "proceed" : "save";
}

/**
 * Project-specific post-approval selection that also prints task list.
 *
 * @param {string} planName
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} [structuredTasks]
 * @returns {Promise<"proceed" | "save">}
 */
export async function askApprovalWithTasks(planName, uiAPI, structuredTasks) {
    const plan = await loadPlan(CWD, planName);

    let tasks = structuredTasks || [];
    if (tasks.length === 0 && plan) {
        try {
            tasks = extractTasks(plan.markdown);
            validateProjectTasks(tasks);
        } catch {
            // Proceed with 0 tasks; execution will report repair needed if markdown also fails.
        }
    }

    let title = `Project plan "${planName}" approved!`;
    if (tasks.length > 0) {
        title += `\nTasks:\n` +
            tasks.map((t) => `  ${t.task}. [${t.assignee}] ${t.description}`).join(
                "\n",
            );
    }

    const options = [
        {
            value: "proceed",
            label: "Proceed with execution (tasks run in dependency order)",
        },
        { value: "save", label: "Save for later" },
    ];

    const choice = await uiAPI.promptSelect(`${title}\nWhat next?`, options);
    return choice === "proceed" ? "proceed" : "save";
}

/**
 * @param {{ failedTasks: number[], results: Map<number, { status: string, error?: string }> }} executionResult
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
export async function askRetryFailedTasks(executionResult, uiAPI) {
    const { failedTasks } = executionResult;
    const msg = `[RunWield] ${failedTasks.length} task(s) failed. Would you like to retry the failed tasks?`;
    return await uiAPI.promptSelect(msg, [
        { value: "yes", label: "Yes, retry failed tasks" },
        { value: "no", label: "No, finalize execution" },
    ]) === "yes";
}

/**
 * @param {{ results: Map<number, { status: string, error?: string }> }} result
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 */
export function reportExecutionSummary(result, uiAPI) {
    const { results } = result;
    let successCount = 0, failedCount = 0, blockedCount = 0;

    results.forEach((taskResult) => {
        if (taskResult.status === "success") successCount++;
        else if (taskResult.status === "failed") failedCount++;
        else if (taskResult.status === "blocked") blockedCount++;
    });

    const summary = `Execution Summary: ${successCount} success, ${failedCount} failed, ${blockedCount} blocked.`;
    uiAPI.appendSystemMessage(summary, false, "RunWield");
}

/**
 * @param {{ task: number, description: string }} task
 * @param {string} agentName
 * @param {string | null} outputText
 * @returns {string}
 */
export function buildTaskResultDisplay(task, agentName, outputText) {
    return `Task ${task.task} (${getAgentDisplayName(agentName)}) — ${task.description}\n\n` +
        (outputText || "(no output)");
}

/**
 * @param {{ dependencies: string }} task
 * @param {Map<number, import('./types.js').TaskExecutionResult>} results
 * @returns {string}
 */
export function buildDependencyOutputsContext(task, results) {
    const outputs = parseTaskDependencies(task.dependencies)
        .map((dependencyId) => results.get(dependencyId))
        .filter((result) => result?.status === "success" && result.display)
        .map((result) => result?.display || "");

    return outputs.join("\n\n---\n\n");
}

/**
 * @param {string} planName
 * @param {string} planBody
 * @param {{ task: number, dependencies: string, description: string, writeScope?: string }} task
 * @param {Map<number, import('./types.js').TaskExecutionResult>} results
 * @returns {string}
 */
export function buildTaskAssignmentRequest(planName, planBody, task, results) {
    const dependencyOutputs = buildDependencyOutputsContext(task, results);
    return [
        "## Task Assignment",
        `You are assigned Task ${task.task} from the plan "${planName}". This is a PROJECT plan; only execute the assigned task, then call task_completed with a concise success or failure summary.`,
        "### Task Description",
        task.description,
        "### Dependencies",
        task.dependencies || "None",
        dependencyOutputs ? "### Dependency Outputs" : "",
        dependencyOutputs,
        "### Write Scope",
        task.writeScope || "unknown",
        "### Full Plan Context",
        planBody,
    ].filter(Boolean).join("\n\n");
}

/**
 * @param {string} planName
 * @param {string} planBody
 * @returns {string}
 */
export function buildEngineerRequest(planName, planBody) {
    return [
        `## Approved Plan: ${planName}`,
        "",
        "Execute the following plan step by step. This is a FEATURE request. Complete all Implementation Steps and the Verification Plan, then call task_completed with a concise success or failure summary.",
        "",
        planBody,
    ].join("\n");
}
