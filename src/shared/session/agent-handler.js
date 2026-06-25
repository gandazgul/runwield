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
} from "../workflow/workflow.js";
import {
    dispatchPostTriage as dispatchPostTriageFn,
    readLatestTriageOutcome as readLatestTriageOutcomeFn,
} from "../workflow/orchestrator.js";
import {
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
} from "../workflow/decisions.js";
import {
    clearActiveExecutionWorkflow,
    consumePendingSwitchHandoff,
    getActiveExecutionWorkflow,
    getRootAgentName,
    getRootAgentSession,
} from "./session-state.js";
import { runValidationLoop, shouldRunWorkflowValidation } from "../workflow/validation.js";
import { recordPlanEvent as recordPlanEventFn } from "../workflow/plan-lifecycle.js";
import { setActiveAgent as setActiveAgentFn } from "../interactive/chat-session.js";
import { join } from "@std/path";
import { AGENTS, CWD } from "../../constants.js";

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
 *   runValidationLoop?: typeof runValidationLoop,
 *   recordPlanEvent?: typeof recordPlanEventFn,
 *   setActiveAgent?: typeof setActiveAgentFn,
 *   _agentDefOverride?: import('./types.js').AgentDefinition,
 *   customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[],
 *   allowReturnToRouter?: boolean,
 * }} [__deps] - Test-only injection point.
 * @returns {import('./types.js').AgentMessageHandler}
 */
export function createAgentHandler(agentName, __deps) {
    const runAgentSession = __deps?.runAgentSession || runAgentSessionFn;
    const runRootTurn = __deps?.runRootTurn || runRootTurnFn;
    const readLatestTriageOutcome = __deps?.readLatestTriageOutcome || readLatestTriageOutcomeFn;
    const dispatchPostTriage = __deps?.dispatchPostTriage || dispatchPostTriageFn;
    const readLatestPlanOutcome = __deps?.readLatestPlanOutcome || readLatestPlanOutcomeFn;
    const readLatestTaskCompletedOutcome = __deps?.readLatestTaskCompletedOutcome || readLatestTaskCompletedOutcomeFn;
    const decidePostPlanning = __deps?.decidePostPlanning || decidePostPlanningFn;
    const decidePostExecution = __deps?.decidePostExecution || decidePostExecutionFn;
    const executePlan = __deps?.executePlan || executePlanFn;
    const runValidationLoopImpl = __deps?.runValidationLoop || runValidationLoop;
    const recordPlanEventImpl = __deps?.recordPlanEvent || recordPlanEventFn;
    const setActiveAgent = __deps?.setActiveAgent || setActiveAgentFn;
    const sessionOptions = {
        _agentDefOverride: __deps?._agentDefOverride,
        customTools: __deps?.customTools,
        allowReturnToRouter: __deps?.allowReturnToRouter,
    };

    return async (userRequest, images, uiAPI, sessionManager) => {
        // If the live root is already this agent (the common case after a switch has been
        // applied), reuse it. Otherwise fall back to a transient invocation — this can happen
        // before the first applyPendingRootSwap (e.g. mid-turn from a workflow sub-step).
        const useRoot = getRootAgentName() === agentName;

        // Capture the pre-turn message count so we only consider plan_written outcomes
        // from the current turn. Stale outcomes from earlier turns (e.g. an already-executed
        // approved_execute) would otherwise trigger duplicate executePlan calls on
        // follow-up questions.
        const preTurnCount = useRoot ? getRootAgentSession()?.agent?.state?.messages?.length ?? 0 : 0;

        const messages = useRoot
            ? await runRootTurn({ agentName, userRequest, images, uiAPI, ...sessionOptions })
            : await runAgentSession({
                agentName,
                userRequest,
                images,
                uiAPI,
                sessionManager,
                ...sessionOptions,
            });

        const triage = readLatestTriageOutcome(messages, preTurnCount);
        if (triage) {
            await dispatchPostTriage({
                triage,
                userRequest,
                images,
                uiAPI,
                sessionManager,
                __deps: {
                    createAgentHandler,
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
        if (planningDecision.kind === "execute_plan") {
            const planName = /** @type {string} */ (planningDecision.payload.planName);
            const triageMeta = /** @type {import('../../tools/plan-written.js').TriageMeta} */ (
                planningDecision.payload.triageMeta || {}
            );
            const tasks = /** @type {import('../workflow/workflow.js').PlanOutcomeResult["tasks"]} */ (
                planningDecision.payload.tasks
            );
            const executionResult = await executePlan(
                planName,
                triageMeta,
                uiAPI,
                tasks,
                sessionManager,
            );

            consumePendingSwitchHandoff(); // Drain any switch requests from execution sub-agents

            let planContent = "";
            try {
                planContent = await Deno.readTextFile(join(CWD, "plans", `${planName}.md`));
            } catch {
                // Ignore in tests or if the file doesn't exist
            }

            const executionDecision = decidePostExecution(executionResult, {
                planName,
                triageMeta,
                executionAgentName: AGENTS.ENGINEER,
            });

            if (executionDecision.kind === "run_validation") {
                await runValidationLoopImpl({
                    planName,
                    planContent,
                    triageMeta,
                    uiAPI,
                    sessionManager,
                    finalAgentName: agentName,
                });
            } else if (executionDecision.kind === "stay_with_agent") {
                const nextAgentName = /** @type {string} */ (executionDecision.payload.agentName || AGENTS.ENGINEER);
                setActiveAgent(nextAgentName, createAgentHandler(nextAgentName), uiAPI);
            }
            return;
        }

        // If the agent declared they finished an assigned workflow task
        const taskCompleted = readLatestTaskCompletedOutcome(messages);
        if (taskCompleted) {
            const workflow = getActiveExecutionWorkflow();
            if (workflow && !shouldRunWorkflowValidation(workflow.triageMeta)) {
                clearActiveExecutionWorkflow();
                return;
            }

            if (workflow) {
                let planContent = "";
                if (workflow.planName && workflow.planName !== "quick-fix") {
                    try {
                        planContent = await Deno.readTextFile(join(CWD, "plans", `${workflow.planName}.md`));
                    } catch {
                        // Ignore
                    }

                    try {
                        await recordPlanEventImpl({
                            cwd: CWD,
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
                        return;
                    }
                }

                await runValidationLoopImpl({
                    planName: workflow.planName,
                    planContent,
                    triageMeta: workflow.triageMeta,
                    uiAPI,
                    sessionManager,
                    finalAgentName: agentName,
                });
            }
        }
    };
}
