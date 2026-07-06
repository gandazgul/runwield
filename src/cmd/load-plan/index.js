/**
 * @module cmd/load-plan
 * Load-plan command implementation. Loads a saved plan from disk and continues
 * work on it (review/edit/execute), distinct from /resume which restores a
 * previous chat session.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { AGENTS, CLI_BIN, CWD } from "../../constants.js";
import {
    compareChildPlansByOrder,
    findPlansByParent as findPlansByParentFn,
    injectFrontMatter,
    loadPlan as loadPlanFn,
    resolvePlan as resolvePlanFn,
    resolveSiblingChildPlanDependencies as resolveSiblingChildPlanDependenciesFn,
    updatePlanFrontMatter as updatePlanFrontMatterFn,
} from "../../plan-store.js";
import {
    askApprovalWithTasks as askApprovalWithTasksFn,
    askPostApproval as askPostApprovalFn,
    askProjectDecompositionApproval as askProjectDecompositionApprovalFn,
    ensureSlicerTasks as ensureSlicerTasksFn,
    executePlan as executePlanFn,
    runPlanningAgent as runPlanningAgentFn,
} from "../../shared/workflow/workflow.js";
import {
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
} from "../../shared/workflow/decisions.js";
import {
    isEpicPlan,
    isExecutablePlanStatus,
    recordPlanEvent as recordPlanEventFn,
} from "../../shared/workflow/plan-lifecycle.js";
import {
    getWorkflowDiff as getWorkflowDiffFn,
    listCommitsTouchingPathsSince as listCommitsTouchingPathsSinceFn,
    restoreWorktreeTree as restoreWorktreeTreeFn,
} from "../../shared/workflow/git-snapshot.js";
import {
    createExecutionWorktree as createExecutionWorktreeFn,
    getWorktreeStatus as getWorktreeStatusFn,
    inspectExecutionWorktreeMergeRisk as inspectExecutionWorktreeMergeRiskFn,
    mergeExecutionWorktree as mergeExecutionWorktreeFn,
    removeExecutionWorktree as removeExecutionWorktreeFn,
} from "../../shared/worktree.js";
import {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
    removeEntry as removeWorktreeRegistryEntryFn,
    updateEntry as updateWorktreeRegistryEntryFn,
} from "../../shared/worktree-registry.js";
import { runValidationLoop as runValidationLoopFn } from "../../shared/workflow/validation.js";
import { runSlicerAgent as runSlicerAgentFn } from "../../shared/workflow/workflow-slicer.js";
import { submitPlanForReview as submitPlanForReviewFn } from "../../shared/workflow/submit-plan.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import {
    setActiveAgent as setActiveAgentFn,
    startInteractiveSession as startInteractiveSessionFn,
} from "../../shared/interactive/chat-session.js";
import { shouldCleanupMergedWorktrees as shouldCleanupMergedWorktreesFn } from "../../shared/settings.js";
import { setTerminalTitleForName as setTerminalTitleForNameFn } from "../../shared/ui/terminal-title.js";
import { resetTuiState as resetTuiStateFn } from "../command-helpers.js";
import { createAgentHandler as createAgentHandlerFn } from "../../shared/session/agent-handler.js";
export { getLoadPlanCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef LoadPlanTestDeps
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof resolvePlanFn} [resolvePlan]
 * @property {typeof executePlanFn} [executePlan]
 * @property {typeof runPlanningAgentFn} [runPlanningAgent]
 * @property {typeof decidePostPlanningFn} [decidePostPlanning]
 * @property {typeof decidePostExecutionFn} [decidePostExecution]
 * @property {typeof submitPlanForReviewFn} [submitPlanForReview]
 * @property {typeof askPostApprovalFn} [askPostApproval]
 * @property {typeof askApprovalWithTasksFn} [askApprovalWithTasks]
 * @property {typeof askProjectDecompositionApprovalFn} [askProjectDecompositionApproval]
 * @property {typeof ensureSlicerTasksFn} [ensureSlicerTasks]
 * @property {typeof runValidationLoopFn} [runValidationLoop]
 * @property {typeof runSlicerAgentFn} [runSlicerAgent]
 * @property {typeof loadPlanFn} [loadPlan]
 * @property {typeof getWorkflowDiffFn} [getWorkflowDiff]
 * @property {typeof listCommitsTouchingPathsSinceFn} [listCommitsTouchingPathsSince]
 * @property {typeof restoreWorktreeTreeFn} [restoreWorktreeTree]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof createAgentHandlerFn} [createAgentHandler]
 * @property {typeof resetTuiStateFn} [resetTuiState]
 * @property {() => string | null} [getRootAgentName]
 * @property {(cwd: string) => Promise<Array<{name: string, attrs: Partial<import('../../plan-store.js').PlanFrontMatter>}>>} [listPlans]
 * @property {typeof findPlansByParentFn} [findPlansByParent]
 * @property {typeof resolveSiblingChildPlanDependenciesFn} [resolveSiblingChildPlanDependencies]
 * @property {typeof recordPlanEventFn} [recordPlanEvent]
 * @property {typeof updatePlanFrontMatterFn} [updatePlanFrontMatter]
 * @property {typeof findWorktreeByIdFn} [findWorktreeById]
 * @property {typeof findWorktreeByPlanNameFn} [findWorktreeByPlanName]
 * @property {typeof updateWorktreeRegistryEntryFn} [updateWorktreeRegistryEntry]
 * @property {typeof getWorktreeStatusFn} [getWorktreeStatus]
 * @property {typeof createExecutionWorktreeFn} [createExecutionWorktree]
 * @property {typeof inspectExecutionWorktreeMergeRiskFn} [inspectExecutionWorktreeMergeRisk]
 * @property {typeof mergeExecutionWorktreeFn} [mergeExecutionWorktree]
 * @property {typeof removeExecutionWorktreeFn} [removeExecutionWorktree]
 * @property {typeof removeWorktreeRegistryEntryFn} [removeWorktreeRegistryEntry]
 * @property {typeof shouldCleanupMergedWorktreesFn} [shouldCleanupMergedWorktrees]
 * @property {typeof setTerminalTitleForNameFn} [setTerminalTitleForName]
 */

/**
 * Restore the agent that owned the session before load-plan command work.
 *
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {string} agentName
 * @param {import('../../shared/session/hosted-session.js').HostedSession} hostedSession
 * @param {LoadPlanTestDeps} [deps]
 */
function restorePreviousAgentFlow(uiAPI, agentName, hostedSession, deps = {}) {
    const {
        resetTuiState: resetTuiStateDep,
        setActiveAgent: setActiveAgentDep,
        createAgentHandler: createAgentHandlerDep,
    } = deps;

    const resetTuiState = resetTuiStateDep || resetTuiStateFn;
    const rawSetActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createAgentHandler = createAgentHandlerDep || createAgentHandlerFn;
    const handler = createAgentHandler(agentName, { hostedSession });

    resetTuiState(undefined, uiAPI, undefined);
    if (setActiveAgentDep) {
        setActiveAgentDep(agentName, handler, uiAPI);
    } else {
        rawSetActiveAgent(hostedSession, agentName, handler, uiAPI);
    }
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
 * Extract a markdown section by its `## <name>` heading. Returns the body up to
 * (but not including) the next `## ` heading, or null if not found.
 *
 * @param {string} body
 * @param {string} name
 * @returns {string | null}
 */
function extractSection(body, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const match = body.match(re);
    return match ? match[2].trim() : null;
}

/**
 * Remove the `## Tasks` section (and any following `### Slice Details` block,
 * including `#### Task N` sub-blocks) from a plan body. Strips up to the next
 * `##` heading or end of file. Returns the body unchanged if no Tasks heading
 * is present.
 *
 * @param {string} body
 * @returns {string}
 */
export function stripTasksSection(body) {
    const re = /(^|\n)##\s+Tasks\s*\n[\s\S]*?(?=\n##\s|$)/i;
    if (!re.test(body)) return body;
    const stripped = body.replace(re, "$1").replace(/\n{3,}/g, "\n\n").trimEnd();
    return stripped + "\n";
}

/**
 * Strip the Tasks + Slice Details blocks from a plan file in-place and write
 * the result back. Used when the user re-opens an approved/completed plan for
 * review — slicer output must be discarded so the architect → slicer flow can
 * regenerate tasks against any revised design.
 *
 * @param {{ path: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @returns {Promise<void>}
 */
async function stripTasksFromPlanFile(plan) {
    const stripped = stripTasksSection(plan.body);
    if (stripped === plan.body) return;
    plan.body = stripped;
    const withFm = injectFrontMatter(stripped, plan.attrs);
    await Deno.writeTextFile(plan.path, withFm);
}

/**
 * Build a compact summary view of a plan: front matter highlights plus the
 * Context and Objective sections (when present).
 *
 * @param {{ attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown?: string }} plan
 * @returns {string}
 */
function buildPlanSummary(plan) {
    const a = plan.attrs;
    const lines = [
        `Classification: ${a.classification}`,
        `Complexity:     ${a.complexity}`,
        `Status:         ${a.status}`,
        `Summary:        ${a.summary || "(none)"}`,
    ];
    if (a.affectedPaths?.length) {
        lines.push(`Affected paths:`);
        for (const p of a.affectedPaths) lines.push(`  - ${p}`);
    }

    const sections = [];
    const context = extractSection(plan.body, "Context");
    if (context) sections.push(`── Context ──\n${context}`);
    const objective = extractSection(plan.body, "Objective");
    if (objective) sections.push(`── Objective ──\n${objective}`);

    return [lines.join("\n"), ...sections].join("\n\n");
}

/**
 * Build the resume request handed to the planning agent.
 *
 * @param {string} planName
 * @param {{ classification: string, complexity: string, summary: string, affectedPaths?: string[], status: string }} attrs
 * @returns {string}
 */
function buildResumeRequest(planName, attrs) {
    return [
        `## Resuming Plan: ${planName}`,
        "",
        `This plan was previously saved with status: ${attrs.status}.`,
        `Continue working on it. The plan is at plans/${planName}.md.`,
        "",
        "## Triage Report",
        `- Classification: ${attrs.classification}`,
        `- Complexity: ${attrs.complexity}`,
        `- Summary: ${attrs.summary}`,
        `- Affected paths: ${(attrs.affectedPaths || []).join(", ")}`,
        "",
        "Review the current plan, make any needed updates, and finalize it.",
        "If requirements are unclear, ask clarification questions via user_interview before locking changes.",
        "When the plan is ready, call plan_written to submit it for review.",
    ].join("\n");
}

/**
 * Build the prompt that re-runs the planner after the user submits feedback on a
 * previously approved plan that was re-opened for review.
 *
 * @param {string} planName
 * @param {string | undefined} feedback
 * @returns {string}
 */
function buildReReviewRevisionRequest(planName, feedback) {
    return [
        `## Plan Review Re-opened: ${planName}`,
        "",
        "The user provided feedback on the previously approved plan:",
        "",
        feedback || "(no specific feedback provided)",
        "",
        `Revise plans/${planName}.md based on this feedback using the edit tool.`,
        "Then call plan_written again to submit the revision for review.",
    ].join("\n");
}

/**
 * @param {Array<{hash: string, date: string, subject: string}>} commits
 * @returns {string[]}
 */
function formatCommitHeadsUp(commits) {
    const maxVisible = 12;
    const visible = commits.slice(0, maxVisible).map((commit) =>
        `  - ${commit.hash} ${commit.date} ${commit.subject}`.trimEnd()
    );
    if (commits.length > maxVisible) {
        visible.push(`  - ...and ${commits.length - maxVisible} more`);
    }
    return visible;
}

/**
 * Warn when affected paths have changed after the plan timestamp, and confirm
 * before execution starts.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} opts.triageMeta
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @returns {Promise<boolean>}
 */
async function confirmAffectedPathChangesBeforeExecution({
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
        commits = await listCommitsTouchingPathsSince(CWD, timestamp, affectedPaths);
    } catch (error) {
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
 * @param {string | undefined} status
 * @returns {boolean}
 */
function isHoldableStatus(status) {
    return Boolean(status) && status !== "verified" && status !== "closed_without_verification" && status !== "on_hold";
}

/**
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} attrs
 * @returns {string | undefined}
 */
function getHoldStalenessBaseline(attrs) {
    return attrs.updatedAt || attrs.implementedAt || attrs.failedAt || attrs.createdAt || undefined;
}

/**
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} attrs
 * @returns {boolean}
 */
function hasRecordedWorktreeMetadata(attrs) {
    return Boolean(attrs.worktreeId || attrs.worktreePath || attrs.worktreeBranch || attrs.worktreeStatus);
}

/**
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {string} message
 * @returns {Promise<boolean>}
 */
async function confirmHoldWarning(uiAPI, message) {
    uiAPI.appendSystemMessage(message, true, "RunWield");
    const answer = await uiAPI.promptSelect("Put on hold?", [
        { value: "confirm", label: "Put on hold" },
        { value: "cancel", label: "Cancel" },
    ]);
    return answer === "confirm";
}

/**
 * @param {Object} opts
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @returns {Promise<boolean>}
 */
async function putPlanOnHold({ plan, uiAPI, recordPlanEvent, findPlansByParent }) {
    if (!isHoldableStatus(plan.attrs.status)) {
        uiAPI.appendSystemMessage(`Plans with status ${plan.attrs.status} cannot be put on hold.`, true, "RunWield");
        return false;
    }

    if (isEpicPlan(plan.attrs)) {
        const children = await findPlansByParent(CWD, plan.planName);
        const childSummary = children.length > 0 ? `\n\n${formatEpicProgressSummary(children)}` : "";
        const confirmed = await confirmHoldWarning(
            uiAPI,
            `Child FEATURE Plans will be hidden/blocked while this Epic is on hold. Their statuses will not change.${childSummary}`,
        );
        if (!confirmed) return false;
    } else if (plan.attrs.parentPlan) {
        const confirmed = await confirmHoldWarning(
            uiAPI,
            "Only this child FEATURE will be held. The parent Epic and sibling FEATURE Plans stay active.",
        );
        if (!confirmed) return false;
    }

    let holdReason = "";
    if (typeof uiAPI.promptText === "function") {
        holdReason = String(await uiAPI.promptText("Optional hold reason:") || "").trim();
    }

    const updatedAttrs = await recordPlanEvent({
        cwd: CWD,
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
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof inspectExecutionWorktreeMergeRiskFn} opts.inspectExecutionWorktreeMergeRisk
 * @returns {Promise<{ status: "pass" | "warn" | "fail", messages: string[] }>}
 */
async function runResumeCheck({
    plan,
    uiAPI: _uiAPI,
    listCommitsTouchingPathsSince,
    findWorktreeById,
    findWorktreeByPlanName,
    getWorktreeStatus,
    inspectExecutionWorktreeMergeRisk,
}) {
    const warnings = [];
    const failures = [];
    const worktreeContext = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });

    if (hasRecordedWorktreeMetadata(plan.attrs)) {
        if (!worktreeContext?.path) {
            failures.push("Recorded worktree metadata exists, but no worktree path could be resolved.");
        } else {
            try {
                const status = await getWorktreeStatus({
                    projectRoot: CWD,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    baseTree: plan.attrs.executionBaselineTree || worktreeContext.baseTree,
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
                const allowedDirtyPaths = [
                    `plans/${plan.planName}.md`,
                    ".wld/",
                    ".wld/worktrees.json",
                    ".wld/worktrees.lock",
                ];
                const risk = await inspectExecutionWorktreeMergeRisk({
                    projectRoot: CWD,
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
            const commits = await listCommitsTouchingPathsSince(CWD, baseline, affectedPaths);
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
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof removeExecutionWorktreeFn} opts.removeExecutionWorktree
 * @returns {Promise<boolean>}
 */
async function resetHeldPlanToDraft({
    plan,
    uiAPI,
    recordPlanEvent,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    removeExecutionWorktree,
}) {
    const worktreeContext = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });
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
            if (worktreeContext?.path) {
                await removeExecutionWorktree({
                    projectRoot: CWD,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    force: true,
                });
            }
            if (worktreeContext?.id) {
                await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "abandoned" });
            }
        }
    } else {
        const confirmed = await uiAPI.promptSelect("Reset status to draft?", [
            { value: "confirm", label: "Reset status to draft" },
            { value: "cancel", label: "Cancel" },
        ]);
        if (confirmed !== "confirm") return false;
    }

    const updatedAttrs = await recordPlanEvent({
        cwd: CWD,
        planName: plan.planName,
        event: "hold_reset_to_draft",
        currentStatus: "on_hold",
        details: { triageMeta: plan.attrs },
    });
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
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown?: string }} opts.plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof inspectExecutionWorktreeMergeRiskFn} opts.inspectExecutionWorktreeMergeRisk
 * @param {typeof removeExecutionWorktreeFn} opts.removeExecutionWorktree
 * @returns {Promise<"resume" | "handled">}
 */
async function handleOnHoldPlan({
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
    removeExecutionWorktree,
}) {
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
                plan,
                uiAPI,
                recordPlanEvent,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                removeExecutionWorktree,
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
                cwd: CWD,
                planName: plan.planName,
                event: "hold_resumed",
                currentStatus: "on_hold",
                details: { triageMeta: plan.attrs, heldFromStatus: restoredStatus },
            });
            plan.attrs = { ...plan.attrs, ...updatedAttrs };
            uiAPI.appendSystemMessage(`Resumed from hold. Restored status: ${plan.attrs.status}.`, false, "RunWield");
            if (isEpicPlan(plan.attrs)) {
                const children = await findPlansByParent(CWD, plan.planName);
                if (children.length > 0) {
                    uiAPI.appendSystemMessage(formatEpicProgressSummary(children), false, "RunWield");
                }
            }
            return "resume";
        }
    }
    return "resume";
}

/**
 * @param {unknown} executionResult
 * @param {string} planName
 * @param {string} fallbackPlanContent
 * @param {import('../../plan-store.js').PlanFrontMatter} triageMeta
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof runValidationLoopFn} runValidationLoop
 * @param {typeof loadPlanFn} loadPlan
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {import('../../shared/session/hosted-session.js').HostedSession} hostedSession
 */
async function validateCompletedExecution(
    executionResult,
    planName,
    fallbackPlanContent,
    triageMeta,
    uiAPI,
    runValidationLoop,
    loadPlan,
    worktreeContext,
    hostedSession,
) {
    if (!hostedSession) throw new Error("validateCompletedExecution: hostedSession is required");
    if (!(executionResult && typeof executionResult === "object" && "executionComplete" in executionResult)) return;
    if (!/** @type {{ executionComplete?: boolean }} */ (executionResult).executionComplete) return;
    let planContent = fallbackPlanContent;
    try {
        const latestPlan = await loadPlan(CWD, planName);
        planContent = latestPlan?.markdown || latestPlan?.body || fallbackPlanContent;
    } catch {
        // Keep fallback content in tests or if the plan was removed.
    }
    if (triageMeta.executionBaselineTree) {
        /** @type {{ planName: string, triageMeta: import('../../plan-store.js').PlanFrontMatter, baselineTree: string, projectRoot?: string, executionCwd?: string, worktreeId?: string, worktreeBranch?: string }} */
        const workflow = {
            planName,
            triageMeta,
            baselineTree: triageMeta.executionBaselineTree,
        };
        const executionCwd = worktreeContext?.path || triageMeta.worktreePath;
        const worktreeId = worktreeContext?.id || triageMeta.worktreeId;
        const worktreeBranch = worktreeContext?.branch || triageMeta.worktreeBranch;
        if (executionCwd || worktreeId || worktreeBranch) workflow.projectRoot = CWD;
        if (executionCwd) workflow.executionCwd = executionCwd;
        if (worktreeId) workflow.worktreeId = worktreeId;
        if (worktreeBranch) workflow.worktreeBranch = worktreeBranch;
        hostedSession.setActiveExecutionWorkflow(workflow);
    }
    await runValidationLoop({
        hostedSession,
        planName,
        planContent,
        triageMeta,
        uiAPI,
        sessionManager: undefined,
    });
}

/**
 * @param {Object} opts
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} opts.executionDecision
 * @param {string} opts.fallbackPlanContent
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {import('../../shared/session/hosted-session.js').HostedSession} opts.hostedSession
 * @returns {Promise<void>}
 */
async function validatePostExecutionDecision({
    executionDecision,
    fallbackPlanContent,
    uiAPI,
    runValidationLoop,
    loadPlan,
    hostedSession,
}) {
    if (!hostedSession) throw new Error("validatePostExecutionDecision: hostedSession is required");
    if (executionDecision.kind !== "run_validation") return;

    const planName = /** @type {string} */ (executionDecision.payload.planName);
    const triageMeta = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (
        executionDecision.payload.triageMeta
    );

    await validateCompletedExecution(
        { executionComplete: true },
        planName,
        fallbackPlanContent,
        triageMeta,
        uiAPI,
        runValidationLoop,
        loadPlan,
        null,
        hostedSession,
    );
}

/**
 * Execute an approved post-planning decision and run validation when execution
 * completes. Returns true when the decision was handled as execution.
 *
 * @param {Object} opts
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} opts.decision
 * @param {string} opts.fallbackPlanContent
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof executePlanFn} opts.executePlan
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {import('../../shared/session/hosted-session.js').HostedSession} opts.hostedSession
 * @returns {Promise<boolean>}
 */
async function executePostPlanningDecision({
    decision,
    fallbackPlanContent,
    uiAPI,
    executePlan,
    decidePostExecution,
    runValidationLoop,
    loadPlan,
    listCommitsTouchingPathsSince,
    hostedSession,
}) {
    if (!hostedSession) throw new Error("executePostPlanningDecision: hostedSession is required");
    if (decision.kind !== "execute_plan") return false;

    const planName = /** @type {string} */ (decision.payload.planName);
    const triageMeta = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (decision.payload.triageMeta);
    const tasks = /** @type {import('../../shared/workflow/workflow.js').PlanOutcomeResult["tasks"]} */ (
        decision.payload.tasks
    );

    const confirmed = await confirmAffectedPathChangesBeforeExecution({
        planName,
        triageMeta,
        uiAPI,
        listCommitsTouchingPathsSince,
    });
    if (!confirmed) return true;

    const execRes = await executePlan(planName, triageMeta, uiAPI, tasks, undefined, { hostedSession });
    const executionDecision = decidePostExecution(execRes, {
        planName,
        triageMeta,
        executionAgentName: AGENTS.ENGINEER,
    });
    await validatePostExecutionDecision({
        executionDecision,
        fallbackPlanContent,
        uiAPI,
        runValidationLoop,
        loadPlan,
        hostedSession,
    });
    return true;
}

/**
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} decision
 * @returns {boolean}
 */
function shouldKeepPlanningAgentActive(decision) {
    return decision.kind === "stay_with_agent" || decision.kind === "halt";
}

/**
 * Run the Readiness Gate for an approved Plan.
 *
 * @param {{ planName: string, path: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof ensureSlicerTasksFn} ensureSlicerTasks
 * @param {typeof recordPlanEventFn} recordPlanEvent
 * @param {import('../../shared/session/hosted-session.js').HostedSession} hostedSession
 * @returns {Promise<boolean>}
 */
async function prepareApprovedPlanForWork(plan, uiAPI, ensureSlicerTasks, recordPlanEvent, hostedSession) {
    if (isEpicPlan(plan.attrs)) {
        await recordPlanEvent({
            cwd: CWD,
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

    if (plan.attrs.classification === "PROJECT") {
        const sliceResult = await ensureSlicerTasks({
            planName: plan.planName,
            planPath: plan.path,
            triageMeta: plan.attrs,
            uiAPI,
            hostedSession,
        });
        if (!sliceResult.ok) {
            uiAPI.appendSystemMessage(
                `Readiness Gate failed before execution: ${sliceResult.error}`,
                true,
                "RunWield",
            );
            return false;
        }
    }

    await recordPlanEvent({
        cwd: CWD,
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
 * @param {{ planName: string, markdown?: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof executePlanFn} opts.executePlan
 * @param {typeof runPlanningAgentFn} opts.runPlanningAgent
 * @param {typeof decidePostPlanningFn} opts.decidePostPlanning
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof setActiveAgentFn} opts.setActiveAgent
 * @param {typeof createAgentHandlerFn} opts.createAgentHandler
 * @param {import('../../shared/session/hosted-session.js').HostedSession} opts.hostedSession
 * @returns {Promise<void>}
 */
async function executeReadyPlanWithRepair({
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
    setActiveAgent,
    createAgentHandler,
    hostedSession,
}) {
    if (!hostedSession) throw new Error("executeReadyPlanWithRepair: hostedSession is required");
    const MAX_REPAIR_ATTEMPTS = 2;
    let currentPlanName = plan.planName;
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    let currentMeta = plan.attrs;
    /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }> | undefined} */
    let currentTasks = undefined;

    const confirmed = await confirmAffectedPathChangesBeforeExecution({
        planName: currentPlanName,
        triageMeta: currentMeta,
        uiAPI,
        listCommitsTouchingPathsSince,
    });
    if (!confirmed) return;

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
        const execRes = await executePlan(currentPlanName, currentMeta, uiAPI, currentTasks, undefined, {
            hostedSession,
        });
        const executionDecision = decidePostExecution(execRes, {
            planName: currentPlanName,
            triageMeta: /** @type {import('../../tools/plan-written.js').TriageMeta} */ (currentMeta),
            executionAgentName: agentName,
        });
        if (executionDecision.kind !== "repair_plan") {
            await validatePostExecutionDecision({
                executionDecision,
                fallbackPlanContent: plan.markdown || plan.body || "",
                uiAPI,
                runValidationLoop,
                loadPlan,
                hostedSession,
            });
            break;
        }

        if (attempt === MAX_REPAIR_ATTEMPTS) {
            uiAPI.appendSystemMessage(
                `Execution failed after ${MAX_REPAIR_ATTEMPTS} repair attempts. Aborting.`,
                true,
                "RunWield",
            );
            break;
        }

        uiAPI.appendSystemMessage(
            `Execution failed due to task table error. Rerouting to ${agentName} for repair (attempt ${
                attempt + 1
            }/${MAX_REPAIR_ATTEMPTS})...`,
            false,
            "RunWield",
        );
        setActiveAgent(agentName, createAgentHandler(agentName, { hostedSession }), uiAPI);
        const repairOutcome = await runPlanningAgent({
            hostedSession,
            agentName,
            initialRequest: [
                `## Plan Execution Halted — Task Table Repair Required`,
                "",
                `The plan "${currentPlanName}" had a malformed Tasks table: ${
                    String(executionDecision.payload.error || "Unknown task table error")
                }.`,
                "",
                "Fix the markdown Tasks table to follow:",
                "",
                "| Task | Assignee | Dependencies | Write Scope | Description |",
                "",
                "Use numeric task IDs, valid assignees, numeric dependency IDs or `none`, narrow repo-relative write scopes, and a final tester Integration Point that depends on every prior task.",
                "Then call plan_written again with the plan name.",
            ].join("\n"),
            triageMeta: currentMeta,
            uiAPI,
        });
        const repairDecision = decidePostPlanning(repairOutcome, {
            planningAgentName: agentName,
            fallbackTriageMeta: currentMeta,
        });
        if (repairDecision.kind !== "execute_plan") {
            uiAPI.appendSystemMessage(
                "Repair did not produce an approved plan. Aborting.",
                false,
                "RunWield",
            );
            break;
        }
        currentPlanName = /** @type {string} */ (repairDecision.payload.planName);
        currentMeta = /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */ (
            repairDecision.payload.triageMeta || currentMeta
        );
        currentTasks =
            /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }> | undefined} */ (
                repairDecision.payload.tasks
            );
    }
}

/**
 * @typedef {Object} RecoveryWorktreeContext
 * @property {string} [id]
 * @property {string} [path]
 * @property {string} [branch]
 * @property {string} [baseBranch]
 * @property {string} [status]
 * @property {string} [baseRef]
 * @property {string} [baseCommit]
 * @property {string} [baseTree]
 */

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {Object} deps
 * @param {typeof findWorktreeByIdFn} deps.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} deps.findWorktreeByPlanName
 * @returns {Promise<RecoveryWorktreeContext | null>}
 */
async function resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName }) {
    let entry = null;
    if (plan.attrs.worktreeId) entry = await findWorktreeById(CWD, plan.attrs.worktreeId);
    if (!entry) entry = await findWorktreeByPlanName(CWD, plan.planName);
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
    };
}

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {RecoveryWorktreeContext | null} context
 * @param {typeof updatePlanFrontMatterFn} updatePlanFrontMatter
 * @returns {Promise<import('../../plan-store.js').PlanFrontMatter>}
 */
async function persistRecoveredWorktreeMetadata(plan, context, updatePlanFrontMatter) {
    if (!context) return plan.attrs;
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    const updates = {};
    if (context.id && !plan.attrs.worktreeId) updates.worktreeId = context.id;
    if (context.path && !plan.attrs.worktreePath) updates.worktreePath = context.path;
    if (context.branch && !plan.attrs.worktreeBranch) updates.worktreeBranch = context.branch;
    if (context.baseBranch && !plan.attrs.worktreeBaseBranch) updates.worktreeBaseBranch = context.baseBranch;
    if (!Object.keys(updates).length) return plan.attrs;
    return await updatePlanFrontMatter(CWD, plan.planName, updates, plan.attrs);
}

/**
 * @param {RecoveryWorktreeContext | null} context
 * @returns {boolean}
 */
function hasWorktreeContext(context) {
    return Boolean(context?.path || context?.branch || context?.id);
}

/**
 * Manual merge recovery is only safe after Workflow Validation has already
 * passed and the automatic merge-back failed.
 *
 * @param {RecoveryWorktreeContext | null} context
 * @returns {boolean}
 */
function canManuallyMergeRecoveredWorktree(context) {
    return context?.status === "merge_conflict";
}

/**
 * @param {RecoveryWorktreeContext | null} context
 * @returns {string | null}
 */
function getRecordedWorktreeRecreateBase(context) {
    return context?.baseCommit || context?.baseRef || null;
}

/** @param {string | undefined} path */
async function pathExists(path) {
    if (!path) return false;
    try {
        const stat = await Deno.stat(path);
        return stat.isDirectory;
    } catch {
        return false;
    }
}

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {RecoveryWorktreeContext | null} context
 * @param {import('../../shared/session/hosted-session.js').HostedSession} hostedSession
 */
function rehydrateActiveRecoveryWorkflow(plan, context, hostedSession) {
    if (!hostedSession) throw new Error("rehydrateActiveRecoveryWorkflow: hostedSession is required");
    const baselineTree = plan.attrs.executionBaselineTree || context?.baseTree;
    if (!baselineTree && !hasWorktreeContext(context)) return;
    /** @type {{ planName: string, triageMeta: import('../../plan-store.js').PlanFrontMatter, baselineTree?: string, projectRoot: string, executionCwd?: string, worktreeId?: string, worktreeBranch?: string, worktreeBaseBranch?: string }} */
    const workflow = {
        planName: plan.planName,
        triageMeta: plan.attrs,
        baselineTree,
        projectRoot: CWD,
    };
    if (context?.path) workflow.executionCwd = context.path;
    if (context?.id) workflow.worktreeId = context.id;
    if (context?.branch) workflow.worktreeBranch = context.branch;
    if (context?.baseBranch) workflow.worktreeBaseBranch = context.baseBranch;
    hostedSession.setActiveExecutionWorkflow(workflow);
}

/**
 * Append recovery context for a partially executed Plan.
 *
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown: string }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof getWorkflowDiffFn} getWorkflowDiff
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {typeof getWorktreeStatusFn} getWorktreeStatus
 * @returns {Promise<void>}
 */
async function appendRecoveryReport(plan, uiAPI, getWorkflowDiff, worktreeContext, getWorktreeStatus) {
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
                    projectRoot: CWD,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    baseTree: plan.attrs.executionBaselineTree || undefined,
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
                const message = error instanceof Error ? error.message : String(error);
                lines.push(`Could not inspect worktree: ${message}`);
            }
        }
    } else if (plan.attrs.executionBaselineTree) {
        lines.push(`Execution baseline tree: ${plan.attrs.executionBaselineTree}`);
        try {
            const diff = await getWorkflowDiff(CWD, plan.attrs.executionBaselineTree);
            lines.push(diff.trim() ? `Changes since execution baseline:\n${diff}` : "No changes since baseline.");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
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
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
async function confirmBaselineReset(planName, uiAPI) {
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
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {string} action
 * @returns {Promise<boolean>}
 */
async function confirmWorktreeAction(planName, uiAPI, action) {
    const answer = await uiAPI.promptSelect(`${action} worktree for "${planName}"?`, [
        { value: "confirm", label: `Yes, ${action.toLowerCase()} worktree` },
        { value: "cancel", label: "Cancel" },
    ]);
    return answer === "confirm";
}

/**
 * @param {string} planName
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof getWorktreeStatusFn} getWorktreeStatus
 * @returns {Promise<boolean>}
 */
async function confirmRecoveryWorktreeAvailable(planName, worktreeContext, uiAPI, getWorktreeStatus) {
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
            projectRoot: CWD,
            path: worktreeContext.path,
            branch: worktreeContext.branch,
            baseTree: worktreeContext.baseTree,
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

/**
 * Handle Plan Recovery menus for in-progress, failed, and implemented plans.
 *
 * @param {Object} opts
 * @param {{ planName: string, path: string, markdown: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof executePlanFn} opts.executePlan
 * @param {typeof runPlanningAgentFn} opts.runPlanningAgent
 * @param {typeof decidePostPlanningFn} opts.decidePostPlanning
 * @param {typeof decidePostExecutionFn} opts.decidePostExecution
 * @param {typeof runValidationLoopFn} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {typeof getWorkflowDiffFn} opts.getWorkflowDiff
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof restoreWorktreeTreeFn} opts.restoreWorktreeTree
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof updatePlanFrontMatterFn} opts.updatePlanFrontMatter
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof createExecutionWorktreeFn} opts.createExecutionWorktree
 * @param {typeof mergeExecutionWorktreeFn} opts.mergeExecutionWorktree
 * @param {typeof removeExecutionWorktreeFn} opts.removeExecutionWorktree
 * @param {typeof removeWorktreeRegistryEntryFn} opts.removeWorktreeRegistryEntry
 * @param {typeof shouldCleanupMergedWorktreesFn} opts.shouldCleanupMergedWorktrees
 * @param {typeof setActiveAgentFn} opts.setActiveAgent
 * @param {typeof createAgentHandlerFn} opts.createAgentHandler
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {import('../../shared/session/hosted-session.js').HostedSession} opts.hostedSession
 * @returns {Promise<"handled" | "review">}
 */
async function handlePlanRecovery({
    plan,
    agentName,
    uiAPI,
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
    updatePlanFrontMatter,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    getWorktreeStatus,
    createExecutionWorktree,
    mergeExecutionWorktree,
    removeExecutionWorktree,
    removeWorktreeRegistryEntry,
    shouldCleanupMergedWorktrees,
    setActiveAgent,
    createAgentHandler,
    findPlansByParent,
    hostedSession,
}) {
    if (!hostedSession) throw new Error("handlePlanRecovery: hostedSession is required");
    const refreshRecoveryWorktree = async () => {
        const resolved = await resolveRecoveryWorktree(plan, { findWorktreeById, findWorktreeByPlanName });
        plan.attrs = await persistRecoveredWorktreeMetadata(plan, resolved, updatePlanFrontMatter);
        return resolved;
    };
    let worktreeContext = await refreshRecoveryWorktree();
    while (true) {
        const hasWorktree = hasWorktreeContext(worktreeContext);
        const canMergeWorktree = canManuallyMergeRecoveredWorktree(worktreeContext);
        const options = plan.attrs.status === "implemented"
            ? [
                { value: "validate", label: "Retry Workflow Validation" },
                { value: "inspect", label: "Inspect and report current state" },
                ...(canMergeWorktree ? [{ value: "merge", label: "Merge validated worktree changes" }] : []),
                {
                    value: "reset",
                    label: hasWorktree ? "Delete/recreate worktree and start over" : "Reset tree and start over",
                },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                { value: "hold", label: "Put on hold" },
                { value: "cancel", label: "Cancel" },
            ]
            : [
                { value: "inspect", label: "Inspect and report current state" },
                { value: "continue", label: "Continue execution from current worktree" },
                {
                    value: "reset",
                    label: hasWorktree ? "Delete/recreate worktree and start over" : "Reset tree and start over",
                },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                { value: "hold", label: "Put on hold" },
                { value: "cancel", label: "Cancel" },
            ];

        const answer = await uiAPI.promptSelect(`Plan recovery (${plan.attrs.status}):`, options);
        if (!answer || answer === "cancel") return "handled";

        if (answer === "hold") {
            await putPlanOnHold({ plan, uiAPI, recordPlanEvent, findPlansByParent });
            return "handled";
        }

        if (answer === "inspect") {
            worktreeContext = await refreshRecoveryWorktree();
            await appendRecoveryReport(plan, uiAPI, getWorkflowDiff, worktreeContext, getWorktreeStatus);
            continue;
        }

        if (answer === "validate") {
            worktreeContext = await refreshRecoveryWorktree();
            if (!(await confirmRecoveryWorktreeAvailable(plan.planName, worktreeContext, uiAPI, getWorktreeStatus))) {
                continue;
            }
            rehydrateActiveRecoveryWorkflow(plan, worktreeContext, hostedSession);
            await validateCompletedExecution(
                { executionComplete: true },
                plan.planName,
                plan.markdown || plan.body || "",
                plan.attrs,
                uiAPI,
                runValidationLoop,
                loadPlan,
                worktreeContext,
                hostedSession,
            );
            return "handled";
        }

        if (answer === "continue") {
            worktreeContext = await refreshRecoveryWorktree();
            if (!(await confirmRecoveryWorktreeAvailable(plan.planName, worktreeContext, uiAPI, getWorktreeStatus))) {
                continue;
            }
            rehydrateActiveRecoveryWorkflow(plan, worktreeContext, hostedSession);
            await recordPlanEvent({
                cwd: CWD,
                planName: plan.planName,
                event: "recovery_continue",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "ready_for_work";
            await executeReadyPlanWithRepair({
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
                setActiveAgent,
                createAgentHandler,
                hostedSession,
            });
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
                if (!(await confirmWorktreeAction(plan.planName, uiAPI, "Delete/recreate"))) continue;
                if (worktreeContext?.path) {
                    await removeExecutionWorktree({
                        projectRoot: CWD,
                        path: worktreeContext.path,
                        branch: worktreeContext.branch,
                        force: true,
                    });
                }
                if (worktreeContext?.id) {
                    await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "abandoned" });
                }
                const recreateBaseBranch = worktreeContext?.baseBranch;
                const recreated = await createExecutionWorktree({
                    projectRoot: CWD,
                    planName: plan.planName,
                    baseRef: recreateBaseRef,
                    baseBranch: recreateBaseBranch,
                });
                plan.attrs = await updatePlanFrontMatter(CWD, plan.planName, {
                    worktreeId: recreated.id,
                    worktreePath: recreated.path,
                    worktreeBranch: recreated.branch,
                    worktreeBaseBranch: recreated.baseBranch,
                    worktreeStatus: "active",
                    executionBaselineTree: recreated.baseTree,
                }, plan.attrs);
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
                await restoreWorktreeTree(CWD, /** @type {string} */ (plan.attrs.executionBaselineTree));
            }
            await recordPlanEvent({
                cwd: CWD,
                planName: plan.planName,
                event: "recovery_reset",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "ready_for_work";
            await executeReadyPlanWithRepair({
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
                setActiveAgent,
                createAgentHandler,
                hostedSession,
            });
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
            if (!(await confirmRecoveryWorktreeAvailable(plan.planName, worktreeContext, uiAPI, getWorktreeStatus))) {
                continue;
            }
            if (!worktreeContext?.branch) {
                uiAPI.appendSystemMessage("Cannot merge because no worktree branch is recorded.", true, "RunWield");
                continue;
            }
            try {
                const cleanupMergedWorktrees = shouldCleanupMergedWorktrees();
                if (!worktreeContext.baseBranch) {
                    uiAPI.appendSystemMessage(
                        "Recorded worktree target branch is unknown; using legacy current-checkout merge fallback.",
                        true,
                        "RunWield",
                    );
                }
                uiAPI.appendSystemMessage(
                    worktreeContext.baseBranch
                        ? `Merging worktree branch ${worktreeContext.branch} into target branch ${worktreeContext.baseBranch}.`
                        : `Merging worktree branch ${worktreeContext.branch} into primary checkout.`,
                );
                await mergeExecutionWorktree({
                    projectRoot: CWD,
                    branch: worktreeContext.branch,
                    targetBranch: worktreeContext.baseBranch,
                    worktreePath: worktreeContext.path,
                    planName: plan.planName,
                    planDescription: plan.attrs.summary,
                    allowedDirtyPaths: [
                        `plans/${plan.planName}.md`,
                        ".wld/",
                        ".wld/worktrees.json",
                        ".wld/worktrees.lock",
                    ],
                });
                if (worktreeContext.id) {
                    await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "merged" });
                }
                if (cleanupMergedWorktrees && worktreeContext.path) {
                    try {
                        await removeExecutionWorktree({
                            projectRoot: CWD,
                            path: worktreeContext.path,
                            branch: worktreeContext.branch,
                            force: true,
                        });
                        if (worktreeContext.id) {
                            await removeWorktreeRegistryEntry(CWD, worktreeContext.id);
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
                await recordPlanEvent({
                    cwd: CWD,
                    planName: plan.planName,
                    event: "validation_passed",
                    currentStatus: "implemented",
                    details: { triageMeta: plan.attrs, worktreeStatus: "merged", cleanupMergedWorktrees },
                });
                uiAPI.appendSystemMessage("Worktree changes merged and plan marked verified.", false, "RunWield");
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                uiAPI.appendSystemMessage(`Worktree merge failed: ${reason}`, true, "RunWield");
                if (worktreeContext.id) {
                    try {
                        await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "merge_conflict" });
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
                        cwd: CWD,
                        planName: plan.planName,
                        event: "worktree_merge_failed",
                        currentStatus: "implemented",
                        details: {
                            triageMeta: plan.attrs,
                            failureReason: reason,
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
            }
            return "handled";
        }

        if (answer === "abandon") {
            if (!(await confirmWorktreeAction(plan.planName, uiAPI, "Delete/abandon"))) continue;
            if (worktreeContext?.path) {
                await removeExecutionWorktree({
                    projectRoot: CWD,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    force: true,
                });
            }
            if (worktreeContext?.id) {
                await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "abandoned" });
            }
            plan.attrs = await updatePlanFrontMatter(CWD, plan.planName, {
                worktreeStatus: "abandoned",
                worktreeId: null,
                worktreePath: null,
                worktreeBranch: null,
            }, plan.attrs);
            worktreeContext = null;
            uiAPI.appendSystemMessage("Worktree abandoned and removed.", false, "RunWield");
            continue;
        }

        if (answer === "review") {
            if (worktreeContext?.id) {
                await updateWorktreeRegistryEntry(CWD, worktreeContext.id, { status: "abandoned" });
            }
            hostedSession.clearActiveExecutionWorkflow();
            await stripTasksFromPlanFile(plan);
            await recordPlanEvent({
                cwd: CWD,
                planName: plan.planName,
                event: "review_reopened",
                currentStatus: plan.attrs.status,
                details: { triageMeta: plan.attrs },
            });
            plan.attrs.status = "feedback";
            return "review";
        }
    }
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatter} attrs
 * @returns {boolean}
 */
function isDecomposedEpicStatus(attrs) {
    return attrs.status === "ready_for_decomposition" || attrs.status === "ready_for_work" ||
        (attrs.status === "verified" && attrs.epicCompletionMode === "done_enough");
}

/**
 * @param {{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }} child
 * @returns {string}
 */
function formatChildPlanLabel(child) {
    const order = child.attrs.order !== undefined ? `${String(child.attrs.order).padStart(2, "0")}. ` : "";
    const summary = child.attrs.summary ? ` — ${child.attrs.summary}` : "";
    const dependencies = Array.isArray(child.attrs.dependencies) && child.attrs.dependencies.length > 0
        ? ` — deps: ${child.attrs.dependencies.join(", ")}`
        : "";
    return `${order}${child.name} [${child.attrs.status}]${summary}${dependencies}`;
}

/**
 * @param {{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }} child
 * @returns {string | undefined}
 */
function formatChildPlanDescription(child) {
    const parts = [];
    if (child.attrs.summary) parts.push(child.attrs.summary);
    if (Array.isArray(child.attrs.dependencies) && child.attrs.dependencies.length > 0) {
        parts.push(`Dependencies: ${child.attrs.dependencies.join(", ")}`);
    }
    return parts.length > 0 ? parts.join(" | ") : undefined;
}

/**
 * @param {{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }} child
 * @returns {string}
 */
function formatNextChildLabel(child) {
    const order = child.attrs.order !== undefined ? `${String(child.attrs.order).padStart(2, "0")}. ` : "";
    const summary = child.attrs.summary || child.name;
    return `Execute next non-verified child FEATURE: ${order}${summary} [${child.attrs.status}]`;
}

/**
 * @param {{ attrs: import('../../plan-store.js').PlanFrontMatter }} child
 * @returns {boolean}
 */
function isActionableNextChild(child) {
    return child.attrs.status !== "verified" && child.attrs.status !== "closed_without_verification";
}

/**
 * @param {string | undefined} status
 * @returns {number}
 */
function getLoadPlanMenuStatusRank(status) {
    if (status === "ready_for_work") return 0;
    if (status === "ready_for_decomposition") return 1;
    if (status === "implemented") return 2;
    if (status === "on_hold") return 4;
    return 3;
}

/**
 * @param {{ name: string, attrs: Partial<import('../../plan-store.js').PlanFrontMatter> }} left
 * @param {{ name: string, attrs: Partial<import('../../plan-store.js').PlanFrontMatter> }} right
 * @returns {number}
 */
function compareTopLevelPlansForMenu(left, right) {
    const statusDelta = getLoadPlanMenuStatusRank(left.attrs.status) - getLoadPlanMenuStatusRank(right.attrs.status);
    if (statusDelta !== 0) return statusDelta;
    return left.name.localeCompare(right.name);
}

/**
 * @param {{ name: string, attrs: Partial<import('../../plan-store.js').PlanFrontMatter> }} plan
 * @returns {{ value: string, label: string, description: string }}
 */
function formatTopLevelPlanOption(plan) {
    const summary = plan.attrs.summary ? ` — ${plan.attrs.summary}` : "";
    const descriptionType = plan.attrs.classification === "PROJECT" || !plan.attrs.type
        ? plan.attrs.classification
        : `${plan.attrs.classification}:${plan.attrs.type}`;
    return {
        value: plan.name,
        label: `${plan.name}${summary}`,
        description: `${descriptionType} - ${plan.attrs.status}`,
    };
}

/**
 * @param {Array<{ attrs: import('../../plan-store.js').PlanFrontMatter }>} children
 * @returns {{ total: number, verified: number, active: number, remaining: number, failed: number, onHold: number }}
 */
function countEpicChildStatuses(children) {
    /** @type {{ total: number, verified: number, active: number, remaining: number, failed: number, onHold: number }} */
    const counts = { total: children.length, verified: 0, active: 0, remaining: 0, failed: 0, onHold: 0 };
    for (const child of children) {
        const status = child.attrs.status;
        if (status === "verified") counts.verified += 1;
        else if (status === "in_progress" || status === "implemented") counts.active += 1;
        else if (status === "failed") counts.failed += 1;
        else if (status === "on_hold") counts.onHold += 1;
        else if (["draft", "approved", "ready_for_work", "ready_for_decomposition", "feedback"].includes(status)) {
            counts.remaining += 1;
        }
    }
    return counts;
}

/**
 * @param {Array<{ attrs: import('../../plan-store.js').PlanFrontMatter }>} children
 * @returns {string}
 */
function formatEpicProgressSummary(children) {
    const counts = countEpicChildStatuses(children);
    const label = counts.total === 1 ? "child FEATURE" : "child FEATUREs";
    const parts = [
        `Progress: ${counts.verified}/${counts.total} ${label} verified`,
        `${counts.active} active/implemented`,
        `${counts.remaining} remaining`,
    ];
    if (counts.onHold > 0) parts.push(`${counts.onHold} on hold`);
    if (counts.failed > 0) parts.push(`${counts.failed} failed`);
    return parts.join(" — ");
}

/**
 * @param {Array<{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }>} children
 * @returns {string}
 */
function formatEpicChildFeatureList(children) {
    if (children.length === 0) return "Child FEATURE plans:\n  (none)";
    return [
        "Child FEATURE plans:",
        ...children.map((child) => `  - ${formatChildPlanLabel(child)}`),
    ].join("\n");
}

/**
 * @param {{ attrs: import('../../plan-store.js').PlanFrontMatter, body: string, markdown: string }} plan
 * @param {Array<{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }>} children
 * @returns {string}
 */
function buildEpicPlanSummary(plan, children) {
    const sections = [buildPlanSummary(plan)];
    if (children.length > 0) sections.push(`Epic child progress:\n${formatEpicProgressSummary(children)}`);
    sections.push(formatEpicChildFeatureList(children));
    return sections.join("\n\n");
}

/**
 * @param {Array<{ attrs: import('../../plan-store.js').PlanFrontMatter }>} children
 * @returns {string}
 */
function buildEpicDoneEnoughSummary(children) {
    const counts = countEpicChildStatuses(children);
    const failed = counts.failed > 0 ? `, ${counts.failed} failed` : "";
    return `Done enough for now: ${counts.verified}/${counts.total} child FEATURE${
        counts.total === 1 ? "" : "s"
    } verified, ${counts.active} active/implemented, ${counts.remaining} remaining${failed}.`;
}

/**
 * @param {{ attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @returns {boolean}
 */
function isDoneEnoughEpic(plan) {
    return plan.attrs.epicCompletionMode === "done_enough";
}

/**
 * @param {Array<{ dependency: string, planName?: string, status?: string, state: "verified" | "unverified" | "missing" }>} unmetDependencies
 * @returns {string}
 */
function formatDependencyWarning(unmetDependencies) {
    return [
        "This child FEATURE declares dependencies that are not verified:",
        "",
        ...unmetDependencies.map((dependency) => {
            if (dependency.state === "missing") return `  - ${dependency.dependency}: missing`;
            return `  - ${dependency.planName || dependency.dependency}: ${dependency.status || "unknown"}`;
        }),
    ].join("\n");
}

/**
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {typeof resolveSiblingChildPlanDependenciesFn} resolveSiblingChildPlanDependencies
 * @returns {Promise<boolean>}
 */
async function confirmChildFeatureDependencies(plan, uiAPI, resolveSiblingChildPlanDependencies) {
    if (plan.attrs.classification !== "FEATURE" || !plan.attrs.parentPlan) return true;
    const dependencies = Array.isArray(plan.attrs.dependencies) ? plan.attrs.dependencies : [];
    if (dependencies.length === 0) return true;

    const dependencyStates = await resolveSiblingChildPlanDependencies(CWD, plan.attrs.parentPlan, dependencies);
    const unmetDependencies = dependencyStates.filter((dependency) => dependency.state !== "verified");
    if (unmetDependencies.length === 0) return true;

    uiAPI.appendSystemMessage(formatDependencyWarning(unmetDependencies), true, "RunWield");
    const answer = await uiAPI.promptSelect(`Proceed with "${plan.planName}" anyway?`, [
        { value: "proceed", label: "Proceed anyway" },
        { value: "cancel", label: "Cancel" },
    ]);
    if (answer === "proceed") return true;
    uiAPI.appendSystemMessage("Plan load canceled.", false, "RunWield");
    return false;
}

/**
 * @param {Object} opts
 * @param {{ planName: string, body: string, markdown: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../shared/workflow/workflow.js').UiAPI} opts.uiAPI
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {typeof runSlicerAgentFn} opts.runSlicerAgent
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof resolvePlanFn} opts.resolvePlan
 * @param {(childPlanName: string) => Promise<void>} opts.loadChildPlan
 * @param {import('../../shared/session/hosted-session.js').HostedSession} opts.hostedSession
 * @returns {Promise<"handled" | "continue">}
 */
async function handleEpicPlan({
    plan,
    uiAPI,
    findPlansByParent,
    runSlicerAgent,
    recordPlanEvent,
    resolvePlan,
    loadChildPlan,
    hostedSession,
}) {
    if (!isEpicPlan(plan.attrs)) return "continue";

    const children = (await findPlansByParent(CWD, plan.planName)).filter((child) =>
        child.attrs.classification === "FEATURE"
    ).sort(compareChildPlansByOrder);
    const hasChildren = children.length > 0;
    const canPickChild = hasChildren && isDecomposedEpicStatus(plan.attrs);

    if (hasChildren) {
        uiAPI.appendSystemMessage(formatEpicProgressSummary(children), false, "RunWield");
    }
    if (isDoneEnoughEpic(plan)) {
        const summary = plan.attrs.epicDoneEnoughSummary ? ` ${plan.attrs.epicDoneEnoughSummary}` : "";
        uiAPI.appendSystemMessage(
            `This Epic is marked done enough for now.${summary} Remaining child FEATURE plans stay visible and loadable.`,
            false,
            "RunWield",
        );
    }

    if (plan.attrs.status === "draft" || plan.attrs.status === "approved") {
        uiAPI.appendSystemMessage(
            "This PROJECT Epic is not executable. Resume Slicer decomposition to create child FEATURE plans.",
            false,
            "RunWield",
        );
    } else if (!hasChildren) {
        uiAPI.appendSystemMessage("This PROJECT Epic has no child FEATURE plans yet.", false, "RunWield");
    }

    while (true) {
        /** @type {Array<{ value: string, label: string }>} */
        const epicOptions = [
            { value: "slicer", label: "Open or resume Slicer decomposition" },
            { value: "view", label: "View Epic details" },
            { value: "cancel", label: "Cancel" },
        ];
        if (canPickChild) {
            epicOptions.splice(1, 0, { value: "pick_child", label: "Pick a child FEATURE plan" });
        }
        if (isHoldableStatus(plan.attrs.status)) {
            epicOptions.splice(epicOptions.length - 1, 0, { value: "hold", label: "Put Epic on hold" });
        }
        if (hasChildren && plan.attrs.status === "ready_for_work") {
            epicOptions.splice(canPickChild ? 2 : 1, 0, {
                value: "done_enough",
                label: "Mark Epic done enough for now",
            });
        }

        const answer = await uiAPI.promptSelect("What would you like to do with this Epic?", epicOptions);
        if (!answer || answer === "cancel") return "handled";

        if (answer === "view") {
            uiAPI.appendSystemMessage(buildEpicPlanSummary(plan, children), false, "Plan");
            continue;
        }

        if (answer === "hold") {
            await putPlanOnHold({ plan, uiAPI, recordPlanEvent, findPlansByParent });
            return "handled";
        }

        if (answer === "slicer") {
            await runSlicerAgent({
                planName: plan.planName,
                triageMeta: plan.attrs,
                uiAPI,
                hostedSession,
            });
            return "handled";
        }

        if (answer === "done_enough") {
            const summary = buildEpicDoneEnoughSummary(children);
            uiAPI.appendSystemMessage(
                [
                    formatEpicProgressSummary(children),
                    "Marking this Epic done enough sets the Epic status to verified for now.",
                    "Unverified child FEATURE plans remain visible and loadable.",
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
                cwd: CWD,
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
            continue;
        }

        if (answer === "pick_child") {
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
                const childPlanName = await uiAPI.promptSelect("Load child FEATURE plan:", childOptions);
                if (!childPlanName) break;
                if (childPlanName === "__next_child__") {
                    if (!nextChild) break;
                    await loadChildPlan(nextChild.name);
                    return "handled";
                }

                while (true) {
                    const childAction = await uiAPI.promptSelect("What would you like to do with this FEATURE?", [
                        { value: "load", label: "Load this FEATURE" },
                        { value: "view", label: "View FEATURE details" },
                        { value: "back", label: "Back to child list" },
                    ]);
                    if (!childAction || childAction === "back") break;

                    if (childAction === "load") {
                        await loadChildPlan(String(childPlanName));
                        return "handled";
                    }

                    if (childAction === "view") {
                        try {
                            const childPlan = await resolvePlan(CWD, String(childPlanName));
                            uiAPI.appendSystemMessage(
                                `FEATURE: ${childPlan.planName}\n\n${buildPlanSummary(childPlan)}`,
                                false,
                                "Plan",
                            );
                        } catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            uiAPI.appendSystemMessage(
                                `Could not load FEATURE details for ${String(childPlanName)}: ${message}`,
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
        executePlan: executePlanDep,
        runPlanningAgent: runPlanningAgentDep,
        decidePostPlanning: decidePostPlanningDep,
        decidePostExecution: decidePostExecutionDep,
        submitPlanForReview: submitPlanForReviewDep,
        askPostApproval: askPostApprovalDep,
        askApprovalWithTasks: askApprovalWithTasksDep,
        askProjectDecompositionApproval: askProjectDecompositionApprovalDep,
        ensureSlicerTasks: ensureSlicerTasksDep,
        runValidationLoop: runValidationLoopDep,
        runSlicerAgent: runSlicerAgentDep,
        loadPlan: loadPlanDep,
        getWorkflowDiff: getWorkflowDiffDep,
        listCommitsTouchingPathsSince: listCommitsTouchingPathsSinceDep,
        restoreWorktreeTree: restoreWorktreeTreeDep,
        setActiveAgent: setActiveAgentDep,
        createAgentHandler: createAgentHandlerDep,
        getRootAgentName: getRootAgentNameDep,
        listPlans: listPlansDep,
        findPlansByParent: findPlansByParentDep,
        resolveSiblingChildPlanDependencies: resolveSiblingChildPlanDependenciesDep,
        recordPlanEvent: recordPlanEventDep,
        updatePlanFrontMatter: updatePlanFrontMatterDep,
        findWorktreeById: findWorktreeByIdDep,
        findWorktreeByPlanName: findWorktreeByPlanNameDep,
        updateWorktreeRegistryEntry: updateWorktreeRegistryEntryDep,
        getWorktreeStatus: getWorktreeStatusDep,
        createExecutionWorktree: createExecutionWorktreeDep,
        inspectExecutionWorktreeMergeRisk: inspectExecutionWorktreeMergeRiskDep,
        mergeExecutionWorktree: mergeExecutionWorktreeDep,
        removeExecutionWorktree: removeExecutionWorktreeDep,
        removeWorktreeRegistryEntry: removeWorktreeRegistryEntryDep,
        shouldCleanupMergedWorktrees: shouldCleanupMergedWorktreesDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const resolvePlan = resolvePlanDep || resolvePlanFn;
    const executePlan = executePlanDep || executePlanFn;
    const runPlanningAgent = runPlanningAgentDep || runPlanningAgentFn;
    const decidePostPlanning = decidePostPlanningDep || decidePostPlanningFn;
    const decidePostExecution = decidePostExecutionDep || decidePostExecutionFn;
    const submitPlanForReview = submitPlanForReviewDep || submitPlanForReviewFn;
    const askPostApproval = askPostApprovalDep || askPostApprovalFn;
    const askApprovalWithTasks = askApprovalWithTasksDep || askApprovalWithTasksFn;
    const askProjectDecompositionApproval = askProjectDecompositionApprovalDep || askProjectDecompositionApprovalFn;
    const ensureSlicerTasks = ensureSlicerTasksDep || ensureSlicerTasksFn;
    const runValidationLoop = runValidationLoopDep || runValidationLoopFn;
    const runSlicerAgent = runSlicerAgentDep || runSlicerAgentFn;
    const loadPlan = loadPlanDep || loadPlanFn;
    const getWorkflowDiff = getWorkflowDiffDep || getWorkflowDiffFn;
    const listCommitsTouchingPathsSince = listCommitsTouchingPathsSinceDep || listCommitsTouchingPathsSinceFn;
    const restoreWorktreeTree = restoreWorktreeTreeDep || restoreWorktreeTreeFn;
    const rawSetActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const rawCreateAgentHandler = createAgentHandlerDep || createAgentHandlerFn;
    const hostedSession = options.hostedSession;
    const getRootAgentName = getRootAgentNameDep || (() => hostedSession?.getRootAgentName?.() || null);
    /**
     * @param {string} nextAgentName
     * @param {Record<string, unknown>} [handlerDeps]
     */
    const createAgentHandler = (nextAgentName, handlerDeps = {}) =>
        rawCreateAgentHandler(nextAgentName, { ...handlerDeps, hostedSession });
    /**
     * @param {string} agentName
     * @param {import('../../shared/session/types.js').AgentMessageHandler} handler
     * @param {import('../../shared/workflow/workflow.js').UiAPI} [uiAPI]
     * @param {string} [agentModel]
     * @param {{ allowReturnToRouter?: boolean }} [activeOptions]
     */
    const setActiveAgent = (agentName, handler, uiAPI, agentModel, activeOptions) => {
        if (setActiveAgentDep) {
            setActiveAgentDep(agentName, handler, uiAPI, agentModel, activeOptions);
            return;
        }
        rawSetActiveAgent(hostedSession, agentName, handler, uiAPI, agentModel, activeOptions);
    };
    const findPlansByParent = findPlansByParentDep || findPlansByParentFn;
    const resolveSiblingChildPlanDependencies = resolveSiblingChildPlanDependenciesDep ||
        resolveSiblingChildPlanDependenciesFn;
    const recordPlanEvent = recordPlanEventDep || recordPlanEventFn;
    const updatePlanFrontMatter = updatePlanFrontMatterDep || updatePlanFrontMatterFn;
    const findWorktreeById = findWorktreeByIdDep || findWorktreeByIdFn;
    const findWorktreeByPlanName = findWorktreeByPlanNameDep || findWorktreeByPlanNameFn;
    const updateWorktreeRegistryEntry = updateWorktreeRegistryEntryDep || updateWorktreeRegistryEntryFn;
    const getWorktreeStatus = getWorktreeStatusDep || getWorktreeStatusFn;
    const createExecutionWorktree = createExecutionWorktreeDep || createExecutionWorktreeFn;
    const inspectExecutionWorktreeMergeRisk = inspectExecutionWorktreeMergeRiskDep ||
        inspectExecutionWorktreeMergeRiskFn;
    const mergeExecutionWorktree = mergeExecutionWorktreeDep || mergeExecutionWorktreeFn;
    const removeExecutionWorktree = removeExecutionWorktreeDep || removeExecutionWorktreeFn;
    const removeWorktreeRegistryEntry = removeWorktreeRegistryEntryDep || removeWorktreeRegistryEntryFn;
    const shouldCleanupMergedWorktrees = shouldCleanupMergedWorktreesDep || shouldCleanupMergedWorktreesFn;

    const parsedArgs = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsedArgs.help) {
        printCommandHelp("load-plan");
        return;
    }

    if (!hostedSession) throw new Error("runLoadPlanCommand: hostedSession is required");

    let [planArg] = parsedArgs._.map(String);
    if (!planArg) {
        if (options.uiAPI && options.editor) {
            const listPlans = listPlansDep || (await import("../../plan-store.js")).listPlans;
            const plans = await listPlans(Deno.cwd());
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

            const planOptions = topLevelPlans.toSorted(compareTopLevelPlansForMenu).map(formatTopLevelPlanOption);

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
            (_userRequest, _images, currentUiAPI) => {
                currentUiAPI.appendSystemMessage("Please wait for the plan to load...");
                return Promise.resolve();
            },
        );
    }

    if (!uiAPI) return;

    let skipRouterRestore = false;
    const initialAgentName = getRootAgentName() || AGENTS.ROUTER;
    let restoreAgentName = initialAgentName;

    try {
        const plan = await resolvePlan(CWD, planArg);
        uiAPI.appendSystemMessage(`Plan loaded: ${plan.planName}`, false, "RunWield");
        uiAPI.appendSystemMessage(
            `Classification: ${plan.attrs.classification}, Status: ${plan.attrs.status}`,
            false,
            "RunWield",
        );

        // Set terminal title and session name to the plan's name
        const setTitle = deps.setTerminalTitleForName || setTerminalTitleForNameFn;
        setTitle(plan.planName);
        options.sessionManager?.appendSessionInfo?.(plan.planName);

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
                const parentPlan = await resolvePlan(CWD, plan.attrs.parentPlan);
                if (parentPlan.attrs.status === "on_hold") {
                    uiAPI.appendSystemMessage(
                        `Parent Epic "${parentPlan.planName}" is on hold. Resume the parent before working on child FEATURE "${plan.planName}".`,
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
                removeExecutionWorktree,
            });
            if (result === "handled") return;
        }

        if (["in_progress", "failed", "implemented"].includes(plan.attrs.status)) {
            restoreAgentName = planFlowRestoreAgent;
            const result = await handlePlanRecovery({
                plan,
                agentName,
                uiAPI,
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
                updatePlanFrontMatter,
                findWorktreeById,
                findWorktreeByPlanName,
                updateWorktreeRegistryEntry,
                getWorktreeStatus,
                createExecutionWorktree,
                mergeExecutionWorktree,
                removeExecutionWorktree,
                removeWorktreeRegistryEntry,
                shouldCleanupMergedWorktrees,
                setActiveAgent,
                createAgentHandler,
                findPlansByParent,
                hostedSession,
            });
            if (result === "handled") return;
        }

        const epicResult = await handleEpicPlan({
            plan,
            uiAPI,
            findPlansByParent,
            runSlicerAgent,
            recordPlanEvent,
            resolvePlan,
            loadChildPlan: loadAnotherPlan,
            hostedSession,
        });
        if (epicResult === "handled") {
            skipRouterRestore = true;
            return;
        }

        const dependenciesConfirmed = await confirmChildFeatureDependencies(
            plan,
            uiAPI,
            resolveSiblingChildPlanDependencies,
        );
        if (!dependenciesConfirmed) return;

        if (plan.attrs.status === "verified") {
            uiAPI.appendSystemMessage("This plan is already verified.", false, "RunWield");
            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "review", label: "Re-open for review (planner/architect)" },
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
                // Re-opening for review: discard the slicer's tasks so the
                // architect → slicer flow regenerates them against any revisions.
                await stripTasksFromPlanFile(plan);
                await recordPlanEvent({
                    cwd: CWD,
                    planName: plan.planName,
                    event: "review_reopened",
                    currentStatus: "verified",
                    details: { triageMeta: plan.attrs },
                });
                plan.attrs.status = "feedback";
                break;
            }
        }

        if (plan.attrs.status === "approved" || isExecutablePlanStatus(plan.attrs.status)) {
            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "proceed", label: "Proceed with execution" },
                    { value: "review", label: "Re-open for review (edit/annotate)" },
                    { value: "hold", label: "Put on hold" },
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);

                if (!answer || answer === "cancel") return;

                if (answer === "hold") {
                    await putPlanOnHold({ plan, uiAPI, recordPlanEvent, findPlansByParent });
                    return;
                }

                if (answer === "proceed") {
                    restoreAgentName = planFlowRestoreAgent;
                    if (plan.attrs.status === "approved") {
                        const ready = await prepareApprovedPlanForWork(
                            plan,
                            uiAPI,
                            ensureSlicerTasks,
                            recordPlanEvent,
                            hostedSession,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                    }

                    await executeReadyPlanWithRepair({
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
                        setActiveAgent,
                        createAgentHandler,
                        hostedSession,
                    });
                    return;
                }

                if (answer === "review") {
                    restoreAgentName = planFlowRestoreAgent;
                    // Re-opening for review: discard the slicer's tasks so the
                    // architect → slicer flow regenerates them against any revisions.
                    await stripTasksFromPlanFile(plan);
                    if (isExecutablePlanStatus(plan.attrs.status)) {
                        await recordPlanEvent({
                            cwd: CWD,
                            planName: plan.planName,
                            event: "review_reopened",
                            currentStatus: plan.attrs.status,
                            details: { triageMeta: plan.attrs },
                        });
                        plan.attrs.status = "feedback";
                    }

                    setActiveAgent(agentName, createAgentHandler(agentName, { hostedSession }), uiAPI);

                    const reviewResult = await submitPlanForReview({
                        cwd: CWD,
                        planName: plan.planName,
                        planPath: plan.path,
                        triageMeta: plan.attrs,
                        uiAPI,
                        hostedSession,
                    });

                    if (reviewResult.canceled) {
                        uiAPI.appendSystemMessage("Plan review canceled.", false, "RunWield");
                        skipRouterRestore = true;
                        return;
                    }

                    if (reviewResult.approved) {
                        if (isEpicPlan(plan.attrs)) {
                            await recordPlanEvent({
                                cwd: CWD,
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
                            const action = await askProjectDecompositionApproval(plan.planName, uiAPI);
                            if (action === "proceed") {
                                await runSlicerAgent({
                                    planName: plan.planName,
                                    triageMeta: plan.attrs,
                                    uiAPI,
                                    hostedSession,
                                });
                            } else {
                                uiAPI.appendSystemMessage(
                                    `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                                    false,
                                    "RunWield",
                                );
                            }
                            skipRouterRestore = true;
                            return;
                        }

                        const ready = await prepareApprovedPlanForWork(
                            plan,
                            uiAPI,
                            ensureSlicerTasks,
                            recordPlanEvent,
                            hostedSession,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                        const action = plan.attrs.classification === "PROJECT"
                            ? await askApprovalWithTasks(plan.planName, uiAPI)
                            : await askPostApproval(plan.planName, uiAPI);
                        if (action === "proceed") {
                            const confirmed = await confirmAffectedPathChangesBeforeExecution({
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                uiAPI,
                                listCommitsTouchingPathsSince,
                            });
                            if (!confirmed) return;

                            const execRes = await executePlan(plan.planName, plan.attrs, uiAPI, undefined, undefined, {
                                hostedSession,
                            });
                            const executionDecision = decidePostExecution(execRes, {
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                executionAgentName: agentName,
                            });
                            await validatePostExecutionDecision({
                                executionDecision,
                                fallbackPlanContent: plan.markdown || plan.body || "",
                                uiAPI,
                                runValidationLoop,
                                loadPlan,
                                hostedSession,
                            });
                        } else {
                            uiAPI.appendSystemMessage(
                                `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                                false,
                                "RunWield",
                            );
                            skipRouterRestore = true;
                        }
                        return;
                    }

                    // User submitted feedback — kick off the planning agent to revise.
                    const outcome = await runPlanningAgent({
                        hostedSession,
                        agentName,
                        initialRequest: buildReReviewRevisionRequest(plan.planName, reviewResult.feedback),
                        triageMeta: plan.attrs,
                        uiAPI,
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
                        loadPlan,
                        listCommitsTouchingPathsSince,
                        hostedSession,
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
        while (true) {
            const answer = await uiAPI.promptSelect("What would you like to do?", [
                { value: "resume", label: "Resume planning" },
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
                await putPlanOnHold({ plan, uiAPI, recordPlanEvent, findPlansByParent });
                return;
            }
            if (answer === "resume") break;
        }

        uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
        restoreAgentName = planFlowRestoreAgent;
        setActiveAgent(agentName, createAgentHandler(agentName, { hostedSession }), uiAPI);

        const outcome = await runPlanningAgent({
            hostedSession,
            agentName,
            initialRequest: buildResumeRequest(plan.planName, plan.attrs),
            triageMeta: plan.attrs,
            uiAPI,
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
            loadPlan,
            listCommitsTouchingPathsSince,
            hostedSession,
        });
        if (shouldKeepPlanningAgentActive(planningDecision)) {
            skipRouterRestore = true;
        }
    } finally {
        if (!skipRouterRestore) {
            restorePreviousAgentFlow(uiAPI, restoreAgentName, hostedSession, deps);
        }
    }
}
