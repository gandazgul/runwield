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
import { preparePrimaryPlanPathForMerge, restorePrimaryPlanPathAfterMergeFailure } from "../worktree.js";
import { runIsolatedAgentSession } from "../session/session.js";
import type { RuntimeValidationProgress } from "../session/session-runtime-events.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "../session/session-runtime-interactions.js";
import { acknowledgeTaskCompletion, claimPendingTaskCompletion } from "../session/task-completion-session.ts";
import { getCodeReviewMode, getGuidedReviewMode, shouldCleanupMergedWorktrees } from "../settings.js";
import {
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    mergeExecutionWorktree,
    removeWorktreeGitArtifacts,
} from "../worktree.js";
import {
    pruneEntry as pruneWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import type { WorkRecordMnemosynePort } from "../work-records/mnemosyne-port.ts";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordWorkflowMetric } from "./metrics.js";
import { runObjectiveChecks, summarizeObjectiveChecks } from "./objective-checks.ts";
import {
    PLAN_STATUSES,
    recordPlanEvent,
    stageValidationPassedInExecutionWorktree,
    VALIDATION_PLAN_STATUSES,
} from "./plan-lifecycle.js";
import { resolveValidationExecutionContext } from "./execution-context.ts";
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
    hasTrustedClaudeMcpReview,
    loadReviewerFeedbackEngineerDef,
    loadReviewerPrompt,
    runFeaturePostVerificationHandoffs,
    runLocalCI,
    runMechanicalValidation as runQuickFixMechanicalValidation,
    shouldContinueParentEpicAfterValidation,
    unaccountedOpenItems,
    usedReviewDiffTool,
    verifyPostMergeCandidatePublished,
} from "./validation-helpers.ts";
import type { LocalCIPort } from "./validation-local-ci.ts";
import { readRepairedMergeCandidate } from "./validation-merge-verification.ts";
import {
    clearValidationPosition,
    getValidationPosition,
    rememberValidationPosition,
    type ValidationPhaseName,
} from "./validation-position.ts";
import {
    completeValidationProgress,
    createValidationProgress,
    emitRunWieldSystemStatus,
    getCurrentValidationProgress,
    updateValidationProgress,
} from "./validation-progress.ts";

export {
    hasTrustedClaudeMcpReview,
    loadManualQaPrompt,
    loadReviewerFeedbackEngineerDef,
    loadReviewerPrompt,
    runLocalCI,
    runManualQaChecklistPrompt,
    shouldContinueParentEpicAfterValidation,
    shouldRunWorkflowValidation,
    unaccountedOpenItems,
    usedReviewDiffTool,
} from "./validation-helpers.ts";

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
type TriageMeta = import("../../tools/plan-written.ts").TriageMeta & Partial<PlanFrontMatter>;
type ActiveExecutionWorkflow = import("../session/hosted-session.js").ActiveExecutionWorkflow;
type HostedSession = import("../session/hosted-session.js").HostedSession;
type AgentMessage = import("@earendil-works/pi-agent-core").AgentMessage;
type AgentDefinition = import("../session/types.js").AgentDefinition;
type GitPort = import("../git-port.ts").GitPort;
type LocalCIResult = Awaited<ReturnType<typeof runLocalCI>>;
type ObjectiveCheckResult = Awaited<ReturnType<typeof runObjectiveChecks>>[number];
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
type ValidationPhaseResult = WorkflowValidationResult & {
    awaitingTaskCompletion?: true;
};

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

export type SemanticReviewPort = {
    runIsolatedAgentSession: (options: IsolatedAgentSessionOptions) => Promise<AgentMessage[]>;
};

export const SYSTEM_SEMANTIC_REVIEW_PORT: SemanticReviewPort = Object.freeze({
    runIsolatedAgentSession,
});

type MechanicalValidationArgs = {
    sessionManager?: SessionManager;
    hostedSession?: HostedSession;
    cwd?: string;
    manualQaName?: string;
    manualQaContext?: string;
};

type ValidationLoopArgs = {
    planName: string;
    planContent: string;
    triageMeta: TriageMeta;
    sessionManager?: SessionManager;
    hostedSession: HostedSession;
    finalAgentName?: string;
    executionContext?: ActiveExecutionWorkflow;
    git: GitPort;
    semanticReviewPort: SemanticReviewPort;
    localCI: LocalCIPort;
    workRecordMnemosynePort: WorkRecordMnemosynePort;
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
    localCI: LocalCIPort,
) => Promise<{ passed: boolean; attempts: number; reason?: string }>;

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
        triageMeta: { ...args.triageMeta, ...canonicalPlan.attrs },
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
 * Which phase runs next: what the loop remembers, or failing that, the Plan.
 *
 * Memory wins because it is strictly better informed. It was written by the phase
 * that last knew where it was going, whereas status is a three-valued summary that
 * anything writing to the Plan can move — including a repair Agent's own
 * `task_completed`, which is how a run could skip its remaining checks and go
 * straight to publication.
 */
/** Validation's three statuses in the order the loop passes through them. */
const VALIDATION_STATUS_ORDER = ["implemented", "validated_ci", "validated_reviewer"];

/** The status a phase expects to find on the Plan it is about to run. */
const PHASE_STATUS: Record<ValidationPhaseName, string> = {
    mechanical: "implemented",
    semantic: "validated_ci",
    delivery: "validated_reviewer",
};

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
    emitStatus(args.hostedSession, reason, "warning");
    await recordLifecycleEvent(args, projectRoot, "validation_failed", status as PlanEventStatus, reason);
    return true;
}

function resolveNextPhase(
    args: ValidationLoopArgs,
    status: "implemented" | "validated_ci" | "validated_reviewer",
): ValidationPhaseName {
    const fromStatus: ValidationPhaseName = status === "validated_reviewer"
        ? "delivery"
        : status === "validated_ci"
        ? "semantic"
        : "mechanical";
    return getValidationPosition(args.hostedSession, args.planName)?.phase || fromStatus;
}

/**
 * How many phases one call may drive. Validation has three, and a repair can send
 * the Plan back to the start, so this bounds a pathological ping-pong without
 * capping any real run.
 */
const MAX_PHASES_PER_CALL = 12;

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
            // Verified or failed, the run is finished and its position dies with it.
            clearValidationPosition(args.hostedSession, args.planName);
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
        phaseArgs = { ...phaseArgs, executionContext: undefined };
    }
    return result!;
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
        const ciResult = await localCI.run({ hostedSession: args.hostedSession, cwd: phase.context.executionCwd });
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
                        getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
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
                    getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
                } stopped without task_completed during Objective-Failing Check repair.`;
                emitStatus(
                    args.hostedSession,
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
                    getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
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
                getAgentDisplayName(phase.context.executionAgent, phase.context.projectRoot)
            } stopped without task_completed during CI repair.`;
            emitStatus(
                args.hostedSession,
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

    // Rounds one and two sweep the whole Plan; from three on the reviewer only
    // verifies what is still open. Each round below the limit ends by handing the
    // Plan back to `implemented`, so the tests run over the repair before the next
    // review. At the limit the user takes the wheel, and their "look again" re-enters
    // right here — another focused round on the repaired diff, no detour.
    for (;;) {
        const nextRound = round + 1;
        const reviewMode = nextRound <= DISCOVERY_ROUNDS ? "discovery" : "verify";
        // The reviewer runs in its own session, so without this the whole round is
        // silent: the user sees the Engineer finish, then nothing, and the verdict
        // lands only in the Plan's failure reason. Say a round is starting, and say
        // which kind it is — a verify round reads very differently from a sweep.
        emitProgress(
            args,
            `Semantic Code Review round ${nextRound}/${AUTOMATIC_ROUNDS} (${reviewMode}) in progress...`,
            "info",
            {
                outcome: "running",
                stage: "semantic_review",
                cycle: clampCycle(nextRound),
                maxCycles: AUTOMATIC_ROUNDS,
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
            emitProgress(args, `Semantic Code Review Approved (round ${nextRound}).`, "success", {
                stage: "semantic_review",
                cycle: clampCycle(nextRound),
                maxCycles: AUTOMATIC_ROUNDS,
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

        // Asked after the repair and after the tests run over it, not before: the
        // choice is about the repaired code, and the user needs to know whether it
        // still builds before deciding to ship it or look at it themselves. Running
        // the tests here is also what keeps a repair from reaching publication
        // unbuilt, now that a Retry re-enters at the reviewer rather than going back
        // around through the mechanical phase.
        if (nextRound >= AUTOMATIC_ROUNDS) {
            // At the limit the repair is tested right here instead of going back
            // around, so the loop stays in this phase rather than the mechanical one
            // the dispatch above pinned it to.
            rememberValidationPosition(args.hostedSession, args.planName, { phase: "semantic" });
            emitStatus(args.hostedSession, `Running CI Validation in ${context.executionCwd}.`);
            const ciResult = await args.localCI.run({
                hostedSession: args.hostedSession,
                cwd: context.executionCwd,
            });
            const testsPass = ciResult.exitCode === 0 && ciResult.canceled !== true;
            emitStatus(
                args.hostedSession,
                testsPass ? "Build and tests passed." : "Build and tests are failing after the repair.",
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
                // Nothing is recorded, so the Plan stays at `validated_ci` with its
                // passing tests and its open findings intact. Running it again reopens
                // the review exactly here rather than starting the pipeline over.
                return {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: `The reviewer still has ${openCount} open point(s) on "${args.planName}". ${
                        testsPass ? "The tests still pass and the findings are saved." : "The tests are failing too."
                    } Run this Plan again when you want to pick it back up.`,
                };
            }
            round = nextRound;
            ledger = review.ledger;
            diffText = await getDiffText(context.baselineTree, context.executionCwd);
            continue;
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

    // Asked once, not once per round. Someone who has already written feedback on this
    // diff does not need to be asked whether they want to see it again.
    if (mode === "ask" && args.triageMeta.humanReviewDecision !== "changes_requested") {
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

    const diffText = context.nonGitInPlace ? "" : await getDiffText(context.baselineTree, context.executionCwd);
    const planAttrs = getPlanAttrs(args.planContent);
    const guidedReview = {
        mode: getGuidedReviewMode(context.projectRoot),
        autoStart: false,
        reasons: [],
        score: 0,
        stats: {},
    };
    for (;;) {
        emitProgress(args, "Waiting for User Code Review...", "info", {
            outcome: "running",
            stage: "human_review",
            checks: { humanReview: "running" },
        });
        const outcome = await requestHumanReviewDecision();
        if (outcome.kind === "decided") return outcome.result;
        // The review window closed with no answer in it. That is not a rejection, so
        // it must not throw the work back to the start — ask what the user meant.
        // Retry opens the same review again; Stop leaves the Plan ready to publish
        // whenever they come back, with the review still outstanding.
        if (await pauseForUserAction(args, outcome.pause) === "retry") continue;
        return {
            kind: "paused",
            planName: args.planName,
            projectRoot: context.projectRoot,
            reason:
                `${outcome.pause.whatHappened} Run this Plan again when you are ready and RunWield will pick up at the review.`,
        };
    }

    async function requestHumanReviewDecision(): Promise<
        { kind: "decided"; result: ValidationPhaseResult } | { kind: "no_answer"; pause: UserActionPause }
    > {
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
            emitProgress(args, "User Code Review Approved.", "success", {
                stage: "human_review",
                checks: { humanReview: "passed" },
            });
            return {
                kind: "decided",
                result: {
                    kind: "paused",
                    planName: args.planName,
                    projectRoot: context.projectRoot,
                    reason: "Local Human Code Review approved.",
                },
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
                // The user owns this review from here. Recorded before the status
                // moves, so the phase that picks the Plan up next can see it and hand
                // the diff straight back rather than starting another sweep.
                await persistHumanReviewMetadata(args, context.projectRoot, {
                    humanReviewMode: mode,
                    humanReviewDecision: "changes_requested",
                    humanReviewedAt: null,
                });
                await recordLifecycleEvent(
                    args,
                    context.projectRoot,
                    "validation_failed",
                    "validated_reviewer",
                    feedbackText,
                );
                return {
                    kind: "decided",
                    result: {
                        kind: "paused",
                        planName: args.planName,
                        projectRoot: context.projectRoot,
                        reason: "Human review feedback repair dispatched.",
                    },
                };
            }
        }

        return {
            kind: "no_answer",
            pause: {
                whatHappened: humanReview.canceled
                    ? `You closed the code review for "${args.planName}" without approving it or leaving notes.`
                    : `The code review for "${args.planName}" ended without an approval or any notes.`,
                doThis: "Pick Retry to open it again, or Stop to come back to it later. Nothing has been thrown away.",
            },
        };
    }
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
    const gitPort = args.git;
    const planPath = `plans/${args.planName}.md`;
    const storedRepairWorktree = await resolveStoredValidationMergeRepairWorktree(args, context);
    if (storedRepairWorktree.kind === "blocked") return storedRepairWorktree.outcome;
    let repairMergeWorktreePath = storedRepairWorktree.path;
    let agentRepairs = 0;
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

        // A merge conflict is normal and fixable, so try the Agent first and retry
        // publication in the same call — the user should not be asked about something
        // RunWield can resolve. Uncommitted work in the project folder is the
        // exception: only the user can decide what happens to it.
        if (failureKind !== "primary_checkout_dirty" && agentRepairs < MAX_AGENT_MERGE_REPAIRS) {
            agentRepairs += 1;
            if (await dispatchMergeRepair(args, context, reason, error)) continue;
        }

        const pause = describeMergePause(args.planName, worktreeBaseBranch, error, reason, context);
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
        const repairedCandidate = repairMergeWorktreePath
            ? await readRepairedMergeCandidate(repairMergeWorktreePath)
            : null;
        const checkpoint = repairedCandidate || await checkpointExecutionWorktree({
            worktreePath: context.executionCwd,
            branch: executionBranch,
            planName: args.planName,
            planDescription: args.triageMeta?.summary,
        });
        const targetHeadBeforeMerge = repairedCandidate?.targetHeadBeforeMerge ||
            await gitPort.branchHead(context.projectRoot, targetBranch);
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
        if (hierarchy.parentPlan) repairedPlanPaths.add(`plans/${hierarchy.parentPlan}.md`);
        for (const sibling of hierarchy.siblingPlans) repairedPlanPaths.add(`plans/${sibling.name}.md`);
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
                    `Merging validated worktree branch ${executionBranch} into target branch ${targetBranch}.`,
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

async function resolvePhaseContext(
    args: ValidationLoopArgs,
): Promise<{ kind: "ok"; context: PhaseContext } | { kind: "blocked"; result: ValidationPhaseResult }> {
    const projectRoot = getProjectRoot(args);
    const activeWorkflow = args.hostedSession.getActiveExecutionWorkflow?.() || null;
    const resolution = await resolveValidationExecutionContext({
        projectRoot,
        planName: args.planName,
        triageMeta: args.triageMeta,
        explicitContext: args.executionContext,
        activeWorkflow,
    });
    if (resolution.kind === "blocked") {
        // Say it out loud. This path used to record the failure and return, emitting
        // nothing: the workflow ended mid-run with no message, which is the exact
        // shape of a strand — the user watches an Agent finish and then nothing
        // happens, ever.
        emitHalted(
            args,
            `RunWield cannot continue validating ${args.planName}: ${resolution.message}`,
            resolution.message,
        );
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
    const reviewerSessionManager = SessionManager.inMemory(context.executionCwd);
    let lastReviewerFailure = "Semantic Reviewer did not complete.";
    let nudgeReason: string | undefined;
    let inspectedDiff = false;
    let latestOutcome: ReviewOutcome | null = null;

    for (let attempt = 1; !latestOutcome; attempt++) {
        if (attempt > 3) {
            // Out of nudges. The round is recoverable — the findings are preserved and
            // the reviewer starts fresh — so offer that rather than ending here.
            const pause: UserActionPause = {
                whatHappened: `The reviewer could not finish looking at "${args.planName}". ${lastReviewerFailure}`,
                doThis:
                    "Pick Retry to have it try again from the same findings, or Stop to come back to this later. If its context is full, run /compact first.",
            };
            if (await pauseForUserAction(args, pause) === "stop") break;
            attempt = 1;
            nudgeReason = undefined;
        }
        if (attempt > 1) {
            emitStatus(
                args.hostedSession,
                `Nudging Semantic Reviewer to finish round ${state.semanticRound} (${attempt}/3)...`,
                "info",
            );
        }
        const reviewerAgentDef = await loadReviewerPrompt(reviewMode);
        const config = buildSemanticReviewAttempt(reviewerAgentDef, attempt, nudgeReason, state, reviewMode, diffText);
        nudgeReason = undefined;
        try {
            const sessionMessages = await args.semanticReviewPort.runIsolatedAgentSession({
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
            const trustedClaudeMcpReview = hasTrustedClaudeMcpReview(sessionMessages);
            const outcome = readLatestReviewOutcome(sessionMessages);
            const unaccounted = unaccountedOpenItems(state.reviewLedger, outcome?.findings);
            if (!outcome) {
                lastReviewerFailure = "Semantic Reviewer finished without calling review_complete.";
            } else if (!inspectedDiff && !trustedClaudeMcpReview) {
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
            `The reviewer could not finish looking at "${args.planName}". ${lastReviewerFailure} Run this Plan again when you are ready — it picks up at this same round, with the findings so far kept.`;
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
    try {
        const workflowState = { ...context.workflowBase, ...packet.activeWorkflow };
        args.hostedSession.setActiveExecutionWorkflow?.(workflowState);
        const agentDef = await loadReviewerFeedbackEngineerDef();
        const sessionMessages = await args.semanticReviewPort.runIsolatedAgentSession({
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

type ObjectiveCheckPhaseOutcome =
    | { kind: "passed" }
    | { kind: "skipped" }
    | { kind: "canceled" }
    | { kind: "unmet"; reason: string; results: ObjectiveCheckResult[] }
    | { kind: "broken"; reason: string; results: ObjectiveCheckResult[] };

async function runPlanObjectiveChecks(
    args: ValidationLoopArgs,
    context: PhaseContext,
    attempts: number,
): Promise<ObjectiveCheckPhaseOutcome> {
    if (!isPlannedChangeClassification(args.triageMeta.classification)) return { kind: "skipped" };
    const checks = args.triageMeta.objectiveChecks || [];
    if (!checks.length) return { kind: "skipped" };

    emitStatus(
        args.hostedSession,
        `Running Objective-Failing Checks for ${args.planName}: ${checks.map((check) => check.id).join(", ")}.`,
    );
    // Register the whole phase as a Session active interaction so Escape reaches
    // it exactly like it reaches local CI: one abort, whole process trees stop,
    // and remaining checks are never scheduled.
    const interactionId = `objective-checks:${args.planName}:${Date.now()}`;
    const abortController = new AbortController();
    args.hostedSession.addActiveInteraction(interactionId, { abortController });
    let results: ObjectiveCheckResult[];
    try {
        results = await runObjectiveChecks({
            checks,
            cwd: context.executionCwd,
            signal: abortController.signal,
        });
    } finally {
        args.hostedSession.removeActiveInteraction(interactionId);
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
        emitStatus(args.hostedSession, "Objective-Failing Checks canceled.", "warning");
        return { kind: "canceled" };
    }
    emitStatus(args.hostedSession, summary.block, summary.broken || summary.unmet ? "warning" : "success");
    if (summary.broken > 0) {
        return { kind: "broken", reason: `Objective-Failing Check defect.\n\n${summary.block}`, results };
    }
    if (summary.unmet > 0) {
        return { kind: "unmet", reason: `Objective-Failing Checks unmet.\n\n${summary.block}`, results };
    }
    return { kind: "passed" };
}

async function dispatchObjectiveCheckRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    results: ObjectiveCheckResult[],
): Promise<boolean> {
    const runActiveAgentTurnImpl = runActiveAgentTurn;
    const summary = summarizeObjectiveChecks(results);
    args.hostedSession.setActiveExecutionWorkflow?.({ ...context.workflowBase });
    emitStatus(
        args.hostedSession,
        `Objective-Failing Checks are unmet. Dispatching ${
            getAgentDisplayName(context.executionAgent, context.projectRoot)
        } to satisfy them...`,
        "warning",
    );
    await runActiveAgentTurnImpl({
        hostedSession: args.hostedSession,
        agentName: context.executionAgent,
        userRequest:
            "The Plan failed Objective-Failing Checks during Mechanical Validation. Fix the implementation so these checks exit 0, then call task_completed when the repair is complete. Do not edit the Plan checks unless the user explicitly asks for a new Plan review. If the repair involves tests, follow the write-tests skill for sound testing behavior:\n\n" +
            summary.block,
        sessionManager: args.sessionManager,
        cwd: context.executionCwd,
    });
    const completion = claimPendingTaskCompletion(
        args.hostedSession,
        args.hostedSession.getRootAgentSession(),
    );
    if (!completion) return false;
    // `implemented` is already the durable recovery state for this repair. Once
    // completion wakes validation, a crash can safely rerun Mechanical Validation
    // from that lifecycle checkpoint.
    acknowledgeTaskCompletion(args.hostedSession, completion);
    return true;
}

async function dispatchCiRepair(
    args: ValidationLoopArgs,
    context: PhaseContext,
    ciResult: LocalCIResult,
): Promise<boolean> {
    const runActiveAgentTurnImpl = runActiveAgentTurn;
    args.hostedSession.setActiveExecutionWorkflow?.({ ...context.workflowBase });
    // Pin the loop here before the Agent runs. The repair reports `task_completed`
    // into the root transcript, which is also what marks a Plan implemented — so
    // without this the next phase reads an advanced status and jumps past the CI
    // that has not passed yet.
    rememberValidationPosition(args.hostedSession, args.planName, {
        phase: "mechanical",
        awaiting: "ci_repair",
    });
    emitProgress(
        args,
        `Build failed. Dispatching ${
            getAgentDisplayName(context.executionAgent, context.projectRoot)
        } to fix the CI failure...`,
        "warning",
        { outcome: "running", stage: "engineer_repair", checks: { ci: "failed" } },
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
    const completion = claimPendingTaskCompletion(
        args.hostedSession,
        args.hostedSession.getRootAgentSession(),
    );
    if (!completion) return false;
    acknowledgeTaskCompletion(args.hostedSession, completion);
    return true;
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

/** How many times an Agent may be sent at the same merge before the user is asked. */
const MAX_AGENT_MERGE_REPAIRS = 2;

/** What RunWield tells the user, and what it asks them to do about it. */
type UserActionPause = {
    /** One sentence, past tense: the thing that stopped. */
    whatHappened: string;
    /** One or two sentences, imperative: the user's move. */
    doThis: string;
    /** Optional paths or names the sentences refer to. */
    details?: string[];
};

function getMergeFailureKind(error: unknown): string | undefined {
    if (error && typeof error === "object" && "mergeFailureKind" in error) {
        const kind = (error as { mergeFailureKind?: unknown }).mergeFailureKind;
        return typeof kind === "string" ? kind : undefined;
    }
    return undefined;
}

/**
 * The merge worktree a repair happened in, so publication can finish that tree.
 */
function getMergeWorktreePath(error: unknown): string | undefined {
    if (error && typeof error === "object" && "mergeWorktreePath" in error) {
        const path = (error as { mergeWorktreePath?: unknown }).mergeWorktreePath;
        return typeof path === "string" ? path : undefined;
    }
    return undefined;
}

type ValidationMergeRepairWorktreeResolution =
    | { kind: "ready"; path?: string }
    | { kind: "blocked"; outcome: PublicationOutcome };

async function resolveStoredValidationMergeRepairWorktree(
    args: ValidationLoopArgs,
    context: PhaseContext,
): Promise<ValidationMergeRepairWorktreeResolution> {
    const path = readValidationMergeRepairWorktree(args.triageMeta);
    if (!path) return { kind: "ready" };
    if (await filesystemPathExists(path)) return { kind: "ready", path };
    const cleared = await persistValidationMergeRepairWorktree(args, context, null);
    if (cleared.kind === "blocked") return cleared;
    return { kind: "ready" };
}

function readValidationMergeRepairWorktree(triageMeta: TriageMeta): string | undefined {
    const path = triageMeta.validationMergeRepairWorktree;
    return typeof path === "string" && path ? path : undefined;
}

async function filesystemPathExists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

async function persistValidationMergeRepairWorktree(
    args: ValidationLoopArgs,
    context: PhaseContext,
    path: string | null,
): Promise<{ kind: "committed" } | { kind: "blocked"; outcome: PublicationOutcome }> {
    const transition = await runPlanFrontMatterTransition({
        projectRoot: context.projectRoot,
        planName: args.planName,
        operation: "validation_merge_repair_worktree",
        updates: { validationMergeRepairWorktree: path },
        recoveryAttrs: { ...args.triageMeta },
    });
    if (transition.status === "committed") return { kind: "committed" };
    const reason = transition.message || `Could not save merge repair worktree state for ${args.planName}.`;
    return {
        kind: "blocked",
        outcome: {
            recorded: false,
            result: { kind: "failed", planName: args.planName, projectRoot: context.projectRoot, reason },
        },
    };
}

function getBlockingPaths(error: unknown): string[] {
    if (error && typeof error === "object" && "blockingPaths" in error) {
        const paths = (error as { blockingPaths?: unknown }).blockingPaths;
        if (Array.isArray(paths)) return paths.filter((path): path is string => typeof path === "string");
    }
    return [];
}

/**
 * Turn a merge failure into something a person can act on.
 *
 * Written for someone who has never seen RunWield's internals: no status names, no
 * transition vocabulary, no worktree ids. Say what stopped, then say the one thing
 * they should do about it.
 */
function describeMergePause(
    planName: string,
    targetBranch: string,
    error: unknown,
    reason: string,
    context: PhaseContext,
): UserActionPause {
    const kind = getMergeFailureKind(error);
    if (kind === "primary_checkout_dirty") {
        return {
            whatHappened:
                `RunWield finished "${planName}" but could not add it to your ${targetBranch} branch, because your project folder has changes you have not saved to git yet — in the same files this work changes. Merging now would wipe them out.`,
            doThis:
                "Commit, stash, or delete these files, then pick Retry. Nothing was lost, and the finished work is waiting.",
            details: getBlockingPaths(error),
        };
    }
    if (kind === "target_checked_out") {
        return {
            whatHappened:
                `RunWield finished "${planName}" but could not add it to your ${targetBranch} branch, because that branch is checked out somewhere else.`,
            doThis: `Switch that other checkout off ${targetBranch}, then pick Retry.`,
        };
    }
    const repairCwd = getMergeRepairCwd(error) || context.executionCwd;
    if (kind === "detached_merge_conflict" || kind === "current_checkout_merge_conflict") {
        return {
            whatHappened:
                `RunWield could not combine "${planName}" with your ${targetBranch} branch: the same lines changed in both places, and the agent could not settle it.`,
            doThis:
                `Open ${repairCwd}, fix the files git marked as conflicted, run "git add" on each one, then pick Retry.`,
        };
    }
    return {
        whatHappened: `RunWield could not add "${planName}" to your ${targetBranch} branch. Git said: ${reason}`,
        doThis: `Fix that in ${repairCwd}, then pick Retry.`,
    };
}

/**
 * Pause for a decision only the user can make, and offer exactly two ways out.
 *
 * RunWield does not halt. When it runs out of moves it says what happened in plain
 * words, says what the user should do, and waits — Retry runs the same thing again,
 * Stop leaves the work at its last safe point. A failed Retry lands right back here
 * with the same two choices, so there is never a dead end.
 *
 * A session that cannot prompt (headless, scripted, cancelled) reads as Stop, which
 * is the safe answer: it never loops unattended and never guesses on the user's
 * behalf.
 */
async function pauseForUserAction(args: ValidationLoopArgs, pause: UserActionPause): Promise<"retry" | "stop"> {
    const detailLines = pause.details?.length ? `\n\n${pause.details.map((detail) => `  ${detail}`).join("\n")}` : "";
    emitStatus(args.hostedSession, `${pause.whatHappened}${detailLines}\n\n${pause.doThis}`, "warning");
    const response = await requestInteraction(args, {
        type: RuntimeInteractionTypes.SELECT,
        prompt: `${pause.whatHappened}${detailLines}\n\n${pause.doThis}`,
        options: [
            { value: "retry", label: "Retry" },
            { value: "stop", label: "Stop" },
        ],
    });
    return response.outcome === "selected" && response.value === "retry" ? "retry" : "stop";
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
async function promptForSemanticRoundLimit(
    args: ValidationLoopArgs,
    semanticRound: number,
    openFindingCount: number,
    testsPass: boolean,
): Promise<"continue" | "code_review" | "stop"> {
    const response = await requestInteraction(args, {
        type: RuntimeInteractionTypes.SELECT,
        prompt:
            `The reviewer has looked at "${args.planName}" ${semanticRound} times and still is not happy with it. ${openFindingCount} thing(s) are still open, and the latest fix ${
                testsPass ? "builds and passes the tests" : "does not pass the tests"
            }.\n\nYou can have the reviewer take another look at just those, read the changes yourself, or leave it here for now — nothing is lost either way.`,
        options: [
            { value: "continue", label: "Have the reviewer look again" },
            { value: "code_review", label: "Let me read the changes" },
            { value: "stop", label: "Stop" },
        ],
    });
    if (response.outcome !== "selected") return "stop";
    if (response.value === "code_review") return "code_review";
    return response.value === "continue" ? "continue" : "stop";
}

async function recordLifecycleEvent(
    args: ValidationLoopArgs,
    projectRoot: string,
    event: PlanEvent,
    currentStatus: PlanEventStatus,
    failureReason?: string,
    extraDetails: Partial<RecordPlanEventArgs["details"]> = {},
): Promise<RecordPlanEventResult> {
    const result = await recordPlanEvent({
        cwd: projectRoot,
        planName: args.planName,
        event,
        currentStatus,
        details: { triageMeta: args.triageMeta, failureReason, ...extraDetails },
    });
    // Move the remembered position with the transition the loop just made, in one
    // place rather than at each call site. Scattering it meant a path that recorded
    // a status change without also updating the memory left the two disagreeing,
    // and dispatch trusts the memory — human-review feedback sent the Plan back to
    // `implemented` while the memory still said `semantic`, and the next phase tried
    // to review a Plan that had already moved past it.
    //
    // Only transitions validation performs land here. That is the point: a status
    // moved by anything else — a repair Agent's own `task_completed` — leaves the
    // memory alone, which is exactly the jump this is meant to refuse.
    const nextPhase = phaseForRecordedStatus(event);
    if (nextPhase) rememberValidationPosition(args.hostedSession, args.planName, { phase: nextPhase });
    return result;
}

/**
 * The phase that owns the status a lifecycle event moves a Plan to.
 *
 * Returns nothing for events that do not resolve to a validation phase — the
 * terminal ones, whose position is cleared rather than moved.
 */
function phaseForRecordedStatus(event: PlanEvent): ValidationPhaseName | undefined {
    switch (event) {
        case "mechanical_validation_passed":
            return "semantic";
        case "semantic_review_passed":
            return "delivery";
        case "mechanical_validation_failed":
        case "semantic_review_feedback":
        case "validation_failed":
            return "mechanical";
        default:
            return undefined;
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
async function confirmPublishedPlanVerified(
    args: ValidationLoopArgs,
    context: PhaseContext,
    details: Partial<RecordPlanEventArgs["details"]>,
): Promise<void> {
    const status = (await loadPlan(context.projectRoot, args.planName))?.attrs.status;
    if (status === "verified" || status === "user_verified") return;
    if (!status || !VALIDATION_PLAN_STATUSES.includes(status as PlanStatus)) return;
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
async function isPlanAlreadyPublished(projectRoot: string, planName: string): Promise<boolean> {
    const status = await loadPlan(projectRoot, planName).then((plan) => plan?.attrs.status).catch(() => undefined);
    return status === "verified" || status === "user_verified";
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
        recoveryAttrs: { ...args.triageMeta },
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
    if (context.worktreeId) {
        await pruneWorktreeRegistryEntry(context.projectRoot, context.worktreeId).catch(() => {});
    }
    if (cleanupMergedWorktrees && context.executionCwd) {
        await removeWorktreeGitArtifacts({ projectRoot: context.projectRoot, path: context.executionCwd, force: false })
            .catch(() => {});
        if (context.worktreeBranch) {
            await deleteMergedWorktreeBranch({ projectRoot: context.projectRoot, branch: context.worktreeBranch })
                .catch(() => {});
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
        mnemosynePort: args.workRecordMnemosynePort,
    });
}

function buildVerifiedResult(args: ValidationLoopArgs, projectRoot: string): WorkflowValidationResult {
    // The run is over, so its position must not outlive it — a Plan reopened later
    // has to start from what the Plan durably says, not from where this one ended.
    clearValidationPosition(args.hostedSession, args.planName);
    // Close the panel out on the way past. Without this the last thing the user
    // sees is a merge still "running", on a run that finished successfully.
    const current = getCurrentValidationProgress(args.hostedSession);
    if (current) {
        emitStatus(
            args.hostedSession,
            `${args.planName} is verified and published.`,
            "success",
            completeValidationProgress(current, true, `${args.planName} is verified and published.`),
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

/**
 * Say something to the user, carrying the validation panel with it.
 *
 * Every line the loop emits goes through here, and every one of them re-sends the
 * progress the session is currently holding. That is what keeps the panel pinned
 * for the whole run rather than only on the lines that happen to change a stage:
 * the loop talks constantly, and a status line that dropped the progress used to
 * take the panel down with it.
 */
function emitStatus(
    hostedSession: HostedSession,
    message: string,
    level: "info" | "success" | "warning" | "error" = "info",
    progress?: RuntimeValidationProgress,
): void {
    emitRunWieldSystemStatus(hostedSession, message, level, progress);
}

/**
 * Move the loop's position and announce it.
 *
 * The patch applies to wherever the session already is, so checks accumulate
 * across phases within a run. On a cold start there is nothing to patch and the
 * position is seeded from the Plan's status by {@link seedProgressForStatus}.
 */
function emitProgress(
    args: ValidationLoopArgs,
    message: string,
    level: "info" | "success" | "warning" | "error",
    patch: Parameters<typeof updateValidationProgress>[1],
): void {
    const current = getCurrentValidationProgress(args.hostedSession) || seedProgressForStatus(args);
    const next = updateValidationProgress(current, patch);
    // The total counts passes through the loop, so it can never sit below the round
    // it is qualifying. Rounds advance within a run while the total was seeded once
    // from durable counters, which is how the panel came to read "round 2/3 (total 1)".
    const total = Math.max(next.totalCycle || 0, next.cycle || 0, current.totalCycle || 0);
    emitStatus(args.hostedSession, message, level, total > 0 ? { ...next, totalCycle: total } : next);
}

/**
 * Close the panel out on a run that stopped.
 *
 * Terminal outcomes have to be internally consistent — no check left pending, none
 * left running — which is what {@link completeValidationProgress} settles. Patching
 * `outcome: "failed"` directly leaves the record contradicting itself and the event
 * is rejected, taking the whole halt path down with it.
 */
function emitHalted(args: ValidationLoopArgs, message: string, reason: string): void {
    clearValidationPosition(args.hostedSession, args.planName);
    const current = getCurrentValidationProgress(args.hostedSession) || seedProgressForStatus(args);
    // A failed run has to name what failed. Checks caught mid-flight settle to
    // `failed` on their own; a halt that lands before anything started has nothing
    // to settle, and CI is the gate it never got through.
    const settled = Object.values(current.checks).some((check) => check === "running" || check === "failed")
        ? current
        : updateValidationProgress(current, { checks: { ci: "failed" } });
    emitStatus(args.hostedSession, message, "error", completeValidationProgress(settled, false, reason));
}

/**
 * Where a run picks up when nothing is held in memory.
 *
 * Status is the right answer for exactly this moment and no other: a fresh call
 * knows only what the Plan durably records, so the checks already behind the
 * current status are marked passed and the rest are left pending.
 */
function seedProgressForStatus(args: ValidationLoopArgs): RuntimeValidationProgress {
    const status = args.triageMeta.status;
    const semanticDone = status === "validated_reviewer";
    const ciDone = semanticDone || status === "validated_ci";
    const rounds = readSemanticRound(args.triageMeta);
    return createValidationProgress({
        kind: "workflow",
        outcome: "running",
        // Deliberately neutral. A stage has to agree with its own check — naming
        // `semantic_review` before the reviewer has started is rejected outright —
        // so the seed only says which checks are already behind us, and the first
        // real emit of a phase names the stage as it begins.
        stage: "cycle",
        cycle: clampCycle(rounds + 1),
        maxCycles: AUTOMATIC_ROUNDS,
        // Rounds and repairs both count as passes through the loop, so a user Retry
        // that resets the round counter still reads as forward motion rather than
        // starting over at one.
        totalCycle: rounds + readCiAttempts(args.triageMeta) + 1,
        checks: {
            ci: ciDone ? "passed" : "pending",
            semanticReview: semanticDone ? "passed" : ciDone ? "running" : "pending",
            humanReview: semanticDone ? "running" : "pending",
            merge: "pending",
        },
    });
}

/**
 * Keep the displayed round inside the advertised limit.
 *
 * A Retry hands out a fresh set of rounds without resetting how many have run, so
 * the raw count legitimately passes the maximum; showing "round 4/3" would just
 * look broken. The total is what carries the real number.
 */
function clampCycle(cycle: number): number {
    return Math.min(Math.max(1, cycle), AUTOMATIC_ROUNDS);
}

function getProjectRoot(args: ValidationLoopArgs): string {
    const activeWorkflow = args.hostedSession.getActiveExecutionWorkflow?.() || null;
    const projectRoot = activeWorkflow?.projectRoot || args.executionContext?.projectRoot || args.hostedSession.cwd;
    if (!projectRoot) throw new Error("runValidationLoop: hostedSession or active workflow projectRoot is required");
    return projectRoot;
}

async function getDiffText(baselineTree: string | undefined, cwd: string): Promise<string> {
    return await getWorkflowDiff(cwd, baselineTree);
}

async function requestInteraction(args: ValidationLoopArgs, request: InteractionRequest): Promise<InteractionResponse> {
    return await requestHostedSessionInteraction(args.hostedSession, request);
}

async function recordMetric(
    _args: ValidationLoopArgs,
    cwd: string,
    metric: Parameters<typeof recordWorkflowMetric>[0],
): Promise<void> {
    await recordWorkflowMetric(metric, cwd);
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
    // Resolving a phase temporarily clears the active workflow while it verifies
    // the execution context. A successful boundary is still the same execution:
    // semantic review needs its Plan/worktree identity even when this is the first
    // pass and there is no repair ledger yet. Restoring only workflows that happened
    // to carry repair metadata stranded ordinary CI -> review transitions at the
    // session cwd with no active owner.
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
