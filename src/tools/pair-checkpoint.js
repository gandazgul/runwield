/**
 * @module pair-checkpoint
 * Non-terminal visual checkpoint tool for Frontend Engineer Pair Execution.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
    supportsHostedSessionInteraction,
} from "../shared/session/session-runtime-interactions.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

const CHECKPOINT_DECISIONS = Object.freeze({
    CONTINUE: "continue",
    REVISE: "revise",
    SWITCH_TO_AUTONOMOUS: "switch_to_autonomous",
    STOP: "stop",
});

/**
 * @typedef {Object} PairCheckpointDetails
 * @property {string} decision
 * @property {number} [checkpointNumber]
 * @property {string} [feedback]
 * @property {string} [reason]
 */

/**
 * @param {string} text
 * @param {PairCheckpointDetails} details
 * @param {boolean} [terminate]
 */
function checkpointResult(text, details, terminate = false) {
    return { content: [{ type: /** @type {const} */ ("text"), text }], details, terminate };
}

/**
 * @param {import('../shared/session/hosted-session.js').ActiveExecutionWorkflow} workflow
 * @returns {import('../shared/session/hosted-session.js').ActiveExecutionWorkflow}
 */
function clearPairPause(workflow) {
    const next = { ...workflow };
    delete next.pairPauseReason;
    delete next.pairStopRequested;
    return next;
}

/**
 * @param {{
 *   hostedSession: import('../shared/session/hosted-session.js').HostedSession,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} opts
 */
export function createPairCheckpointTool(
    { hostedSession, recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric },
) {
    if (!hostedSession) throw new Error("createPairCheckpointTool: hostedSession is required");
    /**
     * @param {PairCheckpointDetails} details
     */
    function recordDecision(details) {
        void recordWorkflowMetricImpl({
            category: "execution",
            event: "pair_checkpoint_decided",
            details: {
                checkpointNumber: details.checkpointNumber,
                decision: details.decision,
                reason: details.reason,
            },
        }, { cwd: hostedSession.cwd });
    }
    return defineTool({
        name: "pair_checkpoint",
        label: "Pair Checkpoint",
        description:
            "Pause active Pair Execution after a coherent visible increment has been inspected in the headed browser. Returns the user's direction without completing the task or starting validation.",
        parameters: Type.Object({
            summary: Type.String({
                minLength: 1,
                description: "Concise description of the visible increment now available for review.",
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
        }, { additionalProperties: false }),
        async execute(toolCallId, params, signal) {
            const workflow = hostedSession.getActiveExecutionWorkflow?.();
            if (
                workflow?.executionAgent !== "frontend-engineer" || workflow.executionStarted === false ||
                workflow.collaborationStyle !== "pair"
            ) {
                return checkpointResult(
                    "Pair checkpoint is inactive; continue autonomously.",
                    { decision: "inactive", reason: "pair_execution_inactive" },
                );
            }
            if (workflow.pairPauseReason || workflow.pairStopRequested) {
                return checkpointResult(
                    "Pair Execution is already paused. Do not continue implementation or call task_completed until the user deliberately resumes execution.",
                    { decision: "inactive", reason: "pair_execution_paused" },
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
                recordDecision({
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

            const response = await requestHostedSessionInteraction(hostedSession, {
                type: RuntimeInteractionTypes.PAIR_CHECKPOINT,
                prompt: params.summary,
                toolCallId,
                _meta: { ...params, checkpointNumber },
            }, signal);

            if (response.outcome === RuntimeInteractionOutcomes.CANCELED) {
                hostedSession.setActiveExecutionWorkflow({ ...checkpointWorkflow, pairPauseReason: "canceled" });
                recordDecision({
                    decision: "canceled",
                    checkpointNumber,
                    reason: "checkpoint_interaction_canceled",
                });
                return checkpointResult(
                    "The Pair checkpoint interaction was canceled. Pause this turn without task_completed; no increment approval was recorded.",
                    { decision: "canceled", checkpointNumber, reason: "checkpoint_interaction_canceled" },
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
                recordDecision({
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
                recordDecision({ decision, checkpointNumber });
                return checkpointResult(
                    "The increment is accepted; continue Pair Execution.",
                    { decision, checkpointNumber },
                );
            }

            if (decision === CHECKPOINT_DECISIONS.REVISE) {
                const feedback = typeof response._meta?.feedback === "string" ? response._meta.feedback.trim() : "";
                if (!feedback) {
                    hostedSession.setActiveExecutionWorkflow({ ...checkpointWorkflow, pairPauseReason: "canceled" });
                    recordDecision({ decision: "canceled", checkpointNumber, reason: "revision_feedback_required" });
                    return checkpointResult(
                        "Revision was selected without feedback. Pause this turn without task_completed; no increment approval was recorded.",
                        { decision: "canceled", checkpointNumber, reason: "revision_feedback_required" },
                        true,
                    );
                }
                hostedSession.setActiveExecutionWorkflow(checkpointWorkflow);
                recordDecision({ decision, checkpointNumber });
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
                recordDecision({ decision, checkpointNumber });
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
                recordDecision({ decision, checkpointNumber });
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
            recordDecision({
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
