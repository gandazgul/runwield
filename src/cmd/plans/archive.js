/**
 * @module cmd/plans/archive
 * Archive, list, and restore saved Plans.
 */

import { relative } from "@std/path";
import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN, getCwd } from "../../constants.js";
import {
    archivePlan as archivePlanFn,
    archivePlansByStatus as archivePlansByStatusFn,
    listArchivedPlans as listArchivedPlansFn,
    listPlans as listPlansFn,
    loadArchivedPlan as loadArchivedPlanFn,
    loadPlan as loadPlanFn,
    restoreArchivedPlan as restoreArchivedPlanFn,
} from "../../plan-store.js";
import { runArchiveTransition as runArchiveTransitionFn } from "../../shared/workflow/state-transition.ts";

/**
 * @typedef {Object} ArchiveCommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof archivePlanFn} [archivePlan]
 * @property {typeof archivePlansByStatusFn} [archivePlansByStatus]
 * @property {typeof listArchivedPlansFn} [listArchivedPlans]
 * @property {typeof listPlansFn} [listPlans]
 * @property {typeof loadArchivedPlanFn} [loadArchivedPlan]
 * @property {typeof loadPlanFn} [loadPlan]
 * @property {typeof restoreArchivedPlanFn} [restoreArchivedPlan]
 * @property {typeof runArchiveTransitionFn} [runArchiveTransition]
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

/** @param {Awaited<ReturnType<typeof runArchiveTransitionFn>>} transition */
function unwrapArchiveTransitionValue(transition) {
    if (transition.status === "committed") return /** @type {any} */ (transition.value)?.value;
    const recovery = (transition.recoveryActions || [])
        .map((action) => action.command ? `${action.label}: ${action.command}` : action.label)
        .join("; ");
    throw new Error(
        `${transition.operation} for Plan needs recovery: ${transition.message || transition.status}${
            recovery ? `. Recovery: ${recovery}` : ""
        }`,
    );
}

/**
 * @param {Awaited<ReturnType<typeof listPlansFn>>[number]} plan
 */
function isChildFeatureArchiveCandidate(plan) {
    return plan.attrs.classification === "FEATURE" && typeof plan.attrs.parentPlan === "string" &&
        plan.attrs.parentPlan.length > 0;
}

/** @param {string} target */
function normalizePlanNameArgument(target) {
    return target.trim().replace(/^plans\//i, "").replace(/\.md$/i, "");
}

/**
 * @param {string} cwd
 * @param {string} target
 * @param {typeof listPlansFn} listPlans
 * @param {typeof loadPlanFn} loadPlan
 */
async function resolveActiveArchiveTarget(cwd, target, listPlans, loadPlan) {
    const normalizedName = normalizePlanNameArgument(target);
    const byName = await loadPlan(cwd, normalizedName).catch(() => null);
    if (byName) return { name: normalizedName, revision: byName.revision };
    const matches = (await listPlans(cwd)).filter((plan) => plan.attrs.planId === target);
    if (matches.length > 1) throw new Error(`Duplicate planId values found for ${target}; use a Plan name instead.`);
    if (matches.length !== 1) throw new Error(`Active Plan not found: ${target}`);
    const loaded = await loadPlan(cwd, matches[0].name);
    if (!loaded) throw new Error(`Active Plan not found: ${matches[0].name}`);
    return { name: matches[0].name, revision: loaded.revision };
}

/**
 * @param {string} cwd
 * @param {string} target
 * @param {string | undefined} destination
 * @param {typeof loadArchivedPlanFn} loadArchivedPlan
 */
async function resolveRestoreDestination(cwd, target, destination, loadArchivedPlan) {
    if (destination) return normalizePlanNameArgument(destination);
    const archived = await loadArchivedPlan(cwd, target);
    if (!archived) throw new Error(`Archived Plan not found: ${target}`);
    return archived.name;
}

/**
 * @param {string} cwd
 * @param {import('../../plan-store.js').PlanFrontMatter['status']} status
 * @param {{ reason?: string, force?: boolean }} archiveOptions
 * @param {typeof listPlansFn} listPlans
 * @param {typeof loadPlanFn} loadPlan
 * @param {typeof archivePlanFn} archivePlan
 * @param {typeof runArchiveTransitionFn} runArchiveTransition
 * @returns {Promise<Awaited<ReturnType<typeof archivePlansByStatusFn>>>}
 */
async function archivePlansByStatusTransactionally(
    cwd,
    status,
    archiveOptions,
    listPlans,
    loadPlan,
    archivePlan,
    runArchiveTransition,
) {
    const plans = await listPlans(cwd);
    /** @type {Map<string, Awaited<ReturnType<typeof listPlansFn>>>} */
    const childrenByParent = new Map();
    for (const plan of plans) {
        if (!isChildFeatureArchiveCandidate(plan)) continue;
        const parentPlan = plan.attrs.parentPlan || "";
        const children = childrenByParent.get(parentPlan) || [];
        children.push(plan);
        childrenByParent.set(parentPlan, children);
    }
    for (const children of childrenByParent.values()) children.sort((a, b) => a.name.localeCompare(b.name));
    const matchingParentPlans = plans
        .filter((plan) => !isChildFeatureArchiveCandidate(plan) && plan.attrs.status === status)
        .sort((a, b) => a.name.localeCompare(b.name));
    const matchingPlans = matchingParentPlans.flatMap((plan) => [plan, ...(childrenByParent.get(plan.name) || [])]);
    const matched = matchingPlans.map((plan) => ({ name: plan.name, relativePath: relative(cwd, plan.path) }));
    /** @type {Array<{ name: string, relativePath: string }>} */
    const archived = [];
    /** @type {Array<{ name: string, relativePath: string, message: string }>} */
    const failed = [];
    const now = new Date().toISOString();
    for (const parentPlan of matchingParentPlans) {
        const queue = [
            { plan: parentPlan, options: archiveOptions },
            ...(childrenByParent.get(parentPlan.name) || []).map((plan) => ({
                plan,
                options: { ...archiveOptions, force: true },
            })),
        ];
        for (const item of queue) {
            try {
                const loaded = await loadPlan(cwd, item.plan.name);
                const result = unwrapArchiveTransitionValue(
                    await runArchiveTransition({
                        projectRoot: cwd,
                        planName: item.plan.name,
                        action: "archive",
                        expectedRevision: loaded?.revision,
                        move: async () => await archivePlan(cwd, item.plan.name, { ...item.options, now }),
                    }),
                );
                archived.push({ name: result.name, relativePath: result.relativePath });
            } catch (error) {
                failed.push({
                    name: item.plan.name,
                    relativePath: relative(cwd, item.plan.path),
                    message: error instanceof Error ? error.message : String(error),
                });
                if (item.plan.name === parentPlan.name) break;
            }
        }
    }
    return { matched, archived, failed };
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
    const listPlans = deps.listPlans || listPlansFn;
    const loadArchivedPlan = deps.loadArchivedPlan || loadArchivedPlanFn;
    const loadPlan = deps.loadPlan || loadPlanFn;
    const restoreArchivedPlan = deps.restoreArchivedPlan || restoreArchivedPlanFn;
    const runArchiveTransition = deps.runArchiveTransition || runArchiveTransitionFn;

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
        const restored = deps.restoreArchivedPlan && !deps.runArchiveTransition
            ? await restoreArchivedPlan(getCwd(), target, { to: parsed.to })
            : unwrapArchiveTransitionValue(
                await runArchiveTransition({
                    projectRoot: getCwd(),
                    planName: await resolveRestoreDestination(getCwd(), target, parsed.to, loadArchivedPlan),
                    action: "restore",
                    move: async () => await restoreArchivedPlan(getCwd(), target, { to: parsed.to }),
                }),
            );
        console.log(`[RunWield] Restored ${target} to ${restored.relativePath}`);
        return;
    }

    if (parsed.all) {
        if (parsed.status === undefined) throw new Error("Missing --status for bulk archive.");
        if (positionals.length > 0) throw new Error(`Unexpected archive argument with --all: ${positionals[0]}`);
        const archiveOptions = {
            reason: parsed.reason,
            force: Boolean(parsed.force),
        };
        const result = deps.archivePlansByStatus && !deps.runArchiveTransition
            ? await archivePlansByStatus(getCwd(), /** @type {any} */ (parsed.status), archiveOptions)
            : await archivePlansByStatusTransactionally(
                getCwd(),
                /** @type {any} */ (parsed.status),
                archiveOptions,
                listPlans,
                loadPlan,
                archivePlan,
                runArchiveTransition,
            );
        printBulkArchiveResult(result, parsed.status);
        if (result.failed.length > 0) {
            throw new Error(`Bulk archive failed for ${result.failed.length} Plan(s).`);
        }
        return;
    }

    if (parsed.status !== undefined) throw new Error("--status requires --all for bulk archive.");

    if (positionals.length === 0) {
        printArchivedPlans(await listArchivedPlans(getCwd()));
        return;
    }

    if (positionals.length > 1) throw new Error(`Unexpected archive argument: ${positionals[1]}`);
    const archiveOptions = {
        reason: parsed.reason,
        force: Boolean(parsed.force),
    };
    const archived = deps.archivePlan && !deps.runArchiveTransition
        ? await archivePlan(getCwd(), positionals[0], archiveOptions)
        : unwrapArchiveTransitionValue(
            await (async () => {
                const target = await resolveActiveArchiveTarget(getCwd(), positionals[0], listPlans, loadPlan);
                return await runArchiveTransition({
                    projectRoot: getCwd(),
                    planName: target.name,
                    action: "archive",
                    expectedRevision: target.revision,
                    move: async () => await archivePlan(getCwd(), target.name, archiveOptions),
                });
            })(),
        );
    console.log(`[RunWield] Archived ${positionals[0]} to ${archived.relativePath}`);
}
