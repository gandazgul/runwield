import { canonicalizeStoredPlanName, resolvePlan } from "../../plan-store.js";
import { resolveWorkflowPlanLocation } from "../../shared/workflow/plan-location.ts";
import { basename, dirname, isAbsolute, relative, resolve } from "@std/path";
import { resolvePrimaryCheckoutRoot } from "../../shared/primary-checkout.ts";
import { listEntries } from "../../shared/worktree-registry.js";
import { cleanupStoredPublication, loadPublicationAttempt } from "../../shared/workflow/publication-machine.ts";

type ResolvedPlan = Awaited<ReturnType<typeof resolvePlan>>;

export interface LoadPlanResolution {
    plan: ResolvedPlan;
}

export interface PublicationCleanupNotice {
    planName: string;
    targetBranch: string;
    complete: boolean;
    details: string[];
}

async function canonicalFilePath(path: string): Promise<string> {
    try {
        return await Deno.realPath(path);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        const parent = dirname(path);
        return parent === path ? path : resolve(await canonicalFilePath(parent), basename(path));
    }
}

async function normalizePlanArgument(projectRoot: string, planArg: string): Promise<string> {
    const pathArgument = await canonicalFilePath(resolve(projectRoot, planArg));
    // A path into this project's Plan directory is the same resource as its name,
    // even when that primary file is absent. Only genuinely external files bypass
    // controller selection.
    for (const root of [projectRoot, resolvePrimaryCheckoutRoot(projectRoot)]) {
        const storedPath = relative(await canonicalFilePath(resolve(root, "docs/plans")), pathArgument);
        if (!isAbsolute(storedPath) && storedPath !== ".." && !storedPath.startsWith("../")) {
            planArg = storedPath;
            break;
        }
    }
    return planArg;
}

/** Resume already-proven publication independently of its removed Plan directory. */
export async function resumePlanPublicationCleanup(
    projectRoot: string,
    planArg?: string,
): Promise<PublicationCleanupNotice[]> {
    const registryRoot = resolvePrimaryCheckoutRoot(projectRoot);
    let planName: string | undefined;
    if (planArg !== undefined) {
        try {
            planName = canonicalizeStoredPlanName(await normalizePlanArgument(projectRoot, planArg)).name;
        } catch {
            return [];
        }
    }
    const entries = (await listEntries(registryRoot, { migrate: false }))
        .filter((entry) => entry.status !== "abandoned" && (!planName || entry.planName === planName));
    if (entries.some((entry) => entries.filter((candidate) => candidate.planName === entry.planName).length > 1)) {
        throw new Error(
            "More than one execution attempt owns this Plan. Inspect the saved worktree records before cleanup.",
        );
    }
    const notices: PublicationCleanupNotice[] = [];
    for (const entry of entries) {
        if (
            entry.publication?.phase !== "publication_verified" && entry.publication?.phase !== "cleanup_complete"
        ) continue;
        const publication = await loadPublicationAttempt(registryRoot, entry.id);
        if (!publication) continue;
        const cleanup = await cleanupStoredPublication(registryRoot, publication);
        notices.push({
            planName: publication.planName,
            targetBranch: publication.targetBranch,
            complete: cleanup.complete,
            details: cleanup.details,
        });
    }
    return notices;
}

/**
 * Execution owns its document. A missing or edited primary copy is irrelevant.
 */
export async function resolvePlanWithPrimaryRecovery(
    projectRoot: string,
    planArg: string,
): Promise<LoadPlanResolution> {
    planArg = await normalizePlanArgument(projectRoot, planArg);
    let name: string;
    try {
        name = canonicalizeStoredPlanName(planArg).name;
    } catch {
        return { plan: await resolvePlan(projectRoot, planArg) };
    }
    const location = await resolveWorkflowPlanLocation(projectRoot, name, { migrateRegistry: false });
    if (location.archived) {
        throw new Error(`This Plan is archived. Run wld plans archive restore ${name} before continuing it.`);
    }
    return { plan: location.plan ? { ...location.plan, planName: name } : await resolvePlan(projectRoot, planArg) };
}
