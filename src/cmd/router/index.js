/**
 * @module cmd/router
 * Router command implementation (also used as default command).
 */

import { parseArgs } from "@std/cli/parse-args";
import { printCommandHelp } from "../../shared/help-text.js";
import { setActiveAgent, startInteractiveSession } from "../../shared/chat-session.js";
import { CLI_BIN, CWD } from "../../constants.js";
import { ensurePlansDir } from "../../plan-store.js";
import { triageReportTool } from "../../tools/triage-report.js";
import { planWrittenTool } from "../../tools/plan-written.js";
import { createUserInterviewTool } from "../../tools/user-interview.js";
import { runAgentSession } from "../../shared/session/session.js";
import { extractTriageReport } from "./triage.js";
import { askApprovalWithTasks, askPostApproval, executePlan, reviewLoop } from "../../shared/workflow/workflow.js";
import { createDirectAgentHandler } from "../../shared/direct-agent.js";
import { buildRepairPrompt } from "../../cmd/command-helpers.js";

/**
 * Handle router/default command.
 *
 * @param {string[]} argv
 */
export async function runRouterCommand(argv) {
    const parsedArgs = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsedArgs.help) {
        printCommandHelp("router");
        return;
    }

    const userRequest = argv.join(" ").trim();

    // Launch the interactive loop with the router as the default handler
    // The loop inside startInteractiveSession will call setActiveAgent
    await startInteractiveSession(userRequest, routerCmdOnMessage);
}

/**
 * Handle router logic inside the interactive loop.
 *
 * @param {string} userRequest
 * @param {Array<{base64: string, mimeType: string}>} images
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [sessionManager]
 */
export async function routerCmdOnMessage(userRequest, images, uiAPI, sessionManager) {
    await ensurePlansDir(CWD);

    uiAPI.appendSystemMessage("=== Phase A: Router (Triage) ===");

    const routerMessages = await runAgentSession({
        agentName: "router",
        customTools: [triageReportTool],
        userRequest,
        images,
        uiAPI,
        sessionManager,
    });

    const triage = extractTriageReport(routerMessages);

    if (!triage) {
        const lastAssistant = routerMessages.slice().reverse().find((m) => m.role === "assistant");
        if (lastAssistant && lastAssistant.stopReason === "error") {
            uiAPI.appendSystemMessage(
                `Router error: ${lastAssistant.errorMessage || "Unknown LLM error"}`,
                true,
            );
        } else {
            uiAPI.appendSystemMessage("ERROR: Router did not produce a triage report.", true);
        }
        return;
    }

    uiAPI.appendSystemMessage(
        `[Router] Classification: ${triage.classification}, ` +
            `Complexity: ${triage.complexity}. ` +
            `Summary: ${triage.summary}`,
    );

    if (triage.classification === "QUICK_FIX") {
        uiAPI.appendSystemMessage("QUICK_FIX detected. Handing off to Operator...");
        uiAPI.appendSystemMessage("=== Phase B1: Operator (Execute) ===");

        const operatorRequest = [
            "## User Request",
            userRequest,
            "",
            "## Triage Report",
            `- Classification: ${triage.classification}`,
            `- Complexity: ${triage.complexity}`,
            `- Summary: ${triage.summary}`,
            `- Affected paths: ${triage.affectedPaths.join(", ")}`,
            "",
        ].join("\n");

        await runAgentSession({
            agentName: "operator",
            userRequest: operatorRequest,
            uiAPI,
        });

        uiAPI.appendSystemMessage("✅ Operator execution complete.");

        if (sessionManager) {
            sessionManager.appendCustomMessageEntry(
                "system",
                "Quick fix executed by operator.",
                true,
                `Quick fix executed by operator. Summary:\n${triage.summary}`,
            );
        }
        setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
        return;
    }

    if (triage.classification === "FEATURE") {
        uiAPI.appendSystemMessage("FEATURE detected. Handing off to Planner...");

        const plannerRequest = [
            "## User Request",
            userRequest,
            "",
            "## Triage Report",
            `- Classification: ${triage.classification}`,
            `- Complexity: ${triage.complexity}`,
            `- Summary: ${triage.summary}`,
            `- Affected paths: ${triage.affectedPaths.join(", ")}`,
            "",
            "Based on the triage report above, explore the affected files and create a plan in the plans/ directory.",
            "Before finalizing, ask clarification questions via user_interview when requirements are ambiguous.",
            "Ask either one question or a focused batch of 1-3 questions, then incorporate the answers.",
            "Choose a descriptive, kebab-case filename (e.g., plans/add-dark-mode-toggle.md).",
        ].join("\n");

        const result = await reviewLoop({
            agentName: "planner",
            customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
            initialRequest: plannerRequest,
            triageMeta: triage,
            uiAPI,
        });

        if (result) {
            const action = await askPostApproval(result.planName, uiAPI);
            if (action === "proceed") {
                await executePlan(result.planName, triage, uiAPI);
                if (sessionManager) {
                    sessionManager.appendCustomMessageEntry(
                        "system",
                        `FEATURE plan executed: plans/${result.planName}.md.`,
                        true,
                        `FEATURE plan executed: plans/${result.planName}.md. Summary: ${triage.summary}`,
                    );
                }
                setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
            } else {
                uiAPI.appendSystemMessage(
                    `Plan saved. Resume later with: ${CLI_BIN} resume ${result.planName}`,
                );
                if (sessionManager) {
                    sessionManager.appendCustomMessageEntry(
                        "system",
                        `FEATURE plan generated and saved: plans/${result.planName}.md.`,
                        true,
                        `FEATURE plan generated and saved: plans/${result.planName}.md. User decided to execute later.`,
                    );
                }
            }
        }
        return;
    }

    if (triage.classification === "PROJECT") {
        uiAPI.appendSystemMessage(
            "PROJECT detected. Handing off to Architect for targeted deep exploration + planning...",
        );
        uiAPI.appendSystemMessage(
            "=== Phase D: Architect (Targeted Explore + Plan + Review) ===",
        );

        const architectRequest = [
            "## User Request",
            userRequest,
            "",
            "## Triage Report",
            `- Classification: ${triage.classification}`,
            `- Complexity: ${triage.complexity}`,
            `- Summary: ${triage.summary}`,
            `- Affected paths: ${triage.affectedPaths.join(", ")}`,
            "",
            "Start with a targeted vertical-slice exploration from the triage input (especially affected paths).",
            "Go deep on the request-related execution path; avoid broad repo surveys.",
            "Then produce a comprehensive plan in plans/ with a descriptive kebab-case filename.",
            "Before finalizing, ask clarification questions via user_interview when needed.",
            "Ask either one question or a focused batch of 1-3 questions, then incorporate the answers.",
            "Since this is a PROJECT, include a Tasks table for multi-agent execution.",
        ].join("\n");

        const result = await reviewLoop({
            agentName: "architect",
            customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
            initialRequest: architectRequest,
            triageMeta: triage,
            uiAPI,
        });

        if (result) {
            const action = await askApprovalWithTasks(result.planName, uiAPI, result.tasks);
            if (action === "proceed") {
                const execRes = await executePlan(result.planName, triage, uiAPI, result.tasks);
                if (execRes && execRes.repairRequired) {
                    uiAPI.appendSystemMessage(
                        `[Harns] Execution failed due to task table error. Rerouting to Architect for repair...`,
                    );
                    // Trigger immediate repair loop
                    await reviewLoop({
                        agentName: "architect",
                        customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
                        initialRequest: buildRepairPrompt(result.planName, execRes.error || "Unknown task table error"),
                        triageMeta: triage,
                        uiAPI,
                    });
                    // After repair, we might want to execute again, but we'll let the user decide if it comes back to approve/proceed
                } else if (sessionManager) {
                    sessionManager.appendCustomMessageEntry(
                        "system",
                        `PROJECT plan executed: plans/${result.planName}.md.`,
                        true,
                        `PROJECT plan executed: plans/${result.planName}.md. Summary: ${triage.summary}`,
                    );
                    setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
                }
            } else {
                uiAPI.appendSystemMessage(
                    `Plan saved. Resume later with: ${CLI_BIN} resume ${result.planName}`,
                );
                if (sessionManager) {
                    sessionManager.appendCustomMessageEntry(
                        "system",
                        `PROJECT plan generated and saved: plans/${result.planName}.md.`,
                        true,
                        `PROJECT plan generated and saved: plans/${result.planName}.md. User decided to execute later.`,
                    );
                }
            }
        }
    }
}
