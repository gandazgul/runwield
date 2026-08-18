/**
 * @module shared/workflow/validation-ports
 * The session-independent Workflow Validation engine's contract with the runtime.
 *
 * The engine (validation-engine.ts and its phase modules) decides *what* validation
 * does: which phase runs next, when convergence is reached, which gates a Plan must
 * pass. It never touches Pi/session machinery directly. Everything it needs from the
 * runtime arrives through {@link ValidationSessionPort}, implemented by
 * `validation-session-adapter.ts` over the real HostedSession machinery, and later
 * by the Attached Mode coordinator over its own record.
 *
 * The types here are engine-owned. Where they mirror a session type
 * (`RuntimeValidationProgress`, `RuntimeInteractionRequest`, `ActiveExecutionWorkflow`)
 * they are structural subsets, assignable both ways at the adapter boundary. The
 * opaque handles (`SessionManagerHandle`, `OpaqueToolDefinition`) are phantom-branded:
 * the single cast from the Pi types happens inside `validation-session-adapter.ts`.
 */

import type { ReviewAdvisory, ReviewFinding } from "../../tools/review-complete.ts";
import type { ReviewLedger } from "./review-ledger.ts";

/** The phase that should run next for a Plan. */
export type ValidationPhaseName = "mechanical" | "semantic" | "delivery";

/** Where a validation run is, while it is running (engine-owned mirror of validation-position.ts). */
export type ValidationPosition = {
    phase: ValidationPhaseName;
    /** Presentation-only note for UI code that wants to show a semantic repair wait. */
    awaiting?: "semantic_repair" | null;
};

/** One check's verdict in the progress panel. */
export type ValidationCheckResult = "pending" | "running" | "passed" | "failed" | "skipped" | "canceled";

/** The four workflow validation checks, one verdict each. */
export type ValidationCheckResults = {
    ci: ValidationCheckResult;
    semanticReview: ValidationCheckResult;
    humanReview: ValidationCheckResult;
    merge: ValidationCheckResult;
};

/**
 * The progress panel record (engine-owned mirror of `RuntimeValidationProgress`).
 *
 * The adapter translates this to the session's own record when emitting; the engine
 * only ever sees this shape.
 */
export type ValidationProgressRecord = {
    kind: "workflow" | "mechanical";
    outcome: "running" | "paused" | "verified" | "failed";
    stage: "cycle" | "ci" | "engineer_repair" | "semantic_review" | "human_review" | "merge" | "manual_qa" | "terminal";
    checks: ValidationCheckResults;
    cycle?: number;
    maxCycles?: number;
    totalCycle?: number;
    repairAttempt?: number;
    maxRepairAttempts?: number;
    message?: string;
};

/**
 * The engine's own subset of the session's active execution workflow record.
 *
 * Structurally assignable both ways at the adapter boundary: the session's
 * `ActiveExecutionWorkflow` carries strictly more fields, and the subset the engine
 * needs is exactly what survives a pause/resume cycle on the durable Plan.
 */
export type ValidationWorkflowState = {
    planName: string;
    triageMeta: import("../../tools/plan-written.ts").TriageMeta;
    executionAgent: "engineer" | "frontend-engineer";
    executionStarted?: boolean;
    executionMode?: "worktree" | "non_git_in_place";
    baselineTree?: string;
    projectRoot?: string;
    executionCwd?: string;
    worktreeId?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    worktreeBaseRef?: string;
    worktreeBaseCommit?: string;
    nonGitInPlace?: boolean;
    validationContinuation?: boolean;
    /** Consume-once identity for the semantic repair currently owned by the checkpoint. */
    validationRepairGeneration?: string;
    semanticRound?: number;
    reviewLedger?: ReviewLedger;
    repairBaselineTree?: string;
    lastRepairReport?: string;
    humanReviewCycle?: number;
};

/** A user interaction request (engine-owned mirror of the runtime interaction request). */
export type ValidationInteractionRequest = {
    id?: string;
    type: "select" | "text" | "approval" | "link" | "plan_review" | "code_review" | "pair_checkpoint";
    prompt: string;
    options?: Array<{
        value: string;
        label: string;
        description?: string;
        _meta?: Record<string, unknown>;
    }>;
    defaultValue?: string;
    placeholder?: string;
    allowEmpty?: boolean;
    toolCallId?: string;
    _meta?: Record<string, unknown>;
};

/** A user interaction response (engine-owned mirror of the runtime interaction response). */
export type ValidationInteractionResponse = {
    outcome: string;
    value?: string | boolean;
    valueLabel?: string;
    message?: string;
    _meta?: Record<string, unknown>;
};

/**
 * Interaction type constants the engine sends.
 *
 * Values match the runtime interaction types the adapter forwards; the engine never
 * imports the session constants.
 */
export const ValidationInteractionTypes = Object.freeze({
    SELECT: "select",
    TEXT: "text",
    CODE_REVIEW: "code_review",
});

/** The reviewer's verdict on one round. */
export type ValidationReviewOutcome = {
    outcome: "approved" | "feedback";
    approved: boolean;
    feedback: string;
    findings: ReviewFinding[];
    advisories: ReviewAdvisory[];
};

/** Outcome of a completion-gated active Agent repair turn. */
export type AgentTurnOutcome = {
    completed: boolean;
    report: string;
    brokenObjectiveChecks: import("./objective-checks.ts").BrokenObjectiveCheckReport[];
};

/** What the engine asks for when it dispatches an independent completion-gated repair turn. */
export type IndependentRepairTurnRequest = {
    agentName: string;
    userRequest: string;
    cwd: string;
};

/**
 * An isolated Agent session request.
 *
 * Discriminated by role: the reviewer (Semantic Code Review rounds) and the
 * Reviewer-Feedback Engineer (repair dispatch) have different tooling and different
 * outcome shapes. The engine passes opaque handles; the adapter casts them to the Pi
 * types exactly once.
 */
export type IsolatedAgentSessionRequest =
    | {
        kind: "reviewer";
        agentName: string;
        userRequest: string;
        cwd: string;
        reviewerMode: "discovery" | "verify";
        customTools: OpaqueToolDefinition[];
        sessionManager: SessionManagerHandle;
    }
    | {
        kind: "feedback_engineer";
        agentName: string;
        userRequest: string;
        cwd: string;
        images?: Array<{ base64: string; mimeType: string }>;
        customTools: OpaqueToolDefinition[];
        sessionManager?: SessionManagerHandle;
    }
    | {
        kind: "manual_qa";
        agentName: string;
        userRequest: string;
        cwd: string;
        customTools: OpaqueToolDefinition[];
        sessionManager?: SessionManagerHandle;
    };

/**
 * Typed outcome of an isolated Agent session.
 *
 * The adapter computes these from the returned Pi messages with the existing message
 * inspectors, so raw-message inspection stays in the session-coupled layer and the
 * engine receives one semantic contract.
 */
export type IsolatedAgentSessionOutcome =
    | {
        kind: "reviewer";
        reviewOutcome: ValidationReviewOutcome | null;
        usedDiffTool: boolean;
        trustedClaudeMcpReview: boolean;
        executionError?: string;
    }
    | {
        kind: "feedback_engineer";
        taskReport: AgentTurnOutcome;
        executionError?: string;
    }
    | {
        kind: "manual_qa";
        outcome: "recorded" | "already_present" | "missing_tool_call" | "rejected";
        relativePath?: string;
        warning?: string;
        executionError?: string;
    };

/**
 * Opaque handle for a Pi `ToolDefinition`.
 *
 * Phantom-branded so the engine cannot build or inspect one; it only passes the
 * review-diff tools it creates through {@link createReviewDiffTool} and hands the
 * handle across the port.
 */
export type OpaqueToolDefinition = { readonly __opaqueToolDefinition: unique symbol };

/**
 * Opaque handle for a Pi `SessionManager`.
 *
 * Phantom-branded so the engine never imports the Pi type. The adapter casts the
 * real SessionManager to this exactly once per boundary crossing.
 */
export type SessionManagerHandle = { readonly __opaqueSessionManager: unique symbol };

/** Post-verification handoffs the engine requests once a Plan is verified. */
export type PostVerificationHandoffParams = {
    planName: string;
    planContent: string;
    projectRoot: string;
    mnemosynePort: import("../work-records/mnemosyne-port.ts").WorkRecordMnemosynePort;
};

/** Local CI result shape the engine consumes. */
export type ValidationLocalCIResult = {
    exitCode: number;
    output: string;
    canceled?: boolean;
};

/**
 * The engine's CI port.
 *
 * The engine passes only the working directory; binding the real hostedSession into
 * the run call is the composition root's job (`validation.ts`), so the engine never
 * sees a session reference for CI either.
 */
export type ValidationLocalCIPort = {
    run(args: { cwd: string }): Promise<ValidationLocalCIResult>;
};

/**
 * The only way the engine touches session machinery.
 *
 * Active workflow state, per-run phase position, the progress panel, user
 * interactions, escape-cancel registration, completion-gated repair turns, isolated
 * Agent sessions, display names, and post-verification handoffs all arrive here.
 */
export type ValidationSessionPort = {
    /** The session's working directory. */
    readonly cwd: string;
    /** Active execution workflow state (session-owned; coordinator owns its equivalent later). */
    getActiveWorkflow(): ValidationWorkflowState | null;
    setActiveWorkflow(workflow: ValidationWorkflowState): void;
    /** Remember the validation phase when status cannot describe the pending repair. */
    rememberPosition(planName: string, position: ValidationPosition): void;
    /** Clear legacy process-local display state after a terminal result. */
    clearPosition(planName: string): void;
    /** Progress panel + status lines. */
    getCurrentProgress(): ValidationProgressRecord | undefined;
    setCurrentProgress(progress: ValidationProgressRecord): void;
    emitStatus(
        message: string,
        level: "info" | "success" | "warning" | "error",
        progress?: ValidationProgressRecord,
    ): void;
    /** User interactions (requestHostedSessionInteraction behind the port). */
    requestInteraction(request: ValidationInteractionRequest): Promise<ValidationInteractionResponse>;
    /** Escape-cancel registration for Objective-Failing Checks. */
    registerActiveInteraction(id: string, abortController: AbortController): void;
    unregisterActiveInteraction(id: string): void;
    /** Completion-gated validation repair in a fresh Agent session. */
    runIndependentRepairTurn(request: IndependentRepairTurnRequest): Promise<AgentTurnOutcome>;
    /** Continue the most recent focused repair session with its existing context. */
    continueLastRepairTurn(userRequest: string): Promise<AgentTurnOutcome | null>;
    /** Isolated Agent sessions: Semantic Reviewer and Reviewer-Feedback Engineer. */
    createInMemorySessionManager(cwd: string): SessionManagerHandle;
    runIsolatedAgentSession<K extends IsolatedAgentSessionRequest["kind"]>(
        request: Extract<IsolatedAgentSessionRequest, { kind: K }>,
    ): Promise<Extract<IsolatedAgentSessionOutcome, { kind: K }>>;
    /** Display names for messages (getAgentDisplayName behind the port). */
    getAgentDisplayName(agentName: string, projectRoot: string): string;
    /** Post-verification handoffs (runFeaturePostVerificationHandoffs behind the port). */
    runPostVerificationHandoffs(params: PostVerificationHandoffParams): Promise<void>;
};
