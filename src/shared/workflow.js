/**
 * @module shared/workflow
 * Shared review-loop and execution helpers reused by router/resume commands.
 */

import { join } from "@std/path";
import { CWD, PLANS_DIR_NAME, TOOLSETS } from "../constants.js";
import { submitPlanForReview } from "../tools/submit-plan.js";
import { loadPlan } from "../plan-store.js";
import { runSession } from "./session.js";
import { readUserInput } from "./input.js";

/**
 * Find the most recently modified markdown plan in plans/.
 *
 * @returns {Promise<{ name: string, path: string } | null>}
 */
export async function findLatestPlan() {
    const plansDir = join(CWD, PLANS_DIR_NAME);
    let latest = null;
    let latestMtime = 0;

    try {
        for await (const entry of Deno.readDir(plansDir)) {
            if (!entry.isFile || !entry.name.endsWith(".md")) continue;
            const filePath = join(plansDir, entry.name);
            const stat = await Deno.stat(filePath);
            if (stat.mtime && stat.mtime.getTime() > latestMtime) {
                latestMtime = stat.mtime.getTime();
                latest = {
                    name: entry.name.replace(/\.md$/, ""),
                    path: filePath,
                };
            }
        }
    } catch {
        // plans dir missing
    }

    return latest;
}

/**
 * Run the planning review loop until approved/failed.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} opts.toolNames
 * @param {string} opts.initialPrompt
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {number} [opts.maxRevisions=5]
 * @returns {Promise<{ planName: string, planPath: string, approved: true } | null>}
 */
export async function reviewLoop({
    agentName,
    toolNames,
    initialPrompt,
    triageMeta,
    maxRevisions = 5,
}) {
    let currentPrompt = initialPrompt;
    let revision = 0;

    while (revision < maxRevisions) {
        if (revision === 0) {
            console.log(`\n[Harness] === Running ${agentName} ===\n`);
        } else {
            console.log(`\n[Harness] === Revising plan (attempt ${revision + 1}/${maxRevisions}) ===\n`);
        }

        await runSession({
            agentName,
            toolNames,
            prompt: currentPrompt,
        });

        const planInfo = await findLatestPlan();
        if (!planInfo) {
            console.error("\n[Harness] ERROR: Agent did not create a plan file in plans/");
            return null;
        }

        console.log(`\n[Harness] Plan created: plans/${planInfo.name}.md`);

        const result = await submitPlanForReview({
            cwd: CWD,
            planName: planInfo.name,
            planPath: planInfo.path,
            triageMeta,
        });

        if (result.approved) {
            return {
                planName: planInfo.name,
                planPath: planInfo.path,
                approved: true,
            };
        }

        revision++;
        console.log(`\n[Harness] Plan denied. Feeding feedback back to ${agentName}...`);

        currentPrompt = [
            `## Previous Plan Feedback (Round ${revision})`,
            "",
            "Your plan was denied. Here is the structured feedback from the user:",
            "",
            result.feedback || "(no specific feedback provided)",
            "",
            `Please revise your plan in plans/${planInfo.name}.md based on this feedback.`,
            "Use the `edit` tool to make targeted revisions — do NOT rewrite the entire plan.",
            "Address each piece of feedback specifically.",
        ].join("\n");
    }

    console.error(`\n[Harness] Max revisions (${maxRevisions}) reached. Plan not approved.`);
    return null;
}

/**
 * Ask user what to do after plan approval.
 *
 * @param {string} planName
 * @returns {Promise<"proceed" | "save">}
 */
export async function askPostApproval(planName) {
    console.log(`\n[Harness] Plan "${planName}" approved!`);
    console.log("What would you like to do?");
    console.log("  1) Proceed with execution");
    console.log("  2) Save for later");

    const answer = await readUserInput();

    if (answer === "1" || answer.toLowerCase() === "proceed" || answer.toLowerCase() === "p") {
        return "proceed";
    }
    return "save";
}

/**
 * Parse PROJECT task table from plan markdown body.
 *
 * @param {string} planContent
 * @returns {Array<{ task: number, assignee: string, dependencies: string, description: string }>}
 */
export function extractTasks(planContent) {
    const tasks = /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string }>} */ ([]);
    const taskSection = planContent.match(/### Tasks\s*\n([\s\S]*?)(?=\n###|\n##|$)/);

    if (!taskSection) return tasks;

    const rows = taskSection[1].matchAll(
        /\|\s*(\d+)\s*\|\s*(\w[\w-]*)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|/g,
    );

    for (const match of rows) {
        tasks.push({
            task: parseInt(match[1]),
            assignee: match[2].trim(),
            dependencies: match[3].trim(),
            description: match[4].trim(),
        });
    }

    return tasks;
}

/**
 * Execute an approved plan.
 *
 * @param {string} planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} triageMeta
 */
export async function executePlan(planName, triageMeta) {
    const plan = await loadPlan(CWD, planName);
    if (!plan) {
        console.error(`[Harness] ERROR: Could not load plan ${planName}`);
        Deno.exit(1);
    }

    console.log(`\n[Harness] === Executing Plan: ${planName} ===\n`);

    if (triageMeta.classification === "PROJECT") {
        const tasks = extractTasks(plan.markdown);

        if (tasks.length > 0) {
            console.log(`[Harness] Found ${tasks.length} tasks in plan. Executing in dependency order.\n`);

            for (const task of tasks) {
                const agentName = task.assignee === "engineer"
                    ? "engineer"
                    : task.assignee === "tester"
                    ? "tester"
                    : task.assignee === "doc-writer"
                    ? "doc-writer"
                    : "engineer";

                console.log(`\n[Harness] --- Task ${task.task}: ${task.description} (→ ${agentName}) ---\n`);

                const taskPrompt = [
                    "## Task Assignment",
                    "",
                    `You are assigned Task ${task.task} from the plan "${planName}".`,
                    "",
                    "### Task Description",
                    task.description,
                    "",
                    "### Dependencies",
                    task.dependencies || "None",
                    "",
                    "### Full Plan Context",
                    plan.body,
                ].join("\n");

                const taskTools = agentName === "doc-writer" ? TOOLSETS.DOC_WRITER : TOOLSETS.ENGINEER;

                await runSession({
                    agentName,
                    toolNames: taskTools,
                    prompt: taskPrompt,
                });
            }
        } else {
            await runEngineerWithPlan(planName, plan.body);
        }
    } else {
        await runEngineerWithPlan(planName, plan.body);
    }

    console.log(`\n[Harness] ✅ Plan execution complete: ${planName}`);
}

/**
 * Project-specific post-approval prompt that also prints task list.
 *
 * @param {string} planName
 * @returns {Promise<"proceed" | "save">}
 */
export async function askApprovalWithTasks(planName) {
    const plan = await loadPlan(CWD, planName);
    const tasks = plan ? extractTasks(plan.markdown) : [];

    console.log(`\n[Harness] Project plan "${planName}" approved!`);
    if (tasks.length > 0) {
        console.log("\nTask breakdown:");
        for (const t of tasks) {
            console.log(`  ${t.task}. [${t.assignee}] ${t.description}`);
        }
    }

    console.log("\nWhat would you like to do?");
    console.log(`  1) Proceed with execution${tasks.length > 0 ? " (tasks will run in dependency order)" : ""}`);
    console.log("  2) Save for later");

    const answer = await readUserInput();

    if (answer === "1" || answer.toLowerCase() === "proceed" || answer.toLowerCase() === "p") {
        return "proceed";
    }
    return "save";
}

/**
 * Run engineer against the full approved plan body.
 *
 * @param {string} planName
 * @param {string} planBody
 */
async function runEngineerWithPlan(planName, planBody) {
    console.log("[Harness] === Running Engineer ===\n");

    const engineerPrompt = [
        `## Approved Plan: ${planName}`,
        "",
        "Execute the following plan step by step. Implement each step, verify the result, then move on.",
        "",
        planBody,
    ].join("\n");

    await runSession({
        agentName: "engineer",
        toolNames: TOOLSETS.ENGINEER,
        prompt: engineerPrompt,
    });
}
