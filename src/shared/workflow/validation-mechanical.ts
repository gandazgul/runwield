/**
 * @module shared/workflow/validation-mechanical
 * The Mechanical Validation phase: CI, Objective-Failing Checks, and the repair
 * dispatches that send the execution Agent back when either fails.
 */

import { isPlannedChangeClassification } from "../../constants.js";
import { type ObjectiveCheckResult, runObjectiveChecks, summarizeObjectiveChecks } from "./objective-checks.ts";
import { objectiveChecksWithoutWaivers, persistObjectiveCheckWaiver } from "./objective-check-waivers.ts";
import type { ValidationLocalCIResult } from "./validation-ports.ts";
import type {
    BrokenObjectiveCheckReport,
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
import { AUTOMATIC_ROUNDS, type UserActionOption } from "./validation-types.ts";
import { clampCycle, emitProgress, emitStatus } from "./validation-emit.ts";
import { pauseForUserAction, requestInteraction } from "./validation-interactions.ts";
import { type AgentTurnOutcome, ValidationInteractionTypes } from "./validation-ports.ts";
import { buildValidationRepairPrompt } from "./validation-repair-prompt.ts";

const ENGINEER_FOLLOW_UP_OPTIONS: UserActionOption[] = [
    { value: "engineer_follow_up", label: "Engineer follow-up" },
    { value: "retry", label: "Retry" },
    { value: "stop", label: "Stop" },
];

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
                doThis: `Pick Engineer follow-up to return to the ${
                    args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                } session, Retry to run them again now, or Stop to come back to this later.`,
                options: ENGINEER_FOLLOW_UP_OPTIONS,
            };
            const action = await pauseForUserAction(args, pause);
            if (action === "retry") continue;
            if (action === "engineer_follow_up") {
                return pauseForEngineerFollowUp(args, phase.context, pause.whatHappened);
            }
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
                    doThis: `Pick Engineer follow-up to return to the ${
                        args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                    } session, Retry to run them again now, or Stop to come back to this later.`,
                    options: ENGINEER_FOLLOW_UP_OPTIONS,
                };
                const action = await pauseForUserAction(args, pause);
                if (action === "retry") continue;
                if (action === "engineer_follow_up") {
                    return pauseForEngineerFollowUp(args, phase.context, pause.whatHappened);
                }
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
                const reported = Array.isArray(
                        (args.triageMeta as { engineerReportedBrokenObjectiveChecks?: unknown })
                            .engineerReportedBrokenObjectiveChecks,
                    )
                    ? resolveEngineerReportedBrokenChecks(
                        args.triageMeta.objectiveChecks || [],
                        (args.triageMeta as { engineerReportedBrokenObjectiveChecks: BrokenObjectiveCheckReport[] })
                            .engineerReportedBrokenObjectiveChecks,
                    )
                    : [];
                const reportedIds = new Set(reported.map((result) => result.id));
                const source = reportedIds.size && objectiveCheckOutcome.results.some((result) =>
                        reportedIds.has(result.id)
                    )
                    ? "engineer_report"
                    : "mechanical_detection";
                const judgement = await requestObjectiveCheckWaiver(
                    args,
                    phase.context,
                    objectiveCheckOutcome.reason,
                    objectiveCheckOutcome.results,
                    source,
                );
                const waived = judgement.kind === "waived";
                if (waived) {
                    await recordLifecycleEvent(
                        args,
                        phase.context.projectRoot,
                        "mechanical_validation_passed",
                        "implemented",
                    );
                    preserveValidationContinuationState(args, phase.context);
                    emitProgress(
                        args,
                        "Build and tests passed; broken Objective-Failing Checks were waived by user.",
                        "success",
                        {
                            stage: "cycle",
                            checks: { ci: "passed" },
                        },
                    );
                    return {
                        kind: "paused",
                        planName: args.planName,
                        projectRoot: phase.context.projectRoot,
                        reason: "Mechanical Validation passed with Objective-Failing Check waiver.",
                    };
                }
                const repair = await dispatchObjectiveCheckRepair(
                    args,
                    phase.context,
                    objectiveCheckOutcome.results,
                    judgement.feedback,
                );
                await recordLifecycleEvent(
                    args,
                    phase.context.projectRoot,
                    "mechanical_validation_failed",
                    "implemented",
                    judgement.feedback || objectiveCheckOutcome.reason,
                );
                if (!repair.completed) {
                    const reason = `${
                        args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                    } stopped without task_completed during broken Objective-Failing Check repair.`;
                    emitStatus(args, `${reason} Validation will resume after task_completed.`, "warning");
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
                    reason: "Objective-Failing Check waiver was rejected; repair required.",
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
                    doThis: `Pick Engineer follow-up to return to the ${
                        args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                    } session, Retry only after you fixed the checks outside RunWield, or Stop to come back to this later.`,
                    details: [summarizeObjectiveChecks(objectiveCheckOutcome.results).compactBlock],
                    options: ENGINEER_FOLLOW_UP_OPTIONS,
                };
                const action = await pauseForUserAction(args, pause);
                if (action === "retry") {
                    attempts = 0;
                    continue;
                }
                if (action === "engineer_follow_up") {
                    return pauseForEngineerFollowUp(args, phase.context, objectiveCheckOutcome.reason);
                }
                return {
                    kind: "failed",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason: `${pause.whatHappened} ${pause.doThis}`,
                };
            }

            const repair = await dispatchObjectiveCheckRepair(
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
            if (!repair.completed) {
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
            if (repair.brokenObjectiveChecks.length) {
                const reportedResults = resolveEngineerReportedBrokenChecks(
                    args.triageMeta.objectiveChecks || [],
                    repair.brokenObjectiveChecks,
                );
                const rerun = await runPlanObjectiveChecks(args, phase.context, attempts);
                if (rerun.kind === "passed" || rerun.kind === "skipped") {
                    await recordLifecycleEvent(
                        args,
                        phase.context.projectRoot,
                        "mechanical_validation_passed",
                        "implemented",
                    );
                    preserveValidationContinuationState(args, phase.context);
                    return {
                        kind: "paused",
                        planName: args.planName,
                        projectRoot: phase.context.projectRoot,
                        reason: "Mechanical Validation passed.",
                    };
                }
                if (rerun.kind === "broken") {
                    const reportedIds = new Set(reportedResults.map((reported) => reported.id));
                    const reportedBrokenResults = rerun.results.filter((result) =>
                        result.status === "broken" && reportedIds.has(result.id)
                    );
                    if (reportedBrokenResults.length) {
                        const judgement = await requestObjectiveCheckWaiver(
                            args,
                            phase.context,
                            `Engineer reported broken Objective-Failing Checks after repair.\n\n${
                                summarizeObjectiveChecks(reportedResults).block
                            }\n\nRerun result:\n\n${rerun.reason}`,
                            reportedBrokenResults,
                            "engineer_report",
                        );
                        if (judgement.kind === "waived") {
                            const remainingUnmet = rerun.results.filter((result) =>
                                result.status !== "met" && !reportedIds.has(result.id)
                            );
                            if (!remainingUnmet.length) {
                                await recordLifecycleEvent(
                                    args,
                                    phase.context.projectRoot,
                                    "mechanical_validation_passed",
                                    "implemented",
                                );
                                preserveValidationContinuationState(args, phase.context);
                                return {
                                    kind: "paused",
                                    planName: args.planName,
                                    projectRoot: phase.context.projectRoot,
                                    reason:
                                        "Mechanical Validation passed with Engineer-reported Objective-Failing Check waiver.",
                                };
                            }
                        } else {
                            await dispatchObjectiveCheckRepair(args, phase.context, rerun.results, judgement.feedback);
                            return {
                                kind: "paused",
                                planName: args.planName,
                                projectRoot: phase.context.projectRoot,
                                reason: "Objective-Failing Check waiver was rejected; repair required.",
                            };
                        }
                    }
                }
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
                doThis: `Pick Engineer follow-up to return to the ${
                    args.session.getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                } session, Retry only after you fixed the tests outside RunWield, or Stop to come back to this later.`,
                details: failureReason ? [failureReason] : undefined,
                options: ENGINEER_FOLLOW_UP_OPTIONS,
            };
            const action = await pauseForUserAction(args, pause);
            if (action === "retry") {
                attempts = 0;
                continue;
            }
            if (action === "engineer_follow_up") return pauseForEngineerFollowUp(args, phase.context, failureReason);
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

function pauseForEngineerFollowUp(
    args: ValidationLoopArgs,
    context: PhaseContext,
    reason: string,
): ValidationPhaseResult {
    args.session.setActiveWorkflow({ ...context.workflowBase });
    emitStatus(
        args,
        `Validation is paused. Send follow-up instructions to ${
            args.session.getAgentDisplayName(context.executionAgent, context.projectRoot)
        } in this session when you are ready.`,
        "warning",
    );
    return {
        kind: "paused",
        planName: args.planName,
        projectRoot: context.projectRoot,
        reason: `Mechanical Validation paused for ${
            args.session.getAgentDisplayName(context.executionAgent, context.projectRoot)
        } follow-up. ${reason}`,
    };
}

export async function runPlanObjectiveChecks(
    args: ValidationLoopArgs,
    context: PhaseContext,
    attempts: number,
): Promise<ObjectiveCheckPhaseOutcome> {
    if (!isPlannedChangeClassification(args.triageMeta.classification)) return { kind: "skipped" };
    const checks = args.triageMeta.objectiveChecks || [];
    if (!checks.length) return { kind: "skipped" };
    const activeChecks = objectiveChecksWithoutWaivers(checks, args.triageMeta.objectiveCheckWaivers);
    if (!activeChecks.length) {
        emitStatus(args, `All Objective-Failing Checks for ${args.planName} are waived; skipping them.`, "success");
        return { kind: "passed" };
    }
    const skippedCount = checks.length - activeChecks.length;

    emitStatus(
        args,
        `Running Objective-Failing Checks for ${args.planName}: ${activeChecks.map((check) => check.id).join(", ")}.${
            skippedCount ? ` Skipping ${skippedCount} waived check${skippedCount === 1 ? "" : "s"}.` : ""
        }`,
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
            checks: activeChecks,
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
    emitStatus(args, summary.compactBlock, summary.broken || summary.unmet ? "warning" : "success");
    if (summary.broken > 0) {
        return { kind: "broken", reason: `Objective-Failing Check defect.\n\n${summary.block}`, results };
    }
    if (summary.unmet > 0) {
        return { kind: "unmet", reason: `Objective-Failing Checks unmet.\n\n${summary.block}`, results };
    }
    return { kind: "passed" };
}

export async function requestObjectiveCheckWaiver(
    args: ValidationLoopArgs,
    context: PhaseContext,
    reason: string,
    results: ObjectiveCheckResult[],
    source: "mechanical_detection" | "engineer_report",
): Promise<{ kind: "waived" } | { kind: "rejected"; feedback: string }> {
    const prompt = source === "engineer_report"
        ? `The execution agent reported broken Objective-Failing Checks for "${args.planName}".`
        : `RunWield detected broken Objective-Failing Checks for "${args.planName}".`;
    emitStatus(
        args,
        `${prompt}\n\n${reason}\n\nAccept a waiver only if the check itself is broken and the implementation should continue.`,
        "warning",
    );
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt: `${prompt}\n\n${reason}\n\nWhat should RunWield do?`,
        options: [
            { value: "waive", label: "Waive broken checks" },
            { value: "retry", label: "Retry later" },
            { value: "stop", label: "Stop" },
        ],
    });
    if (response.outcome !== "selected" || response.value !== "waive") {
        const feedbackResponse = await requestInteraction(args, {
            type: ValidationInteractionTypes.TEXT,
            prompt: "Tell the Engineer what to fix about these broken Objective-Failing Checks.",
            defaultValue:
                "The broken Objective-Failing Check waiver was rejected. Fix the check definition or implementation so validation can make a reliable decision.",
        });
        const feedback = typeof feedbackResponse.value === "string" && feedbackResponse.value.trim()
            ? feedbackResponse.value.trim()
            : "The broken Objective-Failing Check waiver was rejected. Fix the check definition or implementation so validation can make a reliable decision.";
        return { kind: "rejected", feedback };
    }
    const noteResponse = await requestInteraction(args, {
        type: ValidationInteractionTypes.TEXT,
        prompt: "Optional note for the Objective Check waiver record.",
        allowEmpty: true,
    });
    const userNote = typeof noteResponse.value === "string" ? noteResponse.value.trim() : "";
    await persistObjectiveCheckWaiver({
        projectRoot: context.projectRoot,
        planName: args.planName,
        recoveryAttrs: { ...args.triageMeta },
        existingWaivers: args.triageMeta.objectiveCheckWaivers,
        source,
        explanation: reason,
        ...(userNote ? { userNote } : {}),
        results,
    });
    return { kind: "waived" };
}

function resolveEngineerReportedBrokenChecks(
    checks: Array<{ id: string; command: string; rationale?: string }>,
    reports: BrokenObjectiveCheckReport[],
): ObjectiveCheckResult[] {
    return reports.map((report) => {
        const check = checks.find((candidate) => candidate.id === report.id);
        const command = report.command || check?.command || "reported-command-unknown";
        return {
            id: report.id,
            command,
            ...(check?.rationale ? { rationale: check.rationale } : {}),
            status: "broken" as const,
            stdout: "",
            stderr: "",
            exitCode: null,
            durationMs: 0,
            output: "",
            reason: report.explanation,
        };
    });
}

export async function dispatchObjectiveCheckRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    results: ObjectiveCheckResult[],
    feedback = "",
): Promise<AgentTurnOutcome> {
    const summary = summarizeObjectiveChecks(results);
    args.session.setActiveWorkflow({ ...context.workflowBase });
    emitStatus(
        args,
        `Objective-Failing Checks are unmet. Dispatching ${
            args.session.getAgentDisplayName(context.executionAgent, context.projectRoot)
        } to satisfy them...`,
        "warning",
    );
    return await args.session.runIndependentRepairTurn({
        agentName: context.executionAgent,
        userRequest: buildValidationRepairPrompt({
            planName: args.planName,
            projectRoot: context.projectRoot,
            executionCwd: context.executionCwd,
            repairCwd: context.executionCwd,
            includePlanLink: isPlannedChangeClassification(args.triageMeta.classification),
            worktreeId: context.worktreeId,
            worktreeBranch: context.worktreeBranch,
            worktreeBaseBranch: context.worktreeBaseBranch,
            repairsNeeded: [
                "First diagnose each failed Objective-Failing Check. Classify it as either an implementation defect or a defective check. A check is defective when its command cannot prove the objective, including when a test filter selects zero tests, a named test or file does not exist, the command is invalid, or the environment cannot run it reliably. For an implementation defect, repair the implementation and rerun the check. For a defective check, do not change unrelated implementation or repeatedly rerun it: call task_completed with a brokenObjectiveChecks entry that includes the check id, its command when known, and the concrete evidence that makes the check defective. RunWield will ask the user whether to waive it. Do not edit the approved Plan check unless the user explicitly asks for Plan review. If the repair involves tests, follow the write-tests skill for sound testing behavior.",
                ...(feedback ? [`User feedback:\n${feedback}`] : []),
                summary.block,
            ].join("\n\n"),
        }),
        cwd: context.executionCwd,
    });
}

export async function dispatchCiRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    ciResult: ValidationLocalCIResult,
): Promise<boolean> {
    args.session.setActiveWorkflow({ ...context.workflowBase });
    // Pin the loop before the independent repair runs. Plan state can advance while
    // the repair is active, but this CI attempt has not passed. The remembered phase
    // prevents a later dispatch from trusting that newer status and skipping CI.
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
    const outcome = await args.session.runIndependentRepairTurn({
        agentName: context.executionAgent,
        userRequest: buildValidationRepairPrompt({
            planName: args.planName,
            projectRoot: context.projectRoot,
            executionCwd: context.executionCwd,
            repairCwd: context.executionCwd,
            includePlanLink: isPlannedChangeClassification(args.triageMeta.classification),
            worktreeId: context.worktreeId,
            worktreeBranch: context.worktreeBranch,
            worktreeBaseBranch: context.worktreeBaseBranch,
            repairsNeeded:
                "The project failed CI validation. Fix the build errors below. If the repair involves tests, follow the write-tests skill for sound testing behavior.\n\n" +
                getCiFailureReason(ciResult),
        }),
        cwd: context.executionCwd,
    });
    return outcome.completed;
}

export function getCiFailureReason(ciResult: ValidationLocalCIResult): string {
    const output = "output" in ciResult && typeof ciResult.output === "string" ? ciResult.output : "";
    return output || "Mechanical Validation failed.";
}
