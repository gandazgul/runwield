// @ts-nocheck: extracted from checked JSDoc workflow.js; tightening types is out of scope for this structural split.
import { loadPlan } from "../../plan-store.js";
import { checkpointExecutionWorktree } from "../worktree.js";
import {
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { isInValidation, recordPlanEvent } from "./plan-lifecycle.js";
import { recordWorkflowMetric } from "./metrics.js";
import { runImplementationCheckpointTransition } from "./state-transition.ts";

/**
 * @typedef {Object} FinalizePlanImplementationOptions
 * @property {string} projectRoot
 * @property {string} planName
 * @property {Partial<import('../../plan-store.js').PlanFrontMatter>} [triageMeta]
 * @property {import('../session/hosted-session.js').ActiveExecutionWorkflow | null | undefined} executionContext
 * @property {string} [executionReport]
 * @property {import('../session/hosted-session.js').HostedSession} [hostedSession]
 * @property {{
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   loadPlan?: typeof loadPlan,
 *   markActiveWorktreeStatus?: typeof markActiveWorktreeStatus,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   runImplementationCheckpointTransition?: typeof runImplementationCheckpointTransition,
 * }} [ports]
 */

/**
 * Commit all execution-worktree changes before Plan or registry state can say
 * implementation is complete. The returned context is authoritative; this
 * boundary must not depend on volatile Hosted Session state being retained.
 *
 * @param {FinalizePlanImplementationOptions} options
 * @returns {Promise<{ implementationCommit?: string }>}
 */
export async function finalizePlanImplementation({
    projectRoot,
    planName,
    triageMeta = {},
    executionContext,
    executionReport,
    hostedSession,
    ports = {},
}) {
    if (!executionContext) {
        throw new Error(`Cannot complete ${planName}: durable execution context is missing.`);
    }

    const loadPlanImpl = ports.loadPlan || loadPlan;
    const markActiveWorktreeStatusImpl = ports.markActiveWorktreeStatus || markActiveWorktreeStatus;
    const recordWorkflowMetricImpl = ports.recordWorkflowMetric || recordWorkflowMetric;
    // The real transaction runs in tests too. This used to swap itself for a fake
    // "committed" result whenever certain dependencies happened to be injected, which
    // left the implementation checkpoint — the thing that keeps committed work and the
    // Plan's claim about it in step — with no coverage at all, and made production
    // behavior depend on which seams a caller passed.
    const runImplementationCheckpointTransitionImpl = ports.runImplementationCheckpointTransition ||
        runImplementationCheckpointTransition;
    // Older tests and partial recovery paths may not provide a loadable primary
    // Plan; keep the legacy in_progress assumption in that case.
    const currentPlan = await (async () => {
        try {
            return await loadPlanImpl(projectRoot, planName);
        } catch {
            return null;
        }
    })();
    const primaryStatus = currentPlan?.attrs?.status;
    if (isInValidation(primaryStatus) || primaryStatus === "verified" || primaryStatus === "user_verified") {
        return {};
    }
    if (primaryStatus && primaryStatus !== "in_progress" && primaryStatus !== "ready_for_work") {
        throw new Error(
            `Cannot complete ${planName}: primary Plan status is "${primaryStatus}", expected "in_progress" or "ready_for_work".`,
        );
    }
    const transition = await runImplementationCheckpointTransitionImpl({
        projectRoot,
        planName,
        planId: typeof triageMeta.planId === "string" ? triageMeta.planId : undefined,
        worktreeId: executionContext.worktreeId,
        expectedRevision: currentPlan?.revision,
        checkpoint: async ({ markEffect }) => {
            /** @type {string | undefined} */
            let implementationCommit;
            if (executionContext.executionMode === "worktree") {
                if (!executionContext.executionCwd || !executionContext.worktreeBranch) {
                    throw new Error(
                        `Cannot complete ${planName}: worktree execution context is missing its path or branch.`,
                    );
                }
                const checkpoint = await checkpointExecutionWorktree({
                    worktreePath: executionContext.executionCwd,
                    branch: executionContext.worktreeBranch,
                    planName,
                    planDescription: typeof triageMeta.summary === "string" ? triageMeta.summary : undefined,
                });
                implementationCommit = checkpoint.executionCommit;
                await markEffect("implementation_checkpoint_settled", {
                    implementationCommit,
                    worktreeId: executionContext.worktreeId,
                    worktreeBranch: executionContext.worktreeBranch,
                });
            } else if (
                executionContext.executionMode !== "non_git_in_place" &&
                executionContext.nonGitInPlace !== true
            ) {
                throw new Error(`Cannot complete ${planName}: execution mode is missing or unknown.`);
            }
            if (primaryStatus === "ready_for_work") {
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName,
                    event: "execution_started",
                    currentStatus: "ready_for_work",
                    details: {
                        triageMeta,
                        nonGitInPlace: executionContext.nonGitInPlace === true,
                        executionMode: executionContext.executionMode,
                        executionBaselineTree: executionContext.baselineTree,
                        worktreeId: executionContext.worktreeId,
                        worktreePath: executionContext.executionCwd,
                        worktreeBranch: executionContext.worktreeBranch,
                        worktreeBaseBranch: executionContext.worktreeBaseBranch,
                        worktreeStatus: executionContext.executionMode === "worktree" ? "active" : undefined,
                    },
                });
            }
            await recordPlanEvent({
                cwd: projectRoot,
                planName,
                event: "implementation_finished",
                currentStatus: "in_progress",
                details: {
                    triageMeta,
                    nonGitInPlace: executionContext.nonGitInPlace === true,
                    executionMode: executionContext.executionMode,
                    executionBaselineTree: executionContext.baselineTree,
                    worktreeId: executionContext.worktreeId,
                    worktreePath: executionContext.executionCwd,
                    worktreeBranch: executionContext.worktreeBranch,
                    worktreeBaseBranch: executionContext.worktreeBaseBranch,
                    executionReport,
                },
            });
            await markActiveWorktreeStatusImpl("completed", { hostedSession, workflow: executionContext });
            return implementationCommit ? { implementationCommit } : {};
        },
    });
    if (transition.status !== "committed") {
        throw new Error(transition.message || `Implementation checkpoint did not commit for ${planName}.`);
    }
    const transitionValue = /** @type {{ value?: { implementationCommit?: string } }} */ (transition.value);
    const implementationCommit = transitionValue.value?.implementationCommit;
    await recordWorkflowMetricImpl({
        category: "execution",
        event: "implementation_finished",
        planName,
        details: {
            classification: triageMeta.classification,
            executionMode: executionContext.executionMode,
            checkpointCommitted: Boolean(implementationCommit),
        },
    }, { cwd: projectRoot });
    return implementationCommit ? { implementationCommit } : {};
}
export async function markActiveWorktreeStatus(status, opts = {}) {
    const workflow = opts.workflow || opts.hostedSession?.getActiveExecutionWorkflow();
    if (!workflow?.worktreeId || !status || status === "none") return;
    if (!workflow.projectRoot) throw new Error("markActiveWorktreeStatus: workflow projectRoot is required");
    if (status === "merged") {
        await removeWorktreeRegistryEntry(workflow.projectRoot, workflow.worktreeId);
        return;
    }
    await updateWorktreeRegistryEntry(workflow.projectRoot, workflow.worktreeId, { status });
}
