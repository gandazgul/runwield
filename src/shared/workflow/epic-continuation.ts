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
import { AGENTS, isPlannedChangeClassification } from "../../constants.js";
import { recordPlanEvent } from "./plan-lifecycle.js";
import { executePlan, runPlanningAgent } from "./workflow.js";
import { decidePostExecution, decidePostPlanning } from "./decisions.js";
import { buildTriageReport } from "./workflow-prompts.js";
import { SYSTEM_SEMANTIC_REVIEW_PORT } from "./validation.ts";
import { continueWorkflowValidation } from "./validation-supervisor.ts";
import { emitSystemStatus } from "../session/session-runtime-events.js";
import { buildPlanSummary } from "../plan-presentation.ts";
import type { PlanFrontMatter } from "../../plan-store.js";
import type { HostedSession } from "../session/hosted-session.js";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { WorkflowValidationResult } from "./validation.ts";
import { createGitPort } from "../git-port.ts";
import { systemLocalCIPort } from "./validation-local-ci.ts";
import { SYSTEM_WORK_RECORD_MNEMOSYNE_PORT } from "../work-records/mnemosyne-port.ts";

const TERMINAL_CHILD_STATUSES = new Set(["validated", "verified", "user_verified", "closed_without_verification"]);

/** A child Plan of the Epic being continued. */
export interface EpicContinuationChild {
    name: string;
    path: string;
    attrs: PlanFrontMatter;
}

/** What the Epic should do next, and why. */
export interface EpicContinuationResolution {
    kind: "none" | "blocked" | "plan" | "readiness_execute" | "execute";
    completedPlanName: string;
    parentPlanName?: string;
    childPlanName?: string;
    childStatus?: string;
    childSummary?: string;
    reason?: string;
}

/** Whether these Front Matter attributes describe an Epic still doing work. */
function isActiveProjectEpic(attrs: PlanFrontMatter | undefined): boolean {
    if (attrs?.classification !== "PROJECT") return false;
    if (
        attrs.status === "on_hold" || attrs.status === "validated" || attrs.status === "verified" ||
        attrs.status === "user_verified" ||
        attrs.status === "closed_without_verification"
    ) {
        return false;
    }
    return attrs.epicCompletionMode !== "done_enough";
}

/** The continuation action a child Plan's status calls for, if any. */
function actionForStatus(status: string): EpicContinuationResolution["kind"] | null {
    if (status === "draft" || status === "feedback") return "plan";
    if (status === "approved") return "readiness_execute";
    if (status === "ready_for_work") return "execute";
    return null;
}

/** What `resolveEpicContinuation` needs to pick the next child. */
export interface ResolveEpicContinuationOptions {
    cwd: string;
    completedPlanName: string;
}

/** What `runEpicChildContinuation` needs to run the child it was given. */
export interface RunEpicChildContinuationOptions {
    hostedSession: HostedSession;
    resolution: EpicContinuationResolution;
    sessionManager?: SessionManager;
}

/**
 * Resolve the next child action after a verified child FEATURE completes.
 */
export async function resolveEpicContinuation(
    { cwd, completedPlanName }: ResolveEpicContinuationOptions,
): Promise<EpicContinuationResolution> {
    const completed = await loadPlan(cwd, completedPlanName);
    if (!completed) return { kind: "none", reason: "completed_plan_missing", completedPlanName };
    if (
        !isPlannedChangeClassification(completed.attrs.classification) ||
        !TERMINAL_CHILD_STATUSES.has(completed.attrs.status)
    ) {
        return { kind: "none", reason: "completed_plan_not_completed_child_feature", completedPlanName };
    }
    const parentPlanName = typeof completed.attrs.parentPlan === "string" ? completed.attrs.parentPlan.trim() : "";
    if (!parentPlanName) return { kind: "none", reason: "completed_plan_has_no_parent_epic", completedPlanName };
    const parent = await loadPlan(cwd, parentPlanName);
    if (!parent) return { kind: "none", reason: "parent_epic_missing", completedPlanName, parentPlanName };
    if (!isActiveProjectEpic(parent.attrs)) {
        return { kind: "none", reason: "parent_epic_not_active", completedPlanName, parentPlanName };
    }

    const siblings = (await findPlansByParent(cwd, parentPlanName))
        .filter((plan) => isPlannedChangeClassification(plan.attrs.classification))
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

    const dependencies = await resolveSiblingChildPlanDependencies(cwd, parentPlanName, next.attrs.dependencies || []);
    const unmet = dependencies.find((dependency) =>
        dependency.state !== "verified" && dependency.state !== "user_verified"
    );
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

/** The prompt handed to the Planner when a child Plan is resumed. */
function buildResumeRequest(planName: string, attrs: PlanFrontMatter): string {
    return [
        `## Resuming Epic Child Plan: ${planName}`,
        "",
        `RunWield automatically selected docs/plans/${planName}.md from its parent Epic. Status: ${attrs.status}.`,
        "",
        buildTriageReport(attrs),
    ].join("\n");
}

/**
 * Show the next child Plan the same way the manual load flow does: a loading
 * notice followed by the Plan details summary. Returns the loaded Plan, or null
 * when the child Plan is missing.
 */
export async function presentEpicChildPlan(
    hostedSession: HostedSession,
    planName: string,
): Promise<Awaited<ReturnType<typeof loadPlan>> | null> {
    emitSystemStatus(hostedSession, `Loading Plan: ${planName}`, { header: "RunWield" });
    const plan = await loadPlan(hostedSession.cwd, planName);
    if (!plan) {
        emitSystemStatus(hostedSession, `Epic continuation stopped: child Plan not found: ${planName}`, {
            level: "warning",
            header: "RunWield",
        });
        return null;
    }
    emitSystemStatus(hostedSession, buildPlanSummary(plan), { header: "Plan" });
    return plan;
}

/**
 * Execute the resolved child workflow inside the supplied fresh HostedSession.
 */
export async function runEpicChildContinuation(
    { hostedSession, resolution, sessionManager }: RunEpicChildContinuationOptions,
): Promise<WorkflowValidationResult | null> {
    if (!["plan", "readiness_execute", "execute"].includes(resolution.kind) || !resolution.childPlanName) return null;
    const planName = resolution.childPlanName;
    const plan = await presentEpicChildPlan(hostedSession, planName);
    if (!plan) return null;

    if (resolution.kind === "plan") {
        const outcome = await runPlanningAgent({
            agentName: AGENTS.PLANNER,
            initialRequest: buildResumeRequest(planName, plan.attrs),
            triageMeta: plan.attrs,
            sessionManager,
            hostedSession,
            planName,
        });
        const decision = decidePostPlanning(outcome, {
            planningAgentName: AGENTS.PLANNER,
            fallbackTriageMeta: plan.attrs,
        });
        if (decision.kind !== "execute_plan") return null;
    }

    if (resolution.kind === "readiness_execute") {
        await recordPlanEvent({
            cwd: hostedSession.cwd,
            planName,
            event: "readiness_passed",
            currentStatus: "approved",
            details: { triageMeta: plan.attrs },
        });
        plan.attrs.status = "ready_for_work";
    }

    const executionResult = await executePlan({ planName, triageMeta: plan.attrs, sessionManager, hostedSession });
    const executionDecision = decidePostExecution(executionResult, {
        planName,
        triageMeta: plan.attrs,
        executionAgentName: hostedSession.getActiveExecutionWorkflow?.()?.executionAgent || AGENTS.ENGINEER,
    });
    if (executionDecision.kind !== "run_validation") return null;
    const latestPlan = await loadPlan(hostedSession.cwd, planName);
    return /** @type {any} */ (await continueWorkflowValidation({
        hostedSession,
        planName,
        planContent: latestPlan?.markdown || plan.markdown || plan.body || "",
        triageMeta: latestPlan?.attrs || plan.attrs,
        sessionManager,
        finalAgentName: AGENTS.ROUTER,
        executionContext: executionResult.executionContext,
        git: createGitPort(),
        localCI: systemLocalCIPort,
        workRecordMnemosynePort: SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
        semanticReviewPort: SYSTEM_SEMANTIC_REVIEW_PORT,
    }));
}
