/**
 * @module cmd/load-plan
 * Load-plan command implementation. Loads a saved plan from disk and continues
 * work on it (review/edit/execute), distinct from /resume which restores a
 * previous chat session.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { AGENTS, CLI_BIN } from "../../constants.js";
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
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
} from "../../shared/workflow/decisions.js";
import {
    isEpicPlan,
    isExecutablePlanStatus,
    recordPlanEvent as recordPlanEventFn,
    stageValidationPassedInExecutionWorktree as stageValidationPassedInExecutionWorktreeFn,
} from "../../shared/workflow/plan-lifecycle.js";
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
    createExecutionWorktree as createExecutionWorktreeFn,
    getWorktreeStatus as getWorktreeStatusFn,
    inspectExecutionWorktreeMergeRisk as inspectExecutionWorktreeMergeRiskFn,
    mergeExecutionWorktree as mergeExecutionWorktreeFn,
    preparePrimaryPlanPathForMerge as preparePrimaryPlanPathForMergeFn,
    removeExecutionWorktree as removeExecutionWorktreeFn,
    restorePrimaryPlanPathAfterMergeFailure as restorePrimaryPlanPathAfterMergeFailureFn,
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
 * @property {(planName: string) => Promise<string>} [askPostApproval]
 * @property {(planName: string) => Promise<string>} [askApprovalWithTasks]
 * @property {(planName: string) => Promise<string>} [askProjectDecompositionApproval]
 * @property {(options: Record<string, any>) => Promise<any>} [ensureSlicerTasks]
 * @property {(options: Record<string, any>) => Promise<any>} [runValidationLoop]
 * @property {(options: Record<string, any>) => Promise<any>} [runSlicerAgent]
 * @property {typeof loadPlanFn} [loadPlan]
 * @property {typeof getWorkflowDiffFn} [getWorkflowDiff]
 * @property {typeof listCommitsTouchingPathsSinceFn} [listCommitsTouchingPathsSince]
 * @property {typeof restoreWorktreeTreeFn} [restoreWorktreeTree]
 * @property {typeof resetTuiStateFn} [resetTuiState]
 * @property {() => string | null} [getRootAgentName]
 * @property {(cwd: string) => Promise<Array<{name: string, attrs: Partial<import('../../plan-store.js').PlanFrontMatter>}>>} [listPlans]
 * @property {typeof findPlansByParentFn} [findPlansByParent]
 * @property {typeof resolveSiblingChildPlanDependenciesFn} [resolveSiblingChildPlanDependencies]
 * @property {typeof recordPlanEventFn} [recordPlanEvent]
 * @property {typeof stageValidationPassedInExecutionWorktreeFn} [stageValidationPassedInExecutionWorktree]
 * @property {typeof updatePlanFrontMatterFn} [updatePlanFrontMatter]
 * @property {typeof findWorktreeByIdFn} [findWorktreeById]
 * @property {typeof findWorktreeByPlanNameFn} [findWorktreeByPlanName]
 * @property {typeof updateWorktreeRegistryEntryFn} [updateWorktreeRegistryEntry]
 * @property {typeof getWorktreeStatusFn} [getWorktreeStatus]
 * @property {typeof createExecutionWorktreeFn} [createExecutionWorktree]
 * @property {typeof inspectExecutionWorktreeMergeRiskFn} [inspectExecutionWorktreeMergeRisk]
 * @property {typeof mergeExecutionWorktreeFn} [mergeExecutionWorktree]
 * @property {typeof preparePrimaryPlanPathForMergeFn} [preparePrimaryPlanPathForMerge]
 * @property {typeof restorePrimaryPlanPathAfterMergeFailureFn} [restorePrimaryPlanPathAfterMergeFailure]
 * @property {typeof removeExecutionWorktreeFn} [removeExecutionWorktree]
 * @property {typeof removeWorktreeRegistryEntryFn} [removeWorktreeRegistryEntry]
 * @property {typeof shouldCleanupMergedWorktreesFn} [shouldCleanupMergedWorktrees]
 * @property {typeof recordWorkflowMetric} [recordWorkflowMetric]
 * @property {typeof probeGitRepositoryFn} [probeGitRepository]
 * @property {typeof setTerminalTitleForNameFn} [setTerminalTitleForName]
 */

/**
 * @typedef {Object} PlanSessionSurface
 * @property {string} id
 * @property {string} cwd
 * @property {() => string | null} getActiveAgentName
 * @property {(agentName: string, options?: { model?: string, allowReturnToRouter?: boolean }) => Promise<unknown>} switchAgent
 * @property {(options: Record<string, any>) => Promise<any>} executePlan
 * @property {(options: Record<string, any>) => Promise<any>} runPlanningAgent
 * @property {(options: Record<string, any>) => Promise<any>} runValidation
 * @property {(options: Record<string, any>) => Promise<any>} runSlicerAgent
 * @property {(options: Record<string, any>) => Promise<any>} ensureSlicerTasks
 * @property {(workflow: Record<string, any>) => void} setActiveExecutionWorkflow
 * @property {() => void} clearActiveExecutionWorkflow
 * @property {(planName: string) => Promise<string>} askPostApproval
 * @property {(planName: string) => Promise<string>} askProjectDecompositionApproval
 * @property {(planName: string) => Promise<string>} askApprovalWithTasks
 * @property {(meta: { planName: string, planPath: string, triageMeta: Record<string, any> }) => Promise<{ canceled: boolean, approved: boolean, feedback?: string, images?: Array<{base64: string, mimeType: string}> }>} reviewPlan
 * @property {(name: string) => void} rename
 */

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
        getActiveAgentName: () => runtime.getSessionSnapshot(sessionId)?.activeAgent || null,
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
        ensureSlicerTasks: (options) =>
            deps.ensureSlicerTasks
                ? /** @type {any} */ (deps.ensureSlicerTasks)(options)
                : runtime.ensureSlicerTasks(sessionId, options),
        setActiveExecutionWorkflow: (workflow) => {
            runtime.setActiveExecutionWorkflow(sessionId, workflow);
        },
        clearActiveExecutionWorkflow: () => {
            runtime.clearActiveExecutionWorkflow(sessionId);
        },
        askPostApproval: (planName) =>
            deps.askPostApproval
                ? /** @type {any} */ (deps.askPostApproval)(planName)
                : runtime.askPostApproval(sessionId, planName),
        askProjectDecompositionApproval: (planName) =>
            deps.askProjectDecompositionApproval
                ? /** @type {any} */ (deps.askProjectDecompositionApproval)(planName)
                : runtime.askProjectDecompositionApproval(sessionId, planName),
        askApprovalWithTasks: (planName) =>
            deps.askApprovalWithTasks
                ? /** @type {any} */ (deps.askApprovalWithTasks)(planName)
                : runtime.askApprovalWithTasks(sessionId, planName, snapshot.cwd),
        reviewPlan: async (meta) => {
            const response = await runtime.requestInteraction(sessionId, {
                type: RuntimeInteractionTypes.PLAN_REVIEW,
                prompt: `Review plan "${meta.planName}"`,
                _meta: { cwd: snapshot.cwd, ...meta },
            });
            const review = /** @type {any} */ (/** @type {any} */ (response)._meta || {});
            return {
                canceled: response.outcome === RuntimeInteractionOutcomes.CANCELED,
                approved: review.approved === true,
                feedback: typeof review.feedback === "string" ? review.feedback : undefined,
                images: Array.isArray(review.images) ? review.images : undefined,
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
    if (a.worktreeBaseBranch) lines.push(`Target branch:  ${a.worktreeBaseBranch}`);
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
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
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
 * @param {string} opts.projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @returns {Promise<boolean>}
 */
async function putPlanOnHold({ projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent }) {
    if (!isHoldableStatus(plan.attrs.status)) {
        uiAPI.appendSystemMessage(`Plans with status ${plan.attrs.status} cannot be put on hold.`, true, "RunWield");
        return false;
    }

    if (isEpicPlan(plan.attrs)) {
        const children = await findPlansByParent(projectRoot, plan.planName);
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
 * @param {typeof listCommitsTouchingPathsSinceFn} opts.listCommitsTouchingPathsSince
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof getWorktreeStatusFn} opts.getWorktreeStatus
 * @param {typeof inspectExecutionWorktreeMergeRiskFn} opts.inspectExecutionWorktreeMergeRisk
 * @returns {Promise<{ status: "pass" | "warn" | "fail", messages: string[] }>}
 */
async function runResumeCheck({
    projectRoot,
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
 * @param {typeof removeExecutionWorktreeFn} opts.removeExecutionWorktree
 * @returns {Promise<boolean>}
 */
async function resetHeldPlanToDraft({
    projectRoot,
    plan,
    uiAPI,
    recordPlanEvent,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    removeExecutionWorktree,
}) {
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
            if (worktreeContext?.path) {
                await removeExecutionWorktree({
                    projectRoot: projectRoot,
                    path: worktreeContext.path,
                    branch: worktreeContext.branch,
                    force: true,
                });
            }
            if (worktreeContext?.id) {
                await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
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
        cwd: projectRoot,
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
 * @param {typeof removeExecutionWorktreeFn} opts.removeExecutionWorktree
 * @returns {Promise<"resume" | "handled">}
 */
async function handleOnHoldPlan({
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
                projectRoot,
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

/**
 * @param {unknown} executionResult
 * @param {string} planName
 * @param {string} fallbackPlanContent
 * @param {import('../../plan-store.js').PlanFrontMatter} triageMeta
 * @param {PlanSessionSurface["runValidation"]} runValidationLoop
 * @param {typeof loadPlanFn} loadPlan
 * @param {RecoveryWorktreeContext | null} worktreeContext
 * @param {PlanSessionSurface} session
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
) {
    const projectRoot = session.cwd;
    if (!(executionResult && typeof executionResult === "object" && "executionComplete" in executionResult)) return;
    if (!/** @type {{ executionComplete?: boolean }} */ (executionResult).executionComplete) return;
    let planContent = fallbackPlanContent;
    try {
        const latestPlan = await loadPlan(projectRoot, planName);
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
        if (executionCwd || worktreeId || worktreeBranch) workflow.projectRoot = projectRoot;
        if (executionCwd) workflow.executionCwd = executionCwd;
        if (worktreeId) workflow.worktreeId = worktreeId;
        if (worktreeBranch) workflow.worktreeBranch = worktreeBranch;
        session.setActiveExecutionWorkflow(workflow);
    }
    await runValidationLoop({
        planName,
        planContent,
        triageMeta,
    });
}

/**
 * @param {Object} opts
 * @param {import('../../shared/workflow/decisions.js').WorkflowDecision} opts.executionDecision
 * @param {string} opts.fallbackPlanContent
 * @param {PlanSessionSurface["runValidation"]} opts.runValidationLoop
 * @param {typeof loadPlanFn} opts.loadPlan
 * @param {PlanSessionSurface} opts.session
 * @returns {Promise<void>}
 */
async function validatePostExecutionDecision({
    executionDecision,
    fallbackPlanContent,
    runValidationLoop,
    loadPlan,
    session,
}) {
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
        runValidationLoop,
        loadPlan,
        null,
        session,
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
}) {
    const projectRoot = session.cwd;
    if (decision.kind === "start_slicer") {
        await runSlicerAgent({
            planName: /** @type {string} */ (decision.payload.planName),
            triageMeta: /** @type {import('../../plan-store.js').PlanFrontMatter} */ (
                decision.payload.triageMeta
            ),
        });
        return true;
    }
    if (decision.kind !== "execute_plan") return false;

    const planName = /** @type {string} */ (decision.payload.planName);
    const triageMeta = /** @type {import('../../plan-store.js').PlanFrontMatter} */ (decision.payload.triageMeta);
    const tasks = /** @type {import('../../shared/workflow/workflow.js').PlanOutcomeResult["tasks"]} */ (
        decision.payload.tasks
    );

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
        structuredTasks: tasks,
    });
    const executionDecision = decidePostExecution(execRes, {
        planName,
        triageMeta,
        executionAgentName: AGENTS.ENGINEER,
    });
    await validatePostExecutionDecision({
        executionDecision,
        fallbackPlanContent,
        runValidationLoop,
        loadPlan,
        session,
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
 * Run the Readiness Gate for an approved Plan.
 *
 * @param {{ planName: string, path: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {PlanSessionSurface["ensureSlicerTasks"]} ensureSlicerTasks
 * @param {typeof recordPlanEventFn} recordPlanEvent
 * @param {PlanSessionSurface} session
 * @returns {Promise<boolean>}
 */
/**
 * @param {string} projectRoot
 * @param {{ planName: string, path: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {PlanSessionSurface["ensureSlicerTasks"]} ensureSlicerTasks
 * @param {typeof recordPlanEventFn} recordPlanEvent
 * @returns {Promise<boolean>}
 */
async function prepareApprovedPlanForWork(projectRoot, plan, uiAPI, ensureSlicerTasks, recordPlanEvent) {
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

    if (plan.attrs.classification === "PROJECT") {
        const sliceResult = await ensureSlicerTasks({
            planName: plan.planName,
            planPath: plan.path,
            triageMeta: plan.attrs,
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
 * @returns {Promise<void>}
 */
async function executeReadyPlanWithRepair({
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
}) {
    const MAX_REPAIR_ATTEMPTS = 2;
    let currentPlanName = plan.planName;
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    let currentMeta = plan.attrs;
    /** @type {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }> | undefined} */
    let currentTasks = undefined;

    const confirmed = await confirmAffectedPathChangesBeforeExecution({
        projectRoot,
        planName: currentPlanName,
        triageMeta: currentMeta,
        uiAPI,
        listCommitsTouchingPathsSince,
    });
    if (!confirmed) return;

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
        const execRes = await executePlan({
            planName: currentPlanName,
            triageMeta: currentMeta,
            structuredTasks: currentTasks,
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
                runValidationLoop,
                loadPlan,
                session,
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
        await session.switchAgent(agentName);
        const repairOutcome = await runPlanningAgent({
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
/**
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {{ findWorktreeById: typeof findWorktreeByIdFn, findWorktreeByPlanName: typeof findWorktreeByPlanNameFn }} deps
 * @returns {Promise<RecoveryWorktreeContext | null>}
 */
async function resolveRecoveryWorktree(projectRoot, plan, { findWorktreeById, findWorktreeByPlanName }) {
    let entry = null;
    if (plan.attrs.worktreeId) entry = await findWorktreeById(projectRoot, plan.attrs.worktreeId);
    if (!entry) entry = await findWorktreeByPlanName(projectRoot, plan.planName);
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
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {RecoveryWorktreeContext | null} context
 * @param {typeof updatePlanFrontMatterFn} updatePlanFrontMatter
 * @returns {Promise<import('../../plan-store.js').PlanFrontMatter>}
 */
async function persistRecoveredWorktreeMetadata(projectRoot, plan, context, updatePlanFrontMatter) {
    if (!context) return plan.attrs;
    /** @type {Partial<import('../../plan-store.js').PlanFrontMatter>} */
    const updates = {};
    if (context.id && !plan.attrs.worktreeId) updates.worktreeId = context.id;
    if (context.path && !plan.attrs.worktreePath) updates.worktreePath = context.path;
    if (context.branch && !plan.attrs.worktreeBranch) updates.worktreeBranch = context.branch;
    if (context.baseBranch && !plan.attrs.worktreeBaseBranch) updates.worktreeBaseBranch = context.baseBranch;
    if (!Object.keys(updates).length) return plan.attrs;
    return await updatePlanFrontMatter(projectRoot, plan.planName, updates, plan.attrs);
}

/**
 * Detach any prior execution generation before sending a Plan back through
 * review. The physical worktree is retained for inspection, but it is no
 * longer eligible for execution reuse.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {{ planName: string, path: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../shared/workflow/plan-lifecycle.js').PlanStatus} opts.currentStatus
 * @param {RecoveryWorktreeContext | null | undefined} [opts.worktreeContext]
 * @param {typeof findWorktreeByIdFn} opts.findWorktreeById
 * @param {typeof findWorktreeByPlanNameFn} opts.findWorktreeByPlanName
 * @param {typeof updateWorktreeRegistryEntryFn} opts.updateWorktreeRegistryEntry
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {PlanSessionSurface} opts.session
 */
async function reopenPlanForReview({
    projectRoot,
    plan,
    currentStatus,
    worktreeContext,
    findWorktreeById,
    findWorktreeByPlanName,
    updateWorktreeRegistryEntry,
    recordPlanEvent,
    session,
}) {
    const priorWorktree = worktreeContext === undefined
        ? await resolveRecoveryWorktree(projectRoot, plan, { findWorktreeById, findWorktreeByPlanName })
        : worktreeContext;
    if (priorWorktree?.id) {
        await updateWorktreeRegistryEntry(projectRoot, priorWorktree.id, { status: "abandoned" });
    }
    session.clearActiveExecutionWorkflow();
    await stripTasksFromPlanFile(plan);
    const updatedAttrs = await recordPlanEvent({
        cwd: projectRoot,
        planName: plan.planName,
        event: "review_reopened",
        currentStatus,
        details: { triageMeta: plan.attrs },
    });
    plan.attrs = { ...plan.attrs, ...updatedAttrs };
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
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {RecoveryWorktreeContext | null} context
 * @param {PlanSessionSurface} session
 */
function rehydrateActiveRecoveryWorkflow(projectRoot, plan, context, session) {
    const baselineTree = plan.attrs.executionBaselineTree || context?.baseTree;
    if (!baselineTree && !hasWorktreeContext(context)) return;
    /** @type {{ planName: string, triageMeta: import('../../plan-store.js').PlanFrontMatter, baselineTree?: string, projectRoot: string, executionCwd?: string, worktreeId?: string, worktreeBranch?: string, worktreeBaseBranch?: string }} */
    const workflow = {
        planName: plan.planName,
        triageMeta: plan.attrs,
        baselineTree,
        projectRoot: projectRoot,
    };
    if (context?.path) workflow.executionCwd = context.path;
    if (context?.id) workflow.worktreeId = context.id;
    if (context?.branch) workflow.worktreeBranch = context.branch;
    if (context?.baseBranch) workflow.worktreeBaseBranch = context.baseBranch;
    session.setActiveExecutionWorkflow(workflow);
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
async function appendRecoveryReport(projectRoot, plan, uiAPI, getWorkflowDiff, worktreeContext, getWorktreeStatus) {
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
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
async function confirmMetadataOnlyRecoveryCleanup(planName, uiAPI) {
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
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<boolean>}
 */
async function confirmMissingWorktreeRecreate(planName, worktreeContext, uiAPI) {
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
async function confirmRecoveryWorktreeAvailable(projectRoot, planName, worktreeContext, uiAPI, getWorktreeStatus) {
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
 * @param {string} opts.projectRoot
 * @param {{ planName: string, path: string, markdown: string, body: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {string} opts.agentName
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
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
 * @param {typeof createExecutionWorktreeFn} opts.createExecutionWorktree
 * @param {typeof mergeExecutionWorktreeFn} opts.mergeExecutionWorktree
 * @param {typeof preparePrimaryPlanPathForMergeFn} opts.preparePrimaryPlanPathForMerge
 * @param {typeof restorePrimaryPlanPathAfterMergeFailureFn} opts.restorePrimaryPlanPathAfterMergeFailure
 * @param {typeof removeExecutionWorktreeFn} opts.removeExecutionWorktree
 * @param {typeof removeWorktreeRegistryEntryFn} opts.removeWorktreeRegistryEntry
 * @param {typeof shouldCleanupMergedWorktreesFn} opts.shouldCleanupMergedWorktrees
 * @param {typeof recordWorkflowMetric} [opts.recordWorkflowMetric]
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {PlanSessionSurface} opts.session
 * @param {typeof probeGitRepositoryFn} [opts.probeGitRepository]
 * @returns {Promise<"handled" | "review">}
 */
async function handlePlanRecovery({
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
    createExecutionWorktree,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    restorePrimaryPlanPathAfterMergeFailure,
    removeExecutionWorktree,
    removeWorktreeRegistryEntry,
    shouldCleanupMergedWorktrees,
    recordWorkflowMetric: recordWorkflowMetricImpl = recordWorkflowMetric,
    findPlansByParent,
    session,
    probeGitRepository = probeGitRepositoryFn,
}) {
    const refreshRecoveryWorktree = async () => {
        const resolved = await resolveRecoveryWorktree(projectRoot, plan, { findWorktreeById, findWorktreeByPlanName });
        plan.attrs = await persistRecoveredWorktreeMetadata(projectRoot, plan, resolved, updatePlanFrontMatter);
        return resolved;
    };
    let worktreeContext = await refreshRecoveryWorktree();
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
        const hasGitRecoveryMetadata = hasWorktree || Boolean(plan.attrs.executionBaselineTree);
        const gitRecoveryBlocked = !gitProbe.ok && hasGitRecoveryMetadata;
        const resetLabel = gitRecoveryBlocked
            ? "Clear stale Git recovery metadata"
            : hasWorktree
            ? "Delete/recreate worktree and start over"
            : "Reset tree and start over";
        const options = plan.attrs.status === "implemented"
            ? [
                ...(gitRecoveryBlocked ? [] : [{ value: "validate", label: "Retry Workflow Validation" }]),
                { value: "inspect", label: "Inspect and report current state" },
                ...(canMergeWorktree && !gitRecoveryBlocked
                    ? [{ value: "merge", label: "Merge validated worktree changes" }]
                    : []),
                { value: "reset", label: resetLabel },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
                { value: "hold", label: "Put on hold" },
                { value: "cancel", label: "Cancel" },
            ]
            : [
                { value: "inspect", label: "Inspect and report current state" },
                ...(gitRecoveryBlocked
                    ? []
                    : [{ value: "continue", label: "Continue execution from current worktree" }]),
                { value: "reset", label: resetLabel },
                ...(hasWorktree ? [{ value: "abandon", label: "Delete/abandon worktree" }] : []),
                { value: "review", label: "Re-open for review" },
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

        if (answer === "hold") {
            await putPlanOnHold({ projectRoot, plan, uiAPI, recordPlanEvent, findPlansByParent });
            await recordRecoveryResult("hold", "handled");
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
            rehydrateActiveRecoveryWorkflow(projectRoot, plan, worktreeContext, session);
            await validateCompletedExecution(
                { executionComplete: true },
                plan.planName,
                plan.markdown || plan.body || "",
                plan.attrs,
                runValidationLoop,
                loadPlan,
                worktreeContext,
                session,
            );
            await recordRecoveryResult("validate", "handled");
            return "handled";
        }

        if (answer === "continue") {
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
            rehydrateActiveRecoveryWorkflow(projectRoot, plan, worktreeContext, session);
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
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName: plan.planName,
                    event: "recovery_reset",
                    currentStatus: plan.attrs.status,
                    details: { triageMeta: plan.attrs },
                });
                if (worktreeContext?.id) {
                    await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
                }
                plan.attrs = await updatePlanFrontMatter(projectRoot, plan.planName, {
                    executionBaselineTree: null,
                    worktreeId: null,
                    worktreePath: null,
                    worktreeBranch: null,
                    worktreeBaseBranch: null,
                    worktreeStatus: null,
                }, { ...plan.attrs, status: "ready_for_work" });
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
                if (worktreeContext?.path) {
                    try {
                        await removeExecutionWorktree({
                            projectRoot: projectRoot,
                            path: worktreeContext.path,
                            branch: worktreeContext.branch,
                            force: true,
                        });
                    } catch (error) {
                        const message = isGitRepositoryRequiredError(error)
                            ? formatGitRequiredMessage(error)
                            : error instanceof Error
                            ? error.message
                            : String(error);
                        uiAPI.appendSystemMessage(
                            `Cannot delete/recreate the recorded worktree: ${message}`,
                            true,
                            "RunWield",
                        );
                        continue;
                    }
                }
                if (worktreeContext?.id) {
                    await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "abandoned" });
                }
                const recreateBaseBranch = worktreeContext?.baseBranch;
                let recreated;
                try {
                    recreated = await createExecutionWorktree({
                        projectRoot: projectRoot,
                        planName: plan.planName,
                        baseRef: recreateBaseRef,
                        baseBranch: recreateBaseBranch,
                    });
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
                plan.attrs = await updatePlanFrontMatter(projectRoot, plan.planName, {
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
            await recordPlanEvent({
                cwd: projectRoot,
                planName: plan.planName,
                event: "recovery_reset",
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
            /** @type {Awaited<ReturnType<typeof preparePrimaryPlanPathForMergeFn>>[]} */
            const primaryPlanSnapshots = [];
            let mergeCompleted = false;
            try {
                const cleanupMergedWorktrees = shouldCleanupMergedWorktrees(projectRoot);
                const planPath = `plans/${plan.planName}.md`;
                const stagingResult = await stageValidationPassedInExecutionWorktree({
                    projectRoot: projectRoot,
                    executionCwd: worktreeContext.path,
                    planName: plan.planName,
                    details: {
                        triageMeta: plan.attrs,
                        worktreeStatus: "merged",
                        cleanupMergedWorktrees,
                    },
                });
                for (const relativePath of stagingResult.planPaths) {
                    primaryPlanSnapshots.push(
                        await preparePrimaryPlanPathForMerge({ projectRoot: projectRoot, relativePath }),
                    );
                }
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
                const mergeResult = await mergeExecutionWorktree({
                    projectRoot: projectRoot,
                    branch: worktreeContext.branch,
                    targetBranch: worktreeContext.baseBranch,
                    worktreePath: worktreeContext.path,
                    planName: plan.planName,
                    planDescription: plan.attrs.summary,
                    allowedDirtyPaths: [
                        planPath,
                        ".wld/",
                        ".wld/worktrees.json",
                        ".wld/worktrees.lock",
                    ],
                    preservePlanPaths: stagingResult.planPaths,
                });
                mergeCompleted = true;
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
                if (worktreeContext.id) {
                    try {
                        await updateWorktreeRegistryEntry(projectRoot, worktreeContext.id, { status: "merged" });
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
                if (cleanupMergedWorktrees && worktreeContext.path) {
                    try {
                        await removeExecutionWorktree({
                            projectRoot: projectRoot,
                            path: worktreeContext.path,
                            branch: worktreeContext.branch,
                            force: true,
                        });
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
            let removedWorktree = true;
            if (worktreeContext?.path) {
                try {
                    await removeExecutionWorktree({
                        projectRoot: projectRoot,
                        path: worktreeContext.path,
                        branch: worktreeContext.branch,
                        force: true,
                    });
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
            plan.attrs = await updatePlanFrontMatter(projectRoot, plan.planName, {
                worktreeStatus: "abandoned",
                worktreeId: null,
                worktreePath: null,
                worktreeBranch: null,
            }, plan.attrs);
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
                recordPlanEvent,
                session,
            });
            await recordRecoveryResult("review", "review");
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
 * @param {string} projectRoot
 * @param {{ planName: string, attrs: import('../../plan-store.js').PlanFrontMatter }} plan
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {typeof resolveSiblingChildPlanDependenciesFn} resolveSiblingChildPlanDependencies
 * @returns {Promise<boolean>}
 */
async function confirmChildFeatureDependencies(projectRoot, plan, uiAPI, resolveSiblingChildPlanDependencies) {
    if (plan.attrs.classification !== "FEATURE" || !plan.attrs.parentPlan) return true;
    const dependencies = Array.isArray(plan.attrs.dependencies) ? plan.attrs.dependencies : [];
    if (dependencies.length === 0) return true;

    const dependencyStates = await resolveSiblingChildPlanDependencies(
        projectRoot,
        plan.attrs.parentPlan,
        dependencies,
    );
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
 * @param {string} opts.projectRoot
 * @param {{ planName: string, body: string, markdown: string, attrs: import('../../plan-store.js').PlanFrontMatter }} opts.plan
 * @param {import('../../ui/tui/types.js').UiAPI} opts.uiAPI
 * @param {typeof findPlansByParentFn} opts.findPlansByParent
 * @param {PlanSessionSurface["runSlicerAgent"]} opts.runSlicerAgent
 * @param {typeof recordPlanEventFn} opts.recordPlanEvent
 * @param {typeof resolvePlanFn} opts.resolvePlan
 * @param {(childPlanName: string) => Promise<void>} opts.loadChildPlan
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
}) {
    if (!isEpicPlan(plan.attrs)) return "continue";

    const children = (await findPlansByParent(projectRoot, plan.planName)).filter((child) =>
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

    const canReviewWithArchitect = plan.attrs.status === "draft" || plan.attrs.status === "feedback" ||
        plan.attrs.status === "approved";
    const canOpenSlicer = plan.attrs.status === "ready_for_decomposition" || plan.attrs.status === "ready_for_work";

    if (canReviewWithArchitect) {
        const action = canOpenSlicer
            ? "Review it with Architect or resume Slicer decomposition to create child FEATURE plans."
            : "Review it with Architect to continue planning.";
        uiAPI.appendSystemMessage(
            `This PROJECT Epic is not executable. ${action}`,
            false,
            "RunWield",
        );
    } else if (!hasChildren) {
        uiAPI.appendSystemMessage("This PROJECT Epic has no child FEATURE plans yet.", false, "RunWield");
    }

    while (true) {
        /** @type {Array<{ value: string, label: string }>} */
        const epicOptions = [
            ...(canPickChild ? [{ value: "pick_child", label: "Pick a child FEATURE plan" }] : []),
            ...(canReviewWithArchitect ? [{ value: "review", label: "Review with Architect" }] : []),
            ...(canOpenSlicer ? [{ value: "slicer", label: "Open or resume Slicer decomposition" }] : []),
            ...(hasChildren && plan.attrs.status === "ready_for_work"
                ? [{ value: "done_enough", label: "Mark Epic done enough for now" }]
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

        if (answer === "review") {
            return "review";
        }

        if (answer === "slicer") {
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
                            const childPlan = await resolvePlan(projectRoot, String(childPlanName));
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
        decidePostPlanning: decidePostPlanningDep,
        decidePostExecution: decidePostExecutionDep,
        loadPlan: loadPlanDep,
        getWorkflowDiff: getWorkflowDiffDep,
        listCommitsTouchingPathsSince: listCommitsTouchingPathsSinceDep,
        restoreWorktreeTree: restoreWorktreeTreeDep,
        listPlans: listPlansDep,
        findPlansByParent: findPlansByParentDep,
        resolveSiblingChildPlanDependencies: resolveSiblingChildPlanDependenciesDep,
        recordPlanEvent: recordPlanEventDep,
        stageValidationPassedInExecutionWorktree: stageValidationPassedInExecutionWorktreeDep,
        updatePlanFrontMatter: updatePlanFrontMatterDep,
        findWorktreeById: findWorktreeByIdDep,
        findWorktreeByPlanName: findWorktreeByPlanNameDep,
        updateWorktreeRegistryEntry: updateWorktreeRegistryEntryDep,
        getWorktreeStatus: getWorktreeStatusDep,
        createExecutionWorktree: createExecutionWorktreeDep,
        inspectExecutionWorktreeMergeRisk: inspectExecutionWorktreeMergeRiskDep,
        mergeExecutionWorktree: mergeExecutionWorktreeDep,
        preparePrimaryPlanPathForMerge: preparePrimaryPlanPathForMergeDep,
        restorePrimaryPlanPathAfterMergeFailure: restorePrimaryPlanPathAfterMergeFailureDep,
        removeExecutionWorktree: removeExecutionWorktreeDep,
        removeWorktreeRegistryEntry: removeWorktreeRegistryEntryDep,
        shouldCleanupMergedWorktrees: shouldCleanupMergedWorktreesDep,
        recordWorkflowMetric: recordWorkflowMetricDep,
        probeGitRepository: probeGitRepositoryDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const resolvePlan = resolvePlanDep || resolvePlanFn;
    const decidePostPlanning = decidePostPlanningDep || decidePostPlanningFn;
    const decidePostExecution = decidePostExecutionDep || decidePostExecutionFn;
    const loadPlan = loadPlanDep || loadPlanFn;
    const getWorkflowDiff = getWorkflowDiffDep || getWorkflowDiffFn;
    const listCommitsTouchingPathsSince = listCommitsTouchingPathsSinceDep || listCommitsTouchingPathsSinceFn;
    const restoreWorktreeTree = restoreWorktreeTreeDep || restoreWorktreeTreeFn;
    let sessionRuntime = options.sessionRuntime;
    let runtimeSessionId = options.sessionId;
    const findPlansByParent = findPlansByParentDep || findPlansByParentFn;
    const resolveSiblingChildPlanDependencies = resolveSiblingChildPlanDependenciesDep ||
        resolveSiblingChildPlanDependenciesFn;
    const recordPlanEvent = recordPlanEventDep || recordPlanEventFn;
    const stageValidationPassedInExecutionWorktree = stageValidationPassedInExecutionWorktreeDep ||
        stageValidationPassedInExecutionWorktreeFn;
    const updatePlanFrontMatter = updatePlanFrontMatterDep || updatePlanFrontMatterFn;
    const findWorktreeById = findWorktreeByIdDep || findWorktreeByIdFn;
    const findWorktreeByPlanName = findWorktreeByPlanNameDep || findWorktreeByPlanNameFn;
    const updateWorktreeRegistryEntry = updateWorktreeRegistryEntryDep || updateWorktreeRegistryEntryFn;
    const getWorktreeStatus = getWorktreeStatusDep || getWorktreeStatusFn;
    const createExecutionWorktree = createExecutionWorktreeDep || createExecutionWorktreeFn;
    const inspectExecutionWorktreeMergeRisk = inspectExecutionWorktreeMergeRiskDep ||
        inspectExecutionWorktreeMergeRiskFn;
    const mergeExecutionWorktree = mergeExecutionWorktreeDep || mergeExecutionWorktreeFn;
    const preparePrimaryPlanPathForMerge = preparePrimaryPlanPathForMergeDep || preparePrimaryPlanPathForMergeFn;
    const restorePrimaryPlanPathAfterMergeFailure = restorePrimaryPlanPathAfterMergeFailureDep ||
        restorePrimaryPlanPathAfterMergeFailureFn;
    const removeExecutionWorktree = removeExecutionWorktreeDep || removeExecutionWorktreeFn;
    const removeWorktreeRegistryEntry = removeWorktreeRegistryEntryDep || removeWorktreeRegistryEntryFn;
    const shouldCleanupMergedWorktrees = shouldCleanupMergedWorktreesDep || shouldCleanupMergedWorktreesFn;
    const recordWorkflowMetricForLoadPlan = recordWorkflowMetricDep || recordWorkflowMetric;
    const probeGitRepository = probeGitRepositoryDep || probeGitRepositoryFn;

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
    const askPostApproval = session.askPostApproval;
    const askApprovalWithTasks = session.askApprovalWithTasks;
    const askProjectDecompositionApproval = session.askProjectDecompositionApproval;
    const ensureSlicerTasks = session.ensureSlicerTasks;
    const runValidationLoop = session.runValidation;
    const runSlicerAgent = session.runSlicerAgent;
    const switchPlanAgent = session.switchAgent;

    let skipRouterRestore = false;
    const initialAgentName = session.getActiveAgentName() || AGENTS.ROUTER;
    let restoreAgentName = initialAgentName;

    try {
        const plan = await resolvePlan(projectRoot, planArg);
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
                removeExecutionWorktree,
            });
            if (result === "handled") return;
        }

        if (["in_progress", "failed", "implemented"].includes(plan.attrs.status)) {
            restoreAgentName = planFlowRestoreAgent;
            const result = await handlePlanRecovery({
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
                createExecutionWorktree,
                mergeExecutionWorktree,
                preparePrimaryPlanPathForMerge,
                restorePrimaryPlanPathAfterMergeFailure,
                removeExecutionWorktree,
                removeWorktreeRegistryEntry,
                shouldCleanupMergedWorktrees,
                recordWorkflowMetric: recordWorkflowMetricForLoadPlan,
                findPlansByParent,
                session,
                probeGitRepository,
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
        });
        if (epicResult === "handled") {
            skipRouterRestore = true;
            return;
        }
        const forceReview = epicResult === "review";

        const dependenciesConfirmed = await confirmChildFeatureDependencies(
            projectRoot,
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
                await reopenPlanForReview({
                    projectRoot,
                    plan,
                    currentStatus: "verified",
                    findWorktreeById,
                    findWorktreeByPlanName,
                    updateWorktreeRegistryEntry,
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
                    { value: "review", label: "Re-open for review (edit/annotate)" },
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

                if (answer === "proceed") {
                    restoreAgentName = planFlowRestoreAgent;
                    if (plan.attrs.status === "approved") {
                        const ready = await prepareApprovedPlanForWork(
                            projectRoot,
                            plan,
                            uiAPI,
                            ensureSlicerTasks,
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
                    });
                    return;
                }

                if (answer === "review") {
                    restoreAgentName = planFlowRestoreAgent;
                    if (isExecutablePlanStatus(plan.attrs.status)) {
                        await reopenPlanForReview({
                            projectRoot,
                            plan,
                            currentStatus: plan.attrs.status,
                            findWorktreeById,
                            findWorktreeByPlanName,
                            updateWorktreeRegistryEntry,
                            recordPlanEvent,
                            session,
                        });
                    } else {
                        // Approved Plans do not have an execution generation yet,
                        // but their generated task slices still need refreshing.
                        await stripTasksFromPlanFile(plan);
                    }

                    await switchPlanAgent(agentName);

                    const reviewResult = await session.reviewPlan({
                        planName: plan.planName,
                        planPath: plan.path,
                        triageMeta: plan.attrs,
                    });

                    if (reviewResult.canceled) {
                        uiAPI.appendSystemMessage("Plan review canceled.", false, "RunWield");
                        skipRouterRestore = true;
                        return;
                    }

                    if (reviewResult.approved) {
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
                            const action = await askProjectDecompositionApproval(plan.planName);
                            if (action === "proceed") {
                                await runSlicerAgent({
                                    planName: plan.planName,
                                    triageMeta: plan.attrs,
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
                            projectRoot,
                            plan,
                            uiAPI,
                            ensureSlicerTasks,
                            recordPlanEvent,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                        const action = plan.attrs.classification === "PROJECT"
                            ? await askApprovalWithTasks(plan.planName)
                            : await askPostApproval(plan.planName);
                        if (action === "proceed") {
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
                            const executionDecision = decidePostExecution(execRes, {
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                executionAgentName: agentName,
                            });
                            await validatePostExecutionDecision({
                                executionDecision,
                                fallbackPlanContent: plan.markdown || plan.body || "",
                                runValidationLoop,
                                loadPlan,
                                session,
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
                        agentName,
                        initialRequest: buildReReviewRevisionRequest(plan.planName, reviewResult.feedback),
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
        });
        if (shouldKeepPlanningAgentActive(planningDecision)) {
            skipRouterRestore = true;
        }
    } finally {
        if (!skipRouterRestore) {
            await restorePreviousAgentFlow(uiAPI, restoreAgentName, session);
        }
    }
}
