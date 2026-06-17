/**
 * @module cmd/plans
 * List saved plans.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CWD } from "../../constants.js";
import { listPlans as listPlansFn } from "../../plan-store.js";
import { isEpicPlan } from "../../shared/workflow/plan-lifecycle.js";

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
 * @param {PlanEntry} plan
 * @returns {boolean}
 */
function isChildFeaturePlan(plan) {
    return plan.attrs.classification === "FEATURE" && typeof plan.attrs.parentPlan === "string" &&
        plan.attrs.parentPlan.trim().length > 0;
}

/**
 * @param {PlanEntry[]} plans
 * @returns {{ epics: PlanEntry[], childrenByParent: Map<string, PlanEntry[]>, standalone: PlanEntry[], orphanChildren: PlanEntry[] }}
 */
function groupPlans(plans) {
    const epics = plans.filter((plan) => isEpicPlan(plan.attrs));
    const epicNames = new Set(epics.map((plan) => plan.name));
    /** @type {Map<string, PlanEntry[]>} */
    const childrenByParent = new Map();
    /** @type {PlanEntry[]} */
    const standalone = [];
    /** @type {PlanEntry[]} */
    const orphanChildren = [];

    for (const plan of plans) {
        if (isEpicPlan(plan.attrs)) continue;

        if (isChildFeaturePlan(plan)) {
            const parentPlan = plan.attrs.parentPlan || "";
            if (epicNames.has(parentPlan)) {
                const children = childrenByParent.get(parentPlan) || [];
                children.push(plan);
                childrenByParent.set(parentPlan, children);
            } else {
                orphanChildren.push(plan);
            }
            continue;
        }

        standalone.push(plan);
    }

    return { epics, childrenByParent, standalone, orphanChildren };
}

/**
 * @param {PlanEntry[]} children
 * @returns {string}
 */
function formatChildProgress(children) {
    const verified = children.filter((child) => child.attrs.status === "verified").length;
    const active =
        children.filter((child) => child.attrs.status === "in_progress" || child.attrs.status === "implemented").length;
    const failed = children.filter((child) => child.attrs.status === "failed").length;
    const remaining = children.length - verified - active - failed;
    const label = children.length === 1 ? "feature" : "features";
    const parts = [`${verified}/${children.length} ${label} verified`];
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
        console.log("[Harns] No saved plans found.");
        return;
    }

    const { epics, childrenByParent, standalone, orphanChildren } = groupPlans(plans);

    console.log("\n[Harns] Saved plans:\n");

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
