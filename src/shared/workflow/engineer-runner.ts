// @ts-nocheck: extracted from checked JSDoc workflow.js; tightening types is out of scope for this structural split.
import { AGENTS } from "../../constants.js";
import { getAgentDisplayName } from "../session/agents.js";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import { createPairCheckpointTool } from "../../tools/pair-checkpoint.js";
import { recordWorkflowMetric } from "./metrics.js";
import { buildEngineerRequest } from "./workflow-prompts.js";
import { readLatestTaskCompletedMessage, readLatestTaskCompletedOutcome } from "./workflow-results.js";
import { CollaborationStyles, PairPauseReasons } from "./execution-collaboration.ts";

export async function runEngineerWithPlan(
    planName,
    planBody,
    sessionManager,
    executionCwd,
    hostedSession,
    projectRoot,
    routerMessage,
    reviewFeedback,
    reviewImages,
    executionAgent = AGENTS.ENGINEER,
    ports,
) {
    if (!hostedSession) throw new Error("runEngineerWithPlan: hostedSession is required");
    const runActiveAgentTurn = ports?.runActiveAgentTurn ||
        (await import("../session/agent-switching.js")).runActiveAgentTurn;
    const workflow = hostedSession.getActiveExecutionWorkflow?.();
    const collaborationStyle = workflow?.collaborationStyle || CollaborationStyles.AUTONOMOUS;
    const customTools = executionAgent === AGENTS.FRONTEND_ENGINEER && collaborationStyle === CollaborationStyles.PAIR
        ? [createPairCheckpointTool({
            hostedSession,
            recordWorkflowMetric: ports?.recordWorkflowMetric || recordWorkflowMetric,
        })]
        : undefined;
    let messages;
    try {
        messages = await runActiveAgentTurn({
            hostedSession,
            agentName: executionAgent,
            userRequest: `${
                buildEngineerRequest(planName, planBody, reviewFeedback, {
                    collaborationStyle,
                    triageMeta: workflow?.triageMeta,
                    routerMessage,
                })
            }\n\nExecution owner: ${executionAgent}.`,
            images: reviewImages,
            sessionManager,
            cwd: executionCwd,
            allowReturnToRouter: false,
            ...(customTools ? { customTools } : {}),
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const hostedRootSession = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
        const rootMessages = hostedRootSession?.agent?.state?.messages || [];
        emitSystemStatus(
            hostedSession,
            buildEngineerPausedMessage(errorMessage, projectRoot || hostedSession?.cwd, executionAgent),
            { level: "error", header: "RunWield" },
        );
        return { completed: false, messages: rootMessages, error: errorMessage };
    }

    const pauseReason = hostedSession.getActiveExecutionWorkflow?.()?.pairPauseReason;
    const completed = !pauseReason && readLatestTaskCompletedOutcome(messages);
    const completionReport = completed ? readLatestTaskCompletedMessage(messages) || undefined : undefined;
    if (!completed) {
        emitSystemStatus(
            hostedSession,
            pauseReason
                ? buildPairPausedMessage(pauseReason, projectRoot || hostedSession?.cwd)
                : buildEngineerPausedMessage(undefined, projectRoot || hostedSession?.cwd, executionAgent),
            { header: "RunWield" },
        );
    }

    return {
        completed,
        messages,
        ...(pauseReason ? { paused: true, pauseReason } : {}),
        ...(completionReport ? { completionReport } : {}),
    };
}

/**
 * @param {string} [reason]
 * @param {string} [projectRoot]
 */
export function buildEngineerPausedMessage(reason, projectRoot, executionAgent = AGENTS.ENGINEER) {
    const base = `${
        getAgentDisplayName(executionAgent, projectRoot)
    } stopped without task_completed; execution is paused. Say "continue" to resume with the execution owner.`;
    return reason ? `${base}\nReason: ${reason}` : base;
}

/**
 * @param {"stop"|"canceled"} pauseReason
 * @param {string} [projectRoot]
 */
export function buildPairPausedMessage(pauseReason, projectRoot) {
    const owner = getAgentDisplayName(AGENTS.FRONTEND_ENGINEER, projectRoot);
    return pauseReason === PairPauseReasons.STOP
        ? `${owner} stopped Pair Execution at your checkpoint direction. The Plan remains In Progress; say "continue" to resume Pair Execution.`
        : `${owner} paused because the Pair checkpoint interaction was canceled. No approval or Task Completion was recorded; say "continue" to resume.`;
}
