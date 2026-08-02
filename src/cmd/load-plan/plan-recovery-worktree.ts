/**
 * @module cmd/load-plan/plan-recovery-worktree
 * Reading, reporting on, and detaching the worktree generation a Plan records.
 *
 * Recovery's job is Plans whose recorded execution metadata is partial or stale,
 * so everything here tolerates missing fields — and refuses, loudly, where a
 * missing field would make a destructive action unsafe.
 */

import { resolvePlanExecutionPolicy } from "../../plan-store.js";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../../shared/git.js";
import { buildPlanEventUpdates } from "../../shared/workflow/plan-lifecycle.js";
import { resolveValidationExecutionContext } from "../../shared/workflow/execution-context.js";
import { runPlanFrontMatterTransition, runReviewReopenTransition } from "../../shared/workflow/state-transition.ts";
import { getWorkflowDiff as getWorkflowDiffFn } from "../../shared/workflow/git-snapshot.js";
import { getWorktreeStatus as getWorktreeStatusFn } from "../../shared/worktree.js";
import {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
    updateEntry as updateWorktreeRegistryEntryFn,
} from "../../shared/worktree-registry.js";
import { updatePlanFrontMatter } from "../../plan-store.js";
import { buildPlanSummary } from "./plan-presentation.ts";
import { transitionFailureError } from "./transition-failure.ts";

import { recordPlanEvent as recordPlanEventFn } from "../../shared/workflow/plan-lifecycle.js";
import type { PlanFrontMatter } from "../../plan-store.js";
import type { PlanStatus } from "../../shared/workflow/plan-lifecycle.js";
import type { UiAPI } from "../../ui/tui/types.js";
import type { PlanSessionSurface, RecoveryWorktreeContext } from "./plan-session-types.ts";

/**
 * The minimum a Plan has to carry for recovery to reason about its worktree.
 *
 * Deliberately not the whole Plan: the lookups below run against Plans loaded
 * for their Front Matter alone, with no body read.
 */
export interface RecoveryPlanRef {
    planName: string;
    attrs: PlanFrontMatter;
    revision?: string;
}

/** A Plan with enough loaded to render a recovery report. */
export interface RecoverablePlan extends RecoveryPlanRef {
    path?: string;
    body: string;
    markdown?: string;
}

/** How recovery finds the worktree a Plan is recorded against. */
export interface WorktreeLookups {
    findWorktreeById: typeof findWorktreeByIdFn;
    findWorktreeByPlanName: typeof findWorktreeByPlanNameFn;
}

/**
 * The execution context recovery reads, whether it was reconstructed from the
 * Plan's own metadata or resolved fresh. Both shapes are read the same way here.
 */
export interface RecoveryExecutionContext {
    executionMode?: string | null;
    executionCwd?: string | null;
    baselineTree?: string | null;
    worktreeId?: string | null;
    worktreeBranch?: string | null;
    worktreeBaseBranch?: string | null;
}

/** The execution workflow recovery re-attaches to the session. */
export interface RecoveryWorkflowState {
    planName: string;
    triageMeta: PlanFrontMatter;
    executionAgent: string;
    projectRoot: string;
    executionMode?: string;
    executionCwd?: string;
    baselineTree?: string | null;
    worktreeId?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    nonGitInPlace?: boolean;
}

/** Everything `reopenPlanForReview` needs to detach a Plan from its generation. */
export interface ReopenPlanForReviewOptions extends WorktreeLookups {
    projectRoot: string;
    plan: RecoveryPlanRef;
    currentStatus: PlanStatus;
    worktreeContext?: RecoveryWorktreeContext | null;
    updateWorktreeRegistryEntry: typeof updateWorktreeRegistryEntryFn;
    updatePlanFrontMatter: typeof updatePlanFrontMatter;
    recordPlanEvent: typeof recordPlanEventFn;
    session: PlanSessionSurface;
}

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {Object} deps
 * @param {typeof findWorktreeByIdFn} deps.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} deps.findWorktreeByPlanName
 * @returns {Promise<RecoveryWorktreeContext | null>}
 */
/**
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {{ findWorktreeById: typeof findWorktreeByIdFn, findWorktreeByPlanName: typeof findWorktreeByPlanNameFn }} deps
 * @returns {Promise<RecoveryWorktreeContext | null>}
 */
export async function resolveRecoveryWorktree(
    projectRoot: string,
    plan: RecoveryPlanRef,
    { findWorktreeById, findWorktreeByPlanName: _findWorktreeByPlanName }: WorktreeLookups,
): Promise<RecoveryWorktreeContext | null> {
    let entry = null;
    if (plan.attrs.worktreeId) entry = await findWorktreeById(projectRoot, plan.attrs.worktreeId);
    const path = plan.attrs.worktreePath || entry?.path;
    const branch = plan.attrs.worktreeBranch || entry?.branch;
    const id = plan.attrs.worktreeId || entry?.id;
    const recordedBaseBranch = plan.attrs.worktreeBaseBranch || entry?.baseBranch;
    const baseBranch = recordedBaseBranch === "HEAD" ? undefined : recordedBaseBranch;
    if (!path && !branch && !id) return null;
    return {
        id,
        path,
        branch,
        baseBranch,
        status: plan.attrs.worktreeStatus || entry?.status,
        baseRef: entry?.baseRef,
        baseCommit: entry?.baseCommit,
        baseTree: entry?.baseTree,
        executionBaselineTree: entry?.executionBaselineTree,
    };
}

/**
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, revision?: string }} plan
 * @param {RecoveryWorktreeContext | null} context
 * @returns {Promise<import('../../plan-store.js').PlanFrontMatter>}
 */
export async function persistRecoveredWorktreeMetadata(
    projectRoot: string,
    plan: RecoveryPlanRef,
    context: RecoveryWorktreeContext | null,
): Promise<PlanFrontMatter> {
    if (!context) return plan.attrs;
    const updates: Partial<PlanFrontMatter> = {};
    if (context.id && !plan.attrs.worktreeId) updates.worktreeId = context.id;
    if (!Object.keys(updates).length) return plan.attrs;
    const transition = await runPlanFrontMatterTransition({
        projectRoot,
        planName: plan.planName,
        operation: "recovery_metadata_refresh",
        updates,
        recoveryAttrs: {},
        expectedRevision: plan.revision,
    });
    if (transition.status !== "committed") {
        throw transitionFailureError(transition, `Recovery metadata transition failed for ${plan.planName}.`);
    }
    return transition.value as PlanFrontMatter;
}

/**
 * Refuse to detach a generation RunWield does not manage.
 *
 * Worktree metadata with a path or branch but no registry id is a worktree
 * nothing can abandon: there is no entry to mark. Detaching the Plan from it
 * anyway would strand a real working tree with no record pointing at it.
 *
 * @param {string} planName
 * @param {RecoveryWorktreeContext | null | undefined} priorWorktree
 */
export function assertRecoveryWorktreeIsManaged(
    planName: string,
    priorWorktree: RecoveryWorktreeContext | null | undefined,
): void {
    if (priorWorktree?.id) return;
    if (!priorWorktree?.path && !priorWorktree?.branch) return;
    throw new Error(
        `Cannot reopen ${planName} for review while recovery worktree metadata lacks a registry id. Resolve or abandon the recorded worktree (${
            priorWorktree.path || "unknown path"
        }, ${priorWorktree.branch || "unknown branch"}) before reopening review.`,
    );
}

/**
 * Detach any prior execution generation before sending a Plan back through
 * review. The physical worktree is retained for inspection, but it is no
 * longer eligible for execution reuse.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, path: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter, revision?: string }} opts.plan
 * @param {import('../../shared/workflow/plan-lifecycle.js').PlanStatus} opts.currentStatus
 * @param {RecoveryWorktreeContext | null | undefined} [opts.worktreeContext]
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {Function} opts.updatePlanFrontMatter
 * @param {Function} opts.recordPlanEvent
 * @param {PlanSessionSurface} opts.session
 */
export async function reopenPlanForReview({
    projectRoot,
    plan,
    currentStatus,
    worktreeContext,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    updatePlanFrontMatter,
    recordPlanEvent,
    session,
}: ReopenPlanForReviewOptions): Promise<void> {
    const priorWorktree = worktreeContext === undefined
        ? await resolveRecoveryWorktree(projectRoot, plan, { findWorktreeById, findWorktreeByPlanName })
        : worktreeContext;
    if (!priorWorktree?.id) {
        assertRecoveryWorktreeIsManaged(plan.planName, priorWorktree);
        session.clearActiveExecutionWorkflow();
        const updatedAttrs = await recordPlanEvent({
            cwd: projectRoot,
            planName: plan.planName,
            event: "review_reopened",
            currentStatus,
            details: { triageMeta: plan.attrs },
        });
        plan.attrs = { ...plan.attrs, ...updatedAttrs };
        return;
    }
    const priorWorktreeId = priorWorktree.id;
    const transition = await runReviewReopenTransition({
        projectRoot,
        planName: plan.planName,
        worktreeId: priorWorktreeId,
        expectedRevision: plan.revision,
        reopen: async ({ beforePlan, markEffect }) => {
            if (!beforePlan) throw new Error(`Plan not found: ${plan.planName}`);
            const updates = buildPlanEventUpdates("review_reopened", currentStatus, { triageMeta: beforePlan.attrs });
            await updateWorktreeRegistryEntry(projectRoot, priorWorktreeId, { status: "abandoned" });
            await markEffect("worktree_registry_abandoned", { worktreeId: priorWorktreeId });
            const updatedAttrs = await updatePlanFrontMatter(projectRoot, plan.planName, updates, beforePlan.attrs, {
                expectedRevision: beforePlan.revision,
            });
            await markEffect("plan_event_recorded", { planName: plan.planName, event: "review_reopened" });
            return updatedAttrs;
        },
    });
    if (transition.status !== "committed") {
        throw transitionFailureError(transition, `Review reopen transition failed for ${plan.planName}.`);
    }
    session.clearActiveExecutionWorkflow();
    plan.attrs = { ...plan.attrs, ...(transition.value as PlanFrontMatter) };
}

/**
 * @param {RecoveryWorktreeContext | null} context
 * @returns {boolean}
 */
export function hasWorktreeContext(context: RecoveryWorktreeContext | null | undefined): boolean {
    return Boolean(context?.path || context?.branch || context?.id);
}

/**
 * Manual merge recovery is only safe after Workflow Validation has already
 * passed and the automatic merge-back failed.
 *
 * @param {RecoveryWorktreeContext | null} context
 * @returns {boolean}
 */
export function canManuallyMergeRecoveredWorktree(context: RecoveryWorktreeContext | null | undefined): boolean {
    return context?.status === "merge_conflict" && Boolean(context.baseBranch);
}

/**
 * @param {RecoveryWorktreeContext | null} context
 * @returns {string | null}
 */
export function getRecordedWorktreeRecreateBase(context: RecoveryWorktreeContext | null | undefined): string | null {
    return context?.baseCommit || context?.baseRef || null;
}

/** @param {string | undefined} path */
export async function pathExists(path: string | undefined): Promise<boolean> {
    if (!path) return false;
    try {
        const stat = await Deno.stat(path);
        return stat.isDirectory;
    } catch {
        return false;
    }
}

/**
 * @param {string} action
 * @param {string} planName
 * @param {string} error
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 */
export function reportInvalidRecoveryPolicy(
    action: string,
    planName: string,
    error: string | undefined,
    uiAPI: UiAPI,
): void {
    uiAPI.appendSystemMessage(
        `Cannot ${action} Plan recovery for "${planName}" because its execution policy is invalid: ${error} Fix the Plan front matter or re-open it for review before retrying recovery.`,
        true,
        "RunWield",
    );
}

/**
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {RecoveryWorktreeContext | null} context
 * @param {PlanSessionSurface} session
 * @param {import('../../ui/tui/types.js').UiAPI} [uiAPI]
 * @param {string} [action]
 * @param {typeof resolveValidationExecutionContext} [resolveValidationExecutionContextForRecovery]
 * @returns {Promise<boolean>}
 */
export async function rehydrateActiveRecoveryWorkflow(
    projectRoot: string,
    plan: RecoveryPlanRef,
    context: RecoveryWorktreeContext | null,
    session: PlanSessionSurface,
    uiAPI?: UiAPI,
    action: string = "continue",
    resolveValidationExecutionContextForRecovery: typeof resolveValidationExecutionContext =
        resolveValidationExecutionContext,
): Promise<boolean> {
    const policy = resolvePlanExecutionPolicy(plan.attrs);
    if (!policy.ok) {
        if (uiAPI) {
            reportInvalidRecoveryPolicy(action, plan.planName, policy.error, uiAPI);
            return false;
        }
        throw new Error(policy.error);
    }
    const explicitContext = {
        planName: plan.planName,
        triageMeta: plan.attrs,
        executionMode: plan.attrs.executionMode,
        baselineTree: plan.attrs.executionBaselineTree || context?.baseTree,
        worktreeId: context?.id || plan.attrs.worktreeId,
        worktreeBranch: context?.branch || plan.attrs.worktreeBranch,
        worktreeBaseBranch: context?.baseBranch || plan.attrs.worktreeBaseBranch,
        executionCwd: context?.path || plan.attrs.worktreePath,
        nonGitInPlace: plan.attrs.executionMode === "non_git_in_place",
    };
    let resolvedContext: RecoveryExecutionContext = explicitContext;
    if (action !== "continue") {
        const resolution = await resolveValidationExecutionContextForRecovery({
            projectRoot,
            planName: plan.planName,
            triageMeta: plan.attrs,
            explicitContext,
            __deps: {
                loadPlan: () =>
                    Promise.resolve({
                        path: `plans/${plan.planName}.md`,
                        markdown: "",
                        body: "",
                        attrs: plan.attrs,
                    }),
            },
        });
        if (resolution.kind === "blocked") {
            if (uiAPI) {
                uiAPI.appendSystemMessage(`Recovery ${action} blocked: ${resolution.message}`, false, "RunWield");
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
        resolvedContext = resolution.context;
    }
    const workflow: RecoveryWorkflowState = {
        planName: plan.planName,
        triageMeta: plan.attrs,
        executionAgent: policy.policy.executionAgent,
        executionMode: resolvedContext.executionMode || undefined,
        projectRoot,
        executionCwd: resolvedContext.executionCwd || undefined,
    };
    if (resolvedContext.executionMode === "non_git_in_place") workflow.nonGitInPlace = true;
    if (resolvedContext.executionMode === "worktree") {
        workflow.baselineTree = resolvedContext.baselineTree;
        workflow.worktreeId = resolvedContext.worktreeId || undefined;
        workflow.worktreeBranch = resolvedContext.worktreeBranch || undefined;
        workflow.worktreeBaseBranch = resolvedContext.worktreeBaseBranch || undefined;
    }
    session.setActiveExecutionWorkflow(workflow);
    return true;
}

/**
 * Append recovery context for a partially executed Plan.
 *
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown: string }} plan
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {typeof getWorkflowDiffFn} getWorkflowDiff
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {typeof getWorktreeStatusFn} getWorktreeStatus
 * @returns {Promise<void>}
 */
export async function appendRecoveryReport(
    projectRoot: string,
    plan: RecoverablePlan,
    uiAPI: UiAPI,
    getWorkflowDiff: typeof getWorkflowDiffFn,
    worktreeContext: RecoveryWorktreeContext | null,
    getWorktreeStatus: typeof getWorktreeStatusFn,
): Promise<void> {
    const lines = [buildPlanSummary(plan)];
    if (plan.attrs.failureReason) {
        lines.push(`Failure reason:\n${plan.attrs.failureReason}`);
    }
    if (hasWorktreeContext(worktreeContext)) {
        lines.push(
            [
                `Worktree status: ${worktreeContext?.status || "unknown"}`,
                `Worktree path:   ${worktreeContext?.path || "(unknown)"}`,
                `Worktree branch: ${worktreeContext?.branch || "(unknown)"}`,
                `Worktree target: ${worktreeContext?.baseBranch || "(unknown)"}`,
                `Worktree base:   ${worktreeContext?.baseCommit || worktreeContext?.baseRef || "(unknown)"}`,
            ].join("\n"),
        );
        if (worktreeContext?.path) {
            try {
                const status = await getWorktreeStatus({
                    projectRoot: projectRoot,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    baseTree: plan.attrs.executionBaselineTree || worktreeContext.executionBaselineTree ||
                        worktreeContext.baseTree || worktreeContext.baseCommit || undefined,
                });
                lines.push(
                    status.exists
                        ? `Git status:\n${status.statusText.trim() || "clean"}`
                        : "Git status: missing worktree path",
                );
                lines.push(
                    status.diff?.trim()
                        ? `Changes since execution baseline:\n${status.diff}`
                        : "No changes since baseline.",
                );
            } catch (error) {
                const message = isGitRepositoryRequiredError(error)
                    ? formatGitRequiredMessage(error)
                    : error instanceof Error
                    ? error.message
                    : String(error);
                lines.push(`Could not inspect worktree: ${message}`);
            }
        }
    } else if (plan.attrs.executionBaselineTree) {
        lines.push(`Execution baseline tree: ${plan.attrs.executionBaselineTree}`);
        try {
            const diff = await getWorkflowDiff(projectRoot, plan.attrs.executionBaselineTree);
            lines.push(diff.trim() ? `Changes since execution baseline:\n${diff}` : "No changes since baseline.");
        } catch (error) {
            const message = isGitRepositoryRequiredError(error)
                ? formatGitRequiredMessage(error)
                : error instanceof Error
                ? error.message
                : String(error);
            lines.push(`Could not compute baseline diff: ${message}`);
        }
    } else {
        lines.push("No execution baseline tree is recorded for this plan.");
    }
    uiAPI.appendSystemMessage(lines.join("\n\n"), false, "Plan Recovery");
}

/**
 * Ask for destructive baseline reset confirmation.
 *
 * @param {string} planName
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
export async function confirmBaselineReset(planName: string, uiAPI: UiAPI): Promise<boolean> {
    const answer = await uiAPI.promptSelect(
        `Reset "${planName}" to its execution-start snapshot? Changes made after that snapshot, including unrelated changes, will be lost.`,
        [
            { value: "reset", label: "Yes, reset and start over" },
            { value: "cancel", label: "Cancel" },
        ],
    );
    return answer === "reset";
}

/**
 * @param {string} planName
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
export async function confirmMetadataOnlyRecoveryCleanup(planName: string, uiAPI: UiAPI): Promise<boolean> {
    uiAPI.appendSystemMessage(
        `Git is not available for this project, so RunWield cannot inspect, restore, recreate, continue, validate, or merge the recorded Git recovery state for "${planName}". It can safely clear only the stale Plan/Worktree metadata; no project files or recorded paths will be modified.`,
        true,
        "RunWield",
    );
    const answer = await uiAPI.promptSelect("Clear stale Git recovery metadata and mark the plan ready for work?", [
        { value: "clear", label: "Clear metadata only" },
        { value: "cancel", label: "Cancel" },
    ]);
    return answer === "clear";
}

/**
 * @param {string} planName
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {string} action
 * @returns {Promise<boolean>}
 */
export async function confirmWorktreeAction(planName: string, uiAPI: UiAPI, action: string): Promise<boolean> {
    const answer = await uiAPI.promptSelect(`${action} worktree for "${planName}"?`, [
        { value: "confirm", label: `Yes, ${action.toLowerCase()} worktree` },
        { value: "cancel", label: "Cancel" },
    ]);
    return answer === "confirm";
}

/**
 * @param {string} planName
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
export async function confirmMissingWorktreeRecreate(
    planName: string,
    worktreeContext: RecoveryWorktreeContext | null,
    uiAPI: UiAPI,
): Promise<boolean> {
    const path = worktreeContext?.path;
    const message = path
        ? `The recorded worktree for "${planName}" does not exist at ${path}. Recreating it will abandon the stale metadata and start implementation from a new worktree.`
        : `The recorded worktree for "${planName}" has no usable path. Recreating it will abandon the stale metadata and start implementation from a new worktree.`;
    uiAPI.appendSystemMessage(message, true, "RunWield");
    const answer = await uiAPI.promptSelect("Recreate the worktree and start over?", [
        { value: "confirm", label: "Yes, create a new worktree and start over" },
        { value: "cancel", label: "Cancel" },
    ]);
    return answer === "confirm";
}

/**
 * @param {string} planName
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {typeof getWorktreeStatusFn} getWorktreeStatus
 * @returns {Promise<boolean>}
 */
/**
 * @param {string} projectRoot
 * @param {string} planName
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {typeof getWorktreeStatusFn} getWorktreeStatus
 * @returns {Promise<boolean>}
 */
export async function confirmRecoveryWorktreeAvailable(
    projectRoot: string,
    planName: string,
    worktreeContext: RecoveryWorktreeContext | null,
    uiAPI: UiAPI,
    getWorktreeStatus: typeof getWorktreeStatusFn,
): Promise<boolean> {
    if (!hasWorktreeContext(worktreeContext)) return true;
    if (worktreeContext?.status === "abandoned") {
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because the recorded worktree is abandoned. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "RunWield",
        );
        return false;
    }
    if (!worktreeContext?.path) {
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because no worktree path is recorded. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "RunWield",
        );
        return false;
    }
    if (!(await pathExists(worktreeContext.path))) {
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because the recorded worktree path is missing or stale: ${worktreeContext.path}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "RunWield",
        );
        return false;
    }
    try {
        const status = await getWorktreeStatus({
            projectRoot: projectRoot,
            path: worktreeContext.path,
            branch: worktreeContext.branch,
            baseTree: worktreeContext.executionBaselineTree || worktreeContext.baseTree || worktreeContext.baseCommit,
        });
        if (!status.exists) {
            uiAPI.appendSystemMessage(
                `Cannot continue recovery for "${planName}" because the recorded worktree is missing or stale: ${worktreeContext.path}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
                true,
                "RunWield",
            );
            return false;
        }
        if (worktreeContext.branch && status.branch && status.branch !== worktreeContext.branch) {
            uiAPI.appendSystemMessage(
                `Cannot continue recovery for "${planName}" because the recorded worktree branch is stale: expected ${worktreeContext.branch}, found ${status.branch}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
                true,
                "RunWield",
            );
            return false;
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(
            `Cannot continue recovery for "${planName}" because the recorded worktree could not be inspected: ${reason}. Use Delete/recreate worktree and start over to recreate it explicitly.`,
            true,
            "RunWield",
        );
        return false;
    }
    return true;
}
