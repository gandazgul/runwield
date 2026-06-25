/**
 * @module cmd/plans
 * List saved plans.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CWD } from "../../constants.js";
import { countChildPlanProgress, groupPlanHierarchy, listPlans as listPlansFn } from "../../plan-store.js";

/**
 * @typedef {Awaited<ReturnType<typeof listPlansFn>>[number]} PlanEntry
 */

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof listPlansFn} [listPlans]
 * @property {(commandName: string) => boolean} [printCommandHelp]
 */

/**
 * @param {PlanEntry[]} children
 * @returns {string}
 */
function formatChildProgress(children) {
    const { verified, active, failed, remaining, total } = countChildPlanProgress(children);
    const label = total === 1 ? "feature" : "features";
    const parts = [`${verified}/${total} ${label} verified`];
    if (active > 0) parts.push(`${active} active/implemented`);
    if (remaining > 0) parts.push(`${remaining} remaining`);
    if (failed > 0) parts.push(`${failed} failed`);
    return parts.join(" — ");
}

/**
 * @param {PlanEntry} epic
 * @returns {string}
 */
function formatEpicCompletionState(epic) {
    if (epic.attrs.epicCompletionMode !== "done_enough") return "";
    return " — done enough for now";
}

/**
 * @param {PlanEntry} plan
 * @param {string} indent
 */
function printPlanDetails(plan, indent) {
    console.log(
        `${indent}Status: ${plan.attrs.status} | Classification: ${plan.attrs.classification} | Complexity: ${plan.attrs.complexity}`,
    );
    console.log(`${indent}Summary: ${plan.attrs.summary || "(none)"}`);
    if (plan.attrs.worktreeStatus || plan.attrs.worktreeBranch || plan.attrs.worktreePath) {
        const ref = plan.attrs.worktreeBranch || plan.attrs.worktreePath || "unknown";
        console.log(`${indent}Worktree: ${plan.attrs.worktreeStatus || "unknown"} (${ref})`);
    }
    console.log(`${indent}Created: ${plan.attrs.createdAt}`);
}

/**
 * @param {PlanEntry} plan
 */
function printTopLevelPlan(plan) {
    console.log(`  ${plan.name}`);
    printPlanDetails(plan, "    ");
    console.log();
}

/**
 * @param {PlanEntry} child
 */
function printChildPlan(child) {
    console.log(`      - ${child.name}`);
    printPlanDetails(child, "        ");
}

/**
 * Handle `plans` command.
 *
 * @param {string[]} argv
 * @param {{ __testDeps?: CommandDependencies }} [options]
 */
export async function runPlansCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ options.__testDeps || {};
    const {
        parseArgs: parseArgsDep,
        listPlans: listPlansDep,
        printCommandHelp: printCommandHelpDep,
    } = deps;

    /** @type {typeof parseArgsFn} */
    const parseArgs = parseArgsDep || parseArgsFn;
    /** @type {typeof listPlansFn} */
    const listPlans = listPlansDep || listPlansFn;

    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
    });

    if (parsed.help) {
        const printCommandHelp = printCommandHelpDep || (await import("../help/index.js")).printCommandHelp;
        printCommandHelp("plans");
        return;
    }

    const plans = await listPlans(CWD);
    if (plans.length === 0) {
        console.log("[RunWield] No saved plans found.");
        return;
    }

    const { epics, childrenByParent, standalone, orphanChildren } = groupPlanHierarchy(plans);

    console.log("\n[RunWield] Saved plans:\n");

    if (epics.length > 0) {
        console.log("Epics:");
        for (const epic of epics) {
            const children = childrenByParent.get(epic.name) || [];
            console.log(`  ${epic.name}`);
            printPlanDetails(epic, "    ");
            console.log(`    Progress: ${formatChildProgress(children)}${formatEpicCompletionState(epic)}`);
            if (epic.attrs.epicDoneEnoughSummary) {
                console.log(`    Done enough: ${epic.attrs.epicDoneEnoughSummary}`);
            }
            if (children.length > 0) {
                console.log("    Features:");
                for (const child of children) {
                    printChildPlan(child);
                }
            }
            console.log();
        }
    }

    if (standalone.length > 0) {
        console.log("Standalone plans:");
        for (const plan of standalone) {
            printTopLevelPlan(plan);
        }
    }

    if (orphanChildren.length > 0) {
        console.log("Orphaned child plans:");
        for (const plan of orphanChildren) {
            printTopLevelPlan(plan);
        }
    }
}
