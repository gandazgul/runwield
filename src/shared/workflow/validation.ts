/**
 * @module shared/workflow/validation
 * Lifecycle-driven validation entry point.
 */

import { extractYaml } from "@std/front-matter";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AGENTS, isPlannedChangeClassification } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";
import { getAgentDisplayName } from "../session/agents.js";
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { loadDirectDeliveryHierarchySnapshot } from "./validation-delivery-hierarchy.ts";
import { appendUnsettledNote } from "./validation-progress.ts";
import { runIsolatedAgentSession } from "../session/session.js";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "../session/session-runtime-interactions.js";
import { getCodeReviewMode, getGuidedReviewMode, shouldCleanupMergedWorktrees } from "../settings.js";
import { createGitPort } from "../git-port.ts";
import {
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    mergeExecutionWorktree,
    removeWorktreeGitArtifacts,
} from "../worktree.js";
import {
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import {
    autoGenerateWorkRecordForCompletedPlan,
    formatWorkRecordAutoGenerationResult,
} from "../work-records/auto-generation.js";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordWorkflowMetric } from "./metrics.js";
import {
    PLAN_STATUSES,
    recordPlanEvent,
    stageValidationPassedInExecutionWorktree,
    VALIDATION_PLAN_STATUSES,
} from "./plan-lifecycle.js";
import { resolveValidationExecutionContext } from "./execution-context.js";
import { runDirectDeliveryPublicationTransition, runPlanFrontMatterTransition } from "./state-transition.ts";
import { buildDiffInspectionSection, createReviewDiffTool } from "./review-diff-tool.js";
import {
    applyRoundFindings,
    hasOpenItems,
    normalizeLedger,
    openItems,
    renderOpenItems,
    renderResolvedItems,
} from "./review-ledger.ts";
import { readLatestReviewOutcome, readLatestTaskCompletedReport } from "./workflow.js";
import {
    loadReviewerFeedbackEngineerDef,
    loadReviewerPrompt,
    runFeaturePostVerificationHandoffs,
    runLocalCI,
    runManualQaChecklistPrompt,
    runMechanicalValidation as runQuickFixMechanicalValidation,
    shouldContinueParentEpicAfterValidation,
    unaccountedOpenItems,
    usedReviewDiffTool,
    verifyPostMergeCandidatePublished,
} from "./validation-legacy.ts";

export {
    loadManualQaPrompt,
    loadReviewerFeedbackEngineerDef,
    loadReviewerPrompt,
    runLocalCI,
    runManualQaChecklistPrompt,
    shouldContinueParentEpicAfterValidation,
    shouldRunWorkflowValidation,
    unaccountedOpenItems,
    usedReviewDiffTool,
} from "./validation-legacy.ts";

export type WorkflowValidationResult = {
    kind: "verified" | "paused" | "failed";
    planName: string;
    projectRoot: string;
    classification?: string;
    reason?: string;
    epicContinuation?: { completedPlanName: string; projectRoot: string };
};

type PlanStatus = "implemented" | "validated_ci" | "validated_reviewer";
type PlanEvent = Parameters<typeof recordPlanEvent>[0]["event"];
type PlanEventStatus = Parameters<typeof recordPlanEvent>[0]["currentStatus"];
type PlanFrontMatter = import("../../plan-store.js").PlanFrontMatter;
type TriageMeta = import("../../tools/plan-written.js").TriageMeta & Partial<PlanFrontMatter>;
type ActiveExecutionWorkflow = import("../session/hosted-session.js").ActiveExecutionWorkflow;
type HostedSession = import("../session/hosted-session.js").HostedSession;
type AgentMessage = import("@earendil-works/pi-agent-core").AgentMessage;
type AgentDefinition = import("../session/types.js").AgentDefinition;
type GitPort = import("../git-port.ts").GitPort;
type LocalCIResult = Awaited<ReturnType<typeof runLocalCI>>;
type RecordPlanEventArgs = Parameters<typeof recordPlanEvent>[0];
type RecordPlanEventResult = Awaited<ReturnType<typeof recordPlanEvent>>;
type ValidationExecutionResolution = Awaited<ReturnType<typeof resolveValidationExecutionContext>>;
type ResolvedValidationExecution = Exclude<ValidationExecutionResolution, { kind: "blocked" }>;
type ValidationExecutionContext = ResolvedValidationExecution["context"];
type ReviewOutcome = NonNullable<ReturnType<typeof readLatestReviewOutcome>>;
type TaskCompletedReport = ReturnType<typeof readLatestTaskCompletedReport>;
type InteractionRequest = Parameters<typeof requestHostedSessionInteraction>[1];
type InteractionResponse = Awaited<ReturnType<typeof requestHostedSessionInteraction>>;
type WorktreeDeliveryEvidence = import("../../plan-store.js").WorktreeDeliveryEvidence;
type DeliveryEvidence = import("../../plan-store.js").DeliveryEvidence;
type ValidationPhaseResult = WorkflowValidationResult;

type IsolatedAgentSessionOptions = {
    hostedSession: HostedSession;
    agentName: string;
    userRequest: string;
    images?: Array<{ base64: string; mimeType: string }>;
    cwd: string;
    _agentDefOverride?: AgentDefinition;
    customTools?: import("@earendil-works/pi-coding-agent").ToolDefinition[];
    includeEditFallback?: boolean;
    sessionManager?: SessionManager;
};

type ActiveAgentTurnOptions = {
    hostedSession: HostedSession;
    agentName: string;
    userRequest: string;
    sessionManager?: SessionManager;
    cwd: string;
};

type SemanticReviewPort = {
    runIsolatedAgentSession?: (options: IsolatedAgentSessionOptions) => Promise<AgentMessage[]>;
    getDiffText?: (baselineTree: string | undefined, cwd: string) => Promise<string>;
    loadReviewerPrompt?: typeof loadReviewerPrompt;
    loadReviewerFeedbackEngineerDef?: typeof loadReviewerFeedbackEngineerDef;
    requestInteraction?: (hostedSession: HostedSession, request: InteractionRequest) => Promise<InteractionResponse>;
};

type ValidationDeps = {
    /**
     * Local validation commands run a real subprocess, so tests supply their own.
     * A genuine environment boundary.
     */
    runLocalCI?: typeof runLocalCI;
    /**
     * Fail-closed execution-context resolution. Injected only so tests can exercise a
     * phase without standing up a worktree; it decides whether validation may run at
     * all, so faking it skips the fail-closed checks rather than an external boundary.
     * Track it as machinery and remove it with the worktree capability port.
     */
    resolveValidationExecutionContext?: typeof resolveValidationExecutionContext;
};

type MechanicalValidationArgs = {
    sessionManager?: SessionManager;
    hostedSession?: HostedSession;
    cwd?: string;
    manualQaName?: string;
    manualQaContext?: string;
    __deps?: ValidationDeps;
};

type ValidationLoopArgs = {
    planName: string;
    planContent: string;
    triageMeta: TriageMeta;
    sessionManager?: SessionManager;
    hostedSession: HostedSession;
    finalAgentName?: string;
    executionContext?: ActiveExecutionWorkflow;
    git?: GitPort;
    semanticReviewPort?: SemanticReviewPort;
    __deps?: ValidationDeps;
};

type PhaseContext = {
    args: ValidationLoopArgs;
    projectRoot: string;
    executionContext: ValidationExecutionContext;
    baselineTree?: string;
    executionCwd: string;
    executionAgent: "engineer" | "frontend-engineer";
    worktreeId?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    nonGitInPlace: boolean;
    workflowBase: ActiveExecutionWorkflow;
};

type SemanticRoundState = {
    semanticRound: number;
    reviewLedger: ReturnType<typeof normalizeLedger>;
    repairBaselineTree: string;
    lastRepairReport: string;
};

type HumanReviewMetadata = {
    humanReviewMode: PlanFrontMatter["humanReviewMode"];
    humanReviewDecision: PlanFrontMatter["humanReviewDecision"];
    humanReviewedAt: string | null;
};

type PublicationOutcome = {
    result: ValidationPhaseResult;
    recorded: boolean;
};

type ReviewFeedbackImage = { base64: string; mimeType: string };

type ReviewFeedbackRepairPacket = {
    diffText: string;
    findingsSection: string;
    repairKind: "semantic" | "human_feedback";
    reason: string;
    images?: ReviewFeedbackImage[];
    activeWorkflow?: Partial<ActiveExecutionWorkflow>;
};

const DISCOVERY_ROUNDS = 2;
const AUTOMATIC_ROUNDS = 3;
const REVIEWER_TOOL_NAMES = ["read", "grep", "find", "ls", "review_diff", "review_complete"];

export const runMechanicalValidation = runQuickFixMechanicalValidation as (
    args: MechanicalValidationArgs,
) => Promise<{ passed: boolean; attempts: number; reason?: string }>;

export async function runValidationLoop(args: ValidationLoopArgs): Promise<WorkflowValidationResult> {
    const canonicalPlan = await loadCanonicalValidationPlan(args);
    if (canonicalPlan.kind === "blocked") return canonicalPlan.result;
    const canonicalArgs: ValidationLoopArgs = {
        ...args,
        triageMeta: { ...args.triageMeta, ...canonicalPlan.attrs },
        planContent: canonicalPlan.markdown,
    };
    switch (canonicalPlan.status) {
        case "implemented":
            return await runMechanicalValidationPhase(canonicalArgs);
        case "validated_ci":
            return await runSemanticReviewPhase(canonicalArgs);
        case "validated_reviewer":
            return await runValidatedReviewerPhase(canonicalArgs);
    }
}

async function loadCanonicalValidationPlan(
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

function getPlanContentStatus(planContent: string): string | undefined {
    if (!planContent.startsWith("---")) return undefined;
    const parsed = extractYaml(planContent) as { attrs?: { status?: string } };
    return typeof parsed.attrs?.status === "string" ? parsed.attrs.status : undefined;
}

async function runMechanicalValidationPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const phase = await resolvePhaseContext(args);
    if (phase.kind === "blocked") return phase.result;

    const runLocalCIImpl = args.__deps?.runLocalCI || runLocalCI;
    const ciResult = await runLocalCIImpl({ hostedSession: args.hostedSession, cwd: phase.context.executionCwd });
    await recordMetric(args, phase.context.projectRoot, {
        category: "validation",
        event: "ci_attempt",
        planName: args.planName,
        details: {
            semanticRound: readSemanticRound(args.triageMeta) + 1,
            mechanicalAttempt: readCiAttempts(args.triageMeta) + 1,
            exitCode: ciResult.exitCode,
            passed: ciResult.exitCode === 0,
            canceled: ciResult.canceled === true,
        },
    });
    if (ciResult.canceled) {
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: phase.context.projectRoot,
            reason: "CI validation canceled.",
        };
    }
    if (ciResult.exitCode === 0) {
        await recordLifecycleEvent(args, phase.context.projectRoot, "mechanical_validation_passed", "implemented");
        preserveValidationContinuationState(args, phase.context);
        emitStatus(args.hostedSession, "Build and tests passed.", "success");
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: phase.context.projectRoot,
            reason: "Mechanical Validation passed.",
        };
    }

    const failureReason = getCiFailureReason(ciResult);
    const currentAttempts = readCiAttempts(args.triageMeta);
    if (currentAttempts + 1 >= AUTOMATIC_ROUNDS) {
        await recordLifecycleEvent(args, phase.context.projectRoot, "validation_failed", "implemented", failureReason);
        return {
            kind: "failed",
            planName: args.planName,
            projectRoot: phase.context.projectRoot,
            reason: "CI validation failed after 3 repair attempts.",
        };
    }

    await dispatchCiRepair(args, phase.context, ciResult);
    await recordLifecycleEvent(
        args,
        phase.context.projectRoot,
        "mechanical_validation_failed",
        "implemented",
        failureReason,
    );
    return {
        kind: "paused",
        planName: args.planName,
        projectRoot: phase.context.projectRoot,
        reason: "Mechanical Validation failed; repair required.",
    };
}

async function runSemanticReviewPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const phase = await resolvePhaseContext(args);
    if (phase.kind === "blocked") return phase.result;
    const context = phase.context;
    if (context.nonGitInPlace) {
        await recordLifecycleEvent(args, context.projectRoot, "semantic_review_passed", "validated_ci");
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: "Semantic Code Review skipped for non-Git execution.",
        };
    }

    const state = readSemanticRoundState(args, context);
    const nextRound = state.semanticRound + 1;
    const diffText = await getDiffText(args, context.baselineTree, context.executionCwd);
    if (requiresImplementationDiff(args.triageMeta) && !hasImplementationDiff(diffText, args.planName)) {
        const reason = diffText.trim()
            ? "No implementation changes detected in workflow diff; only plan document changes were found."
            : "No implementation changes detected in workflow diff.";
        await recordLifecycleEvent(args, context.projectRoot, "validation_failed", "validated_ci", reason);
        return { kind: "failed", planName: args.planName, projectRoot: context.projectRoot, reason };
    }
    if (!diffText.trim()) {
        await recordLifecycleEvent(args, context.projectRoot, "semantic_review_passed", "validated_ci");
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: "Semantic Code Review skipped because the diff is empty.",
        };
    }

    const reviewMode = nextRound <= DISCOVERY_ROUNDS ? "discovery" : "verify";
    const review = await runReviewerRound(
        args,
        context,
        {
            ...state,
            semanticRound: nextRound,
        },
        reviewMode,
        diffText,
    );
    if (review.kind === "paused") return review.result;
    if (review.kind === "failed") {
        await recordLifecycleEvent(args, context.projectRoot, "validation_failed", "validated_ci", review.reason);
        return { kind: "failed", planName: args.planName, projectRoot: context.projectRoot, reason: review.reason };
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
        emitStatus(args.hostedSession, `Semantic Code Review Approved (round ${nextRound}).`, "success");
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

    if (nextRound >= AUTOMATIC_ROUNDS) {
        const action = await promptForSemanticRoundLimit(args, nextRound, openCount);
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
    }

    const repair = await dispatchReviewFeedbackRepair(args, context, {
        diffText,
        findingsSection: openCount > 0 ? renderOpenItems(review.ledger) : review.outcome.feedback,
        repairKind: "semantic",
        reason: `Review round ${nextRound} found ${openCount || "open"} issue(s). Dispatching repair...`,
        activeWorkflow: {
            semanticRound: nextRound,
            reviewLedger: review.ledger,
            repairBaselineTree: state.repairBaselineTree || context.baselineTree || "",
        },
    });
    if (!repair.completed) {
        const reason = repair.reason ||
            "Reviewer-Feedback Engineer stopped without task_completed during semantic repair.";
        await recordLifecycleEvent(args, context.projectRoot, "validation_failed", "validated_ci", reason);
        return { kind: "failed", planName: args.planName, projectRoot: context.projectRoot, reason };
    }

    await recordLifecycleEvent(
        args,
        context.projectRoot,
        "semantic_review_feedback",
        "validated_ci",
        review.outcome.feedback || "Semantic Code Review requested changes.",
    );
    return {
        kind: "paused",
        planName: args.planName,
        projectRoot: context.projectRoot,
        reason: "Semantic Code Review requested changes; repair dispatched.",
    };
}

async function runValidatedReviewerPhase(args: ValidationLoopArgs): Promise<ValidationPhaseResult> {
    const phase = await resolvePhaseContext(args);
    if (phase.kind === "blocked") return phase.result;
    if (!hasFinalHumanReviewDecision(args.triageMeta)) {
        return await runHumanReviewPhase(args, phase.context);
    }
    const publication = await runPublicationPhase(args, phase.context, readHumanReviewMetadata(args.triageMeta));
    return publication.result;
}

async function runHumanReviewPhase(args: ValidationLoopArgs, context: PhaseContext): Promise<ValidationPhaseResult> {
    const persistedMode = args.triageMeta.humanReviewMode;
    const mode = persistedMode === "always" || persistedMode === "ask" || persistedMode === "none"
        ? persistedMode
        : getCodeReviewMode(context.projectRoot);
    if (mode === "none") {
        await persistHumanReviewMetadata(args, context.projectRoot, {
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
            humanReviewedAt: null,
        });
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: "Local Human Code Review is not required.",
        };
    }

    if (mode === "ask") {
        const response = await requestInteraction(args, {
            type: RuntimeInteractionTypes.SELECT,
            prompt: "Semantic review passed. Open code review before merge-back?",
            options: [
                { value: "open", label: "Open code review" },
                { value: "skip", label: "Skip code review" },
            ],
        });
        if (response.outcome !== "selected" || response.value !== "open") {
            await persistHumanReviewMetadata(args, context.projectRoot, {
                humanReviewMode: "ask",
                humanReviewDecision: "skipped",
                humanReviewedAt: null,
            });
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: "Local Human Code Review skipped by user.",
            };
        }
    }

    const diffText = context.nonGitInPlace ? "" : await getDiffText(args, context.baselineTree, context.executionCwd);
    const planAttrs = getPlanAttrs(args.planContent);
    const guidedReview = {
        mode: getGuidedReviewMode(context.projectRoot),
        autoStart: false,
        reasons: [],
        score: 0,
        stats: {},
    };
    emitStatus(args.hostedSession, "Waiting for User Code Review...", "info");
    const humanReviewResponse = await requestInteraction(args, {
        type: RuntimeInteractionTypes.CODE_REVIEW,
        prompt: `Review implementation diff for "${args.planName}"`,
        _meta: {
            planName: args.planName,
            planContent: args.planContent,
            planAttrs,
            diffText,
            executionCwd: context.executionCwd,
            guidedReview,
        },
    });
    const humanReview = normalizeHumanReview(humanReviewResponse);
    if (humanReview.approved) {
        await persistHumanReviewMetadata(args, context.projectRoot, {
            humanReviewMode: mode,
            humanReviewDecision: "approved",
            humanReviewedAt: new Date().toISOString(),
        });
        emitStatus(args.hostedSession, "User Code Review Approved.", "success");
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason: "Local Human Code Review approved.",
        };
    }
    if (humanReview.feedback || humanReview.annotations.length || humanReview.images.length) {
        const annotationText = formatCodeReviewAnnotations(humanReview.annotations);
        const feedbackText = [
            humanReview.feedback || "(no free-text feedback provided)",
            annotationText ? `Annotations:\n${annotationText}` : "",
        ].filter(Boolean).join("\n\n");
        const repair = await dispatchReviewFeedbackRepair(args, context, {
            diffText,
            findingsSection: feedbackText,
            repairKind: "human_feedback",
            images: humanReview.images,
            reason:
                `User code review returned feedback. Dispatching repair...\nUser Code Review Feedback:\n${feedbackText}`,
        });
        if (repair.completed) {
            await recordLifecycleEvent(
                args,
                context.projectRoot,
                "validation_failed",
                "validated_reviewer",
                feedbackText,
            );
            return {
                kind: "paused",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: "Human review feedback repair dispatched.",
            };
        }
    }

    const reason = humanReview.canceled
        ? "User code review canceled."
        : "User code review exited without approval or feedback.";
    await recordLifecycleEvent(args, context.projectRoot, "validation_failed", "validated_reviewer", reason);
    return { kind: "failed", planName: args.planName, projectRoot: context.projectRoot, reason };
}

async function runPublicationPhase(
    args: ValidationLoopArgs,
    context: PhaseContext,
    humanReviewMetadata: HumanReviewMetadata,
): Promise<PublicationOutcome> {
    if (context.nonGitInPlace || !context.worktreeBranch) {
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
    const gitPort = args.git || createGitPort();
    const planPath = `plans/${args.planName}.md`;

    try {
        const checkpoint = await checkpointExecutionWorktree({
            worktreePath: context.executionCwd,
            branch: context.worktreeBranch,
            planName: args.planName,
            planDescription: args.triageMeta?.summary,
        });
        const targetHeadBeforeMerge = await gitPort.branchHead(context.projectRoot, worktreeBaseBranch);
        const deliveryEvidence: WorktreeDeliveryEvidence = {
            version: 1,
            mode: "worktree_merge",
            executionCommit: checkpoint.executionCommit,
            targetBranch: worktreeBaseBranch,
            targetHeadBeforeMerge,
        };
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
        // The merge is the only irreversible act in the system: a commit that reaches
        // the target branch cannot be taken back. It therefore runs inside the
        // publication transaction, which locks the attempt and the target ref, holds
        // the Plan revision it decided on, and — the part that matters most — journals
        // `direct_delivery_target_ref_moved` the moment the branch moves. Without that
        // journal an interrupted publication leaves no evidence the merge happened, so
        // recovery cannot tell "never merged" from "merged, bookkeeping behind", and
        // the failure path below would report a merge failure for work already on the
        // target branch.
        // Captured before the closure: the guard above narrowed this, but TypeScript
        // cannot carry that narrowing into a callback that may run later.
        const worktreeBranch = context.worktreeBranch;
        const hierarchy = await loadDirectDeliveryHierarchySnapshot(context.projectRoot, args.planName)
            .catch(() => ({ revision: undefined, parentPlan: undefined, siblingPlans: [] }));
        const publication = await runDirectDeliveryPublicationTransition({
            projectRoot: context.projectRoot,
            planName: args.planName,
            expectedRevision: hierarchy.revision,
            worktreeId: context.worktreeId,
            targetRef: worktreeBaseBranch,
            parentPlan: hierarchy.parentPlan,
            siblingPlanNames: hierarchy.siblingPlans.map((sibling) => sibling.name),
            publicationProof: { deliveryEvidence, cleanupMergedWorktrees, phase: "stage_merge_settle" },
            publish: async ({ markEffect }) => {
                await markEffect("direct_delivery_publication_started", {
                    planName: args.planName,
                    worktreeId: context.worktreeId,
                    worktreeBranch: worktreeBranch,
                    targetBranch: worktreeBaseBranch,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    preservedPlanPaths: staging.planPaths,
                });
                const mergeResult = await mergeExecutionWorktree({
                    projectRoot: context.projectRoot,
                    branch: worktreeBranch,
                    targetBranch: worktreeBaseBranch,
                    worktreePath: context.executionCwd,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                    planName: args.planName,
                    planDescription: args.triageMeta?.summary,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    allowedDirtyPaths: staging.planPaths.length > 0 ? staging.planPaths : [planPath],
                    preservePlanPaths: staging.planPaths,
                });
                await markEffect("direct_delivery_target_ref_moved", {
                    planName: args.planName,
                    worktreeId: context.worktreeId,
                    worktreeBranch: worktreeBranch,
                    targetBranch: worktreeBaseBranch,
                    updatedPrimaryCheckout: mergeResult?.updatedPrimaryCheckout,
                    executionMetadataCommit: mergeResult?.executionMetadataCommit,
                    sealedExecutionCommit: deliveryEvidence.executionCommit,
                    expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                });
                const mergeVerification = await verifyPostMergeCandidatePublished({
                    projectRoot: context.projectRoot,
                    worktreeBranch: worktreeBranch,
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
        await recordLifecycleEvent(args, context.projectRoot, "validation_passed", "validated_reviewer", undefined, {
            executionMode: "worktree",
            deliveryEvidence,
            worktreeStatus: "merged",
            cleanupMergedWorktrees,
            ...humanReviewMetadata,
        });
        await runPostVerificationHandoffs(args, context.projectRoot);
        return { recorded: true, result: buildVerifiedResult(args, context.projectRoot) };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // Bookkeeping must never cancel the recovery. The most common merge failure
        // leaves conflict markers in the Plan file, which makes this record impossible
        // — the Plan can no longer be parsed — and that is exactly the moment the
        // repair is most needed. Recording used to run first and throw, so the repair
        // dispatch below was unreachable in its main case: RunWield would attempt the
        // merge, fail, and go quiet.
        // Repair first, and only record a failure if the repair did not land. A merge
        // conflict is a normal, fixable event: the Engineer resolves it and publication
        // retries. Recording `worktree_merge_failed` sends the Plan back to
        // `implemented`, which throws away the passed CI and approved review and makes
        // the user sit through the whole pipeline again for a conflict that was already
        // fixed. Leaving the Plan at `validated_reviewer` lets the next call retry
        // publication directly — the behavior before validation became phase-driven.
        const repaired = await dispatchMergeRepair(args, context, reason, error);
        if (repaired) {
            return {
                recorded: false,
                result: {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: `Merge conflict repaired for ${args.planName}. Publication will retry.`,
                },
            };
        }
        // The repair did not finish, so the Plan must not be left mid-publication.
        let unsettledNote = "";
        try {
            await recordLifecycleEvent(
                args,
                context.projectRoot,
                "worktree_merge_failed",
                "validated_reviewer",
                reason,
                {
                    worktreeId: context.worktreeId,
                    worktreePath: context.executionCwd,
                    worktreeBranch: context.worktreeBranch,
                    worktreeBaseBranch,
                },
            );
        } catch (recordError) {
            unsettledNote = `RunWield could not record the merge failure: ${
                recordError instanceof Error ? recordError.message : String(recordError)
            } The Plan's own status may be behind until that is resolved.`;
        }
        return {
            recorded: true,
            result: {
                kind: "failed",
                planName: args.planName,
                projectRoot: context.projectRoot,
                reason: appendUnsettledNote(`Worktree merge failed: ${reason}`, unsettledNote),
            },
        };
    }
}

async function resolvePhaseContext(
    args: ValidationLoopArgs,
): Promise<{ kind: "ok"; context: PhaseContext } | { kind: "blocked"; result: ValidationPhaseResult }> {
    const projectRoot = getProjectRoot(args);
    const activeWorkflow = args.hostedSession.getActiveExecutionWorkflow?.() || null;
    const resolveValidationExecutionContextImpl = args.__deps?.resolveValidationExecutionContext ||
        resolveValidationExecutionContext;
    const resolution = await resolveValidationExecutionContextImpl({
        projectRoot,
        planName: args.planName,
        triageMeta: args.triageMeta,
        explicitContext: args.executionContext,
        activeWorkflow,
    });
    if (resolution.kind === "blocked") {
        await recordLifecycleEvent(
            args,
            projectRoot,
            "validation_failed",
            args.triageMeta.status as PlanEventStatus,
            resolution.message,
        );
        return {
            kind: "blocked",
            result: { kind: "failed", planName: args.planName, projectRoot, reason: resolution.message },
        };
    }
    if (activeWorkflow) args.hostedSession.clearActiveExecutionWorkflow?.();
    const context = resolution.context;
    const policyAgent = activeWorkflow?.executionAgent || args.executionContext?.executionAgent || AGENTS.ENGINEER;
    const executionAgent = policyAgent === AGENTS.FRONTEND_ENGINEER ? "frontend-engineer" : "engineer";
    const workflowBase: ActiveExecutionWorkflow = {
        ...(activeWorkflow || {}),
        planName: args.planName,
        triageMeta: args.triageMeta,
        executionAgent,
        ...(activeWorkflow?.projectRoot || context.projectRoot !== args.hostedSession.cwd
            ? { projectRoot: context.projectRoot }
            : {}),
        executionCwd: context.executionCwd,
        validationContinuation: true,
        ...(context.executionMode === "worktree"
            ? {
                executionMode: "worktree",
                baselineTree: context.baselineTree,
                worktreeId: context.worktreeId,
                worktreeBranch: context.worktreeBranch,
                ...(context.worktreeBaseBranch ? { worktreeBaseBranch: context.worktreeBaseBranch } : {}),
            }
            : { executionMode: "non_git_in_place", nonGitInPlace: true }),
    };
    return {
        kind: "ok",
        context: {
            args,
            projectRoot: context.projectRoot,
            executionContext: context,
            baselineTree: context.executionMode === "worktree" ? context.baselineTree : undefined,
            executionCwd: context.executionCwd,
            executionAgent,
            worktreeId: context.executionMode === "worktree" ? context.worktreeId : undefined,
            worktreeBranch: context.executionMode === "worktree" ? context.worktreeBranch : undefined,
            worktreeBaseBranch: context.executionMode === "worktree" ? context.worktreeBaseBranch : undefined,
            nonGitInPlace: context.executionMode === "non_git_in_place",
            workflowBase,
        },
    };
}

async function runReviewerRound(
    args: ValidationLoopArgs,
    context: PhaseContext,
    state: SemanticRoundState,
    reviewMode: "discovery" | "verify",
    diffText: string,
): Promise<
    | {
        kind: "complete";
        outcome: ReviewOutcome;
        ledger: SemanticRoundState["reviewLedger"];
        resolvedCount: number;
        appendedCount: number;
    }
    | { kind: "paused"; result: ValidationPhaseResult }
    | { kind: "failed"; reason: string }
> {
    const runIsolatedAgentSessionImpl = args.semanticReviewPort?.runIsolatedAgentSession || runIsolatedAgentSession;
    const loadReviewerPromptImpl = args.semanticReviewPort?.loadReviewerPrompt || loadReviewerPrompt;
    const reviewerSessionManager = SessionManager.inMemory(context.executionCwd);
    let lastReviewerFailure = "Semantic Reviewer did not complete.";
    let nudgeReason: string | undefined;
    let inspectedDiff = false;
    let latestOutcome: ReviewOutcome | null = null;

    for (let attempt = 1; attempt <= 3 && !latestOutcome; attempt++) {
        if (attempt > 1) {
            emitStatus(
                args.hostedSession,
                `Nudging Semantic Reviewer to finish round ${state.semanticRound} (${attempt}/3)...`,
                "info",
            );
        }
        const reviewerAgentDef = await loadReviewerPromptImpl(reviewMode);
        const config = buildSemanticReviewAttempt(reviewerAgentDef, attempt, nudgeReason, state, reviewMode, diffText);
        nudgeReason = undefined;
        try {
            const sessionMessages = await runIsolatedAgentSessionImpl({
                hostedSession: args.hostedSession,
                agentName: AGENTS.REVIEWER,
                userRequest: config.prompt,
                cwd: context.executionCwd,
                _agentDefOverride: config.agentDef,
                customTools: config.customTools,
                includeEditFallback: false,
                sessionManager: reviewerSessionManager,
            });
            if (usedReviewDiffTool(sessionMessages)) inspectedDiff = true;
            const outcome = readLatestReviewOutcome(sessionMessages);
            const unaccounted = unaccountedOpenItems(state.reviewLedger, outcome?.findings);
            if (!outcome) {
                lastReviewerFailure = "Semantic Reviewer finished without calling review_complete.";
            } else if (!inspectedDiff) {
                lastReviewerFailure = "Semantic Reviewer decided without inspecting the diff.";
                nudgeReason =
                    'You called review_complete without inspecting the diff. Read the changes with review_diff(command: "list") and then review_diff(command: "show", ...) before deciding, then call review_complete again with your decision.';
            } else if (unaccounted.length > 0) {
                lastReviewerFailure = `Semantic Reviewer did not account for open finding(s): ${
                    unaccounted.join(", ")
                }.`;
                nudgeReason = `Your result does not mention ${
                    unaccounted.length === 1 ? "this open finding" : "these open findings"
                }: ${
                    unaccounted.join(", ")
                }. Every open finding must appear in your \`findings\` array — with \`resolved: true\` if you have verified the fix in the code, or with \`resolved: false\` and what is still missing. Reuse the existing identities exactly; do not renumber them or report the same issue as a new finding. Call review_complete again with the complete set.`;
            } else {
                latestOutcome = outcome;
            }
        } catch (error) {
            lastReviewerFailure = `Semantic Reviewer execution failed: ${
                error instanceof Error ? error.message : String(error)
            }`;
        }
    }

    if (!latestOutcome) {
        const reason =
            `${lastReviewerFailure} Review round ${state.semanticRound} did not finish after 3 attempts. Nudge the Reviewer to finish, or run /compact first if its context is full. Validation resumes this round from the preserved findings.`;
        args.hostedSession.setActiveExecutionWorkflow?.({
            ...context.workflowBase,
            ...(args.hostedSession.getActiveExecutionWorkflow?.() || {}),
            semanticRound: state.semanticRound - 1,
            reviewLedger: state.reviewLedger,
            repairBaselineTree: state.repairBaselineTree,
            lastRepairReport: state.lastRepairReport,
        });
        emitStatus(args.hostedSession, reason, "warning");
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

function buildSemanticReviewAttempt(
    reviewerAgentDef: AgentDefinition,
    attempt: number,
    nudgeReason: string | undefined,
    state: SemanticRoundState,
    reviewMode: "discovery" | "verify",
    diffText: string,
): {
    prompt: string;
    agentDef: AgentDefinition;
    customTools: import("@earendil-works/pi-coding-agent").ToolDefinition[];
} {
    const customTools = [createReviewDiffTool({ full: diffText })];
    if (attempt > 1) {
        return {
            prompt: nudgeReason ||
                "You have not called review_complete yet. Finish this review now by calling review_complete with your decision. Do not restart the review — use what you have already inspected.",
            agentDef: { ...reviewerAgentDef, tools: REVIEWER_TOOL_NAMES },
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
            `Rounds 1-${DISCOVERY_ROUNDS} already reviewed this implementation against the whole Plan. Verify the open findings below and check the repair for regressions. Do not sweep the Plan again.`,
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
        buildDiffInspectionSection(diffText),
        "",
        "### Approved Plan",
        "",
        "Plan content is supplied by the validation request.",
    );
    return {
        prompt: sections.join("\n"),
        agentDef: { ...reviewerAgentDef, tools: REVIEWER_TOOL_NAMES },
        customTools,
    };
}

async function dispatchReviewFeedbackRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    packet: ReviewFeedbackRepairPacket,
): Promise<{ completed: boolean; report: string; reason?: string }> {
    emitStatus(args.hostedSession, packet.reason, "warning");
    const runIsolatedAgentSessionImpl = args.semanticReviewPort?.runIsolatedAgentSession || runIsolatedAgentSession;
    const loadReviewerFeedbackEngineerDefImpl = args.semanticReviewPort?.loadReviewerFeedbackEngineerDef ||
        loadReviewerFeedbackEngineerDef;
    try {
        const workflowState = { ...context.workflowBase, ...packet.activeWorkflow };
        args.hostedSession.setActiveExecutionWorkflow?.(workflowState);
        const agentDef = await loadReviewerFeedbackEngineerDefImpl();
        const sessionMessages = await runIsolatedAgentSessionImpl({
            hostedSession: args.hostedSession,
            agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
            userRequest: [
                packet.repairKind === "human_feedback"
                    ? "A human reviewed this change and asked for the following. Their feedback is authoritative."
                    : "A code reviewer found the following issues with this implementation. Fix every one of them.",
                "",
                "### Findings",
                "",
                packet.findingsSection || "(no findings text supplied)",
                "",
                buildDiffInspectionSection(packet.diffText),
                "",
                "### Approved Plan",
                "",
                args.planContent,
                "",
                "Report a disposition for every finding in your task_completed message.",
            ].join("\n"),
            images: packet.images,
            cwd: context.executionCwd,
            _agentDefOverride: agentDef,
            customTools: [createReviewDiffTool({ full: packet.diffText })],
        });
        const report: TaskCompletedReport = readLatestTaskCompletedReport(sessionMessages);
        args.hostedSession.setActiveExecutionWorkflow?.({
            ...workflowState,
            lastRepairReport: report.message,
        });
        return { completed: report.completed, report: report.message };
    } catch (error) {
        return { completed: false, report: "", reason: error instanceof Error ? error.message : String(error) };
    }
}

async function dispatchCiRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    ciResult: LocalCIResult,
): Promise<void> {
    const runActiveAgentTurnImpl = runActiveAgentTurn;
    args.hostedSession.setActiveExecutionWorkflow?.({ ...context.workflowBase });
    emitStatus(
        args.hostedSession,
        `Build failed. Dispatching ${
            getAgentDisplayName(context.executionAgent, context.projectRoot)
        } to fix syntax/types...`,
        "warning",
    );
    await runActiveAgentTurnImpl({
        hostedSession: args.hostedSession,
        agentName: context.executionAgent,
        userRequest:
            "The project failed CI validation. Fix the following build errors, then call task_completed when the repair is complete. If the repair involves tests, follow the write-tests skill for sound testing behavior:\n\n" +
            getCiFailureReason(ciResult),
        sessionManager: args.sessionManager,
        cwd: context.executionCwd,
    });
}

/**
 * Where a merge failure has to be repaired.
 *
 * A merge conflict lands in whichever checkout git was merging into — usually the
 * primary one, not the execution worktree. The typed merge error carries that path,
 * so dispatching the repair agent into `executionCwd` unconditionally sends it to a
 * directory with no conflict in it, where it finds nothing to fix.
 */
function getMergeRepairCwd(error: unknown): string | undefined {
    if (error && typeof error === "object" && "repairCwd" in error) {
        const repairCwd = (error as { repairCwd?: unknown }).repairCwd;
        return typeof repairCwd === "string" ? repairCwd : undefined;
    }
    return undefined;
}

/** @returns whether the repair agent reported completion. */
async function dispatchMergeRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    reason: string,
    error?: unknown,
): Promise<boolean> {
    const runActiveAgentTurnImpl = runActiveAgentTurn;
    const repairCwd = getMergeRepairCwd(error) || context.executionCwd;
    // Say what happened before the agent starts. An Engineer turn appearing with no
    // explanation reads as RunWield doing something unprompted: the user sees tool
    // calls about merge conflicts they were never told about, in a directory they did
    // not choose.
    emitStatus(args.hostedSession, `Merge failed while publishing ${args.planName}: ${reason}`, "warning");
    emitStatus(args.hostedSession, `Dispatching ${context.executionAgent} to resolve the conflict in ${repairCwd}.`);
    args.hostedSession.setActiveExecutionWorkflow?.({ ...context.workflowBase });
    const messages = await runActiveAgentTurnImpl({
        hostedSession: args.hostedSession,
        agentName: context.executionAgent,
        userRequest:
            `Worktree merge failed while publishing ${args.planName}. Repair the merge/integration failure, then call task_completed. Reason:\n\n${reason}`,
        sessionManager: args.sessionManager,
        cwd: repairCwd,
    });
    return readLatestTaskCompletedReport(messages).completed;
}

async function promptForSemanticRoundLimit(
    args: ValidationLoopArgs,
    semanticRound: number,
    openFindingCount: number,
): Promise<"continue" | "code_review"> {
    const response = await requestInteraction(args, {
        type: RuntimeInteractionTypes.SELECT,
        prompt:
            `Semantic Code Review has not approved after ${semanticRound} rounds. ${openFindingCount} finding(s) have not been verified. Continue another semantic round or open Local Human Code Review?`,
        options: [
            { value: "continue", label: "Continue Semantic Code Review" },
            { value: "code_review", label: "Open Local Human Code Review" },
        ],
    });
    return response.outcome === "selected" && response.value === "code_review" ? "code_review" : "continue";
}

async function recordLifecycleEvent(
    args: ValidationLoopArgs,
    projectRoot: string,
    event: PlanEvent,
    currentStatus: PlanEventStatus,
    failureReason?: string,
    extraDetails: Partial<RecordPlanEventArgs["details"]> = {},
): Promise<RecordPlanEventResult> {
    return await recordPlanEvent({
        cwd: projectRoot,
        planName: args.planName,
        event,
        currentStatus,
        details: { triageMeta: args.triageMeta, failureReason, ...extraDetails },
    });
}

async function persistHumanReviewMetadata(
    args: ValidationLoopArgs,
    projectRoot: string,
    metadata: HumanReviewMetadata,
): Promise<void> {
    await runPlanFrontMatterTransition({
        projectRoot,
        planName: args.planName,
        operation: "validation_human_review_metadata",
        updates: metadata,
        recoveryAttrs: args.triageMeta,
    });
}

async function settlePublishedWorktree(
    _args: ValidationLoopArgs,
    context: PhaseContext,
    cleanupMergedWorktrees: boolean,
): Promise<void> {
    if (context.worktreeId) {
        await updateWorktreeRegistryEntry(context.projectRoot, context.worktreeId, { status: "merged" });
    }
    if (cleanupMergedWorktrees && context.executionCwd) {
        await removeWorktreeGitArtifacts({ projectRoot: context.projectRoot, path: context.executionCwd, force: false })
            .catch(() => {});
        if (context.worktreeBranch) {
            await deleteMergedWorktreeBranch({ projectRoot: context.projectRoot, branch: context.worktreeBranch })
                .catch(() => {});
        }
        if (context.worktreeId) {
            await removeWorktreeRegistryEntry(context.projectRoot, context.worktreeId).catch(() => {});
        }
    }
}

async function runPostVerificationHandoffs(args: ValidationLoopArgs, projectRoot: string): Promise<void> {
    if (!isPlannedChangeClassification(args.triageMeta?.classification)) return;
    await runFeaturePostVerificationHandoffs({
        hostedSession: args.hostedSession,
        planName: args.planName,
        planContent: args.planContent,
        projectRoot,
        runManualQaChecklistPrompt,
        autoGenerateWorkRecordForCompletedPlan,
        formatWorkRecordAutoGenerationResult,
    });
}

function buildVerifiedResult(args: ValidationLoopArgs, projectRoot: string): WorkflowValidationResult {
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

function emitStatus(
    hostedSession: HostedSession,
    message: string,
    level: "info" | "success" | "warning" | "error" = "info",
): void {
    emitSystemStatus(hostedSession, message, { level });
}

function getProjectRoot(args: ValidationLoopArgs): string {
    const activeWorkflow = args.hostedSession.getActiveExecutionWorkflow?.() || null;
    const projectRoot = activeWorkflow?.projectRoot || args.executionContext?.projectRoot || args.hostedSession.cwd;
    if (!projectRoot) throw new Error("runValidationLoop: hostedSession or active workflow projectRoot is required");
    return projectRoot;
}

async function getDiffText(args: ValidationLoopArgs, baselineTree: string | undefined, cwd: string): Promise<string> {
    const getDiffTextImpl = args.semanticReviewPort?.getDiffText;
    if (getDiffTextImpl) return await getDiffTextImpl(baselineTree, cwd);
    return await getWorkflowDiff(cwd, baselineTree);
}

async function requestInteraction(args: ValidationLoopArgs, request: InteractionRequest): Promise<InteractionResponse> {
    const requestInteractionImpl = args.semanticReviewPort?.requestInteraction;
    if (requestInteractionImpl) return await requestInteractionImpl(args.hostedSession, request);
    return await requestHostedSessionInteraction(args.hostedSession, request);
}

async function recordMetric(
    _args: ValidationLoopArgs,
    cwd: string,
    metric: Parameters<typeof recordWorkflowMetric>[0],
): Promise<void> {
    await recordWorkflowMetric(metric, { cwd });
}

function readCiAttempts(meta: Partial<PlanFrontMatter>): number {
    return typeof meta.validationCiAttempts === "number" && meta.validationCiAttempts > 0
        ? meta.validationCiAttempts
        : 0;
}

function readSemanticRound(meta: Partial<PlanFrontMatter>): number {
    return typeof meta.validationSemanticRounds === "number" && meta.validationSemanticRounds > 0
        ? meta.validationSemanticRounds
        : 0;
}

function readSemanticRoundState(args: ValidationLoopArgs, context: PhaseContext): SemanticRoundState {
    const activeWorkflow = context.workflowBase;
    return {
        semanticRound: readSemanticRound(args.triageMeta),
        reviewLedger: normalizeLedger(activeWorkflow.reviewLedger),
        repairBaselineTree: typeof activeWorkflow.repairBaselineTree === "string"
            ? activeWorkflow.repairBaselineTree
            : "",
        lastRepairReport: typeof activeWorkflow.lastRepairReport === "string" ? activeWorkflow.lastRepairReport : "",
    };
}

function hasFinalHumanReviewDecision(meta: Partial<PlanFrontMatter>): boolean {
    return meta.humanReviewDecision === "approved" || meta.humanReviewDecision === "skipped" ||
        meta.humanReviewDecision === "not_required";
}

function preserveValidationContinuationState(args: ValidationLoopArgs, context: PhaseContext): void {
    if (
        context.workflowBase.semanticRound === undefined && !context.workflowBase.reviewLedger &&
        !context.workflowBase.repairBaselineTree && !context.workflowBase.lastRepairReport
    ) {
        return;
    }
    args.hostedSession.setActiveExecutionWorkflow?.({ ...context.workflowBase });
}

function readHumanReviewMetadata(meta: Partial<PlanFrontMatter>): HumanReviewMetadata {
    return {
        humanReviewMode: meta.humanReviewMode || "none",
        humanReviewDecision: meta.humanReviewDecision || "not_required",
        humanReviewedAt: typeof meta.humanReviewedAt === "string" ? meta.humanReviewedAt : null,
    };
}

function normalizeHumanReview(response: InteractionResponse): {
    approved: boolean;
    feedback: string;
    annotations: Array<{ file?: string; line?: number; text?: string; body?: string }>;
    images: Array<{ base64: string; mimeType: string }>;
    exit: boolean;
    canceled: boolean;
} {
    const meta = response._meta && typeof response._meta === "object"
        ? response._meta as {
            approved?: boolean;
            feedback?: string;
            annotations?: Array<{ file?: string; line?: number; text?: string; body?: string }>;
            images?: Array<{ base64: string; mimeType: string }>;
            exit?: boolean;
            canceled?: boolean;
        }
        : {};
    return {
        approved: meta.approved === true,
        feedback: typeof meta.feedback === "string" ? meta.feedback : response.message || "",
        annotations: Array.isArray(meta.annotations) ? meta.annotations : [],
        images: Array.isArray(meta.images) ? meta.images : [],
        exit: meta.exit === true,
        canceled: meta.canceled === true || response.outcome === "canceled",
    };
}

function formatCodeReviewAnnotations(
    annotations: Array<{ file?: string; line?: number; text?: string; body?: string }>,
): string {
    return annotations.map((annotation, index) => {
        const location = [annotation.file, annotation.line].filter((part) => part !== undefined && part !== "").join(
            ":",
        );
        const text = annotation.text || annotation.body || "(no annotation text)";
        return `${index + 1}. ${location ? `${location}: ` : ""}${text}`;
    }).join("\n");
}

function getCiFailureReason(ciResult: LocalCIResult): string {
    const output = "output" in ciResult && typeof ciResult.output === "string" ? ciResult.output : "";
    return output || "Mechanical Validation failed.";
}

function getPlanAttrs(planContent: string): Partial<PlanFrontMatter> {
    try {
        const parsed = extractYaml(planContent) as { attrs?: Partial<PlanFrontMatter> };
        return parsed.attrs || {};
    } catch {
        return {};
    }
}

function isPlanDocumentPath(path: string, planName: string): boolean {
    const normalized = path.replaceAll("\\", "/");
    return normalized === `plans/${planName}.md` || normalized.startsWith("plans/");
}

function extractDiffPaths(diffText: string): string[] {
    const paths: string[] = [];
    for (const line of diffText.split("\n")) {
        if (!line.startsWith("diff --git ")) continue;
        const parts = line.split(" ");
        const nextPath = parts[3]?.replace(/^b\//, "");
        if (nextPath) paths.push(nextPath);
    }
    return paths;
}

function hasImplementationDiff(diffText: string, planName: string): boolean {
    const paths = extractDiffPaths(diffText);
    if (paths.length === 0) return diffText.trim().length > 0;
    return paths.some((path) => !isPlanDocumentPath(path, planName));
}

function requiresImplementationDiff(meta: Partial<PlanFrontMatter>): boolean {
    return meta.classification === "FEATURE" || meta.classification === "PLANNED_CHANGE" ||
        meta.classification === "PROJECT";
}
