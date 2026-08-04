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

type PlanFrontMatter = import("../../plan-store.js").PlanFrontMatter;
type ResolutionSource = "explicit" | "active_session" | "durable_recovery";
type ScalarValue = string | number | boolean | null | undefined;
export interface ExecutionContextCandidate {
    planName?: string;
    projectRoot?: string;
    triageMeta?: Pick<PlanFrontMatter, "planId">;
    executionMode?: "worktree" | "non_git_in_place" | null;
    executionCwd?: string | null;
    baselineTree?: string | null;
    worktreeId?: string | null;
    worktreeBranch?: string | null;
    worktreeBaseBranch?: string | null;
    worktreeBaseRef?: string | null;
    worktreeBaseCommit?: string | null;
    nonGitInPlace?: boolean;
    baseCommit?: string;
    baseRef?: string;
}

export interface ResolvedWorktreeValidationContext {
    executionMode: "worktree";
    planName: string;
    projectRoot: string;
    executionCwd: string;
    baselineTree?: string;
    worktreeId?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    worktreeBaseRef?: string;
    worktreeBaseCommit?: string;
    source: ResolutionSource;
}

export interface ResolvedNonGitValidationContext {
    executionMode: "non_git_in_place";
    planName: string;
    projectRoot: string;
    executionCwd: string;
    source: ResolutionSource;
}

export type ResolvedValidationContext = ResolvedWorktreeValidationContext | ResolvedNonGitValidationContext;

export interface BlockedValidationContext {
    kind: "blocked";
    reason: string;
    message: string;
}

export interface ValidationContextResolutionOk {
    kind: "ok";
    context: ResolvedValidationContext;
    persistedLegacyExecutionMode?: boolean;
    restoredPlanFile?: { relativePath: string };
    selfHealNotices?: string[];
}

export type ValidationContextResolution = ValidationContextResolutionOk | BlockedValidationContext;

interface CandidateSelection {
    source: ResolutionSource;
    context: ExecutionContextCandidate | null;
}

interface ResolutionMetricOptions {
    cwd: string;
    planName: string;
    reason: string;
    recovered?: boolean;
    planFileRestored?: boolean;
}

export interface ResolveValidationExecutionContextOptions {
    projectRoot: string;
    planName: string;
    triageMeta?: Partial<PlanFrontMatter>;
    explicitContext?: ExecutionContextCandidate;
    activeWorkflow?: ExecutionContextCandidate | null;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const command = new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    if (output.code !== 0) throw new Error(stderr || stdout || `git ${args.join(" ")} failed`);
    return stdout;
}

function isNonEmptyString(value: ScalarValue): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function asString(value: ScalarValue): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePlanIdentity(value: ScalarValue): string {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function planIdentityMatches(left: ScalarValue, right: ScalarValue): boolean {
    const normalizedLeft = normalizePlanIdentity(left);
    const normalizedRight = normalizePlanIdentity(right);
    return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function blocked(reason: string, message: string): BlockedValidationContext {
    return { kind: "blocked", reason, message };
}

async function realPath(value: string | undefined): Promise<string | undefined> {
    if (!isNonEmptyString(value)) return undefined;
    try {
        return await Deno.realPath(String(value));
    } catch {
        return undefined;
    }
}

function selectCandidateContext(
    { explicitContext, activeWorkflow }: Pick<
        ResolveValidationExecutionContextOptions,
        "explicitContext" | "activeWorkflow"
    >,
): CandidateSelection {
    if (explicitContext?.planName) return { source: "explicit", context: explicitContext };
    if (activeWorkflow?.planName) return { source: "active_session", context: activeWorkflow };
    return { source: "durable_recovery", context: null };
}

async function recordResolutionMetric({
    cwd,
    planName,
    reason,
    recovered = false,
    planFileRestored = false,
}: ResolutionMetricOptions): Promise<void> {
    await recordWorkflowMetric({
        category: "validation",
        event: "execution_context_resolution",
        planName,
        details: { reason, recovered, planFileRestored },
    }, cwd).catch(() => {});
}

export async function resolveValidationExecutionContext({
    projectRoot,
    planName,
    triageMeta = {},
    explicitContext,
    activeWorkflow,
}: ResolveValidationExecutionContextOptions): Promise<ValidationContextResolution> {
    const plan = await loadPlan(projectRoot, planName);
    const attrs = plan?.attrs || triageMeta || {};
    if (!plan && isPlannedChangeClassification(attrs.classification)) {
        await recordResolutionMetric({
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
        const executionMode = activeWorkflow?.nonGitInPlace === true ||
                activeWorkflow?.executionMode === "non_git_in_place"
            ? "non_git_in_place"
            : "worktree";
        return {
            kind: "ok",
            context: {
                executionMode,
                planName,
                projectRoot,
                executionCwd: executionMode === "non_git_in_place"
                    ? projectRoot
                    : activeWorkflow?.executionCwd || projectRoot,
                baselineTree: executionMode === "worktree" ? asString(activeWorkflow?.baselineTree) : undefined,
                worktreeId: executionMode === "worktree" ? asString(activeWorkflow?.worktreeId) : undefined,
                worktreeBranch: executionMode === "worktree" ? asString(activeWorkflow?.worktreeBranch) : undefined,
                worktreeBaseBranch: executionMode === "worktree"
                    ? asString(activeWorkflow?.worktreeBaseBranch)
                    : undefined,
                worktreeBaseRef: executionMode === "worktree" ? asString(activeWorkflow?.worktreeBaseRef) : undefined,
                worktreeBaseCommit: executionMode === "worktree"
                    ? asString(activeWorkflow?.worktreeBaseCommit)
                    : undefined,
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
    let recoveredRegistryEntry: Awaited<ReturnType<typeof findWorktreeRegistryEntryById>>;
    try {
        recoveredRegistryEntry = candidateWorktreeId
            ? await findWorktreeRegistryEntryById(projectRoot, candidateWorktreeId)
            : canonicalPlanId
            ? await findWorktreeRegistryEntryByPlanId(projectRoot, canonicalPlanId)
            : await findWorktreeRegistryEntryByPlanName(projectRoot, planName);
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
    const selfHealNotices: string[] = [];
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
        const canonicalCandidatePath = await realPath(candidateWorktreePath);
        const canonicalRegistryPath = await realPath(recoveredRegistryEntry.path);
        if (!canonicalCandidatePath || !canonicalRegistryPath || canonicalCandidatePath !== canonicalRegistryPath) {
            return blocked(
                "plan_worktree_path_mismatch",
                `Execution worktree path does not match the worktree registry for ${worktreeId}.`,
            );
        }
    }

    const registryEntry = recoveredRegistryEntry || await findWorktreeRegistryEntryById(projectRoot, worktreeId);
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
        }).catch((error) => ({
            rebound: false,
            from: undefined,
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
            baselineTree = await runGit(projectRoot, ["rev-parse", `${baselineRef}^{tree}`]);
        }
    }
    if (!baselineTree) {
        await recordResolutionMetric({
            cwd: projectRoot,
            planName,
            reason: "incomplete_worktree_identity",
        });
        return blocked(
            "incomplete_worktree_identity",
            `RunWield found the worktree for "${planName}", but it cannot recover the execution baseline needed for validation. Use /load-plan ${planName}, inspect the recovery report, then choose "Delete/recreate worktree and start over" or "Re-open for review".`,
        );
    }
    const canonicalRegistryPath = await realPath(registryEntry.path);
    const canonicalWorktreePath = await realPath(worktreePath);
    if (!canonicalRegistryPath || !canonicalWorktreePath || canonicalRegistryPath !== canonicalWorktreePath) {
        return blocked(
            "worktree_path_mismatch",
            `Recorded worktree path for ${worktreeId} is unavailable or inconsistent.`,
        );
    }
    const projectCommonDir = await runGit(projectRoot, ["rev-parse", "--git-common-dir"]);
    const worktreeCommonDir = await runGit(canonicalWorktreePath, ["rev-parse", "--git-common-dir"]);
    const projectCommonReal = await realPath(
        projectCommonDir.startsWith("/") ? projectCommonDir : `${projectRoot}/${projectCommonDir}`,
    );
    const worktreeCommonReal = await realPath(
        worktreeCommonDir.startsWith("/") ? worktreeCommonDir : `${canonicalWorktreePath}/${worktreeCommonDir}`,
    );
    if (!projectCommonReal || !worktreeCommonReal || projectCommonReal !== worktreeCommonReal) {
        return blocked(
            "git_common_dir_mismatch",
            `Execution worktree ${worktreeId} is not attached to the Project repository.`,
        );
    }
    const checkedOutBranch = await runGit(canonicalWorktreePath, ["branch", "--show-current"]);
    if (checkedOutBranch !== worktreeBranch) {
        return blocked(
            "worktree_branch_mismatch",
            `Execution worktree is on ${checkedOutBranch || "detached HEAD"}, not ${worktreeBranch}.`,
        );
    }
    await runGit(projectRoot, ["rev-parse", `refs/heads/${worktreeBaseBranch}`]);
    const actualBaselineTree = await runGit(canonicalWorktreePath, ["rev-parse", `${baselineTree}^{tree}`]);
    if (!actualBaselineTree) {
        return blocked(
            "baseline_tree_mismatch",
            `Execution baseline tree for ${planName} is not valid in this repository.`,
        );
    }
    baselineTree = actualBaselineTree;

    const hasStoredMergeRepairCandidate = attrs.status === "validated_reviewer" &&
        typeof attrs.validationMergeRepairWorktree === "string" &&
        attrs.validationMergeRepairWorktree.length > 0;
    let restoredPlanFile: { relativePath: string } | undefined;
    if (!hasStoredMergeRepairCandidate) {
        const planFile = await prepareExecutionPlanFile({ projectRoot, executionCwd: canonicalWorktreePath, planName });
        // "reconciled" is as usable as "present": ensureExecutionPlanFile has already
        // synchronized the RunWield-owned metadata with the locked canonical Plan and
        // verified the bytes on disk. Rejecting it here strands validation at
        // "implemented" even though the execution copy is exactly what was approved.
        if (planFile.kind !== "present" && planFile.kind !== "restored" && planFile.kind !== "reconciled") {
            return blocked(
                `execution_plan_${planFile.kind}`,
                `Execution worktree Plan file ${planFile.relativePath} is not usable: ${
                    planFile.reason || planFile.kind
                }`,
            );
        }
        restoredPlanFile = planFile.kind === "restored" ? { relativePath: planFile.relativePath } : undefined;
        if (planFile.healedPlanId) {
            selfHealNotices.push(
                `Reconciled the execution worktree Plan ID for ${planName} to the canonical ${planFile.healedPlanId.to} (was ${
                    planFile.healedPlanId.from ?? "unset"
                }). The superseded value remains in the worktree branch history. Continuing Workflow Validation.`,
            );
        }
    } else {
        // The detached repair merge already contains the execution Plan metadata
        // staged by the successful validation attempt. The canonical Plan
        // intentionally remains validated_reviewer until that merge is published.
        // Reconciling its status back into the execution branch would create a new
        // metadata commit that the repaired merge cannot possibly contain.
        selfHealNotices.push(
            `Preserving the staged execution Plan for ${planName} while resuming its repaired Direct Delivery merge.`,
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
