import { findPlansByParent, loadPlan } from "../../plan-store.js";
import { stageValidationPassedInExecutionWorktree } from "../../shared/workflow/plan-lifecycle.js";
import { runDirectDeliveryPublicationTransition } from "../../shared/workflow/state-transition.ts";
import { resolveValidationExecutionContext } from "../../shared/workflow/execution-context.ts";
import {
    buildPlanRecoveryUserMessage,
    buildValidationRecoveryNotice,
    planRecoveryMessage,
} from "../../shared/workflow/validation-user-messages.ts";
import {
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    deleteRemotelyPublishedWorktreeBranch,
    getBranchHead,
    removeWorktreeGitArtifacts,
} from "../../shared/worktree.js";
import { publishExecutionWorktreeIsolated } from "../../shared/isolated-publication.ts";
import {
    pruneEntry as pruneWorktreeRegistryEntry,
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
            buildPlanRecoveryUserMessage({ kind: "manual_merge_unavailable" }),
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
        uiAPI.appendSystemMessage(buildPlanRecoveryUserMessage({ kind: "missing_worktree" }), true, "RunWield");
        return { kind: "menu" };
    }
    if (!context.loadedWorktreeId) {
        uiAPI.appendSystemMessage(
            buildPlanRecoveryUserMessage({ kind: "missing_plan_pointer" }),
            true,
            "RunWield",
        );
        await context.recordRecoveryResult("merge", "blocked", { reason: "missing_canonical_worktree_id" });
        return { kind: "menu" };
    }
    if (!context.worktreeContext.baseBranch) {
        uiAPI.appendSystemMessage(
            buildPlanRecoveryUserMessage({ kind: "missing_target" }),
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
            buildPlanRecoveryUserMessage({ kind: "proof_failed" }),
            true,
            "RunWield",
        );
        await context.recordRecoveryResult("merge", "blocked", { reason: manualResolution.reason });
        return { kind: "menu" };
    }
    if (manualResolution.restoredPlanFile) {
        uiAPI.appendSystemMessage(
            buildPlanRecoveryUserMessage({
                kind: "plan_restored",
                path: manualResolution.restoredPlanFile.relativePath,
            }),
            false,
            "RunWield",
        );
    }
    for (const notice of manualResolution.selfHealNotices || []) {
        uiAPI.appendSystemMessage(buildValidationRecoveryNotice(notice), false, "RunWield");
    }
    const manualContext = manualResolution.context;
    if (manualContext.executionMode !== "worktree") {
        uiAPI.appendSystemMessage(
            buildPlanRecoveryUserMessage({ kind: "not_worktree" }),
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
            buildPlanRecoveryUserMessage({ kind: "incomplete_worktree" }),
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
    let publicationConfirmed = false;
    let remotePublication: Awaited<ReturnType<typeof publishExecutionWorktreeIsolated>> | undefined;
    const cleanupMergedWorktrees = true;
    const mergeWorktreeId = context.worktreeContext?.id;
    try {
        const authorityPlan = await loadPlan(manualWorktreePath, plan.planName);
        if (!authorityPlan) throw new Error(`Plan not found in its execution worktree: ${plan.planName}`);
        const siblingPlanNames = typeof authorityPlan.attrs.parentPlan === "string" && authorityPlan.attrs.parentPlan
            ? (await findPlansByParent(manualWorktreePath, authorityPlan.attrs.parentPlan)).map((child) => child.name)
                .sort()
            : [];
        const publication = await runDirectDeliveryPublicationTransition({
            projectRoot,
            planName: plan.planName,
            planId: authorityPlan.attrs.planId,
            worktreeId: mergeWorktreeId || undefined,
            targetRef: manualTargetBranch,
            immutablePlan: true,
            parentPlan: typeof authorityPlan.attrs.parentPlan === "string" && authorityPlan.attrs.parentPlan
                ? authorityPlan.attrs.parentPlan
                : undefined,
            siblingPlanNames,
            publicationProof: { phase: "manual_recovery_merge", worktreeBranch: manualWorktreeBranch },
            publish: async ({ markEffect }) => {
                const planPath = `docs/plans/${plan.planName}.md`;
                let deliveryEvidence: WorktreeDeliveryEvidence;
                if (authorityPlan.attrs.deliveryEvidence?.mode === "worktree_merge") {
                    deliveryEvidence = authorityPlan.attrs.deliveryEvidence;
                } else {
                    const executionPlan = await loadPlan(manualWorktreePath, plan.planName);
                    if (executionPlan?.attrs.deliveryEvidence?.mode === "worktree_merge") {
                        deliveryEvidence = executionPlan.attrs.deliveryEvidence;
                    } else {
                        const sealedCandidate = await checkpointExecutionWorktree({
                            worktreePath: manualWorktreePath,
                            branch: manualWorktreeBranch,
                            planName: plan.planName,
                            planDescription: authorityPlan.attrs.summary,
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
                const stagingResult = await stageValidationPassedInExecutionWorktree({
                    projectRoot,
                    executionCwd: manualWorktreePath,
                    planName: plan.planName,
                    details: {
                        triageMeta: authorityPlan.attrs,
                        executionMode: "worktree",
                        deliveryEvidence,
                        worktreeStatus: "merged",
                        cleanupMergedWorktrees,
                    },
                });
                const validatedCandidate = await checkpointExecutionWorktree({
                    worktreePath: manualWorktreePath,
                    branch: manualWorktreeBranch,
                    planName: plan.planName,
                    planDescription: authorityPlan.attrs.summary,
                    mergeTargetRef: deliveryEvidence.targetHeadBeforeMerge,
                });
                uiAPI.appendSystemMessage(
                    buildPlanRecoveryUserMessage({
                        kind: "merge_progress",
                        sourceBranch: manualWorktreeBranch,
                        targetBranch: manualTargetBranch,
                    }),
                );
                const mergeResult = await publishExecutionWorktreeIsolated({
                    projectRoot,
                    executionCwd: manualWorktreePath,
                    executionBranch: manualWorktreeBranch,
                    targetBranch: manualTargetBranch,
                    planName: plan.planName,
                    planDescription: plan.attrs.summary,
                    sealedExecutionCommit: validatedCandidate.executionCommit,
                    allowedPlanPaths: stagingResult.planPaths.length > 0 ? stagingResult.planPaths : [planPath],
                });
                remotePublication = mergeResult;
                publicationConfirmed = true;
                await markEffect("direct_delivery_target_ref_moved", {
                    planName: plan.planName,
                    worktreeId: mergeWorktreeId,
                    worktreeBranch: manualWorktreeBranch,
                    targetBranch: manualTargetBranch,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    expectedTargetHead: mergeResult.targetHeadBeforeMerge,
                    executionMetadataCommit: mergeResult.executionMetadataCommit,
                    publicationCommit: mergeResult.publicationCommit,
                    upstreamRemote: mergeResult.upstreamRemote,
                    upstreamBranch: mergeResult.upstreamBranch,
                });
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
                        console.error("[RunWield] worktree_result_save_failed", registryError);
                        uiAPI.appendSystemMessage(
                            buildPlanRecoveryUserMessage({ kind: "registry_update_failed" }),
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
                    if (remotePublication) {
                        await deleteRemotelyPublishedWorktreeBranch({
                            projectRoot,
                            branch: context.worktreeContext.branch,
                            remote: remotePublication.upstreamRemote,
                            upstreamBranch: remotePublication.upstreamBranch,
                            publicationCommit: remotePublication.publicationCommit,
                        });
                    } else {
                        await deleteMergedWorktreeBranch({ projectRoot, branch: context.worktreeContext.branch });
                    }
                }
                if (context.worktreeContext.id) {
                    await pruneWorktreeRegistryEntry(projectRoot, context.worktreeContext.id);
                }
            } catch (cleanupError) {
                const cleanupReason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                console.error("[RunWield] Worktree cleanup failed", cleanupReason);
                uiAPI.appendSystemMessage(planRecoveryMessage("merge_cleanup_failed"), true, "RunWield");
            }
        }
        uiAPI.appendSystemMessage(buildPlanRecoveryUserMessage({ kind: "merged" }), false, "RunWield");
        try {
            await context.recordRecoveryResult("merge", "merged", { cleanupMergedWorktrees });
        } catch (metricError) {
            console.error("[RunWield] recovery_result_save_failed", metricError);
            uiAPI.appendSystemMessage(
                buildPlanRecoveryUserMessage({ kind: "result_record_failed" }),
                true,
                "RunWield",
            );
        }
    } catch (error) {
        if (publicationConfirmed) {
            const reason = error instanceof Error ? error.message : String(error);
            console.error("[RunWield] Post-merge step failed", reason);
            uiAPI.appendSystemMessage(planRecoveryMessage("handoff_failed"), true, "RunWield");
            return { kind: "handled" };
        }
        const reason = isGitRepositoryRequiredError(error)
            ? formatGitRequiredMessage(error)
            : error instanceof Error
            ? error.message
            : String(error);
        console.error("[RunWield] Worktree merge failed", reason);
        uiAPI.appendSystemMessage(planRecoveryMessage("merge_failed"), true, "RunWield");
        if (context.worktreeContext?.id) {
            try {
                await updateWorktreeRegistryEntry(projectRoot, context.worktreeContext.id, {
                    status: "publication_failed",
                });
            } catch (metadataError) {
                console.error("[RunWield] merge_conflict_worktree_save_failed", metadataError);
                uiAPI.appendSystemMessage(
                    buildPlanRecoveryUserMessage({ kind: "conflict_state_save_failed" }),
                    true,
                    "RunWield",
                );
            }
        }
        const mergeFailureKind: RecoveryMetricDetailValue = "manual_merge_failed";
        await context.recordRecoveryResult("merge", "failed", { mergeFailureKind });
    }
    return { kind: "handled" };
}
