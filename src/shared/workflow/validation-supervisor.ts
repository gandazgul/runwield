/**
 * @module shared/workflow/validation-supervisor
 * The sole production owner for planned-change validation and resume.
 */

import { loadPlan, StalePlanWriteError, updatePlanFrontMatter } from "../../plan-store.js";
import { runPlansDoctor } from "../../cmd/plans/doctor.ts";
import { getLockHostname, isPidAlive } from "../process-liveness.ts";
import { runValidationLoop, type ValidationLoopArgs } from "./validation.ts";
import {
    makeValidationCheckpoint,
    type ValidationCheckpoint,
    validationPhaseForStatus,
} from "./validation-checkpoint.ts";
import { retryValidationLater } from "./validation-recovery.ts";
import type { WorkflowValidationResult } from "./validation-types.ts";
import { validationUserMessage } from "./validation-user-messages.ts";
import { resumeValidationPlanAmendment } from "./validation-plan-amendment.ts";

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
        planContent: string;
        triageMeta: ValidationLoopArgs["triageMeta"];
    }
    | { kind: "active"; projectRoot: string }
    | { kind: "settled_completion"; projectRoot: string };

function checkpointRecord(value: import("../../plan-store.js").PlanFrontMatter["validationCheckpoint"]):
    | ValidationCheckpoint
    | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as ValidationCheckpoint;
}

async function ownerIsAlive(checkpoint: ValidationCheckpoint): Promise<boolean> {
    if (checkpoint.state !== "running") return false;
    if (!checkpoint.ownerPid || checkpoint.ownerHostname !== getLockHostname()) return false;
    return await isPidAlive(checkpoint.ownerPid);
}

function checkpointAgreesWithPlan(
    checkpoint: ValidationCheckpoint | undefined,
    attemptId: string,
    status: string,
    phase: ValidationCheckpoint["nextPhase"],
): checkpoint is ValidationCheckpoint {
    return Boolean(
        checkpoint && checkpoint.attemptId === attemptId && checkpoint.expectedStatus === status &&
            checkpoint.nextPhase === phase,
    );
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
        const compatible = checkpointAgreesWithPlan(prior, attemptId, plan.attrs.status, phase);
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
            lastSettledOperationId: compatible ? prior.lastSettledOperationId : undefined,
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
            attemptId: plan.attrs.worktreeId || checkpoint.attemptId,
            generation: checkpoint.generation,
            status: plan.attrs.status,
            phase,
            state: result.kind === "semantic_repair_handoff" ? "awaiting_repair" : "paused",
            repairKind: result.kind === "semantic_repair_handoff" ? "semantic" : undefined,
            repairGeneration: result.kind === "semantic_repair_handoff"
                ? checkpoint.repairGeneration || crypto.randomUUID()
                : checkpoint.repairGeneration,
            lastSettledOperationId: args.taskCompletionId || checkpoint.lastSettledOperationId,
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
        if (activeWorkflow) {
            args.hostedSession.setActiveExecutionWorkflow({
                ...activeWorkflow,
                validationGeneration: claim.checkpoint.generation,
            });
        }
        const result = await runValidationLoop({
            ...args,
            planContent: claim.planContent,
            triageMeta: claim.triageMeta,
            executionContext: undefined,
            continuationPhase: claim.checkpoint.nextPhase,
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
