/**
 * @module pair-checkpoint
 * Non-terminal checkpoint tool for Plan Pair Execution.
 */

import { type Static, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { ActiveExecutionWorkflow, HostedSession } from "../shared/session/hosted-session.js";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
    supportsHostedSessionInteraction,
} from "../shared/session/session-runtime-interactions.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

const CHECKPOINT_DECISIONS = {
    INACTIVE: "inactive",
    CANCELED: "canceled",
    CONTINUE: "continue",
    REVISE: "revise",
    SWITCH_TO_AUTONOMOUS: "switch_to_autonomous",
    STOP: "stop",
} as const;

const PARAMETERS = Type.Object({
    summary: Type.String({
        minLength: 1,
        description: "Concise description of the observable increment now available for review.",
    }),
    route: Type.Optional(Type.String({ minLength: 1, description: "Route or URL currently shown." })),
    state: Type.Optional(
        Type.String({ minLength: 1, description: "Application state or scenario inspected." }),
    ),
    viewport: Type.Optional(Type.String({ minLength: 1, description: "Viewport or device inspected." })),
    evidence: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
            description: "Content-safe notes or screenshot paths describing visible evidence.",
        }),
    ),
    diagnostics: Type.Optional(
        Type.String({
            minLength: 1,
            description: "Console, network, accessibility, or runtime health summary.",
        }),
    ),
    nextIncrement: Type.Optional(
        Type.String({ minLength: 1, description: "The next coherent increment proposed." }),
    ),
}, { additionalProperties: false });

export type PairCheckpointParameters = Static<typeof PARAMETERS>;

export type PairCheckpointDetails =
    | {
        decision: "inactive";
        reason: "pair_execution_inactive" | "pair_execution_paused";
    }
    | {
        decision: "canceled";
        checkpointNumber: number;
        reason: "checkpoint_interaction_canceled" | "revision_feedback_required";
    }
    | {
        decision: "continue";
        checkpointNumber: number;
    }
    | {
        decision: "revise";
        checkpointNumber: number;
        feedback: string;
    }
    | {
        decision: "switch_to_autonomous";
        checkpointNumber: number;
        reason?: "pair_capability_lost" | "invalid_checkpoint_response";
    }
    | {
        decision: "stop";
        checkpointNumber: number;
    };

type PairCheckpointResult = AgentToolResult<PairCheckpointDetails> & { terminate: boolean };

interface PairCheckpointToolOptions {
    hostedSession: HostedSession;
}

function checkpointResult(
    text: string,
    details: PairCheckpointDetails,
    terminate = false,
): PairCheckpointResult {
    return { content: [{ type: "text", text }], details, terminate };
}

function clearPairPause(workflow: ActiveExecutionWorkflow): ActiveExecutionWorkflow {
    const next = { ...workflow };
    delete next.pairPauseReason;
    delete next.pairStopRequested;
    return next;
}

export function createPairCheckpointTool(
    { hostedSession }: PairCheckpointToolOptions,
) {
    if (!hostedSession) throw new Error("createPairCheckpointTool: hostedSession is required");
    async function recordDecision(details: PairCheckpointDetails): Promise<void> {
        const reason = "reason" in details ? details.reason : undefined;
        const checkpointNumber = "checkpointNumber" in details ? details.checkpointNumber : undefined;
        await recordWorkflowMetric({
            category: "execution",
            event: "pair_checkpoint_decided",
            details: {
                checkpointNumber,
                decision: details.decision,
                reason,
            },
        }, hostedSession.cwd);
    }
    return defineTool<typeof PARAMETERS, PairCheckpointDetails>({
        name: "pair_checkpoint",
        label: "Pair Checkpoint",
        description:
            "Pause active Pair Execution after a coherent observable increment is ready for user judgment. Returns the user's direction without completing the task or starting validation.",
        parameters: PARAMETERS,
        async execute(toolCallId, params, signal): Promise<PairCheckpointResult> {
            const workflow = hostedSession.getActiveExecutionWorkflow?.();
            if (
                (workflow?.executionAgent !== "engineer" && workflow?.executionAgent !== "frontend-engineer") ||
                workflow.executionStarted === false || workflow.collaborationStyle !== "pair"
            ) {
                return checkpointResult(
                    "Pair checkpoint is inactive; continue autonomously.",
                    { decision: CHECKPOINT_DECISIONS.INACTIVE, reason: "pair_execution_inactive" },
                );
            }
            if (workflow.pairPauseReason || workflow.pairStopRequested) {
                return checkpointResult(
                    "Pair Execution is already paused. Do not continue implementation or call task_completed until the user deliberately resumes execution.",
                    { decision: CHECKPOINT_DECISIONS.INACTIVE, reason: "pair_execution_paused" },
                    true,
                );
            }

            const checkpointNumber = (workflow.pairCheckpointCount || 0) + 1;
            const checkpointWorkflow = clearPairPause({ ...workflow, pairCheckpointCount: checkpointNumber });
            hostedSession.setActiveExecutionWorkflow(checkpointWorkflow);

            if (!supportsHostedSessionInteraction(hostedSession, RuntimeInteractionTypes.PAIR_CHECKPOINT)) {
                hostedSession.setActiveExecutionWorkflow({
                    ...checkpointWorkflow,
                    collaborationStyle: "autonomous",
                    pairCapabilityLost: true,
                });
                await recordDecision({
                    decision: CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS,
                    checkpointNumber,
                    reason: "pair_capability_lost",
                });
                return checkpointResult(
                    "Pair checkpoint capability is unavailable. Continue the remaining work autonomously; do not treat this increment as user-approved.",
                    {
                        decision: CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS,
                        checkpointNumber,
                        reason: "pair_capability_lost",
                    },
                );
            }

            const response = await requestHostedSessionInteraction(
                hostedSession,
                {
                    type: RuntimeInteractionTypes.PAIR_CHECKPOINT,
                    prompt: params.summary,
                    toolCallId,
                    _meta: { ...params, checkpointNumber },
                },
                signal,
                hostedSession.getManagedOperationCapability?.() || null,
            );

            if (response.outcome === RuntimeInteractionOutcomes.CANCELED) {
                hostedSession.setActiveExecutionWorkflow({ ...checkpointWorkflow, pairPauseReason: "canceled" });
                await recordDecision({
                    decision: CHECKPOINT_DECISIONS.CANCELED,
                    checkpointNumber,
                    reason: "checkpoint_interaction_canceled",
                });
                return checkpointResult(
                    "The Pair checkpoint interaction was canceled. Pause this turn without task_completed; no increment approval was recorded.",
                    {
                        decision: CHECKPOINT_DECISIONS.CANCELED,
                        checkpointNumber,
                        reason: "checkpoint_interaction_canceled",
                    },
                    true,
                );
            }

            if (
                response.outcome === RuntimeInteractionOutcomes.UNSUPPORTED ||
                response.outcome === RuntimeInteractionOutcomes.BLOCKED
            ) {
                hostedSession.setActiveExecutionWorkflow({
                    ...checkpointWorkflow,
                    collaborationStyle: "autonomous",
                    pairCapabilityLost: true,
                });
                await recordDecision({
                    decision: CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS,
                    checkpointNumber,
                    reason: "pair_capability_lost",
                });
                return checkpointResult(
                    "Pair checkpoint capability is unavailable. Continue the remaining work autonomously; do not treat this increment as user-approved.",
                    {
                        decision: CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS,
                        checkpointNumber,
                        reason: "pair_capability_lost",
                    },
                );
            }

            const rawDecision = response.outcome === RuntimeInteractionOutcomes.SELECTED
                ? String(response.value || "")
                : "";
            const decision = rawDecision === "autonomous" ? CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS : rawDecision;

            if (decision === CHECKPOINT_DECISIONS.CONTINUE) {
                hostedSession.setActiveExecutionWorkflow(checkpointWorkflow);
                await recordDecision({ decision, checkpointNumber });
                return checkpointResult(
                    "The increment is accepted; continue Pair Execution.",
                    { decision, checkpointNumber },
                );
            }

            if (decision === CHECKPOINT_DECISIONS.REVISE) {
                const feedback = typeof response._meta?.feedback === "string" ? response._meta.feedback.trim() : "";
                if (!feedback) {
                    hostedSession.setActiveExecutionWorkflow({ ...checkpointWorkflow, pairPauseReason: "canceled" });
                    await recordDecision({
                        decision: CHECKPOINT_DECISIONS.CANCELED,
                        checkpointNumber,
                        reason: "revision_feedback_required",
                    });
                    return checkpointResult(
                        "Revision was selected without feedback. Pause this turn without task_completed; no increment approval was recorded.",
                        {
                            decision: CHECKPOINT_DECISIONS.CANCELED,
                            checkpointNumber,
                            reason: "revision_feedback_required",
                        },
                        true,
                    );
                }
                hostedSession.setActiveExecutionWorkflow(checkpointWorkflow);
                await recordDecision({ decision, checkpointNumber, feedback });
                return checkpointResult(
                    `Revise this increment using the user's feedback: ${feedback}`,
                    { decision, feedback, checkpointNumber },
                );
            }

            if (decision === CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS) {
                hostedSession.setActiveExecutionWorkflow({
                    ...checkpointWorkflow,
                    collaborationStyle: "autonomous",
                    pairSwitchedToAutonomous: true,
                });
                await recordDecision({ decision, checkpointNumber });
                return checkpointResult(
                    "Continue the remaining work autonomously.",
                    { decision, checkpointNumber },
                );
            }

            if (decision === CHECKPOINT_DECISIONS.STOP) {
                hostedSession.setActiveExecutionWorkflow({
                    ...checkpointWorkflow,
                    pairPauseReason: "stop",
                    pairStopRequested: true,
                });
                await recordDecision({ decision, checkpointNumber });
                return checkpointResult(
                    "Stop Pair Execution now without task_completed; leave the Plan In Progress.",
                    { decision, checkpointNumber },
                    true,
                );
            }

            hostedSession.setActiveExecutionWorkflow({
                ...checkpointWorkflow,
                collaborationStyle: "autonomous",
                pairCapabilityLost: true,
            });
            await recordDecision({
                decision: CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS,
                checkpointNumber,
                reason: "invalid_checkpoint_response",
            });
            return checkpointResult(
                "The checkpoint response was not recognized. Continue autonomously without treating the increment as user-approved.",
                {
                    decision: CHECKPOINT_DECISIONS.SWITCH_TO_AUTONOMOUS,
                    checkpointNumber,
                    reason: "invalid_checkpoint_response",
                },
            );
        },
    });
}
