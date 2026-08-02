/**
 * @module cmd/load-plan/plan-hold
 * Putting a Plan on hold, and the checks that decide whether it can come back.
 *
 * A hold records where the Plan was so resuming can return it there, and a
 * staleness baseline so the Resume Check can tell what moved underneath it.
 */

import { CLI_BIN } from "../../constants.js";
import { findPlansByParent as findPlansByParentFn } from "../../plan-store.js";
import { isEpicPlan, recordPlanEvent as recordPlanEventFn } from "../../shared/workflow/plan-lifecycle.js";
import { listCommitsTouchingPathsSince as listCommitsTouchingPathsSinceFn } from "../../shared/workflow/git-snapshot.js";
import { runRecoveryTransition } from "../../shared/workflow/state-transition.ts";
import {
    autoGenerateWorkRecordForCompletedPlan as autoGenerateWorkRecordForCompletedPlanFn,
    formatWorkRecordAutoGenerationResult,
} from "../../shared/work-records/auto-generation.js";
import {
    deleteMergedWorktreeBranch,
    getWorktreeStatus as getWorktreeStatusFn,
    inspectExecutionWorktreeMergeRisk as inspectExecutionWorktreeMergeRiskFn,
    removeWorktreeGitArtifacts as removeWorktreeGitArtifactsFn,
} from "../../shared/worktree.js";
import {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
    updateEntry as updateWorktreeRegistryEntryFn,
} from "../../shared/worktree-registry.js";
import { buildPlanSummary, formatCommitHeadsUp } from "./plan-presentation.ts";
import { formatEpicProgressSummary } from "./plan-epic-children.ts";
import { confirmWorktreeAction, hasWorktreeContext, resolveRecoveryWorktree } from "./plan-recovery-worktree.ts";
import { transitionFailureError } from "./transition-failure.ts";
import type { PlanFrontMatter } from "../../plan-store.js";
import type { UiAPI } from "../../ui/tui/types.js";

/** A Plan the hold flow reads Front Matter from. */
export interface HoldablePlan {
    planName: string;
    attrs: PlanFrontMatter;
}

/** A Plan loaded far enough to be summarised while held. */
export interface HeldPlanWithBody extends HoldablePlan {
    body: string;
    markdown?: string;
}

/** The worktree lookups the hold flow needs. */
export interface HoldWorktreeLookups {
    findWorktreeById: typeof findWorktreeByIdFn;
    findWorktreeByPlanName: typeof findWorktreeByPlanNameFn;
}

export interface PutPlanOnHoldOptions {
    projectRoot: string;
    plan: HoldablePlan;
    uiAPI: UiAPI;
    recordPlanEvent: typeof recordPlanEventFn;
    findPlansByParent: typeof findPlansByParentFn;
}

export interface MarkPlanUserVerifiedOptions {
    projectRoot: string;
    plan: HoldablePlan;
    uiAPI: UiAPI;
    recordPlanEvent: typeof recordPlanEventFn;
    autoGenerateWorkRecordForCompletedPlan: typeof autoGenerateWorkRecordForCompletedPlanFn;
}

export interface RunResumeCheckOptions extends HoldWorktreeLookups {
    projectRoot: string;
    plan: HoldablePlan;
    uiAPI: UiAPI;
    listCommitsTouchingPathsSince: typeof listCommitsTouchingPathsSinceFn;
    getWorktreeStatus: typeof getWorktreeStatusFn;
    inspectExecutionWorktreeMergeRisk: typeof inspectExecutionWorktreeMergeRiskFn;
}

/** What the Resume Check concluded, and what to tell the user about it. */
export interface ResumeCheckResult {
    status: "pass" | "warn" | "fail";
    messages: string[];
}

export interface ResetHeldPlanOptions extends HoldWorktreeLookups {
    projectRoot: string;
    plan: HoldablePlan;
    uiAPI: UiAPI;
    recordPlanEvent: typeof recordPlanEventFn;
    updateWorktreeRegistryEntry: typeof updateWorktreeRegistryEntryFn;
    removeWorktreeGitArtifacts: typeof removeWorktreeGitArtifactsFn;
}

export interface HandleOnHoldPlanOptions extends HoldWorktreeLookups {
    projectRoot: string;
    plan: HeldPlanWithBody;
    uiAPI: UiAPI;
    listCommitsTouchingPathsSince: typeof listCommitsTouchingPathsSinceFn;
    recordPlanEvent: typeof recordPlanEventFn;
    findPlansByParent: typeof findPlansByParentFn;
    updateWorktreeRegistryEntry: typeof updateWorktreeRegistryEntryFn;
    getWorktreeStatus: typeof getWorktreeStatusFn;
    inspectExecutionWorktreeMergeRisk: typeof inspectExecutionWorktreeMergeRiskFn;
    removeWorktreeGitArtifacts: typeof removeWorktreeGitArtifactsFn;
}

/**
 * @param {string | undefined} status
 * @returns {boolean}
 */
export function isHoldableStatus(status: string): boolean {
    return Boolean(status) && status !== "verified" && status !== "user_verified" &&
        status !== "closed_without_verification" && status !== "on_hold";
}

/**
 * @param {string | undefined} status
 * @returns {boolean}
 */
export function isUserVerifiableStatus(status: string): boolean {
    return Boolean(status) && [
        "draft",
        "feedback",
        "approved",
        "ready_for_decomposition",
        "ready_for_work",
        "in_progress",
        "implemented",
        "validated_ci",
        "validated_reviewer",
    ].includes(String(status));
}

/**
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} attrs
 * @returns {string | undefined}
 */
export function getHoldStalenessBaseline(attrs: PlanFrontMatter): string | undefined {
    return attrs.updatedAt || attrs.implementedAt || attrs.failedAt || attrs.createdAt || undefined;
}

/**
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} attrs
 * @returns {boolean}
 */
export function hasRecordedWorktreeMetadata(attrs: PlanFrontMatter): boolean {
    return Boolean(attrs.worktreeId || attrs.worktreePath || attrs.worktreeBranch || attrs.worktreeStatus);
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function confirmHoldWarning(uiAPI: UiAPI, message: string): Promise<boolean> {
    uiAPI.appendSystemMessage(message, true, "RunWield");
    const answer = await uiAPI.promptSelect("Put on hold?", [
        { value: "confirm", label: "Put on hold" },
        { value: "cancel", label: "Cancel" },
    ]);
    return answer === "confirm";
}

/**
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @returns {Promise<boolean>}
 */
export async function putPlanOnHold(
    { projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent }: PutPlanOnHoldOptions,
): Promise<boolean> {
    if (!isHoldableStatus(plan.attrs.status)) {
        uiAPI.appendSystemMessage(`Plans with status ${plan.attrs.status} cannot be put on hold.`, true, "RunWield");
        return false;
    }

    if (isEpicPlan(plan.attrs)) {
        const children = await findPlansByParent(projectRoot, plan.planName);
        const childSummary = children.length > 0 ? `\n\n${formatEpicProgressSummary(children)}` : "";
        const confirmed = await confirmHoldWarning(
            uiAPI,
            `Child Plans will be hidden/blocked while this Epic is on hold. Their statuses will not change.${childSummary}`,
        );
        if (!confirmed) return false;
    } else if (plan.attrs.parentPlan) {
        const confirmed = await confirmHoldWarning(
            uiAPI,
            "Only this child Planned Change will be held. The parent Epic and sibling Planned Change Plans stay active.",
        );
        if (!confirmed) return false;
    }

    let holdReason = "";
    if (typeof uiAPI.promptText === "function") {
        holdReason = String(await uiAPI.promptText("Optional hold reason:") || "").trim();
    }

    const updatedAttrs = await recordPlanEvent({
        cwd: projectRoot,
        planName: plan.planName,
        event: "plan_held",
        currentStatus: plan.attrs.status,
        details: {
            triageMeta: plan.attrs,
            holdReason: holdReason || undefined,
            holdStalenessBaseline: getHoldStalenessBaseline(plan.attrs),
        },
    });
    plan.attrs = { ...plan.attrs, ...updatedAttrs };
    uiAPI.appendSystemMessage(
        `Plan put on hold. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
        false,
        "RunWield",
    );
    return true;
}

/**
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof autoGenerateWorkRecordForCompletedPlanFn} opts.autoGenerateWorkRecordForCompletedPlan
 * @returns {Promise<boolean>}
 */
export async function markPlanUserVerified(
    { projectRoot, plan, uiAPI, recordPlanEvent, autoGenerateWorkRecordForCompletedPlan }: MarkPlanUserVerifiedOptions,
): Promise<boolean> {
    if (!isUserVerifiableStatus(plan.attrs.status)) {
        uiAPI.appendSystemMessage(
            `Plans with status ${plan.attrs.status} must be re-opened before User Verification.`,
            true,
            "RunWield",
        );
        return false;
    }
    uiAPI.appendSystemMessage(
        "User Verification records your attestation. RunWield Workflow Validation, verifiedAt, and Delivery Evidence will not be claimed.",
        false,
        "RunWield",
    );
    let note = "";
    while (!note) {
        if (typeof uiAPI.promptText !== "function") {
            uiAPI.appendSystemMessage(
                "Cannot mark User Verified: this UI cannot collect the required verification note.",
                true,
                "RunWield",
            );
            return false;
        }
        const entered = await uiAPI.promptText("Required user verification note (blank cancels):");
        if (entered === null || entered === undefined) return false;
        note = String(entered).trim();
        if (!note) {
            uiAPI.appendSystemMessage("A User Verification note is required.", true, "RunWield");
        }
    }
    const updatedAttrs = await recordPlanEvent({
        cwd: projectRoot,
        planName: plan.planName,
        event: "manual_user_verified",
        currentStatus: plan.attrs.status,
        details: { triageMeta: plan.attrs, userVerificationNote: note },
    });
    plan.attrs = { ...plan.attrs, ...updatedAttrs };
    let workRecordMessage = "";
    try {
        const result = await autoGenerateWorkRecordForCompletedPlan({ cwd: projectRoot, planName: plan.planName });
        workRecordMessage = ` ${result.message}`;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        workRecordMessage = ` ${
            formatWorkRecordAutoGenerationResult({
                status: "failed",
                planName: plan.planName,
                error: reason,
                message: "",
            })
        }`;
    }
    uiAPI.appendSystemMessage(
        `Plan marked User Verified. RunWield Workflow Validation was not claimed.${workRecordMessage}`,
        false,
        "RunWield",
    );
    return true;
}

/**
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof inspectExecutionWorktreeMergeRiskFn} opts.inspectExecutionWorktreeMergeRisk
 * @returns {Promise<{ status: "pass" | "warn" | "fail", messages: string[] }>}
 */
export async function runResumeCheck({
    projectRoot,
    plan,
    uiAPI: _uiAPI,
    listCommitsTouchingPathsSince,
    findWorktreeById,
    findWorktreeByPlanName,
    getWorktreeStatus,
    inspectExecutionWorktreeMergeRisk,
}: RunResumeCheckOptions): Promise<ResumeCheckResult> {
    const warnings = [];
    const failures = [];
    const worktreeContext = await resolveRecoveryWorktree(projectRoot, plan, {
        findWorktreeById,
        findWorktreeByPlanName,
    });

    if (hasRecordedWorktreeMetadata(plan.attrs)) {
        if (!worktreeContext?.path) {
            failures.push("Recorded worktree metadata exists, but no worktree path could be resolved.");
        } else {
            try {
                const status = await getWorktreeStatus({
                    projectRoot: projectRoot,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    baseTree: plan.attrs.executionBaselineTree || worktreeContext.executionBaselineTree ||
                        worktreeContext.baseTree || worktreeContext.baseCommit,
                });
                if (!status.exists) failures.push(`Recorded worktree is missing: ${worktreeContext.path}`);
                if (
                    status.exists && worktreeContext.branch && status.branch && status.branch !== worktreeContext.branch
                ) {
                    failures.push(
                        `Recorded branch mismatch: expected ${worktreeContext.branch}, found ${status.branch}.`,
                    );
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failures.push(`Could not inspect recorded worktree: ${message}`);
            }
        }

        if (worktreeContext?.branch) {
            try {
                /** @type {string[]} */
                const allowedDirtyPaths = [`plans/${plan.planName}.md`];
                const risk = await inspectExecutionWorktreeMergeRisk({
                    projectRoot: projectRoot,
                    branch: worktreeContext.branch,
                    allowedDirtyPaths,
                });
                warnings.push(...risk.warnings);
                failures.push(...risk.failures);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                warnings.push(`Could not inspect merge risk against primary checkout: ${message}`);
            }
        }
    }

    const affectedPaths = Array.isArray(plan.attrs.affectedPaths) ? plan.attrs.affectedPaths : [];
    const baseline = plan.attrs.holdStalenessBaseline || plan.attrs.updatedAt || plan.attrs.createdAt;
    if (baseline && affectedPaths.length > 0) {
        try {
            const commits = await listCommitsTouchingPathsSince(projectRoot, baseline, affectedPaths);
            if (commits.length > 0) {
                warnings.push([
                    `${commits.length} commit(s) touched affected paths since the Resume Check baseline (${baseline}).`,
                    ...formatCommitHeadsUp(commits),
                ].join("\n"));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Could not check affected path history for Resume Check: ${message}`);
        }
    }

    if (failures.length > 0) return { status: "fail", messages: failures };
    if (warnings.length > 0) return { status: "warn", messages: warnings };
    return { status: "pass", messages: ["Resume Check passed."] };
}

/**
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof removeWorktreeGitArtifactsFn} opts.removeWorktreeGitArtifacts
 * @returns {Promise<boolean>}
 */
export async function resetHeldPlanToDraft({
    projectRoot,
    plan,
    uiAPI,
    recordPlanEvent,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    removeWorktreeGitArtifacts,
}: ResetHeldPlanOptions): Promise<boolean> {
    const worktreeContext = await resolveRecoveryWorktree(projectRoot, plan, {
        findWorktreeById,
        findWorktreeByPlanName,
    });
    let action = "reset_keep";
    if (hasWorktreeContext(worktreeContext)) {
        action = String(
            await uiAPI.promptSelect("Reset status to draft and handle the recorded worktree:", [
                { value: "reset_keep", label: "Reset metadata and keep worktree for manual rescue" },
                { value: "reset_delete", label: "Delete worktree and reset metadata" },
                { value: "cancel", label: "Cancel" },
            ]) || "cancel",
        );
        if (action === "cancel") return false;
        if (action === "reset_delete") {
            const confirmed = await confirmWorktreeAction(
                plan.planName,
                uiAPI,
                "Delete worktree and reset status to draft",
            );
            if (!confirmed) return false;
        }
    } else {
        const confirmed = await uiAPI.promptSelect("Reset status to draft?", [
            { value: "confirm", label: "Reset status to draft" },
            { value: "cancel", label: "Cancel" },
        ]);
        if (confirmed !== "confirm") return false;
    }

    const transition = await runRecoveryTransition({
        projectRoot,
        planName: plan.planName,
        planId: plan.attrs.planId,
        worktreeId: worktreeContext?.id,
        expectedRevision: (plan as { revision?: string }).revision,
        action: action === "reset_delete" ? "abandon" : "reset",
        recover: async () => {
            if (action === "reset_delete" && worktreeContext?.path) {
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
                await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
            }
            return await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "hold_reset_to_draft",
                currentStatus: "on_hold",
                details: { triageMeta: plan.attrs },
            });
        },
    });
    if (transition.status !== "committed") {
        throw transitionFailureError(transition, "Hold reset recovery transaction failed.");
    }
    const transitionValue = (transition.value || {}) as { value?: PlanFrontMatter };
    const updatedAttrs = transitionValue.value as PlanFrontMatter;
    plan.attrs = { ...plan.attrs, ...updatedAttrs };
    uiAPI.appendSystemMessage(
        action === "reset_delete"
            ? "Plan reset to draft and recorded worktree deleted."
            : "Plan reset to draft. Recorded worktree was left untouched for manual rescue if present.",
        false,
        "RunWield",
    );
    return true;
}

/**
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown?: string }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof inspectExecutionWorktreeMergeRiskFn} opts.inspectExecutionWorktreeMergeRisk
 * @param {typeof removeWorktreeGitArtifactsFn} opts.removeWorktreeGitArtifacts
 * @returns {Promise<"resume" | "handled">}
 */
export async function handleOnHoldPlan({
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
    removeWorktreeGitArtifacts,
}: HandleOnHoldPlanOptions): Promise<"resume" | "handled"> {
    while (plan.attrs.status === "on_hold") {
        const answer = await uiAPI.promptSelect("This plan is on hold. What would you like to do?", [
            { value: "resume", label: "Resume from hold" },
            { value: "view", label: "View plan details" },
            { value: "reset", label: "Reset status to draft" },
            { value: "cancel", label: "Cancel / Keep on hold" },
        ]);
        if (!answer || answer === "cancel") return "handled";

        if (answer === "view") {
            uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
            continue;
        }

        if (answer === "reset") {
            const reset = await resetHeldPlanToDraft({
                projectRoot,
                plan,
                uiAPI,
                recordPlanEvent,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                removeWorktreeGitArtifacts,
            });
            if (reset) return "resume";
            continue;
        }

        if (answer === "resume") {
            if (!plan.attrs.heldFromStatus) {
                uiAPI.appendSystemMessage(
                    "Cannot resume from hold because heldFromStatus is missing. Use Reset status to draft or repair the plan metadata.",
                    true,
                    "RunWield",
                );
                continue;
            }
            const check = await runResumeCheck({
                projectRoot,
                plan,
                uiAPI,
                listCommitsTouchingPathsSince,
                findWorktreeById,
                findWorktreeByPlanName,
                getWorktreeStatus,
                inspectExecutionWorktreeMergeRisk,
            });
            uiAPI.appendSystemMessage(
                ["Resume Check:", ...check.messages.map((message) => `- ${message}`)].join("\n"),
                check.status !== "pass",
                "RunWield",
            );
            if (check.status === "fail") {
                uiAPI.appendSystemMessage(
                    "Resume Check failed. The Plan will stay on hold until you choose recovery.",
                    true,
                    "RunWield",
                );
                continue;
            }
            if (check.status === "warn") {
                const proceed = await uiAPI.promptSelect("Resume Check found warnings. What would you like to do?", [
                    { value: "proceed", label: "Proceed with resume" },
                    { value: "keep", label: "Keep on hold" },
                ]);
                if (proceed !== "proceed") continue;
            }
            const restoredStatus = plan.attrs.heldFromStatus;
            const updatedAttrs = await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "hold_resumed",
                currentStatus: "on_hold",
                details: { triageMeta: plan.attrs, heldFromStatus: restoredStatus },
            });
            plan.attrs = { ...plan.attrs, ...updatedAttrs };
            uiAPI.appendSystemMessage(`Resumed from hold. Restored status: ${plan.attrs.status}.`, false, "RunWield");
            if (isEpicPlan(plan.attrs)) {
                const children = await findPlansByParent(projectRoot, plan.planName);
                if (children.length > 0) {
                    uiAPI.appendSystemMessage(formatEpicProgressSummary(children), false, "RunWield");
                }
            }
            return "resume";
        }
    }
    return "resume";
}
