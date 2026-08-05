/**
 * @module shared/workflow/validation-mechanical
 * The Mechanical Validation phase: CI, Objective-Failing Checks, and the repair
 * dispatches that send the execution Agent back when either fails.
 */

import { isPlannedChangeClassification } from "../../constants.js";
import { type ObjectiveCheckResult, runObjectiveChecks, summarizeObjectiveChecks } from "./objective-checks.ts";
import type { ValidationLocalCIResult } from "./validation-ports.ts";
import type {
    ObjectiveCheckPhaseOutcome,
    PhaseContext,
    UserActionPause,
    ValidationLoopArgs,
    ValidationPhaseResult,
} from "./validation-types.ts";
import {
    preserveValidationContinuationState,
    readCiAttempts,
    readSemanticRound,
    recordLifecycleEvent,
    recordMetric,
    resolvePhaseContext,
} from "./validation-context.ts";
import { AUTOMATIC_ROUNDS } from "./validation-types.ts";
import { clampCycle, emitProgress, emitStatus } from "./validation-emit.ts";
import { pauseForUserAction } from "./validation-interactions.ts";

export async function runMechanicalValidationPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const phase = await resolvePhaseContext(args);
    if (phase.kind === "blocked") return phase.result;

    const localCI = args.localCI;
    // Counted here rather than re-read from `args` each pass, because a user Retry
    // buys a fresh set of rounds: the `validation_failed` recorded below resets the
    // durable counter, and this has to follow it or the very next run would report
    // the limit again without running anything.
    let attempts = readCiAttempts(args.triageMeta);

    for (;;) {
        // A test suite can run for minutes. Saying so beforehand is the difference
        // between "it is working" and "it has hung" — publication had gone quiet here
        // too, leaving the longest wait in the workflow completely unannounced.
        emitProgress(args, `Running CI Validation in ${phase.context.executionCwd}.`, "info", {
            outcome: "running",
            stage: "ci",
            repairAttempt: attempts > 0 ? clampCycle(attempts) : null,
            maxRepairAttempts: attempts > 0 ? AUTOMATIC_ROUNDS : null,
            checks: { ci: "running" },
        });
        const ciResult = await localCI.run({ cwd: phase.context.executionCwd });
        await recordMetric(args, phase.context.projectRoot, {
            category: "validation",
            event: "ci_attempt",
            planName: args.planName,
            details: {
                semanticRound: readSemanticRound(args.triageMeta) + 1,
                mechanicalAttempt: attempts + 1,
                exitCode: ciResult.exitCode,
                passed: ciResult.exitCode === 0,
                canceled: ciResult.canceled === true,
            },
        });
        if (ciResult.canceled) {
            const pause: UserActionPause = {
                whatHappened:
                    `The tests for "${args.planName}" were stopped before they finished, so RunWield cannot tell yet whether the work is good.`,
                doThis: "Pick Retry to run them again, or Stop to come back to this later.",
            };
            if (await pauseForUserAction(args, pause) === "retry") continue;
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason: `${pause.whatHappened} Run this Plan again when you are ready.`,
            };
        }
        if (ciResult.exitCode === 0) {
            const objectiveCheckOutcome = await runPlanObjectiveChecks(args, phase.context, attempts);
            if (objectiveCheckOutcome.kind === "canceled") {
                // Same resumable pause as canceled CI: no lifecycle failure, no
                // Engineer repair, and the Plan stays `implemented` for Retry.
                const pause: UserActionPause = {
                    whatHappened:
                        `The Objective-Failing Checks for "${args.planName}" were stopped before they finished, so RunWield cannot tell yet whether the work is good.`,
                    doThis: "Pick Retry to run them again, or Stop to come back to this later.",
                };
                if (await pauseForUserAction(args, pause) === "retry") continue;
                return {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason: `${pause.whatHappened} Run this Plan again when you are ready.`,
                };
            }
            if (objectiveCheckOutcome.kind === "passed") {
                await recordLifecycleEvent(
                    args,
                    phase.context.projectRoot,
                    "mechanical_validation_passed",
                    "implemented",
                );
                preserveValidationContinuationState(args, phase.context);
                emitProgress(args, "Build, tests, and Objective-Failing Checks passed.", "success", {
                    stage: "cycle",
                    checks: { ci: "passed" },
                });
                return {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason: "Mechanical Validation passed.",
                };
            }
            if (objectiveCheckOutcome.kind === "skipped") {
                await recordLifecycleEvent(
                    args,
                    phase.context.projectRoot,
                    "mechanical_validation_passed",
                    "implemented",
                );
                preserveValidationContinuationState(args, phase.context);
                emitProgress(args, "Build and tests passed.", "success", {
                    stage: "cycle",
                    checks: { ci: "passed" },
                });
                return {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason: "Mechanical Validation passed.",
                };
            }
            if (objectiveCheckOutcome.kind === "broken") {
                await recordLifecycleEvent(
                    args,
                    phase.context.projectRoot,
                    "validation_failed",
                    "implemented",
                    objectiveCheckOutcome.reason,
                );
                return {
                    kind: "failed",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason: objectiveCheckOutcome.reason,
                };
            }

            attempts += 1;
            if (attempts >= AUTOMATIC_ROUNDS) {
                await recordLifecycleEvent(
                    args,
                    phase.context.projectRoot,
                    "validation_failed",
                    "implemented",
                    objectiveCheckOutcome.reason,
                );
                const pause: UserActionPause = {
                    whatHappened: `The Objective-Failing Checks for "${args.planName}" are still unmet. ${
                        args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                    } tried ${AUTOMATIC_ROUNDS} times and could not satisfy them.`,
                    doThis:
                        `Take a look yourself in ${phase.context.executionCwd}. When you think it is fixed, pick Retry and RunWield will run validation again and carry on from there.`,
                    details: [objectiveCheckOutcome.reason],
                };
                if (await pauseForUserAction(args, pause) === "retry") {
                    attempts = 0;
                    continue;
                }
                return {
                    kind: "failed",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason: `${pause.whatHappened} ${pause.doThis}`,
                };
            }

            const repairCompleted = await dispatchObjectiveCheckRepair(
                args,
                phase.context,
                objectiveCheckOutcome.results,
            );
            await recordLifecycleEvent(
                args,
                phase.context.projectRoot,
                "mechanical_validation_failed",
                "implemented",
                objectiveCheckOutcome.reason,
            );
            if (!repairCompleted) {
                const reason = `${
                    args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                } stopped without task_completed during Objective-Failing Check repair.`;
                emitStatus(
                    args,
                    `${reason} Validation will resume after task_completed.`,
                    "warning",
                );
                return {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason,
                    awaitingTaskCompletion: true,
                };
            }
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason: "Mechanical Validation failed; Objective-Failing Check repair required.",
            };
        }

        const failureReason = getCiFailureReason(ciResult);
        attempts += 1;
        if (attempts >= AUTOMATIC_ROUNDS) {
            // Clears the durable attempt count, so a Retry gets a full set of rounds
            // rather than landing straight back on this limit.
            await recordLifecycleEvent(
                args,
                phase.context.projectRoot,
                "validation_failed",
                "implemented",
                failureReason,
            );
            const pause: UserActionPause = {
                whatHappened: `The tests for "${args.planName}" are still failing. ${
                    args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                } tried ${AUTOMATIC_ROUNDS} times and could not get them passing.`,
                doThis:
                    `Take a look yourself in ${phase.context.executionCwd}. When you think it is fixed, pick Retry and RunWield will run the tests again and carry on from there.`,
                details: failureReason ? [failureReason] : undefined,
            };
            if (await pauseForUserAction(args, pause) === "retry") {
                attempts = 0;
                continue;
            }
            return {
                kind: "failed",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason: `${pause.whatHappened} ${pause.doThis}`,
            };
        }

        const repairCompleted = await dispatchCiRepair(args, phase.context, ciResult);
        await recordLifecycleEvent(
            args,
            phase.context.projectRoot,
            "mechanical_validation_failed",
            "implemented",
            failureReason,
        );
        if (!repairCompleted) {
            const reason = `${
                args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
            } stopped without task_completed during CI repair.`;
            emitStatus(
                args,
                `${reason} Validation will resume after task_completed.`,
                "warning",
            );
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason,
                awaitingTaskCompletion: true,
            };
        }
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: phase.context.projectRoot,
            reason: "Mechanical Validation failed; repair required.",
        };
    }
}

export async function runPlanObjectiveChecks(
    args: ValidationLoopArgs,
    context: PhaseContext,
    attempts: number,
): Promise<ObjectiveCheckPhaseOutcome> {
    if (!isPlannedChangeClassification(args.triageMeta.classification)) return { kind: "skipped" };
    const checks = args.triageMeta.objectiveChecks || [];
    if (!checks.length) return { kind: "skipped" };

    emitStatus(
        args,
        `Running Objective-Failing Checks for ${args.planName}: ${checks.map((check) => check.id).join(", ")}.`,
    );
    // Register the whole phase as a Session active interaction so Escape reaches
    // it exactly like it reaches local CI: one abort, whole process trees stop,
    // and remaining checks are never scheduled.
    const interactionId = `objective-checks:${args.planName}:${Date.now()}`;
    const abortController = new AbortController();
    args.session.registerActiveInteraction(interactionId, abortController);
    let results: ObjectiveCheckResult[];
    try {
        results = await runObjectiveChecks({
            checks,
            cwd: context.executionCwd,
            signal: abortController.signal,
        });
    } finally {
        args.session.unregisterActiveInteraction(interactionId);
    }
    const canceled = abortController.signal.aborted;
    const summary = summarizeObjectiveChecks(results);
    await recordMetric(args, context.projectRoot, {
        category: "validation",
        event: "objective_checks_attempt",
        planName: args.planName,
        details: {
            mechanicalAttempt: attempts + 1,
            total: summary.total,
            met: summary.met,
            unmet: summary.unmet,
            broken: summary.broken,
            canceled,
            checks: results.map((result) => ({ id: result.id, status: result.status, exitCode: result.exitCode })),
        },
    });
    if (canceled) {
        // Cancellation is a user pause, not a check defect: report it apart from
        // broken/unmet so the caller never stages a failure or a repair for it.
        emitStatus(args, "Objective-Failing Checks canceled.", "warning");
        return { kind: "canceled" };
    }
    emitStatus(args, summary.block, summary.broken || summary.unmet ? "warning" : "success");
    if (summary.broken > 0) {
        return { kind: "broken", reason: `Objective-Failing Check defect.\n\n${summary.block}`, results };
    }
    if (summary.unmet > 0) {
        return { kind: "unmet", reason: `Objective-Failing Checks unmet.\n\n${summary.block}`, results };
    }
    return { kind: "passed" };
}

export async function dispatchObjectiveCheckRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    results: ObjectiveCheckResult[],
): Promise<boolean> {
    const summary = summarizeObjectiveChecks(results);
    args.session.setActiveWorkflow({ ...context.workflowBase });
    emitStatus(
        args,
        `Objective-Failing Checks are unmet. Dispatching ${
            args.session.getAgentDisplayName(context.executionAgent, context.projectRoot)
        } to satisfy them...`,
        "warning",
    );
    const outcome = await args.session.runActiveAgentTurn({
        agentName: context.executionAgent,
        userRequest:
            "The Plan failed Objective-Failing Checks during Mechanical Validation. Fix the implementation so these checks exit 0, then call task_completed when the repair is complete. Do not edit the Plan checks unless the user explicitly asks for a new Plan review. If the repair involves tests, follow the write-tests skill for sound testing behavior:\n\n" +
            summary.block,
        cwd: context.executionCwd,
    });
    return outcome.completed;
}

export async function dispatchCiRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    ciResult: ValidationLocalCIResult,
): Promise<boolean> {
    args.session.setActiveWorkflow({ ...context.workflowBase });
    // Pin the loop here before the Agent runs. The repair reports `task_completed`
    // into the root transcript, which is also what marks a Plan implemented — so
    // without this the next phase reads an advanced status and jumps past the CI
    // that has not passed yet.
    args.session.rememberPosition(args.planName, {
        phase: "mechanical",
        awaiting: "ci_repair",
    });
    emitProgress(
        args,
        `Build failed. Dispatching ${
            args.session.getAgentDisplayName(context.executionAgent, context.projectRoot)
        } to fix the CI failure...`,
        "warning",
        { outcome: "running", stage: "engineer_repair", checks: { ci: "failed" } },
    );
    const outcome = await args.session.runActiveAgentTurn({
        agentName: context.executionAgent,
        userRequest:
            "The project failed CI validation. Fix the following build errors, then call task_completed when the repair is complete. If the repair involves tests, follow the write-tests skill for sound testing behavior:\n\n" +
            getCiFailureReason(ciResult),
        cwd: context.executionCwd,
    });
    return outcome.completed;
}

export function getCiFailureReason(ciResult: ValidationLocalCIResult): string {
    const output = "output" in ciResult && typeof ciResult.output === "string" ? ciResult.output : "";
    return output || "Mechanical Validation failed.";
}
