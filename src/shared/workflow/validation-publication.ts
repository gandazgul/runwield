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
import { shouldCleanupMergedWorktrees } from "../settings.js";
import { loadDirectDeliveryHierarchySnapshot } from "./validation-delivery-hierarchy.ts";
import {
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    removeWorktreeGitArtifacts,
    restorePrimaryPlanPathAfterMergeFailure,
} from "../worktree.js";
import {
    pruneEntry as pruneWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { stageValidationPassedInExecutionWorktree, VALIDATION_PLAN_STATUSES } from "./plan-lifecycle.js";
import { runDirectDeliveryPublicationTransition } from "./state-transition.ts";
import { readRepairedMergeCandidate, verifyPostMergeCandidatePublished } from "./validation-merge-verification.ts";
import { shouldContinueParentEpicAfterValidation } from "./validation-scope.ts";
import type {
    HumanReviewMetadata,
    PhaseContext,
    PlanEventStatus,
    PublicationOutcome,
    RecordPlanEventArgs,
    ValidationLoopArgs,
    ValidationPhaseResult,
} from "./validation-types.ts";
import type { OpaqueToolDefinition } from "./validation-ports.ts";
import { MAX_AGENT_MERGE_REPAIRS } from "./validation-types.ts";
import {
    describeMergePause,
    dispatchMergeRepair,
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
        await runPostVerificationHandoffs(args, context.projectRoot);
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

    const cleanupMergedWorktrees = shouldCleanupMergedWorktrees(context.projectRoot);
    const gitPort = args.git;
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

    for (;;) {
        const attempt = await attemptPublication();
        if (attempt.kind === "published") return attempt.outcome;

        const { error, reason } = attempt;
        // Publication may have already succeeded. The merge is irreversible, so an
        // error after the target ref moved is bookkeeping noise over finished work —
        // finish rather than dispatching an Agent to repair a conflict that is gone.
        if (await isPlanAlreadyPublished(context.projectRoot, args.planName)) {
            await runPostVerificationHandoffs(args, context.projectRoot);
            return { recorded: true, result: buildVerifiedResult(args, context.projectRoot) };
        }
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

        // Only a proven content conflict can go to merge repair. Other publication
        // errors need retry, deterministic recovery, or a user action.
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
        if (await pauseForUserAction(args, pause) === "retry") continue;
        return {
            recorded: false,
            result: {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                // The Plan stays at `validated_reviewer`: tests passed and the review
                // approved, so publication is all that is left. Recording a merge
                // failure would reset it to `implemented` and make the user sit through
                // the whole pipeline again for a merge they can finish in a minute.
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
        if (!repairMergeWorktreePath) await prepareEpicChildManualQaArtifact(args, context.executionCwd);
        const repairedCandidate = repairMergeWorktreePath
            ? await readRepairedMergeCandidate(repairMergeWorktreePath)
            : null;
        const targetHeadBeforeMerge = repairedCandidate?.targetHeadBeforeMerge ||
            await gitPort.branchHead(context.projectRoot, targetBranch);
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
        const hierarchy = await loadDirectDeliveryHierarchySnapshot(context.projectRoot, args.planName)
            .catch(() => ({ revision: undefined, parentPlan: undefined, siblingPlans: [] }));
        const repairedPlanPaths = new Set([planPath]);
        if (hierarchy.parentPlan) repairedPlanPaths.add(`docs/plans/${hierarchy.parentPlan}.md`);
        for (const sibling of hierarchy.siblingPlans) repairedPlanPaths.add(`docs/plans/${sibling.name}.md`);
        const staging = repairedCandidate
            ? { planPaths: [...repairedPlanPaths] }
            : await stageValidationPassedInExecutionWorktree({
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
        // The merge is the only irreversible act in the system: a commit that reaches
        // the target branch cannot be taken back. It therefore runs inside the
        // publication transaction, which locks the attempt and the target ref, holds
        // the Plan revision it decided on, and — the part that matters most — journals
        // `direct_delivery_target_ref_moved` the moment the branch moves. Without that
        // journal an interrupted publication leaves no evidence the merge happened, so
        // recovery cannot tell "never merged" from "merged, bookkeeping behind", and
        // the failure path below would report a merge failure for work already on the
        // target branch.
        const publication = await runDirectDeliveryPublicationTransition({
            projectRoot: context.projectRoot,
            planName: args.planName,
            expectedRevision: hierarchy.revision,
            worktreeId: context.worktreeId,
            targetRef: worktreeBaseBranch,
            parentPlan: hierarchy.parentPlan,
            siblingPlanNames: hierarchy.siblingPlans.map((sibling) => sibling.name),
            publicationProof: { deliveryEvidence, cleanupMergedWorktrees, phase: "stage_merge_settle" },
            publish: async ({ markEffect, registerRollback }) => {
                // Git refuses to merge over untracked or modified files in the primary
                // checkout, and the Plan file is always one of those: the planner wrote
                // it here, and the worktree is about to bring its own copy. Snapshot
                // and lift each preserved Plan path out of the way first, then let the
                // merge deliver the staged version. Without this every publication ends
                // in "please move or remove them before you merge".
                const primaryPlanSnapshots: Awaited<ReturnType<typeof preparePrimaryPlanPathForMerge>>[] = [];
                for (const relativePath of staging.planPaths) {
                    primaryPlanSnapshots.push(
                        await preparePrimaryPlanPathForMerge({
                            projectRoot: context.projectRoot,
                            relativePath,
                        }),
                    );
                }
                if (primaryPlanSnapshots.length > 0) {
                    registerRollback("restore_primary_plan_snapshots", async () => {
                        for (const snapshot of primaryPlanSnapshots.toReversed()) {
                            await restorePrimaryPlanPathAfterMergeFailure(snapshot);
                        }
                    });
                }
                await markEffect("direct_delivery_publication_started", {
                    planName: args.planName,
                    worktreeId: context.worktreeId,
                    worktreeBranch: executionBranch,
                    targetBranch: worktreeBaseBranch,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    preservedPlanPaths: staging.planPaths,
                });
                // Say what is about to happen to the user's branch. The merge is the
                // one irreversible act in the system, and publication had gone silent
                // about it: the branch moved with nothing in the transcript saying so.
                emitProgress(
                    args,
                    buildValidationUserMessage({
                        kind: "merge_progress",
                        sourceBranch: executionBranch,
                        targetBranch,
                    }),
                    "info",
                    { outcome: "running", stage: "merge", checks: { merge: "running" } },
                );
                const mergeResult = await mergeExecutionWorktree({
                    projectRoot: context.projectRoot,
                    branch: executionBranch,
                    targetBranch,
                    worktreePath: context.executionCwd,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                    planName: args.planName,
                    planDescription: args.triageMeta?.summary,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    allowedDirtyPaths: staging.planPaths.length > 0 ? staging.planPaths : [planPath],
                    preservePlanPaths: staging.planPaths,
                    // Set only after a conflict was repaired in a detached merge
                    // worktree. Publishing that tree is what finishes the repair;
                    // merging again from scratch would recreate the same conflict.
                    repairMergeWorktreePath,
                });
                await markEffect("direct_delivery_target_ref_moved", {
                    planName: args.planName,
                    worktreeId: context.worktreeId,
                    worktreeBranch: executionBranch,
                    targetBranch: worktreeBaseBranch,
                    updatedPrimaryCheckout: mergeResult?.updatedPrimaryCheckout,
                    executionMetadataCommit: mergeResult?.executionMetadataCommit,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                });
                const mergeVerification = await verifyPostMergeCandidatePublished({
                    projectRoot: context.projectRoot,
                    worktreeBranch: executionBranch,
                    worktreeBaseBranch,
                    git: gitPort,
                    executionCommit: deliveryEvidence.executionCommit,
                    targetBranch: deliveryEvidence.targetBranch,
                    metadataCommit: mergeResult?.executionMetadataCommit,
                });
                if (!mergeVerification.merged) {
                    throw new Error(
                        `Direct Delivery publication requires reconciliation: ${mergeVerification.message}`,
                    );
                }
                await settlePublishedWorktree(args, context, cleanupMergedWorktrees);
                if (context.worktreeId) {
                    await markEffect("worktree_registry_updated", { worktreeId: context.worktreeId, status: "merged" });
                }
                return { mergeResult };
            },
        });
        if (publication.status !== "committed") {
            // Rethrow the original failure rather than a summary of it: callers
            // classify typed merge failures to pick the right repair worktree, and
            // flattening to `message` silently downgrades that to a generic repair.
            if (publication.cause !== undefined) throw publication.cause;
            throw new Error(publication.message || `Direct Delivery publication did not commit for ${args.planName}.`);
        }
        // `validation_passed` was already recorded — in the execution worktree, by
        // `stageValidationPassedInExecutionWorktree`, before the merge ran. The merge
        // is what delivers it, along with the parent Epic and sibling Plans that the
        // same staging advanced. Recording it a second time here fails its own
        // compare-and-set ("caller saw validated_reviewer, canonical status is
        // verified") and the failure path then reported a merge conflict for a merge
        // that had just succeeded. Confirm the merge landed instead of re-recording.
        await confirmPublishedPlanVerified(args, context, {
            executionMode: "worktree",
            deliveryEvidence,
            worktreeStatus: "merged",
            cleanupMergedWorktrees,
            ...humanReviewMetadata,
        });
        await runPostVerificationHandoffs(args, context.projectRoot);
        return { recorded: true, result: buildVerifiedResult(args, context.projectRoot) };
    }
}

/**
 * Confirm the merge delivered the verified Plan, and finish the job if it did not.
 *
 * Publication stages `validation_passed` in the execution worktree and lets the merge
 * carry it into the primary checkout, so by the time the merge commits the canonical
 * Plan should already read `verified`. If it does not — the Plan file was excluded
 * from the merge, or an older attempt left the checkout behind — record the event
 * here rather than returning a "verified" result over a Plan still sitting in
 * validation. Publication succeeded either way; this only settles the bookkeeping.
 */
export async function confirmPublishedPlanVerified(
    args: ValidationLoopArgs,
    context: PhaseContext,
    details: Partial<RecordPlanEventArgs["details"]>,
): Promise<void> {
    const status = (await loadPlan(context.projectRoot, args.planName))?.attrs.status;
    if (status === "verified" || status === "user_verified") return;
    if (!status || !VALIDATION_PLAN_STATUSES.includes(status as PlanEventStatus)) return;
    await recordLifecycleEvent(
        args,
        context.projectRoot,
        "validation_passed",
        status as PlanEventStatus,
        undefined,
        details,
    );
}

/**
 * True when the Plan is already published, whatever the error says.
 *
 * A merge that moved the target branch cannot be un-moved, so an error raised after
 * that point describes bookkeeping, not lost work. Dispatching a conflict repair for
 * it sends an Agent to fix a conflict that does not exist and leaves the user
 * watching a finished Plan get re-run.
 */
export async function isPlanAlreadyPublished(projectRoot: string, planName: string): Promise<boolean> {
    const status = await loadPlan(projectRoot, planName).then((plan) => plan?.attrs.status).catch(() => undefined);
    return status === "verified" || status === "user_verified";
}

export async function settlePublishedWorktree(
    _args: ValidationLoopArgs,
    context: PhaseContext,
    cleanupMergedWorktrees: boolean,
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
            const branchCleanup = await deleteMergedWorktreeBranch({
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

export function buildVerifiedResult(args: ValidationLoopArgs, projectRoot: string): ValidationPhaseResult {
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
            ? { epicContinuation: { completedPlanName: args.planName, projectRoot } }
            : {}),
    };
}
