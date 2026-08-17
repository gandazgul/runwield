// @ts-nocheck: extracted from checked JSDoc workflow.js; tightening types is out of scope for this structural split.
import { AGENTS } from "../../constants.js";
import { getAgentDisplayName } from "../session/agents.js";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { createPairCheckpointTool } from "../../tools/pair-checkpoint.ts";
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
) {
    if (!hostedSession) throw new Error("runEngineerWithPlan: hostedSession is required");
    const workflow = hostedSession.getActiveExecutionWorkflow?.();
    const collaborationStyle = workflow?.collaborationStyle || CollaborationStyles.AUTONOMOUS;
    const customTools = collaborationStyle === CollaborationStyles.PAIR
        ? [createPairCheckpointTool({ hostedSession })]
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
            dispatchKind: "plan_execution",
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

export async function runEngineerWithSegmentHandoff({ continuation, sessionManager, hostedSession }) {
    const workflow = hostedSession.getActiveExecutionWorkflow?.();
    const collaborationStyle = continuation.collaboration?.style || workflow?.collaborationStyle ||
        CollaborationStyles.AUTONOMOUS;
    const customTools = collaborationStyle === CollaborationStyles.PAIR
        ? [createPairCheckpointTool({ hostedSession })]
        : undefined;
    const userRequest = `${
        buildEngineerRequest(continuation.plan.planName, continuation.plan.markdown, continuation.approval?.feedback, {
            collaborationStyle,
            triageMeta: workflow?.triageMeta,
        })
    }\n\nExecution owner: ${continuation.executionOwner}.`;
    let messages;
    try {
        messages = await runActiveAgentTurn({
            hostedSession,
            agentName: continuation.executionOwner,
            userRequest,
            images: continuation.approval?.images,
            sessionManager,
            cwd: workflow?.executionCwd || hostedSession.cwd,
            dispatchKind: "plan_execution",
            ...(customTools ? { customTools } : {}),
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const hostedRootSession = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
        const rootMessages = hostedRootSession?.agent?.state?.messages || [];
        emitSystemStatus(
            hostedSession,
            buildEngineerPausedMessage(
                errorMessage,
                workflow?.projectRoot || hostedSession?.cwd,
                continuation.executionOwner,
            ),
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
                ? buildPairPausedMessage(pauseReason, workflow?.projectRoot || hostedSession?.cwd)
                : buildEngineerPausedMessage(
                    undefined,
                    workflow?.projectRoot || hostedSession?.cwd,
                    continuation.executionOwner,
                ),
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
