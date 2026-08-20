/**
 * @module shared/workflow/validation-publication
 * The publication phase: merging the validated worktree into the target branch
 * inside the Direct Delivery transaction, settling the worktree registry, running
 * post-verification handoffs, and building the verified result.
 *
 * Ordering invariant: prepareEpicChildManualQaArtifact runs before checkpointExecutionWorktree
 * so the durable Epic Manual QA artifact is sealed into child delivery.
 */

import { AGENTS, isPlannedChangeClassification } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
import { createQaChecklistGeneratedTool } from "../../tools/qa-checklist-generated.ts";
import { loadDirectDeliveryHierarchySnapshot } from "./validation-delivery-hierarchy.ts";
import {
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    deleteRemotelyPublishedWorktreeBranch,
    removeWorktreeGitArtifacts,
} from "../worktree.js";
import { publishExecutionWorktreeIsolated } from "../isolated-publication.ts";
import {
    findById as findWorktreeRegistryEntryById,
    pruneEntry as pruneWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { ensureRunWieldOwnedGitignoreBlock } from "../runwield-owned-paths.ts";
import { stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import { runDirectDeliveryPublicationTransition } from "./state-transition.ts";
import { readRepairedMergeCandidate } from "./validation-merge-verification.ts";
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
    describeMergePause,
    dispatchMergeRepair,
    finalizeMergeRepair,
    getMergeFailureKind,
    getMergeWorktreePath,
    persistValidationMergeRepairWorktree,
    resolveStoredValidationMergeRepairWorktree,
} from "./validation-merge-repair.ts";
import { recordLifecycleEvent } from "./validation-context.ts";
import { completeProgressRecord, emitProgress, emitStatus } from "./validation-emit.ts";
import { pauseForUserAction } from "./validation-interactions.ts";
import { buildValidationUserMessage, validationUserMessage } from "./validation-user-messages.ts";
import { classifyValidationOperationalError, type GitPublicationErrorKind } from "./validation-operational-errors.ts";
import {
    decideValidationRecovery,
    readValidationRetryPolicy,
    recordOperationalRecoveryMetric,
    waitForValidationRetryWithSessionCancellation,
} from "./validation-recovery.ts";

type DeliveryEvidence = import("../../plan-store.js").DeliveryEvidence;
type WorktreeDeliveryEvidence = import("../../plan-store.js").WorktreeDeliveryEvidence;

function firstMarkdownHeading(markdown: string, fallback: string): string {
    const heading = markdown.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
    return heading ? heading.replace(/^#\s+/, "").trim() : fallback;
}

function publicationFailureKindFromMergeKind(failureKind: string | undefined): GitPublicationErrorKind {
    switch (failureKind) {
        case "target_reference_race":
            return "target_reference_race";
        case "target_sync_conflict":
        case "isolated_publication_conflict":
        case "detached_merge_conflict":
        case "current_checkout_merge_conflict":
        case "content_conflict":
            return "content_conflict";
        case "primary_checkout_dirty":
            return "primary_checkout_dirty";
        case "permission_denied":
            return "permission_denied";
        case "policy_violation":
        case "target_checked_out":
            return "policy_violation";
        default:
            return "post_publication_bookkeeping";
    }
}

async function prepareEpicChildManualQaArtifact(args: ValidationLoopArgs, cwd: string): Promise<void> {
    const plan = await loadPlan(cwd, args.planName).catch(() => null);
    const parentPlan = typeof plan?.attrs.parentPlan === "string" && plan.attrs.parentPlan.trim()
        ? plan.attrs.parentPlan.trim()
        : "";
    if (!parentPlan) return;
    const parent = await loadPlan(cwd, parentPlan).catch(() => null);
    if (parent?.attrs.classification !== "PROJECT") return;

    try {
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
        const outcome = await args.session.runIsolatedAgentSession({
            kind: "manual_qa",
            agentName: AGENTS.OPERATOR,
            userRequest,
            cwd,
            customTools: [tool as unknown as OpaqueToolDefinition],
            sessionManager: args.session.createInMemorySessionManager(cwd),
        });
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
            return;
        }
        console.error("[RunWield] test_note_not_generated");
        emitStatus(args, validationUserMessage("publication_note_failed"), "warning");
    } catch (error) {
        console.error("[RunWield] test_note_generation_failed", error);
        emitStatus(args, validationUserMessage("publication_note_failed"), "warning");
    }
}

export async function runPublicationPhase(
    args: ValidationLoopArgs,
    context: PhaseContext,
    humanReviewMetadata: HumanReviewMetadata,
): Promise<PublicationOutcome> {
    if (context.nonGitInPlace || !context.worktreeBranch) {
        await prepareEpicChildManualQaArtifact(args, context.executionCwd || context.projectRoot);
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
        await recordLifecycleEvent(args, context.projectRoot, "validation_failed", "validated_reviewer", reason);
        return {
            recorded: true,
            result: { kind: "failed", planName: args.planName, projectRoot: context.projectRoot, reason },
        };
    }

    // A remotely verified publication spends its execution attempt. Keeping a
    // merged registry entry would make operational publication ambiguous.
    const cleanupMergedWorktrees = true;
    const planPath = `docs/plans/${args.planName}.md`;
    const storedRepairWorktree = await resolveStoredValidationMergeRepairWorktree(args, context);
    if (storedRepairWorktree.kind === "blocked") return storedRepairWorktree.outcome;
    let repairMergeWorktreePath = storedRepairWorktree.path;
    let agentRepairs = 0;
    let publicationOperationalAttempt = 1;
    // Captured once, as plain strings: the guards above narrowed both, but TypeScript
    // drops that narrowing inside the hoisted helpers below.
    const targetBranch: string = worktreeBaseBranch;
    const executionBranch: string = context.worktreeBranch;
    const storedAttempt = context.worktreeId
        ? await findWorktreeRegistryEntryById(context.projectRoot, context.worktreeId, { migrate: false }).catch(() =>
            null
        )
        : null;
    let publicationArtifactsPrepared = storedAttempt?.status === "publication_failed" ||
        storedAttempt?.status === "validated";

    for (;;) {
        const attempt = await attemptPublication();
        if (attempt.kind === "published") return attempt.outcome;

        const { error, reason } = attempt;
        // Publication may have already succeeded. The merge is irreversible, so an
        // error after the target ref moved is bookkeeping noise over finished work —
        // finish rather than dispatching an Agent to repair a conflict that is gone.
        const nextRepairMergeWorktreePath = getMergeWorktreePath(error);
        if (nextRepairMergeWorktreePath) {
            const persisted = await persistValidationMergeRepairWorktree(args, context, nextRepairMergeWorktreePath);
            if (persisted.kind === "blocked") return persisted.outcome;
            repairMergeWorktreePath = nextRepairMergeWorktreePath;
        }
        const failureKind = getMergeFailureKind(error);
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
            if (await dispatchMergeRepair(args, context, reason, error)) continue;
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

        const pause = describeMergePause(args.planName, worktreeBaseBranch, error, reason, context);
        if (decision.action === "pause" && decision.result.recoveryClass !== "missing_information") {
            emitStatus(args, decision.result.message, "warning");
            return {
                recorded: false,
                result: {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: decision.result.message,
                    recovery: decision.result,
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
        { kind: "published"; outcome: PublicationOutcome } | { kind: "failed"; error: unknown; reason: string }
    > {
        try {
            return { kind: "published", outcome: await publishOnce() };
        } catch (error) {
            return { kind: "failed", error, reason: error instanceof Error ? error.message : String(error) };
        }
    }

    async function publishOnce(): Promise<PublicationOutcome> {
        if (!repairMergeWorktreePath && !publicationArtifactsPrepared) {
            await prepareEpicChildManualQaArtifact(args, context.executionCwd);
        }
        await ensureRunWieldOwnedGitignoreBlock(context.executionCwd);
        const repairedCandidate = repairMergeWorktreePath
            ? await readRepairedMergeCandidate(repairMergeWorktreePath)
            : null;
        const targetHeadBeforeMerge = repairedCandidate?.targetHeadBeforeMerge ||
            await args.git.branchHead(context.projectRoot, targetBranch);
        const checkpoint = repairedCandidate || await checkpointExecutionWorktree({
            worktreePath: context.executionCwd,
            branch: executionBranch,
            planName: args.planName,
            planDescription: args.triageMeta?.summary,
            mergeTargetRef: targetHeadBeforeMerge,
        });
        const deliveryEvidence: WorktreeDeliveryEvidence = {
            version: 1,
            mode: "worktree_merge",
            executionCommit: checkpoint.executionCommit,
            targetBranch,
            targetHeadBeforeMerge,
        };
        const hierarchy = await loadDirectDeliveryHierarchySnapshot(context.executionCwd, args.planName)
            .catch(() => ({ revision: undefined, parentPlan: undefined, siblingPlans: [] }));
        // Repair may have happened before the latest lifecycle state was written.
        // Always stage the current validated Plan in the execution worktree; the
        // repaired publication clone imports that later commit before it publishes.
        const staging = await stageValidationPassedInExecutionWorktree({
            projectRoot: context.projectRoot,
            executionCwd: context.executionCwd,
            planName: args.planName,
            details: {
                triageMeta: args.triageMeta,
                executionMode: "worktree",
                deliveryEvidence,
                worktreeStatus: "merged",
                cleanupMergedWorktrees,
                ...humanReviewMetadata,
            },
        });
        // The validated Plan and Work Record are the final Git-visible lifecycle
        // state. Generate them in the execution worktree before publication so a
        // failed push leaves one complete, retryable branch.
        if (!publicationArtifactsPrepared) {
            await runPostVerificationHandoffs(args, context.executionCwd);
            publicationArtifactsPrepared = true;
        }
        const validatedCandidate = await checkpointExecutionWorktree({
            worktreePath: context.executionCwd,
            branch: executionBranch,
            planName: args.planName,
            planDescription: args.triageMeta?.summary,
            mergeTargetRef: targetHeadBeforeMerge,
        });
        if (context.worktreeId) {
            await updateWorktreeRegistryEntry(context.projectRoot, context.worktreeId, { status: "validated" });
        }
        // The merge is the only irreversible act in the system: a commit that reaches
        // the target branch cannot be taken back. It therefore runs inside the
        // publication transaction, which locks the attempt and the target ref, holds
        // the Plan revision it decided on, and — the part that matters most — journals
        // `direct_delivery_target_ref_moved` the moment the branch moves. Without that
        // journal an interrupted publication leaves no evidence the merge happened, so
        // recovery cannot tell "never merged" from "merged, bookkeeping behind", and
        // the failure path below would report a merge failure for work already on the
        // target branch.
        const epicResolution = shouldContinueParentEpicAfterValidation(args.triageMeta)
            ? await import("./epic-continuation.ts").then(({ resolveEpicContinuation }) =>
                resolveEpicContinuation({ cwd: context.executionCwd, completedPlanName: args.planName })
            )
            : undefined;
        const publication = await runDirectDeliveryPublicationTransition({
            projectRoot: context.projectRoot,
            planName: args.planName,
            immutablePlan: true,
            worktreeId: context.worktreeId,
            targetRef: worktreeBaseBranch,
            parentPlan: hierarchy.parentPlan,
            siblingPlanNames: hierarchy.siblingPlans.map((sibling) => sibling.name),
            publicationProof: { deliveryEvidence, cleanupMergedWorktrees, phase: "stage_merge_settle" },
            publish: async ({ markEffect }) => {
                await markEffect("direct_delivery_publication_started", {
                    planName: args.planName,
                    worktreeId: context.worktreeId,
                    worktreeBranch: executionBranch,
                    targetBranch: worktreeBaseBranch,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                    sealedExecutionCommit: validatedCandidate.executionCommit,
                    preservedPlanPaths: staging.planPaths,
                });
                const mergeResult = await publishExecutionWorktreeIsolated({
                    projectRoot: context.projectRoot,
                    executionCwd: context.executionCwd,
                    executionBranch,
                    targetBranch,
                    planName: args.planName,
                    planDescription: args.triageMeta?.summary,
                    sealedExecutionCommit: validatedCandidate.executionCommit,
                    allowedPlanPaths: staging.planPaths.length > 0 ? staging.planPaths : [planPath],
                    repairedPublicationRoot: repairMergeWorktreePath || undefined,
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
                });
                await markEffect("direct_delivery_target_ref_moved", {
                    planName: args.planName,
                    worktreeId: context.worktreeId,
                    worktreeBranch: executionBranch,
                    targetBranch: worktreeBaseBranch,
                    updatedPrimaryCheckout: mergeResult?.updatedPrimaryCheckout,
                    executionMetadataCommit: mergeResult?.executionMetadataCommit,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    expectedTargetHead: mergeResult.targetHeadBeforeMerge,
                    publicationCommit: mergeResult.publicationCommit,
                    publicationMode: mergeResult.publicationMode,
                    ...(mergeResult.publicationMode === "remote"
                        ? {
                            upstreamRemote: mergeResult.upstreamRemote,
                            upstreamBranch: mergeResult.upstreamBranch,
                        }
                        : {}),
                });
                emitStatus(
                    args,
                    buildValidationUserMessage({ kind: "publication_progress", phase: "cleanup", targetBranch }),
                );
                await settlePublishedWorktree(args, context, cleanupMergedWorktrees, mergeResult);
                if (context.worktreeId) {
                    await markEffect("worktree_registry_updated", { worktreeId: context.worktreeId, status: "merged" });
                }
                return { mergeResult };
            },
        });
        if (publication.status !== "committed") {
            if (context.worktreeId) {
                await updateWorktreeRegistryEntry(context.projectRoot, context.worktreeId, {
                    status: "publication_failed",
                }).catch(() => {});
            }
            // Rethrow the original failure rather than a summary of it: callers
            // classify typed merge failures to pick the right repair worktree, and
            // flattening to `message` silently downgrades that to a generic repair.
            if (publication.cause !== undefined) throw publication.cause;
            throw new Error(publication.message || `Direct Delivery publication did not commit for ${args.planName}.`);
        }
        return { recorded: true, result: buildVerifiedResult(args, context.projectRoot, epicResolution) };
    }
}

export async function settlePublishedWorktree(
    _args: ValidationLoopArgs,
    context: PhaseContext,
    cleanupMergedWorktrees: boolean,
    publication?: {
        publicationMode: "local" | "remote";
        publicationCommit: string;
        upstreamRemote?: string;
        upstreamBranch?: string;
    },
): Promise<void> {
    if (context.worktreeId) {
        await updateWorktreeRegistryEntry(context.projectRoot, context.worktreeId, { status: "merged" });
    }

    let cleanupFinished = cleanupMergedWorktrees;
    if (cleanupMergedWorktrees && context.executionCwd) {
        try {
            await removeWorktreeGitArtifacts({
                projectRoot: context.projectRoot,
                path: context.executionCwd,
                force: false,
            });
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) cleanupFinished = true;
            else cleanupFinished = false;
        }
    }
    if (cleanupMergedWorktrees && context.worktreeBranch) {
        try {
            const branchCleanup = publication?.publicationMode === "remote" &&
                    publication.upstreamRemote && publication.upstreamBranch
                ? await deleteRemotelyPublishedWorktreeBranch({
                    projectRoot: context.projectRoot,
                    branch: context.worktreeBranch,
                    remote: publication.upstreamRemote,
                    upstreamBranch: publication.upstreamBranch,
                    publicationCommit: publication.publicationCommit,
                })
                : await deleteMergedWorktreeBranch({
                    projectRoot: context.projectRoot,
                    branch: context.worktreeBranch,
                });
            cleanupFinished = cleanupFinished && branchCleanup.deleted;
        } catch {
            cleanupFinished = false;
        }
    }

    if (context.worktreeId && cleanupFinished) {
        await pruneWorktreeRegistryEntry(context.projectRoot, context.worktreeId).catch(() => {});
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
            buildValidationUserMessage({ kind: "verified", planName: args.planName }),
            "success",
            completeProgressRecord(
                current,
                true,
                buildValidationUserMessage({ kind: "verified", planName: args.planName }),
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
