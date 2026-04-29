/**
 * @module cmd/router
 * Router command implementation (also used as default command).
 */

import { parseArgs } from "@std/cli/parse-args";
import { printCommandHelp } from "../../shared/help-text.js";
import { setActiveAgent, startInteractiveSession } from "../../shared/chat-session.js";
import { CLI_BIN, CWD, TOOLSETS } from "../../constants.js";
import { ensurePlansDir } from "../../plan-store.js";
import { triageReportTool } from "../../tools/triage-report.js";
import { planWrittenTool } from "../../tools/plan-written.js";
import { runAgentSession } from "../../shared/session.js";
import { extractTriageReport } from "../../shared/triage.js";
import { askApprovalWithTasks, askPostApproval, executePlan, reviewLoop } from "../../shared/workflow.js";

/**
 * Handle router/default command.
 *
 * @param {string[]} argv
 */
export async function runRouterCommand(argv) {
    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp("router");
        return;
    }

    const userRequest = argv.join(" ").trim();

    setActiveAgent("Router", routerCmdOnMessage);
    // Launch the interactive loop with the router as the default handler
    await startInteractiveSession(userRequest, routerCmdOnMessage);
}

/**
 * Handle router logic inside the interactive loop.
 *
 * @param {string} userRequest
 * @param {Array<{base64: string, mimeType: string}>} images
 * @param {import('../../shared/workflow.js').UiAPI} uiAPI
 */
export async function routerCmdOnMessage(userRequest, images, uiAPI) {
    await ensurePlansDir(CWD);

    uiAPI.appendSystemMessage("=== Phase A: Router (Triage) ===");

    const routerMessages = await runAgentSession({
        agentName: "router",
        toolNames: TOOLSETS.ROUTER,
        customTools: [triageReportTool],
        userRequest,
        images,
        uiAPI,
    });

    const triage = extractTriageReport(routerMessages);

    if (!triage) {
        uiAPI.appendSystemMessage("ERROR: Router did not produce a triage report.", true);
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
            "Execute the task above. Inspect the current state, make the change or run the command, and verify the result.",
        ].join("\n");

        await runAgentSession({
            agentName: "operator",
            toolNames: TOOLSETS.OPERATOR,
            userRequest: operatorRequest,
            uiAPI,
        });

        uiAPI.appendSystemMessage("✅ Operator execution complete.");
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
            "Choose a descriptive, kebab-case filename (e.g., plans/add-dark-mode-toggle.md).",
        ].join("\n");

        const result = await reviewLoop({
            agentName: "planner",
            toolNames: TOOLSETS.PLANNING,
            customTools: [planWrittenTool],
            initialRequest: plannerRequest,
            triageMeta: triage,
            uiAPI,
        });

        if (result) {
            const action = await askPostApproval(result.planName, uiAPI);
            if (action === "proceed") {
                await executePlan(result.planName, triage, uiAPI);
            } else {
                uiAPI.appendSystemMessage(
                    `Plan saved. Resume later with: ${CLI_BIN} resume ${result.planName}`,
                );
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
            "Since this is a PROJECT, include a Tasks table for multi-agent execution.",
        ].join("\n");

        const result = await reviewLoop({
            agentName: "architect",
            toolNames: TOOLSETS.PLANNING,
            customTools: [planWrittenTool],
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
                        toolNames: TOOLSETS.PLANNING,
                        customTools: [planWrittenTool],
                        initialRequest:
                            `The previously approved plan "${result.planName}" had a malformed Tasks table: ${execRes.error}.\n\nPlease fix the table to ensure it follows the required format (Task ID | Assignee | Dependencies | Description) and call plan_written again.`,
                        triageMeta: triage,
                        uiAPI,
                    });
                    // After repair, we might want to execute again, but we'll let the user decide if it comes back to approve/proceed
                }
            } else {
                uiAPI.appendSystemMessage(
                    `Plan saved. Resume later with: ${CLI_BIN} resume ${result.planName}`,
                );
            }
        }
    }
}
