import { dirname, join, relative } from "@std/path";
import { RUNWIELD_DIR_NAME } from "../../constants.js";
import {
    loadPlan,
    loadPlanStrict,
    resolvePlan,
    withPlanLock,
    writePlanMarkdownWithRevision,
} from "../../plan-store.js";
import { findActiveByPlanName } from "../../shared/worktree-registry.js";

type ResolvedPlan = Awaited<ReturnType<typeof resolvePlan>>;

export interface PrimaryPlanRestore {
    relativePath: string;
    executionBranch: string;
    backupRelativePath?: string;
}

export interface LoadPlanResolution {
    plan: ResolvedPlan;
    restored?: PrimaryPlanRestore;
}

function projectRelative(projectRoot: string, path: string): string {
    return relative(projectRoot, path).replaceAll("\\", "/");
}

/**
 * Resolve a Plan normally, then recover a missing or malformed canonical copy
 * only when one exact live worktree attempt proves the execution copy's identity.
 */
export async function resolvePlanWithPrimaryRecovery(
    projectRoot: string,
    planArg: string,
): Promise<LoadPlanResolution> {
    try {
        return { plan: await resolvePlan(projectRoot, planArg) };
    } catch (originalError) {
        const attempt = await findActiveByPlanName(projectRoot, planArg);
        if (!attempt?.path) throw originalError;

        const executionPlan = await loadPlan(attempt.path, attempt.planName).catch(() => null);
        if (!executionPlan) throw originalError;
        const planIdMatches = Boolean(attempt.planId && executionPlan.attrs.planId === attempt.planId);
        const worktreeIdMatches = executionPlan.attrs.worktreeId === attempt.id;
        if (!planIdMatches && !worktreeIdMatches) throw originalError;

        const restoration = await withPlanLock(projectRoot, attempt.planName, async () => {
            // Re-read under the Plan lock. If another process repaired the file while
            // recovery was proving the worktree, leave its valid bytes alone.
            const primary = await loadPlanStrict(projectRoot, attempt.planName);
            if (primary.kind === "loaded") throw originalError;
            if (primary.kind !== "not_found" && primary.kind !== "malformed") throw originalError;

            let backupRelativePath: string | undefined;
            if (primary.kind === "malformed") {
                const backupPath = join(
                    projectRoot,
                    RUNWIELD_DIR_NAME,
                    "recovery",
                    `${attempt.planName.replaceAll("/", "-")}.malformed-${crypto.randomUUID()}.md`,
                );
                await Deno.mkdir(dirname(backupPath), { recursive: true });
                await Deno.copyFile(primary.path, backupPath);
                backupRelativePath = projectRelative(projectRoot, backupPath);
            }

            await writePlanMarkdownWithRevision(primary.path, executionPlan.markdown, undefined);
            return { path: primary.path, backupRelativePath };
        });
        const restored = await resolvePlan(projectRoot, attempt.planName);
        return {
            plan: restored,
            restored: {
                relativePath: projectRelative(projectRoot, restoration.path),
                executionBranch: attempt.branch,
                ...(restoration.backupRelativePath ? { backupRelativePath: restoration.backupRelativePath } : {}),
            },
        };
    }
}
