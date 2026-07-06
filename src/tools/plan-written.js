/**
 * @module plan-written
 * Custom tool for planning agents (Planner/Architect) to declare a plan and
 * run the review-and-approve lifecycle.
 *
 * createPlanWrittenTool captures TUI context and triage metadata at session-start
 * time. The tool runs review (and optional save-vs-execute prompt) inside execute,
 * but does NOT execute the plan — that's the orchestrator's job after the planning
 * session ends. The outcome (`approved_execute`, `saved`, `feedback`, `canceled`,
 * `repair_required`) is returned via `details.outcome` so the orchestrator can
 * dispatch the next agent, while `feedback` and `repair_required` keep the planner
 * in-session to iterate.
 */

import { join } from "@std/path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { CLI_BIN, CWD, PLANS_DIR_NAME } from "../constants.js";
import { loadPlan } from "../plan-store.js";
import { isEpicPlan, recordPlanEvent } from "../shared/workflow/plan-lifecycle.js";

/**
 * @typedef {{
 *   classification?: "QUICK_FIX" | "FEATURE" | "PROJECT",
 *   complexity?: "LOW" | "MEDIUM" | "HIGH",
 *   summary?: string,
 *   affectedPaths?: string[],
 *   type?: string
 * }} TriageMeta
 */

const TOOL_PARAMS = Type.Object({
    planName: Type.String({
        description: "Plan filename without extension (kebab-case preferred), e.g. implement-memory-system",
    }),
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
 * @param {string} text
 * @param {unknown} [details]
 * @param {boolean} [terminate]
 * @returns {import('@earendil-works/pi-coding-agent').AgentToolResult<unknown>}
 */
function textResult(text, details, terminate) {
    /** @type {import('@earendil-works/pi-coding-agent').AgentToolResult<unknown>} */
    const result = {
        content: [{ type: "text", text }],
        details: details ?? null,
    };
    if (terminate) result.terminate = true;
    return result;
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
 * @typedef {Object} PlanWrittenDeps
 * @property {(opts: { cwd: string, planName: string, planPath: string, triageMeta: TriageMeta, uiAPI: any }) => Promise<{ canceled?: boolean, approved?: boolean, feedback?: string }>} [submitPlanForReview]
 * @property {(planName: string, uiAPI: any) => Promise<"proceed" | "save">} [askApprovalWithTasks]
 * @property {(planName: string, uiAPI: any) => Promise<"proceed" | "save">} [askPostApproval]
 * @property {(planName: string, uiAPI: any) => Promise<"proceed" | "save">} [askProjectDecompositionApproval]
 * @property {(opts: { planName: string, planPath: string, triageMeta?: TriageMeta, uiAPI: any }) => Promise<{ ok: true, slicerInvoked: boolean } | { ok: false, error: string, stage: "slicer" | "validation" }>} [ensureSlicerTasks]
 * @property {(opts: { planName: string, triageMeta?: TriageMeta, uiAPI: any, sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager }) => Promise<{ ok: true } | { ok: false, error: string }>} [runSlicerAgent]
 * @property {typeof recordPlanEvent} [recordPlanEvent]
 * @property {(path: string) => Promise<{ isFile: boolean }>} [stat]
 * @property {string} [cwd]
 */

/**
 * Create the plan_written tool with lifecycle context captured at session start.
 *
 * @param {{
 *   uiAPI: import('../shared/workflow/workflow.js').UiAPI,
 *   triageMeta?: TriageMeta,
 *   agentName?: string,
 *   hostedSession?: import('../shared/session/hosted-session.js').HostedSession,
 *   __deps?: PlanWrittenDeps,
 * }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createPlanWrittenTool(
    { uiAPI, triageMeta, agentName = "planner", hostedSession, __deps } = /** @type {any} */ ({}),
) {
    if (!uiAPI) throw new Error("createPlanWrittenTool: uiAPI is required");
    const deps = __deps || {};
    const cwd = deps.cwd ?? CWD;
    return defineTool({
        name: "plan_written",
        label: "Plan Written",
        description: "Declare the plan filename you created in plans/ and submit it for user review. " +
            "Triggers review and (on approval) a save-vs-execute prompt. Execution itself runs after " +
            "your turn ends — orchestrator picks it up from this tool's outcome. " +
            "Call this once after writing the plan; the user reviews it in a browser UI. " +
            "If the user submits feedback instead of approving, the tool result contains that feedback so you can " +
            "revise in this same session.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const planName = String(params.planName || "").replace(/\.md$/i, "").trim();

            if (!planName) {
                return textResult(
                    "plan_written: planName is empty. Provide the plan filename (without .md) and call again.",
                );
            }

            const planPath = join(cwd, PLANS_DIR_NAME, `${planName}.md`);
            const statFn = deps.stat || Deno.stat.bind(Deno);
            try {
                const stat = await statFn(planPath);
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

            uiAPI.appendSystemMessage(`Plan declared: plans/${planName}.md`, false, "RunWield");

            // Lazy imports break the circular dep: plan-written → workflow → session → plan-written.
            const submitPlanForReview = deps.submitPlanForReview ||
                (await import("../shared/workflow/submit-plan.js")).submitPlanForReview;
            const workflow = await import("../shared/workflow/workflow.js");
            const askPostApproval = deps.askPostApproval || workflow.askPostApproval;
            const askProjectDecompositionApproval = deps.askProjectDecompositionApproval ||
                workflow.askProjectDecompositionApproval;
            const ensureSlicerTasks = deps.ensureSlicerTasks || workflow.ensureSlicerTasks;
            const runSlicerAgent = deps.runSlicerAgent || workflow.runSlicerAgent;
            const recordPlanEventFn = deps.recordPlanEvent || recordPlanEvent;

            const reviewResult = await submitPlanForReview({
                cwd,
                planName,
                planPath,
                triageMeta: effectiveMeta,
                uiAPI,
                hostedSession,
            });

            if (reviewResult.canceled) {
                uiAPI.appendSystemMessage("Plan review canceled. Returning control to user.", false, "RunWield");
                return textResult(
                    "Plan review canceled by the user. Stop generating; control has returned to the user.",
                    { ...params, outcome: "canceled" },
                    true,
                );
            }

            if (!reviewResult.approved) {
                return textResult(
                    buildFeedbackRequestText({
                        round: 1,
                        planName,
                        feedback: reviewResult.feedback,
                    }),
                    { ...params, outcome: "feedback", feedback: reviewResult.feedback },
                );
            }

            if (effectiveMeta.classification === "PROJECT") {
                const projectMeta = { ...effectiveMeta, type: effectiveMeta.type || "epic" };
                await recordPlanEventFn({
                    cwd,
                    planName,
                    event: "epic_readiness_passed",
                    currentStatus: "approved",
                    details: { triageMeta: projectMeta },
                });
                uiAPI.appendSystemMessage(
                    `PROJECT plan ready for decomposition or child plan selection: ${planName}`,
                    false,
                    "RunWield",
                );

                const action = await askProjectDecompositionApproval(planName, uiAPI);
                if (action !== "proceed") {
                    uiAPI.appendSystemMessage(
                        `Plan saved. Resume later with: ${CLI_BIN} load-plan ${planName}`,
                        false,
                        "RunWield",
                    );
                    const savedFeedbackSuffix = reviewResult.feedback
                        ? `\n\nFeedback/annotations from review: ${reviewResult.feedback}`
                        : "";
                    return textResult(
                        `Plan "${planName}" approved and saved for later decomposition. Your role as ${agentName} is complete. Do not generate any further text.${savedFeedbackSuffix}`,
                        { ...params, outcome: "saved", planName, triageMeta: projectMeta },
                        true,
                    );
                }

                // Run the slicer on the root session so its output is part of the single
                // continuous session file (not a forked / in-memory session).
                const sessionManager = hostedSession?.getRootSessionManager?.() || undefined;

                if (isEpicPlan(projectMeta)) {
                    const slicerResult = await runSlicerAgent({
                        planName,
                        triageMeta: projectMeta,
                        uiAPI,
                        hostedSession,
                        sessionManager,
                    });
                    if (!slicerResult.ok) {
                        return textResult(
                            `plan_written: the slicer agent failed for plans/${planName}.md: ${slicerResult.error}`,
                            { ...params, outcome: "feedback", feedback: slicerResult.error },
                        );
                    }
                    const slicerFeedbackSuffix = reviewResult.feedback
                        ? `\n\nFeedback/annotations from review: ${reviewResult.feedback}`
                        : "";
                    return textResult(
                        `PROJECT Epic "${planName}" approved and Slicer decomposition started. Your role as ${agentName} is complete. Do not generate any further text.${slicerFeedbackSuffix}`,
                        { ...params, outcome: "saved", planName, triageMeta: projectMeta },
                        true,
                    );
                }

                const sliceResult = await ensureSlicerTasks({
                    planName,
                    planPath,
                    triageMeta: effectiveMeta,
                    uiAPI,
                    hostedSession,
                    sessionManager,
                });

                if (!sliceResult.ok) {
                    const intro = sliceResult.stage === "slicer"
                        ? `plan_written: the slicer agent failed to produce tasks for plans/${planName}.md`
                        : `plan_written: slicer ran but the resulting Tasks table is not parseable`;
                    return textResult(
                        `${intro}: ${sliceResult.error}\n` +
                            "The plan remains ready for decomposition. Re-invoke plan_written or load the plan to retry the slicer.",
                        { ...params, outcome: "feedback", feedback: sliceResult.error },
                    );
                }

                await recordPlanEventFn({
                    cwd,
                    planName,
                    event: "decomposition_finalized",
                    currentStatus: "ready_for_decomposition",
                    details: { triageMeta: effectiveMeta },
                });
            } else {
                await recordPlanEventFn({
                    cwd,
                    planName,
                    event: "readiness_passed",
                    currentStatus: "approved",
                    details: { triageMeta: effectiveMeta },
                });
            }

            const action = await askPostApproval(planName, uiAPI);

            if (action !== "proceed") {
                uiAPI.appendSystemMessage(
                    `Plan saved. Resume later with: ${CLI_BIN} resume ${planName}`,
                    false,
                    "RunWield",
                );
                const savedFeedbackSuffix = reviewResult.feedback
                    ? `\n\nFeedback/annotations from review: ${reviewResult.feedback}`
                    : "";
                return textResult(
                    `Plan "${planName}" approved and saved for later execution. Your role as ${agentName} is complete. Do not generate any further text.${savedFeedbackSuffix}`,
                    { ...params, outcome: "saved", planName },
                    true,
                );
            }

            const execFeedbackSuffix = reviewResult.feedback
                ? `\n\nFeedback/annotations from review: ${reviewResult.feedback}`
                : "";
            return textResult(
                `Plan "${planName}" approved for execution. Your role as ${agentName} is complete. Do not generate any further text.${execFeedbackSuffix}`,
                { ...params, outcome: "approved_execute", planName, triageMeta: effectiveMeta },
                true,
            );
        },
    });
}
