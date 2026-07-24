/**
 * Fail-closed resolver for Workflow Validation execution context.
 */

import { loadPlan, normalizeExecutionMode, updatePlanFrontMatter } from "../../plan-store.js";
import { findById as findWorktreeRegistryEntryById } from "../worktree-registry.js";
import { recordWorkflowMetric } from "./metrics.js";

const VALIDATION_ELIGIBLE_WORKTREE_STATUSES = new Set(["active", "completed", "validation_failed", "merge_conflict"]);

/**
 * @typedef {Object} ResolvedWorktreeValidationContext
 * @property {"worktree"} executionMode
 * @property {string} planName
 * @property {string} projectRoot
 * @property {string} executionCwd
 * @property {string} [baselineTree]
 * @property {string} [worktreeId]
 * @property {string} [worktreeBranch]
 * @property {string} [worktreeBaseBranch]
 * @property {string} [worktreeBaseRef]
 * @property {string} [worktreeBaseCommit]
 * @property {"explicit"|"active_session"|"durable_recovery"} source
 */

/**
 * @typedef {Object} ResolvedNonGitValidationContext
 * @property {"non_git_in_place"} executionMode
 * @property {string} planName
 * @property {string} projectRoot
 * @property {string} executionCwd
 * @property {"explicit"|"active_session"|"durable_recovery"} source
 */

/** @typedef {ResolvedWorktreeValidationContext|ResolvedNonGitValidationContext} ResolvedValidationContext */

/**
 * @typedef {Object} BlockedValidationContext
 * @property {"blocked"} kind
 * @property {string} reason
 * @property {string} message
 */

/**
 * @typedef {Object} ValidationContextResolutionOk
 * @property {"ok"} kind
 * @property {ResolvedValidationContext} context
 * @property {boolean} [persistedLegacyExecutionMode]
 */

/** @typedef {ValidationContextResolutionOk|BlockedValidationContext} ValidationContextResolution */

/** @param {string} cwd @param {string[]} args */
async function runGit(cwd, args) {
    const command = new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    if (output.code !== 0) throw new Error(stderr || stdout || `git ${args.join(" ")} failed`);
    return stdout;
}

/** @param {unknown} value */
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value */
function asString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** @param {unknown} value */
function normalizePlanIdentity(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
function planIdentityMatches(left, right) {
    const normalizedLeft = normalizePlanIdentity(left);
    const normalizedRight = normalizePlanIdentity(right);
    return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

/**
 * @param {string} reason
 * @param {string} message
 * @returns {BlockedValidationContext}
 */
function blocked(reason, message) {
    return { kind: "blocked", reason, message };
}

/** @param {unknown} value */
async function realPath(value) {
    if (!isNonEmptyString(value)) return undefined;
    try {
        return await Deno.realPath(String(value));
    } catch {
        return undefined;
    }
}

/**
 * @param {{ explicitContext?: any, activeWorkflow?: any }} opts
 */
function selectCandidateContext({ explicitContext, activeWorkflow }) {
    if (explicitContext?.planName) return { source: /** @type {const} */ ("explicit"), context: explicitContext };
    if (activeWorkflow?.planName) return { source: /** @type {const} */ ("active_session"), context: activeWorkflow };
    return { source: /** @type {const} */ ("durable_recovery"), context: null };
}

/**
 * @param {{ cwd: string, planName: string, reason: string, recovered?: boolean }} opts
 */
async function recordResolutionMetric({ cwd, planName, reason, recovered = false }) {
    await recordWorkflowMetric({
        category: "validation",
        event: "execution_context_resolution",
        planName,
        details: { reason, recovered },
    }, { cwd }).catch(() => {});
}

/**
 * @param {{ projectRoot: string, planName: string, triageMeta?: Record<string, unknown>, explicitContext?: any, activeWorkflow?: any, __deps?: { loadPlan?: typeof loadPlan, findWorktreeRegistryEntryById?: typeof findWorktreeRegistryEntryById, updatePlanFrontMatter?: typeof updatePlanFrontMatter, recordWorkflowMetric?: typeof recordWorkflowMetric, runGit?: typeof runGit, realPath?: typeof realPath } }} opts
 * @returns {Promise<ValidationContextResolution>}
 */
export async function resolveValidationExecutionContext({
    projectRoot,
    planName,
    triageMeta = {},
    explicitContext,
    activeWorkflow,
    __deps = {},
}) {
    const loadPlanFn = __deps.loadPlan || loadPlan;
    const findByIdFn = __deps.findWorktreeRegistryEntryById || findWorktreeRegistryEntryById;
    const updatePlanFrontMatterFn = __deps.updatePlanFrontMatter || updatePlanFrontMatter;
    const runGitFn = __deps.runGit || runGit;
    const realPathFn = __deps.realPath || realPath;
    const plan = await loadPlanFn(projectRoot, planName);
    const attrs = plan?.attrs || triageMeta || {};
    if (!plan && attrs.classification === "FEATURE") {
        await recordResolutionMetric({ cwd: projectRoot, planName, reason: "missing_plan" });
        return blocked(
            "missing_plan",
            `Plan ${planName} could not be loaded; Workflow Validation requires a canonical implemented FEATURE Plan.`,
        );
    }
    if (attrs.classification !== "FEATURE") {
        return {
            kind: "ok",
            context: {
                executionMode: "worktree",
                planName,
                projectRoot,
                executionCwd: activeWorkflow?.executionCwd || projectRoot,
                baselineTree: activeWorkflow?.baselineTree,
                worktreeId: activeWorkflow?.worktreeId,
                worktreeBranch: activeWorkflow?.worktreeBranch,
                worktreeBaseBranch: activeWorkflow?.worktreeBaseBranch,
                worktreeBaseRef: activeWorkflow?.worktreeBaseRef,
                worktreeBaseCommit: activeWorkflow?.worktreeBaseCommit,
                source: activeWorkflow?.planName ? "active_session" : "durable_recovery",
            },
        };
    }
    if (plan && attrs.status !== "implemented") {
        return blocked(
            "plan_not_implemented",
            `Plan ${planName} is ${attrs.status || "unknown"}; Workflow Validation requires implemented.`,
        );
    }

    if (explicitContext?.planName && activeWorkflow?.planName) {
        for (
            const [key, explicitValue, activeValue] of [
                [
                    "planName",
                    normalizePlanIdentity(explicitContext.planName),
                    normalizePlanIdentity(activeWorkflow.planName),
                ],
                [
                    "executionMode",
                    normalizeExecutionMode(explicitContext.executionMode),
                    normalizeExecutionMode(activeWorkflow.executionMode),
                ],
                ["executionCwd", asString(explicitContext.executionCwd), asString(activeWorkflow.executionCwd)],
                ["worktreeId", asString(explicitContext.worktreeId), asString(activeWorkflow.worktreeId)],
                ["worktreeBranch", asString(explicitContext.worktreeBranch), asString(activeWorkflow.worktreeBranch)],
                [
                    "worktreeBaseBranch",
                    asString(explicitContext.worktreeBaseBranch),
                    asString(activeWorkflow.worktreeBaseBranch),
                ],
                ["baselineTree", asString(explicitContext.baselineTree), asString(activeWorkflow.baselineTree)],
                [
                    "worktreeBaseRef",
                    asString(explicitContext.worktreeBaseRef),
                    asString(activeWorkflow.worktreeBaseRef),
                ],
                [
                    "worktreeBaseCommit",
                    asString(explicitContext.worktreeBaseCommit),
                    asString(activeWorkflow.worktreeBaseCommit),
                ],
            ]
        ) {
            if (explicitValue && activeValue && explicitValue !== activeValue) {
                return blocked(
                    "execution_context_mismatch",
                    `Explicit execution context ${key} contradicts the active execution workflow.`,
                );
            }
        }
    }

    const selected = selectCandidateContext({ explicitContext, activeWorkflow });
    const candidate = selected.context || {};
    const candidateMode = candidate.nonGitInPlace === true ? "non_git_in_place" : candidate.executionMode;
    const normalizedCandidateMode = normalizeExecutionMode(candidateMode);
    const durableMode = normalizeExecutionMode(attrs.executionMode);
    if (normalizedCandidateMode && durableMode && normalizedCandidateMode !== durableMode) {
        return blocked(
            "execution_mode_mismatch",
            `Execution context mode ${normalizedCandidateMode} contradicts Plan metadata mode ${durableMode}.`,
        );
    }
    const executionMode = normalizedCandidateMode || durableMode;
    if (!executionMode) {
        const hasCompleteLegacyWorktree = attrs.worktreeId && attrs.worktreePath && attrs.worktreeBranch &&
            attrs.executionBaselineTree;
        if (!hasCompleteLegacyWorktree) {
            await recordResolutionMetric({ cwd: projectRoot, planName, reason: "unknown_execution_mode" });
            return blocked(
                "unknown_execution_mode",
                `Plan ${planName} has no execution mode. Run Plan Recovery; RunWield will not infer in-place execution from missing worktree state.`,
            );
        }
    }

    if (executionMode === "non_git_in_place") {
        if (plan && attrs.executionMode !== "non_git_in_place" && selected.source !== "durable_recovery") {
            await updatePlanFrontMatterFn(projectRoot, planName, {
                executionMode: "non_git_in_place",
                deliveryEvidence: null,
            }, attrs);
        }
        await recordResolutionMetric({
            cwd: projectRoot,
            planName,
            reason: selected.source,
            recovered: selected.source === "durable_recovery",
        });
        return {
            kind: "ok",
            context: {
                executionMode: "non_git_in_place",
                planName,
                projectRoot,
                executionCwd: projectRoot,
                source: selected.source,
            },
            persistedLegacyExecutionMode: attrs.executionMode !== "non_git_in_place",
        };
    }

    const candidateWorktreePath = asString(candidate.executionCwd) && candidate.executionCwd !== projectRoot
        ? asString(candidate.executionCwd)
        : undefined;
    const recordedWorktreePath = asString(attrs.worktreePath);
    const worktreeId = asString(candidate.worktreeId) || asString(attrs.worktreeId);
    const worktreePath = candidateWorktreePath || recordedWorktreePath;
    const worktreeBranch = asString(candidate.worktreeBranch) || asString(attrs.worktreeBranch);
    const worktreeBaseBranch = asString(candidate.worktreeBaseBranch) || asString(attrs.worktreeBaseBranch);
    const baselineTree = asString(candidate.baselineTree) || asString(attrs.executionBaselineTree);
    if (!worktreeId || !worktreePath || !worktreeBranch || !worktreeBaseBranch || !baselineTree) {
        await recordResolutionMetric({ cwd: projectRoot, planName, reason: "incomplete_worktree_identity" });
        return blocked(
            "incomplete_worktree_identity",
            `Plan ${planName} is missing worktree delivery identity; run Plan Recovery.`,
        );
    }
    if (candidate.planName && !planIdentityMatches(candidate.planName, planName)) {
        return blocked("plan_name_mismatch", `Execution context belongs to ${candidate.planName}, not ${planName}.`);
    }
    if (attrs.planId && candidate.triageMeta?.planId && attrs.planId !== candidate.triageMeta.planId) {
        return blocked("plan_id_mismatch", `Execution context Plan ID does not match ${planName}.`);
    }
    for (
        const [key, expected, actual] of [
            ["worktreeId", attrs.worktreeId, worktreeId],
            ["worktreeBranch", attrs.worktreeBranch, worktreeBranch],
            ["worktreeBaseBranch", attrs.worktreeBaseBranch, worktreeBaseBranch],
            ["executionBaselineTree", attrs.executionBaselineTree, baselineTree],
        ]
    ) {
        if (expected && actual && expected !== actual) {
            return blocked(`${key}_mismatch`, `Execution ${key} does not match Plan metadata.`);
        }
    }

    if (candidateWorktreePath && recordedWorktreePath) {
        const canonicalCandidatePath = await realPathFn(candidateWorktreePath);
        const canonicalRecordedPath = await realPathFn(recordedWorktreePath);
        if (!canonicalCandidatePath || !canonicalRecordedPath || canonicalCandidatePath !== canonicalRecordedPath) {
            return blocked(
                "plan_worktree_path_mismatch",
                `Execution worktree path does not match Plan metadata for ${worktreeId}.`,
            );
        }
    }

    const registryEntry = await findByIdFn(projectRoot, worktreeId);
    if (!registryEntry) {
        return blocked(
            "missing_registry_entry",
            `Worktree registry entry ${worktreeId} is missing; run Plan Recovery.`,
        );
    }
    if (!planIdentityMatches(registryEntry.planName, planName)) {
        return blocked(
            "registry_plan_mismatch",
            `Worktree registry entry ${worktreeId} belongs to ${registryEntry.planName}.`,
        );
    }
    if (!VALIDATION_ELIGIBLE_WORKTREE_STATUSES.has(registryEntry.status)) {
        return blocked(
            "registry_status_not_validation_eligible",
            `Worktree registry entry ${worktreeId} is ${registryEntry.status}, not validation-eligible.`,
        );
    }
    if (registryEntry.branch !== worktreeBranch || registryEntry.baseBranch !== worktreeBaseBranch) {
        return blocked(
            "registry_identity_mismatch",
            `Worktree registry identity for ${worktreeId} does not match Plan metadata.`,
        );
    }
    if (registryEntry.executionBaselineTree && registryEntry.executionBaselineTree !== baselineTree) {
        return blocked(
            "registry_base_tree_mismatch",
            `Worktree registry execution baseline for ${worktreeId} does not match Plan metadata.`,
        );
    }
    const candidateBaseCommit = asString(candidate.worktreeBaseCommit) || asString(candidate.baseCommit);
    if (candidateBaseCommit && registryEntry.baseCommit && registryEntry.baseCommit !== candidateBaseCommit) {
        return blocked(
            "registry_base_commit_mismatch",
            `Worktree registry base commit for ${worktreeId} does not match execution context.`,
        );
    }
    const candidateBaseRef = asString(candidate.worktreeBaseRef) || asString(candidate.baseRef);
    if (candidateBaseRef && registryEntry.baseRef && registryEntry.baseRef !== candidateBaseRef) {
        return blocked(
            "registry_base_ref_mismatch",
            `Worktree registry base ref for ${worktreeId} does not match execution context.`,
        );
    }
    const canonicalRegistryPath = await realPathFn(registryEntry.path);
    const canonicalWorktreePath = await realPathFn(worktreePath);
    if (!canonicalRegistryPath || !canonicalWorktreePath || canonicalRegistryPath !== canonicalWorktreePath) {
        return blocked(
            "worktree_path_mismatch",
            `Recorded worktree path for ${worktreeId} is unavailable or inconsistent.`,
        );
    }
    const executionPlan = await loadPlanFn(canonicalWorktreePath, planName);
    if (!executionPlan) {
        return blocked(
            "execution_plan_missing",
            `Execution worktree ${worktreeId} does not contain Plan ${planName}.`,
        );
    }
    if (attrs.planId && executionPlan.attrs.planId && attrs.planId !== executionPlan.attrs.planId) {
        return blocked(
            "execution_plan_id_mismatch",
            `Execution worktree Plan ID does not match canonical Plan ${planName}.`,
        );
    }
    const projectCommonDir = await runGitFn(projectRoot, ["rev-parse", "--git-common-dir"]);
    const worktreeCommonDir = await runGitFn(canonicalWorktreePath, ["rev-parse", "--git-common-dir"]);
    const projectCommonReal = await realPathFn(
        projectCommonDir.startsWith("/") ? projectCommonDir : `${projectRoot}/${projectCommonDir}`,
    );
    const worktreeCommonReal = await realPathFn(
        worktreeCommonDir.startsWith("/") ? worktreeCommonDir : `${canonicalWorktreePath}/${worktreeCommonDir}`,
    );
    if (!projectCommonReal || !worktreeCommonReal || projectCommonReal !== worktreeCommonReal) {
        return blocked(
            "git_common_dir_mismatch",
            `Execution worktree ${worktreeId} is not attached to the Project repository.`,
        );
    }
    const checkedOutBranch = await runGitFn(canonicalWorktreePath, ["branch", "--show-current"]);
    if (checkedOutBranch !== worktreeBranch) {
        return blocked(
            "worktree_branch_mismatch",
            `Execution worktree is on ${checkedOutBranch || "detached HEAD"}, not ${worktreeBranch}.`,
        );
    }
    await runGitFn(projectRoot, ["rev-parse", `refs/heads/${worktreeBaseBranch}`]);
    const actualBaselineTree = await runGitFn(canonicalWorktreePath, ["rev-parse", `${baselineTree}^{tree}`]);
    if (actualBaselineTree !== baselineTree) {
        return blocked(
            "baseline_tree_mismatch",
            `Execution baseline tree for ${planName} is not valid in this repository.`,
        );
    }

    let persistedLegacyExecutionMode = false;
    if (plan && attrs.executionMode !== "worktree") {
        await updatePlanFrontMatterFn(
            projectRoot,
            planName,
            { executionMode: "worktree", deliveryEvidence: null },
            attrs,
        );
        persistedLegacyExecutionMode = true;
    }
    await recordResolutionMetric({
        cwd: projectRoot,
        planName,
        reason: selected.source,
        recovered: selected.source === "durable_recovery",
    });
    return {
        kind: "ok",
        context: {
            executionMode: "worktree",
            planName,
            projectRoot,
            executionCwd: canonicalWorktreePath,
            baselineTree,
            worktreeId,
            worktreeBranch,
            worktreeBaseBranch,
            worktreeBaseRef: candidateBaseRef,
            worktreeBaseCommit: candidateBaseCommit,
            source: selected.source,
        },
        persistedLegacyExecutionMode,
    };
}
