/**
 * @module shared/session/agent-handler
 * Workflow-aware handler for the active Agent. It runs one Agent turn, then
 * lets workflow tool outcomes decide whether any follow-up workflow step runs.
 */

import { runAgentSession as runAgentSessionFn, runRootTurn as runRootTurnFn } from "./session.js";
import {
    executePlan as executePlanFn,
    readLatestPlanOutcome as readLatestPlanOutcomeFn,
    readLatestTaskCompletedOutcome as readLatestTaskCompletedOutcomeFn,
    runSlicerAgent as runSlicerAgentFn,
} from "../workflow/workflow.js";
import { readLatestReturnToRouterOutcome } from "../workflow/workflow-results.js";
import {
    dispatchPostTriage as dispatchPostTriageFn,
    readLatestTriageOutcome as readLatestTriageOutcomeFn,
} from "../workflow/orchestrator.js";
import {
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
    summarizeWorkflowDecision,
} from "../workflow/decisions.js";
import { recordWorkflowMetric } from "../workflow/metrics.js";
import { runMechanicalValidation, runValidationLoop, shouldRunWorkflowValidation } from "../workflow/validation.js";
import { recordPlanEvent as recordPlanEventFn } from "../workflow/plan-lifecycle.js";
import { switchActiveAgent as switchActiveAgentFn } from "./agent-switching.js";
import { emitHostedSessionRuntimeEvent, emitSystemStatus, RuntimeEventTypes } from "./session-runtime-events.js";
import { join } from "@std/path";
import { AGENTS } from "../../constants.js";

/**
 * @param {string} agentName
 * @returns {boolean}
 */
function canCompleteActiveExecutionWorkflow(agentName) {
    return agentName === AGENTS.ENGINEER;
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
 * @param {string} agentName - Agent definition name (filename without .md)
 * @param {{
 *   runAgentSession?: typeof runAgentSessionFn,
 *   runRootTurn?: typeof runRootTurnFn,
 *   readLatestTriageOutcome?: typeof readLatestTriageOutcomeFn,
 *   dispatchPostTriage?: typeof dispatchPostTriageFn,
 *   readLatestPlanOutcome?: typeof readLatestPlanOutcomeFn,
 *   readLatestTaskCompletedOutcome?: typeof readLatestTaskCompletedOutcomeFn,
 *   decidePostPlanning?: typeof decidePostPlanningFn,
 *   decidePostExecution?: typeof decidePostExecutionFn,
 *   executePlan?: typeof executePlanFn,
 *   runSlicerAgent?: typeof runSlicerAgentFn,
 *   runValidationLoop?: typeof runValidationLoop,
 *   runMechanicalValidation?: typeof runMechanicalValidation,
 *   recordPlanEvent?: typeof recordPlanEventFn,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   switchActiveAgent?: typeof switchActiveAgentFn,
 *   requestAttention?: (hostedSession: import('./hosted-session.js').HostedSession, reason: "agentStopped", agentName: string) => void,
 *   hostedSession?: import('./hosted-session.js').HostedSession,
 *   _agentDefOverride?: import('./types.js').AgentDefinition,
 *   customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[],
 *   allowReturnToRouter?: boolean,
 * }} [__deps] - Test-only injection point.
 * @returns {import('./types.js').AgentMessageHandler}
 */
export function createAgentHandler(agentName, __deps) {
    const hostedSession = __deps?.hostedSession;
    const runAgentSession = __deps?.runAgentSession || runAgentSessionFn;
    const runRootTurn = __deps?.runRootTurn || runRootTurnFn;
    const readLatestTriageOutcome = __deps?.readLatestTriageOutcome || readLatestTriageOutcomeFn;
    const dispatchPostTriage = __deps?.dispatchPostTriage || dispatchPostTriageFn;
    const readLatestPlanOutcome = __deps?.readLatestPlanOutcome || readLatestPlanOutcomeFn;
    const readLatestTaskCompletedOutcome = __deps?.readLatestTaskCompletedOutcome || readLatestTaskCompletedOutcomeFn;
    const decidePostPlanning = __deps?.decidePostPlanning || decidePostPlanningFn;
    const decidePostExecution = __deps?.decidePostExecution || decidePostExecutionFn;
    const executePlan = __deps?.executePlan || executePlanFn;
    const runSlicerAgent = __deps?.runSlicerAgent || runSlicerAgentFn;
    const runValidationLoopImpl = __deps?.runValidationLoop || runValidationLoop;
    const runMechanicalValidationImpl = __deps?.runMechanicalValidation || runMechanicalValidation;
    const recordPlanEventImpl = __deps?.recordPlanEvent || recordPlanEventFn;
    const recordWorkflowMetricSource = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const switchActiveAgent = __deps?.switchActiveAgent || switchActiveAgentFn;
    const requestAttention = __deps?.requestAttention || ((targetSession, reason, targetAgentName) => {
        emitHostedSessionRuntimeEvent(targetSession, {
            type: RuntimeEventTypes.ATTENTION_REQUESTED,
            reason,
            agentName: targetAgentName,
        });
    });
    const sessionOptions = {
        _agentDefOverride: __deps?._agentDefOverride,
        customTools: __deps?.customTools,
        allowReturnToRouter: __deps?.allowReturnToRouter,
    };

    return async (userRequest, images, sessionManager) => {
        if (!hostedSession) throw new Error("createAgentHandler: hostedSession is required");
        const projectRoot = hostedSession.cwd;
        /**
         * @param {Parameters<typeof recordWorkflowMetricSource>[0]} metric
         * @param {Parameters<typeof recordWorkflowMetricSource>[1]} [deps]
         */
        function recordWorkflowMetricImpl(metric, deps = {}) {
            return recordWorkflowMetricSource(metric, { cwd: projectRoot, ...deps });
        }

        // Interactive handlers must match the live root. A mismatched handler
        // would make the UI's active agent label and the callable tool set
        // diverge, so fail before any model turn can run.
        const rootAgentName = hostedSession.getRootAgentName();
        if (rootAgentName && rootAgentName !== agentName) {
            throw new Error(
                `createAgentHandler: active handler "${agentName}" does not match root agent "${rootAgentName}"`,
            );
        }
        const useRoot = rootAgentName === agentName;

        // Capture the pre-turn message count so we only consider plan_written outcomes
        // from the current turn. Stale outcomes from earlier turns (e.g. an already-executed
        // approved_execute) would otherwise trigger duplicate executePlan calls on
        // follow-up questions.
        const rootAgentSession = /** @type {any} */ (hostedSession.getRootAgentSession());
        const preTurnCount = useRoot ? rootAgentSession?.agent?.state?.messages?.length ?? 0 : 0;
        let agentStoppedAttentionRequested = false;
        const requestAgentStoppedAttention = () => {
            if (agentStoppedAttentionRequested) return;
            agentStoppedAttentionRequested = true;
            requestAttention(hostedSession, "agentStopped", agentName);
        };

        const messages = useRoot
            ? await runRootTurn({ hostedSession, agentName, userRequest, images, ...sessionOptions })
            : await runAgentSession({
                hostedSession,
                agentName,
                userRequest,
                images,
                sessionManager,
                useRootSession: false,
                ...sessionOptions,
            });

        const routerHandoff = readLatestReturnToRouterOutcome(messages, preTurnCount);
        if (routerHandoff) {
            return {
                kind: "handoff",
                agentName: routerHandoff.agentName,
                userRequest: routerHandoff.reason,
            };
        }

        const triage = readLatestTriageOutcome(messages, preTurnCount);
        if (triage) {
            await dispatchPostTriage({
                hostedSession,
                triage,
                userRequest,
                images,
                sessionManager,
                __deps: {
                    createAgentHandler: (nextAgentName) =>
                        createAgentHandler(nextAgentName, {
                            hostedSession,
                            recordWorkflowMetric: recordWorkflowMetricImpl,
                        }),
                    recordWorkflowMetric: recordWorkflowMetricImpl,
                },
            });
            return { kind: "complete" };
        }

        // If the agent's plan_written returned approved_execute, dispatch the plan.
        // Other outcomes (saved/feedback/canceled/repair_required) self-terminate
        // appropriately inside plan_written.
        const outcome = readLatestPlanOutcome(messages, preTurnCount);
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
        if (planningDecision.kind === "start_slicer") {
            const planName = /** @type {string} */ (planningDecision.payload.planName);
            const triageMeta = /** @type {import('../../tools/plan-written.js').TriageMeta} */ (
                planningDecision.payload.triageMeta || {}
            );
            const reviewFeedback = typeof planningDecision.payload.reviewFeedback === "string"
                ? planningDecision.payload.reviewFeedback
                : undefined;
            const reviewImages = /** @type {Array<{base64: string, mimeType: string}> | undefined} */ (
                Array.isArray(planningDecision.payload.reviewImages) ? planningDecision.payload.reviewImages : undefined
            );
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
            const planName = /** @type {string} */ (planningDecision.payload.planName);
            const triageMeta = /** @type {import('../../tools/plan-written.js').TriageMeta} */ (
                planningDecision.payload.triageMeta || {}
            );
            const tasks = /** @type {import('../workflow/workflow.js').PlanOutcomeResult["tasks"]} */ (
                planningDecision.payload.tasks
            );
            const reviewFeedback = typeof planningDecision.payload.reviewFeedback === "string"
                ? planningDecision.payload.reviewFeedback
                : undefined;
            const reviewImages = /** @type {Array<{base64: string, mimeType: string}> | undefined} */ (
                Array.isArray(planningDecision.payload.reviewImages) ? planningDecision.payload.reviewImages : undefined
            );
            /** @type {import('../workflow/workflow.js').PlanExecutionResult} */
            let executionResult;
            try {
                executionResult = await executePlan({
                    planName,
                    triageMeta,
                    structuredTasks: tasks,
                    sessionManager,
                    hostedSession,
                    reviewFeedback,
                    reviewImages,
                    __deps: {
                        recordWorkflowMetric: recordWorkflowMetricImpl,
                    },
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                emitSystemStatus(
                    hostedSession,
                    `Plan execution failed: ${reason}. The Engineer may need manual intervention.`,
                    { level: "error", header: "RunWield" },
                );
                await switchActiveAgent(hostedSession, { agentName: AGENTS.ENGINEER });
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            let planContent = "";
            try {
                planContent = await Deno.readTextFile(join(projectRoot, "plans", `${planName}.md`));
            } catch {
                // Ignore in tests or if the file doesn't exist
            }

            const executionDecision = decidePostExecution(executionResult, {
                planName,
                triageMeta,
                executionAgentName: AGENTS.ENGINEER,
            });
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "decision",
                agentName: AGENTS.ENGINEER,
                planName,
                details: summarizeWorkflowDecision(executionDecision),
            });

            if (executionDecision.kind === "run_validation") {
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "active_agent_transition",
                    agentName: AGENTS.ENGINEER,
                    planName,
                    details: { transition: "run_validation", decisionKind: executionDecision.kind },
                });
                await runValidationLoopImpl({
                    hostedSession,
                    planName,
                    planContent,
                    triageMeta,
                    sessionManager,
                    finalAgentName: agentName,
                    __deps: { recordWorkflowMetric: recordWorkflowMetricImpl },
                });
                requestAgentStoppedAttention();
            } else if (executionDecision.kind === "stay_with_agent") {
                const nextAgentName = /** @type {string} */ (executionDecision.payload.agentName || AGENTS.ENGINEER);
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
                // halt or repair_plan — stay with Engineer for manual recovery
                const reason = executionDecision.payload?.reason || "unknown";
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "active_agent_transition",
                    agentName: AGENTS.ENGINEER,
                    planName,
                    details: {
                        transition: executionDecision.kind === "halt" ? "halt" : "stay_with_agent",
                        decisionKind: executionDecision.kind,
                        hasReason: Boolean(reason),
                    },
                });
                emitSystemStatus(
                    hostedSession,
                    `Execution stopped: ${reason}. Staying with Engineer for manual intervention.`,
                    { level: "error", header: "RunWield" },
                );
                await switchActiveAgent(hostedSession, { agentName: AGENTS.ENGINEER });
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

        // If the agent declared they finished an assigned workflow task
        const taskCompleted = readLatestTaskCompletedOutcome(messages, preTurnCount);
        if (taskCompleted) {
            const workflow = hostedSession.getActiveExecutionWorkflow();
            if (workflow && !canCompleteActiveExecutionWorkflow(agentName)) {
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            if (workflow?.triageMeta?.classification === "QUICK_FIX") {
                hostedSession.clearActiveExecutionWorkflow();
                await runMechanicalValidationImpl({
                    hostedSession,
                    sessionManager,
                    cwd: workflow.executionCwd || projectRoot,
                    manualQaName: workflow.manualQaName,
                    manualQaContext: workflow.manualQaContext,
                });
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            if (workflow && !shouldRunWorkflowValidation(workflow.triageMeta)) {
                hostedSession.clearActiveExecutionWorkflow();
                requestAgentStoppedAttention();
                return { kind: "complete" };
            }

            if (workflow) {
                let planContent = "";
                if (workflow.planName && workflow.planName !== "quick-fix") {
                    try {
                        planContent = await Deno.readTextFile(join(projectRoot, "plans", `${workflow.planName}.md`));
                    } catch {
                        // Ignore
                    }

                    if (!workflow.validationContinuation) {
                        try {
                            await recordPlanEventImpl({
                                cwd: projectRoot,
                                planName: workflow.planName,
                                event: "implementation_finished",
                                currentStatus: "in_progress",
                                details: { triageMeta: workflow.triageMeta },
                            });
                        } catch (error) {
                            const reason = error instanceof Error ? error.message : String(error);
                            emitSystemStatus(
                                hostedSession,
                                `Workflow halted: Could not record implementation_finished before validation: ${reason}`,
                                { level: "error", header: "RunWield" },
                            );
                            requestAgentStoppedAttention();
                            return { kind: "complete" };
                        }
                    }
                }

                await runValidationLoopImpl({
                    hostedSession,
                    planName: workflow.planName,
                    planContent,
                    triageMeta: workflow.triageMeta,
                    sessionManager,
                    finalAgentName: agentName,
                    __deps: { recordWorkflowMetric: recordWorkflowMetricImpl },
                });
                requestAgentStoppedAttention();
            }
        }

        requestAgentStoppedAttention();
        return { kind: "complete" };
    };
}
