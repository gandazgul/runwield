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
const FRONTEND_ENGINEER_MESSAGE_DESCRIPTION = ENGINEER_MESSAGE_DESCRIPTION +
    " Include final URL/route, headed-browser checks, relevant viewports/states, diagnostics, visible evidence, and exact blockers; Pair checkpoint acceptance is not verification evidence.";

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
    const normalized = normalizeAgentName(agentName);
    const messageDescription = normalized === "frontend-engineer"
        ? FRONTEND_ENGINEER_MESSAGE_DESCRIPTION
        : isExecutionAgent(agentName)
        ? ENGINEER_MESSAGE_DESCRIPTION
        : DEFAULT_MESSAGE_DESCRIPTION;
    return Type.Object({
        message: Type.String({
            description: messageDescription,
            minLength: 1,
        }),
        ...(normalized === "frontend-engineer"
            ? {
                browserPreflightOutcome: Type.Union([
                    Type.Literal("succeeded"),
                    Type.Literal("failed"),
                    Type.Literal("externally_blocked"),
                ], {
                    description:
                        "Content-free browser/dev-server preflight outcome: succeeded, failed, or externally_blocked.",
                }),
            }
            : {}),
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
 *   now?: () => number,
 * }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createTaskCompletedTool(
    {
        hostedSession,
        agentName = "agent",
        recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric,
        now = () => Date.now(),
    } = /** @type {any} */ ({}),
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
            }, { cwd: hostedSession.cwd });
            if (normalizedAgentName === "frontend-engineer" && activeWorkflow?.executionAgent === "frontend-engineer") {
                const startMs = activeWorkflow.executionAttemptStartedAtMs;
                const elapsedMs = typeof startMs === "number" && Number.isFinite(startMs) && startMs >= 0
                    ? Math.max(0, Math.trunc(now() - startMs))
                    : undefined;
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "frontend_execution_completed",
                    details: {
                        phase: activeWorkflow.validationContinuation ? "validation_repair" : "implementation",
                        runtimeStyle: activeWorkflow.collaborationStyle || "autonomous",
                        checkpointCount: activeWorkflow.pairCheckpointCount || 0,
                        switchedToAutonomous: activeWorkflow.pairSwitchedToAutonomous === true,
                        capabilityLost: activeWorkflow.pairCapabilityLost === true,
                        browserPreflightOutcome: params.browserPreflightOutcome,
                        elapsedMs,
                    },
                }, { cwd: hostedSession.cwd });
            }

            return {
                content: [],
                details: {
                    outcome: "task_completed",
                    message: params.message,
                    ...(normalizedAgentName === "frontend-engineer"
                        ? { browserPreflightOutcome: params.browserPreflightOutcome }
                        : {}),
                },
                terminate: true,
            };
        },
    });
}
