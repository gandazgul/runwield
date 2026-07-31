/**
 * Fail-closed resolver for Workflow Validation execution context.
 */

import { isPlannedChangeClassification } from "../../constants.js";
import { loadPlan, normalizeExecutionMode, updatePlanFrontMatter } from "../../plan-store.js";
import {
    adoptCanonicalPlanId,
    describeRegistryAmbiguity,
    findById as findWorktreeRegistryEntryById,
    findByPlanId as findWorktreeRegistryEntryByPlanId,
    findByPlanName as findWorktreeRegistryEntryByPlanName,
} from "../worktree-registry.js";
import { prepareExecutionPlanFile } from "./execution-plan-file.js";
import { recordWorkflowMetric } from "./metrics.js";
import { isInValidation } from "./plan-lifecycle.js";

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
 * @property {{ relativePath: string }} [restoredPlanFile]
 * @property {string[]} [selfHealNotices] - Recoveries applied while resolving; surfaced to the user as info, not errors.
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
 * @param {{ cwd: string, planName: string, reason: string, recovered?: boolean, planFileRestored?: boolean, recordWorkflowMetric?: typeof recordWorkflowMetric }} opts
 */
async function recordResolutionMetric({
    cwd,
    planName,
    reason,
    recovered = false,
    planFileRestored = false,
    recordWorkflowMetric: recordMetric = recordWorkflowMetric,
}) {
    await recordMetric({
        category: "validation",
        event: "execution_context_resolution",
        planName,
        details: { reason, recovered, planFileRestored },
    }, { cwd }).catch(() => {});
}

/**
 * @param {{ projectRoot: string, planName: string, triageMeta?: Record<string, unknown>, explicitContext?: any, activeWorkflow?: any, __deps?: { loadPlan?: typeof loadPlan, canonicalLoadPlan?: typeof loadPlan, prepareExecutionPlanFile?: typeof prepareExecutionPlanFile, findWorktreeRegistryEntryById?: typeof findWorktreeRegistryEntryById, findWorktreeRegistryEntryByPlanId?: typeof findWorktreeRegistryEntryByPlanId, findWorktreeRegistryEntryByPlanName?: typeof findWorktreeRegistryEntryByPlanName, recordWorkflowMetric?: typeof recordWorkflowMetric, runGit?: typeof runGit, realPath?: typeof realPath } }} opts
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
    const loadPlanFn = __deps.canonicalLoadPlan || __deps.loadPlan || loadPlan;
    const prepareExecutionPlanFileFn = __deps.prepareExecutionPlanFile || prepareExecutionPlanFile;
    const recordMetricFn = __deps.recordWorkflowMetric || recordWorkflowMetric;
    const findByIdFn = __deps.findWorktreeRegistryEntryById || findWorktreeRegistryEntryById;
    const findByPlanIdFn = __deps.findWorktreeRegistryEntryByPlanId || findWorktreeRegistryEntryByPlanId;
    const findByPlanNameFn = __deps.findWorktreeRegistryEntryByPlanName || findWorktreeRegistryEntryByPlanName;
    const runGitFn = __deps.runGit || runGit;
    const realPathFn = __deps.realPath || realPath;
    const plan = await loadPlanFn(projectRoot, planName);
    const attrs = plan?.attrs || triageMeta || {};
    if (!plan && isPlannedChangeClassification(attrs.classification)) {
        await recordResolutionMetric({
            recordWorkflowMetric: recordMetricFn,
            cwd: projectRoot,
            planName,
            reason: "missing_plan",
        });
        return blocked(
            "missing_plan",
            `Plan ${planName} could not be loaded; Workflow Validation requires a canonical implemented planned-change Plan.`,
        );
    }
    if (!isPlannedChangeClassification(attrs.classification)) {
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
    if (plan && !isInValidation(typeof attrs.status === "string" ? attrs.status : undefined)) {
        return blocked(
            "plan_not_implemented",
            `Plan ${planName} is ${
                attrs.status || "unknown"
            }; Workflow Validation requires a validation lifecycle status.`,
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
    const candidateWorktreeId = asString(candidate.worktreeId) || asString(attrs.worktreeId);
    const canonicalPlanId = asString(attrs.planId);
    /** @type {Awaited<ReturnType<typeof findWorktreeRegistryEntryById>>} */
    let recoveredRegistryEntry;
    try {
        recoveredRegistryEntry = candidateWorktreeId
            ? await findByIdFn(projectRoot, candidateWorktreeId)
            : canonicalPlanId
            ? await findByPlanIdFn(projectRoot, canonicalPlanId)
            : await findByPlanNameFn(projectRoot, planName);
    } catch (error) {
        // A damaged registry is RunWield's bookkeeping, not the user's mistake. Let it
        // block the operation, but as a blocked result carrying the commands that fix
        // it — an escaping exception here reached the user as a bare stack trace.
        const described = describeRegistryAmbiguity(error);
        if (!described) throw error;
        return blocked("worktree_registry_ambiguous", described);
    }
    const executionMode = normalizedCandidateMode || durableMode || (recoveredRegistryEntry ? "worktree" : undefined);
    if (!executionMode) {
        const hasCompleteLegacyWorktree = attrs.worktreeId && attrs.worktreePath && attrs.worktreeBranch;
        if (!hasCompleteLegacyWorktree) {
            await recordResolutionMetric({
                recordWorkflowMetric: recordMetricFn,
                cwd: projectRoot,
                planName,
                reason: "unknown_execution_mode",
            });
            return blocked(
                "unknown_execution_mode",
                `RunWield cannot tell where "${planName}" was implemented because the Plan has no execution mode and no recoverable worktree record. It will not validate the current checkout automatically, because that could mark unrelated changes as this Plan. Use /load-plan ${planName}, inspect the recovery report, then choose "Delete/recreate worktree and start over", "Reset tree and start over", or "Re-open for review".`,
            );
        }
    }

    if (executionMode === "non_git_in_place") {
        if (plan && attrs.executionMode !== "non_git_in_place" && selected.source !== "durable_recovery") {
            await updatePlanFrontMatter(
                projectRoot,
                planName,
                {
                    executionMode: "non_git_in_place",
                    deliveryEvidence: null,
                },
                attrs,
                { expectedRevision: plan.revision },
            );
        }
        await recordResolutionMetric({
            recordWorkflowMetric: recordMetricFn,
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
    const worktreeId = asString(recoveredRegistryEntry?.id) || candidateWorktreeId;
    const worktreePath = asString(recoveredRegistryEntry?.path) || candidateWorktreePath || recordedWorktreePath;
    const worktreeBranch = asString(recoveredRegistryEntry?.branch) || asString(candidate.worktreeBranch) ||
        asString(attrs.worktreeBranch);
    const worktreeBaseBranch = asString(recoveredRegistryEntry?.baseBranch) ||
        asString(candidate.worktreeBaseBranch) || asString(attrs.worktreeBaseBranch);
    let baselineTree = asString(recoveredRegistryEntry?.executionBaselineTree) ||
        asString(recoveredRegistryEntry?.baseTree) ||
        asString(candidate.baselineTree) || asString(attrs.executionBaselineTree);
    if (!worktreeId || !worktreePath || !worktreeBranch || !worktreeBaseBranch) {
        await recordResolutionMetric({
            recordWorkflowMetric: recordMetricFn,
            cwd: projectRoot,
            planName,
            reason: "incomplete_worktree_identity",
        });
        return blocked(
            "incomplete_worktree_identity",
            `RunWield found that "${planName}" should validate from a worktree, but the recorded worktree identity is incomplete. Use /load-plan ${planName}, inspect the recovery report, then choose "Delete/recreate worktree and start over" or "Re-open for review".`,
        );
    }
    if (candidate.planName && !planIdentityMatches(candidate.planName, planName)) {
        return blocked("plan_name_mismatch", `Execution context belongs to ${candidate.planName}, not ${planName}.`);
    }
    /** @type {string[]} */
    const selfHealNotices = [];
    if (attrs.planId && candidate.triageMeta?.planId && attrs.planId !== candidate.triageMeta.planId) {
        // The Plan name already matched above, which binds this context to this Plan.
        // A differing id therefore means the id was minted twice, not that two
        // different Plans met, so the canonical Plan's id wins and validation
        // continues. `attrs` is what flows downstream, and the session-scoped triage
        // copy is not durable state, so nothing is written and nothing is lost.
        // Blocking here stranded Plans at "implemented" over metadata RunWield owns.
        selfHealNotices.push(
            `Reconciled a stale in-session Plan ID for ${planName} to the canonical ${attrs.planId}. Continuing Workflow Validation.`,
        );
    }
    if (candidateWorktreePath && recoveredRegistryEntry?.path) {
        const canonicalCandidatePath = await realPathFn(candidateWorktreePath);
        const canonicalRegistryPath = await realPathFn(recoveredRegistryEntry.path);
        if (!canonicalCandidatePath || !canonicalRegistryPath || canonicalCandidatePath !== canonicalRegistryPath) {
            return blocked(
                "plan_worktree_path_mismatch",
                `Execution worktree path does not match the worktree registry for ${worktreeId}.`,
            );
        }
    }

    const registryEntry = recoveredRegistryEntry || await findByIdFn(projectRoot, worktreeId);
    if (!registryEntry) {
        return blocked(
            "missing_registry_entry",
            `RunWield has worktree metadata for "${planName}", but registry entry ${worktreeId} is missing. Use /load-plan ${planName}, inspect the recovery report, then choose "Delete/recreate worktree and start over" or "Re-open for review".`,
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
    if (candidate.worktreeBranch && registryEntry.branch !== candidate.worktreeBranch) {
        return blocked("registry_identity_mismatch", `Execution branch does not match the worktree registry.`);
    }
    if (candidate.worktreeBaseBranch && registryEntry.baseBranch !== candidate.worktreeBaseBranch) {
        return blocked("registry_identity_mismatch", `Execution target branch does not match the worktree registry.`);
    }
    // Every pairing check above has passed, so this entry is the attempt the
    // canonical Plan names. A registry planId that disagrees is therefore a
    // twice-minted id, and leaving it in place would make recovery-by-planId miss
    // this attempt later.
    if (asString(attrs.planId) && registryEntry.planId !== attrs.planId) {
        const adopted = await adoptCanonicalPlanId(projectRoot, worktreeId, {
            planName,
            planId: String(attrs.planId),
        }).catch((/** @type {unknown} */ error) => /** @type {import('../worktree-registry.js').PlanIdAdoption} */ ({
            rebound: false,
            reason: error instanceof Error ? error.message : String(error),
        }));
        if (adopted.rebound) {
            selfHealNotices.push(
                `Reconciled the worktree registry Plan ID for ${planName} to the canonical ${attrs.planId} (was ${
                    adopted.from ?? "unset"
                }).`,
            );
        }
    }
    if (!baselineTree) baselineTree = asString(registryEntry.executionBaselineTree) || asString(registryEntry.baseTree);
    if (registryEntry.executionBaselineTree && baselineTree && registryEntry.executionBaselineTree !== baselineTree) {
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
    if (!baselineTree) {
        const baselineRef = candidateBaseCommit || asString(registryEntry.baseCommit) || candidateBaseRef ||
            asString(registryEntry.baseRef);
        if (baselineRef) {
            baselineTree = await runGitFn(projectRoot, ["rev-parse", `${baselineRef}^{tree}`]);
        }
    }
    if (!baselineTree) {
        await recordResolutionMetric({
            recordWorkflowMetric: recordMetricFn,
            cwd: projectRoot,
            planName,
            reason: "incomplete_worktree_identity",
        });
        return blocked(
            "incomplete_worktree_identity",
            `RunWield found the worktree for "${planName}", but it cannot recover the execution baseline needed for validation. Use /load-plan ${planName}, inspect the recovery report, then choose "Delete/recreate worktree and start over" or "Re-open for review".`,
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
    if (!actualBaselineTree) {
        return blocked(
            "baseline_tree_mismatch",
            `Execution baseline tree for ${planName} is not valid in this repository.`,
        );
    }
    baselineTree = actualBaselineTree;

    const planFile = await prepareExecutionPlanFileFn({ projectRoot, executionCwd: canonicalWorktreePath, planName });
    // "reconciled" is as usable as "present": ensureExecutionPlanFile has already
    // synchronized the RunWield-owned metadata with the locked canonical Plan and
    // verified the bytes on disk. Rejecting it here strands validation at
    // "implemented" even though the execution copy is exactly what was approved.
    if (planFile.kind !== "present" && planFile.kind !== "restored" && planFile.kind !== "reconciled") {
        return blocked(
            `execution_plan_${planFile.kind}`,
            `Execution worktree Plan file ${planFile.relativePath} is not usable: ${planFile.reason || planFile.kind}`,
        );
    }
    const restoredPlanFile = planFile.kind === "restored" ? { relativePath: planFile.relativePath } : undefined;
    if (planFile.healedPlanId) {
        selfHealNotices.push(
            `Reconciled the execution worktree Plan ID for ${planName} to the canonical ${planFile.healedPlanId.to} (was ${
                planFile.healedPlanId.from ?? "unset"
            }). The superseded value remains in the worktree branch history. Continuing Workflow Validation.`,
        );
    }

    let persistedLegacyExecutionMode = false;
    if (plan && !attrs.worktreeId && worktreeId) {
        await updatePlanFrontMatter(projectRoot, planName, { worktreeId }, attrs, {
            expectedRevision: plan.revision,
        });
        persistedLegacyExecutionMode = attrs.executionMode !== "worktree";
    }
    await recordResolutionMetric({
        recordWorkflowMetric: recordMetricFn,
        cwd: projectRoot,
        planName,
        reason: selected.source,
        recovered: selected.source === "durable_recovery",
        planFileRestored: Boolean(restoredPlanFile),
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
        restoredPlanFile,
        ...(selfHealNotices.length > 0 ? { selfHealNotices } : {}),
    };
}
