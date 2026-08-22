/**
 * @module shared/workflow/validation-mechanical
 * The Mechanical Validation phase: CI, Objective-Failing Checks, and the repair
 * dispatches that send the execution Agent back when either fails.
 */

import { AGENTS, isPlannedChangeClassification } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
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
    getProjectRoot,
    preserveValidationContinuationState,
    readCiAttempts,
    readObjectiveCheckAttempts,
    readSemanticRound,
    recordLifecycleEvent,
    recordMetric,
    resolvePhaseContext,
} from "./validation-context.ts";
import { CI_REPAIR_CYCLES, OBJECTIVE_CHECK_REPAIR_CYCLES, type UserActionOption } from "./validation-types.ts";
import { clampCycle, emitProgress, emitStatus } from "./validation-emit.ts";
import { pauseForUserAction, requestInteraction } from "./validation-interactions.ts";
import { type AgentTurnOutcome, ValidationInteractionTypes } from "./validation-ports.ts";
import { buildValidationRepairPrompt } from "./validation-repair-prompt.ts";
import {
    applyValidationPlanAmendment,
    detectValidationPlanAmendment,
    validateAmendedObjectiveChecksAgainstBaseline,
} from "./validation-plan-amendment.ts";
import { buildValidationUserMessage } from "./validation-user-messages.ts";
import {
    decideValidationRecovery,
    readValidationRetryPolicy,
    recordOperationalRecoveryMetric,
    waitForValidationRetryWithSessionCancellation,
} from "./validation-recovery.ts";

const ENGINEER_FOLLOW_UP_OPTIONS: UserActionOption[] = [
    { value: "engineer_follow_up", label: "Engineer follow-up" },
    { value: "retry", label: "Retry" },
    { value: "stop", label: "Stop" },
];

type PlanAmendmentDecision =
    | { kind: "none" }
    | { kind: "amended" }
    | { kind: "waived" }
    | { kind: "engineer_follow_up"; feedback: string }
    | { kind: "stop" };

type PlanAmendmentProposal = NonNullable<Awaited<ReturnType<typeof detectValidationPlanAmendment>>>;

type ObjectiveCheckWaiverDecision =
    | { kind: "waived" }
    | { kind: "rejected"; feedback: string }
    | { kind: "engineer_follow_up"; feedback: string }
    | { kind: "stop" };

function isEngineerReportProjectionDrift(
    proposal: Awaited<ReturnType<typeof detectValidationPlanAmendment>>,
    reports: BrokenObjectiveCheckReport[],
): boolean {
    if (!proposal || !reports.length) return false;
    const reportedIds = new Set(reports.map((report) => report.id));
    return proposal.diffs.every((diff) => {
        const match = /^objectiveChecks\.([^.]+)$/.exec(diff.field);
        return match !== null && diff.after === "<removed>" && reportedIds.has(match[1]);
    });
}

function shouldRetainTaskCompletionClaim(args: ValidationLoopArgs): boolean {
    return (args.engineerReportedBrokenObjectiveChecks || []).length > 0;
}

function retireReportsForApprovedCheckChanges(args: ValidationLoopArgs, proposal: PlanAmendmentProposal): void {
    const changedIds = new Set(proposal.changedObjectiveChecks.map((check) => check.id));
    for (const diff of proposal.diffs) {
        const removed = /^objectiveChecks\.([^.]+)$/.exec(diff.field);
        if (removed && diff.after === "<removed>") changedIds.add(removed[1]);
    }
    if (!changedIds.size) return;
    const remaining = (args.engineerReportedBrokenObjectiveChecks || []).filter((report) => !changedIds.has(report.id));
    args.engineerReportedBrokenObjectiveChecks = remaining.length ? remaining : undefined;
}

function adoptRecordedPlanState(
    args: ValidationLoopArgs,
    context: PhaseContext,
    attrs: Awaited<ReturnType<typeof recordLifecycleEvent>>,
): void {
    args.triageMeta = attrs as ValidationLoopArgs["triageMeta"];
    context.workflowBase.triageMeta = args.triageMeta;
    const activeWorkflow = args.session.getActiveWorkflow();
    if (activeWorkflow?.planName === args.planName) {
        args.session.setActiveWorkflow({ ...activeWorkflow, triageMeta: args.triageMeta });
    }
}

function pausedResult(
    args: ValidationLoopArgs,
    context: PhaseContext,
    reason: string,
): ValidationPhaseResult {
    return {
        kind: "paused",
        planName: args.planName,
        projectRoot: context.projectRoot,
        reason,
        ...(shouldRetainTaskCompletionClaim(args) ? { retainTaskCompletionClaim: true as const } : {}),
    };
}

async function handleMechanicalOperationalFailure(
    args: ValidationLoopArgs,
    context: PhaseContext,
    ciResult: Extract<ValidationLocalCIResult, { kind: "operational_failure" }>,
    operationalAttempt: number,
): Promise<{ kind: "retry" } | { kind: "done"; result: ValidationPhaseResult }> {
    const decision = decideValidationRecovery({
        failure: ciResult.failure,
        attempt: operationalAttempt,
        policy: readValidationRetryPolicy(context.projectRoot),
        nextPhase: "mechanical",
    });
    await recordOperationalRecoveryMetric(args, context.projectRoot, decision.result);
    emitStatus(args, decision.result.message, decision.action === "halt" ? "error" : "warning");
    if (decision.action === "retry") {
        const wait = await waitForValidationRetryWithSessionCancellation(args, decision.delayMs, "mechanical");
        if (wait === "completed") return { kind: "retry" };
        return {
            kind: "done",
            result: pausedResult(
                args,
                context,
                "Validation retry was canceled. Run this Plan again when you are ready.",
            ),
        };
    }
    return {
        kind: "done",
        result: {
            kind: decision.action === "halt" ? "failed" : "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: decision.result.message,
            recovery: decision.result,
            ...(shouldRetainTaskCompletionClaim(args) ? { retainTaskCompletionClaim: true as const } : {}),
        },
    };
}

async function requestEngineerFollowUpFeedback(
    args: ValidationLoopArgs,
    prompt: string,
    defaultValue: string,
): Promise<string> {
    const feedbackResponse = await requestInteraction(args, {
        type: ValidationInteractionTypes.TEXT,
        prompt,
        defaultValue,
    });
    return typeof feedbackResponse.value === "string" && feedbackResponse.value.trim()
        ? feedbackResponse.value.trim()
        : defaultValue;
}

async function continueLastRepairSession(
    args: ValidationLoopArgs,
    prompt: string,
    defaultValue: string,
): Promise<AgentTurnOutcome | null> {
    const feedback = await requestEngineerFollowUpFeedback(args, prompt, defaultValue);
    return await args.session.continueLastRepairTurn(feedback);
}

async function requestStaleEngineerReportDecision(
    args: ValidationLoopArgs,
    reason: string,
): Promise<{ kind: "engineer_follow_up"; feedback: string } | { kind: "stop" }> {
    const statusMessage = reason;
    const decisionPrompt = `${reason}\n\nWhat should RunWield do?`;
    emitStatus(args, statusMessage, "warning");
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt: decisionPrompt,
        options: [
            { value: "engineer_follow_up", label: "Engineer follow-up" },
            { value: "stop", label: "Stop" },
        ],
    });
    if (response.outcome === "selected" && response.value === "engineer_follow_up") {
        const feedback = await requestEngineerFollowUpFeedback(
            args,
            "Tell the Engineer how to refresh the defective-check report.",
            "RunWield could not match the Engineer defective-check report to the current Objective-Failing Checks. Provide a new brokenObjectiveChecks report with the current check id and exact command, or revise the Plan Amendment.",
        );
        return { kind: "engineer_follow_up", feedback };
    }
    return { kind: "stop" };
}

async function reloadValidationPlanSnapshot(args: ValidationLoopArgs): Promise<ValidationPhaseResult | null> {
    const projectRoot = getProjectRoot(args);
    const activeWorkflow = args.session.getActiveWorkflow();
    const planCwd = activeWorkflow?.executionMode === "worktree" && activeWorkflow.executionCwd
        ? activeWorkflow.executionCwd
        : args.executionContext?.executionMode === "worktree" && args.executionContext.executionCwd
        ? args.executionContext.executionCwd
        : projectRoot;
    const plan = await loadPlan(planCwd, args.planName);
    if (!plan) {
        const reason = `Plan is missing and Mechanical Validation cannot safely continue: ${args.planName}`;
        const statusMessage = reason;
        emitStatus(args, statusMessage, "error");
        return {
            kind: "failed",
            planName: args.planName,
            projectRoot,
            reason,
            ...(shouldRetainTaskCompletionClaim(args) ? { retainTaskCompletionClaim: true as const } : {}),
        };
    }
    args.triageMeta = plan.attrs as ValidationLoopArgs["triageMeta"];
    args.planContent = plan.markdown;
    return null;
}

async function reconcileExecutionPlanToCanonical(args: ValidationLoopArgs, context: PhaseContext): Promise<void> {
    const execution = await loadPlan(context.executionCwd, args.planName);
    if (!execution) throw new Error(`Plan disappeared from its execution worktree: ${args.planName}.`);
    args.triageMeta = execution.attrs as ValidationLoopArgs["triageMeta"];
    args.planContent = execution.markdown;
    context.workflowBase.triageMeta = args.triageMeta;
}

async function resolveValidationPlanAmendment(
    args: ValidationLoopArgs,
    context: PhaseContext,
): Promise<PlanAmendmentDecision> {
    const proposal = await detectValidationPlanAmendment(
        context.projectRoot,
        context.executionCwd,
        args.planName,
        context.executionContext.executionMode === "worktree" ? context.baselineTree : undefined,
    );
    if (!proposal) return { kind: "none" };
    if (isEngineerReportProjectionDrift(proposal, args.engineerReportedBrokenObjectiveChecks || [])) {
        // task_completed reports a judgement about canonical Objective-Failing
        // Checks. It does not delete those checks from the Plan. Restore the
        // stale execution projection and continue to the waiver/follow-up flow.
        await reconcileExecutionPlanToCanonical(args, context);
        return { kind: "none" };
    }
    try {
        await validateAmendedObjectiveChecksAgainstBaseline(
            context.executionCwd,
            context.baselineTree,
            proposal.changedObjectiveChecks,
        );
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const statusMessage = `Plan amendment needs follow-up before validation can continue.\n\n${reason}`;
        const decisionPrompt = `${proposal.summary}\n\n${reason}\n\nWhat should RunWield do?`;
        emitStatus(args, statusMessage, "warning");
        const response = await requestInteraction(args, {
            type: ValidationInteractionTypes.SELECT,
            prompt: decisionPrompt,
            options: [
                { value: "engineer_follow_up", label: "Engineer follow-up" },
                { value: "stop", label: "Stop" },
            ],
        });
        if (response.outcome === "selected" && response.value === "engineer_follow_up") {
            const feedback = await requestEngineerFollowUpFeedback(
                args,
                "Tell the Engineer what to fix before this Plan Amendment can be approved.",
                `The Plan Amendment needs Engineer follow-up before validation can continue. ${reason}`,
            );
            return { kind: "engineer_follow_up", feedback };
        }
        return { kind: "stop" };
    }
    const hasEngineerDefectiveCheckClaim = (args.engineerReportedBrokenObjectiveChecks || []).length > 0;
    emitStatus(
        args,
        buildValidationUserMessage({ kind: "amendment_decision", summary: proposal.summary }),
        "warning",
    );
    const decisionPrompt =
        `${proposal.summary}\n\nApprove this Plan Amendment before RunWield uses these execution-worktree changes?`;
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt: decisionPrompt,
        options: [
            { value: "approve_amendment", label: "Approve command changes and retry" },
            ...(hasEngineerDefectiveCheckClaim
                ? [{ value: "waive_defective_checks", label: "Waive defective checks" }]
                : []),
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
            context.worktreeId,
        );
        args.triageMeta = canonical.attrs as ValidationLoopArgs["triageMeta"];
        args.planContent = canonical.markdown;
        // The user approved replacements for these exact check definitions. Any
        // Engineer report about their former commands is now historical evidence,
        // not an active defect claim. Keep reports for unrelated checks.
        retireReportsForApprovedCheckChanges(args, proposal);
        const statusMessage = buildValidationUserMessage({ kind: "amendment_approved" });
        emitStatus(args, statusMessage, "success");
        return { kind: "amended" };
    }
    if (response.outcome === "selected" && response.value === "waive_defective_checks") {
        const reports = args.engineerReportedBrokenObjectiveChecks || [];
        const objectiveOutcome = await runPlanObjectiveChecks(args, context, readCiAttempts(args.triageMeta), reports);
        if (objectiveOutcome.kind !== "broken") {
            const feedback = await requestEngineerFollowUpFeedback(
                args,
                "Tell the Engineer what defective-check evidence is missing before RunWield can waive the check.",
                "RunWield could not match the Engineer defective-check report to fresh Objective-Failing Check output. Provide a current brokenObjectiveChecks report with the exact check id and command, or revise the Plan Amendment.",
            );
            return { kind: "engineer_follow_up", feedback };
        }
        const judgement = await requestObjectiveCheckWaiver(
            args,
            context,
            `${proposal.summary}\n\n${objectiveOutcome.reason}`,
            objectiveOutcome.results,
            "engineer_report",
        );
        if (judgement.kind === "waived") {
            await reconcileExecutionPlanToCanonical(args, context);
            return { kind: "waived" };
        }
        if (judgement.kind === "engineer_follow_up") return judgement;
        if (judgement.kind === "rejected") return { kind: "engineer_follow_up", feedback: judgement.feedback };
        return { kind: "stop" };
    }
    if (response.outcome === "selected" && response.value === "engineer_follow_up") {
        const feedback = await requestEngineerFollowUpFeedback(
            args,
            "Tell the Engineer what to change before this Plan Amendment can be approved.",
            "The Plan Amendment was not approved. Revise the Plan amendment or the implementation using the current Plan and fresh Objective-Failing Check output.",
        );
        return { kind: "engineer_follow_up", feedback };
    }
    return { kind: "stop" };
}

function finishPlanAmendmentDecision(
    args: ValidationLoopArgs,
    context: PhaseContext,
    amendmentAction: PlanAmendmentDecision,
): ValidationPhaseResult | null {
    if (amendmentAction.kind === "engineer_follow_up") {
        return pauseForEngineerFollowUp(
            args,
            context,
            `Plan Amendment needs Engineer follow-up.\n\nUser feedback:\n${amendmentAction.feedback}`,
        );
    }
    if (amendmentAction.kind === "stop") {
        return pausedResult(
            args,
            context,
            "Workflow Validation stopped with a pending Plan Amendment decision.",
        );
    }
    return null;
}

export async function runMechanicalValidationPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const localCI = args.localCI;
    let ciAttempts = readCiAttempts(args.triageMeta);
    let ciOperationalAttempts = 0;

    for (;;) {
        const reloadFailure = await reloadValidationPlanSnapshot(args);
        if (reloadFailure) return reloadFailure;
        const phase = await resolvePhaseContext(args);
        if (phase.kind === "blocked") return phase.result;
        ciAttempts = readCiAttempts(args.triageMeta);
        const amendmentAction = await resolveValidationPlanAmendment(args, phase.context);
        if (amendmentAction.kind === "waived") {
            // A waiver changes the mechanical inputs, so rebuild the phase from
            // the newly saved execution Plan before running the checks.
            continue;
        }
        const amendmentResult = finishPlanAmendmentDecision(args, phase.context, amendmentAction);
        if (amendmentResult) return amendmentResult;
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
                repairAttempt: ciAttempts > 0 ? clampCycle(ciAttempts, CI_REPAIR_CYCLES) : null,
                maxRepairAttempts: ciAttempts > 0 ? CI_REPAIR_CYCLES : null,
                checks: { ci: "running" },
            },
        );
        const ciResult = await localCI.run({ cwd: phase.context.executionCwd });
        if (ciResult.kind === "operational_failure") {
            ciOperationalAttempts += 1;
            const recovery = await handleMechanicalOperationalFailure(
                args,
                phase.context,
                ciResult,
                ciOperationalAttempts,
            );
            if (recovery.kind === "retry") continue;
            return recovery.result;
        }
        ciOperationalAttempts = 0;
        await recordMetric(args, phase.context.projectRoot, {
            category: "validation",
            event: "ci_attempt",
            planName: args.planName,
            details: {
                semanticRound: readSemanticRound(args.triageMeta) + 1,
                mechanicalAttempt: ciAttempts + 1,
                exitCode: ciResult.kind === "completed" ? ciResult.exitCode : 130,
                passed: ciResult.kind === "completed" && ciResult.exitCode === 0,
                canceled: ciResult.kind === "canceled",
            },
        });
        if (ciResult.kind === "canceled") {
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
            return pausedResult(
                args,
                phase.context,
                `${pause.whatHappened} Run this Plan again when you are ready.`,
            );
        }
        if (ciResult.exitCode === 0) {
            const objectiveReloadFailure = await reloadValidationPlanSnapshot(args);
            if (objectiveReloadFailure) return objectiveReloadFailure;
            const objectiveAttempts = readObjectiveCheckAttempts(args.triageMeta);
            const objectiveCheckOutcome = await runPlanObjectiveChecks(
                args,
                phase.context,
                objectiveAttempts,
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
                return pausedResult(
                    args,
                    phase.context,
                    `${pause.whatHappened} Run this Plan again when you are ready.`,
                );
            }
            if (objectiveCheckOutcome.kind === "stale_report") {
                const staleDecision = await requestStaleEngineerReportDecision(args, objectiveCheckOutcome.reason);
                if (staleDecision.kind === "engineer_follow_up") {
                    const followUp = await args.session.continueLastRepairTurn(staleDecision.feedback);
                    if (followUp) {
                        if (followUp.brokenObjectiveChecks.length) {
                            args.engineerReportedBrokenObjectiveChecks = followUp.brokenObjectiveChecks;
                        }
                        if (followUp.completed) continue;
                        return pausedResult(
                            args,
                            phase.context,
                            "The Validation Repair Engineer follow-up paused before task_completed.",
                        );
                    }
                    return pauseForEngineerFollowUp(
                        args,
                        phase.context,
                        `${objectiveCheckOutcome.reason}\n\nUser feedback:\n${staleDecision.feedback}`,
                    );
                }
                return pausedResult(
                    args,
                    phase.context,
                    "Workflow Validation stopped with a stale Engineer defective-check report pending.",
                );
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
                    if (!phase.context.nonGitInPlace) {
                        await reconcileExecutionPlanToCanonical(args, phase.context);
                    }
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
                    const followUp = await args.session.continueLastRepairTurn(judgement.feedback);
                    if (followUp) {
                        if (followUp.brokenObjectiveChecks.length) {
                            args.engineerReportedBrokenObjectiveChecks = followUp.brokenObjectiveChecks;
                        }
                        if (followUp.completed) continue;
                        return pausedResult(
                            args,
                            phase.context,
                            "The Validation Repair Engineer follow-up paused before task_completed.",
                        );
                    }
                    return pauseForEngineerFollowUp(
                        args,
                        phase.context,
                        `${objectiveCheckOutcome.reason}\n\nUser feedback:\n${judgement.feedback}`,
                    );
                }
                if (judgement.kind === "stop") {
                    return pausedResult(
                        args,
                        phase.context,
                        "Workflow Validation stopped at Objective-Failing Check judgement.",
                    );
                }
                const nextObjectiveAttempt = objectiveAttempts + 1;
                const recordedAttrs = await recordLifecycleEvent(
                    args,
                    phase.context.projectRoot,
                    "mechanical_validation_failed",
                    "implemented",
                    judgement.feedback || objectiveCheckOutcome.reason,
                    { mechanicalFailureKind: "objective_check", validationCheckpoint: args.validationCheckpoint },
                );
                adoptRecordedPlanState(args, phase.context, recordedAttrs);
                const repair = await dispatchObjectiveCheckRepair(
                    args,
                    phase.context,
                    objectiveCheckOutcome.results,
                    judgement.feedback,
                );
                if (!repair.completed) {
                    const reason = `${
                        args.session.getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, phase.context.projectRoot)
                    } stopped without task_completed during broken Objective-Failing Check repair.`;
                    const statusMessage = `${reason} Validation will resume after task_completed.`;
                    emitStatus(args, statusMessage, "warning");
                    return {
                        kind: "paused",
                        planName: args.planName,
                        projectRoot: phase.context.projectRoot,
                        reason,
                        awaitingTaskCompletion: true,
                    };
                }
                if (nextObjectiveAttempt >= OBJECTIVE_CHECK_REPAIR_CYCLES) {
                    await recordLifecycleEvent(
                        args,
                        phase.context.projectRoot,
                        "validation_failed",
                        "implemented",
                        objectiveCheckOutcome.reason,
                    );
                    const pause: UserActionPause = {
                        whatHappened:
                            `The Validation Repair Engineer tried ${OBJECTIVE_CHECK_REPAIR_CYCLES} Objective-Failing Check repairs for "${args.planName}" without resolving the check judgement.`,
                        doThis:
                            "Pick Engineer follow-up to reopen the last repair session, Retry after an external fix, or Stop to come back later.",
                        details: [summarizeObjectiveChecks(objectiveCheckOutcome.results).compactBlock],
                        options: ENGINEER_FOLLOW_UP_OPTIONS,
                    };
                    const action = await pauseForUserAction(args, pause);
                    if (action === "retry") continue;
                    if (action === "engineer_follow_up") {
                        const followUp = await continueLastRepairSession(
                            args,
                            "Tell the Validation Repair Engineer what to try next.",
                            judgement.feedback || objectiveCheckOutcome.reason,
                        );
                        if (followUp?.completed) {
                            if (followUp.brokenObjectiveChecks.length) {
                                args.engineerReportedBrokenObjectiveChecks = followUp.brokenObjectiveChecks;
                            }
                            continue;
                        }
                        return pausedResult(
                            args,
                            phase.context,
                            "The Validation Repair Engineer follow-up paused before task_completed.",
                        );
                    }
                    return pausedResult(
                        args,
                        phase.context,
                        "Workflow Validation stopped after the Objective-Failing Check repair limit.",
                    );
                }
                continue;
            }

            const nextObjectiveAttempt = objectiveAttempts + 1;
            const recordedAttrs = await recordLifecycleEvent(
                args,
                phase.context.projectRoot,
                "mechanical_validation_failed",
                "implemented",
                objectiveCheckOutcome.reason,
                { mechanicalFailureKind: "objective_check", validationCheckpoint: args.validationCheckpoint },
            );
            adoptRecordedPlanState(args, phase.context, recordedAttrs);
            const repair = await dispatchObjectiveCheckRepair(
                args,
                phase.context,
                objectiveCheckOutcome.results,
            );
            if (!repair.completed) {
                const reason = `${
                    args.session.getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, phase.context.projectRoot)
                } stopped without task_completed during Objective-Failing Check repair.`;
                const statusMessage = `${reason} Validation will resume after task_completed.`;
                emitStatus(args, statusMessage, "warning");
                return {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason,
                    awaitingTaskCompletion: true,
                };
            }
            if (repair.brokenObjectiveChecks.length) {
                args.engineerReportedBrokenObjectiveChecks = repair.brokenObjectiveChecks;
                // brokenObjectiveChecks is a judgement reported through task_completed,
                // not a Plan edit. Evaluate it against the canonical checks before
                // considering any execution-worktree definition difference, otherwise
                // a stale Plan projection is misrepresented as the Engineer removing
                // checks in a Plan Amendment.
                const postRepairReloadFailure = await reloadValidationPlanSnapshot(args);
                if (postRepairReloadFailure) return postRepairReloadFailure;
                const reportedResults = resolveEngineerReportedBrokenChecks(
                    args.triageMeta.objectiveChecks || [],
                    repair.brokenObjectiveChecks,
                );
                const rerun = await runPlanObjectiveChecks(
                    args,
                    phase.context,
                    nextObjectiveAttempt,
                    repair.brokenObjectiveChecks,
                );
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
                if (rerun.kind === "stale_report") {
                    const staleDecision = await requestStaleEngineerReportDecision(args, rerun.reason);
                    if (staleDecision.kind === "engineer_follow_up") {
                        const followUp = await args.session.continueLastRepairTurn(staleDecision.feedback);
                        if (followUp) {
                            if (followUp.brokenObjectiveChecks.length) {
                                args.engineerReportedBrokenObjectiveChecks = followUp.brokenObjectiveChecks;
                            }
                            if (followUp.completed) continue;
                            return pausedResult(
                                args,
                                phase.context,
                                "The Validation Repair Engineer follow-up paused before task_completed.",
                            );
                        }
                        return pauseForEngineerFollowUp(
                            args,
                            phase.context,
                            `${rerun.reason}\n\nUser feedback:\n${staleDecision.feedback}`,
                        );
                    }
                    return pausedResult(
                        args,
                        phase.context,
                        "Workflow Validation stopped with a stale Engineer defective-check report pending.",
                    );
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
                            if (!phase.context.nonGitInPlace) {
                                await reconcileExecutionPlanToCanonical(args, phase.context);
                            }
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
                            const followUp = await args.session.continueLastRepairTurn(judgement.feedback);
                            if (followUp) {
                                if (followUp.brokenObjectiveChecks.length) {
                                    args.engineerReportedBrokenObjectiveChecks = followUp.brokenObjectiveChecks;
                                }
                                if (followUp.completed) continue;
                                return pausedResult(
                                    args,
                                    phase.context,
                                    "The Validation Repair Engineer follow-up paused before task_completed.",
                                );
                            }
                            return pauseForEngineerFollowUp(
                                args,
                                phase.context,
                                `${rerun.reason}\n\nUser feedback:\n${judgement.feedback}`,
                            );
                        } else if (judgement.kind === "stop") {
                            return pausedResult(
                                args,
                                phase.context,
                                "Workflow Validation stopped at Objective-Failing Check judgement.",
                            );
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
            if (nextObjectiveAttempt >= OBJECTIVE_CHECK_REPAIR_CYCLES) {
                await recordLifecycleEvent(
                    args,
                    phase.context.projectRoot,
                    "validation_failed",
                    "implemented",
                    objectiveCheckOutcome.reason,
                );
                const pause: UserActionPause = {
                    whatHappened: `The Objective-Failing Checks for "${args.planName}" are still unmet. ${
                        args.session.getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, phase.context.projectRoot)
                    } tried ${OBJECTIVE_CHECK_REPAIR_CYCLES} times and could not satisfy them.`,
                    doThis:
                        "Pick Engineer follow-up to reopen the last repair session, Retry only after you fixed the checks outside RunWield, or Stop to come back to this later.",
                    details: [summarizeObjectiveChecks(objectiveCheckOutcome.results).compactBlock],
                    options: ENGINEER_FOLLOW_UP_OPTIONS,
                };
                const action = await pauseForUserAction(args, pause);
                if (action === "retry") continue;
                if (action === "engineer_follow_up") {
                    const followUp = await continueLastRepairSession(
                        args,
                        "Tell the Validation Repair Engineer what to try next.",
                        objectiveCheckOutcome.reason,
                    );
                    if (followUp?.completed) {
                        if (followUp.brokenObjectiveChecks.length) {
                            args.engineerReportedBrokenObjectiveChecks = followUp.brokenObjectiveChecks;
                        }
                        continue;
                    }
                    return pausedResult(
                        args,
                        phase.context,
                        "The Validation Repair Engineer follow-up paused before task_completed.",
                    );
                }
                return {
                    kind: "failed",
                    planName: args.planName,
                    projectRoot: phase.context.projectRoot,
                    reason: `${pause.whatHappened} ${pause.doThis}`,
                    ...(shouldRetainTaskCompletionClaim(args) ? { retainTaskCompletionClaim: true as const } : {}),
                };
            }
            continue;
        }

        const failureReason = getCiFailureReason(ciResult);
        const nextCiAttempt = ciAttempts + 1;
        const recordedAttrs = await recordLifecycleEvent(
            args,
            phase.context.projectRoot,
            "mechanical_validation_failed",
            "implemented",
            failureReason,
            { mechanicalFailureKind: "ci", validationCheckpoint: args.validationCheckpoint },
        );
        adoptRecordedPlanState(args, phase.context, recordedAttrs);
        const repairCompleted = await dispatchCiRepair(args, phase.context, ciResult);
        if (!repairCompleted) {
            const reason = `${
                args.session.getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, phase.context.projectRoot)
            } stopped without task_completed during CI repair.`;
            const statusMessage = `${reason} Validation will resume after task_completed.`;
            emitStatus(args, statusMessage, "warning");
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason,
                awaitingTaskCompletion: true,
                ...(shouldRetainTaskCompletionClaim(args) ? { retainTaskCompletionClaim: true as const } : {}),
            };
        }
        if (nextCiAttempt >= CI_REPAIR_CYCLES) {
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
                    args.session.getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, phase.context.projectRoot)
                } tried ${CI_REPAIR_CYCLES} times and could not get them passing.`,
                doThis:
                    "Pick Engineer follow-up to reopen the last repair session, Retry only after you fixed the tests outside RunWield, or Stop to come back to this later.",
                details: failureReason ? [failureReason] : undefined,
                options: ENGINEER_FOLLOW_UP_OPTIONS,
            };
            const action = await pauseForUserAction(args, pause);
            if (action === "retry") {
                ciAttempts = 0;
                continue;
            }
            if (action === "engineer_follow_up") {
                const followUp = await continueLastRepairSession(
                    args,
                    "Tell the Validation Repair Engineer what to try next.",
                    failureReason,
                );
                if (followUp?.completed) {
                    if (followUp.brokenObjectiveChecks.length) {
                        args.engineerReportedBrokenObjectiveChecks = followUp.brokenObjectiveChecks;
                    }
                    continue;
                }
                return pausedResult(
                    args,
                    phase.context,
                    "The Validation Repair Engineer follow-up paused before task_completed.",
                );
            }
            return {
                kind: "failed",
                planName: args.planName,
                projectRoot: phase.context.projectRoot,
                reason: `${pause.whatHappened} ${pause.doThis}`,
                ...(shouldRetainTaskCompletionClaim(args) ? { retainTaskCompletionClaim: true as const } : {}),
            };
        }

        continue;
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
            agent: args.session.getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, context.projectRoot),
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
    const plan = await loadPlan(context.executionCwd, args.planName);
    if (!plan) throw new Error(`Plan is missing and Objective-Failing Checks cannot safely continue: ${args.planName}`);
    args.triageMeta = plan.attrs as ValidationLoopArgs["triageMeta"];
    args.planContent = plan.markdown;
    context.args = args;
    context.workflowBase.triageMeta = args.triageMeta;
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
        return {
            kind: "stale_report",
            reason: buildStaleEngineerReportReason(results, engineerReports, summary.block),
            reports: engineerReports,
            results,
        };
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
): Promise<ObjectiveCheckWaiverDecision> {
    const prompt = source === "engineer_report"
        ? `The execution agent reported broken Objective-Failing Checks for "${args.planName}".`
        : `RunWield detected broken Objective-Failing Checks for "${args.planName}".`;
    const statusMessage =
        `${prompt}\n\n${reason}\n\nAccept a waiver only if the check itself is broken and the implementation should continue.`;
    emitStatus(args, statusMessage, "warning");
    const decisionPrompt = `${prompt}\n\n${reason}\n\nWhat should RunWield do?`;
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt: decisionPrompt,
        options: [
            { value: "waive", label: "Waive defective checks" },
            { value: "engineer_follow_up", label: "Engineer follow-up" },
            { value: "stop", label: "Stop" },
        ],
    });
    if (response.outcome === "selected" && response.value === "engineer_follow_up") {
        const feedback = await requestEngineerFollowUpFeedback(
            args,
            "Tell the Engineer what to fix about these defective Objective-Failing Checks.",
            "The defective Objective-Failing Check judgement needs Engineer follow-up. Use the current Plan and fresh check output to repair the check definition or implementation.",
        );
        return { kind: "engineer_follow_up", feedback };
    }
    if (response.outcome === "selected" && response.value === "stop") return { kind: "stop" };
    if (response.outcome !== "selected" || response.value !== "waive") {
        const feedback = await requestEngineerFollowUpFeedback(
            args,
            "Tell the Engineer what to fix about these broken Objective-Failing Checks.",
            "The broken Objective-Failing Check waiver was rejected. Fix the check definition or implementation so validation can make a reliable decision.",
        );
        return { kind: "rejected", feedback };
    }
    const notePrompt = "Optional note for the Objective Check waiver record.";
    const noteResponse = await requestInteraction(args, {
        type: ValidationInteractionTypes.TEXT,
        prompt: notePrompt,
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

function buildStaleEngineerReportReason(
    results: ObjectiveCheckResult[],
    reports: BrokenObjectiveCheckReport[],
    freshSummary: string,
): string {
    const currentCommands = new Map(results.map((result) => [result.id, result.command]));
    const mismatches = reports.map((report) => {
        const currentCommand = currentCommands.get(report.id);
        if (!currentCommand) return `- ${report.id}: the current Plan does not contain this active check.`;
        if (report.command && report.command !== currentCommand) {
            return `- ${report.id}: reported command ${JSON.stringify(report.command)} does not match current command ${
                JSON.stringify(currentCommand)
            }.`;
        }
        return `- ${report.id}: the report did not match the current Objective-Failing Check output.`;
    }).join("\n");
    return `Engineer-reported defective Objective-Failing Checks did not match the current Plan commands, so the report is stale and cannot authorize a waiver or amendment.\n\n${mismatches}\n\nFresh run result:\n\n${freshSummary}`;
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
        agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
        userRequest: buildValidationRepairPrompt({
            executionCwd: context.executionCwd,
            repairCwd: context.executionCwd,
            worktreeId: context.worktreeId,
            worktreeBranch: context.worktreeBranch,
            worktreeBaseBranch: context.worktreeBaseBranch,
            repairsNeeded: [
                "First diagnose each failed Objective-Failing Check. Classify it as either an implementation defect or a defective check. A check is defective when its command cannot prove the objective, including when a test filter selects zero tests, a named test or file does not exist, the command is invalid, or the environment cannot run it reliably. For an implementation defect, repair the implementation and rerun the check. For a defective check, do not change unrelated implementation, edit or delete the check definition, or repeatedly rerun it: call task_completed with a brokenObjectiveChecks entry that includes the check id, its command when known, and the concrete evidence that makes the check defective. RunWield will ask the user whether to waive it. If the repair involves tests, follow the write-tests skill for sound testing behavior.",
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
            agent: args.session.getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, context.projectRoot),
        }),
        "warning",
        { outcome: "running", stage: "engineer_repair", checks: { ci: "failed" } },
    );
    const outcome = await args.session.runIndependentRepairTurn({
        agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
        userRequest: buildValidationRepairPrompt({
            executionCwd: context.executionCwd,
            repairCwd: context.executionCwd,
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
    return ciResult.output || "Mechanical Validation failed.";
}
