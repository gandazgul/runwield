/**
 * @module cmd/plans/read
 * Open active or archived Plan markdown in a read-only browser view.
 */

import { CLI_BIN, getCwd, PLANS_DIR_NAME } from "../../constants.js";
import { findPlanById, listArchivedPlans, loadArchivedPlan, loadPlan } from "../../plan-store.js";
import { startArtifactReadSurface } from "../../ui/review/review-launcher.js";

interface ResolvedPlanReadArtifact {
    title: string;
    path: string;
    markdown: string;
}

async function openPlanReadSurface(
    artifact: ResolvedPlanReadArtifact,
    options: { noOpen?: boolean } = {},
): Promise<void> {
    const noOpen = options.noOpen === true;
    const server = await startArtifactReadSurface({
        cwd: getCwd(),
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
        await Promise.race([
            Promise.resolve(server.stop()),
            new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
    }
}

export async function runPlansReadCommand(argv: string[]): Promise<void> {
    if (argv[0] === "--help" || argv[0] === "-h") {
        console.log(`Usage: ${CLI_BIN} plans read [--no-open] <plan-name-or-id>`);
        return;
    }
    let noOpen = false;
    const targets: string[] = [];
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

    const active = await loadPlan(getCwd(), target).catch(() => null);
    if (active && !target.replaceAll("\\", "/").startsWith("archived/")) {
        await openPlanReadSurface(
            { title: target.replace(/\.md$/, ""), path: active.path, markdown: active.markdown },
            { noOpen },
        );
        return;
    }

    const archived = await loadArchivedPlan(getCwd(), target).catch(() => null);
    if (archived) {
        await openPlanReadSurface(
            {
                title: `${PLANS_DIR_NAME}/archived/${archived.name}.md`,
                path: archived.path,
                markdown: archived.markdown,
            },
            { noOpen },
        );
        return;
    }

    const archivedMatches = (await listArchivedPlans(getCwd())).filter((plan) => plan.planId === target);
    if (archivedMatches.length > 1) {
        throw new Error(`Duplicate archived planId values found for ${target}; use an archived Plan name instead.`);
    }
    if (archivedMatches.length === 1) {
        const loaded = await loadArchivedPlan(getCwd(), archivedMatches[0].name);
        if (loaded) {
            await openPlanReadSurface(
                {
                    title: `${PLANS_DIR_NAME}/archived/${loaded.name}.md`,
                    path: loaded.path,
                    markdown: loaded.markdown,
                },
                { noOpen },
            );
            return;
        }
    }

    try {
        const activeById = await findPlanById(getCwd(), target);
        await openPlanReadSurface(
            { title: activeById.planName, path: activeById.path, markdown: activeById.markdown },
            { noOpen },
        );
        return;
    } catch {
        // Continue to the user-facing not-found error.
    }

    throw new Error(`Plan not found: ${target}`);
}
