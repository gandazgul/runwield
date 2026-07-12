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
import { setActiveAgent as setActiveAgentFn } from "./agent-switching.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";
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
 * The returned function matches the `(userRequest, images, uiAPI) => Promise<void>`
 * signature used by `setActiveAgent()` / `startInteractiveSession()`.
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
 *   setActiveAgent?: typeof setActiveAgentFn,
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
    const setActiveAgent = __deps?.setActiveAgent || setActiveAgentFn;
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

    return async (userRequest, images, uiAPI, sessionManager) => {
        if (!hostedSession) throw new Error("createAgentHandler: hostedSession is required");
        const projectRoot = hostedSession.cwd;
        /**
         * @param {Parameters<typeof recordWorkflowMetricSource>[0]} metric
         * @param {Parameters<typeof recordWorkflowMetricSource>[1]} [deps]
         */
        function recordWorkflowMetricImpl(metric, deps = {}) {
            return recordWorkflowMetricSource(metric, { cwd: projectRoot, ...deps });
        }

        // If the live root is already this agent (the common case after a switch has been
        // applied), reuse it. Otherwise fall back to a transient invocation — this can happen
        // before the first applyPendingRootSwap (e.g. mid-turn from a workflow sub-step).
        const useRoot = hostedSession.getRootAgentName() === agentName;

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
            ? await runRootTurn({ hostedSession, agentName, userRequest, images, uiAPI, ...sessionOptions })
            : await runAgentSession({
                hostedSession,
                agentName,
                userRequest,
                images,
                uiAPI,
                sessionManager,
                useRootSession: false,
                ...sessionOptions,
            });

        const triage = readLatestTriageOutcome(messages, preTurnCount);
        if (triage) {
            await dispatchPostTriage({
                hostedSession,
                triage,
                userRequest,
                images,
                uiAPI,
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
            return;
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
            const slicerResult = await runSlicerAgent({
                planName,
                triageMeta,
                uiAPI,
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
                setActiveAgent(
                    hostedSession,
                    agentName,
                    createAgentHandler(agentName, { hostedSession }),
                    uiAPI,
                );
            }
            requestAgentStoppedAttention();
            return;
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
            /** @type {import('../workflow/workflow.js').PlanExecutionResult} */
            let executionResult;
            try {
                executionResult = await executePlan(
                    planName,
                    triageMeta,
                    uiAPI,
                    tasks,
                    sessionManager,
                    { hostedSession, recordWorkflowMetric: recordWorkflowMetricImpl },
                );
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                uiAPI?.appendSystemMessage?.(
                    `Plan execution failed: ${reason}. The Engineer may need manual intervention.`,
                    true,
                    "RunWield",
                );
                setActiveAgent(
                    hostedSession,
                    AGENTS.ENGINEER,
                    createAgentHandler(AGENTS.ENGINEER, { hostedSession }),
                    uiAPI,
                );
                requestAgentStoppedAttention();
                return;
            }

            hostedSession.consumePendingSwitchHandoff(); // Drain any switch requests from execution sub-agents

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
                    uiAPI,
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
                setActiveAgent(
                    hostedSession,
                    nextAgentName,
                    createAgentHandler(nextAgentName, { hostedSession }),
                    uiAPI,
                );
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
                uiAPI?.appendSystemMessage?.(
                    `Execution stopped: ${reason}. Staying with Engineer for manual intervention.`,
                    true,
                    "RunWield",
                );
                setActiveAgent(
                    hostedSession,
                    AGENTS.ENGINEER,
                    createAgentHandler(AGENTS.ENGINEER, { hostedSession }),
                    uiAPI,
                );
                requestAgentStoppedAttention();
            }
            return;
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
            return;
        }

        // If the agent declared they finished an assigned workflow task
        const taskCompleted = readLatestTaskCompletedOutcome(messages, preTurnCount);
        if (taskCompleted) {
            const workflow = hostedSession.getActiveExecutionWorkflow();
            if (workflow && !canCompleteActiveExecutionWorkflow(agentName)) {
                requestAgentStoppedAttention();
                return;
            }

            if (workflow?.triageMeta?.classification === "QUICK_FIX") {
                hostedSession.clearActiveExecutionWorkflow();
                await runMechanicalValidationImpl({
                    hostedSession,
                    uiAPI,
                    sessionManager,
                    cwd: workflow.executionCwd || projectRoot,
                });
                requestAgentStoppedAttention();
                return;
            }

            if (workflow && !shouldRunWorkflowValidation(workflow.triageMeta)) {
                hostedSession.clearActiveExecutionWorkflow();
                requestAgentStoppedAttention();
                return;
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
                            uiAPI?.appendSystemMessage?.(
                                `Workflow halted: Could not record implementation_finished before validation: ${reason}`,
                                true,
                                "RunWield",
                            );
                            requestAgentStoppedAttention();
                            return;
                        }
                    }
                }

                await runValidationLoopImpl({
                    hostedSession,
                    planName: workflow.planName,
                    planContent,
                    triageMeta: workflow.triageMeta,
                    uiAPI,
                    sessionManager,
                    finalAgentName: agentName,
                    __deps: { recordWorkflowMetric: recordWorkflowMetricImpl },
                });
                requestAgentStoppedAttention();
            }
        }

        requestAgentStoppedAttention();
    };
}
