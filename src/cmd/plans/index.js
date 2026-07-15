/**
 * @module cmd/plans
 * List saved plans.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CWD } from "../../constants.js";
import { countChildPlanProgress, groupPlanHierarchy, listPlans as listPlansFn } from "../../plan-store.js";
import { runPlansArchiveCommand as runPlansArchiveCommandFn } from "./archive.js";
import { runPlansPullCommand as runPlansPullCommandFn } from "./pull.js";
import { runPlansReadCommand as runPlansReadCommandFn } from "./read.js";
import { runPlansShareCommand as runPlansShareCommandFn } from "./share.js";
import { runPlansUiCommand as runPlansUiCommandFn } from "./ui.js";

/**
 * @typedef {Awaited<ReturnType<typeof listPlansFn>>[number]} PlanEntry
 */

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof listPlansFn} [listPlans]
 * @property {(commandName: string) => boolean} [printCommandHelp]
 * @property {typeof runPlansUiCommandFn} [runPlansUiCommand]
 * @property {typeof runPlansArchiveCommandFn} [runPlansArchiveCommand]
 * @property {typeof runPlansReadCommandFn} [runPlansReadCommand]
 * @property {typeof runPlansShareCommandFn} [runPlansShareCommand]
 * @property {typeof runPlansPullCommandFn} [runPlansPullCommand]
 */

/**
 * @param {PlanEntry[]} children
 * @returns {string}
 */
function formatChildProgress(children) {
    const { verified, active, failed, onHold, remaining, total } = countChildPlanProgress(children);
    const label = total === 1 ? "feature" : "features";
    const parts = [`${verified}/${total} ${label} verified`];
    if (active > 0) parts.push(`${active} active/implemented`);
    if (onHold > 0) parts.push(`${onHold} on hold`);
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
    if (plan.attrs.status === "on_hold") {
        console.log(`${indent}Held from: ${plan.attrs.heldFromStatus || "unknown"}`);
        if (plan.attrs.holdReason) console.log(`${indent}Reason: ${plan.attrs.holdReason}`);
    }
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
        runPlansUiCommand: runPlansUiCommandDep,
        runPlansArchiveCommand: runPlansArchiveCommandDep,
        runPlansReadCommand: runPlansReadCommandDep,
        runPlansShareCommand: runPlansShareCommandDep,
        runPlansPullCommand: runPlansPullCommandDep,
    } = deps;

    if (argv[0] === "ui") {
        const runPlansUiCommand = runPlansUiCommandDep || runPlansUiCommandFn;
        await runPlansUiCommand(argv.slice(1), options);
        return;
    }
    if (argv[0] === "archive") {
        const runPlansArchiveCommand = runPlansArchiveCommandDep || runPlansArchiveCommandFn;
        await runPlansArchiveCommand(argv.slice(1), /** @type {any} */ (options));
        return;
    }
    if (argv[0] === "read") {
        const runPlansReadCommand = runPlansReadCommandDep || runPlansReadCommandFn;
        await runPlansReadCommand(argv.slice(1), /** @type {any} */ (options));
        return;
    }
    if (argv[0] === "share") {
        const runPlansShareCommand = runPlansShareCommandDep || runPlansShareCommandFn;
        await runPlansShareCommand(argv.slice(1), /** @type {any} */ (options));
        return;
    }
    if (argv[0] === "pull") {
        const runPlansPullCommand = runPlansPullCommandDep || runPlansPullCommandFn;
        await runPlansPullCommand(argv.slice(1), /** @type {any} */ (options));
        return;
    }

    /** @type {typeof parseArgsFn} */
    const parseArgs = parseArgsDep || parseArgsFn;
    /** @type {typeof listPlansFn} */
    const listPlans = listPlansDep || listPlansFn;

    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
    });

    if (parsed.help) {
        const printCommandHelp = printCommandHelpDep || (await import("../help/" + "index.js")).printCommandHelp;
        printCommandHelp("plans");
        return;
    }

    const plans = await listPlans(CWD);
    if (plans.length === 0) {
        console.log("[RunWield] No saved plans found.");
        return;
    }

    const { epics, childrenByParent, standalone, orphanChildren } = groupPlanHierarchy(plans);
    const activeEpics = epics.filter((epic) => epic.attrs.status !== "on_hold");
    const heldEpics = epics.filter((epic) => epic.attrs.status === "on_hold");
    const activeStandalone = standalone.filter((plan) => plan.attrs.status !== "on_hold");
    const heldStandalone = standalone.filter((plan) => plan.attrs.status === "on_hold");
    const activeOrphans = orphanChildren.filter((plan) => plan.attrs.status !== "on_hold");
    const heldOrphans = orphanChildren.filter((plan) => plan.attrs.status === "on_hold");

    console.log("\n[RunWield] Saved plans:\n");

    /** @param {PlanEntry} epic */
    const printEpic = (epic) => {
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
    };

    if (activeEpics.length > 0) {
        console.log("Epics:");
        for (const epic of activeEpics) printEpic(epic);
    }

    if (activeStandalone.length > 0) {
        console.log("Standalone plans:");
        for (const plan of activeStandalone) {
            printTopLevelPlan(plan);
        }
    }

    if (activeOrphans.length > 0) {
        console.log("Orphaned child plans:");
        for (const plan of activeOrphans) {
            printTopLevelPlan(plan);
        }
    }

    const onHoldPlans = [...heldEpics, ...heldStandalone, ...heldOrphans];
    if (onHoldPlans.length > 0) {
        console.log("On Hold:");
        for (const plan of onHoldPlans) {
            if (heldEpics.includes(plan)) printEpic(plan);
            else printTopLevelPlan(plan);
        }
    }
}
