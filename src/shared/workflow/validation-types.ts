/**
 * @module shared/workflow/validation-types
 * Shared engine-internal types and constants for the session-independent Workflow
 * Validation engine.
 *
 * The engine's sequencing and convergence policy lives here as data: the status
 * order, the phase-to-status map, and the round limits. The phases themselves live
 * in the phase modules; this module is what they agree on.
 */

import type { ReviewLedger } from "./review-ledger.ts";
import type { ResolvedValidationContext } from "./execution-context.ts";
import type { ValidationLocalCIPort, ValidationSessionPort, ValidationWorkflowState } from "./validation-ports.ts";
import type { ObjectiveCheckResult } from "./objective-checks.ts";

type PlanFrontMatter = import("../../plan-store.js").PlanFrontMatter;
type GitPort = import("../git-port.ts").GitPort;
type WorkRecordMnemosynePort = import("../work-records/mnemosyne-port.ts").WorkRecordMnemosynePort;
type RecordPlanEventArgs = Parameters<typeof import("./plan-lifecycle.js").recordPlanEvent>[0];
type RecordPlanEventResult = Awaited<ReturnType<typeof import("./plan-lifecycle.js").recordPlanEvent>>;

/** The engine's result shape, mirroring the public entry's `WorkflowValidationResult`. */
export type WorkflowValidationResult = {
    kind: "verified" | "paused" | "failed";
    planName: string;
    projectRoot: string;
    classification?: string;
    reason?: string;
    epicContinuation?: { completedPlanName: string; projectRoot: string };
};

export type ValidationPhaseResult = WorkflowValidationResult & {
    awaitingTaskCompletion?: true;
};

/** Triage metadata the engine reads Plan front matter through. */
export type TriageMeta = import("../../tools/plan-written.ts").TriageMeta;

type PlanStatus = "implemented" | "validated_ci" | "validated_reviewer";
type PlanEvent = RecordPlanEventArgs["event"];
type PlanEventStatus = RecordPlanEventArgs["currentStatus"];

/**
 * Everything one validation phase needs, assembled by the engine and the phase
 * modules. The session surface is the port; Plan Lifecycle, transitions, registry
 * and locks stay direct imports per the ownership heuristic.
 */
export type ValidationLoopArgs = {
    planName: string;
    planContent: string;
    triageMeta: TriageMeta;
    session: ValidationSessionPort;
    finalAgentName?: string;
    executionContext?: ValidationWorkflowState;
    git: GitPort;
    localCI: ValidationLocalCIPort;
    workRecordMnemosynePort: WorkRecordMnemosynePort;
};

/** The resolved execution facts a phase runs against. */
export type PhaseContext = {
    args: ValidationLoopArgs;
    projectRoot: string;
    executionContext: ResolvedValidationContext;
    baselineTree?: string;
    executionCwd: string;
    executionAgent: "engineer" | "frontend-engineer";
    worktreeId?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    nonGitInPlace: boolean;
    workflowBase: ValidationWorkflowState;
};

/** Durable semantic review state carried across pauses. */
export type SemanticRoundState = {
    semanticRound: number;
    reviewLedger: ReviewLedger;
    repairBaselineTree: string;
    lastRepairReport: string;
};

export type HumanReviewMetadata = {
    humanReviewMode: PlanFrontMatter["humanReviewMode"];
    humanReviewDecision: PlanFrontMatter["humanReviewDecision"];
    humanReviewedAt: string | null;
};

export type PublicationOutcome = {
    result: ValidationPhaseResult;
    recorded: boolean;
};

export type UserActionChoice = "engineer_follow_up" | "retry" | "stop";

export type UserActionOption = {
    value: UserActionChoice;
    label: string;
    description?: string;
};

/** A pause for a decision only the user can make. */
export type UserActionPause = {
    /** One sentence, past tense: the thing that stopped. */
    whatHappened: string;
    /** One or two sentences, imperative: the user's move. */
    doThis: string;
    /** Optional paths or names the sentences refer to. */
    details?: string[];
    /** Optional choices. Defaults to Retry and Stop. */
    options?: UserActionOption[];
};

export type ReviewFeedbackImage = { base64: string; mimeType: string };
export type BrokenObjectiveCheckReport = import("./objective-checks.ts").BrokenObjectiveCheckReport;

export type ReviewFeedbackRepairPacket = {
    diffText: string;
    findingsSection: string;
    repairKind: "semantic" | "human_feedback";
    reason: string;
    images?: ReviewFeedbackImage[];
    activeWorkflow?: Partial<ValidationWorkflowState>;
};

export type ObjectiveCheckPhaseOutcome =
    | { kind: "passed" }
    | { kind: "skipped" }
    | { kind: "canceled" }
    | { kind: "unmet"; reason: string; results: ObjectiveCheckResult[] }
    | { kind: "broken"; reason: string; results: ObjectiveCheckResult[] };

/** How many automatic reviewer rounds run before the user takes the wheel. */
export const AUTOMATIC_ROUNDS = 3;

/** Rounds one and two sweep the whole Plan; from three on the reviewer only verifies. */
export const DISCOVERY_ROUNDS = 2;

/**
 * How many phases one call may drive. Validation has three, and a repair can send
 * the Plan back to the start, so this bounds a pathological ping-pong without
 * capping any real run.
 */
export const MAX_PHASES_PER_CALL = 12;

/** Validation's three statuses in the order the loop passes through them. */
export const VALIDATION_STATUS_ORDER = ["implemented", "validated_ci", "validated_reviewer"];

/** The status a phase expects to find on the Plan it is about to run. */
export const PHASE_STATUS: Record<import("./validation-ports.ts").ValidationPhaseName, string> = {
    mechanical: "implemented",
    semantic: "validated_ci",
    delivery: "validated_reviewer",
};

/** How many times an Agent may be sent at the same merge before the user is asked. */
export const MAX_AGENT_MERGE_REPAIRS = 2;

export type { PlanEvent, PlanEventStatus, PlanFrontMatter, PlanStatus, RecordPlanEventArgs, RecordPlanEventResult };
