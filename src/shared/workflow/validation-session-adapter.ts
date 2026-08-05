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
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { runIsolatedAgentSession } from "../session/session.js";
import { requestHostedSessionInteraction } from "../session/session-runtime-interactions.js";
import { acknowledgeTaskCompletion, claimPendingTaskCompletion } from "../session/task-completion-session.ts";
import { getAgentDisplayName as getSessionAgentDisplayName } from "../session/agents.js";
import { REVIEWER_SUBAGENT_TOOLS } from "../session/subagent-definitions.ts";
import { SUBAGENTS } from "../../constants.js";
import {
    emitRunWieldSystemStatus,
    getCurrentValidationProgress,
    setCurrentValidationProgress,
} from "./validation-progress.ts";
import { clearValidationPosition, getValidationPosition, rememberValidationPosition } from "./validation-position.ts";
import {
    hasTrustedClaudeMcpReview,
    runFeaturePostVerificationHandoffs,
    usedReviewDiffTool,
} from "./validation-helpers.ts";
import { readLatestReviewOutcome, readLatestTaskCompletedReport } from "./workflow.js";
import type { RuntimeValidationProgress } from "../session/session-runtime-events.js";
import type {
    IsolatedAgentSessionOutcome,
    IsolatedAgentSessionRequest,
    SessionManagerHandle,
    ValidationSessionPort,
} from "./validation-ports.ts";

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
};

export type SemanticReviewPort = {
    runIsolatedAgentSession: (options: IsolatedAgentSessionOptions) => Promise<AgentMessage[]>;
};

export const SYSTEM_SEMANTIC_REVIEW_PORT: SemanticReviewPort = Object.freeze({
    runIsolatedAgentSession,
});

/**
 * Build the engine's session port over a real HostedSession.
 *
 * `sessionManager` and `semanticReviewPort` are optional composition-root inputs:
 * the active repair-turn manager and the isolated-session implementation (defaults
 * to the system one). Both are closed over here so the engine never sees them.
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
            customTools: request.customTools as unknown as ToolDefinition[],
            includeEditFallback: false,
            sessionManager: request.sessionManager as unknown as SessionManager,
        });
        return {
            kind: "reviewer",
            reviewOutcome: readLatestReviewOutcome(messages),
            usedDiffTool: usedReviewDiffTool(messages),
            trustedClaudeMcpReview: hasTrustedClaudeMcpReview(messages),
        };
    }
    const messages = await isolatedSessions.runIsolatedAgentSession({
        hostedSession,
        agentName: request.agentName,
        userRequest: request.userRequest,
        ...(request.images ? { images: request.images } : {}),
        cwd: request.cwd,
        subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
        customTools: request.customTools as unknown as ToolDefinition[],
        ...(request.sessionManager ? { sessionManager: request.sessionManager as unknown as SessionManager } : {}),
    });
    const report = readLatestTaskCompletedReport(messages);
    return {
        kind: "feedback_engineer",
        taskReport: { completed: report.completed, report: report.message },
    };
}

export function createValidationSessionPort(
    hostedSession: HostedSession,
    {
        sessionManager,
        semanticReviewPort,
    }: {
        sessionManager?: SessionManager;
        semanticReviewPort?: SemanticReviewPort;
    } = {},
): ValidationSessionPort {
    const isolatedSessions = semanticReviewPort || SYSTEM_SEMANTIC_REVIEW_PORT;
    const turnSessionManager = sessionManager;
    return {
        cwd: hostedSession.cwd,
        getActiveWorkflow: () => hostedSession.getActiveExecutionWorkflow?.() || null,
        setActiveWorkflow: (workflow) => hostedSession.setActiveExecutionWorkflow?.(workflow),
        getPosition: (planName) => getValidationPosition(hostedSession, planName),
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
        requestInteraction: (request) => requestHostedSessionInteraction(hostedSession, request),
        registerActiveInteraction: (id, abortController) => hostedSession.addActiveInteraction(id, { abortController }),
        unregisterActiveInteraction: (id) => hostedSession.removeActiveInteraction(id),
        runActiveAgentTurn: async ({ agentName, userRequest, cwd }) => {
            // Runs the turn, then claims and acknowledges task completion
            // internally: the adapter owns `hostedSession.getRootAgentSession()`,
            // so the engine never sees Pi messages or the claim/acknowledge pair.
            await runActiveAgentTurn({
                hostedSession,
                agentName,
                userRequest,
                ...(turnSessionManager ? { sessionManager: turnSessionManager } : {}),
                cwd,
            });
            const completion = claimPendingTaskCompletion(hostedSession, hostedSession.getRootAgentSession());
            if (!completion) return { completed: false, report: "" };
            acknowledgeTaskCompletion(hostedSession, completion);
            return { completed: true, report: completion.report };
        },
        createInMemorySessionManager: (cwd) => SessionManager.inMemory(cwd) as unknown as SessionManagerHandle,
        runIsolatedAgentSession: async <K extends IsolatedAgentSessionRequest["kind"]>(
            request: Extract<IsolatedAgentSessionRequest, { kind: K }>,
        ): Promise<Extract<IsolatedAgentSessionOutcome, { kind: K }>> => {
            const outcome = await runIsolatedRequest(hostedSession, isolatedSessions, request);
            return outcome as Extract<IsolatedAgentSessionOutcome, { kind: K }>;
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
