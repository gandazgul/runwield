/**
 * @module shared/workflow/validation-supervisor
 * The sole production owner for planned-change validation and resume.
 */

import { loadPlan, resolvePlanExecutionPolicy, StalePlanWriteError, updatePlanFrontMatter } from "../../plan-store.js";
import { StaleControllerWriteError } from "./controller-registry.ts";
import { runPlansDoctor } from "../../cmd/plans/doctor.ts";
import { getLockHostname, isPidAlive } from "../process-liveness.ts";
import { findActiveByPlanName as findWorktreeByPlanName } from "../worktree-registry.js";
import { createEngineValidationArgs, runValidationLoop, type ValidationLoopArgs } from "./validation.ts";
import {
    isValidationCheckpoint,
    makeValidationCheckpoint,
    readValidationReviewState,
    type ValidationCheckpoint,
    validationCheckpointCanResume,
    validationPhaseForStatus,
} from "./validation-checkpoint.ts";
import { classifyValidationOperationalError } from "./validation-operational-errors.ts";
import { decideValidationRecovery, readValidationRetryPolicy, retryValidationLater } from "./validation-recovery.ts";
import type { WorkflowValidationResult } from "./validation-types.ts";
import { validationUserMessage } from "./validation-user-messages.ts";
import { resumeValidationPlanAmendment } from "./validation-plan-amendment.ts";
import { getDiffText, resolvePhaseContext } from "./validation-context.ts";
import { renderOpenItems } from "./review-ledger.ts";
import { PLAN_STATUSES } from "./plan-lifecycle.js";
import { resolveWorkflowPlanLocation } from "./plan-location.ts";
import { resolvePrimaryCheckoutRoot } from "../primary-checkout.ts";

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
        planCwd: string;
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

function validationProjectRoot(args: ContinueWorkflowValidationArgs): string {
    return resolvePrimaryCheckoutRoot(args.executionContext?.projectRoot || args.hostedSession.cwd);
}

async function validationPlanCwd(args: ContinueWorkflowValidationArgs): Promise<string> {
    const projectRoot = validationProjectRoot(args);
    // Validation's execution-context boundary verifies Git and repairs legacy
    // Plan IDs. Select its registered directory here without rejecting those
    // repairable IDs first, and never substitute a cached Session directory.
    const attempt = await findWorktreeByPlanName(projectRoot, args.planName);
    if (attempt) return attempt.path;
    return (await resolveWorkflowPlanLocation(projectRoot, args.planName)).documentRoot;
}

async function claimValidation(args: ContinueWorkflowValidationArgs): Promise<ClaimResult> {
    const projectRoot = validationProjectRoot(args);
    const planCwd = await validationPlanCwd(args);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const plan = await loadPlan(planCwd, args.planName);
        if (!plan) throw new Error(`Plan not found: ${args.planName}`);
        let phase = validationPhaseForStatus(plan.attrs.status);
        if (!phase && plan.attrs.status === "validated" && planCwd !== projectRoot) {
            const pendingPublication = await findWorktreeByPlanName(projectRoot, args.planName);
            if (pendingPublication) phase = "delivery";
        }
        if (!phase) {
            if (!PLAN_STATUSES.includes(plan.attrs.status)) {
                throw new Error(`Plan has unknown status: ${String(plan.attrs.status)}`);
            }
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
                planCwd,
                args.planName,
                { validationCheckpoint: checkpoint },
                plan.attrs,
                { expectedRevision: plan.revision, expectedControllerRevision: plan.controllerRevision },
            );
            return {
                kind: "claimed",
                checkpoint,
                planCwd,
                claimedFromState: compatible ? prior.state : undefined,
                planContent: plan.markdown,
                triageMeta: plan.attrs as ValidationLoopArgs["triageMeta"],
            };
        } catch (error) {
            if (
                !(error instanceof StalePlanWriteError || error instanceof StaleControllerWriteError) || attempt === 2
            ) throw error;
        }
    }
    throw new Error("Could not claim validation.");
}

async function settleValidation(
    args: ContinueWorkflowValidationArgs,
    checkpoint: ValidationCheckpoint,
    result: WorkflowValidationResult,
    planCwd: string,
): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const plan = await loadPlan(planCwd, args.planName);
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
                planCwd,
                args.planName,
                { validationCheckpoint },
                plan.attrs,
                { expectedRevision: plan.revision, expectedControllerRevision: plan.controllerRevision },
            );
            return;
        } catch (error) {
            if (
                !(error instanceof StalePlanWriteError || error instanceof StaleControllerWriteError) || attempt === 2
            ) throw error;
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
                { expectedRevision: plan.revision, expectedControllerRevision: plan.controllerRevision },
            );
            return;
        } catch (error) {
            if (
                !(error instanceof StalePlanWriteError || error instanceof StaleControllerWriteError) || attempt === 2
            ) throw error;
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

function operationalFailureResult(
    args: ContinueWorkflowValidationArgs,
    error: unknown,
    phase?: ValidationCheckpoint["nextPhase"],
): WorkflowValidationResult {
    const message = error instanceof Error ? error.message : String(error);
    const failure = classifyValidationOperationalError(
        message.startsWith("Plan not found:")
            ? {
                source: "validation_state",
                kind: "plan_missing",
                operation: "validation_state",
                message,
            }
            : message.startsWith("Plan has unknown status:")
            ? {
                source: "validation_state",
                kind: "unknown_plan_status",
                operation: "validation_state",
                message,
            }
            : {
                source: "policy",
                kind: "lifecycle_invariant",
                operation: "validation_state",
                message,
            },
    );
    const decision = decideValidationRecovery({
        failure,
        attempt: 1,
        policy: readValidationRetryPolicy(validationProjectRoot(args)),
        nextPhase: phase,
    });
    return {
        kind: decision.action === "halt" ? "failed" : "paused",
        planName: args.planName,
        projectRoot: validationProjectRoot(args),
        reason: decision.result.message,
        recovery: decision.result,
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
        projectRoot: validationProjectRoot(args),
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
        const projectRoot = validationProjectRoot(args);
        await resumeValidationPlanAmendment(projectRoot, args.planName);
        // Repair provable RunWield bookkeeping before it can block validation. Doctor
        // never resets working changes or removes an unmerged worktree.
        await runPlansDoctor(projectRoot, true);
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
        const cachedWorkflow = args.hostedSession.getActiveExecutionWorkflow();
        const activeWorkflow = cachedWorkflow?.planName === args.planName &&
                cachedWorkflow.worktreeId === claim.triageMeta.worktreeId
            ? cachedWorkflow
            : null;
        const durableReview = readValidationReviewState(claim.checkpoint);
        const registryEntry = await findWorktreeByPlanName(projectRoot, args.planName);
        const policy = resolvePlanExecutionPolicy(claim.triageMeta);
        args.hostedSession.setActiveExecutionWorkflow({
            ...(activeWorkflow || {}),
            planName: args.planName,
            triageMeta: claim.triageMeta,
            executionAgent: policy.ok ? policy.policy.executionAgent : "engineer",
            ...(registryEntry
                ? {
                    projectRoot,
                    executionMode: "worktree",
                    executionCwd: claim.planCwd,
                    baselineTree: registryEntry?.baseTree || claim.triageMeta.executionBaselineTree ||
                        args.executionContext?.baselineTree,
                    worktreeId: registryEntry?.id || claim.triageMeta.worktreeId || args.executionContext?.worktreeId,
                    worktreeBranch: registryEntry?.branch || claim.triageMeta.worktreeBranch ||
                        args.executionContext?.worktreeBranch,
                    worktreeBaseBranch: registryEntry?.baseBranch || claim.triageMeta.worktreeBaseBranch ||
                        args.executionContext?.worktreeBaseBranch,
                }
                : { executionMode: "non_git_in_place", executionCwd: claim.planCwd }),
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
        if (claim.claimedFromState === "awaiting_repair" && !args.taskCompletionId) {
            const result = await rebuildSemanticRepairHandoff(args, claim.checkpoint);
            await settleValidation(args, claim.checkpoint, result, claim.planCwd);
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
        await settleValidation(args, claim.checkpoint, result, claim.planCwd);
        if (result.kind === "verified") {
            // Publication can remove the execution worktree before the root Agent
            // turn settles. Do not leave the Session pointed at that deleted cwd:
            // the next user message belongs to the normal project Session.
            args.hostedSession.clearActiveExecutionWorkflow();
        }
        return result;
    } catch (error) {
        const result = operationalFailureResult(args, error, claim?.checkpoint.nextPhase);
        if (claim) {
            await settleValidation(args, claim.checkpoint, result, claim.planCwd).catch((settlementError) => {
                console.error("[RunWield] validation_pause_write_failed", settlementError);
            });
        }
        console.error("[RunWield] validation_operation_failed", error);
        return result;
    }
}

/**
 * Continue across successful phase boundaries until validation either finishes
 * or reaches a boundary that needs an Agent or the user. The execution Plan is
 * reloaded between phases because it is the durable phase authority once work
 * has started.
 */
export async function runWorkflowValidationToStableBoundary(
    initialArgs: ContinueWorkflowValidationArgs,
): Promise<WorkflowValidationResult> {
    let args = initialArgs;
    let previousStatus = String(args.triageMeta?.status || "");
    let result = await continueWorkflowValidation(args);
    // A resumed run can first consume its durable recovery checkpoint before
    // advancing through Mechanical Validation, semantic review, optional human
    // review, and publication. Bound the loop above that complete phase count;
    // status/reason checks below still stop immediately at Agent/user boundaries.
    for (let phase = 0; phase < 5; phase += 1) {
        if (result?.kind !== "paused") break;
        const planCwd = await validationPlanCwd(args);
        const plan = await loadPlan(planCwd, args.planName).catch(() => null);
        const status = String(plan?.attrs.status || "");
        const completedHumanReview = result.reason === "Local Human Code Review is not required." ||
            result.reason === "Local Human Code Review skipped by user." ||
            result.reason === "Local Human Code Review approved.";
        const deferredByUser = result.reason?.includes("Run this Plan again when you are ready") === true;
        if (deferredByUser) break;
        if (!plan || (status === previousStatus && !completedHumanReview)) break;
        if (status !== "validated_ci" && status !== "validated_reviewer") break;
        previousStatus = status;
        args = {
            ...args,
            planContent: plan.markdown || plan.body || args.planContent,
            triageMeta: { ...args.triageMeta, ...plan.attrs },
        };
        result = await continueWorkflowValidation(args);
    }
    return result;
}
