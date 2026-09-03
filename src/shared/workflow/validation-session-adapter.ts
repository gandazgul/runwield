/**
 * @module shared/workflow/validation-session-adapter
 * The only session/Pi-coupled module in the session-independent validation engine.
 *
 * Implements {@link ValidationSessionPort} over the real HostedSession machinery:
 * workflow state, phase position, progress panel, interactions, escape-cancel
 * registration, completion-gated repair turns, isolated Agent sessions, display
 * names, and post-verification handoffs. The engine never imports Pi/session
 * modules; everything it needs arrives through the port this module builds.
 *
 * The opaque handle casts happen here and only here: `SessionManagerHandle` and
 * `OpaqueToolDefinition` are phantom-branded, and the Pi `SessionManager` /
 * `ToolDefinition` values are cast to them exactly once per boundary crossing.
 * Raw Pi message inspection (via the workflow-result inspectors) also stays here,
 * so the engine receives one typed outcome contract.
 */

import { SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { HostedSession } from "../session/hosted-session.js";
import { runIsolatedAgentSession } from "../session/session.js";
import { emitAssistantMessage, type RuntimeValidationProgress } from "../session/session-runtime-events.js";
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { requestHostedSessionInteraction } from "../session/session-runtime-interactions.js";
import { getAgentDisplayName as getSessionAgentDisplayName } from "../session/agents.js";
import { ClaudeCliBackendError } from "../session/backends/claude-cli/failure.ts";
import { REVIEWER_SUBAGENT_TOOLS } from "../session/subagent-definitions.ts";
import { SUBAGENTS } from "../../constants.js";
import {
    emitRunWieldSystemStatus,
    getCurrentValidationProgress,
    setCurrentValidationProgress,
} from "./validation-progress.ts";
import { clearValidationPosition, rememberValidationPosition } from "./validation-position.ts";
import { hasTrustedClaudeMcpReview, runFeaturePostVerificationHandoffs } from "./validation-helpers.ts";
import { extractAssistantOutput, readLatestTaskCompletedReport } from "./workflow.js";
import { acknowledgeTaskCompletion, claimPendingTaskCompletion } from "../session/task-completion-session.ts";
import { createReviewDiffTool } from "./review-diff-tool.js";
import { createQaChecklistGeneratedTool } from "../../tools/qa-checklist-generated.ts";
import { claimWorkflowToolEvent, settleWorkflowToolEvent } from "./workflow-tool-events.ts";
import type {
    AgentTurnOutcome,
    IsolatedAgentSessionOutcome,
    IsolatedAgentSessionRequest,
    OpaqueToolDefinition,
    SessionManagerHandle,
    ValidationSessionPort,
} from "./validation-ports.ts";
import {
    classifyValidationOperationalError,
    type ProviderErrorKind,
    type ValidationOperation,
    type ValidationOperationalFailure,
} from "./validation-operational-errors.ts";

/**
 * The options shape the pre-existing isolated-session boundary takes.
 *
 * Kept structurally identical to the shape `runIsolatedAgentSession` in
 * `session.js` consumes, so injected `semanticReviewPort` fixtures and the system
 * implementation both see exactly what they saw before the split.
 */
export type IsolatedAgentSessionOptions = {
    hostedSession: HostedSession;
    agentName: string;
    userRequest: string;
    images?: Array<{ base64: string; mimeType: string }>;
    cwd: string;
    subAgentDefinition?: {
        id: import("../session/subagent-definitions.ts").SubAgentDefinitionId;
        options?: import("../session/subagent-definitions.ts").LoadSubAgentDefinitionOptions;
    };
    toolNames?: string[];
    customTools?: ToolDefinition[];
    includeEditFallback?: boolean;
    sessionManager?: SessionManager;
    dispatchKind?: import("../session/request-dispatch.ts").RequestDispatchKind;
};

export type SemanticReviewPort = {
    runIsolatedAgentSession: (options: IsolatedAgentSessionOptions) => Promise<AgentMessage[]>;
};

export const SYSTEM_SEMANTIC_REVIEW_PORT: SemanticReviewPort = Object.freeze({
    runIsolatedAgentSession,
});

const pendingRepairManagers = new WeakMap<HostedSession, Map<string, SessionManager>>();
const lastRepairSessions = new WeakMap<HostedSession, { manager: SessionManager; cwd: string; agentName: string }>();

function getPendingRepairManager(hostedSession: HostedSession, cwd: string, userRequest: string): SessionManager {
    let managers = pendingRepairManagers.get(hostedSession);
    if (!managers) {
        managers = new Map();
        pendingRepairManagers.set(hostedSession, managers);
    }
    const key = `${cwd}\u0000${userRequest}`;
    let manager = managers.get(key);
    if (!manager) {
        manager = SessionManager.inMemory(cwd);
        managers.set(key, manager);
    }
    return manager;
}

function clearPendingRepairManager(hostedSession: HostedSession, cwd: string, userRequest: string): void {
    pendingRepairManagers.get(hostedSession)?.delete(`${cwd}\u0000${userRequest}`);
}

type ProviderFailureIdentity = {
    kind: ProviderErrorKind;
    code?: string;
};

function providerFailureIdentityFromMessage(message: string): ProviderFailureIdentity {
    const normalized = message.toLowerCase();
    if (/\b429\b|rate[ -]?limit|too many requests/.test(normalized)) {
        return { kind: "rate_limited", code: "provider/http_429" };
    }
    if (/\b(?:408|504)\b|timed? out|timeout/.test(normalized)) {
        return { kind: "timeout", code: "provider/timeout" };
    }
    if (/\b401\b|unauthori[sz]ed|authentication failed|invalid api key/.test(normalized)) {
        return { kind: "authentication", code: "provider/authentication" };
    }
    if (/\b403\b|forbidden|permission denied/.test(normalized)) {
        return { kind: "permission_denied", code: "provider/permission_denied" };
    }
    if (
        /\b(?:404|500|502|503)\b|service unavailable|bad gateway|internal server error|temporarily unavailable/.test(
            normalized,
        )
    ) {
        return { kind: "service_unavailable", code: "provider/service_unavailable" };
    }
    if (/econnreset|econnrefused|enotfound|socket|network/.test(normalized)) {
        return { kind: "network", code: "provider/network" };
    }
    return { kind: "legacy_text" };
}

function providerFailureIdentity(error: Error): ProviderFailureIdentity {
    if (error instanceof ClaudeCliBackendError) {
        switch (error.kind) {
            case "auth_failed":
                return { kind: "authentication", code: error.kind };
            case "bridge_disconnected":
                return { kind: "network", code: error.kind };
            case "bridge_startup_failed":
                return { kind: "service_unavailable", code: error.kind };
            case "missing_executable":
            case "non_zero_exit":
            case "malformed_stream":
            case "canceled":
                return { kind: "legacy_text", code: error.kind };
        }
    }

    switch (error.name) {
        case "RateLimitError":
            return { kind: "rate_limited", code: error.name };
        case "APIConnectionTimeoutError":
        case "TimeoutError":
            return { kind: "timeout", code: error.name };
        case "APIConnectionError":
        case "NetworkError":
            return { kind: "network", code: error.name };
        case "InternalServerError":
        case "ServiceUnavailableError":
            return { kind: "service_unavailable", code: error.name };
        case "AuthenticationError":
            return { kind: "authentication", code: error.name };
        case "PermissionDeniedError":
            return { kind: "permission_denied", code: error.name };
        default:
            return providerFailureIdentityFromMessage(error.message);
    }
}

function classifyProviderFailure(
    operation: ValidationOperation,
    message: string,
    identity: ProviderFailureIdentity,
): ValidationOperationalFailure {
    return classifyValidationOperationalError({
        source: "provider",
        kind: identity.kind,
        operation,
        message,
        code: identity.code,
    });
}

function classifyIsolatedAgentExecutionFailure(
    request: IsolatedAgentSessionRequest,
    error: Error,
): Extract<IsolatedAgentSessionOutcome, { outcome: "operational_failure" }> {
    const operation: ValidationOperation = request.kind === "reviewer" ? "semantic_review" : "agent_session";
    const identity = providerFailureIdentity(error);
    return {
        kind: request.kind,
        outcome: "operational_failure",
        failure: classifyProviderFailure(
            operation,
            identity.kind === "legacy_text" ? error.message : "The model provider could not complete this operation.",
            identity,
        ),
    };
}

function readReviewerProviderFailure(messages: AgentMessage[]): ValidationOperationalFailure | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "assistant") continue;
        if (message.stopReason !== "error") return undefined;
        const errorMessage = message.errorMessage?.trim() || "The model provider could not complete AI code review.";
        return classifyProviderFailure(
            "semantic_review",
            "The model provider could not complete AI code review.",
            providerFailureIdentityFromMessage(errorMessage),
        );
    }
    return undefined;
}

function readReviewerToolFailure(messages: AgentMessage[]): ValidationOperationalFailure | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "toolResult" || !message.isError) continue;
        if (message.toolName === "review_complete") {
            return classifyValidationOperationalError({
                source: "reviewer_protocol",
                kind: "invalid_tool_arguments",
                operation: "semantic_review",
                message: "Semantic Reviewer called review_complete with invalid arguments.",
                field: "review_complete",
                required: "Correct the review_complete arguments from the tool error, then call review_complete again.",
            });
        }
        if (message.toolName === "review_diff") {
            return classifyValidationOperationalError({
                source: "reviewer_protocol",
                kind: "missing_optional_entity",
                operation: "semantic_review",
                message: "The requested review diff item is not available.",
                field: "review_diff",
                required:
                    'Do not request the missing item again. Call review_diff(command: "list") and continue with an available file or without that item.',
            });
        }
    }
    return undefined;
}

type ReviewDiffToolOptions = Parameters<typeof createReviewDiffTool>[1];
type ReviewDiffToolWithOptions = ToolDefinition & {
    __runwieldReviewDiffs?: Parameters<typeof createReviewDiffTool>[0];
};
type QaChecklistToolOptions = Parameters<typeof createQaChecklistGeneratedTool>[0];
type QaChecklistToolWithOptions = ToolDefinition & { __runwieldQaChecklistOptions?: QaChecklistToolOptions };

function bindReviewDiffTools(hostedSession: HostedSession, customTools: OpaqueToolDefinition[]): ToolDefinition[] {
    return (customTools as unknown as ToolDefinition[]).map((tool) => {
        const tagged = tool as ReviewDiffToolWithOptions;
        if (tagged.name !== "review_diff" || tagged.__runwieldReviewDiffs === undefined) return tool;
        const options: ReviewDiffToolOptions = { hostedSession };
        return createReviewDiffTool(tagged.__runwieldReviewDiffs, options);
    });
}

function bindQaChecklistTools(hostedSession: HostedSession, customTools: OpaqueToolDefinition[]): ToolDefinition[] {
    return (customTools as unknown as ToolDefinition[]).map((tool) => {
        const tagged = tool as QaChecklistToolWithOptions;
        if (tagged.name !== "qa_checklist_generated" || !tagged.__runwieldQaChecklistOptions) return tool;
        return createQaChecklistGeneratedTool({ ...tagged.__runwieldQaChecklistOptions, hostedSession });
    });
}

/**
 * Build the engine's session port over a real HostedSession.
 *
 * `semanticReviewPort` is an optional external Agent-session boundary used by
 * tests. Production uses the system implementation. Every repair session owns an
 * in-memory manager so it cannot inherit or extend the root execution transcript.
 */
/**
 * Run one isolated Agent session and translate the returned Pi messages into the
 * engine's typed outcome. Non-generic internally so the request discriminant
 * narrows naturally; the generic port method wraps it with a single boundary cast.
 */
async function runIsolatedRequest(
    hostedSession: HostedSession,
    isolatedSessions: SemanticReviewPort,
    request: IsolatedAgentSessionRequest,
): Promise<IsolatedAgentSessionOutcome> {
    if (request.kind === "reviewer") {
        const messages = await isolatedSessions.runIsolatedAgentSession({
            hostedSession,
            agentName: request.agentName,
            userRequest: request.userRequest,
            cwd: request.cwd,
            subAgentDefinition: {
                id: SUBAGENTS.REVIEWER,
                options: { reviewerMode: request.reviewerMode },
            },
            toolNames: [...REVIEWER_SUBAGENT_TOOLS],
            customTools: bindReviewDiffTools(hostedSession, request.customTools),
            includeEditFallback: false,
            sessionManager: request.sessionManager as unknown as SessionManager,
        });
        const activeWorkflow = hostedSession.getActiveExecutionWorkflow?.() || null;
        const claimScope = {
            owningSession: hostedSession.getActiveSteeringTargetSession(),
            ...(activeWorkflow?.validationGeneration
                ? { validationGeneration: activeWorkflow.validationGeneration }
                : {}),
        };
        const reviewEvent = claimWorkflowToolEvent(hostedSession, {
            kinds: ["review_complete"],
            ...claimScope,
        }) || claimWorkflowToolEvent(hostedSession, {
            kinds: ["review_complete"],
            owningSession: null,
            ...(activeWorkflow?.validationGeneration
                ? { validationGeneration: activeWorkflow.validationGeneration }
                : {}),
        });
        const diffEvent = claimWorkflowToolEvent(hostedSession, {
            kinds: ["review_diff"],
            ...claimScope,
        }) || claimWorkflowToolEvent(hostedSession, {
            kinds: ["review_diff"],
            owningSession: null,
            ...(activeWorkflow?.validationGeneration
                ? { validationGeneration: activeWorkflow.validationGeneration }
                : {}),
        });
        const reviewOutcome = reviewEvent?.kind === "review_complete"
            ? reviewEvent.payload as import("./workflow-tool-events.ts").ReviewCompleteEventPayload
            : null;
        const providerFailure = reviewOutcome ? undefined : readReviewerProviderFailure(messages);
        if (providerFailure) {
            if (diffEvent) settleWorkflowToolEvent(hostedSession, diffEvent);
            return {
                kind: "reviewer",
                outcome: "operational_failure",
                failure: providerFailure,
            };
        }
        const toolFailure = reviewOutcome ? undefined : readReviewerToolFailure(messages);
        if (toolFailure) {
            if (diffEvent) settleWorkflowToolEvent(hostedSession, diffEvent);
            return {
                kind: "reviewer",
                outcome: "operational_failure",
                failure: toolFailure,
            };
        }
        if (reviewEvent) settleWorkflowToolEvent(hostedSession, reviewEvent);
        if (diffEvent) settleWorkflowToolEvent(hostedSession, diffEvent);
        return {
            kind: "reviewer",
            outcome: "completed",
            reviewOutcome,
            usedDiffTool: Boolean(diffEvent),
            trustedClaudeMcpReview: hasTrustedClaudeMcpReview(messages),
        };
    }
    if (request.kind === "manual_qa") {
        const manualQaManager = request.sessionManager
            ? request.sessionManager as unknown as SessionManager
            : SessionManager.inMemory(request.cwd);
        await isolatedSessions.runIsolatedAgentSession({
            hostedSession,
            agentName: request.agentName,
            userRequest: request.userRequest,
            cwd: request.cwd,
            subAgentDefinition: { id: SUBAGENTS.MANUAL_QA },
            customTools: bindQaChecklistTools(hostedSession, request.customTools),
            includeEditFallback: false,
            sessionManager: manualQaManager,
        });
        const activeWorkflow = hostedSession.getActiveExecutionWorkflow?.() || null;
        const qaEvent = claimWorkflowToolEvent(hostedSession, {
            kinds: ["qa_checklist_generated"],
            owningSession: hostedSession.getActiveSteeringTargetSession(),
            ...(activeWorkflow?.validationGeneration
                ? { validationGeneration: activeWorkflow.validationGeneration }
                : {}),
        }) || claimWorkflowToolEvent(hostedSession, {
            kinds: ["qa_checklist_generated"],
            owningSession: null,
            ...(activeWorkflow?.validationGeneration
                ? { validationGeneration: activeWorkflow.validationGeneration }
                : {}),
        });
        if (qaEvent?.kind !== "qa_checklist_generated") {
            return {
                kind: "manual_qa",
                outcome: "missing_tool_call",
                warning: "Manual QA Agent did not call qa_checklist_generated.",
            };
        }
        settleWorkflowToolEvent(hostedSession, qaEvent);
        const payload = qaEvent.payload as import("./workflow-tool-events.ts").QaChecklistGeneratedEventPayload;
        return {
            kind: "manual_qa",
            outcome: payload.outcome,
            relativePath: payload.artifactPath,
        };
    }
    const repairManager = request.sessionManager
        ? request.sessionManager as unknown as SessionManager
        : getPendingRepairManager(hostedSession, request.cwd, request.userRequest);
    const messages = await isolatedSessions.runIsolatedAgentSession({
        hostedSession,
        agentName: request.agentName,
        userRequest: request.userRequest,
        dispatchKind: "validation_repair",
        ...(request.images ? { images: request.images } : {}),
        cwd: request.cwd,
        subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
        customTools: request.customTools as unknown as ToolDefinition[],
        sessionManager: repairManager,
    });
    const report = readRepairTurnOutcome(hostedSession, messages);
    lastRepairSessions.set(hostedSession, {
        manager: repairManager,
        cwd: request.cwd,
        agentName: request.agentName,
    });
    if (!request.sessionManager && report.completed) {
        clearPendingRepairManager(hostedSession, request.cwd, request.userRequest);
    }
    return {
        kind: "feedback_engineer",
        outcome: "completed",
        taskReport: report,
    };
}

/**
 * Read what a repair turn produced.
 *
 * A repair Agent that hits a blocker stops in plain text rather than calling
 * `task_completed`, and that session is isolated from the user, so the closing
 * text is carried out here or the pause says only that the turn ended.
 */
function readRepairTurnOutcome(hostedSession: HostedSession, messages: AgentMessage[]): AgentTurnOutcome {
    const completion = claimPendingTaskCompletion(hostedSession, null);
    if (completion) {
        acknowledgeTaskCompletion(hostedSession, completion);
        return { completed: true, report: completion.report };
    }
    const report = readLatestTaskCompletedReport(messages);
    if (report.completed) return { completed: true, report: report.message };
    return { completed: false, report: "", blockerText: extractAssistantOutput(messages) || "" };
}

export function createValidationSessionPort(
    hostedSession: HostedSession,
    {
        semanticReviewPort,
    }: {
        semanticReviewPort?: SemanticReviewPort;
    } = {},
): ValidationSessionPort {
    const isolatedSessions = semanticReviewPort || SYSTEM_SEMANTIC_REVIEW_PORT;
    return {
        cwd: hostedSession.cwd,
        getActiveWorkflow: () => hostedSession.getActiveExecutionWorkflow?.() || null,
        setActiveWorkflow: (workflow) => hostedSession.setActiveExecutionWorkflow?.(workflow),
        rememberPosition: (planName, position) => rememberValidationPosition(hostedSession, planName, position),
        clearPosition: (planName) => clearValidationPosition(hostedSession, planName),
        getCurrentProgress: () => getCurrentValidationProgress(hostedSession),
        setCurrentProgress: (progress) => setCurrentValidationProgress(hostedSession, progress),
        emitStatus: (message, level, progress) => {
            emitRunWieldSystemStatus(
                hostedSession,
                message,
                level,
                progress as RuntimeValidationProgress | undefined,
            );
        },
        emitAssistantMessage: (agentName, text, options) => {
            emitAssistantMessage(hostedSession, agentName, text, options);
        },
        requestInteraction: (request) =>
            requestHostedSessionInteraction(
                hostedSession,
                request,
                undefined,
                hostedSession.getManagedOperationCapability?.() || null,
            ),
        registerActiveInteraction: (id, abortController) => hostedSession.addActiveInteraction(id, { abortController }),
        unregisterActiveInteraction: (id) => hostedSession.removeActiveInteraction(id),
        runIndependentRepairTurn: async ({ userRequest, cwd }) => {
            const agentName = SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER;
            const repairManager = getPendingRepairManager(hostedSession, cwd, userRequest);
            const messages = await isolatedSessions.runIsolatedAgentSession({
                hostedSession,
                agentName,
                userRequest,
                cwd,
                dispatchKind: "validation_repair",
                subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
                sessionManager: repairManager,
            });
            const completion = readRepairTurnOutcome(hostedSession, messages);
            lastRepairSessions.set(hostedSession, { manager: repairManager, cwd, agentName });
            if (completion.completed) clearPendingRepairManager(hostedSession, cwd, userRequest);
            return completion;
        },
        continueLastRepairTurn: async (userRequest) => {
            const repair = lastRepairSessions.get(hostedSession);
            const rootIsRepairSession = hostedSession.getRootAgentName?.() === SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER;
            if (!repair && !rootIsRepairSession) return null;
            const messages = rootIsRepairSession
                ? await runActiveAgentTurn({
                    hostedSession,
                    agentName: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER,
                    userRequest,
                    cwd: hostedSession.getActiveExecutionWorkflow?.()?.executionCwd || hostedSession.cwd,
                    dispatchKind: "validation_repair",
                    subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
                })
                : await isolatedSessions.runIsolatedAgentSession({
                    hostedSession,
                    agentName: repair!.agentName,
                    userRequest,
                    cwd: repair!.cwd,
                    dispatchKind: "validation_repair",
                    subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
                    sessionManager: repair!.manager,
                });
            return readRepairTurnOutcome(hostedSession, messages);
        },
        createInMemorySessionManager: (cwd) => SessionManager.inMemory(cwd) as unknown as SessionManagerHandle,
        runIsolatedAgentSession: async <K extends IsolatedAgentSessionRequest["kind"]>(
            request: Extract<IsolatedAgentSessionRequest, { kind: K }>,
        ): Promise<Extract<IsolatedAgentSessionOutcome, { kind: K }>> => {
            try {
                const outcome = await runIsolatedRequest(hostedSession, isolatedSessions, request);
                return outcome as Extract<IsolatedAgentSessionOutcome, { kind: K }>;
            } catch (error) {
                const failureError = error instanceof Error ? error : new Error(String(error));
                const outcome = classifyIsolatedAgentExecutionFailure(request, failureError);
                return outcome as Extract<IsolatedAgentSessionOutcome, { kind: K }>;
            }
        },
        getAgentDisplayName: (agentName, projectRoot) => getSessionAgentDisplayName(agentName, projectRoot),
        runPostVerificationHandoffs: async ({ planName, planContent, projectRoot, mnemosynePort }) => {
            await runFeaturePostVerificationHandoffs({
                hostedSession,
                planName,
                planContent,
                projectRoot,
                mnemosynePort,
            });
        },
    };
}
