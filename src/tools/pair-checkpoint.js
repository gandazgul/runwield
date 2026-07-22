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
} from "../shared/session/session-runtime-interactions.js";
import { recordWorkflowMetric } from "../shared/workflow/metrics.js";

/**
 * @param {{hostedSession: import('../shared/session/hosted-session.js').HostedSession, __deps?: {recordWorkflowMetric?: typeof recordWorkflowMetric}}} opts
 */
export function createPairCheckpointTool({ hostedSession, __deps = {} }) {
    if (!hostedSession) throw new Error("createPairCheckpointTool: hostedSession is required");
    const recordWorkflowMetricImpl = __deps.recordWorkflowMetric || recordWorkflowMetric;
    return defineTool({
        name: "pair_checkpoint",
        label: "Pair Checkpoint",
        description:
            "Pause Pair Execution after a coherent visible increment has been inspected in the headed browser. Returns the user's direction without completing the task.",
        parameters: Type.Object({
            summary: Type.String({ description: "Concise description of the visible increment." }),
            route: Type.Optional(Type.String({ description: "Route or URL currently shown." })),
            viewport: Type.Optional(Type.String({ description: "Viewport or device inspected." })),
            evidence: Type.Optional(
                Type.Array(Type.String(), { description: "Screenshot paths or visible evidence." }),
            ),
            diagnostics: Type.Optional(Type.String({ description: "Console, network, or runtime health summary." })),
            nextIncrement: Type.String({ description: "The next coherent increment proposed." }),
        }),
        async execute(toolCallId, params, signal) {
            const workflow = hostedSession.getActiveExecutionWorkflow?.();
            if (workflow?.executionAgent !== "frontend-engineer") {
                return {
                    content: [{ type: "text", text: "Pair checkpoint unavailable; continue autonomously." }],
                    details: { outcome: "autonomous", feedback: "", reason: "pair_mode_inactive" },
                };
            }
            const response = await requestHostedSessionInteraction(hostedSession, {
                type: RuntimeInteractionTypes.PAIR_CHECKPOINT,
                prompt: params.summary,
                toolCallId,
                _meta: params,
            }, signal);
            const decision = response.outcome === RuntimeInteractionOutcomes.SELECTED &&
                    ["continue", "revise", "autonomous", "stop"].includes(String(response.value))
                ? String(response.value)
                : response.outcome === RuntimeInteractionOutcomes.CANCELED
                ? "stop"
                : "autonomous";
            if (decision === "stop") {
                hostedSession.setActiveExecutionWorkflow({ ...workflow, pairStopRequested: true });
            } else if (workflow.pairStopRequested) {
                hostedSession.setActiveExecutionWorkflow({ ...workflow, pairStopRequested: undefined });
            }
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "pair_checkpoint_resolved",
                planName: workflow.planName,
                agentName: "frontend-engineer",
                details: { decision, supported: response.outcome !== RuntimeInteractionOutcomes.UNSUPPORTED },
            }, { cwd: workflow.projectRoot || hostedSession.cwd });
            const feedback = typeof response._meta?.feedback === "string" ? response._meta.feedback : "";
            return {
                content: [{
                    type: "text",
                    text: decision === "stop"
                        ? "Stop Pair Execution now without calling task_completed; leave the Plan in progress."
                        : decision === "revise"
                        ? `Revise this increment using the user's feedback: ${feedback}`
                        : decision === "autonomous"
                        ? "Continue the remaining work autonomously."
                        : "The increment is accepted; continue Pair Execution.",
                }],
                details: { outcome: decision, feedback, reason: "" },
            };
        },
    });
}
