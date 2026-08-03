// @ts-nocheck: extracted from checked JSDoc workflow.js; tightening types is out of scope for this structural split.
import { readLatestPlanOutcome } from "./workflow-results.js";

/**
 * @typedef {"approved_execute" | "approved_decompose" | "saved" | "feedback" | "canceled" | "repair_required" | "no_call"} PlanOutcome
 */

/**
 * @typedef {Object} PlanOutcomeResult
 * @property {PlanOutcome} outcome
 * @property {string} [planName]
 * @property {import('../../tools/plan-written.js').TriageMeta} [triageMeta]
 * @property {string} [feedback]
 * @property {Array<{base64: string, mimeType: string}>} [images]
 */

export async function runPlanningAgent(
    { agentName, initialRequest, triageMeta, sessionManager, hostedSession, images, ports },
) {
    const runActiveAgentTurn = ports?.runActiveAgentTurn ||
        (await import("../session/agent-switching.js")).runActiveAgentTurn;
    if (!hostedSession) throw new Error("runPlanningAgent: hostedSession is required");

    const messages = await runActiveAgentTurn({
        hostedSession,
        agentName,
        userRequest: initialRequest,
        images,
        sessionManager,
        triageMeta,
        allowReturnToRouter: false,
    });

    const result = readLatestPlanOutcome(messages);
    return result || { outcome: "no_call" };
}
