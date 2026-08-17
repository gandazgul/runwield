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
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { requestHostedSessionInteraction } from "../session/session-runtime-interactions.js";
import { getAgentDisplayName as getSessionAgentDisplayName } from "../session/agents.js";
import { REVIEWER_SUBAGENT_TOOLS } from "../session/subagent-definitions.ts";
import { SUBAGENTS } from "../../constants.js";
import {
    emitRunWieldSystemStatus,
    getCurrentValidationProgress,
    setCurrentValidationProgress,
} from "./validation-progress.ts";
import { clearValidationPosition, rememberValidationPosition } from "./validation-position.ts";
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

function readLatestQaChecklistGeneratedOutcome(
    messages: AgentMessage[],
): Extract<IsolatedAgentSessionOutcome, { kind: "manual_qa" }> {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!(message && "role" in message && message.role === "toolResult")) continue;
        if (!("toolName" in message) || message.toolName !== "qa_checklist_generated") continue;
        const details =
            (message as { details?: { outcome?: unknown; relativePath?: unknown; reason?: unknown } }).details || {};
        const outcome = details.outcome;
        if (outcome === "recorded" || outcome === "already_present") {
            return {
                kind: "manual_qa",
                outcome,
                relativePath: typeof details.relativePath === "string" ? details.relativePath : undefined,
            };
        }
        return {
            kind: "manual_qa",
            outcome: "rejected",
            warning: typeof details.reason === "string" ? details.reason : "Manual QA checklist tool rejected output.",
        };
    }
    return {
        kind: "manual_qa",
        outcome: "missing_tool_call",
        warning: "Manual QA Agent did not call qa_checklist_generated.",
    };
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
    if (request.kind === "manual_qa") {
        const manualQaManager = request.sessionManager
            ? request.sessionManager as unknown as SessionManager
            : SessionManager.inMemory(request.cwd);
        const messages = await isolatedSessions.runIsolatedAgentSession({
            hostedSession,
            agentName: request.agentName,
            userRequest: request.userRequest,
            cwd: request.cwd,
            subAgentDefinition: { id: SUBAGENTS.MANUAL_QA },
            customTools: request.customTools as unknown as ToolDefinition[],
            includeEditFallback: false,
            sessionManager: manualQaManager,
        });
        return readLatestQaChecklistGeneratedOutcome(messages);
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
    const report = readLatestTaskCompletedReport(messages);
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
        taskReport: {
            completed: report.completed,
            report: report.message,
            brokenObjectiveChecks: report.brokenObjectiveChecks || [],
        },
    };
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
            const completion = readLatestTaskCompletedReport(messages);
            lastRepairSessions.set(hostedSession, { manager: repairManager, cwd, agentName });
            if (completion.completed) clearPendingRepairManager(hostedSession, cwd, userRequest);
            return {
                completed: completion.completed,
                report: completion.message,
                brokenObjectiveChecks: completion.brokenObjectiveChecks || [],
            };
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
            const completion = readLatestTaskCompletedReport(messages);
            return {
                completed: completion.completed,
                report: completion.message,
                brokenObjectiveChecks: completion.brokenObjectiveChecks || [],
            };
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
