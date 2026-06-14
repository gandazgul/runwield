/**
 * @module shared/workflow/orchestrator
 * Session-level orchestrator for the triage flow.
 *
 * Each user message goes through the router agent first. When the router calls
 * `triage_report`, the tool terminates the router's turn and returns the
 * classification. This orchestrator wakes up at that point, reads the outcome,
 * and dispatches the next agent:
 *
 * QUICK_FIX → Operator
 * FEATURE   → Planner   → on `approved_execute`, runs `executePlan`
 * PROJECT   → Architect → on `approved_execute`, runs `executePlan` (parallel tasks)
 *
 * Plan-feedback loops stay inside the planning session because plan_written
 * returns `feedback` non-terminating — the planner sees the tool result and
 * iterates without rebuilding LLM context.
 */

import { AGENTS, CWD } from "../../constants.js";
import { ensurePlansDir, loadPlan } from "../../plan-store.js";
import { applyPendingRootSwap, setActiveAgent } from "../interactive/chat-session.js";
import { createDirectAgentHandler } from "../session/direct-agent.js";
import { runAgentSession, runRootTurn } from "../session/session.js";
import { getAgentDisplayName } from "../session/agents.js";
import {
    consumePendingSwitchHandoff,
    getRootAgentName,
    popAgentInfo,
    pushAgentInfo,
} from "../session/session-state.js";
import { executePlan, readLatestTaskCompletedOutcome, runPlanningAgent } from "./workflow.js";
import { runValidationLoop, shouldRunWorkflowValidation } from "./validation.js";

export { runLocalCI, runValidationLoop } from "./validation.js";

/**
 * @typedef {Object} TriageOutcome
 * @property {"QUICK_FIX" | "FEATURE" | "PROJECT"} classification
 * @property {"LOW" | "MEDIUM" | "HIGH"} complexity
 * @property {string} summary
 * @property {string[]} affectedPaths
 */

/**
 * Read the latest triage_report tool result's details from a message stream.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {TriageOutcome | null}
 */
export function readLatestTriageOutcome(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "triage_report"
        ) {
            // @ts-ignore details set by tool implementation
            const details = msg.details;
            if (details && details.classification) {
                return /** @type {TriageOutcome} */ (details);
            }
        }
    }
    return null;
}

/**
 * @param {TriageOutcome} triage
 */
function buildTriageBlock(triage) {
    return [
        "## Triage Report",
        `- Classification: ${triage.classification}`,
        `- Complexity: ${triage.complexity}`,
        `- Summary: ${triage.summary}`,
        `- Affected paths: ${(triage.affectedPaths || []).join(", ")}`,
        "",
    ].join("\n");
}

/**
 * Dispatch the next agent based on the router's triage classification, then
 * (for FEATURE/PROJECT) execute the approved plan.
 *
 * @param {Object} args
 * @param {TriageOutcome} args.triage
 * @param {string} args.userRequest
 * @param {import('../session/types.js').ImageAttachment[] | undefined} args.images
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {{
 *   applyPendingRootSwap?: typeof applyPendingRootSwap,
 *   createDirectAgentHandler?: typeof createDirectAgentHandler,
 *   readLatestTaskCompletedOutcome?: typeof readLatestTaskCompletedOutcome,
 *   runRootTurn?: typeof runRootTurn,
 *   runValidationLoop?: typeof runValidationLoop,
 *   setActiveAgent?: typeof setActiveAgent,
 * }} [args.__deps]
 */
export async function dispatchPostTriage({ triage, userRequest, images, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("dispatchPostTriage: uiAPI is required");

    const triageBlock = buildTriageBlock(triage);
    const decoratedRequest = ["## User Request", userRequest, "", triageBlock].join("\n");
    const runValidationLoopImpl = __deps?.runValidationLoop || runValidationLoop;

    if (triage.classification === "QUICK_FIX") {
        const operatorDisplay = getAgentDisplayName(AGENTS.OPERATOR);
        uiAPI.appendSystemMessage(`=== Phase B: ${operatorDisplay} (Execute) ===`);

        const setActiveAgentImpl = __deps?.setActiveAgent || setActiveAgent;
        const createDirectAgentHandlerImpl = __deps?.createDirectAgentHandler || createDirectAgentHandler;
        const applyPendingRootSwapImpl = __deps?.applyPendingRootSwap || applyPendingRootSwap;
        const runRootTurnImpl = __deps?.runRootTurn || runRootTurn;
        const readLatestTaskCompletedOutcomeImpl = __deps?.readLatestTaskCompletedOutcome ||
            readLatestTaskCompletedOutcome;

        setActiveAgentImpl(AGENTS.OPERATOR, createDirectAgentHandlerImpl(AGENTS.OPERATOR), uiAPI);
        await applyPendingRootSwapImpl(uiAPI);

        const messages = await runRootTurnImpl({
            agentName: AGENTS.OPERATOR,
            userRequest: decoratedRequest,
            images,
            uiAPI,
        });
        const completed = readLatestTaskCompletedOutcomeImpl(messages);
        if (!completed) {
            uiAPI.appendSystemMessage(
                `${operatorDisplay} stopped without task_completed; QUICK_FIX may be incomplete.`,
                false,
                "Harns",
            );
        }
        return;
    }

    if (triage.classification === "FEATURE" || triage.classification === "PROJECT") {
        const isFeature = triage.classification === "FEATURE";
        const agentName = isFeature ? AGENTS.PLANNER : AGENTS.ARCHITECT;
        const displayName = getAgentDisplayName(agentName);
        const phaseLabel = isFeature
            ? `FEATURE detected. Handing off to ${displayName}...`
            : `PROJECT detected. Handing off to ${displayName} for targeted deep exploration + planning...`;

        uiAPI.appendSystemMessage(phaseLabel);
        uiAPI.appendSystemMessage(`=== Phase B: ${displayName} ===`);

        const { getConfiguredAgentModel } = await import("../session/session.js");
        pushAgentInfo(displayName, getConfiguredAgentModel(agentName));

        let shouldPop = true;
        try {
            await ensurePlansDir(CWD);

            const outcome = await runPlanningAgent({
                agentName,
                initialRequest: decoratedRequest,
                triageMeta: triage,
                uiAPI,
                sessionManager,
            });
            consumePendingSwitchHandoff(); // Drain any switch requests from planner

            if (outcome.outcome !== "approved_execute" || !outcome.planName) {
                setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);
                shouldPop = false;
                return;
            }

            const executionResult = await executePlan(
                outcome.planName,
                outcome.triageMeta || triage,
                uiAPI,
                outcome.tasks,
                sessionManager,
            );
            if (executionResult.executionComplete) {
                const plan = await loadPlan(CWD, outcome.planName);
                if (shouldRunWorkflowValidation(outcome.triageMeta || triage)) {
                    await runValidationLoopImpl({
                        planName: outcome.planName,
                        planContent: plan?.markdown || "",
                        triageMeta: outcome.triageMeta || triage,
                        uiAPI,
                        sessionManager,
                        finalAgentName: agentName,
                    });
                }
            } else {
                setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);
            }
        } finally {
            if (shouldPop) {
                popAgentInfo();
            }
        }
    }
}

/**
 * Build the onMessage handler used as the active agent at the start of a
 * chat session. Runs the router agent, reads its triage outcome, and
 * dispatches the next agent.
 *
 * @returns {import('../session/types.js').AgentMessageHandler}
 */
export function createRouterOrchestratorHandler() {
    return async (userRequest, images, uiAPI, sessionManager) => {
        if (!uiAPI) throw new Error("router orchestrator handler: uiAPI is required");

        // Use the live root AgentSession when the router is already established as root
        // (the normal startup case). Fallback to transient for tests/edge cases where the
        // root was not pre-built.
        const useRoot = getRootAgentName() === AGENTS.ROUTER;
        const messages = useRoot
            ? await runRootTurn({ agentName: AGENTS.ROUTER, userRequest, images, uiAPI })
            : await runAgentSession({
                agentName: AGENTS.ROUTER,
                userRequest,
                images,
                uiAPI,
                sessionManager,
            });

        const triage = readLatestTriageOutcome(messages);
        if (!triage) return;

        await dispatchPostTriage({ triage, userRequest, images, uiAPI, sessionManager });
    };
}
