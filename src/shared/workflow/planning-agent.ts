// @ts-nocheck: extracted from checked JSDoc workflow.js; tightening types is out of scope for this structural split.
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { claimWorkflowToolEvent, settleWorkflowToolEvent } from "./workflow-tool-events.ts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { HostedSession } from "../session/hosted-session.js";
import type { PlanFrontMatter } from "../../plan-store.js";
import type { AssociationPurpose } from "../session/plan-association.ts";

/**
 * @typedef {"approved_execute" | "approved_decompose" | "saved" | "feedback" | "canceled" | "repair_required" | "no_call"} PlanOutcome
 */

/**
 * @typedef {Object} PlanOutcomeResult
 * @property {PlanOutcome} outcome
 * @property {string} [planName]
 * @property {import('../../tools/plan-written.ts').TriageMeta} [triageMeta]
 * @property {string} [feedback]
 * @property {Array<{base64: string, mimeType: string}>} [images]
 */

type PlanOutcomeResult = import("./workflow-tool-events.ts").PlanWrittenEventPayload;

export interface RunPlanningAgentOptions {
    agentName: string;
    initialRequest: string;
    hostedSession: HostedSession;
    triageMeta?: Partial<PlanFrontMatter>;
    sessionManager?: SessionManager;
    images?: Array<{ base64: string; mimeType: string }>;
    /**
     * The Plan this turn is already known to be about — resume, re-review, and Epic
     * child continuation all know it before the agent starts.
     */
    planName?: string;
    associationPurpose?: AssociationPurpose;
}

export async function runPlanningAgent(
    {
        agentName,
        initialRequest,
        triageMeta,
        sessionManager,
        hostedSession,
        images,
        planName,
        associationPurpose = "planning",
    }: RunPlanningAgentOptions,
): Promise<PlanOutcomeResult> {
    if (!hostedSession) throw new Error("runPlanningAgent: hostedSession is required");

    // Callers resuming or re-reviewing an existing Plan already know its name.
    // Recording it before the turn is what makes the draft reachable after
    // compaction: the transcript is lossy, so a pointer parsed back out of it is
    // exactly the thing that goes missing.
    if (planName) hostedSession.setWorkflowPlanName(planName);
    const planId = typeof triageMeta?.planId === "string" ? triageMeta.planId : "";
    if (planName && planId && hostedSession.getManagedOperationCapability?.()) {
        hostedSession.recordPlanAssociation({ planId, planName, purpose: associationPurpose });
    }

    const turnId = hostedSession.getActiveTurnId?.() || undefined;
    await runActiveAgentTurn({
        hostedSession,
        agentName,
        userRequest: initialRequest,
        images,
        sessionManager,
        triageMeta,
    });

    const event = claimWorkflowToolEvent(hostedSession, {
        kinds: ["plan_written"],
        owningSession: null,
        ...(turnId ? { turnId } : {}),
    });
    if (event?.kind !== "plan_written") return { outcome: "no_call" as const };
    settleWorkflowToolEvent(hostedSession, event);
    return event.payload as PlanOutcomeResult;
}
