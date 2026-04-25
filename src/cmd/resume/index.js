/**
 * @module cmd/resume
 * Resume command implementation.
 */

import { parseArgs } from "@std/cli/parse-args";
import { CWD, TOOLSETS } from "../../constants.js";
import { resolvePlan } from "../../plan-store.js";
import { submitPlanForReview } from "../../tools/submit-plan.js";
import { readUserInput } from "../../shared/input.js";
import {
    askPostApproval,
    executePlan,
    reviewLoop,
} from "../../shared/workflow.js";
import { printCommandHelp } from "../../shared/help-text.js";

/**
 * Handle `resume` command.
 *
 * @param {string[]} argv
 */
export async function runResumeCommand(argv) {
    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp("resume");
        return;
    }

    const [planArg] = parsed._.map(String);
    if (!planArg) {
        console.error("Usage: deno run -A src/cli.js resume <plan-name-or-path>");
        Deno.exit(1);
    }

    console.log(`[Harness] Resuming plan: ${planArg}`);

    const plan = await resolvePlan(CWD, planArg);
    console.log(`[Harness] Plan loaded: ${plan.planName}`);
    console.log(`[Harness] Classification: ${plan.attrs.classification}, Status: ${plan.attrs.status}`);

    if (plan.attrs.status === "approved") {
        console.log("\n[Harness] This plan has already been approved.");
        console.log("What would you like to do?");
        console.log("  1) Proceed with execution");
        console.log("  2) Re-open for review (edit/annotate)");
        console.log("  3) View plan details");

        const answer = await readUserInput();

        if (answer === "1" || answer.toLowerCase() === "proceed" || answer.toLowerCase() === "p") {
            await executePlan(plan.planName, plan.attrs);
            return;
        }

        if (answer === "2" || answer.toLowerCase() === "review" || answer.toLowerCase() === "r") {
            const result = await submitPlanForReview({
                cwd: CWD,
                planName: plan.planName,
                planPath: plan.path,
                triageMeta: plan.attrs,
            });

            if (result.approved) {
                const action = await askPostApproval(plan.planName);
                if (action === "proceed") {
                    await executePlan(plan.planName, plan.attrs);
                } else {
                    console.log(`\n[Harness] Plan saved. Resume later with: deno run -A src/cli.js resume ${plan.planName}`);
                }
            } else {
                console.log("\n[Harness] Plan denied. To continue the revision loop, run:");
                console.log(`  deno run -A src/cli.js resume ${plan.planName}`);
            }
            return;
        }

        console.log(`\n${plan.body}`);
        return;
    }

    const triageMeta = plan.attrs;
    const agentName = triageMeta.classification === "PROJECT" ? "architect" : "planner";
    const revisionPrompt = [
        `## Resuming Plan: ${plan.planName}`,
        "",
        `This plan was previously saved with status: ${plan.attrs.status}.`,
        `Continue working on it. The plan is at plans/${plan.planName}.md.`,
        "",
        "## Triage Report",
        `- Classification: ${triageMeta.classification}`,
        `- Complexity: ${triageMeta.complexity}`,
        `- Summary: ${triageMeta.summary}`,
        `- Affected paths: ${(triageMeta.affectedPaths || []).join(", ")}`,
        "",
        "Review the current plan, make any needed updates, and finalize it.",
    ].join("\n");

    const result = await reviewLoop({
        agentName,
        toolNames: TOOLSETS.PLANNING,
        initialPrompt: revisionPrompt,
        triageMeta,
    });

    if (result) {
        const action = await askPostApproval(result.planName);
        if (action === "proceed") {
            await executePlan(result.planName, triageMeta);
        } else {
            console.log(`\n[Harness] Plan saved. Resume later with: deno run -A src/cli.js resume ${result.planName}`);
        }
    }
}
