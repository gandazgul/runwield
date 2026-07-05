/**
 * @module cmd/plans/archive
 * Archive, list, and restore saved Plans.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN, CWD } from "../../constants.js";
import {
    archivePlan as archivePlanFn,
    archivePlansByStatus as archivePlansByStatusFn,
    listArchivedPlans as listArchivedPlansFn,
    restoreArchivedPlan as restoreArchivedPlanFn,
} from "../../plan-store.js";

/**
 * @typedef {Object} ArchiveCommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof archivePlanFn} [archivePlan]
 * @property {typeof archivePlansByStatusFn} [archivePlansByStatus]
 * @property {typeof listArchivedPlansFn} [listArchivedPlans]
 * @property {typeof restoreArchivedPlanFn} [restoreArchivedPlan]
 */

function printArchiveHelp() {
    console.log(`Usage:
  ${CLI_BIN} plans archive
  ${CLI_BIN} plans archive <plan-name-or-id> [--reason <text>] [--force]
  ${CLI_BIN} plans archive --all --status <status> [--reason <text>] [--force]
  ${CLI_BIN} plans archive restore <archived-plan-name-or-id> [--to <plan-name>]

Archives are plaintext markdown under plans/archived/.`);
}

/**
 * @param {Awaited<ReturnType<typeof listArchivedPlansFn>>} plans
 */
function printArchivedPlans(plans) {
    if (plans.length === 0) {
        console.log("[RunWield] No archived plans found.");
        return;
    }
    console.log("\n[RunWield] Archived plans:\n");
    for (const plan of plans) {
        console.log(`  ${plan.name}`);
        console.log(`    Path: ${plan.relativePath}`);
        if (plan.planId) console.log(`    Plan ID: ${plan.planId}`);
        console.log(`    Status: ${plan.status}`);
        console.log(`    Summary: ${plan.summary || "(none)"}`);
        if (plan.attrs.archivedAt) console.log(`    Archived: ${plan.attrs.archivedAt}`);
        if (plan.attrs.archiveReason) console.log(`    Reason: ${plan.attrs.archiveReason}`);
        console.log();
    }
}

/**
 * @param {Awaited<ReturnType<typeof archivePlansByStatusFn>>} result
 * @param {string} status
 */
function printBulkArchiveResult(result, status) {
    if (result.matched.length === 0) {
        console.log(`[RunWield] No active Plans with status ${status} found.`);
        return;
    }

    console.log(`[RunWield] Bulk archive for status ${status}:`);
    for (const plan of result.archived) {
        console.log(`  Archived ${plan.name} to ${plan.relativePath}`);
    }
    for (const plan of result.failed) {
        console.log(`  Failed ${plan.name} (${plan.relativePath}): ${plan.message}`);
    }
    console.log(
        `[RunWield] Archived ${result.archived.length}/${result.matched.length} matching Plan(s); ${result.failed.length} failed.`,
    );
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: ArchiveCommandDependencies }} [options]
 */
export async function runPlansArchiveCommand(argv, options = {}) {
    const deps = /** @type {ArchiveCommandDependencies} */ (options.__testDeps || {});
    const parseArgs = deps.parseArgs || parseArgsFn;
    const archivePlan = deps.archivePlan || archivePlanFn;
    const archivePlansByStatus = deps.archivePlansByStatus || archivePlansByStatusFn;
    const listArchivedPlans = deps.listArchivedPlans || listArchivedPlansFn;
    const restoreArchivedPlan = deps.restoreArchivedPlan || restoreArchivedPlanFn;

    const parsed = parseArgs(argv, {
        boolean: ["help", "force", "all"],
        string: ["reason", "to", "status"],
        alias: { h: "help" },
    });

    if (parsed.help) {
        printArchiveHelp();
        return;
    }

    const positionals = /** @type {string[]} */ (parsed._.map(String));
    if (positionals[0] === "restore") {
        if (parsed.all) throw new Error("Cannot use --all with archive restore.");
        if (parsed.status !== undefined) throw new Error("Cannot use --status with archive restore.");
        const target = positionals[1];
        if (!target) throw new Error("Missing archived Plan name or id for restore.");
        if (positionals.length > 2) throw new Error(`Unexpected restore argument: ${positionals[2]}`);
        const restored = await restoreArchivedPlan(CWD, target, { to: parsed.to });
        console.log(`[RunWield] Restored ${target} to ${restored.relativePath}`);
        return;
    }

    if (parsed.all) {
        if (parsed.status === undefined) throw new Error("Missing --status for bulk archive.");
        if (positionals.length > 0) throw new Error(`Unexpected archive argument with --all: ${positionals[0]}`);
        const result = await archivePlansByStatus(CWD, /** @type {any} */ (parsed.status), {
            reason: parsed.reason,
            force: Boolean(parsed.force),
        });
        printBulkArchiveResult(result, parsed.status);
        if (result.failed.length > 0) {
            throw new Error(`Bulk archive failed for ${result.failed.length} Plan(s).`);
        }
        return;
    }

    if (parsed.status !== undefined) throw new Error("--status requires --all for bulk archive.");

    if (positionals.length === 0) {
        printArchivedPlans(await listArchivedPlans(CWD));
        return;
    }

    if (positionals.length > 1) throw new Error(`Unexpected archive argument: ${positionals[1]}`);
    const archived = await archivePlan(CWD, positionals[0], {
        reason: parsed.reason,
        force: Boolean(parsed.force),
    });
    console.log(`[RunWield] Archived ${positionals[0]} to ${archived.relativePath}`);
}
