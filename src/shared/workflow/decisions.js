/**
 * @module shared/workflow/decisions
 * Ephemeral Workflow Decision interpreters. These normalize raw tool/session
 * outcomes into semantic caller actions without mutating Plan Status.
 */

/**
 * @typedef {"execute_plan"|"save_plan"|"run_validation"|"repair_plan"|"stay_with_agent"|"halt"} WorkflowDecisionKind
 */

/**
 * @typedef {"plan_feedback"|"plan_review_canceled"|"missing_plan_declaration"|"plan_repair_required"|"execution_incomplete"|"task_table_invalid"|"missing_execution_result"|"unknown_plan_outcome"} WorkflowDecisionReason
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
        hasTasks: Array.isArray(payload.tasks) ? payload.tasks.length > 0 : undefined,
        failedTaskCount: Array.isArray(payload.failedTasks) ? payload.failedTasks.length : undefined,
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
        if (planOutcome.tasks) payload.tasks = planOutcome.tasks;
        return decision("execute_plan", payload);
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
            reason: "plan_repair_required",
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

    if (executionResult.repairRequired) {
        return decision("repair_plan", {
            planName,
            triageMeta,
            reason: "task_table_invalid",
            error: executionResult.error,
        });
    }

    if (executionResult.executionComplete) {
        return decision("run_validation", { planName, triageMeta });
    }

    return decision("stay_with_agent", {
        agentName: executionAgentName,
        reason: "execution_incomplete",
        error: executionResult.error,
        failedTasks: executionResult.failedTasks,
    });
}
