/**
 * @module shared/workflow/validation-supervisor
 * The sole production owner for planned-change validation and resume.
 */

import { loadPlan, StalePlanWriteError, updatePlanFrontMatter } from "../../plan-store.js";
import { runPlansDoctor } from "../../cmd/plans/doctor.ts";
import { getLockHostname, isPidAlive } from "../process-liveness.ts";
import { createEngineValidationArgs, runValidationLoop, type ValidationLoopArgs } from "./validation.ts";
import {
    isValidationCheckpoint,
    makeValidationCheckpoint,
    readValidationReviewState,
    type ValidationCheckpoint,
    validationCheckpointCanResume,
    validationPhaseForStatus,
} from "./validation-checkpoint.ts";
import { retryValidationLater } from "./validation-recovery.ts";
import type { WorkflowValidationResult } from "./validation-types.ts";
import { validationUserMessage } from "./validation-user-messages.ts";
import { resumeValidationPlanAmendment } from "./validation-plan-amendment.ts";
import { getDiffText, resolvePhaseContext } from "./validation-context.ts";
import { renderOpenItems } from "./review-ledger.ts";

export type ValidationTrigger =
    | "execution_completion"
    | "task_completion"
    | "load_plan"
    | "session_resume"
    | "repair"
    | "orchestrator"
    | "epic_child";

export type ContinueWorkflowValidationArgs = ValidationLoopArgs & {
    trigger?: ValidationTrigger;
    taskCompletionId?: string;
};

type ClaimResult =
    | {
        kind: "claimed";
        checkpoint: ValidationCheckpoint;
        claimedFromState?: ValidationCheckpoint["state"];
        planContent: string;
        triageMeta: ValidationLoopArgs["triageMeta"];
    }
    | { kind: "active"; projectRoot: string }
    | { kind: "settled_completion"; projectRoot: string };

function checkpointRecord(value: import("../../plan-store.js").PlanFrontMatter["validationCheckpoint"]):
    | ValidationCheckpoint
    | undefined {
    if (!value || !isValidationCheckpoint(value)) return undefined;
    return value;
}

async function ownerIsAlive(checkpoint: ValidationCheckpoint): Promise<boolean> {
    if (checkpoint.state !== "running") return false;
    if (!checkpoint.ownerPid || checkpoint.ownerHostname !== getLockHostname()) return false;
    return await isPidAlive(checkpoint.ownerPid);
}

async function claimValidation(args: ContinueWorkflowValidationArgs): Promise<ClaimResult> {
    const projectRoot = args.hostedSession.cwd;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const plan = await loadPlan(projectRoot, args.planName);
        if (!plan) throw new Error(`Plan not found: ${args.planName}`);
        const phase = validationPhaseForStatus(plan.attrs.status);
        if (!phase) {
            return { kind: "settled_completion", projectRoot };
        }
        const attemptId = plan.attrs.worktreeId || "in-place";
        const prior = checkpointRecord(plan.attrs.validationCheckpoint);
        const compatible = validationCheckpointCanResume(prior, attemptId, plan.attrs.status);
        if (compatible && args.taskCompletionId && prior.lastSettledOperationId === args.taskCompletionId) {
            return { kind: "settled_completion", projectRoot };
        }
        if (compatible && await ownerIsAlive(prior)) {
            return { kind: "active", projectRoot };
        }
        const checkpoint = makeValidationCheckpoint({
            attemptId,
            generation: compatible ? prior.generation : crypto.randomUUID(),
            status: plan.attrs.status,
            phase: compatible ? prior.nextPhase : phase,
            state: "running",
            ownerPid: Deno.pid,
            ownerHostname: getLockHostname(),
            repairGeneration: compatible ? prior.repairGeneration : undefined,
            repairKind: compatible ? prior.repairKind : undefined,
            repairCompletedOperationId: compatible ? prior.repairCompletedOperationId : undefined,
            lastSettledOperationId: compatible ? prior.lastSettledOperationId : undefined,
            reviewState: compatible ? prior.reviewState : undefined,
        });
        try {
            await updatePlanFrontMatter(
                projectRoot,
                args.planName,
                { validationCheckpoint: checkpoint },
                plan.attrs,
                { expectedRevision: plan.revision },
            );
            return {
                kind: "claimed",
                checkpoint,
                claimedFromState: compatible ? prior.state : undefined,
                planContent: plan.markdown,
                triageMeta: plan.attrs as ValidationLoopArgs["triageMeta"],
            };
        } catch (error) {
            if (!(error instanceof StalePlanWriteError) || attempt === 2) throw error;
        }
    }
    throw new Error("Could not claim validation.");
}

async function settleValidation(
    args: ContinueWorkflowValidationArgs,
    checkpoint: ValidationCheckpoint,
    result: WorkflowValidationResult,
): Promise<void> {
    const projectRoot = args.hostedSession.cwd;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const plan = await loadPlan(projectRoot, args.planName);
        if (!plan) return;
        const current = checkpointRecord(plan.attrs.validationCheckpoint);
        if (current?.generation !== checkpoint.generation) return;
        const phase = validationPhaseForStatus(plan.attrs.status);
        const validationCheckpoint = result.kind === "verified" || !phase ? null : makeValidationCheckpoint({
            attemptId: plan.attrs.worktreeId || current.attemptId,
            generation: current.generation,
            status: plan.attrs.status,
            phase,
            state: result.kind === "semantic_repair_handoff" ? "awaiting_repair" : "paused",
            repairKind: result.kind === "semantic_repair_handoff" ? "semantic" : current.repairKind,
            repairGeneration: result.kind === "semantic_repair_handoff"
                ? current.repairGeneration || crypto.randomUUID()
                : current.repairGeneration,
            repairCompletedOperationId: current.repairCompletedOperationId,
            lastSettledOperationId: args.taskCompletionId || current.lastSettledOperationId,
            reviewState: current.reviewState,
        });
        try {
            await updatePlanFrontMatter(
                projectRoot,
                args.planName,
                { validationCheckpoint },
                plan.attrs,
                { expectedRevision: plan.revision },
            );
            return;
        } catch (error) {
            if (!(error instanceof StalePlanWriteError) || attempt === 2) throw error;
        }
    }
}

/**
 * Commit a semantic repair's Agent claim before validation consumes it.
 *
 * The Agent report is evidence, not authority. This receipt only proves that the
 * exact checkpoint-owned repair turn called task_completed; CI and the Reviewer
 * still decide whether the work resolved anything.
 */
export async function recordValidationRepairCompletion(args: {
    projectRoot: string;
    planName: string;
    repairGeneration: string;
    report: string;
}): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const plan = await loadPlan(args.projectRoot, args.planName);
        if (!plan) throw new Error(`Plan not found: ${args.planName}`);
        const checkpoint = checkpointRecord(plan.attrs.validationCheckpoint);
        if (!checkpoint || checkpoint.repairGeneration !== args.repairGeneration) {
            throw new Error("Semantic repair completion does not match the saved validation attempt.");
        }
        if (checkpoint.repairCompletedOperationId === args.repairGeneration && checkpoint.state === "ready") return;
        const reviewState = readValidationReviewState(checkpoint);
        if (!reviewState) throw new Error("Semantic repair completion is missing its saved Review Issues.");
        const completed = makeValidationCheckpoint({
            attemptId: checkpoint.attemptId,
            generation: checkpoint.generation,
            status: plan.attrs.status,
            phase: "mechanical",
            state: "ready",
            repairKind: checkpoint.repairKind,
            repairGeneration: checkpoint.repairGeneration,
            repairCompletedOperationId: args.repairGeneration,
            lastSettledOperationId: checkpoint.lastSettledOperationId,
            reviewState: { ...reviewState, lastRepairReport: args.report },
        });
        try {
            await updatePlanFrontMatter(
                args.projectRoot,
                args.planName,
                { validationCheckpoint: completed },
                plan.attrs,
                { expectedRevision: plan.revision },
            );
            return;
        } catch (error) {
            if (!(error instanceof StalePlanWriteError) || attempt === 2) throw error;
        }
    }
}

async function rebuildSemanticRepairHandoff(
    args: ContinueWorkflowValidationArgs,
    checkpoint: ValidationCheckpoint,
): Promise<WorkflowValidationResult> {
    const reviewState = readValidationReviewState(checkpoint);
    if (!reviewState || !checkpoint.repairGeneration) {
        return pausedResult(args, "validation_repair_evidence_missing", "mechanical");
    }
    const engineArgs = createEngineValidationArgs({ ...args, validationCheckpoint: checkpoint });
    const phase = await resolvePhaseContext(engineArgs);
    if (phase.kind === "blocked") return phase.result;
    const context = phase.context;
    const diffText = await getDiffText(context.baselineTree, context.executionCwd);
    const activeWorkflow = {
        ...context.workflowBase,
        semanticRound: reviewState.semanticRound,
        reviewLedger: reviewState.reviewLedger,
        repairBaselineTree: reviewState.repairBaselineTree,
        lastRepairReport: reviewState.lastRepairReport,
        validationRepairGeneration: checkpoint.repairGeneration,
    };
    engineArgs.session.setActiveWorkflow(activeWorkflow);
    return {
        kind: "semantic_repair_handoff",
        planName: args.planName,
        projectRoot: context.projectRoot,
        reason: "Resuming the saved code-review repair.",
        semanticRepairHandoff: {
            semanticRound: reviewState.semanticRound,
            repairGeneration: checkpoint.repairGeneration,
            reviewLedger: reviewState.reviewLedger,
            repairBaselineTree: reviewState.repairBaselineTree,
            lastRepairReport: reviewState.lastRepairReport,
            diffText,
            findingsSection: renderOpenItems(reviewState.reviewLedger),
            activeWorkflow,
        },
    };
}

function pausedResult(
    args: ContinueWorkflowValidationArgs,
    code: string,
    phase?: ValidationCheckpoint["nextPhase"],
): WorkflowValidationResult {
    const message = validationUserMessage("retry_pause");
    return {
        kind: "paused",
        planName: args.planName,
        projectRoot: args.hostedSession.cwd,
        reason: message,
        recovery: retryValidationLater(code, message, phase),
    };
}

/** Reconcile canonical Plan state, claim one owner, run, and durably settle. */
export async function continueWorkflowValidation(
    args: ContinueWorkflowValidationArgs,
): Promise<WorkflowValidationResult> {
    let claim: Extract<ClaimResult, { kind: "claimed" }> | undefined;
    try {
        // Finish a journaled approved amendment before general repair scans. This
        // keeps the primary revision authoritative after a process stop.
        await resumeValidationPlanAmendment(args.hostedSession.cwd, args.planName);
        // Repair provable RunWield bookkeeping before it can block validation. Doctor
        // never resets working changes or removes an unmerged worktree.
        await runPlansDoctor(args.hostedSession.cwd, true);
        const claimed = await claimValidation(args);
        if (claimed.kind === "active") {
            const message = validationUserMessage("already_running");
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: claimed.projectRoot,
                reason: message,
                recovery: retryValidationLater("validation_owner_active", message),
            };
        }
        if (claimed.kind === "settled_completion") {
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: claimed.projectRoot,
                reason: validationUserMessage("completion_already_used"),
                recovery: {
                    kind: "terminal",
                    code: "task_completion_already_settled",
                    message: validationUserMessage("completion_already_used"),
                    action: "none",
                },
            };
        }
        claim = claimed;
        const activeWorkflow = args.hostedSession.getActiveExecutionWorkflow();
        const durableReview = readValidationReviewState(claim.checkpoint);
        if (activeWorkflow) {
            args.hostedSession.setActiveExecutionWorkflow({
                ...activeWorkflow,
                validationGeneration: claim.checkpoint.generation,
                ...(durableReview
                    ? {
                        semanticRound: durableReview.semanticRound,
                        reviewLedger: durableReview.reviewLedger,
                        repairBaselineTree: durableReview.repairBaselineTree,
                        lastRepairReport: durableReview.lastRepairReport,
                    }
                    : {}),
                ...(claim.checkpoint.repairGeneration
                    ? { validationRepairGeneration: claim.checkpoint.repairGeneration }
                    : {}),
            });
        }
        if (claim.claimedFromState === "awaiting_repair" && !args.taskCompletionId) {
            const result = await rebuildSemanticRepairHandoff(args, claim.checkpoint);
            await settleValidation(args, claim.checkpoint, result);
            return result;
        }
        const result = await runValidationLoop({
            ...args,
            planContent: claim.planContent,
            triageMeta: claim.triageMeta,
            executionContext: undefined,
            continuationPhase: claim.checkpoint.nextPhase,
            validationCheckpoint: claim.checkpoint,
        });
        await settleValidation(args, claim.checkpoint, result);
        return result;
    } catch (error) {
        const result = pausedResult(args, "validation_operation_failed", claim?.checkpoint.nextPhase);
        if (claim) {
            await settleValidation(args, claim.checkpoint, result).catch((settlementError) => {
                console.error("[RunWield] validation_pause_write_failed", settlementError);
            });
        }
        console.error("[RunWield] validation_operation_failed", error);
        return result;
    }
}
