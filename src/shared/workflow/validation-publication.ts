/**
 * @module shared/workflow/validation-publication
 * The publication phase: merging the validated worktree into the target branch
 * through the durable publication state machine, settling the worktree registry, running
 * post-verification handoffs, and building the verified result.
 *
 * Ordering invariant: prepareEpicChildManualQaArtifact runs before checkpointExecutionWorktree
 * so the durable Epic Manual QA artifact is sealed into child delivery.
 */

import { AGENTS, isPlannedChangeClassification } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
import { createQaChecklistGeneratedTool } from "../../tools/qa-checklist-generated.ts";
import { checkpointExecutionWorktree } from "../worktree.js";
import { publishExecutionWorktreeIsolated } from "../isolated-publication.ts";
import { findById as findWorktreeRegistryEntryById } from "../worktree-registry.js";
import { ensureRunWieldOwnedGitignoreBlock } from "../runwield-owned-paths.ts";
import { stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import { shouldContinueParentEpicAfterValidation } from "./validation-scope.ts";
import type {
    HumanReviewMetadata,
    PhaseContext,
    PublicationOutcome,
    ValidationLoopArgs,
    ValidationPhaseResult,
} from "./validation-types.ts";
import type { OpaqueToolDefinition } from "./validation-ports.ts";
import { MAX_AGENT_MERGE_REPAIRS } from "./validation-types.ts";
import {
    annotatePublicationStage,
    describeMergePause,
    dispatchMergeRepair,
    finalizeMergeRepair,
    getMergeFailureKind,
    getMergeWorktreePath,
    normalizePublicationFailure,
    type PublicationFailure,
    publicationFailureNeedsUserAction,
    type PublicationStage,
} from "./validation-merge-repair.ts";
import { recordLifecycleEvent } from "./validation-context.ts";
import { completeProgressRecord, emitProgress, emitStatus } from "./validation-emit.ts";
import { pauseForUserAction } from "./validation-interactions.ts";
import { buildValidationUserMessage, validationUserMessage } from "./validation-user-messages.ts";
import {
    classifyValidationOperationalError,
    type GitPublicationErrorKind,
    type ValidationOperationalFailure,
} from "./validation-operational-errors.ts";
import {
    decideValidationRecovery,
    readValidationRetryPolicy,
    recordOperationalRecoveryMetric,
    waitForValidationRetryWithSessionCancellation,
} from "./validation-recovery.ts";
import {
    advanceStoredPublication,
    cleanupStoredPublication,
    failStoredPublication,
    loadPublicationAttempt,
    reconcileStoredPublication,
    startPublicationAttempt,
} from "./publication-machine.ts";
import type { PublicationAttempt } from "./publication-attempt.ts";

type DeliveryEvidence = import("../../plan-store.js").DeliveryEvidence;
type WorktreeDeliveryEvidence = import("../../plan-store.js").WorktreeDeliveryEvidence;
type ManualQaPreparationResult = { kind: "ready" } | { kind: "blocked"; outcome: PublicationOutcome };

function firstMarkdownHeading(markdown: string, fallback: string): string {
    const heading = markdown.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
    return heading ? heading.replace(/^#\s+/, "").trim() : fallback;
}

export function publicationFailureKindFromMergeKind(failureKind: string | undefined): GitPublicationErrorKind {
    switch (failureKind) {
        case "target_reference_race":
            return "target_reference_race";
        case "remote_unavailable":
            return "remote_unavailable";
        case "target_sync_conflict":
        case "isolated_publication_conflict":
        case "detached_merge_conflict":
        case "current_checkout_merge_conflict":
        case "local_publication_conflict":
        case "content_conflict":
            return "content_conflict";
        case "primary_checkout_dirty":
            return "primary_checkout_dirty";
        case "target_branch_advanced":
        case "target_history_rewrite":
            return "target_reference_race";
        case "permission_denied":
            return "permission_denied";
        case "policy_violation":
        case "target_checked_out":
        case "publication_target_changed":
            return "policy_violation";
        default:
            return "post_publication_bookkeeping";
    }
}

function operationalPhaseResult(
    args: ValidationLoopArgs,
    projectRoot: string,
    failure: ValidationOperationalFailure,
    attempt: number,
): PublicationOutcome {
    const decision = decideValidationRecovery({
        failure,
        attempt,
        policy: readValidationRetryPolicy(projectRoot),
        nextPhase: "delivery",
    });
    return {
        recorded: false,
        result: {
            kind: decision.action === "halt" ? "failed" : "paused",
            planName: args.planName,
            projectRoot,
            reason: decision.result.message,
            recovery: decision.result,
        },
    };
}

async function prepareEpicChildManualQaArtifact(
    args: ValidationLoopArgs,
    cwd: string,
    projectRoot: string,
): Promise<ManualQaPreparationResult> {
    const plan = await loadPlan(cwd, args.planName).catch(() => null);
    const parentPlan = typeof plan?.attrs.parentPlan === "string" && plan.attrs.parentPlan.trim()
        ? plan.attrs.parentPlan.trim()
        : "";
    if (!parentPlan) return { kind: "ready" };
    const parent = await loadPlan(cwd, parentPlan).catch(() => null);
    if (parent?.attrs.classification !== "PROJECT") return { kind: "ready" };

    let attempt = 1;
    for (;;) {
        emitStatus(args, buildValidationUserMessage({ kind: "qa_prepare", planName: args.planName }), "info");
        const userRequest = [
            "Prepare this Epic child's Manual QA checklist.",
            `Name: ${args.planName}`,
            "Classification: PLANNED_CHANGE",
            "",
            "Call qa_checklist_generated with the checklistMarkdown argument.",
            "The checklistMarkdown must start with this exact heading:",
            `Manual verification steps for ${args.planName}`,
            "It must contain 1 to 6 unchecked checklist items.",
            "Do not finish with ordinary text instead of the tool call.",
            "",
            "### Source context",
            args.planContent,
        ].join("\n");
        const tool = createQaChecklistGeneratedTool({
            projectRoot: cwd,
            epicPlanName: parentPlan,
            childPlanName: args.planName,
            childHeading: firstMarkdownHeading(args.planContent, args.planName),
        });
        let outcome;
        try {
            outcome = await args.session.runIsolatedAgentSession({
                kind: "manual_qa",
                agentName: AGENTS.OPERATOR,
                userRequest,
                cwd,
                customTools: [tool as unknown as OpaqueToolDefinition],
                sessionManager: args.session.createInMemorySessionManager(cwd),
            });
        } catch (caught) {
            const error = caught instanceof Error ? caught : new Error(String(caught));
            outcome = {
                kind: "manual_qa" as const,
                outcome: "operational_failure" as const,
                failure: classifyValidationOperationalError({
                    source: "provider",
                    kind: "legacy_text",
                    operation: "agent_session",
                    message: error.message,
                }),
            };
        }
        if (outcome.outcome === "recorded" || outcome.outcome === "already_present") {
            emitStatus(
                args,
                buildValidationUserMessage({
                    kind: "qa_ready",
                    path: outcome.relativePath,
                    existed: outcome.outcome === "already_present",
                }),
                "info",
            );
            return { kind: "ready" };
        }
        if (outcome.outcome === "operational_failure") {
            const decision = decideValidationRecovery({
                failure: outcome.failure,
                attempt,
                policy: readValidationRetryPolicy(projectRoot),
                nextPhase: "delivery",
            });
            await recordOperationalRecoveryMetric(args, projectRoot, decision.result);
            if (decision.action === "retry") {
                emitStatus(args, decision.result.message, "warning");
                const wait = await waitForValidationRetryWithSessionCancellation(args, decision.delayMs, "publication");
                if (wait === "completed") {
                    attempt += 1;
                    continue;
                }
            }
            emitStatus(args, decision.result.message, decision.action === "halt" ? "error" : "warning");
            return { kind: "blocked", outcome: operationalPhaseResult(args, projectRoot, outcome.failure, attempt) };
        }
        console.error("[RunWield] test_note_not_generated");
        emitStatus(args, validationUserMessage("publication_note_failed"), "warning");
        return { kind: "ready" };
    }
}

export async function runPublicationPhase(
    args: ValidationLoopArgs,
    context: PhaseContext,
    humanReviewMetadata: HumanReviewMetadata,
): Promise<PublicationOutcome> {
    if (context.nonGitInPlace || !context.worktreeBranch) {
        const manualQa = await prepareEpicChildManualQaArtifact(
            args,
            context.executionCwd || context.projectRoot,
            context.projectRoot,
        );
        if (manualQa.kind === "blocked") return manualQa.outcome;
        const deliveryEvidence: DeliveryEvidence = context.nonGitInPlace
            ? { version: 1, mode: "non_git_in_place" }
            : null;
        await recordLifecycleEvent(args, context.projectRoot, "validation_passed", "validated_reviewer", undefined, {
            executionMode: context.nonGitInPlace ? "non_git_in_place" : undefined,
            deliveryEvidence,
            ...humanReviewMetadata,
        });
        await runPostVerificationHandoffs(args, context.executionCwd || context.projectRoot);
        return { recorded: true, result: buildVerifiedResult(args, context.projectRoot) };
    }

    const worktreeBaseBranch = context.worktreeBaseBranch;
    if (!worktreeBaseBranch) {
        const reason =
            `Target branch metadata is missing for worktree branch ${context.worktreeBranch}; Workflow Validation cannot publish Delivery Evidence without a concrete target branch.`;
        const failure = classifyValidationOperationalError({
            source: "validation_state",
            kind: "worktree_record_missing",
            operation: "publication",
            message: reason,
        });
        const outcome = operationalPhaseResult(args, context.projectRoot, failure, 1);
        if (outcome.result.recovery) {
            await recordOperationalRecoveryMetric(args, context.projectRoot, outcome.result.recovery);
        }
        return outcome;
    }

    // A remotely verified publication spends its execution attempt. The registry
    // entry remains the only publication authority until cleanup completes.
    const cleanupMergedWorktrees = true;
    const planPath = `docs/plans/${args.planName}.md`;
    // Captured once, as plain strings: the guards above narrowed both, but TypeScript
    // drops that narrowing inside the hoisted helpers below.
    const targetBranch: string = worktreeBaseBranch;
    const executionBranch: string = context.worktreeBranch;
    if (!context.worktreeId) {
        throw new Error(`Worktree publication for ${args.planName} requires an execution attempt id.`);
    }
    const worktreeId = context.worktreeId;
    const storedAttempt = worktreeId
        ? await findWorktreeRegistryEntryById(context.projectRoot, context.worktreeId, { migrate: false }).catch(() =>
            null
        )
        : null;
    let publicationAttempt: PublicationAttempt | null = storedAttempt?.publication ||
        await loadPublicationAttempt(context.projectRoot, worktreeId);
    let repairMergeWorktreePath = publicationAttempt?.failure?.repairRoot;
    if (repairMergeWorktreePath) {
        const exists = await Deno.stat(repairMergeWorktreePath).then((value) => value.isDirectory).catch(() => false);
        if (!exists) repairMergeWorktreePath = undefined;
    }
    let agentRepairs = 0;
    // A restarted validation can inherit a repair checkout that is still inside
    // Git's merge transaction. Normalize it before attempting another merge.
    if (repairMergeWorktreePath) await finalizeMergeRepair(repairMergeWorktreePath);
    let publicationOperationalAttempt = 1;

    for (;;) {
        const attempt = await attemptPublication();
        if (attempt.kind === "published") return attempt.outcome;

        const { failure } = attempt;
        const reason = failure.reason;
        // Publication may have already succeeded. The merge is irreversible, so an
        // error after the target ref moved is bookkeeping noise over finished work —
        // finish rather than dispatching an Agent to repair a conflict that is gone.
        const nextRepairMergeWorktreePath = getMergeWorktreePath(failure);
        if (nextRepairMergeWorktreePath) {
            repairMergeWorktreePath = nextRepairMergeWorktreePath;
        }
        const failureKind = getMergeFailureKind(failure);
        const operationalFailure = classifyValidationOperationalError({
            source: "git_publication",
            kind: publicationFailureKindFromMergeKind(failureKind),
            operation: "publication",
            message: reason,
        });
        const decision = decideValidationRecovery({
            failure: operationalFailure,
            attempt: publicationOperationalAttempt,
            correctionAttempt: agentRepairs + 1,
            policy: readValidationRetryPolicy(context.projectRoot),
            nextPhase: "delivery",
        });
        await recordOperationalRecoveryMetric(args, context.projectRoot, decision.result);

        if (decision.action === "retry") {
            emitStatus(args, decision.result.message, "warning");
            const wait = await waitForValidationRetryWithSessionCancellation(args, decision.delayMs, "publication");
            if (wait === "completed") {
                publicationOperationalAttempt += 1;
                continue;
            }
            return {
                recorded: false,
                result: {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: "Validation retry was canceled. Run this Plan again when you are ready.",
                    recovery: decision.result,
                },
            };
        }

        // A merge conflict is normal and fixable, so try the Agent first and retry
        // publication in the same call. Other publication errors need retry,
        // deterministic recovery, or a user action.
        if (decision.action === "correct" && agentRepairs < MAX_AGENT_MERGE_REPAIRS) {
            agentRepairs += 1;
            if (await dispatchMergeRepair(args, context, reason, failure)) continue;
        }

        if (decision.action === "halt") {
            emitStatus(args, decision.result.message, "error");
            return {
                recorded: false,
                result: {
                    kind: "failed",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: decision.result.message,
                    recovery: decision.result,
                },
            };
        }

        const pause = describeMergePause(args.planName, worktreeBaseBranch, failure, context);
        if (decision.action === "pause" && decision.result.recoveryClass !== "missing_information") {
            const retryPauseMessage = buildValidationUserMessage({
                kind: "user_action",
                whatHappened:
                    `Git could not publish "${args.planName}" to ${targetBranch} after ${publicationOperationalAttempt} automatic attempts.`,
                details: [reason, `Source branch: ${executionBranch}`, `Target branch: ${targetBranch}`],
                doThis:
                    `Restore the remote connection or wait for ${targetBranch} to stop changing, then run \`wld load-plan ${args.planName}\` and retry publication.`,
            });
            const recovery = { ...decision.result, message: retryPauseMessage };
            emitStatus(args, retryPauseMessage, "warning");
            return {
                recorded: false,
                result: {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: retryPauseMessage,
                    recovery,
                },
            };
        }
        if (!publicationFailureNeedsUserAction(failure)) {
            // A transient lock or interrupted transition can disappear immediately.
            // Retry once in-process; publicationArtifactsPrepared prevents completed
            // LLM handoffs from running again.
            if (publicationOperationalAttempt === 1) {
                publicationOperationalAttempt += 1;
                continue;
            }
            const blockedMessage = buildValidationUserMessage({
                kind: "publication_blocked",
                planName: args.planName,
                stage: failure.publicationStage || "git_publication",
            });
            console.error("[RunWield] publication_resume_failed", {
                planName: args.planName,
                stage: failure.publicationStage || "git_publication",
                error: failure.reason,
            });
            emitStatus(args, blockedMessage, "warning");
            return {
                recorded: false,
                result: {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: blockedMessage,
                },
            };
        }
        if (await pauseForUserAction(args, pause) === "retry") {
            // The user may have staged resolutions, left unstaged repair files, or
            // committed some/all of the repair themselves. Normalize every one of
            // those valid states before publication reads the repaired candidate.
            if (repairMergeWorktreePath && await finalizeMergeRepair(repairMergeWorktreePath)) continue;
            continue;
        }
        return {
            recorded: false,
            result: {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                awaitingUserAction: true,
                // The execution Plan stays `validated`: tests and review are final,
                // while the registry keeps publication pending for a later retry.
                reason:
                    `${pause.whatHappened} ${pause.doThis} Run this Plan again when you are ready and RunWield will pick up at the merge.`,
            },
        };
    }

    async function attemptPublication(): Promise<
        { kind: "published"; outcome: PublicationOutcome } | { kind: "failed"; failure: PublicationFailure }
    > {
        try {
            return { kind: "published", outcome: await publishOnce() };
        } catch (caught) {
            const error = caught instanceof Error ? caught : new Error(String(caught));
            const failure = normalizePublicationFailure(error);
            if (publicationAttempt) {
                publicationAttempt = await failStoredPublication(context.projectRoot, publicationAttempt, {
                    kind: getMergeFailureKind(failure) || "publication_failed",
                    message: failure.reason,
                    ...(getMergeWorktreePath(failure) ? { repairRoot: getMergeWorktreePath(failure) } : {}),
                }).catch(() => publicationAttempt);
            }
            return { kind: "failed", failure };
        }
    }

    async function publishOnce(): Promise<PublicationOutcome> {
        const atStage = async <T>(stage: PublicationStage, action: () => Promise<T>): Promise<T> => {
            try {
                return await action();
            } catch (caught) {
                const error = caught instanceof Error ? caught : new Error(String(caught));
                throw annotatePublicationStage(error, stage);
            }
        };
        if (publicationAttempt) {
            publicationAttempt = await atStage(
                "git_publication",
                async () => await reconcileStoredPublication(context.projectRoot, publicationAttempt!),
            );
            if (publicationAttempt.phase === "cleanup_complete") {
                await cleanupStoredPublication(context.projectRoot, publicationAttempt);
                return {
                    recorded: true,
                    result: buildVerifiedResult(args, context.projectRoot, undefined, targetBranch),
                };
            }
        }
        if (!publicationAttempt) {
            await atStage(
                "candidate_checkpoint",
                async () => await ensureRunWieldOwnedGitignoreBlock(context.executionCwd),
            );
            const targetHeadAtSeal = await args.git.branchHead(context.projectRoot, targetBranch);
            const candidate = await atStage("candidate_checkpoint", async () =>
                await checkpointExecutionWorktree({
                    worktreePath: context.executionCwd,
                    branch: executionBranch,
                    planName: args.planName,
                    planDescription: args.triageMeta?.summary,
                    mergeTargetRef: targetHeadAtSeal,
                }));
            publicationAttempt = await startPublicationAttempt({
                projectRoot: context.projectRoot,
                attemptId: worktreeId,
                planName: args.planName,
                targetBranch,
                executionBranch,
                executionCwd: context.executionCwd,
                validatedCommit: candidate.executionCommit,
                targetHeadAtSeal,
            });
        }

        if (publicationAttempt.phase === "candidate_sealed") {
            const manualQa = await atStage(
                "artifact_preparation",
                async () => await prepareEpicChildManualQaArtifact(args, context.executionCwd, context.projectRoot),
            );
            if (manualQa.kind === "blocked") return manualQa.outcome;
            const deliveryEvidence: WorktreeDeliveryEvidence = {
                version: 1,
                mode: "worktree_merge",
                executionCommit: publicationAttempt.validatedCommit,
                targetBranch,
                targetHeadBeforeMerge: publicationAttempt.targetHeadAtSeal,
            };
            const staging = await atStage(
                "lifecycle_staging",
                async () =>
                    await stageValidationPassedInExecutionWorktree({
                        projectRoot: context.projectRoot,
                        executionCwd: context.executionCwd,
                        planName: args.planName,
                        details: {
                            triageMeta: args.triageMeta,
                            executionMode: "worktree",
                            deliveryEvidence,
                            cleanupMergedWorktrees,
                            ...humanReviewMetadata,
                        },
                    }),
            );
            await atStage(
                "artifact_preparation",
                async () => await runPostVerificationHandoffs(args, context.executionCwd),
            );
            const artifactCandidate = await atStage("candidate_sealing", async () =>
                await checkpointExecutionWorktree({
                    worktreePath: context.executionCwd,
                    branch: executionBranch,
                    planName: args.planName,
                    planDescription: args.triageMeta?.summary,
                    mergeTargetRef: publicationAttempt?.targetHeadAtSeal,
                }));
            publicationAttempt = await advanceStoredPublication(
                context.projectRoot,
                publicationAttempt,
                "artifacts_committed",
                {
                    artifactCommit: artifactCandidate.executionCommit,
                    planPaths: staging.planPaths.length > 0 ? staging.planPaths : [planPath],
                },
            );
        }

        const artifactCommit = publicationAttempt.artifactCommit;
        if (!artifactCommit) throw new Error(`Publication artifacts are missing for ${args.planName}.`);
        const planPaths = publicationAttempt.planPaths || [planPath];
        const epicResolution = shouldContinueParentEpicAfterValidation(args.triageMeta)
            ? await import("./epic-continuation.ts").then(({ resolveEpicContinuation }) =>
                resolveEpicContinuation({ cwd: context.executionCwd, completedPlanName: args.planName })
            )
            : undefined;
        if (publicationAttempt.phase !== "publication_verified") {
            await atStage("git_publication", async () =>
                await publishExecutionWorktreeIsolated({
                    projectRoot: context.projectRoot,
                    executionCwd: context.executionCwd,
                    executionBranch,
                    targetBranch,
                    planName: args.planName,
                    planDescription: args.triageMeta?.summary,
                    sealedExecutionCommit: artifactCommit,
                    allowedPlanPaths: planPaths,
                    publicationRoot: publicationAttempt?.publicationRoot,
                    repairedPublicationRoot: repairMergeWorktreePath || undefined,
                    onIntegrated: async (evidence) => {
                        if (!publicationAttempt) throw new Error("Publication attempt disappeared before integration.");
                        publicationAttempt = await advanceStoredPublication(
                            context.projectRoot,
                            publicationAttempt,
                            "target_integrated",
                            evidence,
                        );
                    },
                    onPublished: async (evidence) => {
                        if (!publicationAttempt) throw new Error("Publication attempt disappeared before publication.");
                        publicationAttempt = await advanceStoredPublication(
                            context.projectRoot,
                            publicationAttempt,
                            "target_published",
                            evidence,
                        );
                    },
                    onVerified: async () => {
                        if (!publicationAttempt) {
                            throw new Error("Publication attempt disappeared before verification.");
                        }
                        publicationAttempt = await advanceStoredPublication(
                            context.projectRoot,
                            publicationAttempt,
                            "publication_verified",
                            { verifiedAt: new Date().toISOString() },
                        );
                    },
                    onProgress: (phase) => {
                        const message = buildValidationUserMessage({
                            kind: "publication_progress",
                            phase,
                            targetBranch,
                        });
                        if (phase === "preparing") {
                            emitProgress(
                                args,
                                message,
                                "info",
                                { outcome: "running", stage: "merge", checks: { merge: "running" } },
                            );
                            return;
                        }
                        emitStatus(args, message);
                    },
                }));
        }
        emitStatus(
            args,
            buildValidationUserMessage({ kind: "publication_progress", phase: "cleanup", targetBranch }),
        );
        const cleanup = await cleanupStoredPublication(context.projectRoot, publicationAttempt);
        publicationAttempt = cleanup.attempt;
        if (!cleanup.complete) {
            emitStatus(
                args,
                buildValidationUserMessage({
                    kind: "publication_cleanup_incomplete",
                    targetBranch,
                    worktreePath: cleanup.worktreeKept ? context.executionCwd : undefined,
                    worktreeBranch: cleanup.branchKept ? context.worktreeBranch : undefined,
                    details: cleanup.details,
                }),
                "warning",
            );
            return {
                recorded: true,
                result: buildVerifiedResult(args, context.projectRoot, epicResolution, targetBranch),
            };
        }
        return { recorded: true, result: buildVerifiedResult(args, context.projectRoot, epicResolution, targetBranch) };
    }
}

export async function runPostVerificationHandoffs(args: ValidationLoopArgs, projectRoot: string): Promise<void> {
    if (!isPlannedChangeClassification(args.triageMeta?.classification)) return;
    await args.session.runPostVerificationHandoffs({
        planName: args.planName,
        planContent: args.planContent,
        projectRoot,
        mnemosynePort: args.workRecordMnemosynePort,
    });
}

export function buildVerifiedResult(
    args: ValidationLoopArgs,
    projectRoot: string,
    epicResolution?: import("./epic-continuation.ts").EpicContinuationResolution,
    targetBranch?: string,
): ValidationPhaseResult {
    // The run is over, so its position must not outlive it — a Plan reopened later
    // has to start from what the Plan durably says, not from where this one ended.
    args.session.clearPosition(args.planName);
    // Close the panel out on the way past. Without this the last thing the user
    // sees is a merge still "running", on a run that finished successfully.
    const current = args.session.getCurrentProgress();
    if (current) {
        emitStatus(
            args,
            buildValidationUserMessage({ kind: "verified", planName: args.planName, targetBranch }),
            "success",
            completeProgressRecord(
                current,
                true,
                buildValidationUserMessage({ kind: "verified", planName: args.planName, targetBranch }),
            ),
        );
    }
    return {
        kind: "verified",
        planName: args.planName,
        projectRoot,
        classification: args.triageMeta?.classification,
        ...(shouldContinueParentEpicAfterValidation(args.triageMeta)
            ? { epicContinuation: { completedPlanName: args.planName, projectRoot, resolution: epicResolution } }
            : {}),
    };
}
