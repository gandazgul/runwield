/**
 * @module shared/workflow/validation-semantic
 * The Semantic Code Review phase: reviewer rounds with ledger convergence, repair
 * dispatch, and the round-limit decision when the automatic rounds are spent.
 */

import { AGENTS } from "../../constants.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { buildDiffInspectionSection, createReviewDiffTool } from "./review-diff-tool.js";
import {
    applyRoundFindings,
    hasOpenItems,
    openItems,
    renderOpenItems,
    renderResolvedItems,
    unaccountedOpenItems,
} from "./review-ledger.ts";
import { hasImplementationDiff, requiresImplementationDiff } from "./validation-scope.ts";
import { buildValidationUserMessage, validationReviewerPauseMessage } from "./validation-user-messages.ts";
import type { OpaqueToolDefinition, ValidationReviewOutcome, ValidationWorkflowState } from "./validation-ports.ts";
import type {
    PhaseContext,
    ReviewFeedbackRepairPacket,
    SemanticRoundState,
    ValidationLoopArgs,
    ValidationPhaseResult,
} from "./validation-types.ts";
import {
    getDiffText,
    hasFinalHumanReviewDecision,
    readHumanReviewMetadata,
    readSemanticRoundState,
    recordLifecycleEvent,
    recordMetric,
    resolvePhaseContext,
} from "./validation-context.ts";
import { SEMANTIC_REVIEW_CYCLES } from "./validation-types.ts";
import { clampCycle, emitHalted, emitProgress, emitStatus } from "./validation-emit.ts";
import { requestInteraction } from "./validation-interactions.ts";
import { ValidationInteractionTypes } from "./validation-ports.ts";
import { persistHumanReviewMetadata, runHumanReviewPhase } from "./validation-human-review.ts";
import { runPublicationPhase } from "./validation-publication.ts";
import { buildValidationRepairPrompt } from "./validation-repair-prompt.ts";
import { makeValidationCheckpoint, type ValidationReviewState } from "./validation-checkpoint.ts";
import { classifyValidationOperationalError } from "./validation-operational-errors.ts";
import {
    decideValidationRecovery,
    readValidationRetryPolicy,
    recordOperationalRecoveryMetric,
    waitForValidationRetryWithSessionCancellation,
} from "./validation-recovery.ts";

export async function runSemanticReviewPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const phase = await resolvePhaseContext(args);
    if (phase.kind === "blocked") return phase.result;
    const context = phase.context;
    if (context.nonGitInPlace) {
        emitStatus(args, buildValidationUserMessage({ kind: "semantic_skipped", reason: "non_git" }), "info");
        await recordLifecycleEvent(args, context.projectRoot, "semantic_review_passed", "validated_ci");
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: "Semantic Code Review skipped for non-Git execution.",
        };
    }
    // The user asked for these changes themselves, so they are the reviewer now — they
    // took over either because the Semantic Code Reviewer found nothing or because it
    // kept finding things round after round. Sweeping the diff again would hand back
    // objections the user has already moved past, and cost a full review cycle for
    // every note they write. Run the tests, then give them the diff back.
    if (args.triageMeta.humanReviewDecision === "changes_requested") {
        await recordLifecycleEvent(args, context.projectRoot, "semantic_review_passed", "validated_ci");
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: "Reopening your code review with the repair.",
        };
    }

    const state = readSemanticRoundState(args, context);
    let round = state.semanticRound;
    let ledger = state.reviewLedger;
    let diffText = await getDiffText(context.baselineTree, context.executionCwd);
    if (requiresImplementationDiff(args.triageMeta) && !hasImplementationDiff(diffText, args.planName)) {
        const planOnly = Boolean(diffText.trim());
        const reason = planOnly
            ? "No implementation changes detected in workflow diff; only plan document changes were found."
            : "No implementation changes detected in workflow diff.";
        emitHalted(args, buildValidationUserMessage({ kind: "semantic_diff_missing", planOnly }), reason);
        await recordLifecycleEvent(args, context.projectRoot, "validation_failed", "validated_ci", reason);
        return { kind: "failed", planName: args.planName, projectRoot: context.projectRoot, reason };
    }
    if (!hasImplementationDiff(diffText, args.planName)) {
        emitStatus(args, buildValidationUserMessage({ kind: "semantic_skipped", reason: "empty_diff" }), "info");
        await recordLifecycleEvent(args, context.projectRoot, "semantic_review_passed", "validated_ci");
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: "Semantic Code Review skipped because the diff is empty.",
        };
    }

    if (round >= SEMANTIC_REVIEW_CYCLES && state.lastRepairReport) {
        const action = await promptForSemanticRoundLimit(
            args,
            round,
            openItems(ledger).length,
            true,
        );
        if (action === "code_review") {
            await persistHumanReviewMetadata(args, context.projectRoot, {
                humanReviewMode: "always",
                humanReviewDecision: null,
                humanReviewedAt: null,
            });
            await recordLifecycleEvent(
                args,
                context.projectRoot,
                "semantic_review_passed",
                "validated_ci",
                undefined,
                { humanReviewMode: "always", humanReviewDecision: null, humanReviewedAt: null },
            );
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: "Semantic Code Review round limit reached; Local Human Code Review requested.",
            };
        }
        if (action === "engineer_follow_up") {
            const response = await requestInteraction(args, {
                type: ValidationInteractionTypes.TEXT,
                prompt: buildValidationUserMessage({ kind: "repair_feedback_prompt" }),
                defaultValue: buildValidationUserMessage({ kind: "repair_feedback_default" }),
            });
            const feedback = typeof response.value === "string" ? response.value.trim() : "";
            const repair = await args.session.continueLastRepairTurn(feedback);
            if (!repair?.completed) {
                return {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: "The Validation Repair Engineer follow-up paused before task_completed.",
                };
            }
            state.lastRepairReport = repair.report;
            diffText = await getDiffText(context.baselineTree, context.executionCwd);
        } else if (action === "stop") {
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: `The reviewer still has ${
                    openItems(ledger).length
                } open point(s) on "${args.planName}". The findings and last repair session are saved.`,
            };
        }
    }

    // The first review sweeps the whole implementation. Once findings exist, every
    // later review focuses on those findings and the repair delta. A resumed Plan
    // whose older findings were not persisted gets one broad recovery review,
    // regardless of its numeric round, then returns to focused verification.
    // Each round below the limit ends by handing the
    // Plan back to `implemented`, so the tests run over the repair before the next
    // review. At the limit the user takes the wheel, and their "look again" re-enters
    // right here — another focused round on the repaired diff, no detour.
    for (;;) {
        const nextRound = round + 1;
        const reviewMode = hasOpenItems(ledger) ? "verify" : "discovery";
        // The reviewer runs in its own session, so without this the whole round is
        // silent: the user sees the Engineer finish, then nothing, and the verdict
        // lands only in the Plan's failure reason. Say a round is starting, and say
        // which kind it is — a verify round reads very differently from a sweep.
        emitProgress(
            args,
            buildValidationUserMessage({
                kind: "semantic_round",
                round: nextRound,
                maxRounds: SEMANTIC_REVIEW_CYCLES,
                mode: reviewMode,
            }),
            "info",
            {
                outcome: "running",
                stage: "semantic_review",
                cycle: clampCycle(nextRound, SEMANTIC_REVIEW_CYCLES),
                maxCycles: SEMANTIC_REVIEW_CYCLES,
                checks: { semanticReview: "running" },
            },
        );
        const review = await runReviewerRound(
            args,
            context,
            { ...state, semanticRound: nextRound, reviewLedger: ledger },
            reviewMode,
            diffText,
        );
        if (review.kind === "paused") return review.result;
        if (review.kind === "failed") {
            await recordLifecycleEvent(args, context.projectRoot, "validation_failed", "validated_ci", review.reason);
            return {
                kind: "failed",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: review.reason,
            };
        }

        if (review.outcome.approved) {
            await recordMetric(args, context.projectRoot, {
                category: "validation",
                event: "semantic_review_result",
                planName: args.planName,
                details: {
                    semanticRound: nextRound,
                    reviewMode,
                    approved: true,
                    hasDiff: true,
                    approvedByRoundTwo: nextRound <= 2,
                    resolvedThisRound: review.resolvedCount,
                    advisoryCount: review.outcome.advisories.length,
                },
            });
            emitProgress(args, buildValidationUserMessage({ kind: "semantic_approved", round: nextRound }), "success", {
                stage: "semantic_review",
                cycle: clampCycle(nextRound, SEMANTIC_REVIEW_CYCLES),
                maxCycles: SEMANTIC_REVIEW_CYCLES,
                checks: { semanticReview: "passed" },
            });
            await recordLifecycleEvent(args, context.projectRoot, "semantic_review_passed", "validated_ci");
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: "Semantic Code Review passed.",
            };
        }

        const openCount = openItems(review.ledger).length;
        await recordMetric(args, context.projectRoot, {
            category: "validation",
            event: "semantic_review_result",
            planName: args.planName,
            details: {
                semanticRound: nextRound,
                reviewMode,
                approved: false,
                hasReviewerOutput: Boolean(review.outcome.feedback),
                openFindingCount: openCount,
                resolvedThisRound: review.resolvedCount,
                appendedThisRound: review.appendedCount,
                advisoryCount: review.outcome.advisories.length,
            },
        });

        const repairBaselineTree = await captureWorktreeTree(context.executionCwd);
        const findingsSection = openCount > 0 ? renderOpenItems(review.ledger) : review.outcome.feedback;
        const priorCheckpoint = args.validationCheckpoint || args.triageMeta.validationCheckpoint;
        const repairGeneration = crypto.randomUUID();
        const reviewState: ValidationReviewState = {
            semanticRound: nextRound,
            reviewLedger: review.ledger,
            repairBaselineTree,
        };
        const repairCheckpoint = makeValidationCheckpoint({
            attemptId: context.worktreeId || "in-place",
            generation: priorCheckpoint?.generation || crypto.randomUUID(),
            status: "implemented",
            phase: "mechanical",
            state: "awaiting_repair",
            repairKind: "semantic",
            repairGeneration,
            reviewState,
        });
        await recordLifecycleEvent(
            args,
            context.projectRoot,
            "semantic_review_feedback",
            "validated_ci",
            review.outcome.feedback || "Semantic Code Review requested changes.",
            { validationCheckpoint: repairCheckpoint },
        );
        args.session.setActiveWorkflow({
            ...context.workflowBase,
            semanticRound: nextRound,
            reviewLedger: review.ledger,
            repairBaselineTree,
            validationRepairGeneration: repairGeneration,
        });
        if (!args.supportsSemanticRepairHandoff) {
            const repair = await dispatchReviewFeedbackRepair(args, context, {
                diffText,
                findingsSection,
                repairKind: "semantic",
                reason: `Review round ${nextRound} found ${openCount || "open"} issue(s). Dispatching repair...`,
                activeWorkflow: {
                    semanticRound: nextRound,
                    reviewLedger: review.ledger,
                    repairBaselineTree,
                    validationRepairGeneration: repairGeneration,
                },
            });
            if (!repair.completed) {
                const reason = repair.reason ||
                    "Reviewer-Feedback Engineer stopped without task_completed during semantic repair.";
                return { kind: "paused", planName: args.planName, projectRoot: context.projectRoot, reason };
            }
            if (nextRound >= SEMANTIC_REVIEW_CYCLES) {
                emitStatus(args, buildValidationUserMessage({ kind: "ci_running", cwd: context.executionCwd }));
                const ciResult = await args.localCI.run({ cwd: context.executionCwd });
                const testsPass = ciResult.kind === "completed" && ciResult.exitCode === 0;
                emitStatus(
                    args,
                    testsPass
                        ? buildValidationUserMessage({ kind: "checks_passed", objectiveChecks: false })
                        : validationReviewerPauseMessage(args.planName),
                    testsPass ? "success" : "warning",
                );
                const action = await promptForSemanticRoundLimit(args, nextRound, openCount, testsPass);
                if (action === "code_review") {
                    await persistHumanReviewMetadata(args, context.projectRoot, {
                        humanReviewMode: "always",
                        humanReviewDecision: null,
                        humanReviewedAt: null,
                    });
                    await recordLifecycleEvent(
                        args,
                        context.projectRoot,
                        "semantic_review_passed",
                        "validated_ci",
                        undefined,
                        { humanReviewMode: "always", humanReviewDecision: null, humanReviewedAt: null },
                    );
                    return {
                        kind: "paused",
                        planName: args.planName,
                        projectRoot: context.projectRoot,
                        reason: "Semantic Code Review round limit reached; Local Human Code Review requested.",
                    };
                }
                if (action === "stop") {
                    return {
                        kind: "paused",
                        planName: args.planName,
                        projectRoot: context.projectRoot,
                        reason: `The reviewer still has ${openCount} open point(s) on "${args.planName}". ${
                            testsPass
                                ? "The tests still pass and the findings are saved."
                                : "The tests are failing too."
                        } Run this Plan again when you want to pick it back up.`,
                    };
                }
                if (action === "engineer_follow_up") {
                    const response = await requestInteraction(args, {
                        type: ValidationInteractionTypes.TEXT,
                        prompt: buildValidationUserMessage({ kind: "repair_feedback_prompt" }),
                        defaultValue: buildValidationUserMessage({ kind: "repair_feedback_default" }),
                    });
                    const feedback = typeof response.value === "string" ? response.value.trim() : "";
                    const followUp = await args.session.continueLastRepairTurn(feedback);
                    if (!followUp?.completed) {
                        return {
                            kind: "paused",
                            planName: args.planName,
                            projectRoot: context.projectRoot,
                            reason: "The Validation Repair Engineer follow-up paused before task_completed.",
                        };
                    }
                    state.lastRepairReport = followUp.report;
                }
                state.repairBaselineTree = repairBaselineTree;
                state.lastRepairReport = repair.report;
                round = nextRound;
                ledger = review.ledger;
                diffText = await getDiffText(context.baselineTree, context.executionCwd);
                continue;
            }
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: "Semantic Code Review requested changes; repair dispatched.",
            };
        }
        emitStatus(args, buildValidationUserMessage({ kind: "review_repair", repairKind: "semantic" }), "warning");
        return {
            kind: "semantic_repair_handoff",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: `Review round ${nextRound} found ${openCount || "open"} issue(s). Dispatching repair...`,
            semanticRepairHandoff: {
                semanticRound: nextRound,
                repairGeneration,
                reviewLedger: review.ledger,
                repairBaselineTree,
                diffText,
                findingsSection,
                activeWorkflow: {
                    semanticRound: nextRound,
                    reviewLedger: review.ledger,
                    repairBaselineTree,
                    validationRepairGeneration: repairGeneration,
                },
            },
        };
    }
}

export async function runValidatedReviewerPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const phase = await resolvePhaseContext(args);
    if (phase.kind === "blocked") return phase.result;
    if (!hasFinalHumanReviewDecision(args.triageMeta)) {
        return await runHumanReviewPhase(args, phase.context);
    }
    const publication = await runPublicationPhase(args, phase.context, readHumanReviewMetadata(args.triageMeta));
    return publication.result;
}

export async function runReviewerRound(
    args: ValidationLoopArgs,
    context: PhaseContext,
    state: SemanticRoundState,
    reviewMode: "discovery" | "verify",
    diffText: string,
): Promise<
    | {
        kind: "complete";
        outcome: ValidationReviewOutcome;
        ledger: SemanticRoundState["reviewLedger"];
        resolvedCount: number;
        appendedCount: number;
    }
    | { kind: "paused"; result: ValidationPhaseResult }
    | { kind: "failed"; reason: string }
> {
    // One in-memory session manager per round, shared across every nudge attempt:
    // the reviewer's accumulated context is what makes a nudge "continue this
    // review" instead of "start over".
    const reviewerSessionManager = args.session.createInMemorySessionManager(context.executionCwd);
    let nudgeReason: string | undefined;
    let inspectedDiff = false;
    let latestOutcome: ValidationReviewOutcome | null = null;
    let operationalAttempt = 1;

    function preserveReviewerRoundState(): void {
        emitStatus(args, validationReviewerPauseMessage(args.planName), "warning");
        args.session.setActiveWorkflow({
            ...context.workflowBase,
            ...(args.session.getActiveWorkflow() || {}),
            semanticRound: state.semanticRound - 1,
            reviewLedger: state.reviewLedger,
            repairBaselineTree: state.repairBaselineTree,
            lastRepairReport: state.lastRepairReport,
        });
    }

    for (let attempt = 1; !latestOutcome; attempt++) {
        if (attempt > 1) {
            emitStatus(
                args,
                buildValidationUserMessage({
                    kind: "reviewer_nudge",
                    round: state.semanticRound,
                    attempt,
                }),
                "info",
            );
        }
        const repairDiffText = state.repairBaselineTree
            ? await getDiffText(state.repairBaselineTree, context.executionCwd)
            : "";
        const config = buildSemanticReviewAttempt(attempt, nudgeReason, state, reviewMode, diffText, repairDiffText);
        nudgeReason = undefined;
        try {
            const sessionOutcome = await args.session.runIsolatedAgentSession({
                kind: "reviewer",
                agentName: AGENTS.REVIEWER,
                userRequest: config.prompt,
                cwd: context.executionCwd,
                reviewerMode: reviewMode,
                customTools: config.customTools,
                sessionManager: reviewerSessionManager,
            });
            if (sessionOutcome.outcome === "operational_failure") {
                const decision = decideValidationRecovery({
                    failure: sessionOutcome.failure,
                    attempt: sessionOutcome.failure.recoveryClass === "transient" ? operationalAttempt : attempt,
                    correctionAttempt: attempt,
                    policy: readValidationRetryPolicy(context.projectRoot),
                    nextPhase: "semantic",
                });
                await recordOperationalRecoveryMetric(args, context.projectRoot, decision.result);
                emitStatus(args, decision.result.message, decision.action === "halt" ? "error" : "warning");
                if (decision.action === "retry") {
                    const wait = await waitForValidationRetryWithSessionCancellation(
                        args,
                        decision.delayMs,
                        "semantic",
                    );
                    if (wait === "completed") {
                        operationalAttempt += 1;
                        attempt -= 1;
                        continue;
                    }
                }
                if (decision.action === "correct") {
                    nudgeReason = decision.result.message;
                    continue;
                }
                preserveReviewerRoundState();
                return {
                    kind: "paused",
                    result: {
                        kind: decision.action === "halt" ? "failed" : "paused",
                        planName: args.planName,
                        projectRoot: context.projectRoot,
                        reason: decision.result.message,
                        recovery: decision.result,
                    },
                };
            }
            if (sessionOutcome.usedDiffTool) inspectedDiff = true;
            const trustedClaudeMcpReview = sessionOutcome.trustedClaudeMcpReview;
            const outcome = sessionOutcome.reviewOutcome;
            const unaccounted = unaccountedOpenItems(state.reviewLedger, outcome?.findings);
            if (!outcome) {
                const failure = classifyValidationOperationalError({
                    source: "reviewer_protocol",
                    kind: "missing_review_complete",
                    operation: "semantic_review",
                    message: "Semantic Reviewer finished without calling review_complete.",
                    required:
                        "You have not called review_complete yet. Finish this review now by calling review_complete with your decision.",
                });
                const decision = decideValidationRecovery({
                    failure,
                    attempt,
                    correctionAttempt: attempt,
                    policy: readValidationRetryPolicy(context.projectRoot),
                    nextPhase: "semantic",
                });
                await recordOperationalRecoveryMetric(args, context.projectRoot, decision.result);
                if (decision.action === "correct") {
                    nudgeReason = decision.result.message;
                    continue;
                }
                preserveReviewerRoundState();
                return {
                    kind: "paused",
                    result: {
                        kind: decision.action === "halt" ? "failed" : "paused",
                        planName: args.planName,
                        projectRoot: context.projectRoot,
                        reason: decision.result.message,
                        recovery: decision.result,
                    },
                };
            } else if (!inspectedDiff && !trustedClaudeMcpReview) {
                const failure = classifyValidationOperationalError({
                    source: "reviewer_protocol",
                    kind: "diff_not_read",
                    operation: "semantic_review",
                    message: "Semantic Reviewer decided without inspecting the diff.",
                    required:
                        'You called review_complete without inspecting the diff. Read the changes with review_diff(command: "list") and then review_diff(command: "show", ...) before deciding, then call review_complete again.',
                });
                const decision = decideValidationRecovery({
                    failure,
                    attempt,
                    correctionAttempt: attempt,
                    policy: readValidationRetryPolicy(context.projectRoot),
                    nextPhase: "semantic",
                });
                await recordOperationalRecoveryMetric(args, context.projectRoot, decision.result);
                if (decision.action === "correct") {
                    nudgeReason = decision.result.message;
                    continue;
                }
                preserveReviewerRoundState();
                return {
                    kind: "paused",
                    result: {
                        kind: decision.action === "halt" ? "failed" : "paused",
                        planName: args.planName,
                        projectRoot: context.projectRoot,
                        reason: decision.result.message,
                        recovery: decision.result,
                    },
                };
            } else if (unaccounted.length > 0) {
                const required = `Your result does not mention ${
                    unaccounted.length === 1 ? "this open finding" : "these open findings"
                }: ${
                    unaccounted.join(", ")
                }. Every open finding must appear in your \`findings\` array — with \`resolved: true\` if you have verified the fix in the code, or with \`resolved: false\` and what is still missing. Reuse the existing identities exactly; do not renumber them or report the same issue as a new finding. Call review_complete again with the complete set.`;
                const failure = classifyValidationOperationalError({
                    source: "reviewer_protocol",
                    kind: "unaccounted_findings",
                    operation: "semantic_review",
                    message: `Semantic Reviewer did not account for open finding(s): ${unaccounted.join(", ")}.`,
                    field: "findings",
                    required,
                });
                const decision = decideValidationRecovery({
                    failure,
                    attempt,
                    correctionAttempt: attempt,
                    policy: readValidationRetryPolicy(context.projectRoot),
                    nextPhase: "semantic",
                });
                await recordOperationalRecoveryMetric(args, context.projectRoot, decision.result);
                if (decision.action === "correct") {
                    nudgeReason = decision.result.message;
                    continue;
                }
                preserveReviewerRoundState();
                return {
                    kind: "paused",
                    result: {
                        kind: decision.action === "halt" ? "failed" : "paused",
                        planName: args.planName,
                        projectRoot: context.projectRoot,
                        reason: decision.result.message,
                        recovery: decision.result,
                    },
                };
            } else {
                latestOutcome = outcome;
            }
        } catch (error) {
            const failure = classifyValidationOperationalError({
                source: "provider",
                kind: "legacy_text",
                operation: "semantic_review",
                message: error instanceof Error ? error.message : String(error),
            });
            const decision = decideValidationRecovery({
                failure,
                attempt: operationalAttempt,
                policy: readValidationRetryPolicy(context.projectRoot),
                nextPhase: "semantic",
            });
            await recordOperationalRecoveryMetric(args, context.projectRoot, decision.result);
            emitStatus(args, decision.result.message, decision.action === "halt" ? "error" : "warning");
            if (decision.action === "retry") {
                const wait = await waitForValidationRetryWithSessionCancellation(args, decision.delayMs, "semantic");
                if (wait === "completed") {
                    operationalAttempt += 1;
                    attempt -= 1;
                    continue;
                }
            }
            preserveReviewerRoundState();
            return {
                kind: "paused",
                result: {
                    kind: decision.action === "halt" ? "failed" : "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: decision.result.message,
                    recovery: decision.result,
                },
            };
        }
    }

    if (!latestOutcome) {
        const reason = validationReviewerPauseMessage(args.planName);
        args.session.setActiveWorkflow({
            ...context.workflowBase,
            ...(args.session.getActiveWorkflow() || {}),
            semanticRound: state.semanticRound - 1,
            reviewLedger: state.reviewLedger,
            repairBaselineTree: state.repairBaselineTree,
            lastRepairReport: state.lastRepairReport,
        });
        emitStatus(args, validationReviewerPauseMessage(args.planName), "warning");
        return {
            kind: "paused",
            result: { kind: "paused", planName: args.planName, projectRoot: context.projectRoot, reason },
        };
    }

    const applied = applyRoundFindings(state.reviewLedger, latestOutcome.findings, state.semanticRound);
    return {
        kind: "complete",
        outcome: latestOutcome,
        ledger: applied.ledger,
        resolvedCount: applied.resolvedCount,
        appendedCount: applied.appendedCount,
    };
}

export function buildSemanticReviewAttempt(
    attempt: number,
    nudgeReason: string | undefined,
    state: SemanticRoundState,
    reviewMode: "discovery" | "verify",
    diffText: string,
    repairDiffText = "",
): {
    prompt: string;
    customTools: OpaqueToolDefinition[];
} {
    const hasRepairScope = state.repairBaselineTree.trim() !== "";
    const toolDiffs = hasRepairScope ? { full: diffText, repair: repairDiffText } : { full: diffText };
    // `createReviewDiffTool` returns a Pi ToolDefinition; the engine brands it opaque
    // here so the adapter can un-brand it once at the port boundary.
    const customTools = [createReviewDiffTool(toolDiffs) as unknown as OpaqueToolDefinition];
    if (attempt > 1) {
        return {
            prompt: nudgeReason ||
                "You have not called review_complete yet. Finish this review now by calling review_complete with your decision. Do not restart the review — use what you have already inspected.",
            customTools,
        };
    }

    const sections = [`You are reviewing ${state.semanticRound}. This is review round ${state.semanticRound}.`, ""];
    if (reviewMode === "discovery" && hasOpenItems(state.reviewLedger)) {
        sections.push(
            "A previous round opened the findings below and a repair has been attempted since. Sweep the Plan as usual **and** independently verify each open finding against the code.",
            "",
            "### Open Findings",
            "",
            renderOpenItems(state.reviewLedger),
            "",
        );
    } else if (reviewMode === "verify") {
        sections.push(
            "An earlier broad review already checked this implementation against the whole Plan. Verify the open findings below and check the repair for regressions. Do not sweep the Plan again.",
            "",
            "### Open Findings",
            "",
            renderOpenItems(state.reviewLedger),
            "",
            "### Already Resolved",
            "",
            renderResolvedItems(state.reviewLedger),
            "",
        );
    }
    if (state.lastRepairReport) {
        sections.push(
            "### Repair Agent's Report",
            "",
            "These are claims to verify, not proof. Check each one against the code yourself.",
            "",
            state.lastRepairReport,
            "",
        );
    }
    sections.push(
        buildDiffInspectionSection(diffText, { hasRepairScope }),
        "",
        "### Approved Plan",
        "",
        "Plan content is supplied by the validation request.",
    );
    return {
        prompt: sections.join("\n"),
        customTools,
    };
}

export async function dispatchReviewFeedbackRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    packet: ReviewFeedbackRepairPacket,
): Promise<{ completed: boolean; report: string; reason?: string }> {
    emitStatus(args, buildValidationUserMessage({ kind: "review_repair", repairKind: packet.repairKind }), "warning");
    try {
        const workflowState: ValidationWorkflowState = { ...context.workflowBase, ...packet.activeWorkflow };
        args.session.setActiveWorkflow(workflowState);
        const sessionOutcome = await args.session.runIsolatedAgentSession({
            kind: "feedback_engineer",
            agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
            userRequest: buildValidationRepairPrompt({
                executionCwd: context.executionCwd,
                repairCwd: context.executionCwd,
                worktreeId: context.worktreeId,
                worktreeBranch: context.worktreeBranch,
                worktreeBaseBranch: context.worktreeBaseBranch,
                authorityNote: packet.repairKind === "human_feedback"
                    ? "A human reviewed this change. Their feedback is authoritative."
                    : "A code reviewer found these issues. Fix every finding.",
                repairsNeeded: [
                    "### Findings",
                    "",
                    packet.findingsSection || "(no findings text supplied)",
                    "",
                    buildDiffInspectionSection(packet.diffText),
                ].join("\n"),
                completionInstruction: "Report a disposition for every finding, then call task_completed.",
            }),
            images: packet.images,
            cwd: context.executionCwd,
            customTools: [createReviewDiffTool({ full: packet.diffText }) as unknown as OpaqueToolDefinition],
        });
        if (sessionOutcome.outcome === "operational_failure") {
            return { completed: false, report: "", reason: sessionOutcome.failure.message };
        }
        const taskReport = sessionOutcome.taskReport;
        args.session.setActiveWorkflow({
            ...workflowState,
            lastRepairReport: taskReport.report,
        });
        return { completed: taskReport.completed, report: taskReport.report };
    } catch (error) {
        return { completed: false, report: "", reason: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * The decision when the automatic review rounds are spent.
 *
 * Three ways forward, and every one of them is a way forward: another focused round,
 * hand it to a person, or stop somewhere it can be picked up again. Stop used to be
 * missing here on the grounds that stopping strands the work — but the Plan keeps its
 * passing tests and its review findings, so returning resumes at the review rather
 * than the beginning. A menu with no exit is not the same thing as never stranding
 * someone.
 */
export async function promptForSemanticRoundLimit(
    args: ValidationLoopArgs,
    semanticRound: number,
    openFindingCount: number,
    testsPass: boolean,
): Promise<"continue" | "engineer_follow_up" | "code_review" | "stop"> {
    const prompt = buildValidationUserMessage({
        kind: "semantic_limit",
        planName: args.planName,
        rounds: semanticRound,
        openCount: openFindingCount,
        testsPass,
    });
    emitStatus(args, prompt, "warning");
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt,
        options: [
            { value: "continue", label: "Have the reviewer look again" },
            { value: "engineer_follow_up", label: "Talk to the repair engineer" },
            { value: "code_review", label: "Let me read the changes" },
            { value: "stop", label: "Stop" },
        ],
    });
    if (response.outcome !== "selected") return "stop";
    if (response.value === "code_review") return "code_review";
    if (response.value === "engineer_follow_up") return "engineer_follow_up";
    return response.value === "continue" ? "continue" : "stop";
}
