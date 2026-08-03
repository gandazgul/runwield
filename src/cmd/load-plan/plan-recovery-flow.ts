/**
 * @module cmd/load-plan/plan-recovery-flow
 * The Plan Recovery menu coordinator for in-progress, failed, and implemented Plans.
 */

import {
    findPlansByParent as findPlansByParentFn,
    loadPlan as loadPlanFn,
    resolvePlanExecutionPolicy,
    updatePlanFrontMatter as updatePlanFrontMatterFn,
} from "../../plan-store.js";
import { probeGitRepository as probeGitRepositoryFn } from "../../shared/git.js";
import { shouldCleanupMergedWorktrees as shouldCleanupMergedWorktreesFn } from "../../shared/settings.js";
import {
    isInValidation,
    recordPlanEvent as recordPlanEventFn,
    stageValidationPassedInExecutionWorktree as stageValidationPassedInExecutionWorktreeFn,
} from "../../shared/workflow/plan-lifecycle.js";
import {
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
} from "../../shared/workflow/decisions.js";
import { finalizePlanImplementation as finalizePlanImplementationFn } from "../../shared/workflow/workflow.js";
import {
    getWorkflowDiff as getWorkflowDiffFn,
    listCommitsTouchingPathsSince as listCommitsTouchingPathsSinceFn,
    restoreWorktreeTree as restoreWorktreeTreeFn,
} from "../../shared/workflow/git-snapshot.js";
import { resolveValidationExecutionContext } from "../../shared/workflow/execution-context.ts";
import { recordWorkflowMetric } from "../../shared/workflow/metrics.js";
import { autoGenerateWorkRecordForCompletedPlan as autoGenerateWorkRecordForCompletedPlanFn } from "../../shared/work-records/auto-generation.js";
import {
    checkpointExecutionWorktree,
    createWorktreeGitArtifacts,
    deleteMergedWorktreeBranch,
    getBranchHead,
    getWorktreeStatus as getWorktreeStatusFn,
    isCommitAncestorOfBranch,
    mergeExecutionWorktree as mergeExecutionWorktreeFn,
    preparePrimaryPlanPathForMerge as preparePrimaryPlanPathForMergeFn,
    removeWorktreeGitArtifacts as removeWorktreeGitArtifactsFn,
    restorePrimaryPlanPathAfterMergeFailure as restorePrimaryPlanPathAfterMergeFailureFn,
    settleWorktreeAttempt,
} from "../../shared/worktree.js";
import {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
    removeEntry as removeWorktreeRegistryEntryFn,
    updateEntry as updateWorktreeRegistryEntryFn,
} from "../../shared/worktree-registry.js";
import {
    canManuallyMergeRecoveredWorktree,
    hasWorktreeContext,
    persistRecoveredWorktreeMetadata,
    reportInvalidRecoveryPolicy,
    resolveRecoveryWorktree,
} from "./plan-recovery-worktree.ts";
import {
    abandonRecoveryPlan,
    continueRecoveryPlan,
    holdRecoveryPlan,
    inspectRecoveryPlan,
    reviewRecoveryPlan,
    settleRecoveryRecords,
    userVerifyRecoveryPlan,
    validateRecoveryPlan,
} from "./plan-recovery-actions.ts";
import { resetRecoveryPlan } from "./plan-recovery-reset.ts";
import { mergeRecoveredWorktree } from "./plan-recovery-merge.ts";

import type { PlanSessionSurface } from "./plan-session-types.ts";
import type { PlanFrontMatter } from "../../plan-store.js";
import type { UiAPI } from "../../ui/tui/types.js";
import type {
    RecoveryActionContext,
    RecoveryActionName,
    RecoveryActionOutcome,
    RecoveryMetricDetails,
} from "./plan-recovery-actions.ts";

export interface RecoveryFlowPlan {
    planName: string;
    revision?: string;
    path: string;
    markdown: string;
    body: string;
    attrs: PlanFrontMatter;
}

export interface UnresolvedTransitionRecord {
    transitionId?: string;
    operation?: string;
    reason?: string;
}

export interface HandlePlanRecoveryOptions {
    projectRoot: string;
    plan: RecoveryFlowPlan;
    agentName: string;
    uiAPI: UiAPI;
    unresolvedRecords?: UnresolvedTransitionRecord[];
    executePlan: PlanSessionSurface["executePlan"];
    runPlanningAgent: PlanSessionSurface["runPlanningAgent"];
    decidePostPlanning: typeof decidePostPlanningFn;
    decidePostExecution: typeof decidePostExecutionFn;
    runValidationLoop: PlanSessionSurface["runValidation"];
    loadPlan: typeof loadPlanFn;
    getWorkflowDiff: typeof getWorkflowDiffFn;
    listCommitsTouchingPathsSince: typeof listCommitsTouchingPathsSinceFn;
    restoreWorktreeTree: typeof restoreWorktreeTreeFn;
    recordPlanEvent: typeof recordPlanEventFn;
    stageValidationPassedInExecutionWorktree: typeof stageValidationPassedInExecutionWorktreeFn;
    updatePlanFrontMatter: typeof updatePlanFrontMatterFn;
    findWorktreeById: typeof findWorktreeByIdFn;
    findWorktreeByPlanName: typeof findWorktreeByPlanNameFn;
    updateWorktreeRegistryEntry: typeof updateWorktreeRegistryEntryFn;
    getWorktreeStatus: typeof getWorktreeStatusFn;
    createWorktreeGitArtifacts: typeof createWorktreeGitArtifacts;
    settleWorktreeAttempt: typeof settleWorktreeAttempt;
    mergeExecutionWorktree: typeof mergeExecutionWorktreeFn;
    checkpointExecutionWorktree: typeof checkpointExecutionWorktree;
    getBranchHead: typeof getBranchHead;
    isCommitAncestorOfBranch: typeof isCommitAncestorOfBranch;
    preparePrimaryPlanPathForMerge: typeof preparePrimaryPlanPathForMergeFn;
    restorePrimaryPlanPathAfterMergeFailure: typeof restorePrimaryPlanPathAfterMergeFailureFn;
    removeWorktreeGitArtifacts: typeof removeWorktreeGitArtifactsFn;
    removeWorktreeRegistryEntry: typeof removeWorktreeRegistryEntryFn;
    shouldCleanupMergedWorktrees: typeof shouldCleanupMergedWorktreesFn;
    findPlansByParent: typeof findPlansByParentFn;
    session: PlanSessionSurface;
    recordWorkflowMetric?: typeof recordWorkflowMetric;
    probeGitRepository?: typeof probeGitRepositoryFn;
    finalizePlanImplementation?: typeof finalizePlanImplementationFn;
    resolveValidationExecutionContextForRecovery?: typeof resolveValidationExecutionContext;
    autoGenerateWorkRecordForCompletedPlan?: typeof autoGenerateWorkRecordForCompletedPlanFn;
}

type RecoveryMenuAnswer = RecoveryActionName | "cancel";

interface RecoveryMenuOption extends Record<string, string> {
    value: RecoveryMenuAnswer;
    label: string;
}

export async function handlePlanRecovery(opts: HandlePlanRecoveryOptions): Promise<"handled" | "review"> {
    const { projectRoot, plan, uiAPI } = opts;
    const initialPolicy = resolvePlanExecutionPolicy(plan.attrs);
    const loadedWorktreeId = plan.attrs.worktreeId;
    if (!initialPolicy.ok && initialPolicy.reason !== "project_epic") {
        reportInvalidRecoveryPolicy("recover", plan.planName, initialPolicy.error, uiAPI);
        return "handled";
    }

    const context: RecoveryActionContext = {
        projectRoot,
        plan,
        agentName: opts.agentName,
        uiAPI,
        session: opts.session,
        loadedWorktreeId,
        worktreeContext: null,
        unresolvedRecords: opts.unresolvedRecords ?? [],
        refreshRecoveryWorktree: () => Promise.resolve(null),
        recordRecoveryResult: async () => {},
    };
    context.refreshRecoveryWorktree = async () => {
        const resolved = await resolveRecoveryWorktree(projectRoot, plan, {
            findWorktreeById: opts.findWorktreeById,
            findWorktreeByPlanName: opts.findWorktreeByPlanName,
        });
        plan.attrs = await persistRecoveredWorktreeMetadata(projectRoot, plan, resolved);
        context.worktreeContext = resolved;
        return resolved;
    };
    context.recordRecoveryResult = async (action: string, result: string, details: RecoveryMetricDetails = {}) => {
        const hasWorktree = hasWorktreeContext(context.worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(context.worktreeContext);
        await (opts.recordWorkflowMetric ?? recordWorkflowMetric)({
            category: "recovery",
            event: "recovery_action_result",
            planName: plan.planName,
            details: { action, result, currentStatus: plan.attrs.status, hasWorktree, canMergeWorktree, ...details },
        });
    };
    context.worktreeContext = await context.refreshRecoveryWorktree();

    while (true) {
        const hasWorktree = hasWorktreeContext(context.worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(context.worktreeContext);
        const gitProbe = await (opts.probeGitRepository ?? probeGitRepositoryFn)(projectRoot);
        const hasGitRecoveryMetadata = hasWorktree ||
            (plan.attrs.executionMode !== "non_git_in_place" && Boolean(plan.attrs.executionBaselineTree));
        const gitRecoveryBlocked = !gitProbe.ok && hasGitRecoveryMetadata;
        const answer = await promptRecoveryAction(context, gitRecoveryBlocked, hasWorktree, canMergeWorktree);
        await (opts.recordWorkflowMetric ?? recordWorkflowMetric)({
            category: "recovery",
            event: "recovery_action_selected",
            planName: plan.planName,
            details: { action: answer || "cancel", currentStatus: plan.attrs.status, hasWorktree, canMergeWorktree },
        });
        if (!answer || answer === "cancel") {
            await context.recordRecoveryResult("cancel", "handled");
            return "handled";
        }
        const outcome = await dispatchRecoveryAction(answer, context, opts, gitRecoveryBlocked, gitProbe.state);
        const terminal = translateRecoveryOutcome(outcome);
        if (terminal) {
            return terminal;
        }
    }
}

async function promptRecoveryAction(
    context: RecoveryActionContext,
    gitRecoveryBlocked: boolean,
    hasWorktree: boolean,
    canMergeWorktree: boolean,
): Promise<RecoveryMenuAnswer | null | undefined> {
    const resetLabel = gitRecoveryBlocked
        ? "Clear stale Git recovery metadata"
        : hasWorktree
        ? "Delete/recreate worktree and start over"
        : "Reset tree and start over";
    const recordOptions: RecoveryMenuOption[] = context.unresolvedRecords.length > 0
        ? [{
            value: "settle_records",
            label: `Close ${
                context.unresolvedRecords.length === 1
                    ? "the unfinished lifecycle record"
                    : "unfinished lifecycle records"
            } (you confirm the state)`,
        }]
        : [];
    const common: RecoveryMenuOption[] = [
        { value: "inspect", label: "Inspect and report current state" },
        { value: "reset", label: resetLabel },
        ...(hasWorktree ? [{ value: "abandon" as const, label: "Delete/abandon worktree" }] : []),
        { value: "review", label: "Re-open for review" },
        { value: "user_verify", label: "Mark as User Verified (user attestation; no Workflow Validation claim)" },
        { value: "hold", label: "Put on hold" },
        { value: "cancel", label: "Cancel" },
    ];
    const options = isInValidation(context.plan.attrs.status)
        ? [
            ...recordOptions,
            ...(gitRecoveryBlocked ? [] : [{ value: "validate" as const, label: "Retry Workflow Validation" }]),
            common[0],
            ...(canMergeWorktree && !gitRecoveryBlocked
                ? [{ value: "merge" as const, label: "Merge validated worktree changes" }]
                : []),
            ...common.slice(1),
        ]
        : [
            ...recordOptions,
            common[0],
            ...(gitRecoveryBlocked
                ? []
                : [{ value: "continue" as const, label: "Continue execution from current worktree" }]),
            ...common.slice(1),
        ];
    const answer = await context.uiAPI.promptSelect(`Plan recovery (${context.plan.attrs.status}):`, options);
    return answer as RecoveryMenuAnswer | null;
}

async function dispatchRecoveryAction(
    action: RecoveryActionName,
    context: RecoveryActionContext,
    opts: HandlePlanRecoveryOptions,
    gitRecoveryBlocked: boolean,
    gitState: string,
): Promise<RecoveryActionOutcome> {
    if (gitRecoveryBlocked && ["continue", "validate", "merge"].includes(action)) {
        context.uiAPI.appendSystemMessage(
            `Cannot ${action} this Plan recovery state because Git is not available for the project. Git is required for recorded Worktree/baseline recovery operations. Use metadata-only reset or abandon cleanup, or initialize Git and try again.`,
            true,
            "RunWield",
        );
        await context.recordRecoveryResult(action, "blocked", { gitState });
        return { kind: "menu" };
    }
    switch (action) {
        case "settle_records":
            return await settleRecoveryRecords(context);
        case "hold":
            return await holdRecoveryPlan(context, {
                recordPlanEvent: opts.recordPlanEvent,
                findPlansByParent: opts.findPlansByParent,
            });
        case "user_verify":
            return await userVerifyRecoveryPlan(context, {
                recordPlanEvent: opts.recordPlanEvent,
                autoGenerateWorkRecordForCompletedPlan: opts.autoGenerateWorkRecordForCompletedPlan ??
                    autoGenerateWorkRecordForCompletedPlanFn,
            });
        case "inspect":
            return await inspectRecoveryPlan(context, {
                getWorkflowDiff: opts.getWorkflowDiff,
                getWorktreeStatus: opts.getWorktreeStatus,
            });
        case "validate":
            return await validateRecoveryPlan(context, {
                getWorktreeStatus: opts.getWorktreeStatus,
                runValidationLoop: opts.runValidationLoop,
                loadPlan: opts.loadPlan,
                finalizePlanImplementation: opts.finalizePlanImplementation ?? finalizePlanImplementationFn,
                recordPlanEvent: opts.recordPlanEvent,
                resolveValidationExecutionContextForRecovery: opts.resolveValidationExecutionContextForRecovery ??
                    resolveValidationExecutionContext,
            });
        case "continue":
            return await continueRecoveryPlan(context, {
                getWorktreeStatus: opts.getWorktreeStatus,
                executePlan: opts.executePlan,
                runPlanningAgent: opts.runPlanningAgent,
                decidePostPlanning: opts.decidePostPlanning,
                decidePostExecution: opts.decidePostExecution,
                runValidationLoop: opts.runValidationLoop,
                loadPlan: opts.loadPlan,
                listCommitsTouchingPathsSince: opts.listCommitsTouchingPathsSince,
                finalizePlanImplementation: opts.finalizePlanImplementation ?? finalizePlanImplementationFn,
                recordPlanEvent: opts.recordPlanEvent,
                resolveValidationExecutionContextForRecovery: opts.resolveValidationExecutionContextForRecovery ??
                    resolveValidationExecutionContext,
            });
        case "abandon":
            return await abandonRecoveryPlan(context, {
                updateWorktreeRegistryEntry: opts.updateWorktreeRegistryEntry,
                updatePlanFrontMatter: opts.updatePlanFrontMatter,
                removeWorktreeGitArtifacts: opts.removeWorktreeGitArtifacts,
                deleteMergedWorktreeBranch,
            });
        case "review":
            return await reviewRecoveryPlan(context, {
                findWorktreeById: opts.findWorktreeById,
                findWorktreeByPlanName: opts.findWorktreeByPlanName,
                updateWorktreeRegistryEntry: opts.updateWorktreeRegistryEntry,
                updatePlanFrontMatter: opts.updatePlanFrontMatter,
                recordPlanEvent: opts.recordPlanEvent,
            });
        case "reset":
            return await resetRecoveryPlan(context, {
                gitRecoveryBlocked,
                gitState,
                loadPlan: opts.loadPlan,
                updatePlanFrontMatter: opts.updatePlanFrontMatter,
                updateWorktreeRegistryEntry: opts.updateWorktreeRegistryEntry,
                restoreWorktreeTree: opts.restoreWorktreeTree,
                removeWorktreeGitArtifacts: opts.removeWorktreeGitArtifacts,
                createWorktreeGitArtifacts: opts.createWorktreeGitArtifacts,
                settleWorktreeAttempt: opts.settleWorktreeAttempt,
                recordPlanEvent: opts.recordPlanEvent,
                executePlan: opts.executePlan,
                runPlanningAgent: opts.runPlanningAgent,
                decidePostPlanning: opts.decidePostPlanning,
                decidePostExecution: opts.decidePostExecution,
                runValidationLoop: opts.runValidationLoop,
                listCommitsTouchingPathsSince: opts.listCommitsTouchingPathsSince,
                finalizePlanImplementation: opts.finalizePlanImplementation ?? finalizePlanImplementationFn,
                resolveValidationExecutionContextForRecovery: opts.resolveValidationExecutionContextForRecovery ??
                    resolveValidationExecutionContext,
            });
        case "merge":
            return await mergeRecoveredWorktree(context, {
                getWorktreeStatus: opts.getWorktreeStatus,
                resolveValidationExecutionContextForRecovery: opts.resolveValidationExecutionContextForRecovery ??
                    resolveValidationExecutionContext,
                shouldCleanupMergedWorktrees: opts.shouldCleanupMergedWorktrees,
                findPlansByParent: opts.findPlansByParent,
                loadPlan: opts.loadPlan,
                checkpointExecutionWorktree: opts.checkpointExecutionWorktree,
                getBranchHead: opts.getBranchHead,
                preparePrimaryPlanPathForMerge: opts.preparePrimaryPlanPathForMerge,
                mergeExecutionWorktree: opts.mergeExecutionWorktree,
                isCommitAncestorOfBranch: opts.isCommitAncestorOfBranch,
                updateWorktreeRegistryEntry: opts.updateWorktreeRegistryEntry,
                restorePrimaryPlanPathAfterMergeFailure: opts.restorePrimaryPlanPathAfterMergeFailure,
                removeWorktreeGitArtifacts: opts.removeWorktreeGitArtifacts,
                removeWorktreeRegistryEntry: opts.removeWorktreeRegistryEntry,
                recordPlanEvent: opts.recordPlanEvent,
            });
    }
}

function translateRecoveryOutcome(outcome: RecoveryActionOutcome): "handled" | "review" | null {
    switch (outcome.kind) {
        case "menu":
            return null;
        case "handled":
            return "handled";
        case "review":
            return "review";
    }
}
