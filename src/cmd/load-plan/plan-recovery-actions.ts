import { findPlansByParent as findPlansByParentFn } from "../../plan-store.js";
import {
    closeTransitionRecordByAttestation,
    getTransitionJournalDir,
    runRecoveryTransition,
} from "../../shared/workflow/state-transition.ts";
import { healSettledTransitionRecords } from "../../shared/workflow/transition-recovery.ts";
import {
    appendRecoveryReport,
    confirmRecoveryWorktreeAvailable,
    confirmWorktreeAction,
    hasWorktreeContext,
    rehydrateActiveRecoveryWorkflow,
    reopenPlanForReview,
} from "./plan-recovery-worktree.ts";
import { executeReadyPlanWithRepair, validateCompletedExecution } from "./plan-execution.ts";
import { markPlanUserVerified, putPlanOnHold } from "./plan-hold.ts";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../../shared/git.js";
import { transitionFailureError } from "./transition-failure.ts";

import type { PlanFrontMatter } from "../../plan-store.js";
import type { UiAPI } from "../../ui/tui/types.js";
import type { PlanSessionSurface, RecoveryWorktreeContext } from "./plan-session-types.ts";
import type { HandlePlanRecoveryOptions, RecoveryFlowPlan, UnresolvedTransitionRecord } from "./plan-recovery-flow.ts";

export type RecoveryActionOutcome = { kind: "menu" } | { kind: "handled" } | { kind: "review" };
export type RecoveryMetricDetailValue = string | number | boolean | null | undefined;
export type RecoveryMetricDetails = Record<string, RecoveryMetricDetailValue>;

export interface RecoveryActionContext {
    projectRoot: string;
    plan: RecoveryFlowPlan;
    agentName: string;
    uiAPI: UiAPI;
    session: PlanSessionSurface;
    loadedWorktreeId?: string | null;
    worktreeContext: RecoveryWorktreeContext | null;
    unresolvedRecords: UnresolvedTransitionRecord[];
    refreshRecoveryWorktree(): Promise<RecoveryWorktreeContext | null>;
    recordRecoveryResult(action: string, result: string, details?: RecoveryMetricDetails): Promise<void>;
}

export type RecoveryActionName =
    | "settle_records"
    | "hold"
    | "user_verify"
    | "inspect"
    | "validate"
    | "continue"
    | "abandon"
    | "review"
    | "reset"
    | "merge";

interface CommonActionCapabilities {
    recordPlanEvent: HandlePlanRecoveryOptions["recordPlanEvent"];
    findPlansByParent: typeof findPlansByParentFn;
}

export async function settleRecoveryRecords(context: RecoveryActionContext): Promise<RecoveryActionOutcome> {
    const { projectRoot, plan, uiAPI } = context;
    const recheck = await healSettledTransitionRecords(projectRoot, { planName: plan.planName, apply: true }).catch(
        () => null,
    );
    context.unresolvedRecords = recheck ? recheck.remaining : context.unresolvedRecords;
    if (recheck && recheck.closed.length > 0) {
        uiAPI.appendSystemMessage(
            `Closed ${recheck.closed.length} lifecycle record${
                recheck.closed.length === 1 ? "" : "s"
            } that the repository now proves are settled.`,
            false,
            "RunWield",
        );
    }
    if (context.unresolvedRecords.length === 0) {
        await context.recordRecoveryResult("settle_records", "handled", { byProof: true });
        return { kind: "menu" };
    }
    for (const record of context.unresolvedRecords) {
        uiAPI.appendSystemMessage(
            `Unfinished ${record.operation || "lifecycle operation"} on ${plan.planName}: ${record.reason}`,
            false,
            "RunWield",
        );
    }
    const confirmed = await uiAPI.promptSelect(
        `Close ${context.unresolvedRecords.length === 1 ? "this record" : "these records"} on your confirmation?`,
        [
            { value: "no", label: "No, leave them (check the state first)" },
            { value: "yes", label: "Yes — I have checked the repository and nothing is unpublished" },
        ],
    );
    if (confirmed !== "yes") {
        await context.recordRecoveryResult("settle_records", "declined");
        return { kind: "menu" };
    }
    for (const record of context.unresolvedRecords) {
        if (record.transitionId) {
            await closeTransitionRecordByAttestation(projectRoot, record.transitionId, {
                note: `Closed from Plan Recovery for ${plan.planName}.`,
            });
        }
    }
    context.unresolvedRecords = [];
    uiAPI.appendSystemMessage(
        `Closed on your confirmation. The records were kept, not deleted — they are under ${
            getTransitionJournalDir(projectRoot)
        }/attested if you need to look back. Lifecycle changes to ${plan.planName} are unblocked.`,
        false,
        "RunWield",
    );
    await context.recordRecoveryResult("settle_records", "handled", { byAttestation: true });
    return { kind: "menu" };
}

export async function holdRecoveryPlan(
    context: RecoveryActionContext,
    capabilities: CommonActionCapabilities,
): Promise<RecoveryActionOutcome> {
    await putPlanOnHold({
        projectRoot: context.projectRoot,
        plan: context.plan,
        uiAPI: context.uiAPI,
        recordPlanEvent: capabilities.recordPlanEvent,
        findPlansByParent: capabilities.findPlansByParent,
    });
    await context.recordRecoveryResult("hold", "handled");
    return { kind: "handled" };
}

export async function userVerifyRecoveryPlan(
    context: RecoveryActionContext,
    capabilities: {
        recordPlanEvent: HandlePlanRecoveryOptions["recordPlanEvent"];
        autoGenerateWorkRecordForCompletedPlan: NonNullable<
            HandlePlanRecoveryOptions["autoGenerateWorkRecordForCompletedPlan"]
        >;
    },
): Promise<RecoveryActionOutcome> {
    await markPlanUserVerified({
        projectRoot: context.projectRoot,
        plan: context.plan,
        uiAPI: context.uiAPI,
        recordPlanEvent: capabilities.recordPlanEvent,
        autoGenerateWorkRecordForCompletedPlan: capabilities.autoGenerateWorkRecordForCompletedPlan,
    });
    await context.recordRecoveryResult("user_verify", "handled");
    return { kind: "handled" };
}

export async function inspectRecoveryPlan(
    context: RecoveryActionContext,
    capabilities: {
        getWorkflowDiff: HandlePlanRecoveryOptions["getWorkflowDiff"];
        getWorktreeStatus: HandlePlanRecoveryOptions["getWorktreeStatus"];
    },
): Promise<RecoveryActionOutcome> {
    context.worktreeContext = await context.refreshRecoveryWorktree();
    await appendRecoveryReport(
        context.projectRoot,
        context.plan,
        context.uiAPI,
        capabilities.getWorkflowDiff,
        context.worktreeContext,
        capabilities.getWorktreeStatus,
    );
    await context.recordRecoveryResult("inspect", "reported", {
        hasWorktree: hasWorktreeContext(context.worktreeContext),
    });
    return { kind: "menu" };
}

export async function validateRecoveryPlan(
    context: RecoveryActionContext,
    capabilities: Pick<
        HandlePlanRecoveryOptions,
        | "getWorktreeStatus"
        | "runValidationLoop"
        | "loadPlan"
        | "finalizePlanImplementation"
        | "recordPlanEvent"
        | "resolveValidationExecutionContextForRecovery"
    >,
): Promise<RecoveryActionOutcome> {
    context.worktreeContext = await context.refreshRecoveryWorktree();
    if (
        !(await confirmRecoveryWorktreeAvailable(
            context.projectRoot,
            context.plan.planName,
            context.worktreeContext,
            context.uiAPI,
            capabilities.getWorktreeStatus,
        ))
    ) {
        return { kind: "menu" };
    }
    const validationStarted = await validateCompletedExecution(
        { executionComplete: true },
        context.plan.planName,
        context.plan.markdown || context.plan.body || "",
        context.plan.attrs,
        capabilities.runValidationLoop,
        capabilities.loadPlan,
        context.worktreeContext,
        context.session,
        context.uiAPI,
        capabilities.finalizePlanImplementation,
        capabilities.recordPlanEvent,
        capabilities.resolveValidationExecutionContextForRecovery,
    );
    if (!validationStarted) {
        await context.recordRecoveryResult("validate", "blocked", { reason: "invalid_execution_policy" });
        return { kind: "menu" };
    }
    await context.recordRecoveryResult("validate", "handled");
    return { kind: "handled" };
}

export async function continueRecoveryPlan(
    context: RecoveryActionContext,
    capabilities: Pick<
        HandlePlanRecoveryOptions,
        | "getWorktreeStatus"
        | "executePlan"
        | "runPlanningAgent"
        | "decidePostPlanning"
        | "decidePostExecution"
        | "runValidationLoop"
        | "loadPlan"
        | "listCommitsTouchingPathsSince"
        | "finalizePlanImplementation"
        | "recordPlanEvent"
        | "resolveValidationExecutionContextForRecovery"
    >,
): Promise<RecoveryActionOutcome> {
    context.worktreeContext = await context.refreshRecoveryWorktree();
    if (
        context.plan.attrs.executionMode !== "non_git_in_place" &&
        !(await confirmRecoveryWorktreeAvailable(
            context.projectRoot,
            context.plan.planName,
            context.worktreeContext,
            context.uiAPI,
            capabilities.getWorktreeStatus,
        ))
    ) {
        return { kind: "menu" };
    }
    if (
        !(await rehydrateActiveRecoveryWorkflow(
            context.projectRoot,
            context.plan,
            context.worktreeContext,
            context.session,
            context.uiAPI,
            "continue",
        ))
    ) {
        await context.recordRecoveryResult("continue", "blocked", { reason: "invalid_execution_policy" });
        return { kind: "menu" };
    }
    await capabilities.recordPlanEvent({
        cwd: context.projectRoot,
        planName: context.plan.planName,
        event: "recovery_continue",
        currentStatus: context.plan.attrs.status,
        details: { triageMeta: context.plan.attrs },
    });
    context.plan.attrs.status = "ready_for_work";
    await executeReadyPlanWithRepair({
        projectRoot: context.projectRoot,
        plan: context.plan,
        agentName: context.agentName,
        uiAPI: context.uiAPI,
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
    await context.recordRecoveryResult("continue", "handled");
    return { kind: "handled" };
}

export async function abandonRecoveryPlan(
    context: RecoveryActionContext,
    capabilities:
        & Pick<
            HandlePlanRecoveryOptions,
            "updateWorktreeRegistryEntry" | "updatePlanFrontMatter" | "removeWorktreeGitArtifacts"
        >
        & { deleteMergedWorktreeBranch: typeof import("../../shared/worktree.js").deleteMergedWorktreeBranch },
): Promise<RecoveryActionOutcome> {
    const { projectRoot, plan, uiAPI } = context;
    if (!(await confirmWorktreeAction(plan.planName, uiAPI, "Delete/abandon"))) {
        return { kind: "menu" };
    }
    uiAPI.appendSystemMessage(`Deleting recorded worktree for "${plan.planName}"...`, false, "RunWield");
    let removedWorktree = true;
    const transition = await runRecoveryTransition({
        projectRoot,
        planName: plan.planName,
        planId: plan.attrs.planId,
        worktreeId: context.worktreeContext?.id,
        expectedRevision: plan.revision,
        action: "abandon",
        recover: async ({ beforePlan }) => {
            if (context.worktreeContext?.path) {
                try {
                    await capabilities.removeWorktreeGitArtifacts({
                        projectRoot,
                        path: context.worktreeContext.path,
                        force: true,
                    });
                    if (context.worktreeContext.branch) {
                        await capabilities.deleteMergedWorktreeBranch({
                            projectRoot,
                            branch: context.worktreeContext.branch,
                        });
                    }
                } catch (error) {
                    if (!isGitRepositoryRequiredError(error)) {
                        throw error;
                    }
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
            if (context.worktreeContext?.id) {
                await capabilities.updateWorktreeRegistryEntry(projectRoot, context.worktreeContext.id, {
                    status: "abandoned",
                });
            }
            return await capabilities.updatePlanFrontMatter(
                projectRoot,
                plan.planName,
                { worktreeStatus: "abandoned", worktreeId: null, worktreePath: null, worktreeBranch: null },
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
    context.worktreeContext = null;
    uiAPI.appendSystemMessage(
        removedWorktree
            ? "Worktree abandoned and removed."
            : "Worktree metadata abandoned; recorded path was left untouched because Git is unavailable.",
        false,
        "RunWield",
    );
    await context.recordRecoveryResult("abandon", "abandoned");
    return { kind: "menu" };
}

export async function reviewRecoveryPlan(
    context: RecoveryActionContext,
    capabilities: Pick<
        HandlePlanRecoveryOptions,
        | "findWorktreeById"
        | "findWorktreeByPlanName"
        | "updateWorktreeRegistryEntry"
        | "updatePlanFrontMatter"
        | "recordPlanEvent"
    >,
): Promise<RecoveryActionOutcome> {
    await reopenPlanForReview({
        projectRoot: context.projectRoot,
        plan: context.plan,
        currentStatus: context.plan.attrs.status,
        worktreeContext: context.worktreeContext,
        findWorktreeById: capabilities.findWorktreeById,
        findWorktreeByPlanName: capabilities.findWorktreeByPlanName,
        updateWorktreeRegistryEntry: capabilities.updateWorktreeRegistryEntry,
        updatePlanFrontMatter: capabilities.updatePlanFrontMatter,
        recordPlanEvent: capabilities.recordPlanEvent,
        session: context.session,
    });
    await context.recordRecoveryResult("review", "review");
    return { kind: "review" };
}
