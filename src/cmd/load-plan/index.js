/**
 * @module cmd/load-plan
 * Load-plan command implementation. Loads a saved plan from disk and continues
 * work on it (review/edit/execute), distinct from /resume which restores a
 * previous chat session.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { AGENTS, CLI_BIN, isPlannedChangeClassification } from "../../constants.js";
import {
    archivePlan as archivePlanFn,
    compareChildPlansByOrder,
    findPlansByParent as findPlansByParentFn,
    loadPlan as loadPlanFn,
    onboardExternalPlan,
    resolvePlan as resolvePlanFn,
    resolvePlanExecutionPolicy,
    resolveSiblingChildPlanDependencies as resolveSiblingChildPlanDependenciesFn,
    updatePlanFrontMatter as updatePlanFrontMatterFn,
} from "../../plan-store.js";
import {
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
} from "../../shared/workflow/decisions.js";
import { finalizePlanImplementation as finalizePlanImplementationFn } from "../../shared/workflow/workflow.js";
import {
    buildPlannerReReviewRequest,
    buildPlanSummary,
    buildReReviewRevisionRequest,
    buildResumeRequest,
    formatCommitHeadsUp,
} from "./plan-presentation.ts";
import { transitionFailureError } from "./transition-failure.ts";
import {
    handleOnHoldPlan,
    isHoldableStatus,
    isUserVerifiableStatus,
    markPlanUserVerified,
    putPlanOnHold,
} from "./plan-hold.ts";
import {
    buildEpicDoneEnoughSummary,
    buildEpicPlanSummary,
    confirmChildFeatureDependencies,
    formatChildPlanDescription,
    formatChildPlanLabel,
    formatEpicProgressSummary,
    formatNextChildLabel,
    formatTopLevelPlanOption,
    isActionableNextChild,
    isDecomposedEpicStatus,
    isDoneEnoughEpic,
} from "./plan-epic-children.ts";
import {
    appendRecoveryReport,
    assertRecoveryWorktreeIsManaged,
    canManuallyMergeRecoveredWorktree,
    confirmBaselineReset,
    confirmMetadataOnlyRecoveryCleanup,
    confirmMissingWorktreeRecreate,
    confirmRecoveryWorktreeAvailable,
    confirmWorktreeAction,
    getRecordedWorktreeRecreateBase,
    hasWorktreeContext,
    pathExists,
    persistRecoveredWorktreeMetadata,
    rehydrateActiveRecoveryWorkflow,
    reopenPlanForReview,
    reportInvalidRecoveryPolicy,
    resolveRecoveryWorktree,
} from "./plan-recovery-worktree.ts";
import { healSettledTransitionRecords } from "../../shared/workflow/transition-recovery.ts";
import {
    buildPlanEventUpdates,
    isEpicPlan,
    isExecutablePlanStatus,
    isInValidation,
    isPlanReviewableWithoutReopen,
    recordPlanEvent as recordPlanEventFn,
    stageValidationPassedInExecutionWorktree as stageValidationPassedInExecutionWorktreeFn,
} from "../../shared/workflow/plan-lifecycle.js";
import { normalizePlanApprovalAction, PLAN_APPROVAL_ACTIONS } from "../../shared/workflow/plan-approval.js";
import {
    appendSessionCompleteGuidance,
    requestRecoverablePlanReview,
    SESSION_COMPLETE_GUIDANCE,
} from "../../shared/workflow/plan-review-recovery.js";
import {
    getWorkflowDiff as getWorkflowDiffFn,
    listCommitsTouchingPathsSince as listCommitsTouchingPathsSinceFn,
    restoreWorktreeTree as restoreWorktreeTreeFn,
} from "../../shared/workflow/git-snapshot.js";
import {
    formatGitRequiredMessage,
    isGitRepositoryRequiredError,
    probeGitRepository as probeGitRepositoryFn,
} from "../../shared/git.js";
import { recordWorkflowMetric } from "../../shared/workflow/metrics.js";
import {
    closeTransitionRecordByAttestation,
    getTransitionJournalDir,
    runDirectDeliveryPublicationTransition,
    runRecoveryTransition,
} from "../../shared/workflow/state-transition.ts";
import { resolveValidationExecutionContext } from "../../shared/workflow/execution-context.js";
import {
    checkpointExecutionWorktree,
    createWorktreeGitArtifacts,
    deleteMergedWorktreeBranch,
    getBranchHead,
    getWorktreeStatus as getWorktreeStatusFn,
    inspectExecutionWorktreeMergeRisk as inspectExecutionWorktreeMergeRiskFn,
    isCommitAncestorOfBranch,
    mergeExecutionWorktree as mergeExecutionWorktreeFn,
    preparePrimaryPlanPathForMerge as preparePrimaryPlanPathForMergeFn,
    removeWorktreeGitArtifacts as removeWorktreeGitArtifactsFn,
    restorePrimaryPlanPathAfterMergeFailure as restorePrimaryPlanPathAfterMergeFailureFn,
    settleWorktreeAttempt,
} from "../../shared/worktree.js";
import {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
    removeEntry as removeWorktreeRegistryEntryFn,
    updateEntry as updateWorktreeRegistryEntryFn,
} from "../../shared/worktree-registry.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import { startInteractiveSession as startInteractiveSessionFn } from "../../ui/tui/chat-session.js";
import { shouldCleanupMergedWorktrees as shouldCleanupMergedWorktreesFn } from "../../shared/settings.js";
import {
    autoGenerateWorkRecordForCompletedPlan as autoGenerateWorkRecordForCompletedPlanFn,
    formatWorkRecordAutoGenerationResult,
} from "../../shared/work-records/auto-generation.js";
import { setTerminalTitleForName as setTerminalTitleForNameFn } from "../../ui/tui/terminal-title.js";
import { resetTuiState as resetTuiStateFn } from "../command-helpers.js";
import {
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../../shared/session/session-runtime-interactions.js";

export { getLoadPlanCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef LoadPlanTestDeps
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof resolvePlanFn} [resolvePlan]
 * @property {(options: Record<string, any>) => Promise<any>} [executePlan]
 * @property {(options: Record<string, any>) => Promise<any>} [runPlanningAgent]
 * @property {typeof decidePostPlanningFn} [decidePostPlanning]
 * @property {typeof decidePostExecutionFn} [decidePostExecution]
 * @property {(options: Record<string, any>) => Promise<any>} [runValidationLoop]
 * @property {(options: Record<string, any>) => Promise<any>} [runSlicerAgent]
 * @property {typeof finalizePlanImplementationFn} [finalizePlanImplementation]
 * @property {typeof loadPlanFn} [loadPlan]
 * @property {typeof archivePlanFn} [archivePlan]
 * @property {typeof getWorkflowDiffFn} [getWorkflowDiff]
 * @property {typeof listCommitsTouchingPathsSinceFn} [listCommitsTouchingPathsSince]
 * @property {typeof restoreWorktreeTreeFn} [restoreWorktreeTree]
 * @property {typeof resetTuiStateFn} [resetTuiState]
 * @property {() => string | null} [getRootAgentName]
 * @property {(cwd: string) => Promise<Array<{name: string, attrs: Partial<import('../../plan-store.js').PlanFrontMatter>}>>} [listPlans]
 * @property {typeof findPlansByParentFn} [findPlansByParent]
 * @property {typeof resolveSiblingChildPlanDependenciesFn} [resolveSiblingChildPlanDependencies]
 * @property {typeof findWorktreeByIdFn} [findWorktreeById]
 * @property {typeof findWorktreeByPlanNameFn} [findWorktreeByPlanName]
 * @property {typeof getWorktreeStatusFn} [getWorktreeStatus]
 * @property {typeof inspectExecutionWorktreeMergeRiskFn} [inspectExecutionWorktreeMergeRisk]
 * @property {typeof getBranchHead} [getBranchHead]
 * @property {typeof isCommitAncestorOfBranch} [isCommitAncestorOfBranch]
 * @property {typeof shouldCleanupMergedWorktreesFn} [shouldCleanupMergedWorktrees]
 * @property {typeof recordWorkflowMetric} [recordWorkflowMetric]
 * @property {typeof probeGitRepositoryFn} [probeGitRepository]
 * @property {typeof setTerminalTitleForNameFn} [setTerminalTitleForName]
 * @property {typeof autoGenerateWorkRecordForCompletedPlanFn} [autoGenerateWorkRecordForCompletedPlan]
 * @property {typeof resolveValidationExecutionContext} [resolveValidationExecutionContext]
 */

/** @typedef {import('./plan-session-types.ts').PlanSessionSurface} PlanSessionSurface */

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isManagedUnsupportedError(error) {
    return error instanceof Error ? error.message === "managed_unsupported" : String(error) === "managed_unsupported";
}

/**
 * @param {string | null} planName
 * @returns {string}
 */
function buildManagedUnsupportedLoadPlanMessage(planName) {
    const command = planName ? `${CLI_BIN} load-plan ${planName}` : `${CLI_BIN} load-plan <plan-name>`;
    return [
        "Cannot continue this Plan because the managed session could not be activated (managed_unsupported).",
        "The Plan was loaded for viewing, but RunWield could not attach the underlying agent session needed for Plan lifecycle actions such as resume planning, execution, validation, or workflow state updates.",
        `Try again from a fresh RunWield TUI or Workspace session with: ${command}`,
    ].join("\n");
}

/**
 * Build the command-local view of the public SessionRuntime surface. No core
 * session object or persistence manager crosses this boundary.
 *
 * @param {import('../../shared/session/session-runtime.js').SessionRuntime} runtime
 * @param {string} sessionId
 * @param {LoadPlanTestDeps} deps
 * @returns {PlanSessionSurface}
 */
function createPlanSessionSurface(runtime, sessionId, deps) {
    const snapshot = runtime.getSessionSnapshot(sessionId);
    if (!snapshot) throw new Error("load-plan requires an active runtime session");
    return {
        id: sessionId,
        cwd: snapshot.cwd,
        getActiveAgentName: () => runtime.getRuntimeActiveAgentName(sessionId),
        switchAgent: (agentName, options = {}) => runtime.switchAgent(sessionId, { agentName, ...options }),
        executePlan: (options) =>
            deps.executePlan ? /** @type {any} */ (deps.executePlan)(options) : runtime.executePlan(sessionId, options),
        runPlanningAgent: (options) =>
            deps.runPlanningAgent
                ? /** @type {any} */ (deps.runPlanningAgent)(options)
                : runtime.runPlanningAgent(sessionId, options),
        runValidation: (options) =>
            deps.runValidationLoop
                ? /** @type {any} */ (deps.runValidationLoop)(options)
                : runtime.runValidation(sessionId, options),
        runSlicerAgent: (options) =>
            deps.runSlicerAgent
                ? /** @type {any} */ (deps.runSlicerAgent)(options)
                : runtime.runSlicerAgent(sessionId, options),
        getActiveExecutionWorkflow: () => runtime.getRuntimeActiveExecutionWorkflow(sessionId),
        setActiveExecutionWorkflow: (workflow) => {
            runtime.setActiveExecutionWorkflow(sessionId, workflow);
        },
        clearActiveExecutionWorkflow: () => {
            runtime.clearActiveExecutionWorkflow(sessionId);
        },
        reviewPlan: async (meta) => {
            const response = await runtime.requestInteraction(sessionId, {
                type: RuntimeInteractionTypes.PLAN_REVIEW,
                prompt: `Review plan "${meta.planName}"`,
                _meta: { cwd: snapshot.cwd, ...meta },
            });
            const responseAny = /** @type {any} */ (response);
            const review = /** @type {any} */ (responseAny._meta || {});
            const hasReviewPayload = responseAny._meta && typeof responseAny._meta === "object" &&
                Object.keys(responseAny._meta).length > 0;
            const runtimeCanceled = response.outcome === RuntimeInteractionOutcomes.CANCELED && !hasReviewPayload;
            return {
                canceled: response.outcome === RuntimeInteractionOutcomes.CANCELED,
                cancellationReason: typeof review.cancellationReason === "string"
                    ? review.cancellationReason
                    : runtimeCanceled
                    ? "runtime_cancel"
                    : undefined,
                approved: review.approved === true,
                feedback: typeof review.feedback === "string" ? review.feedback : undefined,
                approvalAction: review.approvalAction,
                planAttrs: review.planAttrs && typeof review.planAttrs === "object"
                    ? /** @type {import('../../plan-store.js').PlanFrontMatter} */ (review.planAttrs)
                    : undefined,
                images: Array.isArray(review.images) ? review.images : undefined,
                remoteReview: review.remoteReview === true,
                reviewerUrl: typeof review.reviewerUrl === "string" ? review.reviewerUrl : undefined,
                spaceId: typeof review.spaceId === "string" ? review.spaceId : undefined,
                serverUrl: typeof review.serverUrl === "string" ? review.serverUrl : undefined,
                revision: typeof review.revision === "string" ? review.revision : undefined,
                reused: typeof review.reused === "boolean" ? review.reused : undefined,
                message: typeof response.message === "string" ? response.message : undefined,
            };
        },
        rename: (name) => {
            runtime.renameSession(sessionId, name);
        },
    };
}

/**
 * Restore the agent that owned the session before load-plan command work.
 *
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {string} agentName
 * @param {PlanSessionSurface} session
 * @returns {Promise<void>}
 */
async function restorePreviousAgentFlow(uiAPI, agentName, session) {
    resetTuiStateFn(undefined, uiAPI, undefined);
    const workflow = session.getActiveExecutionWorkflow?.() || null;
    const executionAgent = typeof workflow?.executionAgent === "string" ? workflow.executionAgent.trim() : "";
    if (executionAgent) {
        await session.switchAgent(executionAgent, { allowReturnToRouter: false });
        return;
    }
    await session.switchAgent(agentName);
}

/**
 * If a plan command was entered from Router, the plan owner should become the
 * follow-up agent. Otherwise restore the specialist the user was already using.
 *
 * @param {string} initialAgentName
 * @param {string} planAgentName
 * @returns {string}
 */
function selectPlanFlowRestoreAgent(initialAgentName, planAgentName) {
    return initialAgentName === AGENTS.ROUTER ? planAgentName : initialAgentName;
}

/**
 * Warn when affected paths have changed after the plan timestamp, and confirm
 * before execution starts.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @returns {Promise<boolean>}
 */
async function confirmAffectedPathChangesBeforeExecution({
    projectRoot,
    planName,
    triageMeta,
    uiAPI,
    listCommitsTouchingPathsSince,
}) {
    const affectedPaths = Array.isArray(triageMeta.affectedPaths) ? triageMeta.affectedPaths : [];
    const timestamp = triageMeta.updatedAt || triageMeta.createdAt;
    if (!timestamp || affectedPaths.length === 0) return true;

    let commits = [];
    try {
        commits = await listCommitsTouchingPathsSince(projectRoot, timestamp, affectedPaths);
    } catch (error) {
        if (isGitRepositoryRequiredError(error)) {
            uiAPI.appendSystemMessage(
                "Skipping affected path history check because this project is not a Git repository.",
                false,
                "RunWield",
            );
            return true;
        }
        const message = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(
            `Could not check affected path history before execution: ${message}`,
            true,
            "RunWield",
        );
        return true;
    }

    if (commits.length === 0) return true;

    const timestampLabel = triageMeta.updatedAt ? "updatedAt" : "createdAt";
    uiAPI.appendSystemMessage(
        [
            `Heads up: ${commits.length} commit(s) touched affected paths since this plan's ${timestampLabel} (${timestamp}).`,
            "",
            "Affected paths:",
            ...affectedPaths.map((path) => `  - ${path}`),
            "",
            "Commits:",
            ...formatCommitHeadsUp(commits),
        ].join("\n"),
        true,
        "RunWield",
    );

    const answer = await uiAPI.promptSelect(`Proceed with execution for "${planName}" anyway?`, [
        { value: "proceed", label: "Proceed with execution" },
        { value: "cancel", label: "Cancel" },
    ]);
    if (answer === "proceed") return true;
    uiAPI.appendSystemMessage("Execution canceled.", false, "RunWield");
    return false;
}

/**
 * @param {unknown} executionResult
 * @param {string} planName
 * @param {string} fallbackPlanContent
 * @param {import('../../plan-store.js').PlanFrontMatter} triageMeta
 * @param {PlanSessionSurface["runValidation"]} runValidationLoop
 * @param {typeof loadPlanFn} loadPlan
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {PlanSessionSurface} session
 * @param {import('../../ui/tui/types.js').UiAPI} [uiAPI]
 * @param {typeof finalizePlanImplementationFn} [finalizePlanImplementation]
 * @param {typeof recordPlanEventFn} [recordPlanEvent]
 * @param {typeof resolveValidationExecutionContext} [resolveValidationExecutionContextForRecovery]
 * @returns {Promise<boolean>}
 */
async function validateCompletedExecution(
    executionResult,
    planName,
    fallbackPlanContent,
    triageMeta,
    runValidationLoop,
    loadPlan,
    worktreeContext,
    session,
    uiAPI,
    finalizePlanImplementation = finalizePlanImplementationFn,
    recordPlanEvent = recordPlanEventFn,
    resolveValidationExecutionContextForRecovery = resolveValidationExecutionContext,
) {
    const projectRoot = session.cwd;
    if (!(executionResult && typeof executionResult === "object" && "executionComplete" in executionResult)) {
        return false;
    }
    if (!/** @type {{ executionComplete?: boolean }} */ (executionResult).executionComplete) return false;
    let planContent = fallbackPlanContent;
    let effectiveMeta = triageMeta;
    let latestPlan = null;
    try {
        latestPlan = await loadPlan(projectRoot, planName);
        planContent = latestPlan?.markdown || latestPlan?.body || fallbackPlanContent;
        if (latestPlan?.attrs) effectiveMeta = latestPlan.attrs;
    } catch {
        // Keep fallback content in tests or if the plan was removed.
    }
    const policy = resolvePlanExecutionPolicy(effectiveMeta);
    if (!policy.ok) {
        if (uiAPI) {
            reportInvalidRecoveryPolicy("validate", planName, policy.error, uiAPI);
            return false;
        }
        throw new Error(policy.error);
    }
    const returnedExecutionContext = /** @type {{ executionContext?: Record<string, unknown> }} */ (executionResult)
        .executionContext;
    const explicitContext = returnedExecutionContext || {
        planName,
        triageMeta: effectiveMeta,
        executionMode: effectiveMeta.executionMode,
        baselineTree: effectiveMeta.executionBaselineTree || worktreeContext?.executionBaselineTree ||
            worktreeContext?.baseTree || worktreeContext?.baseCommit,
        worktreeId: worktreeContext?.id || effectiveMeta.worktreeId,
        worktreeBranch: worktreeContext?.branch || effectiveMeta.worktreeBranch,
        worktreeBaseBranch: worktreeContext?.baseBranch || effectiveMeta.worktreeBaseBranch,
        worktreeBaseRef: worktreeContext?.baseRef,
        worktreeBaseCommit: worktreeContext?.baseCommit,
        executionCwd: worktreeContext?.path || effectiveMeta.worktreePath,
        nonGitInPlace: effectiveMeta.executionMode === "non_git_in_place",
    };
    /** @param {Record<string, unknown>} context */
    const buildWorkflow = (context) => {
        /** @type {{ planName: string, triageMeta: import('../../plan-store.js').PlanFrontMatter, executionAgent: "engineer"|"frontend-engineer", executionMode?: "worktree"|"non_git_in_place", baselineTree?: string, projectRoot: string, executionCwd?: string, worktreeId?: string, worktreeBranch?: string, worktreeBaseBranch?: string, worktreeBaseRef?: string, worktreeBaseCommit?: string, nonGitInPlace?: boolean, executionStarted: boolean }} */
        const workflow = {
            planName,
            triageMeta: effectiveMeta,
            executionAgent: /** @type {"engineer"|"frontend-engineer"} */ (policy.policy.executionAgent),
            executionMode: /** @type {"worktree"|"non_git_in_place"|undefined} */ (context.executionMode),
            projectRoot,
            executionCwd: typeof context.executionCwd === "string" ? context.executionCwd : undefined,
            executionStarted: true,
        };
        if (context.executionMode === "non_git_in_place") workflow.nonGitInPlace = true;
        if (context.executionMode === "worktree") {
            workflow.baselineTree = typeof context.baselineTree === "string" ? context.baselineTree : undefined;
            workflow.worktreeId = typeof context.worktreeId === "string" ? context.worktreeId : undefined;
            workflow.worktreeBranch = typeof context.worktreeBranch === "string" ? context.worktreeBranch : undefined;
            workflow.worktreeBaseBranch = typeof context.worktreeBaseBranch === "string"
                ? context.worktreeBaseBranch
                : undefined;
            workflow.worktreeBaseRef = typeof context.worktreeBaseRef === "string"
                ? context.worktreeBaseRef
                : undefined;
            workflow.worktreeBaseCommit = typeof context.worktreeBaseCommit === "string"
                ? context.worktreeBaseCommit
                : undefined;
        }
        return workflow;
    };
    const initialWorkflow = buildWorkflow(explicitContext);
    const needsImplementationCheckpoint = isPlannedChangeClassification(effectiveMeta.classification) &&
        effectiveMeta.status !== "implemented" &&
        effectiveMeta.status !== "verified" &&
        effectiveMeta.status !== "user_verified";
    if (needsImplementationCheckpoint) {
        const completionReport = /** @type {{ completionReport?: unknown }} */ (executionResult).completionReport;
        session.setActiveExecutionWorkflow(initialWorkflow);
        try {
            await finalizePlanImplementation({
                projectRoot,
                planName,
                triageMeta: effectiveMeta,
                executionContext: initialWorkflow,
                executionReport: typeof completionReport === "string" ? completionReport : undefined,
                __deps: { recordPlanEvent },
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (uiAPI) {
                uiAPI.appendSystemMessage(
                    `Validation blocked: implementation checkpoint failed before Workflow Validation: ${reason}`,
                    true,
                    "RunWield",
                );
                return false;
            }
            throw error;
        }
        try {
            latestPlan = await loadPlan(projectRoot, planName);
            planContent = latestPlan?.markdown || latestPlan?.body || fallbackPlanContent;
            if (latestPlan?.attrs) effectiveMeta = latestPlan.attrs;
        } catch {
            // Keep the pre-checkpoint content/metadata in tests or if the Plan was removed.
        }
    }
    const resolution = await resolveValidationExecutionContextForRecovery({
        projectRoot,
        planName,
        triageMeta: effectiveMeta,
        explicitContext,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    latestPlan || {
                        path: `plans/${planName}.md`,
                        markdown: planContent,
                        body: planContent,
                        attrs: effectiveMeta,
                    },
                ),
        },
    });
    if (resolution.kind === "blocked") {
        if (uiAPI) {
            uiAPI.appendSystemMessage(`Validation blocked: ${resolution.message}`, false, "RunWield");
            return false;
        }
        throw new Error(resolution.message);
    }
    if (resolution.restoredPlanFile && uiAPI) {
        uiAPI.appendSystemMessage(
            `Restored missing execution worktree Plan file from the canonical Project Plan: ${resolution.restoredPlanFile.relativePath}. Continuing Workflow Validation.`,
            false,
            "RunWield",
        );
    }
    for (const notice of resolution.selfHealNotices || []) {
        if (uiAPI) uiAPI.appendSystemMessage(notice, false, "RunWield");
    }
    const resolvedContext = resolution.context;
    const workflow = buildWorkflow(resolvedContext);
    session.setActiveExecutionWorkflow(workflow);
    await runValidationLoop({
        planName,
        planContent,
        triageMeta: effectiveMeta,
        executionContext: workflow,
    });
    for (let phase = 0; phase < 2; phase += 1) {
        const latestPlan = await loadPlan(resolvedContext.projectRoot, planName).catch(() => null);
        if (!latestPlan) break;
        const latestStatus = latestPlan.attrs?.status;
        if (latestStatus !== "validated_ci" && latestStatus !== "validated_reviewer") break;
        await runValidationLoop({
            planName,
            planContent: latestPlan.markdown || latestPlan.body || planContent,
            triageMeta: { ...effectiveMeta, ...latestPlan.attrs },
            executionContext: workflow,
        });
    }
    return true;
}

/**
 * @param {Object} opts
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} opts.executionDecision
 * @param {unknown} opts.executionResult
 * @param {string} opts.fallbackPlanContent
 * @param {PlanSessionSurface["runValidation"]} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {PlanSessionSurface} opts.session
 * @param {import('../../ui/tui/types.js').UiAPI} [opts.uiAPI]
 * @param {typeof finalizePlanImplementationFn} [opts.finalizePlanImplementation]
 * @param {typeof recordPlanEventFn} [opts.recordPlanEvent]
 * @param {typeof resolveValidationExecutionContext} [opts.resolveValidationExecutionContextForRecovery]
 * @returns {Promise<void>}
 */
async function validatePostExecutionDecision({
    executionDecision,
    executionResult,
    fallbackPlanContent,
    runValidationLoop,
    loadPlan,
    session,
    uiAPI,
    finalizePlanImplementation,
    recordPlanEvent,
    resolveValidationExecutionContextForRecovery,
}) {
    if (executionDecision.kind !== "run_validation") return;

    const planName = /** @type {string} */ (executionDecision.payload.planName);
    const triageMeta = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (
        executionDecision.payload.triageMeta
    );

    await validateCompletedExecution(
        executionResult,
        planName,
        fallbackPlanContent,
        triageMeta,
        runValidationLoop,
        loadPlan,
        null,
        session,
        uiAPI,
        finalizePlanImplementation,
        recordPlanEvent,
        resolveValidationExecutionContextForRecovery,
    );
}

/**
 * Execute an approved post-planning decision and run validation when execution
 * completes. Returns true when the decision was handled as execution.
 *
 * @param {Object} opts
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} opts.decision
 * @param {string} opts.fallbackPlanContent
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {PlanSessionSurface["executePlan"]} opts.executePlan
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {PlanSessionSurface["runValidation"]} opts.runValidationLoop
 * @param {PlanSessionSurface["runSlicerAgent"]} opts.runSlicerAgent
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {PlanSessionSurface} opts.session
 * @param {typeof finalizePlanImplementationFn} [opts.finalizePlanImplementation]
 * @param {typeof recordPlanEventFn} [opts.recordPlanEvent]
 * @param {typeof resolveValidationExecutionContext} [opts.resolveValidationExecutionContextForRecovery]
 * @returns {Promise<boolean>}
 */
async function executePostPlanningDecision({
    decision,
    fallbackPlanContent,
    uiAPI,
    executePlan,
    decidePostExecution,
    runValidationLoop,
    runSlicerAgent,
    loadPlan,
    listCommitsTouchingPathsSince,
    session,
    finalizePlanImplementation,
    recordPlanEvent,
    resolveValidationExecutionContextForRecovery,
}) {
    const projectRoot = session.cwd;
    if (decision.kind === "start_slicer") {
        await runSlicerAgent({
            planName: /** @type {string} */ (decision.payload.planName),
            triageMeta: /** @type {import('../../plan-store.js').PlanFrontMatter} */ (
                decision.payload.triageMeta
            ),
            reviewFeedback: /** @type {string | undefined} */ (decision.payload.reviewFeedback),
            reviewImages: /** @type {Array<{base64: string, mimeType: string}> | undefined} */ (
                decision.payload.reviewImages
            ),
        });
        return true;
    }
    if (decision.kind !== "execute_plan") return false;

    const planName = /** @type {string} */ (decision.payload.planName);
    const triageMeta = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (decision.payload.triageMeta);
    const confirmed = await confirmAffectedPathChangesBeforeExecution({
        projectRoot,
        planName,
        triageMeta,
        uiAPI,
        listCommitsTouchingPathsSince,
    });
    if (!confirmed) return true;

    const execRes = await executePlan({
        planName,
        triageMeta,
        reviewFeedback: /** @type {string | undefined} */ (decision.payload.reviewFeedback),
        reviewImages: /** @type {Array<{base64: string, mimeType: string}> | undefined} */ (
            decision.payload.reviewImages
        ),
    });
    const policy = resolvePlanExecutionPolicy(triageMeta);
    const executionDecision = decidePostExecution(execRes, {
        planName,
        triageMeta,
        executionAgentName: policy.ok ? policy.policy.executionAgent : AGENTS.ENGINEER,
    });
    await validatePostExecutionDecision({
        executionDecision,
        executionResult: execRes,
        fallbackPlanContent,
        runValidationLoop,
        loadPlan,
        session,
        uiAPI,
        finalizePlanImplementation,
        recordPlanEvent,
        resolveValidationExecutionContextForRecovery,
    });
    return true;
}

/**
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} decision
 * @returns {boolean}
 */
function shouldKeepPlanningAgentActive(decision) {
    return decision.kind === "stay_with_agent" || decision.kind === "start_slicer" || decision.kind === "halt";
}

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {boolean}
 */
function validatePlanExecutionPolicyForReadiness(plan, uiAPI) {
    const policy = resolvePlanExecutionPolicy(plan.attrs);
    if (!policy.ok && policy.reason !== "project_epic") {
        uiAPI.appendSystemMessage(`Plan policy invalid: ${policy.error}`, true, "RunWield");
        return false;
    }
    return true;
}

/**
 * Run the Readiness Gate for an approved Plan.
 *
 * @param {string} projectRoot
 * @param {{ planName: string, path: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {typeof recordPlanEventFn} recordPlanEvent
 * @returns {Promise<boolean>}
 */
async function prepareApprovedPlanForWork(projectRoot, plan, uiAPI, recordPlanEvent) {
    if (!validatePlanExecutionPolicyForReadiness(plan, uiAPI)) return false;
    if (isEpicPlan(plan.attrs)) {
        await recordPlanEvent({
            cwd: projectRoot,
            planName: plan.planName,
            event: "epic_readiness_passed",
            currentStatus: "approved",
            details: { triageMeta: plan.attrs },
        });
        plan.attrs.status = "ready_for_decomposition";
        uiAPI.appendSystemMessage(
            `PROJECT Epic ready for decomposition or child plan selection: ${plan.planName}`,
            false,
            "RunWield",
        );
        return false;
    }

    await recordPlanEvent({
        cwd: projectRoot,
        planName: plan.planName,
        event: "readiness_passed",
        currentStatus: "approved",
        details: { triageMeta: plan.attrs },
    });
    plan.attrs.status = "ready_for_work";
    return true;
}

/**
 * Execute a ready Plan and run validation if execution completes.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, markdown?: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {PlanSessionSurface["executePlan"]} opts.executePlan
 * @param {PlanSessionSurface["runPlanningAgent"]} opts.runPlanningAgent
 * @param {typeof decidePostPlanningFn} opts.decidePostPlanning
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {PlanSessionSurface["runValidation"]} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {PlanSessionSurface} opts.session
 * @param {typeof finalizePlanImplementationFn} [opts.finalizePlanImplementation]
 * @param {typeof recordPlanEventFn} [opts.recordPlanEvent]
 * @param {typeof resolveValidationExecutionContext} [opts.resolveValidationExecutionContextForRecovery]
 * @returns {Promise<void>}
 */
async function executeReadyPlanWithRepair({
    projectRoot,
    plan,
    agentName,
    executePlan,
    decidePostExecution,
    runValidationLoop,
    loadPlan,
    listCommitsTouchingPathsSince,
    session,
    uiAPI,
    finalizePlanImplementation,
    recordPlanEvent,
    resolveValidationExecutionContextForRecovery,
}) {
    const confirmed = await confirmAffectedPathChangesBeforeExecution({
        projectRoot,
        planName: plan.planName,
        triageMeta: plan.attrs,
        uiAPI,
        listCommitsTouchingPathsSince,
    });
    if (!confirmed) return;

    const execRes = await executePlan({
        planName: plan.planName,
        triageMeta: plan.attrs,
    });
    const policy = resolvePlanExecutionPolicy(plan.attrs);
    const executionOwner = policy.ok ? policy.policy.executionAgent : agentName;
    const executionDecision = decidePostExecution(execRes, {
        planName: plan.planName,
        triageMeta: /** @type {import('../../tools/plan-written.js').TriageMeta} */ (plan.attrs),
        executionAgentName: executionOwner,
    });
    await validatePostExecutionDecision({
        executionDecision,
        executionResult: execRes,
        fallbackPlanContent: plan.markdown || plan.body || "",
        runValidationLoop,
        loadPlan,
        session,
        uiAPI,
        finalizePlanImplementation,
        recordPlanEvent,
        resolveValidationExecutionContextForRecovery,
    });
}

/** @typedef {import('./plan-session-types.ts').RecoveryWorktreeContext} RecoveryWorktreeContext */

/**
 * Handle Plan Recovery menus for in-progress, failed, and implemented plans.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, path: string, markdown: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {Array<{ transitionId?: string, operation?: string, reason?: string }>} [opts.unresolvedRecords] - Lifecycle records RunWield could not prove; they block every other action until closed.
 * @param {PlanSessionSurface["executePlan"]} opts.executePlan
 * @param {PlanSessionSurface["runPlanningAgent"]} opts.runPlanningAgent
 * @param {typeof decidePostPlanningFn} opts.decidePostPlanning
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {PlanSessionSurface["runValidation"]} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof getWorkflowDiffFn} opts.getWorkflowDiff
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof restoreWorktreeTreeFn} opts.restoreWorktreeTree
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof stageValidationPassedInExecutionWorktreeFn} opts.stageValidationPassedInExecutionWorktree
 * @param {typeof updatePlanFrontMatterFn} opts.updatePlanFrontMatter
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof createWorktreeGitArtifacts} opts.createWorktreeGitArtifacts
 * @param {typeof settleWorktreeAttempt} opts.settleWorktreeAttempt
 * @param {typeof mergeExecutionWorktreeFn} opts.mergeExecutionWorktree
 * @param {typeof checkpointExecutionWorktree} opts.checkpointExecutionWorktree
 * @param {typeof getBranchHead} opts.getBranchHead
 * @param {typeof isCommitAncestorOfBranch} opts.isCommitAncestorOfBranch
 * @param {typeof preparePrimaryPlanPathForMergeFn} opts.preparePrimaryPlanPathForMerge
 * @param {typeof restorePrimaryPlanPathAfterMergeFailureFn} opts.restorePrimaryPlanPathAfterMergeFailure
 * @param {typeof removeWorktreeGitArtifactsFn} opts.removeWorktreeGitArtifacts
 * @param {typeof removeWorktreeRegistryEntryFn} opts.removeWorktreeRegistryEntry
 * @param {typeof shouldCleanupMergedWorktreesFn} opts.shouldCleanupMergedWorktrees
 * @param {typeof recordWorkflowMetric} [opts.recordWorkflowMetric]
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {PlanSessionSurface} opts.session
 * @param {typeof probeGitRepositoryFn} [opts.probeGitRepository]
 * @param {typeof finalizePlanImplementationFn} [opts.finalizePlanImplementation]
 * @param {typeof resolveValidationExecutionContext} [opts.resolveValidationExecutionContextForRecovery]
 * @param {typeof autoGenerateWorkRecordForCompletedPlanFn} [opts.autoGenerateWorkRecordForCompletedPlan]
 * @returns {Promise<"handled" | "review">}
 */
async function handlePlanRecovery({
    projectRoot,
    plan,
    agentName,
    uiAPI,
    unresolvedRecords: initialUnresolvedRecords = [],
    executePlan,
    runPlanningAgent,
    decidePostPlanning,
    decidePostExecution,
    runValidationLoop,
    loadPlan,
    getWorkflowDiff,
    listCommitsTouchingPathsSince,
    restoreWorktreeTree,
    recordPlanEvent,
    stageValidationPassedInExecutionWorktree,
    updatePlanFrontMatter,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    getWorktreeStatus,
    createWorktreeGitArtifacts,
    settleWorktreeAttempt,
    mergeExecutionWorktree,
    checkpointExecutionWorktree,
    getBranchHead,
    isCommitAncestorOfBranch,
    preparePrimaryPlanPathForMerge,
    restorePrimaryPlanPathAfterMergeFailure,
    removeWorktreeGitArtifacts,
    removeWorktreeRegistryEntry,
    shouldCleanupMergedWorktrees,
    recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric,
    findPlansByParent,
    session,
    probeGitRepository = probeGitRepositoryFn,
    finalizePlanImplementation = finalizePlanImplementationFn,
    resolveValidationExecutionContextForRecovery = resolveValidationExecutionContext,
    autoGenerateWorkRecordForCompletedPlan = autoGenerateWorkRecordForCompletedPlanFn,
}) {
    const initialPolicy = resolvePlanExecutionPolicy(plan.attrs);
    const loadedWorktreeId = plan.attrs.worktreeId;
    if (!initialPolicy.ok && initialPolicy.reason !== "project_epic") {
        reportInvalidRecoveryPolicy("recover", plan.planName, initialPolicy.error, uiAPI);
        return "handled";
    }

    const refreshRecoveryWorktree = async () => {
        const resolved = await resolveRecoveryWorktree(projectRoot, plan, { findWorktreeById, findWorktreeByPlanName });
        plan.attrs = await persistRecoveredWorktreeMetadata(projectRoot, plan, resolved);
        return resolved;
    };
    let worktreeContext = await refreshRecoveryWorktree();
    /** @type {Array<{ transitionId?: string, operation?: string, reason?: string }>} */
    let unresolvedRecords = initialUnresolvedRecords;
    /**
     * @param {string} action
     * @param {string} result
     * @param {Record<string, unknown>} [details]
     */
    const recordRecoveryResult = async (action, result, details = {}) => {
        const hasWorktree = hasWorktreeContext(worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(worktreeContext);
        await recordWorkflowMetricImpl({
            category: "recovery",
            event: "recovery_action_result",
            planName: plan.planName,
            details: { action, result, currentStatus: plan.attrs.status, hasWorktree, canMergeWorktree, ...details },
        });
    };
    while (true) {
        const hasWorktree = hasWorktreeContext(worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(worktreeContext);
        const gitProbe = await probeGitRepository(projectRoot);
        const hasGitRecoveryMetadata = hasWorktree ||
            (plan.attrs.executionMode !== "non_git_in_place" && Boolean(plan.attrs.executionBaselineTree));
        const gitRecoveryBlocked = !gitProbe.ok && hasGitRecoveryMetadata;
        const resetLabel = gitRecoveryBlocked
            ? "Clear stale Git recovery metadata"
            : hasWorktree
            ? "Delete/recreate worktree and start over"
            : "Reset tree and start over";
        // A Plan whose only problem is an unprovable record must not be offered the
        // ordinary actions first: every one of them re-hits the same block, so the
        // user loops. Lead with the thing that clears it.
        const recordOptions = unresolvedRecords.length > 0
            ? [{
                value: "settle_records",
                label: `Close ${
                    unresolvedRecords.length === 1 ? "the unfinished lifecycle record" : "unfinished lifecycle records"
                } (you confirm the state)`,
            }]
            : [];
        const options = isInValidation(plan.attrs.status)
            ? [
                ...recordOptions,
                ...(gitRecoveryBlocked ? [] : [{ value: "validate", label: "Retry Workflow Validation" }]),
                { value: "inspect", label: "Inspect and report current state" },
                ...(canMergeWorktree && !gitRecoveryBlocked
                    ? [{ value: "merge", label: "Merge validated worktree changes" }]
                    : []),
                { value: "reset", label: resetLabel },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                {
                    value: "user_verify",
                    label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                },
                { value: "hold", label: "Put on hold" },
                { value: "cancel", label: "Cancel" },
            ]
            : [
                ...recordOptions,
                { value: "inspect", label: "Inspect and report current state" },
                ...(gitRecoveryBlocked
                    ? []
                    : [{ value: "continue", label: "Continue execution from current worktree" }]),
                { value: "reset", label: resetLabel },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                {
                    value: "user_verify",
                    label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                },
                { value: "hold", label: "Put on hold" },
                { value: "cancel", label: "Cancel" },
            ];

        const answer = await uiAPI.promptSelect(`Plan recovery (${plan.attrs.status}):`, options);
        await recordWorkflowMetricImpl({
            category: "recovery",
            event: "recovery_action_selected",
            planName: plan.planName,
            details: {
                action: answer || "cancel",
                currentStatus: plan.attrs.status,
                hasWorktree,
                canMergeWorktree,
            },
        });
        if (!answer || answer === "cancel") {
            await recordRecoveryResult("cancel", "handled");
            return "handled";
        }

        if (answer === "settle_records") {
            // Try proof one more time first: the blocker may have been a worktree that
            // has since been restored, and RunWield should never ask the user to vouch
            // for something it can now check itself.
            const recheck = await healSettledTransitionRecords(projectRoot, { planName: plan.planName, apply: true })
                .catch(() => null);
            unresolvedRecords = recheck ? recheck.remaining : unresolvedRecords;
            if (recheck && recheck.closed.length > 0) {
                uiAPI.appendSystemMessage(
                    `Closed ${recheck.closed.length} lifecycle record${
                        recheck.closed.length === 1 ? "" : "s"
                    } that the repository now proves are settled.`,
                    false,
                    "RunWield",
                );
            }
            if (unresolvedRecords.length === 0) {
                await recordRecoveryResult("settle_records", "handled", { byProof: true });
                continue;
            }
            for (const record of unresolvedRecords) {
                uiAPI.appendSystemMessage(
                    `Unfinished ${record.operation || "lifecycle operation"} on ${plan.planName}: ${record.reason}`,
                    false,
                    "RunWield",
                );
            }
            const confirmed = await uiAPI.promptSelect(
                `Close ${unresolvedRecords.length === 1 ? "this record" : "these records"} on your confirmation?`,
                [
                    { value: "no", label: "No, leave them (check the state first)" },
                    { value: "yes", label: "Yes — I have checked the repository and nothing is unpublished" },
                ],
            );
            if (confirmed !== "yes") {
                await recordRecoveryResult("settle_records", "declined");
                continue;
            }
            for (const record of unresolvedRecords) {
                if (!record.transitionId) continue;
                await closeTransitionRecordByAttestation(projectRoot, record.transitionId, {
                    note: `Closed from Plan Recovery for ${plan.planName}.`,
                });
            }
            unresolvedRecords = [];
            uiAPI.appendSystemMessage(
                `Closed on your confirmation. The records were kept, not deleted — they are under ${
                    getTransitionJournalDir(projectRoot)
                }/attested if you need to look back. Lifecycle changes to ${plan.planName} are unblocked.`,
                false,
                "RunWield",
            );
            await recordRecoveryResult("settle_records", "handled", { byAttestation: true });
            continue;
        }

        if (answer === "hold") {
            await putPlanOnHold({ projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent });
            await recordRecoveryResult("hold", "handled");
            return "handled";
        }

        if (answer === "user_verify") {
            await markPlanUserVerified({
                projectRoot,
                plan,
                uiAPI,
                recordPlanEvent,
                autoGenerateWorkRecordForCompletedPlan,
            });
            await recordRecoveryResult("user_verify", "handled");
            return "handled";
        }

        if (gitRecoveryBlocked && ["continue", "validate", "merge"].includes(answer)) {
            uiAPI.appendSystemMessage(
                `Cannot ${answer} this Plan recovery state because Git is not available for the project. Git is required for recorded Worktree/baseline recovery operations. Use metadata-only reset or abandon cleanup, or initialize Git and try again.`,
                true,
                "RunWield",
            );
            await recordRecoveryResult(answer, "blocked", { gitState: gitProbe.state });
            continue;
        }

        if (answer === "inspect") {
            worktreeContext = await refreshRecoveryWorktree();
            await appendRecoveryReport(projectRoot, plan, uiAPI, getWorkflowDiff, worktreeContext, getWorktreeStatus);
            await recordRecoveryResult("inspect", "reported", { hasWorktree: hasWorktreeContext(worktreeContext) });
            continue;
        }

        if (answer === "validate") {
            worktreeContext = await refreshRecoveryWorktree();
            if (
                !(await confirmRecoveryWorktreeAvailable(
                    projectRoot,
                    plan.planName,
                    worktreeContext,
                    uiAPI,
                    getWorktreeStatus,
                ))
            ) {
                continue;
            }
            const validationStarted = await validateCompletedExecution(
                { executionComplete: true },
                plan.planName,
                plan.markdown || plan.body || "",
                plan.attrs,
                runValidationLoop,
                loadPlan,
                worktreeContext,
                session,
                uiAPI,
                finalizePlanImplementation,
                recordPlanEvent,
                resolveValidationExecutionContextForRecovery,
            );
            if (!validationStarted) {
                await recordRecoveryResult("validate", "blocked", { reason: "invalid_execution_policy" });
                continue;
            }
            await recordRecoveryResult("validate", "handled");
            return "handled";
        }

        if (answer === "continue") {
            worktreeContext = await refreshRecoveryWorktree();
            if (
                plan.attrs.executionMode !== "non_git_in_place" &&
                !(await confirmRecoveryWorktreeAvailable(
                    projectRoot,
                    plan.planName,
                    worktreeContext,
                    uiAPI,
                    getWorktreeStatus,
                ))
            ) {
                continue;
            }
            if (
                !(await rehydrateActiveRecoveryWorkflow(projectRoot, plan, worktreeContext, session, uiAPI, "continue"))
            ) {
                await recordRecoveryResult("continue", "blocked", { reason: "invalid_execution_policy" });
                continue;
            }
            await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "recovery_continue",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "ready_for_work";
            await executeReadyPlanWithRepair({
                projectRoot,
                plan,
                agentName,
                uiAPI,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                listCommitsTouchingPathsSince,
                session,
                finalizePlanImplementation,
                recordPlanEvent,
                resolveValidationExecutionContextForRecovery,
            });
            await recordRecoveryResult("continue", "handled");
            return "handled";
        }

        if (answer === "reset") {
            const hasWorktree = hasWorktreeContext(worktreeContext);
            if (!hasWorktree && !plan.attrs.executionBaselineTree) {
                uiAPI.appendSystemMessage(
                    "Cannot reset this plan because no execution baseline tree is recorded.",
                    true,
                    "RunWield",
                );
                continue;
            }
            if (gitRecoveryBlocked) {
                if (!(await confirmMetadataOnlyRecoveryCleanup(plan.planName, uiAPI))) continue;
                const transition = await runRecoveryTransition({
                    projectRoot,
                    planName: plan.planName,
                    planId: plan.attrs.planId,
                    worktreeId: worktreeContext?.id,
                    expectedRevision: /** @type {{ revision?: string }} */ (plan).revision,
                    action: "reset",
                    recover: async ({ beforePlan }) => {
                        if (worktreeContext?.id) {
                            await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
                        }
                        const resetUpdates = buildPlanEventUpdates("recovery_reset", plan.attrs.status, {
                            triageMeta: plan.attrs,
                        });
                        return await updatePlanFrontMatter(
                            projectRoot,
                            plan.planName,
                            {
                                ...resetUpdates,
                                status: "ready_for_work",
                                executionBaselineTree: null,
                                worktreeId: null,
                                worktreePath: null,
                                worktreeBranch: null,
                                worktreeBaseBranch: null,
                                worktreeStatus: null,
                            },
                            plan.attrs,
                            { expectedRevision: beforePlan?.revision },
                        );
                    },
                });
                if (transition.status !== "committed") {
                    throw transitionFailureError(transition, `Recovery reset transaction failed for ${plan.planName}.`);
                }
                const transitionValue =
                    /** @type {{ value?: import('../../plan-store.js').PlanFrontMatter }} */ (transition.value || {});
                plan.attrs = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (transitionValue.value);
                worktreeContext = null;
                uiAPI.appendSystemMessage(
                    "Cleared stale Git recovery metadata. No project files or recorded paths were modified; the plan is ready for work.",
                    false,
                    "RunWield",
                );
                await recordRecoveryResult("reset", "metadata_only", { gitState: gitProbe.state });
                return "handled";
            }
            if (hasWorktree) {
                const recreateBaseRef = getRecordedWorktreeRecreateBase(worktreeContext);
                if (!recreateBaseRef) {
                    uiAPI.appendSystemMessage(
                        "Cannot recreate this worktree because no recorded base commit or base ref is available. Retry Workflow Validation or re-open the plan for review instead of recreating from the primary checkout.",
                        true,
                        "RunWield",
                    );
                    continue;
                }
                const recordedPathExists = await pathExists(worktreeContext?.path);
                const confirmed = recordedPathExists
                    ? await confirmWorktreeAction(plan.planName, uiAPI, "Delete/recreate")
                    : await confirmMissingWorktreeRecreate(plan.planName, worktreeContext, uiAPI);
                if (!confirmed) continue;
                const recreateBaseBranch = worktreeContext?.baseBranch;
                let recreated;
                try {
                    const transition = await runRecoveryTransition({
                        projectRoot,
                        planName: plan.planName,
                        planId: plan.attrs.planId,
                        worktreeId: worktreeContext?.id,
                        expectedRevision: /** @type {{ revision?: string }} */ (plan).revision,
                        action: "recreate",
                        recover: async ({ beforePlan, markEffect, registerRollback }) => {
                            if (worktreeContext?.path) {
                                await removeWorktreeGitArtifacts({
                                    projectRoot: projectRoot,
                                    path: worktreeContext.path,
                                    force: true,
                                });
                                // Deleting the branch is irreversible, so it is its own proven step.
                                if (worktreeContext.branch) {
                                    await deleteMergedWorktreeBranch({ projectRoot, branch: worktreeContext.branch });
                                }
                            }
                            if (worktreeContext?.id) {
                                await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, {
                                    status: "abandoned",
                                });
                            }
                            const nextWorktree = await createWorktreeGitArtifacts({
                                projectRoot: projectRoot,
                                planName: plan.planName,
                                planId: /** @type {string} */ (plan.attrs.planId),
                                baseRef: recreateBaseRef,
                                baseBranch: recreateBaseBranch,
                            });
                            await markEffect("recovery_recreate_git_worktree_created", {
                                worktreeId: nextWorktree.id,
                                path: nextWorktree.path,
                                branch: nextWorktree.branch,
                                baseCommit: nextWorktree.baseCommit,
                            });
                            registerRollback("remove recreated recovery worktree", async () => {
                                await removeWorktreeGitArtifacts({
                                    projectRoot: projectRoot,
                                    path: nextWorktree.path,
                                    force: true,
                                });
                                // Deleting the branch is irreversible, so it is its own proven step.
                                if (nextWorktree.branch) {
                                    await deleteMergedWorktreeBranch({ projectRoot, branch: nextWorktree.branch });
                                }
                            });
                            await settleWorktreeAttempt(projectRoot, nextWorktree);
                            registerRollback("abandon recreated recovery registry entry", async () => {
                                await updateWorktreeRegistryEntry(projectRoot, nextWorktree.id, {
                                    status: "abandoned",
                                });
                            });
                            await markEffect("recovery_recreate_registry_settled", {
                                worktreeId: nextWorktree.id,
                                path: nextWorktree.path,
                                branch: nextWorktree.branch,
                            });
                            const writeRecoveredWorktreeMetadata = updatePlanFrontMatter;
                            const attrs = await writeRecoveredWorktreeMetadata(
                                projectRoot,
                                plan.planName,
                                {
                                    worktreeId: nextWorktree.id,
                                    worktreePath: nextWorktree.path,
                                    worktreeBranch: nextWorktree.branch,
                                    worktreeBaseBranch: nextWorktree.baseBranch,
                                    worktreeStatus: "active",
                                    executionBaselineTree: nextWorktree.baseTree,
                                },
                                plan.attrs,
                                { expectedRevision: beforePlan?.revision },
                            );
                            return { attrs, worktree: nextWorktree };
                        },
                    });
                    if (transition.status !== "committed") {
                        throw new Error(
                            transition.message || `Recovery recreate transaction failed for ${plan.planName}.`,
                        );
                    }
                    const transitionValue =
                        /** @type {{ value?: { attrs: import('../../plan-store.js').PlanFrontMatter, worktree: RecoveryWorktreeContext } }} */ (transition
                            .value || {});
                    plan.attrs =
                        /** @type {import('../../plan-store.js').PlanFrontMatter} */ (transitionValue.value?.attrs);
                    recreated = transitionValue.value?.worktree;
                    if (!recreated) {
                        throw new Error(`Recovery recreate transaction returned no worktree for ${plan.planName}.`);
                    }
                    const refreshedPlan = await loadPlan(projectRoot, plan.planName);
                    if (refreshedPlan?.revision) {
                        plan.attrs = refreshedPlan.attrs;
                        /** @type {{ revision?: string }} */ (plan).revision = refreshedPlan.revision;
                    }
                } catch (error) {
                    const message = isGitRepositoryRequiredError(error)
                        ? formatGitRequiredMessage(error)
                        : error instanceof Error
                        ? error.message
                        : String(error);
                    uiAPI.appendSystemMessage(
                        `Cannot recreate the recorded worktree: ${message}`,
                        true,
                        "RunWield",
                    );
                    continue;
                }
                worktreeContext = {
                    id: recreated.id,
                    path: recreated.path,
                    branch: recreated.branch,
                    baseBranch: recreated.baseBranch,
                    status: recreated.status,
                    baseRef: recreated.baseRef,
                    baseCommit: recreated.baseCommit,
                    baseTree: recreated.baseTree,
                };
            } else {
                if (!(await confirmBaselineReset(plan.planName, uiAPI))) continue;
                try {
                    await restoreWorktreeTree(projectRoot, /** @type {string} */ (plan.attrs.executionBaselineTree));
                } catch (error) {
                    const message = isGitRepositoryRequiredError(error)
                        ? formatGitRequiredMessage(error)
                        : error instanceof Error
                        ? error.message
                        : String(error);
                    uiAPI.appendSystemMessage(`Cannot reset baseline tree: ${message}`, true, "RunWield");
                    continue;
                }
            }
            const resetTransition = await runRecoveryTransition({
                projectRoot,
                planName: plan.planName,
                planId: plan.attrs.planId,
                worktreeId: worktreeContext?.id,
                expectedRevision: /** @type {{ revision?: string }} */ (plan).revision,
                action: "reset",
                recover: async () =>
                    await recordPlanEvent({
                        cwd: projectRoot,
                        planName: plan.planName,
                        event: "recovery_reset",
                        currentStatus: plan.attrs.status,
                        details: { triageMeta: plan.attrs },
                    }),
            });
            if (resetTransition.status !== "committed") {
                throw transitionFailureError(
                    resetTransition,
                    `Recovery reset transaction failed for ${plan.planName}.`,
                );
            }
            const resetTransitionValue =
                /** @type {{ value?: import('../../plan-store.js').PlanFrontMatter }} */ (resetTransition.value || {});
            plan.attrs = { ...plan.attrs, ...resetTransitionValue.value, status: "ready_for_work" };
            await executeReadyPlanWithRepair({
                projectRoot,
                plan,
                agentName,
                uiAPI,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                listCommitsTouchingPathsSince,
                session,
                finalizePlanImplementation,
                recordPlanEvent,
                resolveValidationExecutionContextForRecovery,
            });
            await recordRecoveryResult("reset", "handled");
            return "handled";
        }

        if (answer === "merge") {
            worktreeContext = await refreshRecoveryWorktree();
            if (!canManuallyMergeRecoveredWorktree(worktreeContext)) {
                uiAPI.appendSystemMessage(
                    "Manual worktree merge is only available after Workflow Validation passed but merge-back failed. Retry Workflow Validation first.",
                    true,
                    "RunWield",
                );
                continue;
            }
            if (
                !(await confirmRecoveryWorktreeAvailable(
                    projectRoot,
                    plan.planName,
                    worktreeContext,
                    uiAPI,
                    getWorktreeStatus,
                ))
            ) {
                continue;
            }
            if (!worktreeContext?.branch || !worktreeContext.path) {
                uiAPI.appendSystemMessage(
                    "Cannot merge because no worktree branch or path is recorded.",
                    true,
                    "RunWield",
                );
                continue;
            }
            if (!loadedWorktreeId) {
                uiAPI.appendSystemMessage(
                    `Cannot merge recovered worktree ${worktreeContext.branch} because the loaded Plan did not contain a canonical worktreeId. Retry Workflow Validation; RunWield will not publish Delivery Evidence from branch-name recovery alone.`,
                    true,
                    "RunWield",
                );
                await recordRecoveryResult("merge", "blocked", { reason: "missing_canonical_worktree_id" });
                continue;
            }
            if (!worktreeContext.baseBranch) {
                uiAPI.appendSystemMessage(
                    `Cannot merge recovered worktree ${worktreeContext.branch} because no concrete target branch is recorded. Run Workflow Validation or reset recovery metadata; RunWield will not publish Delivery Evidence with an ambiguous target.`,
                    true,
                    "RunWield",
                );
                await recordRecoveryResult("merge", "blocked", { reason: "missing_target_branch" });
                continue;
            }
            const manualResolution = await resolveValidationExecutionContextForRecovery({
                projectRoot,
                planName: plan.planName,
                triageMeta: plan.attrs,
                explicitContext: {
                    planName: plan.planName,
                    triageMeta: plan.attrs,
                    executionMode: plan.attrs.executionMode,
                    baselineTree: plan.attrs.executionBaselineTree,
                    worktreeId: loadedWorktreeId,
                    worktreeBranch: plan.attrs.worktreeBranch,
                    worktreeBaseBranch: plan.attrs.worktreeBaseBranch,
                    executionCwd: plan.attrs.worktreePath,
                },
                __deps: {
                    loadPlan: () =>
                        Promise.resolve({
                            path: /** @type {any} */ (plan).path || `plans/${plan.planName}.md`,
                            markdown: /** @type {any} */ (plan).markdown || /** @type {any} */ (plan).body || "",
                            body: /** @type {any} */ (plan).body || "",
                            attrs: plan.attrs,
                        }),
                    findWorktreeRegistryEntryById: findWorktreeById,
                },
            });
            if (manualResolution.kind === "blocked") {
                uiAPI.appendSystemMessage(
                    `Cannot merge recovered worktree because validation context proof failed: ${manualResolution.message}`,
                    true,
                    "RunWield",
                );
                await recordRecoveryResult("merge", "blocked", { reason: manualResolution.reason });
                continue;
            }
            if (manualResolution.restoredPlanFile) {
                uiAPI.appendSystemMessage(
                    `Restored missing execution worktree Plan file from the canonical Project Plan: ${manualResolution.restoredPlanFile.relativePath}. Continuing Workflow Validation.`,
                    false,
                    "RunWield",
                );
            }
            for (const notice of manualResolution.selfHealNotices || []) {
                uiAPI.appendSystemMessage(notice, false, "RunWield");
            }
            const manualContext = manualResolution.context;
            if (manualContext.executionMode !== "worktree") {
                uiAPI.appendSystemMessage(
                    "Cannot merge recovered worktree because the resolved validation context is not a worktree execution.",
                    true,
                    "RunWield",
                );
                await recordRecoveryResult("merge", "blocked", { reason: "not_worktree_execution" });
                continue;
            }
            const manualWorktreePath = manualContext.executionCwd;
            const manualWorktreeBranch = manualContext.worktreeBranch;
            const manualTargetBranch = manualContext.worktreeBaseBranch;
            if (!manualWorktreePath || !manualWorktreeBranch || !manualTargetBranch) {
                uiAPI.appendSystemMessage(
                    "Cannot merge recovered worktree because resolved validation context is missing path, branch, or target branch.",
                    true,
                    "RunWield",
                );
                await recordRecoveryResult("merge", "blocked", { reason: "incomplete_resolved_worktree_context" });
                continue;
            }
            /** @type {Awaited<ReturnType<typeof preparePrimaryPlanPathForMergeFn>>[]} */
            const primaryPlanSnapshots = [];
            /** @type {import('../../plan-store.js').WorktreeDeliveryEvidence | undefined} */
            let manualDeliveryEvidence;
            let mergeCompleted = false;
            const cleanupMergedWorktrees = shouldCleanupMergedWorktrees(projectRoot);
            const mergeWorktreeId = worktreeContext?.id;
            try {
                // Publication runs as one transaction, the same as inside Workflow
                // Validation. As bare choreography this path moved the target ref with no
                // lock, no journal and no sibling fencing, so a crash mid-merge left
                // nothing for `wld plans doctor` to find, and an Epic-completing child
                // could publish against sibling evidence nobody rechecked.
                const siblingPlanNames = typeof plan.attrs.parentPlan === "string" && plan.attrs.parentPlan
                    ? (await findPlansByParent(projectRoot, plan.attrs.parentPlan)).map((child) => child.name).sort()
                    : [];
                const publication = await runDirectDeliveryPublicationTransition({
                    projectRoot,
                    planName: plan.planName,
                    planId: plan.attrs.planId,
                    worktreeId: mergeWorktreeId || undefined,
                    targetRef: manualTargetBranch,
                    expectedRevision: /** @type {{ revision?: string }} */ (plan).revision,
                    parentPlan: typeof plan.attrs.parentPlan === "string" && plan.attrs.parentPlan
                        ? plan.attrs.parentPlan
                        : undefined,
                    siblingPlanNames,
                    publicationProof: { phase: "manual_recovery_merge", worktreeBranch: manualWorktreeBranch },
                    publish: async ({ markEffect, registerRollback }) => {
                        const planPath = `plans/${plan.planName}.md`;
                        /** @type {import('../../plan-store.js').WorktreeDeliveryEvidence} */
                        let deliveryEvidence;
                        if (plan.attrs.deliveryEvidence?.mode === "worktree_merge") {
                            deliveryEvidence = plan.attrs.deliveryEvidence;
                        } else {
                            const executionPlan = await loadPlan(manualWorktreePath, plan.planName);
                            if (executionPlan?.attrs.deliveryEvidence?.mode === "worktree_merge") {
                                deliveryEvidence = executionPlan.attrs.deliveryEvidence;
                            } else {
                                const sealedCandidate = await checkpointExecutionWorktree({
                                    worktreePath: manualWorktreePath,
                                    branch: manualWorktreeBranch,
                                    planName: plan.planName,
                                    planDescription: plan.attrs.summary,
                                });
                                const targetBranchForEvidence = manualTargetBranch;
                                const targetHeadBeforeMerge = await getBranchHead(projectRoot, targetBranchForEvidence);
                                deliveryEvidence = {
                                    version: 1,
                                    mode: "worktree_merge",
                                    executionCommit: sealedCandidate.executionCommit,
                                    targetBranch: targetBranchForEvidence,
                                    targetHeadBeforeMerge,
                                };
                            }
                        }
                        manualDeliveryEvidence = deliveryEvidence;
                        const stagingResult = await stageValidationPassedInExecutionWorktree({
                            projectRoot: projectRoot,
                            executionCwd: manualWorktreePath,
                            planName: plan.planName,
                            details: {
                                triageMeta: plan.attrs,
                                executionMode: "worktree",
                                deliveryEvidence,
                                worktreeStatus: "merged",
                                cleanupMergedWorktrees,
                            },
                        });
                        for (const relativePath of stagingResult.planPaths) {
                            primaryPlanSnapshots.push(
                                await preparePrimaryPlanPathForMerge({ projectRoot: projectRoot, relativePath }),
                            );
                        }
                        if (primaryPlanSnapshots.length > 0) {
                            // Undo the staged primary Plan paths if publication fails before the
                            // target ref moves, and clear the list so the handler below does not
                            // restore them a second time.
                            registerRollback("restore_primary_plan_snapshots", async () => {
                                if (mergeCompleted) return;
                                for (const snapshot of primaryPlanSnapshots.toReversed()) {
                                    await restorePrimaryPlanPathAfterMergeFailure(snapshot);
                                }
                                primaryPlanSnapshots.splice(0, primaryPlanSnapshots.length);
                            });
                        }
                        uiAPI.appendSystemMessage(
                            `Merging worktree branch ${manualWorktreeBranch} into target branch ${manualTargetBranch}.`,
                        );
                        const mergeResult = await mergeExecutionWorktree({
                            projectRoot: projectRoot,
                            branch: manualWorktreeBranch,
                            targetBranch: manualTargetBranch,
                            worktreePath: manualWorktreePath,
                            expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                            planName: plan.planName,
                            planDescription: plan.attrs.summary,
                            sealedExecutionCommit: deliveryEvidence.executionCommit,
                            allowedDirtyPaths: stagingResult.planPaths.length > 0
                                ? stagingResult.planPaths
                                : [planPath],
                            preservePlanPaths: stagingResult.planPaths,
                        });
                        mergeCompleted = true;
                        await markEffect("direct_delivery_target_ref_moved", {
                            planName: plan.planName,
                            worktreeId: mergeWorktreeId,
                            worktreeBranch: manualWorktreeBranch,
                            targetBranch: manualTargetBranch,
                            sealedExecutionCommit: deliveryEvidence.executionCommit,
                            expectedTargetHead: deliveryEvidence.targetHeadBeforeMerge,
                            executionMetadataCommit: mergeResult?.executionMetadataCommit,
                        });
                        if (mergeResult?.updatedPrimaryCheckout === false) {
                            for (const snapshot of primaryPlanSnapshots.toReversed()) {
                                try {
                                    await restorePrimaryPlanPathAfterMergeFailure(snapshot);
                                } catch (restoreError) {
                                    const restoreReason = restoreError instanceof Error
                                        ? restoreError.message
                                        : String(restoreError);
                                    uiAPI.appendSystemMessage(
                                        `Worktree merged, but restoring the primary Plan snapshot failed: ${restoreReason}`,
                                        true,
                                        "RunWield",
                                    );
                                }
                            }
                        }
                        const candidateMerged = await isCommitAncestorOfBranch(
                            projectRoot,
                            deliveryEvidence.executionCommit,
                            deliveryEvidence.targetBranch,
                        );
                        if (!candidateMerged) {
                            throw new Error(
                                `Post-merge verification failed: validated candidate ${deliveryEvidence.executionCommit} is not contained in ${deliveryEvidence.targetBranch}.`,
                            );
                        }
                        if (mergeResult?.executionMetadataCommit) {
                            const metadataMerged = await isCommitAncestorOfBranch(
                                projectRoot,
                                mergeResult.executionMetadataCommit,
                                deliveryEvidence.targetBranch,
                            );
                            if (!metadataMerged) {
                                throw new Error(
                                    `Post-merge verification failed: validation metadata commit ${mergeResult.executionMetadataCommit} is not contained in ${deliveryEvidence.targetBranch}.`,
                                );
                            }
                        }
                        if (mergeWorktreeId) {
                            try {
                                await updateWorktreeRegistryEntry(projectRoot, mergeWorktreeId, { status: "merged" });
                                await markEffect("worktree_registry_updated", {
                                    worktreeId: mergeWorktreeId,
                                    status: "merged",
                                });
                            } catch (registryError) {
                                const registryReason = registryError instanceof Error
                                    ? registryError.message
                                    : String(registryError);
                                uiAPI.appendSystemMessage(
                                    `Worktree merged, but updating its registry status failed: ${registryReason}`,
                                    true,
                                    "RunWield",
                                );
                            }
                        }
                        return { mergeResult };
                    },
                });
                if (publication.status !== "committed") {
                    // Rethrow the original failure so the handler below can still classify a
                    // typed Git error instead of a flattened message.
                    if (publication.cause !== undefined) throw publication.cause;
                    throw new Error(
                        publication.message || `Worktree merge transaction did not commit for ${plan.planName}.`,
                    );
                }
                if (cleanupMergedWorktrees && worktreeContext.path) {
                    try {
                        await removeWorktreeGitArtifacts({
                            projectRoot: projectRoot,
                            path: worktreeContext.path,
                            force: false,
                        });
                        // Deleting the branch is irreversible, so it is its own proven step.
                        if (worktreeContext.branch) {
                            await deleteMergedWorktreeBranch({ projectRoot, branch: worktreeContext.branch });
                        }
                        if (worktreeContext.id) {
                            await removeWorktreeRegistryEntry(projectRoot, worktreeContext.id);
                        }
                    } catch (cleanupError) {
                        const cleanupReason = cleanupError instanceof Error
                            ? cleanupError.message
                            : String(cleanupError);
                        uiAPI.appendSystemMessage(
                            `Worktree merged, but cleanup failed: ${cleanupReason}`,
                            true,
                            "RunWield",
                        );
                    }
                }
                uiAPI.appendSystemMessage("Worktree changes merged and plan marked verified.", false, "RunWield");
                try {
                    await recordRecoveryResult("merge", "merged", { cleanupMergedWorktrees });
                } catch (metricError) {
                    const metricReason = metricError instanceof Error ? metricError.message : String(metricError);
                    uiAPI.appendSystemMessage(
                        `Worktree merged, but recording the recovery result failed: ${metricReason}`,
                        true,
                        "RunWield",
                    );
                }
            } catch (error) {
                if (mergeCompleted) {
                    const reason = error instanceof Error ? error.message : String(error);
                    uiAPI.appendSystemMessage(
                        `Worktree merged, but post-merge processing failed: ${reason}`,
                        true,
                        "RunWield",
                    );
                    return "handled";
                }
                let reason = isGitRepositoryRequiredError(error)
                    ? formatGitRequiredMessage(error)
                    : error instanceof Error
                    ? error.message
                    : String(error);
                if (primaryPlanSnapshots.length > 0 && !mergeCompleted) {
                    for (const snapshot of primaryPlanSnapshots.toReversed()) {
                        try {
                            await restorePrimaryPlanPathAfterMergeFailure(snapshot);
                        } catch (restoreError) {
                            const restoreReason = restoreError instanceof Error
                                ? restoreError.message
                                : String(restoreError);
                            reason += ` Primary Plan rollback also failed: ${restoreReason}`;
                        }
                    }
                }
                uiAPI.appendSystemMessage(`Worktree merge failed: ${reason}`, true, "RunWield");
                if (worktreeContext.id) {
                    try {
                        await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, {
                            status: "merge_conflict",
                        });
                    } catch (metadataError) {
                        const metadataReason = metadataError instanceof Error
                            ? metadataError.message
                            : String(metadataError);
                        uiAPI.appendSystemMessage(
                            `Could not update worktree registry while merge conflict is active: ${metadataReason}`,
                            true,
                            "RunWield",
                        );
                    }
                }
                try {
                    await recordPlanEvent({
                        cwd: projectRoot,
                        planName: plan.planName,
                        event: "worktree_merge_failed",
                        currentStatus: "implemented",
                        details: {
                            triageMeta: plan.attrs,
                            failureReason: reason,
                            deliveryEvidence: manualDeliveryEvidence,
                            worktreeId: worktreeContext.id,
                            worktreePath: worktreeContext.path,
                            worktreeBranch: worktreeContext.branch,
                            worktreeBaseBranch: worktreeContext.baseBranch,
                        },
                    });
                } catch (metadataError) {
                    const metadataReason = metadataError instanceof Error
                        ? metadataError.message
                        : String(metadataError);
                    uiAPI.appendSystemMessage(
                        `Could not update plan metadata while merge conflict is active: ${metadataReason}`,
                        true,
                        "RunWield",
                    );
                }
                await recordRecoveryResult("merge", "failed", { mergeFailureKind: "manual_merge_failed" });
            }
            return "handled";
        }

        if (answer === "abandon") {
            if (!(await confirmWorktreeAction(plan.planName, uiAPI, "Delete/abandon"))) continue;
            uiAPI.appendSystemMessage(
                `Deleting recorded worktree for "${plan.planName}"...`,
                false,
                "RunWield",
            );
            let removedWorktree = true;
            const transition = await runRecoveryTransition({
                projectRoot,
                planName: plan.planName,
                planId: plan.attrs.planId,
                worktreeId: worktreeContext?.id,
                expectedRevision: /** @type {{ revision?: string }} */ (plan).revision,
                action: "abandon",
                recover: async ({ beforePlan }) => {
                    if (worktreeContext?.path) {
                        try {
                            await removeWorktreeGitArtifacts({
                                projectRoot: projectRoot,
                                path: worktreeContext.path,
                                force: true,
                            });
                            // Deleting the branch is irreversible, so it is its own proven step.
                            if (worktreeContext.branch) {
                                await deleteMergedWorktreeBranch({ projectRoot, branch: worktreeContext.branch });
                            }
                        } catch (error) {
                            if (!isGitRepositoryRequiredError(error)) throw error;
                            removedWorktree = false;
                            uiAPI.appendSystemMessage(
                                `Git is required to delete the recorded worktree. Proceeding with metadata-only abandon: ${
                                    formatGitRequiredMessage(error)
                                }`,
                                true,
                                "RunWield",
                            );
                        }
                    }
                    if (worktreeContext?.id) {
                        await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
                    }
                    return await updatePlanFrontMatter(
                        projectRoot,
                        plan.planName,
                        {
                            worktreeStatus: "abandoned",
                            worktreeId: null,
                            worktreePath: null,
                            worktreeBranch: null,
                        },
                        plan.attrs,
                        { expectedRevision: beforePlan?.revision },
                    );
                },
            });
            if (transition.status !== "committed") {
                throw transitionFailureError(transition, `Recovery abandon transaction failed for ${plan.planName}.`);
            }
            const transitionValue =
                /** @type {{ value?: import('../../plan-store.js').PlanFrontMatter }} */ (transition.value || {});
            plan.attrs = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (transitionValue.value);
            worktreeContext = null;
            uiAPI.appendSystemMessage(
                removedWorktree
                    ? "Worktree abandoned and removed."
                    : "Worktree metadata abandoned; recorded path was left untouched because Git is unavailable.",
                false,
                "RunWield",
            );
            await recordRecoveryResult("abandon", "abandoned");
            continue;
        }

        if (answer === "review") {
            await reopenPlanForReview({
                projectRoot,
                plan,
                currentStatus: plan.attrs.status,
                worktreeContext,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                updatePlanFrontMatter,
                recordPlanEvent,
                session,
            });
            await recordRecoveryResult("review", "review");
            return "review";
        }
    }
}

/**
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, body: string, markdown: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {PlanSessionSurface["runSlicerAgent"]} opts.runSlicerAgent
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof resolvePlanFn} opts.resolvePlan
 * @param {(childPlanName: string) => Promise<void>} opts.loadChildPlan
 * @param {typeof autoGenerateWorkRecordForCompletedPlanFn} opts.autoGenerateWorkRecordForCompletedPlan
 * @returns {Promise<"handled" | "continue" | "review">}
 */
async function handleEpicPlan({
    projectRoot,
    plan,
    uiAPI,
    findPlansByParent,
    runSlicerAgent,
    recordPlanEvent,
    resolvePlan,
    loadChildPlan,
    autoGenerateWorkRecordForCompletedPlan,
}) {
    if (!isEpicPlan(plan.attrs)) return "continue";

    const children = (await findPlansByParent(projectRoot, plan.planName)).filter((child) =>
        isPlannedChangeClassification(child.attrs.classification)
    ).sort(compareChildPlansByOrder);
    const hasChildren = children.length > 0;
    const isApprovedEpic = plan.attrs.status === "approved";
    const hasLegacyExecutableEpicStatus = ["in_progress", "failed"].includes(plan.attrs.status) ||
        isInValidation(plan.attrs.status);
    const canPickChild = hasChildren &&
        (isDecomposedEpicStatus(plan.attrs) || isApprovedEpic || hasLegacyExecutableEpicStatus);
    let epicReadinessRecorded = false;

    async function ensureEpicReadinessPassed() {
        if (plan.attrs.status !== "approved" || epicReadinessRecorded) return true;
        if (!validatePlanExecutionPolicyForReadiness(plan, uiAPI)) return false;
        const updatedAttrs = await recordPlanEvent({
            cwd: projectRoot,
            planName: plan.planName,
            event: "epic_readiness_passed",
            currentStatus: "approved",
            details: { triageMeta: plan.attrs },
        });
        plan.attrs = { ...plan.attrs, ...updatedAttrs };
        epicReadinessRecorded = true;
        uiAPI.appendSystemMessage(
            `PROJECT Epic ready for decomposition or child plan selection: ${plan.planName}`,
            false,
            "RunWield",
        );
        return true;
    }

    if (hasChildren) {
        uiAPI.appendSystemMessage(formatEpicProgressSummary(children), false, "RunWield");
    }
    if (isDoneEnoughEpic(plan)) {
        const summary = plan.attrs.epicDoneEnoughSummary ? ` ${plan.attrs.epicDoneEnoughSummary}` : "";
        uiAPI.appendSystemMessage(
            `This Epic is marked done enough for now.${summary} Remaining child plans stay visible and loadable.`,
            false,
            "RunWield",
        );
    }

    const canReviewWithArchitect = plan.attrs.status === "draft" || plan.attrs.status === "feedback" ||
        plan.attrs.status === "approved";
    const canOpenSlicer = isApprovedEpic || hasLegacyExecutableEpicStatus ||
        plan.attrs.status === "ready_for_decomposition" || plan.attrs.status === "ready_for_work";

    if (canReviewWithArchitect) {
        const action = canOpenSlicer
            ? "Review it with Architect or resume Slicer decomposition to create child plans."
            : "Review it with Architect to continue planning.";
        uiAPI.appendSystemMessage(
            `This PROJECT Epic is not executable. ${action}`,
            false,
            "RunWield",
        );
    } else if (!hasChildren) {
        uiAPI.appendSystemMessage("This PROJECT Epic has no child plans yet.", false, "RunWield");
    }

    while (true) {
        /** @type {Array<{ value: string, label: string }>} */
        const epicOptions = [
            ...(canPickChild ? [{ value: "pick_child", label: "Pick a child Planned Change plan" }] : []),
            ...(canReviewWithArchitect ? [{ value: "review", label: "Review with Architect" }] : []),
            ...(canOpenSlicer ? [{ value: "slicer", label: "Open or resume Slicer decomposition" }] : []),
            ...(hasChildren && plan.attrs.status === "ready_for_work"
                ? [{ value: "done_enough", label: "Mark Epic done enough for now" }]
                : []),
            ...(isUserVerifiableStatus(plan.attrs.status)
                ? [{
                    value: "user_verify",
                    label: "Mark Epic as User Verified (user attestation; no Workflow Validation claim)",
                }]
                : []),
            ...(isHoldableStatus(plan.attrs.status) ? [{ value: "hold", label: "Put Epic on hold" }] : []),
            { value: "view", label: "View Epic details" },
            { value: "cancel", label: "Cancel" },
        ];

        const answer = await uiAPI.promptSelect("What would you like to do with this Epic?", epicOptions);
        if (!answer || answer === "cancel") return "handled";

        if (answer === "view") {
            uiAPI.appendSystemMessage(buildEpicPlanSummary(plan, children), false, "Plan");
            continue;
        }

        if (answer === "hold") {
            await putPlanOnHold({ projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent });
            return "handled";
        }

        if (answer === "user_verify") {
            await markPlanUserVerified({
                projectRoot,
                plan,
                uiAPI,
                recordPlanEvent,
                autoGenerateWorkRecordForCompletedPlan,
            });
            return "handled";
        }

        if (answer === "review") {
            return "review";
        }

        if (answer === "slicer") {
            if (!(await ensureEpicReadinessPassed())) return "handled";
            await runSlicerAgent({
                planName: plan.planName,
                triageMeta: plan.attrs,
            });
            return "handled";
        }

        if (answer === "done_enough") {
            const summary = buildEpicDoneEnoughSummary(children);
            uiAPI.appendSystemMessage(
                [
                    formatEpicProgressSummary(children),
                    "Marking this Epic done enough sets the Epic status to verified for now.",
                    "Unverified child plans remain visible and loadable.",
                ].join("\n"),
                false,
                "RunWield",
            );
            const confirm = await uiAPI.promptSelect("Mark this Epic done enough for now?", [
                { value: "confirm", label: "Yes, mark done enough for now" },
                { value: "cancel", label: "Cancel" },
            ]);
            if (confirm !== "confirm") {
                uiAPI.appendSystemMessage("Epic done-enough update canceled.", false, "RunWield");
                continue;
            }
            const updatedAttrs = await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "epic_done_enough",
                currentStatus: plan.attrs.status,
                details: {
                    triageMeta: plan.attrs,
                    epicDoneEnoughSummary: summary,
                },
            });
            plan.attrs = { ...plan.attrs, ...updatedAttrs };
            uiAPI.appendSystemMessage(
                `Epic marked done enough for now. ${plan.attrs.epicDoneEnoughSummary || summary}`,
                false,
                "RunWield",
            );
            let workRecordResult;
            try {
                workRecordResult = await autoGenerateWorkRecordForCompletedPlan({
                    cwd: projectRoot,
                    planName: plan.planName,
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                workRecordResult = {
                    status: /** @type {const} */ ("failed"),
                    planName: plan.planName,
                    error: reason,
                    message: formatWorkRecordAutoGenerationResult({
                        status: "failed",
                        planName: plan.planName,
                        error: reason,
                        message: "",
                    }),
                };
            }
            if (workRecordResult.status !== "skipped" || workRecordResult.reason !== "parent_not_terminal") {
                uiAPI.appendSystemMessage(workRecordResult.message, workRecordResult.status === "failed", "RunWield");
            }
            continue;
        }

        if (answer === "pick_child") {
            if (!(await ensureEpicReadinessPassed())) return "handled";
            while (true) {
                const nextChild = children.find(isActionableNextChild);
                const childOptions = [
                    ...(nextChild
                        ? [{
                            value: "__next_child__",
                            label: formatNextChildLabel(nextChild),
                            description: formatChildPlanDescription(nextChild),
                        }]
                        : []),
                    ...children.map((child) => ({
                        value: child.name,
                        label: formatChildPlanLabel(child),
                        description: formatChildPlanDescription(child),
                    })),
                ];
                const childPlanName = await uiAPI.promptSelect("Load child Plan:", childOptions);
                if (!childPlanName) break;
                if (childPlanName === "__next_child__") {
                    if (!nextChild) break;
                    await loadChildPlan(nextChild.name);
                    return "handled";
                }

                while (true) {
                    const childAction = await uiAPI.promptSelect(
                        "What would you like to do with this Planned Change?",
                        [
                            { value: "load", label: "Load this Planned Change" },
                            { value: "view", label: "View Planned Change details" },
                            { value: "back", label: "Back to child list" },
                        ],
                    );
                    if (!childAction || childAction === "back") break;

                    if (childAction === "load") {
                        await loadChildPlan(String(childPlanName));
                        return "handled";
                    }

                    if (childAction === "view") {
                        try {
                            const childPlan = await resolvePlan(projectRoot, String(childPlanName));
                            uiAPI.appendSystemMessage(
                                `Planned Change: ${childPlan.planName}\n\n${buildPlanSummary(childPlan)}`,
                                false,
                                "Plan",
                            );
                        } catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            uiAPI.appendSystemMessage(
                                `Could not load Planned Change details for ${String(childPlanName)}: ${message}`,
                                false,
                                "RunWield",
                            );
                            break;
                        }
                    }
                }
            }
        }
    }
}

/**
 * Handle `load-plan` command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: LoadPlanTestDeps }} [options]
 */
export async function runLoadPlanCommand(argv, options = {}) {
    const deps = /** @type {LoadPlanTestDeps} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        parseArgs: parseArgsDep,
        printCommandHelp: printCommandHelpDep,
        startInteractiveSession: startInteractiveSessionDep,
        resolvePlan: resolvePlanDep,
        decidePostPlanning: decidePostPlanningDep,
        decidePostExecution: decidePostExecutionDep,
        loadPlan: loadPlanDep,
        archivePlan: archivePlanDep,
        getWorkflowDiff: getWorkflowDiffDep,
        listCommitsTouchingPathsSince: listCommitsTouchingPathsSinceDep,
        restoreWorktreeTree: restoreWorktreeTreeDep,
        listPlans: listPlansDep,
        findPlansByParent: findPlansByParentDep,
        resolveSiblingChildPlanDependencies: resolveSiblingChildPlanDependenciesDep,
        findWorktreeById: findWorktreeByIdDep,
        findWorktreeByPlanName: findWorktreeByPlanNameDep,
        getWorktreeStatus: getWorktreeStatusDep,
        inspectExecutionWorktreeMergeRisk: inspectExecutionWorktreeMergeRiskDep,
        getBranchHead: getBranchHeadDep,
        isCommitAncestorOfBranch: isCommitAncestorOfBranchDep,
        shouldCleanupMergedWorktrees: shouldCleanupMergedWorktreesDep,
        recordWorkflowMetric: recordWorkflowMetricDep,
        probeGitRepository: probeGitRepositoryDep,
        finalizePlanImplementation: finalizePlanImplementationDep,
        resolveValidationExecutionContext: resolveValidationExecutionContextDep,
        autoGenerateWorkRecordForCompletedPlan: autoGenerateWorkRecordForCompletedPlanDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const resolvePlan = resolvePlanDep || resolvePlanFn;
    const decidePostPlanning = decidePostPlanningDep || decidePostPlanningFn;
    const decidePostExecution = decidePostExecutionDep || decidePostExecutionFn;
    const loadPlan = loadPlanDep || loadPlanFn;
    const archivePlan = archivePlanDep || archivePlanFn;
    const getWorkflowDiff = getWorkflowDiffDep || getWorkflowDiffFn;
    const listCommitsTouchingPathsSince = listCommitsTouchingPathsSinceDep || listCommitsTouchingPathsSinceFn;
    const restoreWorktreeTree = restoreWorktreeTreeDep || restoreWorktreeTreeFn;
    let sessionRuntime = options.sessionRuntime;
    let runtimeSessionId = options.sessionId;
    const findPlansByParent = findPlansByParentDep || findPlansByParentFn;
    const resolveSiblingChildPlanDependencies = resolveSiblingChildPlanDependenciesDep ||
        resolveSiblingChildPlanDependenciesFn;
    const recordPlanEvent = recordPlanEventFn;
    const stageValidationPassedInExecutionWorktree = stageValidationPassedInExecutionWorktreeFn;
    const updatePlanFrontMatter = updatePlanFrontMatterFn;
    const findWorktreeById = findWorktreeByIdDep || findWorktreeByIdFn;
    const findWorktreeByPlanName = findWorktreeByPlanNameDep || findWorktreeByPlanNameFn;
    const updateWorktreeRegistryEntry = updateWorktreeRegistryEntryFn;
    const getWorktreeStatus = getWorktreeStatusDep || getWorktreeStatusFn;
    const inspectExecutionWorktreeMergeRisk = inspectExecutionWorktreeMergeRiskDep ||
        inspectExecutionWorktreeMergeRiskFn;
    const mergeExecutionWorktree = mergeExecutionWorktreeFn;
    const checkpointExecutionWorktreeImpl = checkpointExecutionWorktree;
    const getBranchHeadImpl = getBranchHeadDep || getBranchHead;
    const isCommitAncestorOfBranchImpl = isCommitAncestorOfBranchDep || isCommitAncestorOfBranch;
    const preparePrimaryPlanPathForMerge = preparePrimaryPlanPathForMergeFn;
    const restorePrimaryPlanPathAfterMergeFailure = restorePrimaryPlanPathAfterMergeFailureFn;
    const shouldCleanupMergedWorktrees = shouldCleanupMergedWorktreesDep || shouldCleanupMergedWorktreesFn;
    const recordWorkflowMetricForLoadPlan = recordWorkflowMetricDep || recordWorkflowMetric;
    const probeGitRepository = probeGitRepositoryDep || probeGitRepositoryFn;
    const finalizePlanImplementation = finalizePlanImplementationDep || finalizePlanImplementationFn;
    const resolveValidationExecutionContextForRecovery = resolveValidationExecutionContextDep ||
        resolveValidationExecutionContext;
    const autoGenerateWorkRecordForCompletedPlan = autoGenerateWorkRecordForCompletedPlanDep ||
        autoGenerateWorkRecordForCompletedPlanFn;

    const parsedArgs = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsedArgs.help) {
        printCommandHelp("load-plan");
        return;
    }

    let [planArg] = parsedArgs._.map(String);
    if (!planArg) {
        if (options.uiAPI && options.editor) {
            if (!sessionRuntime || !runtimeSessionId) {
                throw new Error("runLoadPlanCommand requires an active runtime session for plan selection");
            }
            const activeSnapshot = sessionRuntime.getSessionSnapshot(runtimeSessionId);
            if (!activeSnapshot) throw new Error("runLoadPlanCommand runtime session is missing");
            const listPlans = listPlansDep || (await import("../../plan-store.js")).listPlans;
            const plans = await listPlans(activeSnapshot.cwd);
            if (plans.length === 0) {
                options.uiAPI.appendSystemMessage(
                    "No plans available, start one by entering a new request",
                );
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            const topLevelPlans = plans.filter((plan) => !plan.attrs.parentPlan);
            if (topLevelPlans.length === 0) {
                options.uiAPI.appendSystemMessage(
                    "No top-level plans available. Load the parent Epic directly or create a plan.",
                );
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            const planOptions = topLevelPlans.map(formatTopLevelPlanOption);

            const chosen = await options.uiAPI.promptSelect("Load plan:", planOptions, {
                layout: { maxPrimaryColumnWidth: 96 },
            });
            if (!chosen) {
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            planArg = chosen;
        } else {
            console.error(`Usage: ${CLI_BIN} load-plan <plan-name-or-path>`);
            Deno.exit(1);
        }
    }

    let uiAPI = options.uiAPI;

    if (!uiAPI) {
        uiAPI = await startInteractiveSession(
            null,
            {
                onSessionReady: (nextSessionId, nextRuntime) => {
                    runtimeSessionId = nextSessionId;
                    sessionRuntime = nextRuntime;
                },
            },
        );
    }

    if (!uiAPI) return;
    if (!sessionRuntime || !runtimeSessionId) throw new Error("runLoadPlanCommand requires a runtime session");
    const session = createPlanSessionSurface(sessionRuntime, runtimeSessionId, deps);
    const projectRoot = session.cwd;
    const executePlan = session.executePlan;
    const runPlanningAgent = session.runPlanningAgent;
    const runValidationLoop = session.runValidation;
    const runSlicerAgent = session.runSlicerAgent;
    const switchPlanAgent = session.switchAgent;

    let skipRouterRestore = false;
    const initialAgentName = session.getActiveAgentName() || AGENTS.ROUTER;
    let restoreAgentName = initialAgentName;

    /** @type {string | null} */
    let loadedPlanName = null;
    /** @type {Array<{ transitionId?: string, operation?: string, reason?: string }>} */
    let unresolvedLifecycleRecords = [];

    try {
        const plan = await resolvePlan(projectRoot, planArg);
        loadedPlanName = plan.planName;
        // Clear our own leftovers before doing anything with the Plan. An interrupted
        // lifecycle operation blocks every later one, and the record is RunWield's
        // bookkeeping, not the user's problem — so anything the repository proves is
        // finished gets closed here and the load simply continues. Only what genuinely
        // needs a decision is surfaced, and then with the command that resolves it.
        try {
            const healed = await healSettledTransitionRecords(projectRoot, { planName: plan.planName });
            unresolvedLifecycleRecords = healed.remaining;
            if (healed.closed.length > 0) {
                uiAPI.appendSystemMessage(
                    `Cleared ${healed.closed.length} unfinished lifecycle record${
                        healed.closed.length === 1 ? "" : "s"
                    } for ${plan.planName} that the repository proves are already settled. Continuing.`,
                    false,
                    "RunWield",
                );
            }
            for (const remaining of healed.remaining) {
                uiAPI.appendSystemMessage(
                    `${plan.planName} has an unfinished ${
                        remaining.operation || "lifecycle operation"
                    } that RunWield cannot confirm on its own: ${remaining.reason}. ` +
                        `Lifecycle changes to this Plan stay blocked until it is resolved. ` +
                        `Plan Recovery opens below with "Close the unfinished lifecycle record" as the first option; ` +
                        `run \`${CLI_BIN} plans doctor\` first if you want to see the exact evidence that is missing.`,
                    true,
                    "RunWield",
                );
            }
        } catch (healError) {
            // Never let bookkeeping cleanup stop a Plan from loading.
            uiAPI.appendSystemMessage(
                `Could not check for unfinished lifecycle records: ${
                    healError instanceof Error ? healError.message : String(healError)
                }`,
                true,
                "RunWield",
            );
        }
        // Loading is the deliberate action that adopts a plain markdown file the user
        // wrote into plans/. Reads elsewhere tolerate the missing Front Matter and
        // leave the file alone; here it stops being an anonymous file and becomes a
        // Plan with a durable identity, so the rest of this flow has something to
        // record lifecycle state on.
        if (plan.hasFrontMatter === false) {
            const adopted = await onboardExternalPlan(projectRoot, plan.planName);
            if (adopted.onboarded) {
                plan.attrs = adopted.resource.attrs;
                plan.markdown = adopted.resource.markdown;
                plan.body = adopted.resource.body;
                uiAPI.appendSystemMessage(
                    `Adopted ${plan.planName} as a RunWield Plan: added front matter (status draft, external origin) ` +
                        "and left your text untouched.",
                    false,
                    "RunWield",
                );
            }
        }
        uiAPI.appendSystemMessage(`Plan loaded: ${plan.planName}`, false, "RunWield");
        uiAPI.appendSystemMessage(
            `Classification: ${plan.attrs.classification}, Status: ${plan.attrs.status}`,
            false,
            "RunWield",
        );

        // Set terminal title and session name to the plan's name
        const setTitle = deps.setTerminalTitleForName || setTerminalTitleForNameFn;
        setTitle(plan.planName);
        session.rename(plan.planName);

        const triageMeta = plan.attrs;
        const agentName = triageMeta.classification === "PROJECT" ? AGENTS.ARCHITECT : AGENTS.PLANNER;
        const planFlowRestoreAgent = selectPlanFlowRestoreAgent(initialAgentName, agentName);
        /** @param {string} targetPlanName */
        const loadAnotherPlan = async (targetPlanName) => {
            skipRouterRestore = true;
            await runLoadPlanCommand([targetPlanName], {
                ...options,
                __testDeps: {
                    ...deps,
                    parseArgs: /** @type {any} */ ((/** @type {readonly string[]} */ childArgv) => ({
                        help: false,
                        _: [...childArgv],
                    })),
                },
            });
        };

        if (plan.attrs.parentPlan) {
            try {
                const parentPlan = await resolvePlan(projectRoot, plan.attrs.parentPlan);
                if (parentPlan.attrs.status === "on_hold") {
                    uiAPI.appendSystemMessage(
                        `Parent Epic "${parentPlan.planName}" is on hold. Resume the parent before working on child Planned Change "${plan.planName}".`,
                        true,
                        "RunWield",
                    );
                    while (true) {
                        const answer = await uiAPI.promptSelect("Parent Epic is on hold. What would you like to do?", [
                            { value: "resume_parent", label: "Resume from hold" },
                            { value: "view", label: "View plan details" },
                            { value: "cancel", label: "Cancel / Keep on hold" },
                        ]);
                        if (!answer || answer === "cancel") return;
                        if (answer === "view") {
                            uiAPI.appendSystemMessage(buildPlanSummary(parentPlan), false, "Plan");
                            continue;
                        }
                        if (answer === "resume_parent") {
                            await loadAnotherPlan(parentPlan.planName);
                            return;
                        }
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                uiAPI.appendSystemMessage(`Could not inspect parent Epic hold status: ${message}`, true, "RunWield");
            }
        }

        if (plan.attrs.status === "on_hold") {
            const result = await handleOnHoldPlan({
                projectRoot,
                plan,
                uiAPI,
                listCommitsTouchingPathsSince,
                recordPlanEvent,
                findPlansByParent,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                getWorktreeStatus,
                inspectExecutionWorktreeMergeRisk,
                removeWorktreeGitArtifacts: removeWorktreeGitArtifactsFn,
            });
            if (result === "handled") return;
        }

        const epicResult = await handleEpicPlan({
            projectRoot,
            plan,
            uiAPI,
            findPlansByParent,
            runSlicerAgent,
            recordPlanEvent,
            resolvePlan,
            loadChildPlan: loadAnotherPlan,
            autoGenerateWorkRecordForCompletedPlan,
        });
        if (epicResult === "handled") {
            skipRouterRestore = true;
            return;
        }
        const forceReview = epicResult === "review";

        // An unprovable record blocks every lifecycle change, so it has to be reachable
        // from Plan Recovery whatever the Plan's status is. Otherwise a draft or
        // verified Plan is told it is blocked and offered nothing.
        if (
            ["in_progress", "failed"].includes(plan.attrs.status) ||
            isInValidation(plan.attrs.status) ||
            unresolvedLifecycleRecords.length > 0
        ) {
            restoreAgentName = planFlowRestoreAgent;
            const result = await handlePlanRecovery({
                projectRoot,
                plan,
                agentName,
                uiAPI,
                unresolvedRecords: unresolvedLifecycleRecords,
                executePlan,
                runPlanningAgent,
                decidePostPlanning,
                decidePostExecution,
                runValidationLoop,
                loadPlan,
                getWorkflowDiff,
                listCommitsTouchingPathsSince,
                restoreWorktreeTree,
                recordPlanEvent,
                stageValidationPassedInExecutionWorktree,
                updatePlanFrontMatter,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                getWorktreeStatus,
                createWorktreeGitArtifacts,
                settleWorktreeAttempt,
                mergeExecutionWorktree,
                checkpointExecutionWorktree: checkpointExecutionWorktreeImpl,
                getBranchHead: getBranchHeadImpl,
                isCommitAncestorOfBranch: isCommitAncestorOfBranchImpl,
                preparePrimaryPlanPathForMerge,
                restorePrimaryPlanPathAfterMergeFailure,
                removeWorktreeGitArtifacts: removeWorktreeGitArtifactsFn,
                removeWorktreeRegistryEntry: removeWorktreeRegistryEntryFn,
                shouldCleanupMergedWorktrees,
                recordWorkflowMetric: recordWorkflowMetricForLoadPlan,
                findPlansByParent,
                session,
                probeGitRepository,
                finalizePlanImplementation,
                resolveValidationExecutionContextForRecovery,
                autoGenerateWorkRecordForCompletedPlan,
            });
            if (result === "handled") return;
        }

        const dependenciesConfirmed = await confirmChildFeatureDependencies(
            projectRoot,
            plan,
            uiAPI,
            resolveSiblingChildPlanDependencies,
        );
        if (!dependenciesConfirmed) return;

        if (plan.attrs.status === "verified" || plan.attrs.status === "user_verified") {
            uiAPI.appendSystemMessage(
                plan.attrs.status === "verified"
                    ? "This plan is already verified."
                    : "This plan is User Verified by user attestation.",
                false,
                "RunWield",
            );
            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "review", label: "Re-open for review (planner/architect)" },
                    { value: "archive", label: "Archive plan" },
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);
                if (!answer || answer === "cancel") {
                    return;
                }
                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                    continue;
                }
                if (answer === "archive") {
                    const archived = await archivePlan(projectRoot, plan.planName);
                    uiAPI.appendSystemMessage(
                        `Archived ${plan.planName} to ${archived.relativePath}`,
                        false,
                        "RunWield",
                    );
                    return;
                }
                await reopenPlanForReview({
                    projectRoot,
                    plan,
                    currentStatus: plan.attrs.status,
                    findWorktreeById,
                    findWorktreeByPlanName,
                    updateWorktreeRegistryEntry,
                    updatePlanFrontMatter,
                    recordPlanEvent,
                    session,
                });
                break;
            }
        }

        if (plan.attrs.status === "approved" || isExecutablePlanStatus(plan.attrs.status)) {
            let reviewForced = forceReview;
            while (true) {
                const answer = reviewForced ? "review" : await uiAPI.promptSelect("What would you like to do?", [
                    { value: "proceed", label: "Proceed with execution" },
                    ...(plan.attrs.status === "ready_for_work"
                        ? [{ value: "planner_re_review", label: "Send back to Planner for re-review" }]
                        : []),
                    { value: "review", label: "Re-open for review (edit/annotate)" },
                    {
                        value: "user_verify",
                        label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                    },
                    { value: "hold", label: "Put on hold" },
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);
                reviewForced = false;

                if (!answer || answer === "cancel") return;

                if (answer === "hold") {
                    await putPlanOnHold({ projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent });
                    return;
                }

                if (answer === "user_verify") {
                    await markPlanUserVerified({
                        projectRoot,
                        plan,
                        uiAPI,
                        recordPlanEvent,
                        autoGenerateWorkRecordForCompletedPlan,
                    });
                    return;
                }

                if (answer === "proceed") {
                    restoreAgentName = planFlowRestoreAgent;
                    if (plan.attrs.status === "approved") {
                        const ready = await prepareApprovedPlanForWork(
                            projectRoot,
                            plan,
                            uiAPI,
                            recordPlanEvent,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                    }

                    await executeReadyPlanWithRepair({
                        projectRoot,
                        plan,
                        agentName,
                        uiAPI,
                        executePlan,
                        runPlanningAgent,
                        decidePostPlanning,
                        decidePostExecution,
                        runValidationLoop,
                        loadPlan,
                        listCommitsTouchingPathsSince,
                        session,
                        finalizePlanImplementation,
                        recordPlanEvent,
                        resolveValidationExecutionContextForRecovery,
                    });
                    return;
                }

                if (answer === "planner_re_review") {
                    restoreAgentName = planFlowRestoreAgent;
                    const preReviewStatus = plan.attrs.status;

                    await reopenPlanForReview({
                        projectRoot,
                        plan,
                        currentStatus: preReviewStatus,
                        findWorktreeById,
                        findWorktreeByPlanName,
                        updateWorktreeRegistryEntry,
                        updatePlanFrontMatter,
                        recordPlanEvent,
                        session,
                    });
                    await switchPlanAgent(agentName);

                    const outcome = await runPlanningAgent({
                        agentName,
                        initialRequest: buildPlannerReReviewRequest(plan.planName),
                        triageMeta: plan.attrs,
                    });

                    const planningDecision = decidePostPlanning(outcome, {
                        planningAgentName: agentName,
                        fallbackTriageMeta: plan.attrs,
                    });
                    await executePostPlanningDecision({
                        decision: planningDecision,
                        fallbackPlanContent: plan.markdown || plan.body || "",
                        uiAPI,
                        executePlan,
                        decidePostExecution,
                        runValidationLoop,
                        runSlicerAgent,
                        loadPlan,
                        listCommitsTouchingPathsSince,
                        session,
                        finalizePlanImplementation,
                        recordPlanEvent,
                        resolveValidationExecutionContextForRecovery,
                    });
                    if (shouldKeepPlanningAgentActive(planningDecision)) {
                        skipRouterRestore = true;
                    }
                    return;
                }

                if (answer === "review") {
                    restoreAgentName = planFlowRestoreAgent;
                    // The reviewer detaches the Plan from its execution generation as
                    // part of committing its decision, so load-plan does not reopen
                    // here. What it must still do is refuse up front: an unmanaged
                    // worktree cannot be abandoned, and finding that out after someone
                    // has reviewed the Plan wastes the review.
                    assertRecoveryWorktreeIsManaged(
                        plan.planName,
                        await resolveRecoveryWorktree(projectRoot, plan, {
                            findWorktreeById,
                            findWorktreeByPlanName,
                        }),
                    );

                    await switchPlanAgent(agentName);

                    const recoverableReview = await requestRecoverablePlanReview({
                        requestReview: () =>
                            session.reviewPlan({
                                planName: plan.planName,
                                planPath: plan.path,
                                triageMeta: plan.attrs,
                            }),
                        requestRetry: async ({ response }) => {
                            if (response?.cancellationReason === "runtime_cancel") {
                                return { outcome: RuntimeInteractionOutcomes.CANCELED, value: false };
                            }
                            const value = await uiAPI.promptSelect("Review the Plan again?", [
                                { value: "yes", label: "Yes" },
                                { value: "no", label: "No" },
                            ]);
                            return value === "yes"
                                ? { outcome: RuntimeInteractionOutcomes.ACCEPTED, value: true }
                                : { outcome: RuntimeInteractionOutcomes.CANCELED, value: false };
                        },
                        onUnanswered: ({ reason }) => {
                            uiAPI.appendSystemMessage(
                                `Plan review ended without an answer (${reason}).`,
                                false,
                                "RunWield",
                            );
                        },
                    });

                    if (recoverableReview.kind === "complete") {
                        uiAPI.appendSystemMessage(SESSION_COMPLETE_GUIDANCE, false, "RunWield");
                        skipRouterRestore = true;
                        return;
                    }

                    const reviewResult = recoverableReview.response;

                    if (reviewResult.remoteReview) {
                        uiAPI.appendSystemMessage(
                            reviewResult.message || `Plan saved for remote review: ${plan.planName}`,
                            false,
                            "RunWield",
                        );
                        skipRouterRestore = true;
                        return;
                    }

                    // The reviewer's transaction may have abandoned the execution
                    // generation this session was still pointing at.
                    if (!isPlanReviewableWithoutReopen(plan.attrs.status)) {
                        session.clearActiveExecutionWorkflow();
                    }

                    if (reviewResult.approved) {
                        let reloadedAfterReview = false;
                        try {
                            const latestPlan = await loadPlan(projectRoot, plan.planName);
                            if (latestPlan) {
                                plan.attrs = reviewResult.planAttrs
                                    ? { ...latestPlan.attrs, ...reviewResult.planAttrs }
                                    : latestPlan.attrs;
                                plan.body = latestPlan.body;
                                plan.markdown = latestPlan.markdown || latestPlan.body || plan.markdown;
                                reloadedAfterReview = true;
                            }
                        } catch {
                            // Keep the in-memory Plan if a test fake does not support reloading after review.
                        }
                        if (!reloadedAfterReview && reviewResult.planAttrs) {
                            plan.attrs = { ...plan.attrs, ...reviewResult.planAttrs };
                        }
                        const approvalAction = normalizePlanApprovalAction({
                            classification: plan.attrs.classification,
                            action: reviewResult.approvalAction,
                        });
                        if (isEpicPlan(plan.attrs)) {
                            if (!validatePlanExecutionPolicyForReadiness(plan, uiAPI)) {
                                skipRouterRestore = true;
                                return;
                            }
                            await recordPlanEvent({
                                cwd: projectRoot,
                                planName: plan.planName,
                                event: "epic_readiness_passed",
                                currentStatus: "approved",
                                details: { triageMeta: plan.attrs },
                            });
                            plan.attrs.status = "ready_for_decomposition";
                            uiAPI.appendSystemMessage(
                                `PROJECT Epic ready for decomposition or child plan selection: ${plan.planName}`,
                                false,
                                "RunWield",
                            );
                            if (approvalAction === PLAN_APPROVAL_ACTIONS.DECOMPOSE) {
                                await runSlicerAgent({
                                    planName: plan.planName,
                                    triageMeta: plan.attrs,
                                    reviewFeedback: reviewResult.feedback,
                                    reviewImages: reviewResult.images,
                                });
                            } else {
                                uiAPI.appendSystemMessage(
                                    appendSessionCompleteGuidance(
                                        `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                                    ),
                                    false,
                                    "RunWield",
                                );
                            }
                            skipRouterRestore = true;
                            return;
                        }

                        const ready = await prepareApprovedPlanForWork(
                            projectRoot,
                            plan,
                            uiAPI,
                            recordPlanEvent,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                        if (approvalAction === PLAN_APPROVAL_ACTIONS.RUN) {
                            const confirmed = await confirmAffectedPathChangesBeforeExecution({
                                projectRoot,
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                uiAPI,
                                listCommitsTouchingPathsSince,
                            });
                            if (!confirmed) return;

                            const execRes = await executePlan({
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                reviewFeedback: reviewResult.feedback,
                                reviewImages: reviewResult.images,
                            });
                            const policy = resolvePlanExecutionPolicy(plan.attrs);
                            const executionDecision = decidePostExecution(execRes, {
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                executionAgentName: policy.ok ? policy.policy.executionAgent : agentName,
                            });
                            await validatePostExecutionDecision({
                                executionDecision,
                                executionResult: execRes,
                                fallbackPlanContent: plan.markdown || plan.body || "",
                                runValidationLoop,
                                loadPlan,
                                session,
                                uiAPI,
                                finalizePlanImplementation,
                                recordPlanEvent,
                                resolveValidationExecutionContextForRecovery,
                            });
                        } else {
                            uiAPI.appendSystemMessage(
                                appendSessionCompleteGuidance(
                                    `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                                ),
                                false,
                                "RunWield",
                            );
                            skipRouterRestore = true;
                        }
                        return;
                    }

                    // User submitted feedback — kick off the planning agent to revise.
                    const outcome = await runPlanningAgent({
                        agentName,
                        initialRequest: buildReReviewRevisionRequest(plan.planName, reviewResult.feedback),
                        triageMeta: plan.attrs,
                        images: reviewResult.images,
                    });

                    const planningDecision = decidePostPlanning(outcome, {
                        planningAgentName: agentName,
                        fallbackTriageMeta: plan.attrs,
                    });
                    await executePostPlanningDecision({
                        decision: planningDecision,
                        fallbackPlanContent: plan.markdown || plan.body || "",
                        uiAPI,
                        executePlan,
                        decidePostExecution,
                        runValidationLoop,
                        runSlicerAgent,
                        loadPlan,
                        listCommitsTouchingPathsSince,
                        session,
                        finalizePlanImplementation,
                        recordPlanEvent,
                        resolveValidationExecutionContextForRecovery,
                    });
                    if (shouldKeepPlanningAgentActive(planningDecision)) {
                        skipRouterRestore = true;
                    }
                    return;
                }

                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                }
            }
        }

        // Not approved — show a first-action menu before kicking off the planning agent.
        if (!forceReview) {
            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "resume", label: "Resume planning" },
                    ...(isUserVerifiableStatus(plan.attrs.status)
                        ? [{
                            value: "user_verify",
                            label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                        }]
                        : []),
                    ...(isHoldableStatus(plan.attrs.status) ? [{ value: "hold", label: "Put on hold" }] : []),
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);
                if (!answer || answer === "cancel") return;
                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                    continue;
                }
                if (answer === "hold") {
                    await putPlanOnHold({ projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent });
                    return;
                }
                if (answer === "user_verify") {
                    await markPlanUserVerified({
                        projectRoot,
                        plan,
                        uiAPI,
                        recordPlanEvent,
                        autoGenerateWorkRecordForCompletedPlan,
                    });
                    return;
                }
                if (answer === "resume") break;
            }
        }

        uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
        restoreAgentName = planFlowRestoreAgent;
        await switchPlanAgent(agentName);

        const outcome = await runPlanningAgent({
            agentName,
            initialRequest: buildResumeRequest(plan.planName, plan.attrs),
            triageMeta: plan.attrs,
        });

        const planningDecision = decidePostPlanning(outcome, {
            planningAgentName: agentName,
            fallbackTriageMeta: plan.attrs,
        });
        await executePostPlanningDecision({
            decision: planningDecision,
            fallbackPlanContent: plan.markdown || plan.body || "",
            uiAPI,
            executePlan,
            decidePostExecution,
            runValidationLoop,
            runSlicerAgent,
            loadPlan,
            listCommitsTouchingPathsSince,
            session,
            finalizePlanImplementation,
            recordPlanEvent,
            resolveValidationExecutionContextForRecovery,
        });
        if (shouldKeepPlanningAgentActive(planningDecision)) {
            skipRouterRestore = true;
        }
    } catch (error) {
        if (!isManagedUnsupportedError(error)) throw error;
        uiAPI.appendSystemMessage(buildManagedUnsupportedLoadPlanMessage(loadedPlanName), true, "RunWield");
    } finally {
        if (!skipRouterRestore && sessionRuntime.getSessionSnapshot(session.id)) {
            await restorePreviousAgentFlow(uiAPI, restoreAgentName, session);
        }
    }
}
