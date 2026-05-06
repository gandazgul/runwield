/**
 * @module triage-report
 * Custom tool for the Router to output a structured triage report and route
 * to the appropriate downstream agent.
 *
 * createTriageReportTool captures TUI context at session-start time and handles
 * all routing in execute — keeping this logic out of the router command.
 */

import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { setActiveAgent } from "../shared/chat-session.js";
import { createDirectAgentHandler } from "../shared/direct-agent.js";
import { planWrittenTool } from "./plan-written.js";
import { createUserInterviewTool } from "./user-interview.js";
import { ensurePlansDir } from "../plan-store.js";
import { CWD } from "../constants.js";

const TOOL_PARAMS = Type.Object({
    classification: StringEnum(["QUICK_FIX", "FEATURE", "PROJECT"], {
        description:
            "QUICK_FIX: 1-2 files, minor change. FEATURE: multiple files, new logic, needs a plan. PROJECT: architectural shift.",
    }),
    complexity: StringEnum(["LOW", "MEDIUM", "HIGH"], {
        description: "How complex is this task?",
    }),
    summary: Type.String({
        description: "Brief summary of what needs to be done and why.",
    }),
    affectedPaths: Type.Array(Type.String(), {
        description:
            "Ordered vertical-slice file list (high signal, not broad dump). Prefer files over directories; no globs. Order: entrypoint -> service/orchestrator -> core logic -> boundary integration -> nearest tests. QUICK_FIX: 1-3 paths, FEATURE/PROJECT: 3-8 paths.",
    }),
});

/**
 * Create the triage_report tool with routing context captured at session start.
 *
 * @param {{
 *   uiAPI?: import('../shared/workflow/workflow.js').UiAPI,
 *   sessionManager?: import('@mariozechner/pi-coding-agent').SessionManager,
 *   userRequest?: string,
 *   images?: Array<{base64: string, mimeType: string}>,
 * }} [opts]
 * @returns {import('@mariozechner/pi-coding-agent').ToolDefinition}
 */
export function createTriageReportTool({ uiAPI, sessionManager, userRequest = "", images } = {}) {
    return defineTool({
        name: "triage_report",
        label: "Triage Report",
        description: "Submit your triage classification for the user's request. " +
            "You MUST call this tool exactly once after exploring the codebase. " +
            "Do not output the classification as freeform text — use this tool.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const { classification, complexity, summary, affectedPaths } = params;

            uiAPI?.appendSystemMessage(
                `[Router] Classification: ${classification}, Complexity: ${complexity}. Summary: ${summary}`,
            );

            const triageBlock = [
                "## Triage Report",
                `- Classification: ${classification}`,
                `- Complexity: ${complexity}`,
                `- Summary: ${summary}`,
                `- Affected paths: ${affectedPaths.join(", ")}`,
                "",
            ].join("\n");

            // Dynamic import breaks the circular dep: triage-report → session → triage-report
            const { runAgentSession } = await import("../shared/session/session.js");
            const { runPlanLifecycle, buildRepairPrompt } = await import("../shared/workflow/workflow.js");

            if (classification === "QUICK_FIX") {
                uiAPI?.appendSystemMessage("=== Phase B: Operator (Execute) ===");
                setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);

                const operatorRequest = ["## User Request", userRequest, "", triageBlock].join("\n");

                await runAgentSession({
                    agentName: "operator",
                    userRequest: operatorRequest,
                    images,
                    uiAPI,
                    sessionManager,
                });

                uiAPI?.appendSystemMessage("✅ Operator execution complete.");
                sessionManager?.appendCustomMessageEntry?.(
                    "system",
                    "Quick fix executed by operator.",
                    true,
                    `Quick fix executed by operator. Summary:\n${summary}`,
                );
            } else if (classification === "FEATURE") {
                uiAPI?.appendSystemMessage("FEATURE detected. Handing off to Planner...");
                uiAPI?.appendSystemMessage("=== Phase B: Planner ===");
                setActiveAgent("Planner", createDirectAgentHandler("planner"), uiAPI);

                await ensurePlansDir(CWD);

                const plannerRequest = [
                    "## User Request",
                    userRequest,
                    "",
                    triageBlock,
                    "Based on the triage report above, explore the affected files and create a plan in the plans/ directory.",
                    "Before finalizing, ask clarification questions via user_interview when requirements are ambiguous.",
                    "Ask either one question or a focused batch of 1-3 questions, then incorporate the answers.",
                    "Choose a descriptive, kebab-case filename (e.g., plans/add-dark-mode-toggle.md).",
                ].join("\n");

                await runPlanLifecycle({
                    agentName: "planner",
                    customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
                    initialRequest: plannerRequest,
                    triageMeta: params,
                    uiAPI,
                    sessionManager,
                    buildRepairPrompt,
                });
            } else if (classification === "PROJECT") {
                uiAPI?.appendSystemMessage(
                    "PROJECT detected. Handing off to Architect for targeted deep exploration + planning...",
                );
                uiAPI?.appendSystemMessage("=== Phase B: Architect ===");
                setActiveAgent("Architect", createDirectAgentHandler("architect"), uiAPI);

                await ensurePlansDir(CWD);

                const architectRequest = [
                    "## User Request",
                    userRequest,
                    "",
                    triageBlock,
                    "Start with a targeted vertical-slice exploration from the triage input (especially affected paths).",
                    "Go deep on the request-related execution path; avoid broad repo surveys.",
                    "Then produce a comprehensive plan in plans/ with a descriptive kebab-case filename.",
                    "Before finalizing, ask clarification questions via user_interview when needed.",
                    "Ask either one question or a focused batch of 1-3 questions, then incorporate the answers.",
                    "Since this is a PROJECT, include a Tasks table for multi-agent execution.",
                ].join("\n");

                await runPlanLifecycle({
                    agentName: "architect",
                    customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
                    initialRequest: architectRequest,
                    triageMeta: params,
                    uiAPI,
                    sessionManager,
                    buildRepairPrompt,
                });
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Triage complete. Your role as Router is finished. Do not generate any further text.`,
                    },
                ],
                details: params,
            };
        },
    });
}
