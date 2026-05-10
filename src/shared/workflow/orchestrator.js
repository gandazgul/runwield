/**
 * @module shared/workflow/orchestrator
 * Session-level orchestrator for the triage flow.
 *
 * Each user message goes through the router agent first. When the router calls
 * `triage_report`, the tool terminates the router's turn and returns the
 * classification. This orchestrator wakes up at that point, reads the outcome,
 * and dispatches the next agent:
 *
 *   QUICK_FIX → Operator
 *   FEATURE   → Planner   → on `approved_execute`, runs `executePlan`
 *   PROJECT   → Architect → on `approved_execute`, runs `executePlan` (parallel tasks)
 *
 * Plan-feedback loops stay inside the planning session because plan_written
 * returns `feedback` non-terminating — the planner sees the tool result and
 * iterates without rebuilding LLM context.
 */

import { CWD } from "../../constants.js";
import { ensurePlansDir } from "../../plan-store.js";
import { setActiveAgent } from "../interactive/chat-session.js";
import { createDirectAgentHandler } from "../session/direct-agent.js";
import { runAgentSession } from "../session/session.js";
import { executePlan, runPlanningAgent } from "./workflow.js";

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
 */
export async function dispatchPostTriage({ triage, userRequest, images, uiAPI, sessionManager }) {
    if (!uiAPI) throw new Error("dispatchPostTriage: uiAPI is required");

    const triageBlock = buildTriageBlock(triage);
    const decoratedRequest = ["## User Request", userRequest, "", triageBlock].join("\n");

    if (triage.classification === "QUICK_FIX") {
        uiAPI.appendSystemMessage("=== Phase B: Operator (Execute) ===");
        setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);

        await runAgentSession({
            agentName: "operator",
            userRequest: decoratedRequest,
            images,
            uiAPI,
            sessionManager,
        });

        uiAPI.appendSystemMessage("✅ Operator execution complete.");
        sessionManager?.appendCustomMessageEntry?.(
            "system",
            "Quick fix executed by operator.",
            true,
            `Quick fix executed by operator. Summary:\n${triage.summary}`,
        );
        return;
    }

    if (triage.classification === "FEATURE" || triage.classification === "PROJECT") {
        const isFeature = triage.classification === "FEATURE";
        const agentName = isFeature ? "planner" : "architect";
        const displayName = isFeature ? "Planner" : "Architect";
        const phaseLabel = isFeature
            ? "FEATURE detected. Handing off to Planner..."
            : "PROJECT detected. Handing off to Architect for targeted deep exploration + planning...";

        uiAPI.appendSystemMessage(phaseLabel);
        uiAPI.appendSystemMessage(`=== Phase B: ${displayName} ===`);
        setActiveAgent(displayName, createDirectAgentHandler(agentName), uiAPI);

        await ensurePlansDir(CWD);

        const outcome = await runPlanningAgent({
            agentName,
            initialRequest: decoratedRequest,
            triageMeta: triage,
            uiAPI,
            sessionManager,
        });

        if (outcome.outcome !== "approved_execute" || !outcome.planName) return;

        await executePlan(
            outcome.planName,
            outcome.triageMeta || triage,
            uiAPI,
            outcome.tasks,
            sessionManager,
        );

        if (isFeature) {
            setActiveAgent("Architect", createDirectAgentHandler("architect"), uiAPI);
        } else {
            setActiveAgent("Engineer", createDirectAgentHandler("engineer"), uiAPI);
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

        const messages = await runAgentSession({
            agentName: "router",
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
