/**
 * @module shared/session/direct-agent
 * Handler for direct agent invocation — sends user prompts straight to
 * a named agent, bypassing the router triage flow. The agent takes over
 * the TUI with full streaming output (not suppressed like parallel tasks).
 */

import { runAgentSession as runAgentSessionFn, runRootTurn as runRootTurnFn } from "./session.js";
import {
    executePlan as executePlanFn,
    readLatestPlanOutcome as readLatestPlanOutcomeFn,
} from "../workflow/workflow.js";
import { consumePendingSwitchHandoff, getRootAgentName } from "./session-state.js";
import { runValidationLoop } from "../workflow/orchestrator.js";
import { join } from "@std/path";
import { CWD } from "../../constants.js";

/**
 * Create an onMessage handler that sends prompts directly to a specific agent.
 *
 * The returned function matches the `(userRequest, images, uiAPI) => Promise<void>`
 * signature used by `setActiveAgent()` / `startInteractiveSession()`.
 *
 * After the agent finishes, the handler checks the message stream for a
 * `plan_written` outcome. If the outcome is `approved_execute`, it dispatches
 * `executePlan` so direct dispatch (e.g. `hns agent architect "..."` or
 * `/agent architect`) actually runs the plan after the user picks "proceed".
 * Without this, the planner/architect's plan_written would return
 * approved_execute but no caller would pick it up.
 *
 * @param {string} agentName - Agent definition name (filename without .md)
 * @param {{
 *   runAgentSession?: typeof runAgentSessionFn,
 *   runRootTurn?: typeof runRootTurnFn,
 *   readLatestPlanOutcome?: typeof readLatestPlanOutcomeFn,
 *   executePlan?: typeof executePlanFn,
 *   runValidationLoop?: typeof runValidationLoop,
 * }} [__deps] - Test-only injection point.
 * @returns {import('./types.js').AgentMessageHandler}
 */
export function createDirectAgentHandler(agentName, __deps) {
    const runAgentSession = __deps?.runAgentSession || runAgentSessionFn;
    const runRootTurn = __deps?.runRootTurn || runRootTurnFn;
    const readLatestPlanOutcome = __deps?.readLatestPlanOutcome || readLatestPlanOutcomeFn;
    const executePlan = __deps?.executePlan || executePlanFn;
    const runValidationLoopImpl = __deps?.runValidationLoop || runValidationLoop;

    return async (userRequest, images, uiAPI, sessionManager) => {
        // If the live root is already this agent (the common case after a switch has been
        // applied), reuse it. Otherwise fall back to a transient invocation — this can happen
        // before the first applyPendingRootSwap (e.g. mid-turn from a workflow sub-step).
        const useRoot = getRootAgentName() === agentName;
        const messages = useRoot
            ? await runRootTurn({ agentName, userRequest, images, uiAPI })
            : await runAgentSession({
                agentName,
                userRequest,
                images,
                uiAPI,
                sessionManager,
            });

        // If the agent's plan_written returned approved_execute, dispatch the plan.
        // Other outcomes (saved/feedback/canceled/repair_required) self-terminate
        // appropriately inside plan_written.
        const outcome = readLatestPlanOutcome(messages);
        if (outcome && outcome.outcome === "approved_execute" && outcome.planName) {
            await executePlan(
                outcome.planName,
                outcome.triageMeta || {},
                uiAPI,
                outcome.tasks,
                sessionManager,
            );

            consumePendingSwitchHandoff(); // Drain any switch requests from execution sub-agents

            let planContent = "";
            try {
                planContent = await Deno.readTextFile(join(CWD, "plans", `${outcome.planName}.md`));
            } catch {
                // Ignore in tests or if the file doesn't exist
            }

            await runValidationLoopImpl({
                planName: outcome.planName,
                planContent,
                triageMeta: outcome.triageMeta || {},
                uiAPI,
                sessionManager,
            });
        }
    };
}
