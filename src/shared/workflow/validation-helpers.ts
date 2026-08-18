/**
 * @module shared/workflow/validation-helpers
 *
 * Supporting helpers for Workflow Validation: bundled prompt loading, local CI
 * execution, manual QA handoffs, agent-turn repair, and post-merge publication
 * proof. The validation loop itself lives in `validation.ts`; this module holds
 * the pieces it calls out to.
 */

import { dirname, fromFileUrl } from "@std/path";
import { AGENTS, isPlannedChangeClassification, SUBAGENTS } from "../../constants.js";
import { loadPlan } from "../../plan-store.js";

import { getAgentDisplayName } from "../session/agents.js";

import { runIsolatedAgentSession } from "../session/session.js";
import { type LocalCIPort, runLocalCI } from "./validation-local-ci.ts";
import { verifyPostMergeCandidatePublished } from "./validation-merge-verification.ts";
import { buildValidationUserMessage } from "./validation-user-messages.ts";
import { loadManualQaPrompt, loadReviewerFeedbackEngineerDef, loadReviewerPrompt } from "./validation-prompts.ts";
import {
    completeValidationProgress,
    createValidationProgress,
    emitRunWieldSystemStatus,
    updateValidationProgress,
} from "./validation-progress.ts";

import { extractAssistantOutput, readLatestTaskCompletedOutcome } from "./workflow.js";
import { runActiveAgentTurn, switchActiveAgent } from "../session/agent-switching.js";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../session/session-runtime-interactions.js";

import { recordManualQaChecklistMessage } from "../session/workflow-messages.js";

import { recordWorkflowMetric } from "./metrics.js";

import { createPairCheckpointTool } from "../../tools/pair-checkpoint.ts";
import { autoGenerateWorkRecordForCompletedPlan } from "../work-records/auto-generation.js";
import type { WorkRecordMnemosynePort } from "../work-records/mnemosyne-port.ts";
import {
    confirmWorkRecordSupersessionProposal,
    rejectWorkRecordSupersessionProposal,
} from "../work-records/supersession.ts";
import type { WorkRecordSupersessionCandidate } from "../work-records/schema.js";

export type WorkRecordSupersessionDecision = "confirm" | "reject" | "later";

export interface ResolveWorkRecordSupersessionProposalsOptions {
    projectRoot: string;
    successorRecordId: string;
    proposals: WorkRecordSupersessionCandidate[];
    mnemosynePort: WorkRecordMnemosynePort;
    choose: (proposal: WorkRecordSupersessionCandidate) => Promise<WorkRecordSupersessionDecision | null>;
    notify: (message: string, warning?: boolean) => void;
}

/** Prompt for and apply decisions without making a completed workflow non-terminal. */
export async function resolveWorkRecordSupersessionProposals({
    projectRoot,
    successorRecordId,
    proposals,
    mnemosynePort,
    choose,
    notify,
}: ResolveWorkRecordSupersessionProposalsOptions): Promise<void> {
    for (const proposal of proposals) {
        let decision: WorkRecordSupersessionDecision | null = null;
        try {
            decision = await choose(proposal);
            if (decision === "confirm") {
                const result = await confirmWorkRecordSupersessionProposal(projectRoot, {
                    successorRecordId,
                    predecessorRecordId: proposal.recordId,
                    mnemosynePort,
                });
                notify(`Confirmed Work Record supersession: ${proposal.recordId} -> ${successorRecordId}.`);
                if (result.indexWarning) notify(result.indexWarning, true);
                continue;
            }
            if (decision === "reject") {
                const result = await rejectWorkRecordSupersessionProposal(projectRoot, {
                    successorRecordId,
                    predecessorRecordId: proposal.recordId,
                    mnemosynePort,
                });
                notify(`Rejected Work Record supersession proposal: ${proposal.recordId} -> ${successorRecordId}.`);
                if (result.indexWarning) notify(result.indexWarning, true);
                continue;
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            notify(`Could not resolve supersession proposal for ${proposal.recordId}: ${reason}`, true);
        }
        notify(
            `Supersession proposal remains pending: ${proposal.recordId} -> ${successorRecordId}. Run wld wr supersede ${successorRecordId}.`,
        );
    }
}

export interface ResolveWorkRecordSupersessionProposalsWithUiOptions {
    projectRoot: string;
    successorRecordId: string;
    proposals: WorkRecordSupersessionCandidate[];
    mnemosynePort: WorkRecordMnemosynePort;
    uiAPI: Pick<import("../../ui/tui/types.js").UiAPI, "promptSelect" | "appendSystemMessage">;
}

/** Resolve generated proposals on a direct TUI surface. */
export function resolveWorkRecordSupersessionProposalsWithUi({
    projectRoot,
    successorRecordId,
    proposals,
    mnemosynePort,
    uiAPI,
}: ResolveWorkRecordSupersessionProposalsWithUiOptions): Promise<void> {
    return resolveWorkRecordSupersessionProposals({
        projectRoot,
        successorRecordId,
        proposals,
        mnemosynePort,
        choose: async (proposal) => {
            const answer = await uiAPI.promptSelect(
                buildValidationUserMessage({
                    kind: "work_record_prompt",
                    recordId: proposal.recordId,
                    reason: proposal.reason,
                }),
                [
                    { value: "confirm", label: "Confirm supersession" },
                    { value: "reject", label: "Reject proposal" },
                    { value: "later", label: "Decide later" },
                ],
            );
            return ["confirm", "reject", "later"].includes(String(answer))
                ? answer as WorkRecordSupersessionDecision
                : null;
        },
        notify: (message, warning = false) =>
            uiAPI.appendSystemMessage(
                buildValidationUserMessage({ kind: "work_record_notice", message }),
                warning,
                "RunWield",
            ),
    });
}

export const __dirname = dirname(fromFileUrl(import.meta.url));
type AgentMessage = import("@earendil-works/pi-agent-core").AgentMessage;
interface WorkflowValidationResult {
    kind: "verified" | "paused" | "failed";
    planName: string;
    projectRoot: string;
    classification?: string;
    reason?: string;
    epicContinuation?: { completedPlanName: string; projectRoot: string };
}

interface RunManualQaChecklistPromptOptions {
    hostedSession: import("../session/hosted-session.js").HostedSession;
    name: string;
    classification: "QUICK_FIX" | "PLANNED_CHANGE" | "FEATURE";
    context: string;
    cwd: string;
}

/**
 * Run a transient, tool-free prompt that presents manual checks to the user
 * after automated verification succeeds.
 *
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {string} args.name
 * @param {"QUICK_FIX"|"PLANNED_CHANGE"|"FEATURE"} args.classification
 * @param {string} args.context
 * @param {string} args.cwd
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runManualQaChecklistPrompt({
    hostedSession,
    name,
    classification,
    context,
    cwd,
}: RunManualQaChecklistPromptOptions) {
    const normalizedClassification = classification === "FEATURE" ? "PLANNED_CHANGE" : classification;
    const userRequest = [
        "Prepare the post-verification checklist from this source material.",
        `Name: ${name}`,
        `Classification: ${normalizedClassification}`,
        "",
        "### Source context",
        context,
    ].join("\n");

    const messages = await runIsolatedAgentSession({
        hostedSession,
        agentName: AGENTS.OPERATOR,
        userRequest,
        cwd,
        subAgentDefinition: { id: SUBAGENTS.MANUAL_QA },
        includeEditFallback: false,
    });
    const checklistText = extractAssistantOutput(messages);
    if (checklistText) {
        recordManualQaChecklistMessage(
            hostedSession.getRootSessionManager?.() as
                | import("@earendil-works/pi-coding-agent").SessionManager
                | undefined
                | null,
            { agentName: "Operator", text: checklistText, name, classification: normalizedClassification },
        );
    }
    return messages;
}

interface PresentManualQaChecklistOptions {
    hostedSession: import("../session/hosted-session.js").HostedSession;
    name: string;
    classification: "QUICK_FIX" | "PLANNED_CHANGE" | "FEATURE";
    context: string;
    cwd: string;
}

/**
 * Checklist generation is a post-verification handoff. A model failure should
 * be visible, but must not retroactively fail successful validation.
 *
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {string} args.name
 * @param {"QUICK_FIX"|"PLANNED_CHANGE"|"FEATURE"} args.classification
 * @param {string} args.context
 * @param {string} args.cwd
 * @returns {Promise<void>}
 */
async function presentManualQaChecklist(
    { hostedSession, name, classification, context, cwd }: PresentManualQaChecklistOptions,
) {
    try {
        await runManualQaChecklistPrompt({ hostedSession, name, classification, context, cwd });
    } catch (error) {
        console.error("[RunWield] manual_qa_list_failed", error);
        emitRunWieldSystemStatus(
            hostedSession,
            buildValidationUserMessage({ kind: "manual_qa_failed" }),
            true,
        );
    }
}

interface RunFeaturePostVerificationHandoffsOptions {
    hostedSession: import("../session/hosted-session.js").HostedSession;
    planName: string;
    planContent: string;
    projectRoot: string;
    mnemosynePort: WorkRecordMnemosynePort;
}

/**
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {string} args.planName
 * @param {string} args.planContent
 * @param {string} args.projectRoot
 * @param {WorkRecordMnemosynePort} args.mnemosynePort
 */
export async function runFeaturePostVerificationHandoffs({
    hostedSession,
    planName,
    planContent,
    projectRoot,
    mnemosynePort,
}: RunFeaturePostVerificationHandoffsOptions) {
    const plan = await loadPlan(projectRoot, planName).catch(() => null);
    const isEpicChild = typeof plan?.attrs.parentPlan === "string" && plan.attrs.parentPlan.trim().length > 0;
    if (!isEpicChild) {
        emitRunWieldSystemStatus(
            hostedSession,
            buildValidationUserMessage({ kind: "manual_qa_start" }),
        );
    }
    const manualQaPromise = isEpicChild ? Promise.resolve() : presentManualQaChecklist({
        hostedSession,
        name: planName,
        classification: "PLANNED_CHANGE",
        context: planContent,
        cwd: projectRoot,
    });
    emitRunWieldSystemStatus(
        hostedSession,
        buildValidationUserMessage({ kind: "work_record_start" }),
        "info",
    );
    const workRecordPromise = autoGenerateWorkRecordForCompletedPlan({
        cwd: projectRoot,
        planName,
        mnemosynePort,
    }).catch((error) => {
        console.error("[RunWield] work_record_failed", error);
        return {
            status: "failed" as const,
            planName,
            message: buildValidationUserMessage({ kind: "work_record_result", status: "failed" }),
        };
    });
    const [, workRecordResult] = await Promise.all([manualQaPromise, workRecordPromise]);
    emitRunWieldSystemStatus(
        hostedSession,
        buildValidationUserMessage({ kind: "work_record_result", status: workRecordResult.status }),
        workRecordResult.status === "failed"
            ? "warning"
            : workRecordResult.status === "generated" || workRecordResult.status === "linked"
            ? "success"
            : "info",
    );
    if (
        (workRecordResult.status === "generated" || workRecordResult.status === "linked") &&
        workRecordResult.recordId && workRecordResult.supersessionProposals?.length
    ) {
        await resolveWorkRecordSupersessionProposals({
            projectRoot,
            successorRecordId: workRecordResult.recordId,
            proposals: workRecordResult.supersessionProposals,
            mnemosynePort,
            choose: async (proposal) => {
                const response = await requestHostedSessionInteraction(
                    hostedSession,
                    {
                        type: RuntimeInteractionTypes.SELECT,
                        prompt: buildValidationUserMessage({
                            kind: "work_record_prompt",
                            recordId: proposal.recordId,
                            reason: proposal.reason,
                        }),
                        options: [
                            { value: "confirm", label: "Confirm supersession" },
                            { value: "reject", label: "Reject proposal" },
                            { value: "later", label: "Decide later" },
                        ],
                    },
                    undefined,
                    hostedSession.getManagedOperationCapability?.() || null,
                );
                return response.outcome === RuntimeInteractionOutcomes.SELECTED &&
                        ["confirm", "reject", "later"].includes(String(response.value))
                    ? response.value as WorkRecordSupersessionDecision
                    : null;
            },
            notify: (message, warning = false) =>
                emitRunWieldSystemStatus(
                    hostedSession,
                    buildValidationUserMessage({ kind: "work_record_notice", message }),
                    warning ? "warning" : "info",
                ),
        });
    }
}

/**
 * @param {import('../session/hosted-session.js').HostedSession | undefined} hostedSession
 * @param {string} agentName
 * @returns {AgentMessage[]}
 */
function getRootMessages(
    hostedSession: import("../session/hosted-session.js").HostedSession | undefined,
    agentName: string,
) {
    if (hostedSession?.getRootAgentName?.() !== agentName) return [];
    const rootSession = hostedSession?.getRootAgentSession?.();
    const messages = (rootSession as { agent?: { state?: { messages?: AgentMessage[] } } } | undefined)?.agent?.state
        ?.messages;
    return Array.isArray(messages) ? messages : [];
}

/**
 * @param {AgentMessage} left
 * @param {AgentMessage} right
 * @returns {boolean}
 */
function isSameMessage(left: AgentMessage, right: AgentMessage) {
    if (left === right) return true;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

/**
 * @param {AgentMessage[]} messages
 * @param {AgentMessage[]} prefix
 * @returns {boolean}
 */
function startsWithMessages(messages: AgentMessage[], prefix: AgentMessage[]) {
    return prefix.every((message, index) => isSameMessage(messages[index], message));
}

interface RunCompletionGatedRepairOptions {
    agentName: string;
    userRequest: string;
    images?: Array<{ base64: string; mimeType: string }>;
    sessionManager: import("@earendil-works/pi-coding-agent").SessionManager | undefined;
    cwd?: string;
    hostedSession: import("../session/hosted-session.js").HostedSession;
}

async function runCompletionGatedRepair({
    agentName,
    userRequest,
    images = [],
    sessionManager,
    cwd,
    hostedSession,
}: RunCompletionGatedRepairOptions): Promise<boolean> {
    const previousRootMessages = getRootMessages(hostedSession, agentName).slice();
    const fromIndex = previousRootMessages.length;
    const workflow = hostedSession.getActiveExecutionWorkflow?.();
    const customTools = workflow?.collaborationStyle === "pair"
        ? [createPairCheckpointTool({ hostedSession })]
        : undefined;
    const messages = await runActiveAgentTurn({
        hostedSession,
        agentName,
        userRequest,
        images,
        sessionManager,
        cwd,
        dispatchKind: "validation_repair",
        ...(customTools ? { customTools } : {}),
    });

    const returnedRootTranscript = startsWithMessages(messages, previousRootMessages);
    return readLatestTaskCompletedOutcome(messages, returnedRootTranscript ? fromIndex : undefined);
}

/**
 * Whether the Reviewer actually opened the diff during an invocation.
 *
 * The diff is never inlined into the prompt, so a `review_complete` call made
 * without any `review_diff` call is a verdict reached without reading the code.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {boolean}
 */
export function usedReviewDiffTool(messages: import("@earendil-works/pi-agent-core").AgentMessage[]) {
    if (!Array.isArray(messages)) return false;
    return messages.some((msg) => {
        if (!msg || typeof msg !== "object" || !("role" in msg) || msg.role !== "toolResult") return false;
        if (!("toolName" in msg) || msg.toolName !== "review_diff") return false;
        // A failed lookup or an absent repair scope is not an inspection: the
        // Reviewer saw no code, so it must not satisfy the read-before-deciding
        // requirement.
        const result = msg as ReviewDiffToolResult;
        if (result.isError) return false;
        const details = result.details || {};
        return details.available !== false;
    });
}

/** The `review_diff` tool-result fields this check reads off a transcript message. */
interface ReviewDiffToolResult {
    isError?: boolean;
    details?: { available?: boolean };
}

/**
 * Whether the latest accepted `review_complete` result came from the trusted
 * Claude CLI MCP bridge.
 *
 * Claude CLI owns its internal read/Bash tool loop and RunWield does not
 * ingest that internal transcript, so a bridge-stamped accepted result waives
 * only the Pi-specific `review_diff`-before-verdict prerequisite. The waiver
 * says nothing about what Claude actually inspected; it is not proof of
 * inspection and must not generalize to Pi, Attached Mode, arbitrary external
 * results, or approval with incomplete/open findings.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {boolean}
 */
export function hasTrustedClaudeMcpReview(messages: import("@earendil-works/pi-agent-core").AgentMessage[]) {
    if (!Array.isArray(messages)) return false;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || typeof msg !== "object" || !("role" in msg) || msg.role !== "toolResult") continue;
        if (!("toolName" in msg) || msg.toolName !== "review_complete") continue;
        const details = (msg as { details?: { outcome?: unknown; provenance?: unknown } }).details || {};
        const outcome = details.outcome;
        if (outcome !== "approved" && outcome !== "feedback") continue;
        return details.provenance === "claude-cli-mcp";
    }
    return false;
}

/**
 * Open ledger identities a review result failed to mention.
 *
 * The ledger only converges if every round returns a verdict on every open item.
 * An omission is not neutral: it would let an approval merge over a finding
 * nobody addressed, and it makes a re-reported issue arrive as a new identity
 * beside the original, so one defect becomes two and the count grows each round.
 *
 * @param {import('./review-ledger.ts').ReviewLedger} ledger
 * @param {import('../../tools/review-complete.ts').ReviewFinding[] | undefined} findings
 * @returns {string[]}
 */
export { unaccountedOpenItems } from "./review-ledger.ts";

/**
 * HumanReviewDecision is declared below as a TypeScript union.
 */

type HumanReviewDecision = "not_required" | "skipped" | "approved";

interface HumanReviewMetadata {
    humanReviewMode: "none" | "ask" | "always";
    humanReviewDecision: HumanReviewDecision;
    humanReviewedAt: string | null;
}

/**
 * @param {import('../../tools/plan-written.ts').TriageMeta} triageMeta
 * @returns {boolean}
 */
export function shouldRunWorkflowValidation(triageMeta: import("../../tools/plan-written.ts").TriageMeta) {
    return isPlannedChangeClassification(triageMeta?.classification) || triageMeta?.classification === "PROJECT";
}

/**
 * @param {import('../../tools/plan-written.ts').TriageMeta} triageMeta
 * @returns {boolean}
 */
export function shouldContinueParentEpicAfterValidation(triageMeta: import("../../tools/plan-written.ts").TriageMeta) {
    const parentPlan = triageMeta?.parentPlan;
    return isPlannedChangeClassification(triageMeta?.classification) &&
        typeof parentPlan === "string" &&
        parentPlan.trim().length > 0;
}

interface RunMechanicalValidationOptions {
    sessionManager: import("@earendil-works/pi-coding-agent").SessionManager | undefined;
    hostedSession?: import("../session/hosted-session.js").HostedSession;
    cwd?: string;
    manualQaName?: string;
    manualQaContext?: string;
}

/**
 * No-plan Mechanical Validation for direct QUICK_FIX work. Runs configured local
 * CI and sends failures back to Engineer, without Plan lifecycle, semantic
 * review, code review, implementation diff checks, worktree merge-back, or
 * worktree registry updates.
 *
 * @param {Object} args
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {import('../session/hosted-session.js').HostedSession} [args.hostedSession]
 * @param {string} [args.cwd]
 * @param {string} [args.manualQaName]
 * @param {string} [args.manualQaContext]
 * @param {LocalCIPort} localCI External local-CI process boundary. Required on
 *   purpose: a port with a production default is an override bag wearing a port's
 *   name, because a caller that passes nothing gets the real thing silently.
 * @returns {Promise<{ passed: boolean, attempts: number, reason?: string }>}
 */
export async function runMechanicalValidation({
    sessionManager,
    hostedSession,
    cwd,
    manualQaName = "quick-fix",
    manualQaContext = "The QUICK_FIX implementation completed and passed automated verification.",
}: RunMechanicalValidationOptions, localCI: LocalCIPort): Promise<{
    passed: boolean;
    attempts: number;
    reason?: string;
}> {
    if (!hostedSession) throw new Error("runMechanicalValidation: hostedSession is required");
    const projectRoot = hostedSession?.cwd || cwd;
    if (!projectRoot) throw new Error("runMechanicalValidation: hostedSession or cwd is required");
    const metricProjectRoot = projectRoot;
    const validationCwd = cwd || hostedSession?.getActiveExecutionCwd?.() || projectRoot;
    function recordWorkflowMetricImpl(metric: Parameters<typeof recordWorkflowMetric>[0]) {
        return recordWorkflowMetric(metric, metricProjectRoot);
    }
    /** @param {string} agentName */
    const activateAgent = async (agentName: string) => {
        if (!hostedSession) return;
        await switchActiveAgent(hostedSession, { agentName });
    };
    const maxRepairAttempts = 3;
    let repairAttempts = 0;
    let progress = createValidationProgress({
        kind: "mechanical",
        outcome: "running",
        stage: "ci",
        checks: { ci: "running", semanticReview: "skipped", humanReview: "skipped", merge: "skipped" },
    });

    await recordWorkflowMetricImpl({
        category: "validation",
        event: "mechanical_validation_started",
        planName: "quick-fix",
        details: { maxRepairAttempts },
    });
    emitRunWieldSystemStatus(
        hostedSession,
        buildValidationUserMessage({ kind: "quick_fix_start" }),
        "info",
        progress,
    );

    while (true) {
        progress = updateValidationProgress(progress, {
            outcome: "running",
            stage: "ci",
            repairAttempt: repairAttempts > 0 ? repairAttempts : null,
            maxRepairAttempts: repairAttempts > 0 ? maxRepairAttempts : null,
            checks: { ci: "running" },
        });
        emitRunWieldSystemStatus(
            hostedSession,
            buildValidationUserMessage({
                kind: "quick_fix_running",
                attempt: repairAttempts,
                maxAttempts: maxRepairAttempts,
            }),
            "info",
            progress,
        );
        const ciResult = await localCI.run({ hostedSession, cwd: validationCwd });

        await recordWorkflowMetricImpl({
            category: "validation",
            event: "mechanical_ci_attempt",
            planName: "quick-fix",
            details: {
                attempt: repairAttempts + 1,
                exitCode: ciResult.exitCode,
                passed: ciResult.exitCode === 0,
                canceled: ciResult.canceled === true,
            },
        });
        if (ciResult.canceled) {
            progress = updateValidationProgress(progress, {
                outcome: "paused",
                stage: "terminal",
                message: buildValidationUserMessage({ kind: "quick_fix_canceled" }),
                checks: { ci: "canceled" },
            });
            emitRunWieldSystemStatus(
                hostedSession,
                buildValidationUserMessage({ kind: "quick_fix_canceled" }),
                false,
                progress,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: false, canceled: true, attempts: repairAttempts },
            });
            await activateAgent(AGENTS.ENGINEER);
            return { passed: false, attempts: repairAttempts, reason: "canceled" };
        }
        if (ciResult.exitCode === 0) {
            progress = updateValidationProgress(progress, { checks: { ci: "passed" } });
            emitRunWieldSystemStatus(
                hostedSession,
                buildValidationUserMessage({ kind: "quick_fix_ci_passed" }),
                "success",
                progress,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: true, attempts: repairAttempts },
            });
            progress = updateValidationProgress(progress, {
                outcome: "running",
                stage: "manual_qa",
                message: "Preparing QUICK_FIX manual QA checklist.",
            });
            emitRunWieldSystemStatus(
                hostedSession,
                buildValidationUserMessage({ kind: "quick_fix_qa" }),
                "info",
                progress,
            );
            await presentManualQaChecklist({
                hostedSession,
                name: manualQaName,
                classification: "QUICK_FIX",
                context: manualQaContext,
                cwd: validationCwd,
            });
            progress = completeValidationProgress(
                progress,
                true,
                buildValidationUserMessage({ kind: "quick_fix_passed" }),
            );
            emitRunWieldSystemStatus(
                hostedSession,
                buildValidationUserMessage({ kind: "quick_fix_passed" }),
                "success",
                progress,
            );
            await activateAgent(AGENTS.ENGINEER);
            return { passed: true, attempts: repairAttempts };
        }

        if (repairAttempts >= maxRepairAttempts) {
            const reason =
                `QUICK_FIX Mechanical Validation failed after ${maxRepairAttempts} Engineer repair attempts.`;
            progress = completeValidationProgress(
                updateValidationProgress(progress, { checks: { ci: "failed" } }),
                false,
                buildValidationUserMessage({ kind: "quick_fix_failed", maxAttempts: maxRepairAttempts }),
            );
            emitRunWieldSystemStatus(
                hostedSession,
                buildValidationUserMessage({ kind: "quick_fix_failed", maxAttempts: maxRepairAttempts }),
                true,
                progress,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: false, attempts: repairAttempts, reason: "max_repair_attempts" },
            });
            await activateAgent(AGENTS.ENGINEER);
            return { passed: false, attempts: repairAttempts, reason };
        }

        repairAttempts++;
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "mechanical_repair_dispatched",
            agentName: AGENTS.ENGINEER,
            planName: "quick-fix",
            details: { repairAttempt: repairAttempts },
        });
        progress = updateValidationProgress(progress, {
            outcome: "running",
            stage: "engineer_repair",
            repairAttempt: repairAttempts,
            maxRepairAttempts,
            checks: { ci: "failed" },
        });
        emitRunWieldSystemStatus(
            hostedSession,
            buildValidationUserMessage({
                kind: "quick_fix_repair",
                agent: getAgentDisplayName(AGENTS.ENGINEER, projectRoot),
                attempt: repairAttempts,
                maxAttempts: maxRepairAttempts,
            }),
            true,
            progress,
        );
        const completed = await runCompletionGatedRepair({
            agentName: AGENTS.ENGINEER,
            userRequest:
                "The no-plan QUICK_FIX failed Mechanical Validation. Fix the following CI errors, do not expand scope, " +
                "run appropriate verification, then call task_completed when the repair is complete. " +
                "If the repair involves tests, follow the write-tests skill for sound testing behavior:\n\n" +
                ciResult.output,
            sessionManager,
            cwd: validationCwd,
            hostedSession,
        });
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "mechanical_repair_completed",
            agentName: AGENTS.ENGINEER,
            planName: "quick-fix",
            details: { repairAttempt: repairAttempts, taskCompletedObserved: Boolean(completed) },
        });
        if (!completed) {
            const reason = `${
                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
            } stopped without task_completed during QUICK_FIX repair.`;
            progress = updateValidationProgress(progress, {
                outcome: "paused",
                message: buildValidationUserMessage({
                    kind: "quick_fix_waiting",
                    agent: getAgentDisplayName(AGENTS.ENGINEER, projectRoot),
                }),
            });
            emitRunWieldSystemStatus(
                hostedSession,
                buildValidationUserMessage({
                    kind: "quick_fix_waiting",
                    agent: getAgentDisplayName(AGENTS.ENGINEER, projectRoot),
                }),
                true,
                progress,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: false, attempts: repairAttempts, reason: "repair_without_task_completed" },
            });
            hostedSession?.setActiveExecutionWorkflow({
                planName: "quick-fix",
                triageMeta: { classification: "QUICK_FIX" },
                executionAgent: AGENTS.ENGINEER as "engineer",
                executionCwd: validationCwd,
                validationContinuation: true,
                manualQaName,
                manualQaContext,
            });
            await activateAgent(AGENTS.ENGINEER);
            return { passed: false, attempts: repairAttempts, reason };
        }
    }
}

export { verifyPostMergeCandidatePublished };

export { loadManualQaPrompt, loadReviewerFeedbackEngineerDef, loadReviewerPrompt };

export { runLocalCI };
