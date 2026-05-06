/**
 * @module plan-written
 * Custom tool for planning agents (Planner/Architect) to declare a plan and
 * trigger the full review/save/execute lifecycle.
 *
 * createPlanWrittenTool captures TUI context, session manager, and triage metadata
 * at session-start time. Calling the tool runs the lifecycle in execute() and
 * returns the outcome via tool result so the planner can react in the same session
 * (e.g., revising on user feedback, repairing on malformed task tables).
 */

import { join } from "@std/path";
import { Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { CLI_BIN, CWD, PLANS_DIR_NAME } from "../constants.js";
import { loadPlan } from "../plan-store.js";

/**
 * @typedef {{
 *   task: number,
 *   assignee: string,
 *   dependencies: string,
 *   description: string
 * }} PlanTask
 */

/**
 * @typedef {{
 *   classification?: string,
 *   complexity?: string,
 *   summary?: string,
 *   affectedPaths?: string[]
 * }} TriageMeta
 */

const TOOL_PARAMS = Type.Object({
    planName: Type.String({
        description: "Plan filename without extension (kebab-case preferred), e.g. implement-memory-system",
    }),
    tasks: Type.Optional(Type.Array(
        Type.Object({
            task: Type.Number({ description: "Unique task ID (e.g. 1)" }),
            assignee: Type.String({ description: "Assigned agent role, one of: engineer, doc-writer, tester" }),
            dependencies: Type.String({
                description: "Comma-separated list of prerequisite task IDs, or empty string if none",
            }),
            description: Type.String({ description: "What needs to be done in this task" }),
        }),
        {
            description: "Required for PROJECT plans. Array of tasks reflecting the markdown Tasks table.",
        },
    )),
});

/**
 * Build the planner/architect revision request after the user submits feedback
 * via the review UI. Surfaced as the plan_written tool result so the agent can
 * revise in-session.
 *
 * @param {{ round: number, planName: string, feedback: string | undefined }} opts
 * @returns {string}
 */
function buildFeedbackRequestText({ round, planName, feedback }) {
    return [
        `## Plan Review Feedback (Round ${round})`,
        "",
        "The user provided feedback on the plan:",
        "",
        feedback || "(no specific feedback provided)",
        "",
        `Please revise plans/${planName}.md based on this feedback.`,
        "Use the `edit` tool to make targeted revisions — do NOT rewrite the entire plan.",
        "Address each piece of feedback specifically.",
        "After saving revisions, call plan_written again with the same plan name.",
    ].join("\n");
}

/**
 * Build the repair prompt returned to the agent when a PROJECT plan's task table
 * could not be parsed during execution.
 *
 * @param {string} planName
 * @param {string} error
 * @returns {string}
 */
function buildRepairFeedbackText(planName, error) {
    return [
        `## Plan Execution Halted — Task Table Repair Required`,
        "",
        `The previously approved plan "${planName}" had a malformed Tasks table: ${error}.`,
        "",
        "Fix the table to follow the required format (Task ID | Assignee | Dependencies | Description).",
        "If any requirement is unclear, use user_interview (1-3 focused questions) before finalizing.",
        "Then call plan_written again with the corrected tasks array.",
    ].join("\n");
}

/**
 * @param {string} text
 * @param {unknown} [details]
 * @returns {import('@mariozechner/pi-coding-agent').AgentToolResult<unknown>}
 */
function textResult(text, details) {
    return {
        content: [{ type: "text", text }],
        details: details ?? null,
    };
}

/**
 * Resolve effective triage metadata. Prefer explicit triageMeta passed at
 * factory creation; otherwise fall back to the plan's persisted front matter.
 *
 * @param {TriageMeta | undefined} triageMeta
 * @param {string} planName
 * @returns {Promise<TriageMeta>}
 */
async function resolveTriageMeta(triageMeta, planName) {
    if (triageMeta && triageMeta.classification) return triageMeta;
    try {
        const plan = await loadPlan(CWD, planName);
        if (plan?.attrs) {
            return /** @type {TriageMeta} */ ({ ...triageMeta, ...plan.attrs });
        }
    } catch {
        /* ignore */
    }
    return triageMeta || {};
}

/**
 * Create the plan_written tool with lifecycle context captured at session start.
 *
 * @param {{
 *   uiAPI?: import('../shared/workflow/workflow.js').UiAPI,
 *   sessionManager?: import('@mariozechner/pi-coding-agent').SessionManager,
 *   triageMeta?: TriageMeta,
 *   agentName?: string,
 * }} [opts]
 * @returns {import('@mariozechner/pi-coding-agent').ToolDefinition}
 */
export function createPlanWrittenTool(
    { uiAPI, sessionManager, triageMeta, agentName = "planner" } = {},
) {
    return defineTool({
        name: "plan_written",
        label: "Plan Written",
        description: "Declare the plan filename you created in plans/ and submit it for user review. " +
            "This triggers the full lifecycle (review → approve/save/execute or revise). " +
            "Call this once after writing the plan; the user reviews it in a browser UI. " +
            "If denied, the tool result contains the user's feedback so you can revise in this same session.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const planName = String(params.planName || "").replace(/\.md$/i, "").trim();
            const structuredTasks = /** @type {PlanTask[] | undefined} */ (params.tasks);

            if (!planName) {
                return textResult(
                    "plan_written: planName is empty. Provide the plan filename (without .md) and call again.",
                );
            }

            const planPath = join(CWD, PLANS_DIR_NAME, `${planName}.md`);
            try {
                const stat = await Deno.stat(planPath);
                if (!stat.isFile) {
                    return textResult(
                        `plan_written: plans/${planName}.md is not a file. Write the plan markdown first, then call plan_written again.`,
                    );
                }
            } catch {
                return textResult(
                    `plan_written: plans/${planName}.md not found. Write the plan first using the write tool, then call plan_written.`,
                );
            }

            const effectiveMeta = await resolveTriageMeta(triageMeta, planName);

            if (
                effectiveMeta.classification === "PROJECT" &&
                (!structuredTasks || structuredTasks.length === 0)
            ) {
                return textResult(
                    "plan_written: PROJECT plans require a non-empty `tasks` array. " +
                        "Add tasks (each with task id, assignee, dependencies, description) and call plan_written again.",
                );
            }

            uiAPI?.appendSystemMessage(`[Harns] Plan declared: plans/${planName}.md`);

            // Lazy imports break the circular dep: plan-written → workflow → session → plan-written.
            const { submitPlanForReview } = await import("../shared/workflow/submit-plan.js");
            const { askApprovalWithTasks, askPostApproval, executePlan } = await import(
                "../shared/workflow/workflow.js"
            );

            const reviewResult = await submitPlanForReview({
                cwd: CWD,
                planName,
                planPath,
                triageMeta: effectiveMeta,
                uiAPI,
            });

            if (reviewResult.canceled) {
                uiAPI?.appendSystemMessage("[Harns] Plan review canceled. Returning control to user.");
                return textResult(
                    "Plan review canceled by the user. Stop generating; control has returned to the user.",
                    { ...params, outcome: "canceled" },
                );
            }

            if (!reviewResult.approved) {
                return textResult(
                    buildFeedbackRequestText({
                        round: 1,
                        planName,
                        feedback: reviewResult.feedback,
                    }),
                    { ...params, outcome: "denied", feedback: reviewResult.feedback },
                );
            }

            const action = effectiveMeta.classification === "PROJECT"
                ? await askApprovalWithTasks(planName, uiAPI, structuredTasks)
                : await askPostApproval(planName, uiAPI);

            if (action !== "proceed") {
                uiAPI?.appendSystemMessage(
                    `[Harns] Plan saved. Resume later with: ${CLI_BIN} resume ${planName}`,
                );
                return textResult(
                    `Plan "${planName}" approved and saved for later execution. Your role as ${agentName} is complete. Do not generate any further text.`,
                    { ...params, outcome: "saved", planName },
                );
            }

            const execRes = await executePlan(
                planName,
                effectiveMeta,
                uiAPI,
                structuredTasks,
                sessionManager,
            );

            if (execRes && execRes.repairRequired) {
                return textResult(
                    buildRepairFeedbackText(planName, execRes.error || "Unknown task table error"),
                    { ...params, outcome: "repair_required", error: execRes.error },
                );
            }

            return textResult(
                `Plan "${planName}" executed successfully. Your role as ${agentName} is complete. Do not generate any further text.`,
                { ...params, outcome: "executed", planName },
            );
        },
    });
}
