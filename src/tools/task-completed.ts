/**
 * @module task-completed
 * Custom tool for execution agents to declare they have finished their current
 * task. This returns a terminal outcome that lets the orchestrator advance the
 * active workflow.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { HostedSession } from "../shared/session/hosted-session.js";
import { AGENTS } from "../constants.js";
import { recordAcceptedTaskCompletion } from "../shared/session/task-completion-session.ts";
import { emitTaskCompletedMessage } from "../shared/session/workflow-messages.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";
import { resolveActiveWorkflowRuntimeAgent } from "../shared/workflow/execution-agent.ts";

const DEFAULT_MESSAGE_DESCRIPTION = "Concise summary of the task you completed and what you verified.";
const ENGINEER_MESSAGE_DESCRIPTION =
    "Concise Markdown bullet-point report of the work you completed. Use one bullet per major outcome, review " +
    "feedback item or related group, verification result, or frontend browser check; directly " +
    "state each feedback item's disposition when repairing validation/review feedback; do not submit a prose paragraph. " +
    "This report is for finished work: if something blocked you, do not call this tool at all.";
const FRONTEND_ENGINEER_MESSAGE_DESCRIPTION = ENGINEER_MESSAGE_DESCRIPTION +
    " Include final URL/route, headed-browser checks, relevant viewports/states, diagnostics, and visible evidence; Pair checkpoint acceptance is not verification evidence.";

type BrowserPreflightOutcome = "succeeded" | "failed" | "externally_blocked";

type TaskCompletedDetails =
    | { outcome: "rejected"; reason: "execution_not_started" | "pair_execution_paused" | "wrong_execution_owner" }
    | {
        outcome: "task_completed";
        message: string;
        browserPreflightOutcome?: BrowserPreflightOutcome;
    };

type TaskCompletedResult = AgentToolResult<TaskCompletedDetails> & { terminate: boolean };

interface TaskCompletedToolOptions {
    hostedSession: HostedSession;
    agentName?: string;
    now?: () => number;
}

function normalizeAgentName(agentName: string): string {
    return agentName.trim().toLowerCase().replaceAll(" ", "-");
}

function isExecutionAgent(agentName: string): boolean {
    const normalized = normalizeAgentName(agentName);
    return normalized === "engineer" || normalized === "plan-engineer" || normalized === "frontend-engineer";
}

function isValidationRepairAgent(agentName: string): boolean {
    const normalized = normalizeAgentName(agentName);
    return normalized === AGENTS.REVIEWER_FEEDBACK_ENGINEER || normalized === "validation-repair-engineer";
}

function buildToolParams(agentName: string) {
    const normalized = normalizeAgentName(agentName);
    const messageDescription = normalized === "frontend-engineer"
        ? FRONTEND_ENGINEER_MESSAGE_DESCRIPTION
        : isExecutionAgent(agentName) || isValidationRepairAgent(agentName)
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

function buildToolDescription(): string {
    return "Declare that you have finished the execution task you were assigned. " +
        "For PLANNED_CHANGE and PROJECT workflows, this signals the orchestrator to begin saved-plan validation. " +
        "For OPERATION work, the Operator must self-verify before calling this tool and no RunWield validation loop runs afterward. " +
        "For QUICK_FIX work, the Engineer must verify before calling this tool; RunWield then runs no-plan Mechanical Validation. " +
        "For frontend UI/UX work, include the dev server URL, headed browser checks performed, and visible evidence. " +
        "Call when your assigned work is done, and include a concise " +
        "report in the required `message` parameter, following its description for content and format. " +
        "Normally called once per assignment. Calling it again is harmless — nothing is corrupted by a second " +
        "report — so if the workflow or the user asks for another, comply instead of refusing. " +
        "DO NOT call this tool when you are blocked: a step is impossible, two steps contradict each other, " +
        "something the work depends on does not exist, a credential, permission, service, or artifact you need is " +
        "unavailable, or any part of the assignment could not be done. A blocker ends your turn in plain text — " +
        "say exactly what stopped you and what would unblock it, and stop. Calling this tool while blocked starts " +
        "validation over work that never happened, or reports the Plan as done when it is not. " +
        "If you need to ask the user a clarifying question before finishing, DO NOT call this tool — " +
        "just output the question in text.";
}

export function createTaskCompletedTool(
    {
        hostedSession,
        agentName = "agent",
        now = () => Date.now(),
    }: TaskCompletedToolOptions,
) {
    if (!hostedSession) throw new Error("createTaskCompletedTool: hostedSession is required");
    const targetHostedSession = hostedSession;
    const PARAMETERS = buildToolParams(agentName);
    return defineTool<typeof PARAMETERS, TaskCompletedDetails>({
        name: "task_completed",
        label: "Task Completed",
        description: buildToolDescription(),
        parameters: PARAMETERS,
        async execute(_toolCallId, params): Promise<TaskCompletedResult> {
            await Promise.resolve();
            const activeWorkflow = targetHostedSession.getActiveExecutionWorkflow?.();
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
            const completingOnBehalfOfOwner = isValidationRepairAgent(agentName);
            const runtimeOwner = resolveActiveWorkflowRuntimeAgent(activeWorkflow);
            if (
                runtimeOwner && runtimeOwner !== normalizedAgentName &&
                !completingOnBehalfOfOwner
            ) {
                return {
                    content: [{
                        type: "text",
                        text:
                            `task_completed rejected: active workflow owner is ${runtimeOwner}, not ${normalizedAgentName}.`,
                    }],
                    details: { outcome: "rejected", reason: "wrong_execution_owner" },
                    terminate: false,
                };
            }
            const report = typeof params.message === "string" ? params.message : "";
            const timestampMs = now();
            recordAcceptedTaskCompletion({
                hostedSession: targetHostedSession,
                toolCallId: _toolCallId,
                agentName: normalizedAgentName,
                report,
                timestampMs,
            });
            emitTaskCompletedMessage(targetHostedSession, agentName, report);
            await recordWorkflowMetric({
                category: "execution",
                event: "task_completed",
                agentName,
                details: { hasMessage: Boolean(params.message) },
            }, targetHostedSession.cwd);
            if (normalizedAgentName === "frontend-engineer" && activeWorkflow?.executionAgent === "frontend-engineer") {
                const startMs = activeWorkflow.executionAttemptStartedAtMs;
                const elapsedMs = typeof startMs === "number" && Number.isFinite(startMs) && startMs >= 0
                    ? Math.max(0, Math.trunc(now() - startMs))
                    : undefined;
                await recordWorkflowMetric({
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
                }, targetHostedSession.cwd);
            }

            return {
                content: [],
                details: {
                    outcome: "task_completed",
                    message: report,
                    ...(normalizedAgentName === "frontend-engineer"
                        ? { browserPreflightOutcome: params.browserPreflightOutcome as BrowserPreflightOutcome }
                        : {}),
                },
                terminate: true,
            };
        },
    });
}
