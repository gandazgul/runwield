import { buildPlanEventUpdates } from "../../shared/workflow/plan-lifecycle.js";
import { runRecoveryTransition } from "../../shared/workflow/state-transition.ts";
import { deleteMergedWorktreeBranch } from "../../shared/worktree.js";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../../shared/git.js";
import {
    confirmBaselineReset,
    confirmMetadataOnlyRecoveryCleanup,
    confirmMissingWorktreeRecreate,
    confirmWorktreeAction,
    getRecordedWorktreeRecreateBase,
    hasWorktreeContext,
    pathExists,
} from "./plan-recovery-worktree.ts";
import { executeReadyPlanWithRepair } from "./plan-execution.ts";
import { transitionFailureError } from "./transition-failure.ts";

import type { PlanFrontMatter } from "../../plan-store.js";
import type { RecoveryWorktreeContext } from "./plan-session-types.ts";
import type { RecoveryActionContext, RecoveryActionOutcome } from "./plan-recovery-actions.ts";
import type { HandlePlanRecoveryOptions } from "./plan-recovery-flow.ts";

export interface ResetRecoveryCapabilities {
    gitRecoveryBlocked: boolean;
    gitState: string;
    loadPlan: HandlePlanRecoveryOptions["loadPlan"];
    updatePlanFrontMatter: HandlePlanRecoveryOptions["updatePlanFrontMatter"];
    updateWorktreeRegistryEntry: HandlePlanRecoveryOptions["updateWorktreeRegistryEntry"];
    restoreWorktreeTree: HandlePlanRecoveryOptions["restoreWorktreeTree"];
    removeWorktreeGitArtifacts: HandlePlanRecoveryOptions["removeWorktreeGitArtifacts"];
    createWorktreeGitArtifacts: HandlePlanRecoveryOptions["createWorktreeGitArtifacts"];
    settleWorktreeAttempt: HandlePlanRecoveryOptions["settleWorktreeAttempt"];
    recordPlanEvent: HandlePlanRecoveryOptions["recordPlanEvent"];
    executePlan: HandlePlanRecoveryOptions["executePlan"];
    runPlanningAgent: HandlePlanRecoveryOptions["runPlanningAgent"];
    decidePostPlanning: HandlePlanRecoveryOptions["decidePostPlanning"];
    decidePostExecution: HandlePlanRecoveryOptions["decidePostExecution"];
    runValidationLoop: HandlePlanRecoveryOptions["runValidationLoop"];
    listCommitsTouchingPathsSince: HandlePlanRecoveryOptions["listCommitsTouchingPathsSince"];
    finalizePlanImplementation: HandlePlanRecoveryOptions["finalizePlanImplementation"];
    resolveValidationExecutionContextForRecovery:
        HandlePlanRecoveryOptions["resolveValidationExecutionContextForRecovery"];
}

export async function resetRecoveryPlan(
    context: RecoveryActionContext,
    capabilities: ResetRecoveryCapabilities,
): Promise<RecoveryActionOutcome> {
    const { projectRoot, plan, uiAPI } = context;
    const hasWorktree = hasWorktreeContext(context.worktreeContext);
    if (!hasWorktree && !plan.attrs.executionBaselineTree) {
        uiAPI.appendSystemMessage(
            "Cannot reset this plan because no execution baseline tree is recorded.",
            true,
            "RunWield",
        );
        return { kind: "menu" };
    }
    if (capabilities.gitRecoveryBlocked) {
        if (!(await confirmMetadataOnlyRecoveryCleanup(plan.planName, uiAPI))) {
            return { kind: "menu" };
        }
        const transition = await runRecoveryTransition({
            projectRoot,
            planName: plan.planName,
            planId: plan.attrs.planId,
            worktreeId: context.worktreeContext?.id,
            expectedRevision: plan.revision,
            action: "reset",
            recover: async ({ beforePlan }) => {
                if (context.worktreeContext?.id) {
                    await capabilities.updateWorktreeRegistryEntry(projectRoot, context.worktreeContext.id, {
                        status: "abandoned",
                    });
                }
                const resetUpdates = buildPlanEventUpdates("recovery_reset", plan.attrs.status, {
                    triageMeta: plan.attrs,
                });
                return await capabilities.updatePlanFrontMatter(
                    projectRoot,
                    plan.planName,
                    {
                        ...resetUpdates,
                        status: "ready_for_work",
                        executionBaselineTree: null,
                        worktreeId: null,
                        worktreePath: null,
                        worktreeBranch: null,
                        worktreeBaseBranch: null,
                        worktreeStatus: null,
                    },
                    plan.attrs,
                    { expectedRevision: beforePlan?.revision },
                );
            },
        });
        if (transition.status !== "committed") {
            throw transitionFailureError(transition, `Recovery reset transaction failed for ${plan.planName}.`);
        }
        const transitionValue = (transition.value || {}) as { value?: PlanFrontMatter };
        plan.attrs = transitionValue.value as PlanFrontMatter;
        context.worktreeContext = null;
        uiAPI.appendSystemMessage(
            "Cleared stale Git recovery metadata. No project files or recorded paths were modified; the plan is ready for work.",
            false,
            "RunWield",
        );
        await context.recordRecoveryResult("reset", "metadata_only", { gitState: capabilities.gitState });
        return { kind: "handled" };
    }
    if (hasWorktree) {
        const recreated = await recreateRecoveryWorktree(context, capabilities);
        if (!recreated) {
            return { kind: "menu" };
        }
        context.worktreeContext = recreated;
    } else {
        if (!(await confirmBaselineReset(plan.planName, uiAPI))) {
            return { kind: "menu" };
        }
        try {
            await capabilities.restoreWorktreeTree(projectRoot, plan.attrs.executionBaselineTree as string);
        } catch (error) {
            const message = isGitRepositoryRequiredError(error)
                ? formatGitRequiredMessage(error)
                : error instanceof Error
                ? error.message
                : String(error);
            uiAPI.appendSystemMessage(`Cannot reset baseline tree: ${message}`, true, "RunWield");
            return { kind: "menu" };
        }
    }
    const resetTransition = await runRecoveryTransition({
        projectRoot,
        planName: plan.planName,
        planId: plan.attrs.planId,
        worktreeId: context.worktreeContext?.id,
        expectedRevision: plan.revision,
        action: "reset",
        recover: async () =>
            await capabilities.recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "recovery_reset",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            }),
    });
    if (resetTransition.status !== "committed") {
        throw transitionFailureError(resetTransition, `Recovery reset transaction failed for ${plan.planName}.`);
    }
    const resetTransitionValue = (resetTransition.value || {}) as { value?: PlanFrontMatter };
    plan.attrs = { ...plan.attrs, ...resetTransitionValue.value, status: "ready_for_work" };
    await executeReadyPlanWithRepair({
        projectRoot,
        plan,
        agentName: context.agentName,
        uiAPI,
        executePlan: capabilities.executePlan,
        runPlanningAgent: capabilities.runPlanningAgent,
        decidePostPlanning: capabilities.decidePostPlanning,
        decidePostExecution: capabilities.decidePostExecution,
        runValidationLoop: capabilities.runValidationLoop,
        loadPlan: capabilities.loadPlan,
        listCommitsTouchingPathsSince: capabilities.listCommitsTouchingPathsSince,
        session: context.session,
        finalizePlanImplementation: capabilities.finalizePlanImplementation,
        recordPlanEvent: capabilities.recordPlanEvent,
        resolveValidationExecutionContextForRecovery: capabilities.resolveValidationExecutionContextForRecovery,
    });
    await context.recordRecoveryResult("reset", "handled");
    return { kind: "handled" };
}

async function recreateRecoveryWorktree(
    context: RecoveryActionContext,
    capabilities: ResetRecoveryCapabilities,
): Promise<RecoveryWorktreeContext | null> {
    const { projectRoot, plan, uiAPI } = context;
    const worktreeContext = context.worktreeContext;
    const recreateBaseRef = getRecordedWorktreeRecreateBase(worktreeContext);
    if (!recreateBaseRef) {
        uiAPI.appendSystemMessage(
            "Cannot recreate this worktree because no recorded base commit or base ref is available. Retry Workflow Validation or re-open the plan for review instead of recreating from the primary checkout.",
            true,
            "RunWield",
        );
        return null;
    }
    const recordedPathExists = await pathExists(worktreeContext?.path);
    const confirmed = recordedPathExists
        ? await confirmWorktreeAction(plan.planName, uiAPI, "Delete/recreate")
        : await confirmMissingWorktreeRecreate(plan.planName, worktreeContext, uiAPI);
    if (!confirmed) {
        return null;
    }
    const recreateBaseBranch = worktreeContext?.baseBranch;
    try {
        const transition = await runRecoveryTransition({
            projectRoot,
            planName: plan.planName,
            planId: plan.attrs.planId,
            worktreeId: worktreeContext?.id,
            expectedRevision: plan.revision,
            action: "recreate",
            recover: async ({ beforePlan, markEffect, registerRollback }) => {
                if (worktreeContext?.path) {
                    await capabilities.removeWorktreeGitArtifacts({
                        projectRoot,
                        path: worktreeContext.path,
                        force: true,
                    });
                    if (worktreeContext.branch) {
                        await deleteMergedWorktreeBranch({ projectRoot, branch: worktreeContext.branch });
                    }
                }
                if (worktreeContext?.id) {
                    await capabilities.updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, {
                        status: "abandoned",
                    });
                }
                const nextWorktree = await capabilities.createWorktreeGitArtifacts({
                    projectRoot,
                    planName: plan.planName,
                    planId: plan.attrs.planId as string,
                    baseRef: recreateBaseRef,
                    baseBranch: recreateBaseBranch,
                });
                await markEffect("recovery_recreate_git_worktree_created", {
                    worktreeId: nextWorktree.id,
                    path: nextWorktree.path,
                    branch: nextWorktree.branch,
                    baseCommit: nextWorktree.baseCommit,
                });
                registerRollback("remove recreated recovery worktree", async () => {
                    await capabilities.removeWorktreeGitArtifacts({
                        projectRoot,
                        path: nextWorktree.path,
                        force: true,
                    });
                    if (nextWorktree.branch) {
                        await deleteMergedWorktreeBranch({ projectRoot, branch: nextWorktree.branch });
                    }
                });
                await capabilities.settleWorktreeAttempt(projectRoot, nextWorktree);
                registerRollback("abandon recreated recovery registry entry", async () => {
                    await capabilities.updateWorktreeRegistryEntry(projectRoot, nextWorktree.id, {
                        status: "abandoned",
                    });
                });
                await markEffect("recovery_recreate_registry_settled", {
                    worktreeId: nextWorktree.id,
                    path: nextWorktree.path,
                    branch: nextWorktree.branch,
                });
                const attrs = await capabilities.updatePlanFrontMatter(
                    projectRoot,
                    plan.planName,
                    {
                        worktreeId: nextWorktree.id,
                        worktreePath: nextWorktree.path,
                        worktreeBranch: nextWorktree.branch,
                        worktreeBaseBranch: nextWorktree.baseBranch,
                        worktreeStatus: "active",
                        executionBaselineTree: nextWorktree.baseTree,
                    },
                    plan.attrs,
                    { expectedRevision: beforePlan?.revision },
                );
                return { attrs, worktree: nextWorktree };
            },
        });
        if (transition.status !== "committed") {
            throw new Error(transition.message || `Recovery recreate transaction failed for ${plan.planName}.`);
        }
        const transitionValue = (transition.value || {}) as {
            value?: { attrs: PlanFrontMatter; worktree: RecoveryWorktreeContext };
        };
        plan.attrs = transitionValue.value?.attrs as PlanFrontMatter;
        const recreated = transitionValue.value?.worktree;
        if (!recreated) {
            throw new Error(`Recovery recreate transaction returned no worktree for ${plan.planName}.`);
        }
        const refreshedPlan = await capabilities.loadPlan(projectRoot, plan.planName);
        if (refreshedPlan?.revision) {
            plan.attrs = refreshedPlan.attrs;
            plan.revision = refreshedPlan.revision;
        }
        return {
            id: recreated.id,
            path: recreated.path,
            branch: recreated.branch,
            baseBranch: recreated.baseBranch,
            status: recreated.status,
            baseRef: recreated.baseRef,
            baseCommit: recreated.baseCommit,
            baseTree: recreated.baseTree,
        };
    } catch (error) {
        const message = isGitRepositoryRequiredError(error)
            ? formatGitRequiredMessage(error)
            : error instanceof Error
            ? error.message
            : String(error);
        uiAPI.appendSystemMessage(`Cannot recreate the recorded worktree: ${message}`, true, "RunWield");
        return null;
    }
}
