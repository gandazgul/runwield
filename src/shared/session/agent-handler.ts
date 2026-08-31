/**
 * @module shared/session/agent-handler
 * Workflow-aware handler for the active Agent. It runs one Agent turn, then
 * lets workflow tool outcomes decide whether any follow-up workflow step runs.
 */

import { runRootTurn } from "./session.js";
import {
    executePlan,
    finalizePlanImplementation,
    resolveExecutionOwner,
    runSlicerAgent,
} from "../workflow/workflow.js";
import { dispatchPostTriage } from "../workflow/orchestrator.ts";
import { systemLocalCIPort } from "../workflow/validation-local-ci.ts";
import { createGitPort } from "../git-port.ts";
import { SYSTEM_WORK_RECORD_MNEMOSYNE_PORT } from "../work-records/mnemosyne-port.ts";
import { decidePostExecution, decidePostPlanning, summarizeWorkflowDecision } from "../workflow/decisions.js";
import { recordWorkflowMetric } from "../workflow/metrics.js";
import {
    runMechanicalValidation,
    shouldRunWorkflowValidation,
    SYSTEM_SEMANTIC_REVIEW_PORT,
    type WorkflowValidationResult,
} from "../workflow/validation.ts";
import { runWorkflowValidationToStableBoundary } from "../workflow/validation-supervisor.ts";
import { switchActiveAgent } from "./agent-switching.js";
import { getAgentDisplayName } from "./agents.js";
import { emitHostedSessionRuntimeEvent, emitSystemStatus, RuntimeEventTypes } from "./session-runtime-events.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "./session-runtime-interactions.js";
import {
    acknowledgeTaskCompletion,
    claimPendingTaskCompletion,
    type PendingTaskCompletionClaim,
} from "./task-completion-session.ts";
import {
    claimWorkflowToolEvent,
    type PlanWrittenEventPayload,
    settleWorkflowToolEvent,
    type TriageReportEventPayload,
    waitForWorkflowToolEvent,
    type WorkflowToolEvent,
    type WorkflowToolEventKind,
} from "../workflow/workflow-tool-events.ts";
import { getStoredPlanPath, loadPlan } from "../../plan-store.js";
import { AGENTS } from "../../constants.js";
import { resolvePlanExecutionRuntimeAgent } from "../workflow/execution-agent.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type ActiveExecutionWorkflow = import("./hosted-session.js").ActiveExecutionWorkflow;
type HostedSession = import("./hosted-session.js").HostedSession;
type ImageAttachment = import("./types.js").ImageAttachment;
type SessionManager = import("@earendil-works/pi-coding-agent").SessionManager;
type TriageMeta = import("../../tools/plan-written.ts").TriageMeta;
type PlanExecutionResult = import("../workflow/workflow.js").PlanExecutionResult;
type WorkflowMetric = Parameters<typeof recordWorkflowMetric>[0];

interface RootAgentSessionState {
    dispose?: () => void | Promise<void>;
    agent?: { state?: { messages?: AgentMessage[] } };
}

interface AgentHandlerCompleteResult {
    kind: "complete";
    validationResult?: WorkflowValidationResult;
}

type AgentHandlerTurnResult = AgentHandlerCompleteResult;

export interface AgentHandlerOptions {
    hostedSession: HostedSession;
    customTools?: ToolDefinition[];
}

export type AgentHandler = (
    userRequest: string,
    images: ImageAttachment[],
    sessionManager: SessionManager,
    signal?: AbortSignal,
) => Promise<AgentHandlerTurnResult>;

interface RootTurnWorkflowEventResult {
    messages: AgentMessage[];
    event: WorkflowToolEvent | null;
}

async function runRootTurnUntilRootWorkflowEvent(args: {
    hostedSession: HostedSession;
    agentName: string;
    userRequest: string;
    images?: ImageAttachment[];
    customTools?: ToolDefinition[];
    rootAgentSession: RootAgentSessionState | null;
    signal?: AbortSignal;
}): Promise<RootTurnWorkflowEventResult> {
    const waitController = new AbortController();
    const turnController = new AbortController();
    const abortBoth = () => {
        const reason = args.signal?.reason || new DOMException("Root workflow turn canceled.", "AbortError");
        waitController.abort(reason);
        turnController.abort(reason);
    };
    if (args.signal?.aborted) abortBoth();
    args.signal?.addEventListener("abort", abortBoth, { once: true });

    const claimOptions: {
        kinds: WorkflowToolEventKind[];
        owningSession: RootAgentSessionState | null;
    } = {
        kinds: ["triage_report", "plan_written"],
        owningSession: args.rootAgentSession,
    };
    const eventPromise = waitForWorkflowToolEvent(args.hostedSession, {
        ...claimOptions,
        signal: waitController.signal,
    });
    const turnPromise = runRootTurn({
        hostedSession: args.hostedSession,
        agentName: args.agentName,
        userRequest: args.userRequest,
        images: args.images,
        customTools: args.customTools,
        signal: turnController.signal,
    });

    try {
        const first = await Promise.race([
            eventPromise.then((event) => ({ kind: "event" as const, event })),
            turnPromise.then((messages) => ({ kind: "turn" as const, messages })),
        ]);
        if (first.kind === "event") {
            if (
                first.event.kind === "plan_written" &&
                (first.event.payload as PlanWrittenEventPayload).outcome === "feedback"
            ) {
                const messages = await turnPromise;
                const latestPlanEvent = claimWorkflowToolEvent(args.hostedSession, claimOptions);
                if (latestPlanEvent && latestPlanEvent.eventId !== first.event.eventId) {
                    settleWorkflowToolEvent(args.hostedSession, first.event);
                    return { messages, event: latestPlanEvent };
                }
                return { messages, event: first.event };
            }
            turnPromise.catch(() => undefined);
            return { messages: [], event: first.event };
        }
        waitController.abort(new DOMException("Agent turn finished without root workflow event.", "AbortError"));
        const waitedEvent = await eventPromise.catch(() => null);
        return {
            messages: first.messages,
            event: waitedEvent || claimWorkflowToolEvent(args.hostedSession, claimOptions),
        };
    } finally {
        args.signal?.removeEventListener("abort", abortBoth);
    }
}

/**
 * @param {string} agentName
 * @param {import('./hosted-session.js').ActiveExecutionWorkflow} workflow
 * @returns {boolean}
 */
function canCompleteActiveExecutionWorkflow(agentName: string, workflow: ActiveExecutionWorkflow): boolean {
    if (workflow.triageMeta?.classification === "QUICK_FIX") return agentName === AGENTS.ENGINEER;
    return agentName === resolvePlanExecutionRuntimeAgent(workflow.executionAgent);
}

/**
 * @param {string} userRequest
 * @returns {boolean}
 */
function isDeliberateExecutionResume(userRequest: string): boolean {
    const normalized = userRequest.trim().toLowerCase().replaceAll(/\s+/g, " ");
    return [
        "continue",
        "continue execution",
        "continue pair execution",
        "resume",
        "resume execution",
        "resume pair execution",
        "proceed",
        "keep going",
    ].includes(normalized);
}

/**
 * @param {string} planName
 * @returns {boolean}
 */
function isMissingPrimaryPlanError(error: Error | string, planName: string): boolean {
    const reason = error instanceof Error ? error.message : String(error);
    return reason === `Plan not found: ${planName}` ||
        reason === `Plan not found in primary checkout: ${planName}`;
}

function refreshedQuickFixWorkflow(workflow: ActiveExecutionWorkflow): ActiveExecutionWorkflow {
    return {
        ...workflow,
        executionStarted: true,
        executionAttemptStartedAtMs: Date.now(),
    };
}

/**
 * Ask the user to restore a newly-created Plan that was stashed out of the
 * primary checkout while its execution worktree was active.
 *
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {string} planName
 * @returns {Promise<boolean>}
 */
async function requestMissingPrimaryPlanRetry(hostedSession: HostedSession, planName: string): Promise<boolean> {
    const planPath = `docs/plans/${planName}.md`;
    const message =
        `The Plan file "${planPath}" is missing from the main checkout. Restore it in the main checkout, then come back and pick Retry.`;
    emitSystemStatus(hostedSession, message, { level: "warning", header: "RunWield" });
    const response = await requestHostedSessionInteraction(
        hostedSession,
        {
            type: RuntimeInteractionTypes.SELECT,
            prompt: message,
            options: [
                { value: "retry", label: "Retry" },
                { value: "stop", label: "Stop" },
            ],
        },
        undefined,
        hostedSession.getManagedOperationCapability?.() || null,
    );
    return response.outcome === "selected" && response.value === "retry";
}

/**
 * Create an onMessage handler for the active Agent.
 *
 * The returned function produces the typed turn result consumed by
 * `SessionRuntime` prompt handling.
 *
 * After the Agent finishes, the handler checks the message stream for workflow
 * Custom Tool outcomes. The tool outcome, not the Agent name, decides whether
 * RunWield starts Triage dispatch, Plan execution, or Workflow Validation.
 *
 * The only options are the HostedSession it owns and any custom tools already
 * installed in that root session. Workflow machinery is always RunWield's real
 * implementation; tests control model output through the provider boundary.
 */
export function createAgentHandler(agentName: string, options: AgentHandlerOptions): AgentHandler {
    if (!options?.hostedSession) throw new Error("createAgentHandler: hostedSession is required");
    const { hostedSession, customTools } = options;

    return async (userRequest, images, sessionManager, signal) => {
        const projectRoot = hostedSession.cwd;
        const resumedWorkflow = hostedSession.getActiveExecutionWorkflow();
        if (
            (resumedWorkflow?.pairPauseReason || resumedWorkflow?.pairStopRequested) &&
            isDeliberateExecutionResume(userRequest)
        ) {
            const resumed = { ...resumedWorkflow };
            delete resumed.pairPauseReason;
            delete resumed.pairStopRequested;
            hostedSession.setActiveExecutionWorkflow(resumed);
        }
        function recordWorkflowMetricImpl(metric: WorkflowMetric) {
            return recordWorkflowMetric(metric, projectRoot);
        }

        // Interactive handlers must match the live root. A mismatched handler
        // would make the UI's active agent label and the callable tool set
        // diverge, so fail before any model turn can run.
        const rootAgentName = hostedSession.getRootAgentName();
        if (!rootAgentName) {
            throw new Error(`createAgentHandler: active handler "${agentName}" has no root Agent`);
        }
        if (rootAgentName && rootAgentName !== agentName) {
            throw new Error(
                `createAgentHandler: active handler "${agentName}" does not match root agent "${rootAgentName}"`,
            );
        }
        const rootAgentSession = hostedSession.getRootAgentSession() as RootAgentSessionState | null;
        let agentStoppedAttentionRequested = false;
        const requestAgentStoppedAttention = () => {
            if (agentStoppedAttentionRequested) return;
            if (hostedSession.consumeSuppressedAgentStoppedAttention()) return;
            agentStoppedAttentionRequested = true;
            emitHostedSessionRuntimeEvent(hostedSession, {
                type: RuntimeEventTypes.ATTENTION_REQUESTED,
                reason: "agentStopped",
                agentName: hostedSession.getRootAgentName() || agentName,
            });
        };

        let taskCompletion: PendingTaskCompletionClaim | null = claimPendingTaskCompletion(
            hostedSession,
            rootAgentSession,
        );
        if (taskCompletion?.workflow && !hostedSession.getActiveExecutionWorkflow()) {
            hostedSession.setActiveExecutionWorkflow({ ...taskCompletion.workflow });
        }
        let rootWorkflowEvent: WorkflowToolEvent | null = null;
        if (!taskCompletion) {
            const rootTurnResult = await runRootTurnUntilRootWorkflowEvent({
                hostedSession,
                agentName,
                userRequest,
                images,
                customTools,
                rootAgentSession,
                signal,
            });
            rootWorkflowEvent = rootTurnResult.event;
        }

        const triageEvent = rootWorkflowEvent?.kind === "triage_report"
            ? rootWorkflowEvent
            : claimWorkflowToolEvent(hostedSession, {
                kinds: ["triage_report"],
                owningSession: rootAgentSession,
            }) || claimWorkflowToolEvent(hostedSession, {
                kinds: ["triage_report"],
                owningSession: null,
            });
        if (triageEvent?.kind === "triage_report") {
            const triage = triageEvent.payload as TriageReportEventPayload;
            const validationResult = await dispatchPostTriage({
                hostedSession,
                triage,
                userRequest,
                images,
                sessionManager,
                localCI: systemLocalCIPort,
            });
            if (triageEvent) settleWorkflowToolEvent(hostedSession, triageEvent);
            if (validationResult?.epicContinuation) {
                return { kind: "complete", validationResult };
            }
            return { kind: "complete" };
        }

        // If plan_written publishes an accepted event, dispatch from that event.
        // Tool-result transcript messages are display and audit data only.
        const planEvent = rootWorkflowEvent?.kind === "plan_written"
            ? rootWorkflowEvent
            : claimWorkflowToolEvent(hostedSession, {
                kinds: ["plan_written"],
                owningSession: rootAgentSession,
            }) || claimWorkflowToolEvent(hostedSession, {
                kinds: ["plan_written"],
                owningSession: null,
            });
        const outcome = planEvent?.kind === "plan_written" ? planEvent.payload as PlanWrittenEventPayload : null;
        const planningDecision = decidePostPlanning(outcome, {
            planningAgentName: agentName,
            fallbackTriageMeta: {},
        });
        await recordWorkflowMetricImpl({
            category: "planning",
            event: "decision",
            agentName,
            planName: typeof planningDecision.payload.planName === "string"
                ? planningDecision.payload.planName
                : undefined,
            details: summarizeWorkflowDecision(planningDecision),
        });
        if (planEvent) settleWorkflowToolEvent(hostedSession, planEvent);
        if (planningDecision.kind === "start_slicer") {
            const planName = typeof planningDecision.payload.planName === "string"
                ? planningDecision.payload.planName
                : "";
            const triageMeta = (planningDecision.payload.triageMeta || {}) as TriageMeta;
            const reviewFeedback = typeof planningDecision.payload.reviewFeedback === "string"
                ? planningDecision.payload.reviewFeedback
                : undefined;
            const reviewImages = (Array.isArray(planningDecision.payload.reviewImages)
                ? planningDecision.payload.reviewImages
                : undefined) as ImageAttachment[] | undefined;
            const slicerResult = await runSlicerAgent({
                planName,
                triageMeta,
                reviewFeedback,
                reviewImages,
                hostedSession,
                sessionManager,
            });
            await recordWorkflowMetricImpl({
                category: "planning",
                event: "active_agent_transition",
                agentName: slicerResult.ok ? AGENTS.SLICER : agentName,
                planName,
                details: {
                    transition: slicerResult.ok ? "start_slicer" : "slicer_start_failed",
                    decisionKind: planningDecision.kind,
                },
            });
            if (!slicerResult.ok) {
                await switchActiveAgent(hostedSession, { agentName });
            }
            requestAgentStoppedAttention();
            return { kind: "complete" };
        }
        if (planningDecision.kind === "execute_plan") {
            await recordWorkflowMetricImpl({
                category: "planning",
                event: "active_agent_transition",
                agentName,
                planName: typeof planningDecision.payload.planName === "string"
                    ? planningDecision.payload.planName
                    : undefined,
                details: { transition: "execute_plan", decisionKind: planningDecision.kind },
            });
            const planName = typeof planningDecision.payload.planName === "string"
                ? planningDecision.payload.planName
                : "";
            const triageMeta = (planningDecision.payload.triageMeta || {}) as TriageMeta;
            const reviewFeedback = typeof planningDecision.payload.reviewFeedback === "string"
                ? planningDecision.payload.reviewFeedback
                : undefined;
            const reviewImages = (Array.isArray(planningDecision.payload.reviewImages)
                ? planningDecision.payload.reviewImages
                : undefined) as ImageAttachment[] | undefined;
            let executionResult: PlanExecutionResult;
            try {
                executionResult = await executePlan({
                    planName,
                    triageMeta,
                    sessionManager,
                    hostedSession,
                    reviewFeedback,
                    reviewImages,
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                const executionOwner = resolvePlanExecutionRuntimeAgent(
                    hostedSession.getActiveExecutionWorkflow()?.executionAgent || resolveExecutionOwner(triageMeta),
                );
                emitSystemStatus(
                    hostedSession,
                    `Plan execution failed: ${reason}. ${
                        getAgentDisplayName(executionOwner, projectRoot)
                    } may need manual intervention.`,
                    { level: "error", header: "RunWield" },
                );
                await switchActiveAgent(hostedSession, { agentName: executionOwner });
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            let planContent = "";
            let validationTriageMeta = triageMeta;
            try {
                const validationRoot = executionResult.executionContext?.executionCwd || projectRoot;
                const executionPlan = await loadPlan(validationRoot, planName);
                planContent = executionPlan?.markdown || executionPlan?.body || "";
                if (executionPlan?.attrs) {
                    validationTriageMeta = { ...triageMeta, ...executionPlan.attrs };
                }
            } catch {
                try {
                    planContent = await Deno.readTextFile(getStoredPlanPath(projectRoot, planName));
                } catch {
                    // Ignore in tests or if neither authoritative nor fallback Plan exists.
                }
            }

            const activeWorkflowAfterExecution = hostedSession.getActiveExecutionWorkflow();
            const executionCanceledBeforeStart = executionResult?.canceled && !activeWorkflowAfterExecution;
            const executionOwner = executionCanceledBeforeStart ? agentName : resolvePlanExecutionRuntimeAgent(
                activeWorkflowAfterExecution?.executionAgent || resolveExecutionOwner(triageMeta),
            );
            const executionDecision = decidePostExecution(executionResult, {
                planName,
                triageMeta,
                executionAgentName: executionOwner,
            });
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "decision",
                agentName: executionOwner,
                planName,
                details: summarizeWorkflowDecision(executionDecision),
            });

            if (executionDecision.kind === "complete_session") {
                if (typeof executionDecision.payload.message === "string" && executionDecision.payload.message) {
                    emitSystemStatus(hostedSession, executionDecision.payload.message, { header: "RunWield" });
                }
                requestAgentStoppedAttention();
            } else if (executionDecision.kind === "run_validation") {
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "active_agent_transition",
                    agentName: executionOwner,
                    planName,
                    details: { transition: "run_validation", decisionKind: executionDecision.kind },
                });
                const validationResult = await runWorkflowValidationToStableBoundary({
                    hostedSession,
                    planName,
                    planContent,
                    triageMeta: validationTriageMeta,
                    sessionManager,
                    executionContext: executionResult.executionContext,
                    finalAgentName: agentName,
                    git: createGitPort(),
                    localCI: systemLocalCIPort,
                    workRecordMnemosynePort: SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
                    semanticReviewPort: SYSTEM_SEMANTIC_REVIEW_PORT,
                });
                if (validationResult?.epicContinuation) {
                    return { kind: "complete", validationResult };
                }
                requestAgentStoppedAttention();
            } else if (executionDecision.kind === "stay_with_agent") {
                if (executionCanceledBeforeStart) {
                    requestAgentStoppedAttention();
                    return { kind: "complete" };
                }
                const nextAgentName = typeof executionDecision.payload.agentName === "string"
                    ? executionDecision.payload.agentName
                    : AGENTS.ENGINEER;
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "active_agent_transition",
                    agentName: nextAgentName,
                    planName,
                    details: { transition: "stay_with_agent", decisionKind: executionDecision.kind },
                });
                await switchActiveAgent(hostedSession, { agentName: nextAgentName });
                requestAgentStoppedAttention();
            } else {
                // halt — stay with the execution owner for manual recovery
                const reason = executionDecision.payload?.reason || "unknown";
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "active_agent_transition",
                    agentName: executionOwner,
                    planName,
                    details: {
                        transition: executionDecision.kind === "halt" ? "halt" : "stay_with_agent",
                        decisionKind: executionDecision.kind,
                        hasReason: Boolean(reason),
                    },
                });
                emitSystemStatus(
                    hostedSession,
                    `Execution stopped: ${reason}. Staying with ${executionOwner} for manual intervention.`,
                    { level: "error", header: "RunWield" },
                );
                await switchActiveAgent(hostedSession, { agentName: executionOwner });
                requestAgentStoppedAttention();
            }
            return { kind: "complete" };
        }

        if (planningDecision.kind === "stay_with_agent" || planningDecision.kind === "save_plan") {
            await recordWorkflowMetricImpl({
                category: "planning",
                event: "active_agent_transition",
                agentName,
                details: { transition: "stay_with_agent", decisionKind: planningDecision.kind },
            });
        } else if (planningDecision.kind === "halt") {
            await recordWorkflowMetricImpl({
                category: "planning",
                event: "active_agent_transition",
                agentName,
                details: { transition: "halt", decisionKind: planningDecision.kind },
            });
        }

        if (outcome) {
            return { kind: "complete" };
        }

        // If the agent declared they finished an assigned workflow task, consume the session-scoped
        // completion record produced by task_completed rather than inferring completion from the
        // root turn's message window. Steering and isolated sessions can both write outside this
        // handler's returned message slice, so the owning root session is the source of truth.
        taskCompletion ||= claimPendingTaskCompletion(hostedSession, rootAgentSession);
        if (taskCompletion) {
            const acceptedCompletion = taskCompletion;
            const acknowledgeCompletion = () => acknowledgeTaskCompletion(hostedSession, acceptedCompletion);
            const workflow = hostedSession.getActiveExecutionWorkflow();
            if (workflow?.executionStarted === false) {
                acknowledgeCompletion();
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }
            if (workflow?.pairPauseReason || workflow?.pairStopRequested) {
                acknowledgeCompletion();
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }
            if (workflow && !canCompleteActiveExecutionWorkflow(agentName, workflow)) {
                acknowledgeCompletion();
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            if (workflow?.triageMeta?.classification === "QUICK_FIX") {
                hostedSession.clearActiveExecutionWorkflow();
                await runMechanicalValidation({
                    hostedSession,
                    sessionManager,
                    cwd: workflow.executionCwd || projectRoot,
                    manualQaName: workflow.manualQaName,
                    manualQaContext: workflow.manualQaContext,
                }, systemLocalCIPort);
                acknowledgeCompletion();
                hostedSession.setActiveExecutionWorkflow(refreshedQuickFixWorkflow(workflow));
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            if (workflow && !shouldRunWorkflowValidation(workflow.triageMeta)) {
                hostedSession.clearActiveExecutionWorkflow();
                acknowledgeCompletion();
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            if (workflow) {
                if (workflow.planName && workflow.planName !== "quick-fix") {
                    if (!workflow.validationContinuation) {
                        while (true) {
                            try {
                                await finalizePlanImplementation({
                                    projectRoot,
                                    planName: workflow.planName,
                                    triageMeta: workflow.triageMeta,
                                    executionContext: workflow,
                                    hostedSession,
                                    executionReport: acceptedCompletion.report,
                                });
                                break;
                            } catch (error) {
                                const failure = error instanceof Error ? error : String(error);
                                if (isMissingPrimaryPlanError(failure, workflow.planName)) {
                                    const retry = await requestMissingPrimaryPlanRetry(
                                        hostedSession,
                                        workflow.planName,
                                    );
                                    if (retry) continue;
                                } else {
                                    const reason = error instanceof Error ? error.message : String(error);
                                    emitSystemStatus(
                                        hostedSession,
                                        `Workflow halted before validation because the implementation checkpoint failed: ${reason}`,
                                        { level: "error", header: "RunWield" },
                                    );
                                }
                                requestAgentStoppedAttention();
                                return { kind: "complete" };
                            }
                        }
                    }
                }

                let planContent = "";
                let validationTriageMeta = workflow.triageMeta;
                if (workflow.planName && workflow.planName !== "quick-fix") {
                    try {
                        const validationRoot = workflow.executionCwd || projectRoot;
                        const executionPlan = await loadPlan(validationRoot, workflow.planName);
                        planContent = executionPlan?.markdown || executionPlan?.body || "";
                        if (executionPlan?.attrs) {
                            validationTriageMeta = { ...workflow.triageMeta, ...executionPlan.attrs };
                        }
                    } catch {
                        // Ignore
                    }
                }

                const validationResult = await runWorkflowValidationToStableBoundary({
                    hostedSession,
                    planName: workflow.planName,
                    planContent,
                    triageMeta: validationTriageMeta,
                    sessionManager,
                    finalAgentName: agentName,
                    git: createGitPort(),
                    localCI: systemLocalCIPort,
                    workRecordMnemosynePort: SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
                    semanticReviewPort: SYSTEM_SEMANTIC_REVIEW_PORT,
                    ...(acceptedCompletion.completionId ? { taskCompletionId: acceptedCompletion.completionId } : {}),
                });
                if (!validationResult?.retainTaskCompletionClaim) acknowledgeCompletion();
                if (validationResult?.epicContinuation) {
                    return { kind: "complete", validationResult };
                }
                requestAgentStoppedAttention();
            } else {
                acknowledgeCompletion();
            }
        }

        requestAgentStoppedAttention();
        return { kind: "complete" };
    };
}
