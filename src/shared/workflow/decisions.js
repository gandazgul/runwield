/**
 * @module shared/workflow/decisions
 * Ephemeral Workflow Decision interpreters. These normalize raw tool/session
 * outcomes into semantic caller actions without mutating Plan Status.
 */

/**
 * @typedef {"execute_plan"|"start_slicer"|"save_plan"|"run_validation"|"stay_with_agent"|"halt"} WorkflowDecisionKind
 */

/**
 * @typedef {"plan_feedback"|"plan_review_canceled"|"missing_plan_declaration"|"execution_incomplete"|"execution_paused"|"execution_canceled"|"missing_execution_result"|"unknown_plan_outcome"} WorkflowDecisionReason
 */

/**
 * @typedef {Object} WorkflowDecision
 * @property {WorkflowDecisionKind} kind
 * @property {Record<string, unknown>} payload
 */

/**
 * @param {WorkflowDecisionKind} kind
 * @param {Record<string, unknown>} payload
 * @returns {WorkflowDecision}
 */
function decision(kind, payload = {}) {
    return { kind, payload };
}

/**
 * Build a sanitized metric payload for workflow decisions.
 *
 * @param {WorkflowDecision} workflowDecision
 * @returns {Record<string, unknown>}
 */
export function summarizeWorkflowDecision(workflowDecision) {
    const payload = workflowDecision.payload || {};
    return {
        kind: workflowDecision.kind,
        reason: payload.reason,
        planName: payload.planName,
        classification: /** @type {{ classification?: unknown }} */ (payload.triageMeta || {}).classification,
        nextAgent: payload.agentName,
    };
}

/**
 * Normalize the planning phase's raw plan_written outcome into a Workflow
 * Decision for callers such as the Router Orchestrator and load-plan command.
 *
 * @param {import('./workflow.js').PlanOutcomeResult | null | undefined} planOutcome
 * @param {Object} opts
 * @param {string} opts.planningAgentName
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.fallbackTriageMeta]
 * @returns {WorkflowDecision}
 */
export function decidePostPlanning(planOutcome, { planningAgentName, fallbackTriageMeta }) {
    const outcome = planOutcome?.outcome || "no_call";

    if (outcome === "approved_execute") {
        if (!planOutcome?.planName) {
            return decision("stay_with_agent", {
                agentName: planningAgentName,
                reason: "missing_plan_declaration",
            });
        }

        /** @type {Record<string, unknown>} */
        const payload = {
            planName: planOutcome.planName,
            triageMeta: planOutcome.triageMeta || fallbackTriageMeta || {},
        };
        if (planOutcome.feedback) payload.reviewFeedback = planOutcome.feedback;
        if (planOutcome.images?.length) payload.reviewImages = planOutcome.images;
        return decision("execute_plan", payload);
    }

    if (outcome === "approved_decompose") {
        if (!planOutcome?.planName) {
            return decision("stay_with_agent", {
                agentName: planningAgentName,
                reason: "missing_plan_declaration",
            });
        }
        /** @type {Record<string, unknown>} */
        const payload = {
            planName: planOutcome.planName,
            triageMeta: planOutcome.triageMeta || fallbackTriageMeta || {},
        };
        if (planOutcome.feedback) payload.reviewFeedback = planOutcome.feedback;
        if (planOutcome.images?.length) payload.reviewImages = planOutcome.images;
        return decision("start_slicer", payload);
    }

    if (outcome === "saved") {
        return decision("save_plan", { planName: planOutcome?.planName });
    }

    if (outcome === "feedback") {
        return decision("stay_with_agent", {
            agentName: planningAgentName,
            reason: "plan_feedback",
        });
    }

    if (outcome === "canceled") {
        return decision("stay_with_agent", {
            agentName: planningAgentName,
            reason: "plan_review_canceled",
        });
    }

    if (outcome === "repair_required") {
        return decision("stay_with_agent", {
            agentName: planningAgentName,
            reason: "plan_feedback",
        });
    }

    if (outcome === "no_call") {
        return decision("stay_with_agent", {
            agentName: planningAgentName,
            reason: "missing_plan_declaration",
        });
    }

    return decision("halt", { reason: "unknown_plan_outcome" });
}

/**
 * Normalize the execution phase result into a Workflow Decision. The caller
 * still owns validation, repair prompts, active-agent changes, and Plan Events.
 *
 * @param {import('./workflow.js').PlanExecutionResult | null | undefined} executionResult
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {import('../../tools/plan-written.js').TriageMeta} opts.triageMeta
 * @param {string} opts.executionAgentName
 * @returns {WorkflowDecision}
 */
export function decidePostExecution(executionResult, { planName, triageMeta, executionAgentName }) {
    if (!executionResult) {
        return decision("halt", { reason: "missing_execution_result" });
    }

    if (executionResult.executionComplete) {
        return decision("run_validation", { planName, triageMeta });
    }

    if (executionResult.canceled) {
        return decision("stay_with_agent", {
            agentName: executionAgentName,
            reason: "execution_canceled",
            error: executionResult.error,
        });
    }

    if (executionResult.paused) {
        return decision("stay_with_agent", {
            agentName: executionAgentName,
            reason: "execution_paused",
            pauseReason: executionResult.pauseReason,
            error: executionResult.error,
        });
    }

    return decision("stay_with_agent", {
        agentName: executionAgentName,
        reason: "execution_incomplete",
        error: executionResult.error,
    });
}
