/**
 * @module cmd/router
 * Router command implementation (also used as default command).
 */

import { parseArgs } from "@std/cli/parse-args";
import { CWD, TOOLSETS } from "../../constants.js";
import { ensurePlansDir } from "../../plan-store.js";
import { triageReportTool } from "../../tools/triage-report.js";
import { runSession } from "../../shared/session.js";
import { extractTriageReport } from "../../shared/triage.js";
import {
    askApprovalWithTasks,
    askPostApproval,
    executePlan,
    reviewLoop,
} from "../../shared/workflow.js";
import { printCommandHelp } from "../../shared/help-text.js";

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
    if (!userRequest) {
        console.error("[Harness] Missing request prompt.");
        printCommandHelp("router");
        Deno.exit(1);
    }

    console.log(`[Harness] User request: "${userRequest}"`);

    await ensurePlansDir(CWD);

    console.log("\n[Harness] === Phase A: Router (Triage) ===\n");

    const routerMessages = await runSession({
        agentName: "router",
        toolNames: TOOLSETS.ROUTER,
        customTools: [triageReportTool],
        prompt: userRequest,
    });

    const triage = extractTriageReport(routerMessages);

    if (!triage) {
        console.error("\n[Harness] ERROR: Router did not produce a triage report.");
        Deno.exit(1);
    }

    console.log(
        `\n[Router] Classification: ${triage.classification}, ` +
            `Complexity: ${triage.complexity}. ` +
            `Summary: ${triage.summary}`,
    );

    if (triage.classification === "QUICK_FIX") {
        console.log("\n[Harness] QUICK_FIX detected. Handing off to Operator...\n");
        console.log("[Harness] === Phase B1: Operator (Execute) ===\n");

        const operatorPrompt = [
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

        await runSession({
            agentName: "operator",
            toolNames: TOOLSETS.OPERATOR,
            prompt: operatorPrompt,
        });

        console.log("\n[Harness] ✅ Operator session complete.");
        return;
    }

    if (triage.classification === "FEATURE") {
        console.log("\n[Harness] FEATURE detected. Handing off to Planner...\n");

        const plannerPrompt = [
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
            initialPrompt: plannerPrompt,
            triageMeta: triage,
        });

        if (result) {
            const action = await askPostApproval(result.planName);
            if (action === "proceed") {
                await executePlan(result.planName, triage);
            } else {
                console.log(`\n[Harness] Plan saved. Resume later with: deno run -A src/cli.js resume ${result.planName}`);
            }
        }
        return;
    }

    if (triage.classification === "PROJECT") {
        console.log("\n[Harness] PROJECT detected. Handing off to Architect for targeted deep exploration + planning...\n");
        console.log("[Harness] === Phase D: Architect (Targeted Explore + Plan + Review) ===\n");

        const architectPrompt = [
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
            initialPrompt: architectPrompt,
            triageMeta: triage,
        });

        if (result) {
            const action = await askApprovalWithTasks(result.planName);
            if (action === "proceed") {
                await executePlan(result.planName, triage);
            } else {
                console.log(`\n[Harness] Plan saved. Resume later with: deno run -A src/cli.js resume ${result.planName}`);
            }
        }
    }
}
