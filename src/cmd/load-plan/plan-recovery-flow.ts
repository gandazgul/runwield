/**
 * @module cmd/load-plan/plan-recovery-flow
 * The Plan Recovery menu coordinator for in-progress, failed, and implemented Plans.
 */

import { resolvePlanExecutionPolicy } from "../../plan-store.js";
import { probeGitRepository as probeGitRepositoryFn } from "../../shared/git.js";
import { isInValidation } from "../../shared/workflow/plan-lifecycle.js";
import { recordWorkflowMetric } from "../../shared/workflow/metrics.js";
import {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
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
    session: PlanSessionSurface;
    recordWorkflowMetric?: typeof recordWorkflowMetric;
    probeGitRepository?: typeof probeGitRepositoryFn;
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
            findWorktreeById: findWorktreeByIdFn,
            findWorktreeByPlanName: findWorktreeByPlanNameFn,
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
        const outcome = await dispatchRecoveryAction(answer, context, gitRecoveryBlocked, gitProbe.state);
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
            return await holdRecoveryPlan(context);
        case "user_verify":
            return await userVerifyRecoveryPlan(context);
        case "inspect":
            return await inspectRecoveryPlan(context);
        case "validate":
            return await validateRecoveryPlan(context);
        case "continue":
            return await continueRecoveryPlan(context);
        case "abandon":
            return await abandonRecoveryPlan(context);
        case "review":
            return await reviewRecoveryPlan(context);
        case "reset":
            return await resetRecoveryPlan(context, gitRecoveryBlocked, gitState);
        case "merge":
            return await mergeRecoveredWorktree(context);
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
