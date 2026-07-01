/**
 * @module cmd/plans/read
 * Print active or archived Plan markdown for inspection.
 */

import { CLI_BIN, CWD, PLANS_DIR_NAME } from "../../constants.js";
import { listArchivedPlans, loadArchivedPlan, loadPlan, parsePlanFrontMatter } from "../../plan-store.js";

/**
 * @typedef {Object} ReadCommandDependencies
 * @property {typeof loadPlan} [loadPlan]
 * @property {typeof loadArchivedPlan} [loadArchivedPlan]
 * @property {typeof listArchivedPlans} [listArchivedPlans]
 */

/**
 * @param {string} name
 * @param {string} path
 * @param {import("../../plan-store.js").PlanFrontMatter} attrs
 * @param {string} body
 */
function printPlan(name, path, attrs, body) {
    console.log(`[RunWield] Plan: ${name}`);
    console.log(`Path: ${path}`);
    if (attrs.planId) console.log(`Plan ID: ${attrs.planId}`);
    console.log(`Status: ${attrs.status}`);
    console.log(`Classification: ${attrs.classification}`);
    console.log(`Complexity: ${attrs.complexity}`);
    console.log(`Summary: ${attrs.summary || "(none)"}`);
    if (attrs.archivedAt) console.log(`Archived: ${attrs.archivedAt}`);
    if (attrs.archiveReason) console.log(`Archive reason: ${attrs.archiveReason}`);
    if (attrs.restoredAt) console.log(`Restored: ${attrs.restoredAt}`);
    console.log("\n--- Body ---\n");
    console.log(body.trimEnd());
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: ReadCommandDependencies }} [options]
 */
export async function runPlansReadCommand(argv, options = {}) {
    if (argv[0] === "--help" || argv[0] === "-h") {
        console.log(`Usage: ${CLI_BIN} plans read <plan-name-or-id>`);
        return;
    }
    const target = argv[0];
    if (!target) throw new Error("Missing Plan name or id.");
    if (argv.length > 1) throw new Error(`Unexpected read argument: ${argv[1]}`);

    const deps = /** @type {ReadCommandDependencies} */ (options.__testDeps || {});
    const loadPlanDep = deps.loadPlan || loadPlan;
    const loadArchivedPlanDep = deps.loadArchivedPlan || loadArchivedPlan;
    const listArchivedPlansDep = deps.listArchivedPlans || listArchivedPlans;

    const active = await loadPlanDep(CWD, target).catch(() => null);
    if (active && !target.replaceAll("\\", "/").startsWith("archived/")) {
        printPlan(target.replace(/\.md$/, ""), active.path, active.attrs, active.body);
        return;
    }

    const archived = await loadArchivedPlanDep(CWD, target).catch(() => null);
    if (archived) {
        printPlan(`${PLANS_DIR_NAME}/archived/${archived.name}.md`, archived.path, archived.attrs, archived.body);
        return;
    }

    const archivedMatches = (await listArchivedPlansDep(CWD)).filter((plan) => plan.planId === target);
    if (archivedMatches.length > 1) {
        throw new Error(`Duplicate archived planId values found for ${target}; use an archived Plan name instead.`);
    }
    if (archivedMatches.length === 1) {
        const loaded = await loadArchivedPlanDep(CWD, archivedMatches[0].name);
        if (loaded) {
            printPlan(`${PLANS_DIR_NAME}/archived/${loaded.name}.md`, loaded.path, loaded.attrs, loaded.body);
            return;
        }
    }

    try {
        const activeById = await import("../../plan-store.js").then((mod) => mod.findPlanById(CWD, target));
        const parsed = parsePlanFrontMatter(activeById.markdown);
        printPlan(activeById.planName, activeById.path, activeById.attrs, parsed.body);
        return;
    } catch {
        // Continue to user-facing not found error.
    }

    throw new Error(`Plan not found: ${target}`);
}
