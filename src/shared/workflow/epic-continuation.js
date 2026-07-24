/**
 * @module shared/workflow/epic-continuation
 * Strict ordered continuation for child FEATURE plans inside PROJECT Epics.
 */

import {
    compareChildPlansByOrder,
    findPlansByParent,
    loadPlan,
    resolveSiblingChildPlanDependencies,
} from "../../plan-store.js";
import { AGENTS } from "../../constants.js";
import { recordPlanEvent } from "./plan-lifecycle.js";
import { executePlan, runPlanningAgent } from "./workflow.js";
import { decidePostExecution, decidePostPlanning } from "./decisions.js";
import { runValidationLoop } from "./validation.js";
import { emitSystemStatus } from "../session/session-runtime-events.js";

const TERMINAL_CHILD_STATUSES = new Set(["verified", "closed_without_verification"]);

/**
 * @typedef {Object} EpicContinuationChild
 * @property {string} name
 * @property {string} path
 * @property {import('../../plan-store.js').PlanFrontMatter} attrs
 */

/**
 * @typedef {Object} EpicContinuationResolution
 * @property {"none"|"blocked"|"plan"|"readiness_execute"|"execute"} kind
 * @property {string} completedPlanName
 * @property {string} [parentPlanName]
 * @property {string} [childPlanName]
 * @property {string} [childStatus]
 * @property {string} [childSummary]
 * @property {string} [reason]
 */

/**
 * @param {import('../../plan-store.js').PlanFrontMatter | undefined} attrs
 * @returns {boolean}
 */
function isActiveProjectEpic(attrs) {
    if (attrs?.classification !== "PROJECT") return false;
    if (attrs.status === "on_hold" || attrs.status === "verified" || attrs.status === "closed_without_verification") {
        return false;
    }
    return attrs.epicCompletionMode !== "done_enough";
}

/**
 * @param {string} status
 * @returns {EpicContinuationResolution["kind"] | null}
 */
function actionForStatus(status) {
    if (status === "draft" || status === "feedback") return "plan";
    if (status === "approved") return "readiness_execute";
    if (status === "ready_for_work") return "execute";
    return null;
}

/**
 * Resolve the next child action after a verified child FEATURE completes.
 *
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} opts.completedPlanName
 * @param {{ loadPlan?: typeof loadPlan, findPlansByParent?: typeof findPlansByParent, resolveSiblingChildPlanDependencies?: typeof resolveSiblingChildPlanDependencies }} [opts.__deps]
 * @returns {Promise<EpicContinuationResolution>}
 */
export async function resolveEpicContinuation({ cwd, completedPlanName, __deps = {} }) {
    const loadPlanImpl = __deps.loadPlan || loadPlan;
    const findPlansByParentImpl = __deps.findPlansByParent || findPlansByParent;
    const resolveDependenciesImpl = __deps.resolveSiblingChildPlanDependencies || resolveSiblingChildPlanDependencies;
    const completed = await loadPlanImpl(cwd, completedPlanName);
    if (!completed) return { kind: "none", reason: "completed_plan_missing", completedPlanName };
    if (completed.attrs.classification !== "FEATURE" || completed.attrs.status !== "verified") {
        return { kind: "none", reason: "completed_plan_not_verified_child_feature", completedPlanName };
    }
    const parentPlanName = typeof completed.attrs.parentPlan === "string" ? completed.attrs.parentPlan.trim() : "";
    if (!parentPlanName) return { kind: "none", reason: "completed_plan_has_no_parent_epic", completedPlanName };
    const parent = await loadPlanImpl(cwd, parentPlanName);
    if (!parent) return { kind: "none", reason: "parent_epic_missing", completedPlanName, parentPlanName };
    if (!isActiveProjectEpic(parent.attrs)) {
        return { kind: "none", reason: "parent_epic_not_active", completedPlanName, parentPlanName };
    }

    const siblings = (await findPlansByParentImpl(cwd, parentPlanName))
        .filter((plan) => plan.attrs.classification === "FEATURE")
        .sort(compareChildPlansByOrder);
    const next = siblings.find((plan) => !TERMINAL_CHILD_STATUSES.has(plan.attrs.status));
    if (!next) return { kind: "none", reason: "no_remaining_children", completedPlanName, parentPlanName };

    const childPlanName = next.name;
    const childStatus = next.attrs.status;
    if (childStatus === "on_hold") {
        return {
            kind: "blocked",
            reason: "child_on_hold",
            completedPlanName,
            parentPlanName,
            childPlanName,
            childStatus,
        };
    }
    if (["in_progress", "failed", "implemented"].includes(childStatus)) {
        return {
            kind: "blocked",
            reason: "child_needs_recovery",
            completedPlanName,
            parentPlanName,
            childPlanName,
            childStatus,
        };
    }

    const dependencies = await resolveDependenciesImpl(cwd, parentPlanName, next.attrs.dependencies || []);
    const unmet = dependencies.find((dependency) => dependency.state !== "verified");
    if (unmet) {
        return {
            kind: "blocked",
            reason: unmet.state === "missing" ? "dependency_missing" : "dependency_unverified",
            completedPlanName,
            parentPlanName,
            childPlanName,
            childStatus,
        };
    }

    const action = actionForStatus(childStatus);
    if (!action) {
        return {
            kind: "blocked",
            reason: "unsupported_child_status",
            completedPlanName,
            parentPlanName,
            childPlanName,
            childStatus,
        };
    }
    return {
        kind: action,
        completedPlanName,
        parentPlanName,
        childPlanName,
        childStatus,
        childSummary: next.attrs.summary || childPlanName,
    };
}

/**
 * @param {string} planName
 * @param {import('../../plan-store.js').PlanFrontMatter} attrs
 * @returns {string}
 */
function buildResumeRequest(planName, attrs) {
    return [
        `## Resuming Epic Child Plan: ${planName}`,
        "",
        `This child FEATURE was automatically selected from its parent Epic with status: ${attrs.status}.`,
        `Continue working on it. The plan is at plans/${planName}.md.`,
        "",
        "## Triage Report",
        `- Classification: ${attrs.classification}`,
        `- Complexity: ${attrs.complexity}`,
        `- Summary: ${attrs.summary}`,
        `- Affected paths: ${(attrs.affectedPaths || []).join(", ")}`,
        "",
        "Review the current plan, make any needed updates, and finalize it.",
        "When the plan is ready, call plan_written to submit it for review.",
    ].join("\n");
}

/**
 * Execute the resolved child workflow inside the supplied fresh HostedSession.
 *
 * @param {Object} opts
 * @param {import('../session/hosted-session.js').HostedSession} opts.hostedSession
 * @param {EpicContinuationResolution} opts.resolution
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} [opts.sessionManager]
 * @param {{ loadPlan?: typeof loadPlan, recordPlanEvent?: typeof recordPlanEvent, runPlanningAgent?: typeof runPlanningAgent, executePlan?: typeof executePlan, runValidationLoop?: typeof runValidationLoop, decidePostPlanning?: typeof decidePostPlanning, decidePostExecution?: typeof decidePostExecution }} [opts.__deps]
 * @returns {Promise<import('./validation.js').WorkflowValidationResult | null>}
 */
export async function runEpicChildContinuation({ hostedSession, resolution, sessionManager, __deps = {} }) {
    if (!["plan", "readiness_execute", "execute"].includes(resolution.kind) || !resolution.childPlanName) return null;
    const loadPlanImpl = __deps.loadPlan || loadPlan;
    const recordPlanEventImpl = __deps.recordPlanEvent || recordPlanEvent;
    const runPlanningAgentImpl = __deps.runPlanningAgent || runPlanningAgent;
    const executePlanImpl = __deps.executePlan || executePlan;
    const runValidationLoopImpl = __deps.runValidationLoop || runValidationLoop;
    const decidePostPlanningImpl = __deps.decidePostPlanning || decidePostPlanning;
    const decidePostExecutionImpl = __deps.decidePostExecution || decidePostExecution;
    const planName = resolution.childPlanName;
    const plan = await loadPlanImpl(hostedSession.cwd, planName);
    if (!plan) {
        emitSystemStatus(hostedSession, `Epic continuation stopped: child Plan not found: ${planName}`, {
            level: "warning",
            header: "RunWield",
        });
        return null;
    }

    if (resolution.kind === "plan") {
        const outcome = await runPlanningAgentImpl({
            agentName: AGENTS.PLANNER,
            initialRequest: buildResumeRequest(planName, plan.attrs),
            triageMeta: plan.attrs,
            sessionManager,
            hostedSession,
        });
        const decision = decidePostPlanningImpl(outcome, {
            planningAgentName: AGENTS.PLANNER,
            fallbackTriageMeta: plan.attrs,
        });
        if (decision.kind !== "execute_plan") return null;
    }

    if (resolution.kind === "readiness_execute") {
        await recordPlanEventImpl({
            cwd: hostedSession.cwd,
            planName,
            event: "readiness_passed",
            currentStatus: "approved",
            details: { triageMeta: plan.attrs },
        });
        plan.attrs.status = "ready_for_work";
    }

    const executionResult = await executePlanImpl({ planName, triageMeta: plan.attrs, sessionManager, hostedSession });
    const executionDecision = decidePostExecutionImpl(executionResult, {
        planName,
        triageMeta: plan.attrs,
        executionAgentName: hostedSession.getActiveExecutionWorkflow?.()?.executionAgent || AGENTS.ENGINEER,
    });
    if (executionDecision.kind !== "run_validation") return null;
    const latestPlan = await loadPlanImpl(hostedSession.cwd, planName);
    return /** @type {any} */ (await runValidationLoopImpl({
        hostedSession,
        planName,
        planContent: latestPlan?.markdown || plan.markdown || plan.body || "",
        triageMeta: latestPlan?.attrs || plan.attrs,
        sessionManager,
        finalAgentName: AGENTS.ROUTER,
        executionContext: executionResult.executionContext,
    }));
}
