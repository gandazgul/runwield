/**
 * @module plan-written
 * Custom tool for planning agents (Planner/Architect) to declare a plan and
 * run the review-and-approve lifecycle.
 *
 * createPlanWrittenTool captures TUI context and triage metadata at session-start
 * time. The tool runs review (and optional save-vs-execute prompt) inside execute,
 * but does NOT execute the plan — that's the orchestrator's job after the planning
 * session ends. The outcome (`approved_execute`, `approved_decompose`, `saved`, `feedback`, `canceled`,
 * `repair_required`) is returned via `details.outcome` so the orchestrator can
 * dispatch the next agent, while `feedback` and `repair_required` keep the planner
 * in-session to iterate.
 */

import { join } from "@std/path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { CLI_BIN, CWD, PLANS_DIR_NAME } from "../constants.js";
import { loadPlan } from "../plan-store.js";
import { recordPlanEvent } from "../shared/workflow/plan-lifecycle.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

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
 * @param {string} cwd
 * @returns {Promise<TriageMeta>}
 */
async function resolveTriageMeta(triageMeta, planName, cwd) {
    if (triageMeta && triageMeta.classification) return triageMeta;
    try {
        const plan = await loadPlan(cwd, planName);
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
 * @property {(planName: string, uiAPI: any) => Promise<"proceed" | "save">} [askPostApproval]
 * @property {(planName: string, uiAPI: any) => Promise<"proceed" | "save">} [askProjectDecompositionApproval]
 * @property {typeof recordPlanEvent} [recordPlanEvent]
 * @property {typeof recordWorkflowMetric} [recordWorkflowMetric]
 * @property {(opts: import('../cmd/plans/share.js').SharePlanForReviewOptions, deps?: any) => Promise<import('../cmd/plans/share.js').SharedPlanReviewLink>} [sharePlanForReview]
 * @property {(event: Partial<import('../shared/session/session-runtime-events.js').SessionRuntimeEvent> & { type: string }) => void} [emitSessionEvent]
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
    const cwd = deps.cwd ?? hostedSession?.cwd ?? CWD;
    return defineTool({
        name: "plan_written",
        label: "Plan Written",
        description: "Declare the plan filename you created in plans/ and submit it for user review. " +
            "Triggers review and (on approval) a save-vs-execute/decompose prompt. Execution or Slicer dispatch runs " +
            "after your turn ends — the workflow dispatcher picks it up from this tool's outcome. " +
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

            const effectiveMeta = await resolveTriageMeta(triageMeta, planName, cwd);

            uiAPI.appendSystemMessage(`[RunWield] Plan declared: plans/${planName}.md`);

            if (hostedSession?.getInteractionAdapterMeta?.()?.kind === "acp") {
                const sharePlanForReview = deps.sharePlanForReview ||
                    (await import("../cmd/plans/share.js")).sharePlanForReview;
                const shared = await sharePlanForReview({
                    target: planName,
                    cwd,
                    allowExisting: true,
                }, deps);
                const message = `Plan "${planName}" saved for remote review: ${shared.reviewerUrl}`;
                const event =
                    /** @type {Partial<import('../shared/session/session-runtime-events.js').RuntimePlanReviewLinkEvent> & { type: "plan_review_link" }} */ ({
                        type: "plan_review_link",
                        planName,
                        reviewerUrl: shared.reviewerUrl,
                        spaceId: shared.spaceId,
                        serverUrl: shared.serverUrl,
                        revision: shared.revision,
                        reused: shared.reused,
                        message,
                    });
                const sink = hostedSession?.getEventSink?.();
                if (sink && typeof sink.emit === "function") sink.emit(event);
                deps.emitSessionEvent?.(event);
                uiAPI.appendSystemMessage(message, false, "RunWield");
                return textResult(
                    `${message}\n\nYour role as ${agentName} is complete. Do not generate any further text.`,
                    {
                        ...params,
                        outcome: "saved",
                        planName,
                        triageMeta: effectiveMeta,
                        remoteReview: true,
                        reviewerUrl: shared.reviewerUrl,
                        spaceId: shared.spaceId,
                        serverUrl: shared.serverUrl,
                        revision: shared.revision,
                        reused: shared.reused,
                    },
                    true,
                );
            }

            // Lazy imports break the circular dep: plan-written → workflow → session → plan-written.
            const submitPlanForReview = deps.submitPlanForReview ||
                (await import("../shared/workflow/submit-plan.js")).submitPlanForReview;
            const workflow = await import("../shared/workflow/workflow.js");
            const askPostApproval = deps.askPostApproval || workflow.askPostApproval;
            const askProjectDecompositionApproval = deps.askProjectDecompositionApproval ||
                workflow.askProjectDecompositionApproval;
            const recordPlanEventFn = deps.recordPlanEvent || recordPlanEvent;
            const recordWorkflowMetricSource = deps.recordWorkflowMetric || recordWorkflowMetric;
            /** @param {Parameters<typeof recordWorkflowMetricSource>[0]} metric */
            function recordWorkflowMetricFn(metric) {
                return recordWorkflowMetricSource(metric, { cwd });
            }

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
                await recordWorkflowMetricFn({
                    category: "planning",
                    event: "review_outcome",
                    agentName,
                    planName,
                    details: { outcome: "canceled", classification: effectiveMeta.classification },
                });
                return textResult(
                    "Plan review canceled by the user. Stop generating; control has returned to the user.",
                    { ...params, outcome: "canceled" },
                    true,
                );
            }

            if (!reviewResult.approved) {
                await recordWorkflowMetricFn({
                    category: "planning",
                    event: "review_outcome",
                    agentName,
                    planName,
                    details: { outcome: "feedback", classification: effectiveMeta.classification },
                });
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
                await recordWorkflowMetricFn({
                    category: "planning",
                    event: "readiness_outcome",
                    agentName,
                    planName,
                    details: { outcome: "passed", classification: "PROJECT", lifecycleEvent: "epic_readiness_passed" },
                });
                uiAPI.appendSystemMessage(
                    `PROJECT plan ready for decomposition or child plan selection: ${planName}`,
                    false,
                    "RunWield",
                );

                const action = await askProjectDecompositionApproval(planName, uiAPI);
                if (action !== "proceed") {
                    await recordWorkflowMetricFn({
                        category: "planning",
                        event: "review_outcome",
                        agentName,
                        planName,
                        details: { outcome: "saved", classification: "PROJECT", projectAction: action },
                    });
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

                await recordWorkflowMetricFn({
                    category: "planning",
                    event: "review_outcome",
                    agentName,
                    planName,
                    details: {
                        outcome: "approved_decompose",
                        classification: "PROJECT",
                        projectAction: "decomposition_requested",
                    },
                });
                const slicerFeedbackSuffix = reviewResult.feedback
                    ? `\n\nFeedback/annotations from review: ${reviewResult.feedback}`
                    : "";
                return textResult(
                    `PROJECT Epic "${planName}" approved for Slicer decomposition. Your role as ${agentName} is complete. Do not generate any further text.${slicerFeedbackSuffix}`,
                    { ...params, outcome: "approved_decompose", planName, triageMeta: projectMeta },
                    true,
                );
            } else {
                await recordPlanEventFn({
                    cwd,
                    planName,
                    event: "readiness_passed",
                    currentStatus: "approved",
                    details: { triageMeta: effectiveMeta },
                });
                await recordWorkflowMetricFn({
                    category: "planning",
                    event: "readiness_outcome",
                    agentName,
                    planName,
                    details: {
                        outcome: "passed",
                        classification: effectiveMeta.classification,
                        lifecycleEvent: "readiness_passed",
                    },
                });
            }

            const action = await askPostApproval(planName, uiAPI);

            if (action !== "proceed") {
                await recordWorkflowMetricFn({
                    category: "planning",
                    event: "review_outcome",
                    agentName,
                    planName,
                    details: { outcome: "saved", classification: effectiveMeta.classification, action },
                });
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

            await recordWorkflowMetricFn({
                category: "planning",
                event: "review_outcome",
                agentName,
                planName,
                details: { outcome: "approved_execute", classification: effectiveMeta.classification, action },
            });
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
