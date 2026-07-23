/**
 * @module cmd/plans/read
 * Open active or archived Plan markdown in a read-only browser view.
 */

import { CLI_BIN, CWD, PLANS_DIR_NAME } from "../../constants.js";
import { findPlanById, listArchivedPlans, loadArchivedPlan, loadPlan } from "../../plan-store.js";
import { startArtifactReadSurface } from "../../ui/review/review-launcher.js";

/**
 * @typedef {Object} ReadCommandDependencies
 * @property {typeof loadPlan} [loadPlan]
 * @property {typeof loadArchivedPlan} [loadArchivedPlan]
 * @property {typeof listArchivedPlans} [listArchivedPlans]
 * @property {typeof findPlanById} [findPlanById]
 * @property {typeof startArtifactReadSurface} [startArtifactReadSurface]
 */

/**
 * @typedef {Object} ResolvedPlanReadArtifact
 * @property {string} title
 * @property {string} path
 * @property {string} markdown
 */

/**
 * @param {ResolvedPlanReadArtifact} artifact
 * @param {ReadCommandDependencies} deps
 * @param {{ noOpen?: boolean }} [options]
 */
async function openPlanReadSurface(artifact, deps, options = {}) {
    const startReadSurface = deps.startArtifactReadSurface || startArtifactReadSurface;
    const noOpen = options.noOpen === true;
    const server = await startReadSurface({
        cwd: CWD,
        markdown: artifact.markdown,
        artifactKind: "plan",
        title: artifact.title,
        path: artifact.path,
        openInDefaultBrowser: noOpen ? () => Promise.resolve(false) : undefined,
    });
    console.log(`[RunWield] Plan read-only view: ${server.url}`);
    if (!server.opened && !noOpen) {
        console.log(
            "[RunWield] Could not open your browser automatically. Open the URL above, then choose Close when finished.",
        );
    }
    try {
        await server.waitForDecision();
    } finally {
        await stopReadSurface(server);
    }
    if (!deps.startArtifactReadSurface) Deno.exit(0);
}

/**
 * @param {{ stop: () => void | Promise<void> }} server
 */
async function stopReadSurface(server) {
    await Promise.race([
        Promise.resolve(server.stop()),
        new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: ReadCommandDependencies }} [options]
 */
export async function runPlansReadCommand(argv, options = {}) {
    if (argv[0] === "--help" || argv[0] === "-h") {
        console.log(`Usage: ${CLI_BIN} plans read [--no-open] <plan-name-or-id>`);
        return;
    }
    let noOpen = false;
    const targets = [];
    for (const arg of argv) {
        if (arg === "--no-open") {
            noOpen = true;
            continue;
        }
        if (arg.startsWith("-")) throw new Error(`Unexpected read argument: ${arg}`);
        targets.push(arg);
    }
    const target = targets[0];
    if (!target) throw new Error("Missing Plan name or id.");
    if (targets.length > 1) throw new Error(`Unexpected read argument: ${targets[1]}`);

    const deps = /** @type {ReadCommandDependencies} */ (options.__testDeps || {});
    const loadPlanDep = deps.loadPlan || loadPlan;
    const loadArchivedPlanDep = deps.loadArchivedPlan || loadArchivedPlan;
    const listArchivedPlansDep = deps.listArchivedPlans || listArchivedPlans;
    const findPlanByIdDep = deps.findPlanById || findPlanById;

    const active = await loadPlanDep(CWD, target).catch(() => null);
    if (active && !target.replaceAll("\\", "/").startsWith("archived/")) {
        await openPlanReadSurface(
            {
                title: target.replace(/\.md$/, ""),
                path: active.path,
                markdown: active.markdown,
            },
            deps,
            { noOpen },
        );
        return;
    }

    const archived = await loadArchivedPlanDep(CWD, target).catch(() => null);
    if (archived) {
        await openPlanReadSurface(
            {
                title: `${PLANS_DIR_NAME}/archived/${archived.name}.md`,
                path: archived.path,
                markdown: archived.markdown,
            },
            deps,
            { noOpen },
        );
        return;
    }

    const archivedMatches = (await listArchivedPlansDep(CWD)).filter((plan) => plan.planId === target);
    if (archivedMatches.length > 1) {
        throw new Error(`Duplicate archived planId values found for ${target}; use an archived Plan name instead.`);
    }
    if (archivedMatches.length === 1) {
        const loaded = await loadArchivedPlanDep(CWD, archivedMatches[0].name);
        if (loaded) {
            await openPlanReadSurface(
                {
                    title: `${PLANS_DIR_NAME}/archived/${loaded.name}.md`,
                    path: loaded.path,
                    markdown: loaded.markdown,
                },
                deps,
                { noOpen },
            );
            return;
        }
    }

    try {
        const activeById = await findPlanByIdDep(CWD, target);
        await openPlanReadSurface(
            {
                title: activeById.planName,
                path: activeById.path,
                markdown: activeById.markdown,
            },
            deps,
            { noOpen },
        );
        return;
    } catch {
        // Continue to user-facing not found error.
    }

    throw new Error(`Plan not found: ${target}`);
}
