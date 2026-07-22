/**
 * @module plan-written
 * Custom tool for planning agents (Planner/Architect) to declare a plan and
 * run the review-and-approve lifecycle.
 *
 * createPlanWrittenTool captures hosted-session context and triage metadata at session-start
 * time. The tool runs review (and optional save-vs-execute prompt) inside execute,
 * but does NOT execute the plan — that's the orchestrator's job after the planning
 * session ends. The outcome (`approved_execute`, `approved_decompose`, `saved`, `feedback`, `canceled`,
 * `repair_required`) is returned via `details.outcome` so the orchestrator can
 * dispatch the next agent, while `feedback` and `repair_required` keep the planner
 * in-session to iterate.
 */

import { join, toFileUrl } from "@std/path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { CLI_BIN, PLANS_DIR_NAME } from "../constants.js";
import { loadPlan, resolvePlanExecutionPolicy } from "../plan-store.js";
import { recordPlanEvent } from "../shared/workflow/plan-lifecycle.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";
import {
    emitHostedSessionRuntimeEvent,
    emitSystemStatus,
    RuntimeEventTypes,
} from "../shared/session/session-runtime-events.js";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../shared/session/session-runtime-interactions.js";

/**
 * @typedef {{
 *   classification?: "QUICK_FIX" | "FEATURE" | "PROJECT",
 *   complexity?: "LOW" | "MEDIUM" | "HIGH",
 *   summary?: string,
 *   affectedPaths?: string[],
 *   executionAgent?: unknown,
 *   collaborationRecommendation?: unknown,
 *   frontend?: boolean,
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
 * @param {Array<{base64: string, mimeType: string}>} [images]
 * @returns {import('@earendil-works/pi-coding-agent').AgentToolResult<unknown>}
 */
function textResult(text, details, terminate, images = []) {
    /** @type {import('@earendil-works/pi-coding-agent').AgentToolResult<unknown>} */
    const result = {
        content: [
            { type: "text", text },
            ...images.map(toToolImageContent),
        ],
        details: details ?? null,
    };
    if (terminate) result.terminate = true;
    return result;
}

/**
 * @param {{ planName: string, planPath: string, status: string, output?: string }} opts
 * @returns {string}
 */
function buildPlanWrittenToolOutput({ planName, planPath, status, output = "" }) {
    const planDisplayPath = `${PLANS_DIR_NAME}/${planName}.md`;
    const lines = [
        `Plan: ${planDisplayPath}`,
        `File URL: ${toFileUrl(planPath).href}`,
        `Path: ${planPath}`,
        `Status: ${status}`,
    ];
    const trimmedOutput = output.trimEnd();
    if (trimmedOutput) lines.push("", "Review server output:", trimmedOutput);
    return `${lines.join("\n")}\n`;
}

/**
 * @param {unknown} onUpdate
 * @param {import('@earendil-works/pi-coding-agent').AgentToolResult<unknown>} result
 */
function emitToolUpdate(onUpdate, result) {
    if (typeof onUpdate !== "function") return;
    try {
        onUpdate(result);
    } catch {
        // Tool-block progress is best-effort; the final tool result remains authoritative.
    }
}

/**
 * @param {{base64: string, mimeType: string}} image
 * @returns {{type: "image", data: string, mimeType: string}}
 */
function toToolImageContent(image) {
    return { type: "image", data: image.base64, mimeType: image.mimeType };
}

/**
 * Preserve review context in both the tool result details used by workflow
 * dispatch and the content blocks delivered to the planning agent.
 *
 * @param {{feedback?: string, images?: Array<{base64: string, mimeType: string}>}} reviewResult
 * @returns {{feedback?: string, imageCount: number}}
 */
function reviewContextDetails(reviewResult) {
    return {
        ...(reviewResult.feedback && { feedback: reviewResult.feedback }),
        imageCount: reviewResult.images?.length || 0,
    };
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
 * @property {typeof requestHostedSessionInteraction} [requestPlanReview]
 * @property {(planName: string, hostedSession: import('../shared/session/hosted-session.js').HostedSession) => Promise<"proceed" | "save">} [askPostApproval]
 * @property {(planName: string, hostedSession: import('../shared/session/hosted-session.js').HostedSession) => Promise<"proceed" | "save">} [askProjectDecompositionApproval]
 * @property {typeof recordPlanEvent} [recordPlanEvent]
 * @property {typeof recordWorkflowMetric} [recordWorkflowMetric]
 * @property {(path: string) => Promise<{ isFile: boolean }>} [stat]
 * @property {string} [cwd]
 */

/**
 * Create the plan_written tool with lifecycle context captured at session start.
 *
 * @param {{
 *   triageMeta?: TriageMeta,
 *   agentName?: string,
 *   hostedSession?: import('../shared/session/hosted-session.js').HostedSession,
 *   __deps?: PlanWrittenDeps,
 * }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createPlanWrittenTool(
    { triageMeta, agentName = "planner", hostedSession, __deps } = /** @type {any} */ ({}),
) {
    if (!hostedSession) throw new Error("createPlanWrittenTool: hostedSession is required");
    const deps = __deps || {};
    const cwd = deps.cwd ?? hostedSession?.cwd;
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
        async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
            const planName = String(params.planName || "").trim().replace(/^plans\//i, "").replace(/\.md$/i, "").trim();

            if (!planName) {
                return textResult(
                    "plan_written: planName is empty. Provide the plan filename (without .md) and call again.",
                );
            }

            if (!cwd) throw new Error("plan_written: cwd or hostedSession cwd is required");
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

            try {
                hostedSession?.setWorkflowPlanName?.(planName);
            } catch (_e) {
                // Footer-context persistence is fail-open and must not block Plan review.
            }

            const effectiveMeta = await resolveTriageMeta(triageMeta, planName, cwd);
            const policy = resolvePlanExecutionPolicy(effectiveMeta);
            if (!policy.ok && policy.reason !== "project_epic") {
                emitSystemStatus(hostedSession, `Plan policy invalid: ${policy.error}`, {
                    level: "error",
                    header: "RunWield",
                });
                return textResult(
                    `plan_written: ${policy.error}\n\nFix plans/${planName}.md and call plan_written again.`,
                    {
                        ...params,
                        outcome: "repair_required",
                        planName,
                        triageMeta: effectiveMeta,
                        reason: policy.reason,
                    },
                    false,
                );
            }

            const planDetails = {
                planName,
                planPath,
                planFileUrl: toFileUrl(planPath).href,
                triageMeta: effectiveMeta,
            };
            let reviewServerOutput = "";
            const updateToolBlock = (/** @type {string} */ status) => {
                emitToolUpdate(
                    onUpdate,
                    textResult(
                        buildPlanWrittenToolOutput({ planName, planPath, status, output: reviewServerOutput }),
                        planDetails,
                    ),
                );
            };
            const onReviewServerOutput = (/** @type {{ stream: "stdout" | "stderr", text: string }} */ entry) => {
                reviewServerOutput += `[${entry.stream}] ${entry.text}`;
                updateToolBlock("Waiting for plan review decision.");
            };

            emitSystemStatus(hostedSession, `[RunWield] Plan declared: plans/${planName}.md`);
            updateToolBlock("Opening browser review UI.");

            // Lazy imports break the circular dep: plan-written → workflow → session → plan-written.
            const requestPlanReview = deps.requestPlanReview || requestHostedSessionInteraction;
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

            const reviewResponse = await requestPlanReview(hostedSession, {
                type: RuntimeInteractionTypes.PLAN_REVIEW,
                prompt: `Review plan "${planName}"`,
                _meta: { cwd, planName, planPath, triageMeta: effectiveMeta, onOutput: onReviewServerOutput },
            });
            updateToolBlock("Plan review decision received.");
            const reviewMeta = /** @type {any} */ (reviewResponse._meta || {});
            const reviewResult = {
                canceled: reviewResponse.outcome === RuntimeInteractionOutcomes.CANCELED,
                approved: reviewMeta.approved === true,
                feedback: typeof reviewMeta.feedback === "string" ? reviewMeta.feedback : undefined,
                images: Array.isArray(reviewMeta.images) ? reviewMeta.images : undefined,
            };

            if (reviewMeta.remoteReview === true) {
                const message = reviewResponse.message || `Plan "${planName}" saved for remote review.`;
                if (reviewMeta.reviewerUrl) {
                    emitHostedSessionRuntimeEvent(hostedSession, {
                        type: RuntimeEventTypes.PLAN_REVIEW_LINK,
                        planName,
                        reviewerUrl: reviewMeta.reviewerUrl,
                        spaceId: reviewMeta.spaceId,
                        serverUrl: reviewMeta.serverUrl,
                        revision: reviewMeta.revision,
                        reused: reviewMeta.reused,
                        message,
                    });
                }
                emitSystemStatus(hostedSession, message, { header: "RunWield" });
                return textResult(
                    `${message}\n\nYour role as ${agentName} is complete. Do not generate any further text.`,
                    {
                        ...params,
                        outcome: "saved",
                        planName,
                        triageMeta: effectiveMeta,
                        remoteReview: true,
                        ...reviewMeta,
                    },
                    true,
                );
            }

            if (reviewResult.canceled) {
                emitSystemStatus(hostedSession, "Plan review canceled. Returning control to user.", {
                    header: "RunWield",
                });
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
                    {
                        ...params,
                        outcome: "feedback",
                        ...reviewContextDetails(reviewResult),
                    },
                    false,
                    reviewResult.images,
                );
            }

            if (effectiveMeta.classification === "PROJECT") {
                const projectMeta = { ...effectiveMeta };
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
                emitSystemStatus(
                    hostedSession,
                    `PROJECT plan ready for decomposition or child plan selection: ${planName}`,
                    { header: "RunWield" },
                );

                const action = await askProjectDecompositionApproval(planName, hostedSession);
                if (action !== "proceed") {
                    await recordWorkflowMetricFn({
                        category: "planning",
                        event: "review_outcome",
                        agentName,
                        planName,
                        details: { outcome: "saved", classification: "PROJECT", projectAction: action },
                    });
                    emitSystemStatus(
                        hostedSession,
                        `Plan saved. Resume later with: ${CLI_BIN} load-plan ${planName}`,
                        { header: "RunWield" },
                    );
                    const savedFeedbackSuffix = reviewResult.feedback
                        ? `\n\nFeedback/annotations from review: ${reviewResult.feedback}`
                        : "";
                    return textResult(
                        `Plan "${planName}" approved and saved for later decomposition. Your role as ${agentName} is complete. Do not generate any further text.${savedFeedbackSuffix}`,
                        {
                            ...params,
                            outcome: "saved",
                            planName,
                            triageMeta: projectMeta,
                            ...reviewContextDetails(reviewResult),
                        },
                        true,
                        reviewResult.images,
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
                    {
                        ...params,
                        outcome: "approved_decompose",
                        planName,
                        triageMeta: projectMeta,
                        ...reviewContextDetails(reviewResult),
                    },
                    true,
                    reviewResult.images,
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

            const action = await askPostApproval(planName, hostedSession);

            if (action !== "proceed") {
                await recordWorkflowMetricFn({
                    category: "planning",
                    event: "review_outcome",
                    agentName,
                    planName,
                    details: { outcome: "saved", classification: effectiveMeta.classification, action },
                });
                emitSystemStatus(
                    hostedSession,
                    `Plan saved. Resume later with: ${CLI_BIN} resume ${planName}`,
                    { header: "RunWield" },
                );
                const savedFeedbackSuffix = reviewResult.feedback
                    ? `\n\nFeedback/annotations from review: ${reviewResult.feedback}`
                    : "";
                return textResult(
                    `Plan "${planName}" approved and saved for later execution. Your role as ${agentName} is complete. Do not generate any further text.${savedFeedbackSuffix}`,
                    { ...params, outcome: "saved", planName, ...reviewContextDetails(reviewResult) },
                    true,
                    reviewResult.images,
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
                {
                    ...params,
                    outcome: "approved_execute",
                    planName,
                    triageMeta: effectiveMeta,
                    ...reviewContextDetails(reviewResult),
                },
                true,
                reviewResult.images,
            );
        },
    });
}
