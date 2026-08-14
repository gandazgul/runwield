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
import {
    applyValidationPlanAmendment,
    detectValidationPlanAmendment,
    validateAmendedObjectiveChecksAgainstBaseline,
} from "./validation-plan-amendment.ts";
import { buildValidationUserMessage, validationUserMessage } from "./validation-user-messages.ts";

const ENGINEER_FOLLOW_UP_OPTIONS: UserActionOption[] = [
    { value: "engineer_follow_up", label: "Engineer follow-up" },
    { value: "retry", label: "Retry" },
    { value: "stop", label: "Stop" },
];

async function resolveValidationPlanAmendment(
    args: ValidationLoopArgs,
    context: PhaseContext,
): Promise<"none" | "amended" | "engineer_follow_up" | "stop"> {
    const proposal = await detectValidationPlanAmendment(context.projectRoot, context.executionCwd, args.planName);
    if (!proposal) return "none";
    try {
        await validateAmendedObjectiveChecksAgainstBaseline(
            context.executionCwd,
            context.baselineTree,
            proposal.changedObjectiveChecks,
        );
    } catch (error) {
        console.error("[RunWield] plan_change_check_failed", error);
        const message = validationUserMessage("amendment_check_failed");
        emitStatus(args, message, "warning");
        const response = await requestInteraction(args, {
            type: ValidationInteractionTypes.SELECT,
            prompt: buildValidationUserMessage({ kind: "amendment_failed_prompt" }),
            options: [
                { value: "engineer_follow_up", label: "Engineer follow-up" },
                { value: "stop", label: "Stop" },
            ],
        });
        return response.outcome === "selected" && response.value === "engineer_follow_up"
            ? "engineer_follow_up"
            : "stop";
    }
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt: buildValidationUserMessage({ kind: "amendment_prompt", summary: proposal.summary }),
        options: [
            { value: "approve_amendment", label: "Approve command changes and retry" },
            { value: "engineer_follow_up", label: "Engineer follow-up" },
            { value: "stop", label: "Stop" },
        ],
    });
    if (response.outcome === "selected" && response.value === "approve_amendment") {
        const canonical = await applyValidationPlanAmendment(
            context.projectRoot,
            context.executionCwd,
            args.planName,
            proposal,
        );
        args.triageMeta = canonical.attrs as ValidationLoopArgs["triageMeta"];
        args.planContent = canonical.markdown;
        emitStatus(
            args,
            buildValidationUserMessage({ kind: "amendment_approved" }),
            "success",
        );
        return "amended";
    }
    if (response.outcome === "selected" && response.value === "engineer_follow_up") return "engineer_follow_up";
    return "stop";
}

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
        const amendmentAction = await resolveValidationPlanAmendment(args, phase.context);
        if (amendmentAction === "amended") {
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason: "Plan Amendment approved; Mechanical Validation will restart with fresh Plan state.",
            };
        }
        if (amendmentAction === "engineer_follow_up") {
            return pauseForEngineerFollowUp(args, phase.context, "Plan Amendment needs Engineer follow-up.");
        }
        if (amendmentAction === "stop") {
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason: "Workflow Validation stopped with a pending Plan Amendment decision.",
            };
        }
        // A test suite can run for minutes. Saying so beforehand is the difference
        // between "it is working" and "it has hung" — publication had gone quiet here
        // too, leaving the longest wait in the workflow completely unannounced.
        emitProgress(
            args,
            buildValidationUserMessage({ kind: "ci_running", cwd: phase.context.executionCwd }),
            "info",
            {
                outcome: "running",
                stage: "ci",
                repairAttempt: attempts > 0 ? clampCycle(attempts) : null,
                maxRepairAttempts: attempts > 0 ? AUTOMATIC_ROUNDS : null,
                checks: { ci: "running" },
            },
        );
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
            const objectiveCheckOutcome = await runPlanObjectiveChecks(
                args,
                phase.context,
                attempts,
                args.engineerReportedBrokenObjectiveChecks || [],
            );
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
                emitProgress(
                    args,
                    buildValidationUserMessage({ kind: "checks_passed", objectiveChecks: true }),
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
                emitProgress(
                    args,
                    buildValidationUserMessage({ kind: "checks_passed", objectiveChecks: false }),
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
                    reason: "Mechanical Validation passed.",
                };
            }
            if (objectiveCheckOutcome.kind === "broken") {
                const source = objectiveCheckOutcome.reason.startsWith("Engineer reported defective")
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
                        buildValidationUserMessage({ kind: "checks_passed", objectiveChecks: true, waived: true }),
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
                if (judgement.kind === "engineer_follow_up") {
                    return pauseForEngineerFollowUp(args, phase.context, objectiveCheckOutcome.reason);
                }
                if (judgement.kind === "stop") {
                    return {
                        kind: "paused",
                        planName: args.planName,
                        projectRoot: phase.context.projectRoot,
                        reason: "Workflow Validation stopped at Objective-Failing Check judgement.",
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
                    emitStatus(
                        args,
                        buildValidationUserMessage({
                            kind: "repair_waiting",
                            agent: args.session.getAgentDisplayName(
                                phase.context.executionAgent,
                                phase.context.projectRoot,
                            ),
                        }),
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
                    buildValidationUserMessage({
                        kind: "repair_waiting",
                        agent: args.session.getAgentDisplayName(
                            phase.context.executionAgent,
                            phase.context.projectRoot,
                        ),
                    }),
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
                const rerun = await runPlanObjectiveChecks(args, phase.context, attempts, repair.brokenObjectiveChecks);
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
                    const reportedBrokenResults = rerun.results.filter((result) => reportedIds.has(result.id));
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
                        } else if (judgement.kind === "engineer_follow_up") {
                            return pauseForEngineerFollowUp(args, phase.context, rerun.reason);
                        } else if (judgement.kind === "stop") {
                            return {
                                kind: "paused",
                                planName: args.planName,
                                projectRoot: phase.context.projectRoot,
                                reason: "Workflow Validation stopped at Objective-Failing Check judgement.",
                            };
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
                buildValidationUserMessage({
                    kind: "repair_waiting",
                    agent: args.session.getAgentDisplayName(
                        phase.context.executionAgent,
                        phase.context.projectRoot,
                    ),
                }),
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
        buildValidationUserMessage({
            kind: "engineer_follow_up",
            agent: args.session.getAgentDisplayName(context.executionAgent, context.projectRoot),
        }),
        "warning",
    );
    return {
        kind: "paused",
        planName: args.planName,
        projectRoot: context.projectRoot,
        reason: `Mechanical Validation paused for ${
            args.session.getAgentDisplayName(context.executionAgent, context.projectRoot)
        } follow-up. ${reason}`,
        awaitingTaskCompletion: true,
    };
}

export async function runPlanObjectiveChecks(
    args: ValidationLoopArgs,
    context: PhaseContext,
    attempts: number,
    engineerReports: BrokenObjectiveCheckReport[] = [],
): Promise<ObjectiveCheckPhaseOutcome> {
    if (!isPlannedChangeClassification(args.triageMeta.classification)) return { kind: "skipped" };
    const checks = args.triageMeta.objectiveChecks || [];
    if (!checks.length) return { kind: "skipped" };
    const activeChecks = objectiveChecksWithoutWaivers(checks, args.triageMeta.objectiveCheckWaivers);
    if (!activeChecks.length) {
        emitStatus(
            args,
            buildValidationUserMessage({ kind: "objective_all_waived", planName: args.planName }),
            "success",
        );
        return { kind: "passed" };
    }
    const skippedCount = checks.length - activeChecks.length;

    emitStatus(
        args,
        buildValidationUserMessage({
            kind: "objective_running",
            planName: args.planName,
            checkIds: activeChecks.map((check) => check.id),
            skippedCount,
        }),
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
        emitStatus(args, buildValidationUserMessage({ kind: "objective_canceled" }), "warning");
        return { kind: "canceled" };
    }
    emitStatus(
        args,
        buildValidationUserMessage({ kind: "objective_summary", summary: summary.compactBlock }),
        summary.broken || summary.unmet ? "warning" : "success",
    );
    const reportedResults = matchEngineerReportedBrokenResults(results, engineerReports);
    if (reportedResults.length) {
        const reportedSummary = summarizeObjectiveChecks(reportedResults).block;
        return {
            kind: "broken",
            reason:
                `Engineer reported defective Objective-Failing Checks.\n\n${reportedSummary}\n\nFresh run result:\n\n${summary.block}`,
            results: reportedResults,
        };
    }
    if (engineerReports.length && !reportedResults.length) {
        emitStatus(args, buildValidationUserMessage({ kind: "objective_report_stale" }), "warning");
    }
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
): Promise<
    { kind: "waived" } | { kind: "rejected"; feedback: string } | { kind: "engineer_follow_up" } | { kind: "stop" }
> {
    const messageSource = source === "engineer_report" ? "agent" : "runwield";
    emitStatus(
        args,
        buildValidationUserMessage({
            kind: "objective_waiver_notice",
            source: messageSource,
            planName: args.planName,
            reason,
        }),
        "warning",
    );
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt: buildValidationUserMessage({
            kind: "objective_waiver_prompt",
            source: messageSource,
            planName: args.planName,
            reason,
        }),
        options: [
            { value: "waive", label: "Waive defective checks" },
            { value: "engineer_follow_up", label: "Engineer follow-up" },
            { value: "stop", label: "Stop" },
        ],
    });
    if (response.outcome === "selected" && response.value === "engineer_follow_up") {
        return { kind: "engineer_follow_up" };
    }
    if (response.outcome === "selected" && response.value === "stop") return { kind: "stop" };
    if (response.outcome !== "selected" || response.value !== "waive") {
        const feedbackResponse = await requestInteraction(args, {
            type: ValidationInteractionTypes.TEXT,
            prompt: buildValidationUserMessage({ kind: "objective_feedback_prompt" }),
            defaultValue: buildValidationUserMessage({ kind: "objective_feedback_default" }),
        });
        const feedback = typeof feedbackResponse.value === "string" && feedbackResponse.value.trim()
            ? feedbackResponse.value.trim()
            : buildValidationUserMessage({ kind: "objective_feedback_default" });
        return { kind: "rejected", feedback };
    }
    const noteResponse = await requestInteraction(args, {
        type: ValidationInteractionTypes.TEXT,
        prompt: buildValidationUserMessage({ kind: "objective_note_prompt" }),
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

function matchEngineerReportedBrokenResults(
    results: ObjectiveCheckResult[],
    reports: BrokenObjectiveCheckReport[],
): ObjectiveCheckResult[] {
    return reports.flatMap((report) => {
        const result = results.find((candidate) =>
            candidate.id === report.id && (!report.command || candidate.command === report.command)
        );
        if (!result) return [];
        return [{ ...result, reason: report.explanation }];
    });
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
        buildValidationUserMessage({
            kind: "objective_repair",
            agent: args.session.getAgentDisplayName(context.executionAgent, context.projectRoot),
        }),
        "warning",
    );
    return await args.session.runIndependentRepairTurn({
        agentName: context.executionAgent,
        userRequest: buildValidationRepairPrompt({
            planName: args.planName,
            projectRoot: context.projectRoot,
            executionCwd: context.executionCwd,
            repairCwd: context.executionCwd,
            planContent: args.planContent,
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
    emitProgress(
        args,
        buildValidationUserMessage({
            kind: "ci_repair",
            agent: args.session.getAgentDisplayName(context.executionAgent, context.projectRoot),
        }),
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
            planContent: args.planContent,
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
