import { findPlansByParent, loadPlan } from "../../plan-store.js";
import { shouldCleanupMergedWorktrees } from "../../shared/settings.js";
import { recordPlanEvent, stageValidationPassedInExecutionWorktree } from "../../shared/workflow/plan-lifecycle.js";
import { runDirectDeliveryPublicationTransition } from "../../shared/workflow/state-transition.ts";
import { resolveValidationExecutionContext } from "../../shared/workflow/execution-context.ts";
import {
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    getBranchHead,
    isCommitAncestorOfBranch,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    removeWorktreeGitArtifacts,
    restorePrimaryPlanPathAfterMergeFailure,
} from "../../shared/worktree.js";
import {
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../../shared/worktree-registry.js";
import { canManuallyMergeRecoveredWorktree, confirmRecoveryWorktreeAvailable } from "./plan-recovery-worktree.ts";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../../shared/git.js";

import type { WorktreeDeliveryEvidence } from "../../plan-store.js";
import type {
    RecoveryActionContext,
    RecoveryActionOutcome,
    RecoveryMetricDetailValue,
} from "./plan-recovery-actions.ts";

export async function mergeRecoveredWorktree(context: RecoveryActionContext): Promise<RecoveryActionOutcome> {
    const { projectRoot, plan, uiAPI } = context;
    context.worktreeContext = await context.refreshRecoveryWorktree();
    if (!canManuallyMergeRecoveredWorktree(context.worktreeContext)) {
        uiAPI.appendSystemMessage(
            "Manual worktree merge is only available after Workflow Validation passed but merge-back failed. Retry Workflow Validation first.",
            true,
            "RunWield",
        );
        return { kind: "menu" };
    }
    if (
        !(await confirmRecoveryWorktreeAvailable(
            projectRoot,
            plan.planName,
            context.worktreeContext,
            uiAPI,
        ))
    ) {
        return { kind: "menu" };
    }
    if (!context.worktreeContext?.branch || !context.worktreeContext.path) {
        uiAPI.appendSystemMessage("Cannot merge because no worktree branch or path is recorded.", true, "RunWield");
        return { kind: "menu" };
    }
    if (!context.loadedWorktreeId) {
        uiAPI.appendSystemMessage(
            `Cannot merge recovered worktree ${context.worktreeContext.branch} because the loaded Plan did not contain a canonical worktreeId. Retry Workflow Validation; RunWield will not publish Delivery Evidence from branch-name recovery alone.`,
            true,
            "RunWield",
        );
        await context.recordRecoveryResult("merge", "blocked", { reason: "missing_canonical_worktree_id" });
        return { kind: "menu" };
    }
    if (!context.worktreeContext.baseBranch) {
        uiAPI.appendSystemMessage(
            `Cannot merge recovered worktree ${context.worktreeContext.branch} because no concrete target branch is recorded. Run Workflow Validation or reset recovery metadata; RunWield will not publish Delivery Evidence with an ambiguous target.`,
            true,
            "RunWield",
        );
        await context.recordRecoveryResult("merge", "blocked", { reason: "missing_target_branch" });
        return { kind: "menu" };
    }
    const manualResolution = await resolveValidationExecutionContext({
        projectRoot,
        planName: plan.planName,
        triageMeta: plan.attrs,
        explicitContext: {
            planName: plan.planName,
            triageMeta: plan.attrs,
            executionMode: plan.attrs.executionMode,
            baselineTree: plan.attrs.executionBaselineTree,
            worktreeId: context.loadedWorktreeId,
            worktreeBranch: plan.attrs.worktreeBranch,
            worktreeBaseBranch: plan.attrs.worktreeBaseBranch,
            executionCwd: plan.attrs.worktreePath,
        },
    });
    if (manualResolution.kind === "blocked") {
        uiAPI.appendSystemMessage(
            `Cannot merge recovered worktree because validation context proof failed: ${manualResolution.message}`,
            true,
            "RunWield",
        );
        await context.recordRecoveryResult("merge", "blocked", { reason: manualResolution.reason });
        return { kind: "menu" };
    }
    if (manualResolution.restoredPlanFile) {
        uiAPI.appendSystemMessage(
            `Restored missing execution worktree Plan file from the canonical Project Plan: ${manualResolution.restoredPlanFile.relativePath}. Continuing Workflow Validation.`,
            false,
            "RunWield",
        );
    }
    for (const notice of manualResolution.selfHealNotices || []) {
        uiAPI.appendSystemMessage(notice, false, "RunWield");
    }
    const manualContext = manualResolution.context;
    if (manualContext.executionMode !== "worktree") {
        uiAPI.appendSystemMessage(
            "Cannot merge recovered worktree because the resolved validation context is not a worktree execution.",
            true,
            "RunWield",
        );
        await context.recordRecoveryResult("merge", "blocked", { reason: "not_worktree_execution" });
        return { kind: "menu" };
    }
    const manualWorktreePath = manualContext.executionCwd;
    const manualWorktreeBranch = manualContext.worktreeBranch;
    const manualTargetBranch = manualContext.worktreeBaseBranch;
    if (!manualWorktreePath || !manualWorktreeBranch || !manualTargetBranch) {
        uiAPI.appendSystemMessage(
            "Cannot merge recovered worktree because resolved validation context is missing path, branch, or target branch.",
            true,
            "RunWield",
        );
        await context.recordRecoveryResult("merge", "blocked", { reason: "incomplete_resolved_worktree_context" });
        return { kind: "menu" };
    }
    return await attemptManualPublication(
        context,
        manualWorktreePath,
        manualWorktreeBranch,
        manualTargetBranch,
    );
}

async function attemptManualPublication(
    context: RecoveryActionContext,
    manualWorktreePath: string,
    manualWorktreeBranch: string,
    manualTargetBranch: string,
): Promise<RecoveryActionOutcome> {
    const { projectRoot, plan, uiAPI } = context;
    const primaryPlanSnapshots: Awaited<ReturnType<typeof preparePrimaryPlanPathForMerge>>[] = [];
    let manualDeliveryEvidence: WorktreeDeliveryEvidence | undefined;
    let mergeCompleted = false;
    const cleanupMergedWorktrees = shouldCleanupMergedWorktrees(projectRoot);
    const mergeWorktreeId = context.worktreeContext?.id;
    try {
        const siblingPlanNames = typeof plan.attrs.parentPlan === "string" && plan.attrs.parentPlan
            ? (await findPlansByParent(projectRoot, plan.attrs.parentPlan)).map((child) => child.name)
                .sort()
            : [];
        const publication = await runDirectDeliveryPublicationTransition({
            projectRoot,
            planName: plan.planName,
            planId: plan.attrs.planId,
            worktreeId: mergeWorktreeId || undefined,
            targetRef: manualTargetBranch,
            expectedRevision: plan.revision,
            parentPlan: typeof plan.attrs.parentPlan === "string" && plan.attrs.parentPlan
                ? plan.attrs.parentPlan
                : undefined,
            siblingPlanNames,
            publicationProof: { phase: "manual_recovery_merge", worktreeBranch: manualWorktreeBranch },
            publish: async ({ markEffect, registerRollback }) => {
                const planPath = `plans/${plan.planName}.md`;
                let deliveryEvidence: WorktreeDeliveryEvidence;
                if (plan.attrs.deliveryEvidence?.mode === "worktree_merge") {
                    deliveryEvidence = plan.attrs.deliveryEvidence;
                } else {
                    const executionPlan = await loadPlan(manualWorktreePath, plan.planName);
                    if (executionPlan?.attrs.deliveryEvidence?.mode === "worktree_merge") {
                        deliveryEvidence = executionPlan.attrs.deliveryEvidence;
                    } else {
                        const sealedCandidate = await checkpointExecutionWorktree({
                            worktreePath: manualWorktreePath,
                            branch: manualWorktreeBranch,
                            planName: plan.planName,
                            planDescription: plan.attrs.summary,
                        });
                        const targetHeadBeforeMerge = await getBranchHead(projectRoot, manualTargetBranch);
                        deliveryEvidence = {
                            version: 1,
                            mode: "worktree_merge",
                            executionCommit: sealedCandidate.executionCommit,
                            targetBranch: manualTargetBranch,
                            targetHeadBeforeMerge,
                        };
                    }
                }
                manualDeliveryEvidence = deliveryEvidence;
                const stagingResult = await stageValidationPassedInExecutionWorktree({
                    projectRoot,
                    executionCwd: manualWorktreePath,
                    planName: plan.planName,
                    details: {
                        triageMeta: plan.attrs,
                        executionMode: "worktree",
                        deliveryEvidence,
                        worktreeStatus: "merged",
                        cleanupMergedWorktrees,
                    },
                });
                for (const relativePath of stagingResult.planPaths) {
                    primaryPlanSnapshots.push(
                        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath }),
                    );
                }
                if (primaryPlanSnapshots.length > 0) {
                    registerRollback("restore_primary_plan_snapshots", async () => {
                        if (mergeCompleted) {
                            return;
                        }
                        for (const snapshot of primaryPlanSnapshots.toReversed()) {
                            await restorePrimaryPlanPathAfterMergeFailure(snapshot);
                        }
                        primaryPlanSnapshots.splice(0, primaryPlanSnapshots.length);
                    });
                }
                uiAPI.appendSystemMessage(
                    `Merging worktree branch ${manualWorktreeBranch} into target branch ${manualTargetBranch}.`,
                );
                const mergeResult = await mergeExecutionWorktree({
                    projectRoot,
                    branch: manualWorktreeBranch,
                    targetBranch: manualTargetBranch,
                    worktreePath: manualWorktreePath,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                    planName: plan.planName,
                    planDescription: plan.attrs.summary,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    allowedDirtyPaths: stagingResult.planPaths.length > 0 ? stagingResult.planPaths : [planPath],
                    preservePlanPaths: stagingResult.planPaths,
                });
                mergeCompleted = true;
                await markEffect("direct_delivery_target_ref_moved", {
                    planName: plan.planName,
                    worktreeId: mergeWorktreeId,
                    worktreeBranch: manualWorktreeBranch,
                    targetBranch: manualTargetBranch,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                    executionMetadataCommit: mergeResult?.executionMetadataCommit,
                });
                if (mergeResult?.updatedPrimaryCheckout === false) {
                    for (const snapshot of primaryPlanSnapshots.toReversed()) {
                        try {
                            await restorePrimaryPlanPathAfterMergeFailure(snapshot);
                        } catch (restoreError) {
                            const restoreReason = restoreError instanceof Error
                                ? restoreError.message
                                : String(restoreError);
                            uiAPI.appendSystemMessage(
                                `Worktree merged, but restoring the primary Plan snapshot failed: ${restoreReason}`,
                                true,
                                "RunWield",
                            );
                        }
                    }
                }
                const candidateMerged = await isCommitAncestorOfBranch(
                    projectRoot,
                    deliveryEvidence.executionCommit,
                    deliveryEvidence.targetBranch,
                );
                if (!candidateMerged) {
                    throw new Error(
                        `Post-merge verification failed: validated candidate ${deliveryEvidence.executionCommit} is not contained in ${deliveryEvidence.targetBranch}.`,
                    );
                }
                if (mergeResult?.executionMetadataCommit) {
                    const metadataMerged = await isCommitAncestorOfBranch(
                        projectRoot,
                        mergeResult.executionMetadataCommit,
                        deliveryEvidence.targetBranch,
                    );
                    if (!metadataMerged) {
                        throw new Error(
                            `Post-merge verification failed: validation metadata commit ${mergeResult.executionMetadataCommit} is not contained in ${deliveryEvidence.targetBranch}.`,
                        );
                    }
                }
                if (mergeWorktreeId) {
                    try {
                        await updateWorktreeRegistryEntry(projectRoot, mergeWorktreeId, {
                            status: "merged",
                        });
                        await markEffect("worktree_registry_updated", {
                            worktreeId: mergeWorktreeId,
                            status: "merged",
                        });
                    } catch (registryError) {
                        const registryReason = registryError instanceof Error
                            ? registryError.message
                            : String(registryError);
                        uiAPI.appendSystemMessage(
                            `Worktree merged, but updating its registry status failed: ${registryReason}`,
                            true,
                            "RunWield",
                        );
                    }
                }
                return { mergeResult };
            },
        });
        if (publication.status !== "committed") {
            if (publication.cause !== undefined) {
                throw publication.cause;
            }
            throw new Error(publication.message || `Worktree merge transaction did not commit for ${plan.planName}.`);
        }
        if (cleanupMergedWorktrees && context.worktreeContext?.path) {
            try {
                await removeWorktreeGitArtifacts({
                    projectRoot,
                    path: context.worktreeContext.path,
                    force: false,
                });
                if (context.worktreeContext.branch) {
                    await deleteMergedWorktreeBranch({ projectRoot, branch: context.worktreeContext.branch });
                }
                if (context.worktreeContext.id) {
                    await removeWorktreeRegistryEntry(projectRoot, context.worktreeContext.id);
                }
            } catch (cleanupError) {
                const cleanupReason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                uiAPI.appendSystemMessage(`Worktree merged, but cleanup failed: ${cleanupReason}`, true, "RunWield");
            }
        }
        uiAPI.appendSystemMessage("Worktree changes merged and plan marked verified.", false, "RunWield");
        try {
            await context.recordRecoveryResult("merge", "merged", { cleanupMergedWorktrees });
        } catch (metricError) {
            const metricReason = metricError instanceof Error ? metricError.message : String(metricError);
            uiAPI.appendSystemMessage(
                `Worktree merged, but recording the recovery result failed: ${metricReason}`,
                true,
                "RunWield",
            );
        }
    } catch (error) {
        if (mergeCompleted) {
            const reason = error instanceof Error ? error.message : String(error);
            uiAPI.appendSystemMessage(`Worktree merged, but post-merge processing failed: ${reason}`, true, "RunWield");
            return { kind: "handled" };
        }
        let reason = isGitRepositoryRequiredError(error)
            ? formatGitRequiredMessage(error)
            : error instanceof Error
            ? error.message
            : String(error);
        if (primaryPlanSnapshots.length > 0 && !mergeCompleted) {
            for (const snapshot of primaryPlanSnapshots.toReversed()) {
                try {
                    await restorePrimaryPlanPathAfterMergeFailure(snapshot);
                } catch (restoreError) {
                    const restoreReason = restoreError instanceof Error ? restoreError.message : String(restoreError);
                    reason += ` Primary Plan rollback also failed: ${restoreReason}`;
                }
            }
        }
        uiAPI.appendSystemMessage(`Worktree merge failed: ${reason}`, true, "RunWield");
        if (context.worktreeContext?.id) {
            try {
                await updateWorktreeRegistryEntry(projectRoot, context.worktreeContext.id, {
                    status: "merge_conflict",
                });
            } catch (metadataError) {
                const metadataReason = metadataError instanceof Error ? metadataError.message : String(metadataError);
                uiAPI.appendSystemMessage(
                    `Could not update worktree registry while merge conflict is active: ${metadataReason}`,
                    true,
                    "RunWield",
                );
            }
        }
        try {
            await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "worktree_merge_failed",
                currentStatus: "implemented",
                details: {
                    triageMeta: plan.attrs,
                    failureReason: reason,
                    deliveryEvidence: manualDeliveryEvidence,
                    worktreeId: context.worktreeContext?.id,
                    worktreePath: context.worktreeContext?.path,
                    worktreeBranch: context.worktreeContext?.branch,
                    worktreeBaseBranch: context.worktreeContext?.baseBranch,
                },
            });
        } catch (metadataError) {
            const metadataReason = metadataError instanceof Error ? metadataError.message : String(metadataError);
            uiAPI.appendSystemMessage(
                `Could not update plan metadata while merge conflict is active: ${metadataReason}`,
                true,
                "RunWield",
            );
        }
        const mergeFailureKind: RecoveryMetricDetailValue = "manual_merge_failed";
        await context.recordRecoveryResult("merge", "failed", { mergeFailureKind });
    }
    return { kind: "handled" };
}
