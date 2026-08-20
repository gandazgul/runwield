import { updatePlanFrontMatter } from "../../plan-store.js";
import { isExecutionCommitPublishedUpstream } from "../../shared/isolated-publication.ts";
import { updateEntry as updateWorktreeRegistryEntry } from "../../shared/worktree-registry.js";
import { createGitPort } from "../../shared/git-port.ts";

import type { PlanFrontMatter } from "../../plan-store.js";
import type { RecoveryWorktreeContext } from "./plan-session-types.ts";

export interface LegacyPublicationPlan {
    planName: string;
    attrs: PlanFrontMatter;
    revision?: string;
}

export interface LegacyPublicationRecoveryResult {
    recovered: boolean;
    attrs: PlanFrontMatter;
    worktree: RecoveryWorktreeContext | null;
}

/**
 * Convert the one partial-publication shape created by the retired local-merge
 * flow into the current retry state. The execution worktree and registry are the
 * only files changed; the primary checkout remains read-only.
 */
export async function recoverLegacyUnpublishedPlan(
    projectRoot: string,
    plan: LegacyPublicationPlan,
    worktree: RecoveryWorktreeContext | null,
): Promise<LegacyPublicationRecoveryResult> {
    const evidence = plan.attrs.deliveryEvidence;
    if (
        plan.attrs.status !== "verified" ||
        (worktree?.status !== "completed" && worktree?.status !== "publication_failed") ||
        evidence?.mode !== "worktree_merge" ||
        !worktree.id ||
        !worktree.path ||
        !worktree.branch ||
        !worktree.baseBranch ||
        evidence.targetBranch !== worktree.baseBranch
    ) {
        return { recovered: false, attrs: plan.attrs, worktree };
    }

    const pathExists = await Deno.stat(worktree.path).then((entry) => entry.isDirectory).catch(() => false);
    if (!pathExists) return { recovered: false, attrs: plan.attrs, worktree };
    const commitBelongsToAttempt = await createGitPort().isAncestor(
        projectRoot,
        evidence.executionCommit,
        worktree.branch,
    ).catch(() => false);
    if (!commitBelongsToAttempt) return { recovered: false, attrs: plan.attrs, worktree };

    const alreadyPublished = await isExecutionCommitPublishedUpstream({
        projectRoot,
        executionBranch: worktree.branch,
        targetBranch: worktree.baseBranch,
        executionCommit: evidence.executionCommit,
    });
    if (alreadyPublished) return { recovered: false, attrs: plan.attrs, worktree };

    if (worktree.status !== "publication_failed") {
        await updateWorktreeRegistryEntry(projectRoot, worktree.id, { status: "publication_failed" });
    }
    const attrs = await updatePlanFrontMatter(
        worktree.path,
        plan.planName,
        {
            status: "validated",
            validatedAt: plan.attrs.verifiedAt || plan.attrs.updatedAt || new Date().toISOString(),
            verifiedAt: null,
        },
        plan.attrs,
        { expectedRevision: plan.revision },
    );
    return {
        recovered: true,
        attrs,
        worktree: { ...worktree, status: "publication_failed" },
    };
}
