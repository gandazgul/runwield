/**
 * @module task-completed
 * Custom tool for execution agents to declare they have finished their current
 * task. This returns a terminal outcome that lets the orchestrator advance the
 * active workflow.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { emitTaskCompletedMessage } from "../shared/session/workflow-messages.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

const DEFAULT_MESSAGE_DESCRIPTION = "Concise success, failure, or blocked summary for the completed task.";
const ENGINEER_MESSAGE_DESCRIPTION =
    "Concise Markdown bullet-point success, failure, or blocked report. Use one bullet per major outcome, verification " +
    "result, frontend browser check, or unresolved blocker; do not submit a prose paragraph.";

/**
 * @param {string} agentName
 * @returns {string}
 */
function normalizeAgentName(agentName) {
    return agentName.trim().toLowerCase().replaceAll(" ", "-");
}

/**
 * @param {string} agentName
 * @returns {boolean}
 */
function isExecutionAgent(agentName) {
    const normalized = normalizeAgentName(agentName);
    return normalized === "engineer" || normalized === "frontend-engineer";
}

/**
 * @param {string} agentName
 * @returns {ReturnType<typeof Type.Object>}
 */
function buildToolParams(agentName) {
    return Type.Object({
        message: Type.String({
            description: isExecutionAgent(agentName) ? ENGINEER_MESSAGE_DESCRIPTION : DEFAULT_MESSAGE_DESCRIPTION,
            minLength: 1,
        }),
    });
}

/** @returns {string} */
function buildToolDescription() {
    return "Declare that you have finished your assigned execution task, whether it succeeded, failed, " +
        "or is blocked. " +
        "For FEATURE and PROJECT workflows, this signals the orchestrator to begin saved-plan validation. " +
        "For OPERATION work, the Operator must self-verify before calling this tool and no RunWield validation loop runs afterward. " +
        "For QUICK_FIX work, the Engineer must verify before calling this tool; RunWield then runs no-plan Mechanical Validation. " +
        "For frontend UI/UX work, include the dev server URL, headed browser checks performed, and visible " +
        "evidence; if browser verification was blocked, state the exact blocker and what remains unverified. " +
        "Call this exactly once when you are completely finished with your assigned work and include a concise " +
        "report in the required `message` parameter, following its description for content and format. " +
        "If you need to ask the user a clarifying question before finishing, DO NOT call this tool — " +
        "just output the question in text.";
}

/**
 * Create the task_completed tool.
 *
 * @param {{
 *   hostedSession: import('../shared/session/hosted-session.js').HostedSession,
 *   agentName?: string,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createTaskCompletedTool(
    { hostedSession, agentName = "agent", recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric } =
        /** @type {any} */ ({}),
) {
    if (!hostedSession) throw new Error("createTaskCompletedTool: hostedSession is required");
    return defineTool({
        name: "task_completed",
        label: "Task Completed",
        description: buildToolDescription(),
        parameters: buildToolParams(agentName),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            await Promise.resolve();
            const activeWorkflow = hostedSession.getActiveExecutionWorkflow?.();
            const normalizedAgentName = normalizeAgentName(agentName);
            if (activeWorkflow?.executionStarted === false) {
                return {
                    content: [{
                        type: "text",
                        text: "task_completed rejected: active workflow execution has not started.",
                    }],
                    details: { outcome: "rejected", reason: "execution_not_started" },
                    terminate: false,
                };
            }
            if (activeWorkflow?.pairPauseReason) {
                return {
                    content: [{
                        type: "text",
                        text:
                            `task_completed rejected: Pair Execution is paused (${activeWorkflow.pairPauseReason}); leave the Plan In Progress.`,
                    }],
                    details: { outcome: "rejected", reason: "pair_execution_paused" },
                    terminate: false,
                };
            }
            if (activeWorkflow?.executionAgent && activeWorkflow.executionAgent !== normalizedAgentName) {
                return {
                    content: [{
                        type: "text",
                        text:
                            `task_completed rejected: active workflow owner is ${activeWorkflow.executionAgent}, not ${normalizedAgentName}.`,
                    }],
                    details: { outcome: "rejected", reason: "wrong_execution_owner" },
                    terminate: false,
                };
            }
            emitTaskCompletedMessage(hostedSession, agentName, params.message);
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "task_completed",
                agentName,
                details: { hasMessage: Boolean(params.message) },
            });

            return {
                content: [],
                details: { outcome: "task_completed", message: params.message },
                terminate: true,
            };
        },
    });
}
