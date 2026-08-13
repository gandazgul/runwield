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
import type { WorkflowValidationResult } from "./validation-types.ts";
import { validationUserMessage } from "./validation-user-messages.ts";

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
    | { kind: "active"; projectRoot: string };

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

async function claimValidation(args: ContinueWorkflowValidationArgs): Promise<ClaimResult> {
    const projectRoot = args.hostedSession.cwd;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const plan = await loadPlan(projectRoot, args.planName);
        if (!plan) throw new Error(`Plan not found: ${args.planName}`);
        const phase = validationPhaseForStatus(plan.attrs.status);
        if (!phase) {
            return {
                kind: "claimed",
                checkpoint: makeValidationCheckpoint({
                    attemptId: plan.attrs.worktreeId || "in-place",
                    generation: crypto.randomUUID(),
                    status: plan.attrs.status,
                    phase: "delivery",
                    state: "ready",
                }),
                planContent: plan.markdown,
                triageMeta: plan.attrs as ValidationLoopArgs["triageMeta"],
            };
        }
        const prior = checkpointRecord(plan.attrs.validationCheckpoint);
        if (prior && prior.attemptId === (plan.attrs.worktreeId || "in-place") && await ownerIsAlive(prior)) {
            return { kind: "active", projectRoot };
        }
        const checkpoint = makeValidationCheckpoint({
            attemptId: plan.attrs.worktreeId || "in-place",
            generation: prior?.generation || crypto.randomUUID(),
            status: plan.attrs.status,
            phase,
            state: "running",
            ownerPid: Deno.pid,
            ownerHostname: getLockHostname(),
            repairGeneration: prior?.repairGeneration,
            repairKind: prior?.repairKind,
            lastSettledOperationId: prior?.lastSettledOperationId,
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

/** Reconcile canonical Plan state, claim one owner, run, and durably settle. */
export async function continueWorkflowValidation(
    args: ContinueWorkflowValidationArgs,
): Promise<WorkflowValidationResult> {
    // Repair provable RunWield bookkeeping before it can block validation. Doctor
    // never resets working changes or removes an unmerged worktree.
    await runPlansDoctor(args.hostedSession.cwd, true);
    const claim = await claimValidation(args);
    if (claim.kind === "active") {
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: claim.projectRoot,
            reason: validationUserMessage("already_running"),
        };
    }
    try {
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
        });
        await settleValidation(args, claim.checkpoint, result);
        return result;
    } catch (error) {
        const result: WorkflowValidationResult = {
            kind: "paused",
            planName: args.planName,
            projectRoot: args.hostedSession.cwd,
            reason: validationUserMessage("retry_pause"),
        };
        await settleValidation(args, claim.checkpoint, result).catch(() => {});
        console.error("[RunWield] Validation operation failed", error);
        return result;
    }
}
