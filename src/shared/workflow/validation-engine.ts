/**
 * @module shared/workflow/validation-engine
 * The session-independent Workflow Validation engine: the phase loop, the
 * phase-selection gates, and the canonical Plan loader.
 *
 * The engine decides *what* validation does. It never touches Pi/session machinery
 * directly: everything session-shaped arrives through the
 * {@link ValidationSessionPort} argument, which SessionRuntime's `validation.ts`
 * builds from a HostedSession and the Attached coordinator will implement from its
 * own record. Plan Lifecycle, transitions, registry writes and locks stay direct
 * imports — they are RunWield's own machinery, never ports.
 */

import { extractYaml } from "@std/front-matter";
import { loadPlan } from "../../plan-store.js";
import { PLAN_STATUSES, VALIDATION_PLAN_STATUSES } from "./plan-lifecycle.js";
import { getProjectRoot, recordLifecycleEvent } from "./validation-context.ts";
import { emitStatus } from "./validation-emit.ts";
import { validationPhaseForStatus } from "./validation-checkpoint.ts";
import {
    buildValidationUserMessage,
    validationPhasePauseMessage,
    validationUserMessage,
} from "./validation-user-messages.ts";
import { runMechanicalValidationPhase } from "./validation-mechanical.ts";
import { runSemanticReviewPhase, runValidatedReviewerPhase } from "./validation-semantic.ts";
import type { ValidationPhaseName } from "./validation-ports.ts";
import type {
    PlanEventStatus,
    ValidationLoopArgs,
    ValidationPhaseResult,
    WorkflowValidationResult,
} from "./validation-types.ts";
import { MAX_PHASES_PER_CALL, PHASE_STATUS, VALIDATION_STATUS_ORDER } from "./validation-types.ts";

type PlanStatus = "implemented" | "validated_ci" | "validated_reviewer";
type PlanFrontMatter = import("../../plan-store.js").PlanFrontMatter;

/**
 * One phase for the Plan's current status. Reads canonical state; holds none.
 *
 * Exported for tests that assert a single phase boundary. Production callers use
 * {@link runValidationLoop}, which drives phases until the Plan stops moving.
 */
export async function runValidationPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const canonicalPlan = await loadCanonicalValidationPlan(args);
    if (canonicalPlan.kind === "blocked") return canonicalPlan.result;
    const canonicalArgs: ValidationLoopArgs = {
        ...args,
        triageMeta: canonicalPlan.attrs as ValidationLoopArgs["triageMeta"],
        planContent: canonicalPlan.markdown,
    };
    const nextPhase = resolveNextPhase(args, canonicalPlan.status);
    if (await healStatusAheadOfPhase(canonicalArgs, nextPhase, canonicalPlan.status)) {
        return await runMechanicalValidationPhase({
            ...canonicalArgs,
            triageMeta: { ...canonicalArgs.triageMeta, status: "implemented" },
        });
    }
    switch (nextPhase) {
        case "mechanical":
            return await runMechanicalValidationPhase(canonicalArgs);
        case "semantic":
            return await runSemanticReviewPhase(canonicalArgs);
        case "delivery":
            return await runValidatedReviewerPhase(canonicalArgs);
    }
}

/**
 * Which phase runs next: the durable supervisor claim, or the canonical Plan.
 *
 * Session memory is not an authority. A new process or Session receives the same
 * phase from the Plan's validation checkpoint.
 */
function resolveNextPhase(
    args: ValidationLoopArgs,
    status: "implemented" | "validated_ci" | "validated_reviewer",
): ValidationPhaseName {
    const fromStatus: ValidationPhaseName = status === "validated_reviewer"
        ? "delivery"
        : status === "validated_ci"
        ? "semantic"
        : "mechanical";
    return args.continuationPhase || fromStatus;
}

/**
 * Pull a Plan back when its status has run ahead of where the loop actually is.
 *
 * The loop remembers dispatching a CI repair and never seeing CI pass; if the Plan
 * meanwhile reads `validated_ci`, something else moved it — a repair Agent's
 * `task_completed` is the one that happens — and the checks it claims to have
 * passed never ran. Recording the phase's own outcome against that status is
 * refused by the lifecycle guard, correctly, so the drift has to be undone rather
 * than worked around: `validation_failed` is legal from every validation status and
 * lands on `implemented`, which re-runs the checks from the start.
 *
 * Returns whether a heal happened, in which case the mechanical phase runs.
 */
async function healStatusAheadOfPhase(
    args: ValidationLoopArgs,
    phase: ValidationPhaseName,
    status: string,
): Promise<boolean> {
    const expected = VALIDATION_STATUS_ORDER.indexOf(PHASE_STATUS[phase]);
    const actual = VALIDATION_STATUS_ORDER.indexOf(status);
    if (expected < 0 || actual < 0 || actual <= expected) return false;
    const reason = `The Plan was marked ${status} while Workflow Validation was still at ${
        PHASE_STATUS[phase]
    }. Those checks did not run, so validation is starting again from the build.`;
    const projectRoot = getProjectRoot(args);
    emitStatus(args, buildValidationUserMessage({ kind: "status_repaired" }), "warning");
    await recordLifecycleEvent(args, projectRoot, "validation_failed", status as PlanEventStatus, reason);
    return true;
}

/**
 * Run validation until it needs something it cannot supply.
 *
 * Each phase advances the Plan by one status and returns. Something has to run the
 * next one, and that is this: it keeps going while the Plan's status is still
 * moving, and stops the moment a phase parks without moving it — human review
 * awaiting a decision, a dispatched repair, a terminal outcome.
 *
 * Status is the only continuation signal, deliberately. It is durable, it is what
 * `recordPlanEvent` already guards, and re-reading it each turn means this loop
 * carries no state of its own — the thing that made the previous driver
 * untestable. A phase that parks is simply a phase that did not move the Plan.
 */
export async function runValidationLoop(args: ValidationLoopArgs): Promise<WorkflowValidationResult> {
    const projectRoot = getProjectRoot(args);
    let result: ValidationPhaseResult | undefined;
    let phaseArgs = args;
    for (let phase = 0; phase < MAX_PHASES_PER_CALL; phase += 1) {
        const before = (await loadPlan(projectRoot, args.planName))?.frontMatterRevision;
        result = await runValidationPhase(phaseArgs);
        if (result.kind !== "paused") {
            // Verified/failed finish; a semantic repair handoff pauses outside this activated operation.
            if (result.kind !== "semantic_repair_handoff") args.session.clearPosition(args.planName);
            return result;
        }
        // A mechanical repair turn is not a completion signal. The repair Agent
        // must explicitly call task_completed before this invocation may run CI
        // again; otherwise a question or ordinary text response could advance the
        // Plan merely because failure-attempt bookkeeping changed Front Matter.
        if (result.awaitingTaskCompletion) return result;
        const after = (await loadPlan(projectRoot, args.planName))?.frontMatterRevision;
        // Front Matter revision, not status: human review reaches a decision without
        // changing status, and publication is what runs next. Comparing status alone
        // parked every Plan at `validated_reviewer` with its review already decided.
        if (after === before) return result;
        // The caller's execution context described the world before validation began.
        // It is worth checking against once — a caller pointing at the wrong worktree
        // must not be humoured — but every phase after the first runs in the workflow
        // validation itself established, and a repair legitimately rebuilds that. Held
        // any longer, the snapshot goes stale and its contradiction check ends the run:
        // a semantic repair would land, round two would never open, and the workflow
        // stopped without a word.
        phaseArgs = { ...phaseArgs, executionContext: undefined, continuationPhase: undefined };
    }
    const plan = await loadPlan(projectRoot, args.planName);
    const phase = validationPhaseForStatus(plan?.attrs.status);
    emitStatus(args, validationUserMessage("retry_pause"), "warning");
    return {
        kind: "paused",
        planName: args.planName,
        projectRoot,
        classification: plan?.attrs.classification,
        reason: validationPhasePauseMessage(phase || undefined),
    };
}

export async function loadCanonicalValidationPlan(
    args: ValidationLoopArgs,
): Promise<
    | {
        kind: "ok";
        status: "implemented" | "validated_ci" | "validated_reviewer";
        attrs: PlanFrontMatter;
        markdown: string;
    }
    | { kind: "blocked"; result: ValidationPhaseResult }
> {
    const projectRoot = getProjectRoot(args);
    const plan = await loadPlan(projectRoot, args.planName);
    if (!plan) {
        return {
            kind: "blocked",
            result: {
                kind: "failed",
                planName: args.planName,
                projectRoot,
                reason: `Plan not found: ${args.planName}`,
            },
        };
    }
    const rawStatus = getPlanContentStatus(plan.markdown);
    if (rawStatus !== undefined && !PLAN_STATUSES.includes(rawStatus as PlanStatus)) {
        return {
            kind: "blocked",
            result: {
                kind: "failed",
                planName: args.planName,
                projectRoot,
                reason: `Plan has unknown status: ${rawStatus}`,
            },
        };
    }
    const status = plan.attrs.status;
    if (!VALIDATION_PLAN_STATUSES.includes(status as PlanStatus)) {
        return {
            kind: "blocked",
            result: {
                kind: "failed",
                planName: args.planName,
                projectRoot,
                reason: `Workflow Validation cannot run from Plan status "${status}".`,
            },
        };
    }
    return {
        kind: "ok",
        status: status as "implemented" | "validated_ci" | "validated_reviewer",
        attrs: plan.attrs,
        markdown: plan.markdown,
    };
}

export function getPlanContentStatus(planContent: string): string | undefined {
    if (!planContent.startsWith("---")) return undefined;
    const parsed = extractYaml(planContent) as { attrs?: { status?: string } };
    return typeof parsed.attrs?.status === "string" ? parsed.attrs.status : undefined;
}
