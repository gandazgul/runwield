/**
 * @module cmd/load-plan/plan-recovery-flow
 * The Plan Recovery menu for in-progress, failed, and implemented Plans.
 *
 * Every branch here is destructive or close to it — resetting a baseline,
 * abandoning a worktree, publishing a merge by hand — so each one confirms
 * first and runs inside a transaction that can be rolled back or replayed.
 */

import { resolvePlanExecutionPolicy, updatePlanFrontMatter as updatePlanFrontMatterFn } from "../../plan-store.js";
import { loadPlan as loadPlanFn } from "../../plan-store.js";
import {
    formatGitRequiredMessage,
    isGitRepositoryRequiredError,
    probeGitRepository as probeGitRepositoryFn,
} from "../../shared/git.js";
import { shouldCleanupMergedWorktrees as shouldCleanupMergedWorktreesFn } from "../../shared/settings.js";
import {
    buildPlanEventUpdates,
    isInValidation,
    recordPlanEvent as recordPlanEventFn,
    stageValidationPassedInExecutionWorktree as stageValidationPassedInExecutionWorktreeFn,
} from "../../shared/workflow/plan-lifecycle.js";
import { findPlansByParent as findPlansByParentFn } from "../../plan-store.js";
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
import {
    closeTransitionRecordByAttestation,
    getTransitionJournalDir,
    runDirectDeliveryPublicationTransition,
    runRecoveryTransition,
} from "../../shared/workflow/state-transition.ts";
import { healSettledTransitionRecords } from "../../shared/workflow/transition-recovery.ts";
import {
    autoGenerateWorkRecordForCompletedPlan as autoGenerateWorkRecordForCompletedPlanFn,
} from "../../shared/work-records/auto-generation.js";
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
    appendRecoveryReport,
    canManuallyMergeRecoveredWorktree,
    confirmBaselineReset,
    confirmMetadataOnlyRecoveryCleanup,
    confirmMissingWorktreeRecreate,
    confirmRecoveryWorktreeAvailable,
    confirmWorktreeAction,
    getRecordedWorktreeRecreateBase,
    hasWorktreeContext,
    pathExists,
    persistRecoveredWorktreeMetadata,
    rehydrateActiveRecoveryWorkflow,
    reopenPlanForReview,
    reportInvalidRecoveryPolicy,
    resolveRecoveryWorktree,
} from "./plan-recovery-worktree.ts";
import { executeReadyPlanWithRepair, validateCompletedExecution } from "./plan-execution.ts";
import { markPlanUserVerified, putPlanOnHold } from "./plan-hold.ts";
import { transitionFailureError } from "./transition-failure.ts";

import type { PlanFrontMatter, WorktreeDeliveryEvidence } from "../../plan-store.js";
import type { UiAPI } from "../../ui/tui/types.js";
import type { PlanSessionSurface, RecoveryWorktreeContext } from "./plan-session-types.ts";

/** The Plan being recovered, loaded with its path and body. */
export interface RecoveryFlowPlan {
    planName: string;
    revision?: string;
    path: string;
    markdown: string;
    body: string;
    attrs: PlanFrontMatter;
}

/** A staged Plan path in the primary checkout, kept so a failed merge can undo it. */
export type PrimaryPlanSnapshot = Awaited<ReturnType<typeof preparePrimaryPlanPathForMergeFn>>;

/** A lifecycle record RunWield could not prove settled. */
export interface UnresolvedTransitionRecord {
    transitionId?: string;
    operation?: string;
    reason?: string;
}

/**
 * Everything the recovery menu needs.
 *
 * Wide by nature: recovery is the one place that can touch every durable thing
 * a Plan owns, so it is handed each capability explicitly rather than reaching
 * for them.
 */
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

/**
 * Handle Plan Recovery menus for in-progress, failed, and implemented plans.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, path: string, markdown: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {Array<{ transitionId?: string, operation?: string, reason?: string }>} [opts.unresolvedRecords] - Lifecycle records RunWield could not prove; they block every other action until closed.
 * @param {PlanSessionSurface["executePlan"]} opts.executePlan
 * @param {PlanSessionSurface["runPlanningAgent"]} opts.runPlanningAgent
 * @param {typeof decidePostPlanningFn} opts.decidePostPlanning
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {PlanSessionSurface["runValidation"]} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof getWorkflowDiffFn} opts.getWorkflowDiff
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof restoreWorktreeTreeFn} opts.restoreWorktreeTree
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof stageValidationPassedInExecutionWorktreeFn} opts.stageValidationPassedInExecutionWorktree
 * @param {typeof updatePlanFrontMatterFn} opts.updatePlanFrontMatter
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof createWorktreeGitArtifacts} opts.createWorktreeGitArtifacts
 * @param {typeof settleWorktreeAttempt} opts.settleWorktreeAttempt
 * @param {typeof mergeExecutionWorktreeFn} opts.mergeExecutionWorktree
 * @param {typeof checkpointExecutionWorktree} opts.checkpointExecutionWorktree
 * @param {typeof getBranchHead} opts.getBranchHead
 * @param {typeof isCommitAncestorOfBranch} opts.isCommitAncestorOfBranch
 * @param {typeof preparePrimaryPlanPathForMergeFn} opts.preparePrimaryPlanPathForMerge
 * @param {typeof restorePrimaryPlanPathAfterMergeFailureFn} opts.restorePrimaryPlanPathAfterMergeFailure
 * @param {typeof removeWorktreeGitArtifactsFn} opts.removeWorktreeGitArtifacts
 * @param {typeof removeWorktreeRegistryEntryFn} opts.removeWorktreeRegistryEntry
 * @param {typeof shouldCleanupMergedWorktreesFn} opts.shouldCleanupMergedWorktrees
 * @param {typeof recordWorkflowMetric} [opts.recordWorkflowMetric]
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {PlanSessionSurface} opts.session
 * @param {typeof probeGitRepositoryFn} [opts.probeGitRepository]
 * @param {typeof finalizePlanImplementationFn} [opts.finalizePlanImplementation]
 * @param {typeof resolveValidationExecutionContext} [opts.resolveValidationExecutionContextForRecovery]
 * @param {typeof autoGenerateWorkRecordForCompletedPlanFn} [opts.autoGenerateWorkRecordForCompletedPlan]
 * @returns {Promise<"handled" | "review">}
 */
export async function handlePlanRecovery({
    projectRoot,
    plan,
    agentName,
    uiAPI,
    unresolvedRecords: initialUnresolvedRecords = [],
    executePlan,
    runPlanningAgent,
    decidePostPlanning,
    decidePostExecution,
    runValidationLoop,
    loadPlan,
    getWorkflowDiff,
    listCommitsTouchingPathsSince,
    restoreWorktreeTree,
    recordPlanEvent,
    stageValidationPassedInExecutionWorktree,
    updatePlanFrontMatter,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    getWorktreeStatus,
    createWorktreeGitArtifacts,
    settleWorktreeAttempt,
    mergeExecutionWorktree,
    checkpointExecutionWorktree,
    getBranchHead,
    isCommitAncestorOfBranch,
    preparePrimaryPlanPathForMerge,
    restorePrimaryPlanPathAfterMergeFailure,
    removeWorktreeGitArtifacts,
    removeWorktreeRegistryEntry,
    shouldCleanupMergedWorktrees,
    recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric,
    findPlansByParent,
    session,
    probeGitRepository = probeGitRepositoryFn,
    finalizePlanImplementation = finalizePlanImplementationFn,
    resolveValidationExecutionContextForRecovery = resolveValidationExecutionContext,
    autoGenerateWorkRecordForCompletedPlan = autoGenerateWorkRecordForCompletedPlanFn,
}: HandlePlanRecoveryOptions): Promise<"handled" | "review"> {
    const initialPolicy = resolvePlanExecutionPolicy(plan.attrs);
    const loadedWorktreeId = plan.attrs.worktreeId;
    if (!initialPolicy.ok && initialPolicy.reason !== "project_epic") {
        reportInvalidRecoveryPolicy("recover", plan.planName, initialPolicy.error, uiAPI);
        return "handled";
    }

    const refreshRecoveryWorktree = async () => {
        const resolved = await resolveRecoveryWorktree(projectRoot, plan, { findWorktreeById, findWorktreeByPlanName });
        plan.attrs = await persistRecoveredWorktreeMetadata(projectRoot, plan, resolved);
        return resolved;
    };
    let worktreeContext = await refreshRecoveryWorktree();
    /** @type {Array<{ transitionId?: string, operation?: string, reason?: string }>} */
    let unresolvedRecords = initialUnresolvedRecords;
    /**
     * @param {string} action
     * @param {string} result
     * @param {Record<string, unknown>} [details]
     */
    const recordRecoveryResult = async (
        action: string,
        result: string,
        details: Record<string, unknown> = {},
    ) => {
        const hasWorktree = hasWorktreeContext(worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(worktreeContext);
        await recordWorkflowMetricImpl({
            category: "recovery",
            event: "recovery_action_result",
            planName: plan.planName,
            details: { action, result, currentStatus: plan.attrs.status, hasWorktree, canMergeWorktree, ...details },
        });
    };
    while (true) {
        const hasWorktree = hasWorktreeContext(worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(worktreeContext);
        const gitProbe = await probeGitRepository(projectRoot);
        const hasGitRecoveryMetadata = hasWorktree ||
            (plan.attrs.executionMode !== "non_git_in_place" && Boolean(plan.attrs.executionBaselineTree));
        const gitRecoveryBlocked = !gitProbe.ok && hasGitRecoveryMetadata;
        const resetLabel = gitRecoveryBlocked
            ? "Clear stale Git recovery metadata"
            : hasWorktree
            ? "Delete/recreate worktree and start over"
            : "Reset tree and start over";
        // A Plan whose only problem is an unprovable record must not be offered the
        // ordinary actions first: every one of them re-hits the same block, so the
        // user loops. Lead with the thing that clears it.
        const recordOptions = unresolvedRecords.length > 0
            ? [{
                value: "settle_records",
                label: `Close ${
                    unresolvedRecords.length === 1 ? "the unfinished lifecycle record" : "unfinished lifecycle records"
                } (you confirm the state)`,
            }]
            : [];
        const options = isInValidation(plan.attrs.status)
            ? [
                ...recordOptions,
                ...(gitRecoveryBlocked ? [] : [{ value: "validate", label: "Retry Workflow Validation" }]),
                { value: "inspect", label: "Inspect and report current state" },
                ...(canMergeWorktree && !gitRecoveryBlocked
                    ? [{ value: "merge", label: "Merge validated worktree changes" }]
                    : []),
                { value: "reset", label: resetLabel },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                {
                    value: "user_verify",
                    label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                },
                { value: "hold", label: "Put on hold" },
                { value: "cancel", label: "Cancel" },
            ]
            : [
                ...recordOptions,
                { value: "inspect", label: "Inspect and report current state" },
                ...(gitRecoveryBlocked
                    ? []
                    : [{ value: "continue", label: "Continue execution from current worktree" }]),
                { value: "reset", label: resetLabel },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                {
                    value: "user_verify",
                    label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                },
                { value: "hold", label: "Put on hold" },
                { value: "cancel", label: "Cancel" },
            ];

        const answer = await uiAPI.promptSelect(`Plan recovery (${plan.attrs.status}):`, options);
        await recordWorkflowMetricImpl({
            category: "recovery",
            event: "recovery_action_selected",
            planName: plan.planName,
            details: {
                action: answer || "cancel",
                currentStatus: plan.attrs.status,
                hasWorktree,
                canMergeWorktree,
            },
        });
        if (!answer || answer === "cancel") {
            await recordRecoveryResult("cancel", "handled");
            return "handled";
        }

        if (answer === "settle_records") {
            // Try proof one more time first: the blocker may have been a worktree that
            // has since been restored, and RunWield should never ask the user to vouch
            // for something it can now check itself.
            const recheck = await healSettledTransitionRecords(projectRoot, { planName: plan.planName, apply: true })
                .catch(() => null);
            unresolvedRecords = recheck ? recheck.remaining : unresolvedRecords;
            if (recheck && recheck.closed.length > 0) {
                uiAPI.appendSystemMessage(
                    `Closed ${recheck.closed.length} lifecycle record${
                        recheck.closed.length === 1 ? "" : "s"
                    } that the repository now proves are settled.`,
                    false,
                    "RunWield",
                );
            }
            if (unresolvedRecords.length === 0) {
                await recordRecoveryResult("settle_records", "handled", { byProof: true });
                continue;
            }
            for (const record of unresolvedRecords) {
                uiAPI.appendSystemMessage(
                    `Unfinished ${record.operation || "lifecycle operation"} on ${plan.planName}: ${record.reason}`,
                    false,
                    "RunWield",
                );
            }
            const confirmed = await uiAPI.promptSelect(
                `Close ${unresolvedRecords.length === 1 ? "this record" : "these records"} on your confirmation?`,
                [
                    { value: "no", label: "No, leave them (check the state first)" },
                    { value: "yes", label: "Yes — I have checked the repository and nothing is unpublished" },
                ],
            );
            if (confirmed !== "yes") {
                await recordRecoveryResult("settle_records", "declined");
                continue;
            }
            for (const record of unresolvedRecords) {
                if (!record.transitionId) continue;
                await closeTransitionRecordByAttestation(projectRoot, record.transitionId, {
                    note: `Closed from Plan Recovery for ${plan.planName}.`,
                });
            }
            unresolvedRecords = [];
            uiAPI.appendSystemMessage(
                `Closed on your confirmation. The records were kept, not deleted — they are under ${
                    getTransitionJournalDir(projectRoot)
                }/attested if you need to look back. Lifecycle changes to ${plan.planName} are unblocked.`,
                false,
                "RunWield",
            );
            await recordRecoveryResult("settle_records", "handled", { byAttestation: true });
            continue;
        }

        if (answer === "hold") {
            await putPlanOnHold({ projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent });
            await recordRecoveryResult("hold", "handled");
            return "handled";
        }

        if (answer === "user_verify") {
            await markPlanUserVerified({
                projectRoot,
                plan,
                uiAPI,
                recordPlanEvent,
                autoGenerateWorkRecordForCompletedPlan,
            });
            await recordRecoveryResult("user_verify", "handled");
            return "handled";
        }

        if (gitRecoveryBlocked && ["continue", "validate", "merge"].includes(answer)) {
            uiAPI.appendSystemMessage(
                `Cannot ${answer} this Plan recovery state because Git is not available for the project. Git is required for recorded Worktree/baseline recovery operations. Use metadata-only reset or abandon cleanup, or initialize Git and try again.`,
                true,
                "RunWield",
            );
            await recordRecoveryResult(answer, "blocked", { gitState: gitProbe.state });
            continue;
        }

        if (answer === "inspect") {
            worktreeContext = await refreshRecoveryWorktree();
            await appendRecoveryReport(projectRoot, plan, uiAPI, getWorkflowDiff, worktreeContext, getWorktreeStatus);
            await recordRecoveryResult("inspect", "reported", { hasWorktree: hasWorktreeContext(worktreeContext) });
            continue;
        }

        if (answer === "validate") {
            worktreeContext = await refreshRecoveryWorktree();
            if (
                !(await confirmRecoveryWorktreeAvailable(
                    projectRoot,
                    plan.planName,
                    worktreeContext,
                    uiAPI,
                    getWorktreeStatus,
                ))
            ) {
                continue;
            }
            const validationStarted = await validateCompletedExecution(
                { executionComplete: true },
                plan.planName,
                plan.markdown || plan.body || "",
                plan.attrs,
                runValidationLoop,
                loadPlan,
                worktreeContext,
                session,
                uiAPI,
                finalizePlanImplementation,
                recordPlanEvent,
                resolveValidationExecutionContextForRecovery,
            );
            if (!validationStarted) {
                await recordRecoveryResult("validate", "blocked", { reason: "invalid_execution_policy" });
                continue;
            }
            await recordRecoveryResult("validate", "handled");
            return "handled";
        }

        if (answer === "continue") {
            worktreeContext = await refreshRecoveryWorktree();
            if (
                plan.attrs.executionMode !== "non_git_in_place" &&
                !(await confirmRecoveryWorktreeAvailable(
                    projectRoot,
                    plan.planName,
                    worktreeContext,
                    uiAPI,
                    getWorktreeStatus,
                ))
            ) {
                continue;
            }
            if (
                !(await rehydrateActiveRecoveryWorkflow(projectRoot, plan, worktreeContext, session, uiAPI, "continue"))
            ) {
                await recordRecoveryResult("continue", "blocked", { reason: "invalid_execution_policy" });
                continue;
            }
            await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "recovery_continue",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "ready_for_work";
            await executeReadyPlanWithRepair({
                projectRoot,
                plan,
                agentName,
                uiAPI,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                listCommitsTouchingPathsSince,
                session,
                finalizePlanImplementation,
                recordPlanEvent,
                resolveValidationExecutionContextForRecovery,
            });
            await recordRecoveryResult("continue", "handled");
            return "handled";
        }

        if (answer === "reset") {
            const hasWorktree = hasWorktreeContext(worktreeContext);
            if (!hasWorktree && !plan.attrs.executionBaselineTree) {
                uiAPI.appendSystemMessage(
                    "Cannot reset this plan because no execution baseline tree is recorded.",
                    true,
                    "RunWield",
                );
                continue;
            }
            if (gitRecoveryBlocked) {
                if (!(await confirmMetadataOnlyRecoveryCleanup(plan.planName, uiAPI))) continue;
                const transition = await runRecoveryTransition({
                    projectRoot,
                    planName: plan.planName,
                    planId: plan.attrs.planId,
                    worktreeId: worktreeContext?.id,
                    expectedRevision: plan.revision,
                    action: "reset",
                    recover: async ({ beforePlan }) => {
                        if (worktreeContext?.id) {
                            await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
                        }
                        const resetUpdates = buildPlanEventUpdates("recovery_reset", plan.attrs.status, {
                            triageMeta: plan.attrs,
                        });
                        return await updatePlanFrontMatter(
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
                worktreeContext = null;
                uiAPI.appendSystemMessage(
                    "Cleared stale Git recovery metadata. No project files or recorded paths were modified; the plan is ready for work.",
                    false,
                    "RunWield",
                );
                await recordRecoveryResult("reset", "metadata_only", { gitState: gitProbe.state });
                return "handled";
            }
            if (hasWorktree) {
                const recreateBaseRef = getRecordedWorktreeRecreateBase(worktreeContext);
                if (!recreateBaseRef) {
                    uiAPI.appendSystemMessage(
                        "Cannot recreate this worktree because no recorded base commit or base ref is available. Retry Workflow Validation or re-open the plan for review instead of recreating from the primary checkout.",
                        true,
                        "RunWield",
                    );
                    continue;
                }
                const recordedPathExists = await pathExists(worktreeContext?.path);
                const confirmed = recordedPathExists
                    ? await confirmWorktreeAction(plan.planName, uiAPI, "Delete/recreate")
                    : await confirmMissingWorktreeRecreate(plan.planName, worktreeContext, uiAPI);
                if (!confirmed) continue;
                const recreateBaseBranch = worktreeContext?.baseBranch;
                let recreated;
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
                                await removeWorktreeGitArtifacts({
                                    projectRoot: projectRoot,
                                    path: worktreeContext.path,
                                    force: true,
                                });
                                // Deleting the branch is irreversible, so it is its own proven step.
                                if (worktreeContext.branch) {
                                    await deleteMergedWorktreeBranch({ projectRoot, branch: worktreeContext.branch });
                                }
                            }
                            if (worktreeContext?.id) {
                                await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, {
                                    status: "abandoned",
                                });
                            }
                            const nextWorktree = await createWorktreeGitArtifacts({
                                projectRoot: projectRoot,
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
                                await removeWorktreeGitArtifacts({
                                    projectRoot: projectRoot,
                                    path: nextWorktree.path,
                                    force: true,
                                });
                                // Deleting the branch is irreversible, so it is its own proven step.
                                if (nextWorktree.branch) {
                                    await deleteMergedWorktreeBranch({ projectRoot, branch: nextWorktree.branch });
                                }
                            });
                            await settleWorktreeAttempt(projectRoot, nextWorktree);
                            registerRollback("abandon recreated recovery registry entry", async () => {
                                await updateWorktreeRegistryEntry(projectRoot, nextWorktree.id, {
                                    status: "abandoned",
                                });
                            });
                            await markEffect("recovery_recreate_registry_settled", {
                                worktreeId: nextWorktree.id,
                                path: nextWorktree.path,
                                branch: nextWorktree.branch,
                            });
                            const writeRecoveredWorktreeMetadata = updatePlanFrontMatter;
                            const attrs = await writeRecoveredWorktreeMetadata(
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
                        throw new Error(
                            transition.message || `Recovery recreate transaction failed for ${plan.planName}.`,
                        );
                    }
                    const transitionValue = (transition.value || {}) as {
                        value?: { attrs: PlanFrontMatter; worktree: RecoveryWorktreeContext };
                    };
                    plan.attrs = transitionValue.value?.attrs as PlanFrontMatter;
                    recreated = transitionValue.value?.worktree;
                    if (!recreated) {
                        throw new Error(`Recovery recreate transaction returned no worktree for ${plan.planName}.`);
                    }
                    const refreshedPlan = await loadPlan(projectRoot, plan.planName);
                    if (refreshedPlan?.revision) {
                        plan.attrs = refreshedPlan.attrs;
                        plan.revision = refreshedPlan.revision;
                    }
                } catch (error) {
                    const message = isGitRepositoryRequiredError(error)
                        ? formatGitRequiredMessage(error)
                        : error instanceof Error
                        ? error.message
                        : String(error);
                    uiAPI.appendSystemMessage(
                        `Cannot recreate the recorded worktree: ${message}`,
                        true,
                        "RunWield",
                    );
                    continue;
                }
                worktreeContext = {
                    id: recreated.id,
                    path: recreated.path,
                    branch: recreated.branch,
                    baseBranch: recreated.baseBranch,
                    status: recreated.status,
                    baseRef: recreated.baseRef,
                    baseCommit: recreated.baseCommit,
                    baseTree: recreated.baseTree,
                };
            } else {
                if (!(await confirmBaselineReset(plan.planName, uiAPI))) continue;
                try {
                    await restoreWorktreeTree(projectRoot, plan.attrs.executionBaselineTree as string);
                } catch (error) {
                    const message = isGitRepositoryRequiredError(error)
                        ? formatGitRequiredMessage(error)
                        : error instanceof Error
                        ? error.message
                        : String(error);
                    uiAPI.appendSystemMessage(`Cannot reset baseline tree: ${message}`, true, "RunWield");
                    continue;
                }
            }
            const resetTransition = await runRecoveryTransition({
                projectRoot,
                planName: plan.planName,
                planId: plan.attrs.planId,
                worktreeId: worktreeContext?.id,
                expectedRevision: plan.revision,
                action: "reset",
                recover: async () =>
                    await recordPlanEvent({
                        cwd: projectRoot,
                        planName: plan.planName,
                        event: "recovery_reset",
                        currentStatus: plan.attrs.status,
                        details: { triageMeta: plan.attrs },
                    }),
            });
            if (resetTransition.status !== "committed") {
                throw transitionFailureError(
                    resetTransition,
                    `Recovery reset transaction failed for ${plan.planName}.`,
                );
            }
            const resetTransitionValue = (resetTransition.value || {}) as { value?: PlanFrontMatter };
            plan.attrs = { ...plan.attrs, ...resetTransitionValue.value, status: "ready_for_work" };
            await executeReadyPlanWithRepair({
                projectRoot,
                plan,
                agentName,
                uiAPI,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                listCommitsTouchingPathsSince,
                session,
                finalizePlanImplementation,
                recordPlanEvent,
                resolveValidationExecutionContextForRecovery,
            });
            await recordRecoveryResult("reset", "handled");
            return "handled";
        }

        if (answer === "merge") {
            worktreeContext = await refreshRecoveryWorktree();
            if (!canManuallyMergeRecoveredWorktree(worktreeContext)) {
                uiAPI.appendSystemMessage(
                    "Manual worktree merge is only available after Workflow Validation passed but merge-back failed. Retry Workflow Validation first.",
                    true,
                    "RunWield",
                );
                continue;
            }
            if (
                !(await confirmRecoveryWorktreeAvailable(
                    projectRoot,
                    plan.planName,
                    worktreeContext,
                    uiAPI,
                    getWorktreeStatus,
                ))
            ) {
                continue;
            }
            if (!worktreeContext?.branch || !worktreeContext.path) {
                uiAPI.appendSystemMessage(
                    "Cannot merge because no worktree branch or path is recorded.",
                    true,
                    "RunWield",
                );
                continue;
            }
            if (!loadedWorktreeId) {
                uiAPI.appendSystemMessage(
                    `Cannot merge recovered worktree ${worktreeContext.branch} because the loaded Plan did not contain a canonical worktreeId. Retry Workflow Validation; RunWield will not publish Delivery Evidence from branch-name recovery alone.`,
                    true,
                    "RunWield",
                );
                await recordRecoveryResult("merge", "blocked", { reason: "missing_canonical_worktree_id" });
                continue;
            }
            if (!worktreeContext.baseBranch) {
                uiAPI.appendSystemMessage(
                    `Cannot merge recovered worktree ${worktreeContext.branch} because no concrete target branch is recorded. Run Workflow Validation or reset recovery metadata; RunWield will not publish Delivery Evidence with an ambiguous target.`,
                    true,
                    "RunWield",
                );
                await recordRecoveryResult("merge", "blocked", { reason: "missing_target_branch" });
                continue;
            }
            const manualResolution = await resolveValidationExecutionContextForRecovery({
                projectRoot,
                planName: plan.planName,
                triageMeta: plan.attrs,
                explicitContext: {
                    planName: plan.planName,
                    triageMeta: plan.attrs,
                    executionMode: plan.attrs.executionMode,
                    baselineTree: plan.attrs.executionBaselineTree,
                    worktreeId: loadedWorktreeId,
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
                await recordRecoveryResult("merge", "blocked", { reason: manualResolution.reason });
                continue;
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
                await recordRecoveryResult("merge", "blocked", { reason: "not_worktree_execution" });
                continue;
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
                await recordRecoveryResult("merge", "blocked", { reason: "incomplete_resolved_worktree_context" });
                continue;
            }
            /** @type {Awaited<ReturnType<typeof preparePrimaryPlanPathForMergeFn>>[]} */
            const primaryPlanSnapshots: PrimaryPlanSnapshot[] = [];
            /** @type {import('../../plan-store.js').WorktreeDeliveryEvidence | undefined} */
            let manualDeliveryEvidence;
            let mergeCompleted = false;
            const cleanupMergedWorktrees = shouldCleanupMergedWorktrees(projectRoot);
            const mergeWorktreeId = worktreeContext?.id;
            try {
                // Publication runs as one transaction, the same as inside Workflow
                // Validation. As bare choreography this path moved the target ref with no
                // lock, no journal and no sibling fencing, so a crash mid-merge left
                // nothing for `wld plans doctor` to find, and an Epic-completing child
                // could publish against sibling evidence nobody rechecked.
                const siblingPlanNames = typeof plan.attrs.parentPlan === "string" && plan.attrs.parentPlan
                    ? (await findPlansByParent(projectRoot, plan.attrs.parentPlan)).map((child) => child.name).sort()
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
                                const targetBranchForEvidence = manualTargetBranch;
                                const targetHeadBeforeMerge = await getBranchHead(projectRoot, targetBranchForEvidence);
                                deliveryEvidence = {
                                    version: 1,
                                    mode: "worktree_merge",
                                    executionCommit: sealedCandidate.executionCommit,
                                    targetBranch: targetBranchForEvidence,
                                    targetHeadBeforeMerge,
                                };
                            }
                        }
                        manualDeliveryEvidence = deliveryEvidence;
                        const stagingResult = await stageValidationPassedInExecutionWorktree({
                            projectRoot: projectRoot,
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
                                await preparePrimaryPlanPathForMerge({ projectRoot: projectRoot, relativePath }),
                            );
                        }
                        if (primaryPlanSnapshots.length > 0) {
                            // Undo the staged primary Plan paths if publication fails before the
                            // target ref moves, and clear the list so the handler below does not
                            // restore them a second time.
                            registerRollback("restore_primary_plan_snapshots", async () => {
                                if (mergeCompleted) return;
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
                            projectRoot: projectRoot,
                            branch: manualWorktreeBranch,
                            targetBranch: manualTargetBranch,
                            worktreePath: manualWorktreePath,
                            expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                            planName: plan.planName,
                            planDescription: plan.attrs.summary,
                            sealedExecutionCommit: deliveryEvidence.executionCommit,
                            allowedDirtyPaths: stagingResult.planPaths.length > 0
                                ? stagingResult.planPaths
                                : [planPath],
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
                                await updateWorktreeRegistryEntry(projectRoot, mergeWorktreeId, { status: "merged" });
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
                    // Rethrow the original failure so the handler below can still classify a
                    // typed Git error instead of a flattened message.
                    if (publication.cause !== undefined) throw publication.cause;
                    throw new Error(
                        publication.message || `Worktree merge transaction did not commit for ${plan.planName}.`,
                    );
                }
                if (cleanupMergedWorktrees && worktreeContext.path) {
                    try {
                        await removeWorktreeGitArtifacts({
                            projectRoot: projectRoot,
                            path: worktreeContext.path,
                            force: false,
                        });
                        // Deleting the branch is irreversible, so it is its own proven step.
                        if (worktreeContext.branch) {
                            await deleteMergedWorktreeBranch({ projectRoot, branch: worktreeContext.branch });
                        }
                        if (worktreeContext.id) {
                            await removeWorktreeRegistryEntry(projectRoot, worktreeContext.id);
                        }
                    } catch (cleanupError) {
                        const cleanupReason = cleanupError instanceof Error
                            ? cleanupError.message
                            : String(cleanupError);
                        uiAPI.appendSystemMessage(
                            `Worktree merged, but cleanup failed: ${cleanupReason}`,
                            true,
                            "RunWield",
                        );
                    }
                }
                uiAPI.appendSystemMessage("Worktree changes merged and plan marked verified.", false, "RunWield");
                try {
                    await recordRecoveryResult("merge", "merged", { cleanupMergedWorktrees });
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
                    uiAPI.appendSystemMessage(
                        `Worktree merged, but post-merge processing failed: ${reason}`,
                        true,
                        "RunWield",
                    );
                    return "handled";
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
                            const restoreReason = restoreError instanceof Error
                                ? restoreError.message
                                : String(restoreError);
                            reason += ` Primary Plan rollback also failed: ${restoreReason}`;
                        }
                    }
                }
                uiAPI.appendSystemMessage(`Worktree merge failed: ${reason}`, true, "RunWield");
                if (worktreeContext.id) {
                    try {
                        await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, {
                            status: "merge_conflict",
                        });
                    } catch (metadataError) {
                        const metadataReason = metadataError instanceof Error
                            ? metadataError.message
                            : String(metadataError);
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
                            worktreeId: worktreeContext.id,
                            worktreePath: worktreeContext.path,
                            worktreeBranch: worktreeContext.branch,
                            worktreeBaseBranch: worktreeContext.baseBranch,
                        },
                    });
                } catch (metadataError) {
                    const metadataReason = metadataError instanceof Error
                        ? metadataError.message
                        : String(metadataError);
                    uiAPI.appendSystemMessage(
                        `Could not update plan metadata while merge conflict is active: ${metadataReason}`,
                        true,
                        "RunWield",
                    );
                }
                await recordRecoveryResult("merge", "failed", { mergeFailureKind: "manual_merge_failed" });
            }
            return "handled";
        }

        if (answer === "abandon") {
            if (!(await confirmWorktreeAction(plan.planName, uiAPI, "Delete/abandon"))) continue;
            uiAPI.appendSystemMessage(
                `Deleting recorded worktree for "${plan.planName}"...`,
                false,
                "RunWield",
            );
            let removedWorktree = true;
            const transition = await runRecoveryTransition({
                projectRoot,
                planName: plan.planName,
                planId: plan.attrs.planId,
                worktreeId: worktreeContext?.id,
                expectedRevision: plan.revision,
                action: "abandon",
                recover: async ({ beforePlan }) => {
                    if (worktreeContext?.path) {
                        try {
                            await removeWorktreeGitArtifacts({
                                projectRoot: projectRoot,
                                path: worktreeContext.path,
                                force: true,
                            });
                            // Deleting the branch is irreversible, so it is its own proven step.
                            if (worktreeContext.branch) {
                                await deleteMergedWorktreeBranch({ projectRoot, branch: worktreeContext.branch });
                            }
                        } catch (error) {
                            if (!isGitRepositoryRequiredError(error)) throw error;
                            removedWorktree = false;
                            uiAPI.appendSystemMessage(
                                `Git is required to delete the recorded worktree. Proceeding with metadata-only abandon: ${
                                    formatGitRequiredMessage(error)
                                }`,
                                true,
                                "RunWield",
                            );
                        }
                    }
                    if (worktreeContext?.id) {
                        await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
                    }
                    return await updatePlanFrontMatter(
                        projectRoot,
                        plan.planName,
                        {
                            worktreeStatus: "abandoned",
                            worktreeId: null,
                            worktreePath: null,
                            worktreeBranch: null,
                        },
                        plan.attrs,
                        { expectedRevision: beforePlan?.revision },
                    );
                },
            });
            if (transition.status !== "committed") {
                throw transitionFailureError(transition, `Recovery abandon transaction failed for ${plan.planName}.`);
            }
            const transitionValue = (transition.value || {}) as { value?: PlanFrontMatter };
            plan.attrs = transitionValue.value as PlanFrontMatter;
            worktreeContext = null;
            uiAPI.appendSystemMessage(
                removedWorktree
                    ? "Worktree abandoned and removed."
                    : "Worktree metadata abandoned; recorded path was left untouched because Git is unavailable.",
                false,
                "RunWield",
            );
            await recordRecoveryResult("abandon", "abandoned");
            continue;
        }

        if (answer === "review") {
            await reopenPlanForReview({
                projectRoot,
                plan,
                currentStatus: plan.attrs.status,
                worktreeContext,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                updatePlanFrontMatter,
                recordPlanEvent,
                session,
            });
            await recordRecoveryResult("review", "review");
            return "review";
        }
    }
}
