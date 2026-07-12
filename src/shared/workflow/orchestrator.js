/**
 * @module shared/workflow/orchestrator
 * Workflow Orchestrator for Triage outcomes.
 *
 * When any active Agent calls `triage_report`, the tool terminates that Agent's
 * turn and returns a Triage Report. The active Agent handler consumes the tool
 * outcome and dispatches the next Agent:
 *
 * INQUIRY   → Guide
 * IDEATION  → Ideator
 * OPERATION → Operator
 * QUICK_FIX → Engineer → on `task_completed`, runs no-plan Mechanical Validation
 * FEATURE   → Planner  → on `approved_execute`, runs `executePlan`
 * PROJECT   → Architect → on `approved_execute`, runs `executePlan` (parallel tasks)
 *
 * After dispatch, the specialist remains the active root agent so follow-up
 * messages can continue the same topic with useful context. Users can start a
 * fresh routed thread with /new, or explicitly return to routing with
 * /agent router.
 *
 * Plan-feedback loops stay inside the planning session because plan_written
 * returns `feedback` non-terminating — the planner sees the tool result and
 * iterates without rebuilding LLM context.
 */

import { AGENTS, ROUTING_INTENTS } from "../../constants.js";
import { ensurePlansDir, loadPlan } from "../../plan-store.js";
import { hasNonGitExecutionConsent, probeGitRepository, rememberNonGitExecutionConsent } from "../git.js";
import { applyPendingRootSwap, setActiveAgent } from "../session/agent-switching.js";
import { runRootTurn } from "../session/session.js";
import { getAgentDisplayName } from "../session/agents.js";
import { sanitizeSessionName } from "../session/session-name.js";
import { RuntimeEventTypes } from "../session/session-runtime-events.js";
import { decidePostExecution, decidePostPlanning, summarizeWorkflowDecision } from "./decisions.js";
import { recordWorkflowMetric } from "./metrics.js";
import { executePlan, readLatestTaskCompletedOutcome, runPlanningAgent, runSlicerAgent } from "./workflow.js";
import { runMechanicalValidation, runValidationLoop, shouldRunWorkflowValidation } from "./validation.js";

export { runLocalCI, runMechanicalValidation, runValidationLoop } from "./validation.js";

/**
 * @typedef {Object} TriageOutcome
 * @property {"INQUIRY" | "IDEATION" | "OPERATION" | "QUICK_FIX" | "FEATURE" | "PROJECT"} routingIntent
 * @property {"FEATURE" | "PROJECT" | undefined} [classification]
 * @property {"LOW" | "MEDIUM" | "HIGH"} complexity
 * @property {string} summary
 * @property {string} [sessionName]
 * @property {string[]} affectedPaths
 */

const PLAN_ROUTING_INTENTS = ["FEATURE", "PROJECT"];

/**
 * @param {import('./workflow.js').UiAPI} uiAPI
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
async function confirmNonGitQuickFixExecution(uiAPI, projectRoot) {
    if (!uiAPI.promptSelect) return false;
    const answer = await uiAPI.promptSelect(
        "Git is not available for this project. RunWield recommends using Git before QUICK_FIX edits so changes can be reviewed and recovered with normal Git tools. Proceeding will modify the current files directly.",
        [
            { value: "proceed", label: "Proceed in current files and remember for QUICK_FIX work" },
            { value: "cancel", label: "Cancel QUICK_FIX" },
        ],
    );
    if (answer !== "proceed") return false;
    await rememberNonGitExecutionConsent("quickFix", projectRoot);
    return true;
}

/**
 * @param {unknown} value
 * @returns {"INQUIRY" | "IDEATION" | "OPERATION" | "QUICK_FIX" | "FEATURE" | "PROJECT" | null}
 */
function asRoutingIntent(value) {
    if (typeof value !== "string") return null;
    if (!ROUTING_INTENTS.includes(value)) return null;
    return /** @type {"INQUIRY" | "IDEATION" | "OPERATION" | "QUICK_FIX" | "FEATURE" | "PROJECT"} */ (value);
}

/**
 * Normalize canonical `routingIntent` details and legacy `classification`
 * details into a Routing Intent outcome. Plan Classification is preserved only
 * for plan-producing intents.
 *
 * @param {unknown} details
 * @returns {TriageOutcome | null}
 */
function normalizeTriageOutcome(details) {
    if (!details || typeof details !== "object") return null;
    const record = /** @type {Record<string, unknown>} */ (details);
    const routingIntent = asRoutingIntent(record.routingIntent) || asRoutingIntent(record.classification);
    if (!routingIntent) return null;

    const outcome = /** @type {TriageOutcome} */ ({
        ...record,
        routingIntent,
    });
    const sessionName = sanitizeSessionName(record.sessionName);
    if (sessionName) {
        outcome.sessionName = sessionName;
    } else {
        delete outcome.sessionName;
    }

    if (PLAN_ROUTING_INTENTS.includes(routingIntent)) {
        outcome.classification = /** @type {"FEATURE" | "PROJECT"} */ (routingIntent);
    } else {
        delete outcome.classification;
    }

    return outcome;
}

/**
 * Read the latest triage_report tool result's details from a message stream.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @param {number} [fromIndex]
 * @returns {TriageOutcome | null}
 */
export function readLatestTriageOutcome(messages, fromIndex) {
    const start = fromIndex != null ? fromIndex : 0;
    for (let i = messages.length - 1; i >= start; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "triage_report"
        ) {
            // @ts-ignore details set by tool implementation
            const normalized = normalizeTriageOutcome(msg.details);
            if (normalized) return normalized;
        }
    }
    return null;
}

/**
 * @param {TriageOutcome} triage
 */
function buildTriageBlock(triage) {
    const lines = [
        "## Triage Report",
        `- Routing Intent: ${triage.routingIntent}`,
    ];
    if (triage.classification) lines.push(`- Plan Classification: ${triage.classification}`);
    if (triage.sessionName) lines.push(`- Session Name: ${triage.sessionName}`);
    lines.push(
        `- Complexity: ${triage.complexity}`,
        `- Summary: ${triage.summary}`,
        `- Affected paths: ${(triage.affectedPaths || []).join(", ")}`,
        "",
    );
    return lines.join("\n");
}

/**
 * Apply a Router-provided Session Name only when the session is currently unnamed.
 * Always mirror the effective Session Name to the Terminal Title when available.
 *
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @param {TriageOutcome} triage
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {((name: string) => string) | undefined} [setTitle]
 */
function applyAutoSessionName(sessionManager, triage, hostedSession, setTitle) {
    if (!sessionManager) return;
    const eventSink = /** @type {{ emit?: (event: Record<string, unknown>) => void } | null} */ (
        hostedSession.getEventSink?.() || null
    );

    const existingName = sanitizeSessionName(sessionManager.getSessionName?.() || "");
    if (existingName) {
        setTitle?.(existingName);
        eventSink?.emit?.({ type: RuntimeEventTypes.SESSION_RENAMED, name: existingName });
        return;
    }

    const sessionName = sanitizeSessionName(triage.sessionName || "");
    if (!sessionName) return;

    sessionManager.appendSessionInfo?.(sessionName);
    setTitle?.(sessionName);
    eventSink?.emit?.({ type: RuntimeEventTypes.SESSION_RENAMED, name: sessionName });
}

/**
 * Dispatch the next Agent based on a Triage Report's Routing Intent, then
 * (for FEATURE/PROJECT) execute the approved plan.
 *
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {TriageOutcome} args.triage
 * @param {string} args.userRequest
 * @param {import('../session/types.js').ImageAttachment[] | undefined} args.images
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {{
 *   applyPendingRootSwap?: typeof applyPendingRootSwap,
 *   createAgentHandler?: (agentName: string, deps?: { hostedSession?: import('../session/hosted-session.js').HostedSession }) => import('../session/types.js').AgentMessageHandler,
 *   readLatestTaskCompletedOutcome?: typeof readLatestTaskCompletedOutcome,
 *   decidePostPlanning?: typeof decidePostPlanning,
 *   decidePostExecution?: typeof decidePostExecution,
 *   ensurePlansDir?: typeof ensurePlansDir,
 *   executePlan?: typeof executePlan,
 *   loadPlan?: typeof loadPlan,
 *   runPlanningAgent?: typeof runPlanningAgent,
 *   runSlicerAgent?: typeof runSlicerAgent,
 *   runRootTurn?: typeof runRootTurn,
 *   runMechanicalValidation?: typeof runMechanicalValidation,
 *   runValidationLoop?: typeof runValidationLoop,
 *   setActiveAgent?: typeof setActiveAgent,
 *   setTerminalTitleForName?: (name: string) => string,
 *   shouldRunWorkflowValidation?: typeof shouldRunWorkflowValidation,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   probeGitRepository?: typeof probeGitRepository,
 *   hasNonGitExecutionConsent?: typeof hasNonGitExecutionConsent,
 *   confirmNonGitQuickFixExecution?: typeof confirmNonGitQuickFixExecution,
 * }} [args.__deps]
 */
export async function dispatchPostTriage(
    { hostedSession, triage, userRequest, images, uiAPI, sessionManager, __deps },
) {
    if (!uiAPI) throw new Error("dispatchPostTriage: uiAPI is required");
    if (!hostedSession || typeof hostedSession.getRootAgentName !== "function") {
        throw new Error("dispatchPostTriage: hostedSession is required");
    }
    const projectRoot = hostedSession.cwd;

    const normalizedTriage = normalizeTriageOutcome(triage);
    if (!normalizedTriage) throw new Error("dispatchPostTriage: routingIntent is required");

    const triageBlock = buildTriageBlock(normalizedTriage);
    const decoratedRequest = ["## User Request", userRequest, "", triageBlock].join("\n");
    const applyPendingRootSwapImpl = __deps?.applyPendingRootSwap || applyPendingRootSwap;
    const createAgentHandlerSource = __deps?.createAgentHandler ||
        (await import("../session/agent-handler.js")).createAgentHandler;
    /** @param {string} nextAgentName */
    const createAgentHandlerImpl = (nextAgentName) => createAgentHandlerSource(nextAgentName, { hostedSession });
    const runMechanicalValidationImpl = __deps?.runMechanicalValidation || runMechanicalValidation;
    const runValidationLoopImpl = __deps?.runValidationLoop || runValidationLoop;
    const decidePostPlanningImpl = __deps?.decidePostPlanning || decidePostPlanning;
    const decidePostExecutionImpl = __deps?.decidePostExecution || decidePostExecution;
    const setActiveAgentImpl = __deps?.setActiveAgent || setActiveAgent;
    const setTerminalTitleForNameImpl = __deps?.setTerminalTitleForName;
    const runSlicerAgentImpl = __deps?.runSlicerAgent || runSlicerAgent;
    const recordWorkflowMetricImpl = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const probeGit = __deps?.probeGitRepository || probeGitRepository;
    const hasConsent = __deps?.hasNonGitExecutionConsent || hasNonGitExecutionConsent;
    const confirmQuickFix = __deps?.confirmNonGitQuickFixExecution || confirmNonGitQuickFixExecution;

    applyAutoSessionName(sessionManager, normalizedTriage, hostedSession, setTerminalTitleForNameImpl);

    const dispatchTarget = normalizedTriage.routingIntent === "INQUIRY"
        ? AGENTS.GUIDE
        : normalizedTriage.routingIntent === "IDEATION"
        ? AGENTS.IDEATOR
        : normalizedTriage.routingIntent === "OPERATION"
        ? AGENTS.OPERATOR
        : normalizedTriage.routingIntent === "QUICK_FIX"
        ? AGENTS.ENGINEER
        : normalizedTriage.routingIntent === "FEATURE"
        ? AGENTS.PLANNER
        : AGENTS.ARCHITECT;
    await recordWorkflowMetricImpl({
        category: "routing",
        event: "dispatch_selected",
        agentName: dispatchTarget,
        details: {
            routingIntent: normalizedTriage.routingIntent,
            targetAgent: dispatchTarget,
            classification: normalizedTriage.classification,
            complexity: normalizedTriage.complexity,
        },
    });

    if (normalizedTriage.routingIntent === "INQUIRY" || normalizedTriage.routingIntent === "IDEATION") {
        const agentName = normalizedTriage.routingIntent === "INQUIRY" ? AGENTS.GUIDE : AGENTS.IDEATOR;
        const runRootTurnImpl = __deps?.runRootTurn || runRootTurn;

        setActiveAgentImpl(hostedSession, agentName, createAgentHandlerImpl(agentName), uiAPI);
        await applyPendingRootSwapImpl(hostedSession, uiAPI);

        await runRootTurnImpl({
            hostedSession,
            agentName,
            userRequest: decoratedRequest,
            images,
            uiAPI,
        });
        return;
    }

    if (normalizedTriage.routingIntent === "OPERATION") {
        const operatorDisplay = getAgentDisplayName(AGENTS.OPERATOR, projectRoot);
        const runRootTurnImpl = __deps?.runRootTurn || runRootTurn;
        const readLatestTaskCompletedOutcomeImpl = __deps?.readLatestTaskCompletedOutcome ||
            readLatestTaskCompletedOutcome;

        setActiveAgentImpl(hostedSession, AGENTS.OPERATOR, createAgentHandlerImpl(AGENTS.OPERATOR), uiAPI);
        await applyPendingRootSwapImpl(hostedSession, uiAPI);

        const messages = await runRootTurnImpl({
            hostedSession,
            agentName: AGENTS.OPERATOR,
            userRequest: decoratedRequest,
            images,
            uiAPI,
        });
        const completed = readLatestTaskCompletedOutcomeImpl(messages);
        await recordWorkflowMetricImpl({
            category: "execution",
            event: "operation_completed_observed",
            agentName: AGENTS.OPERATOR,
            details: { taskCompletedObserved: Boolean(completed), mechanicalValidationRan: false },
        });
        if (!completed) {
            uiAPI.appendSystemMessage(
                `${operatorDisplay} stopped without task_completed; OPERATION may be incomplete.`,
                false,
                "RunWield",
            );
        }
        return;
    }

    if (normalizedTriage.routingIntent === "QUICK_FIX") {
        const engineerDisplay = getAgentDisplayName(AGENTS.ENGINEER, projectRoot);
        const runRootTurnImpl = __deps?.runRootTurn || runRootTurn;
        const readLatestTaskCompletedOutcomeImpl = __deps?.readLatestTaskCompletedOutcome ||
            readLatestTaskCompletedOutcome;
        const gitProbe = await probeGit(projectRoot);
        if (
            !gitProbe.ok && !hasConsent("quickFix", projectRoot) &&
            !(await confirmQuickFix(uiAPI, projectRoot))
        ) {
            uiAPI.appendSystemMessage(
                "QUICK_FIX canceled because Git is not available and in-place edits were not approved.",
                false,
                "RunWield",
            );
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "quick_fix_non_git_canceled",
                agentName: AGENTS.ENGINEER,
                details: { gitState: gitProbe.state },
            });
            return;
        }

        setActiveAgentImpl(hostedSession, AGENTS.ENGINEER, createAgentHandlerImpl(AGENTS.ENGINEER), uiAPI);
        await applyPendingRootSwapImpl(hostedSession, uiAPI);

        const messages = await runRootTurnImpl({
            hostedSession,
            agentName: AGENTS.ENGINEER,
            userRequest: decoratedRequest,
            images,
            uiAPI,
        });
        const completed = readLatestTaskCompletedOutcomeImpl(messages);
        if (!completed) {
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "quick_fix_completed_observed",
                agentName: AGENTS.ENGINEER,
                details: { taskCompletedObserved: false, mechanicalValidationRan: false },
            });
            uiAPI.appendSystemMessage(
                `${engineerDisplay} stopped without task_completed; QUICK_FIX may be incomplete and Mechanical Validation will not run.`,
                false,
                "RunWield",
            );
            return;
        }

        const mechanicalResult = await runMechanicalValidationImpl({
            hostedSession,
            uiAPI,
            sessionManager,
        });
        await recordWorkflowMetricImpl({
            category: "execution",
            event: "quick_fix_completed_observed",
            agentName: AGENTS.ENGINEER,
            details: {
                taskCompletedObserved: true,
                mechanicalValidationRan: true,
                mechanicalValidationPassed: mechanicalResult?.passed,
                attempts: mechanicalResult?.attempts,
            },
        });
        return;
    }

    if (normalizedTriage.routingIntent === "FEATURE" || normalizedTriage.routingIntent === "PROJECT") {
        const isFeature = normalizedTriage.routingIntent === "FEATURE";
        const agentName = isFeature ? AGENTS.PLANNER : AGENTS.ARCHITECT;
        const ensurePlansDirImpl = __deps?.ensurePlansDir || ensurePlansDir;
        const runPlanningAgentImpl = __deps?.runPlanningAgent || runPlanningAgent;
        const executePlanImpl = __deps?.executePlan || executePlan;
        const loadPlanImpl = __deps?.loadPlan || loadPlan;
        const shouldRunWorkflowValidationImpl = __deps?.shouldRunWorkflowValidation || shouldRunWorkflowValidation;

        await ensurePlansDirImpl(projectRoot);

        const outcome = await runPlanningAgentImpl({
            agentName,
            initialRequest: decoratedRequest,
            triageMeta: normalizedTriage,
            uiAPI,
            sessionManager,
            hostedSession,
        });
        hostedSession.consumePendingSwitchHandoff(); // Drain any switch requests from planner

        const decision = decidePostPlanningImpl(outcome, {
            planningAgentName: agentName,
            fallbackTriageMeta: normalizedTriage,
        });
        await recordWorkflowMetricImpl({
            category: "planning",
            event: "decision",
            agentName,
            planName: typeof decision.payload.planName === "string" ? decision.payload.planName : undefined,
            details: summarizeWorkflowDecision(decision),
        });

        if (decision.kind === "start_slicer") {
            const planName = /** @type {string} */ (decision.payload.planName);
            const slicerTriageMeta = /** @type {TriageOutcome} */ (
                normalizeTriageOutcome(decision.payload.triageMeta) || normalizedTriage
            );
            const slicerResult = await runSlicerAgentImpl({
                planName,
                triageMeta: slicerTriageMeta,
                uiAPI,
                hostedSession,
                sessionManager,
            });
            await recordWorkflowMetricImpl({
                category: "planning",
                event: "active_agent_transition",
                agentName: slicerResult.ok ? AGENTS.SLICER : agentName,
                planName,
                details: {
                    transition: slicerResult.ok ? "start_slicer" : "slicer_start_failed",
                    decisionKind: decision.kind,
                },
            });
            if (!slicerResult.ok) {
                setActiveAgentImpl(hostedSession, agentName, createAgentHandlerImpl(agentName), uiAPI);
            }
            return;
        }

        if (decision.kind === "stay_with_agent" || decision.kind === "save_plan") {
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "feature_project_outcome",
                agentName,
                planName: typeof decision.payload.planName === "string" ? decision.payload.planName : undefined,
                details: {
                    routingIntent: normalizedTriage.routingIntent,
                    outcome: decision.kind === "save_plan" ? "plan_saved" : "planning_incomplete",
                    decisionKind: decision.kind,
                },
            });
            setActiveAgentImpl(hostedSession, agentName, createAgentHandlerImpl(agentName), uiAPI);
            return;
        }

        if (decision.kind !== "execute_plan") {
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "feature_project_outcome",
                agentName,
                details: {
                    routingIntent: normalizedTriage.routingIntent,
                    outcome: "planning_halted",
                    decisionKind: decision.kind,
                },
            });
            uiAPI.appendSystemMessage(`Workflow halted: ${String(decision.payload.reason || "unknown reason")}`);
            setActiveAgentImpl(hostedSession, agentName, createAgentHandlerImpl(agentName), uiAPI);
            return;
        }

        const planName = /** @type {string} */ (decision.payload.planName);
        const decisionTriageMeta = /** @type {TriageOutcome} */ (
            normalizeTriageOutcome(decision.payload.triageMeta) || normalizedTriage
        );
        const tasks = /** @type {import('./workflow.js').PlanOutcomeResult["tasks"]} */ (decision.payload.tasks);

        /** @type {import('./workflow.js').PlanExecutionResult} */
        let executionResult;
        try {
            executionResult = await executePlanImpl(
                planName,
                decisionTriageMeta,
                uiAPI,
                tasks,
                sessionManager,
                { hostedSession, recordWorkflowMetric: recordWorkflowMetricImpl },
            );
        } catch (error) {
            hostedSession.consumePendingSwitchHandoff(); // Drain any switch requests from execution sub-agents
            const reason = error instanceof Error ? error.message : String(error);
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "feature_project_outcome",
                agentName: AGENTS.ENGINEER,
                planName,
                details: {
                    routingIntent: normalizedTriage.routingIntent,
                    outcome: "execution_threw",
                    hasError: Boolean(reason),
                },
            });
            uiAPI.appendSystemMessage(
                `Plan execution failed: ${reason}. The Engineer may need manual intervention.`,
                true,
                "RunWield",
            );
            setActiveAgentImpl(hostedSession, AGENTS.ENGINEER, createAgentHandlerImpl(AGENTS.ENGINEER), uiAPI);
            return;
        }
        hostedSession.consumePendingSwitchHandoff(); // Drain any switch requests from execution sub-agents

        const executionDecision = decidePostExecutionImpl(executionResult, {
            planName,
            triageMeta: decisionTriageMeta,
            executionAgentName: AGENTS.ENGINEER,
        });
        await recordWorkflowMetricImpl({
            category: "execution",
            event: "decision",
            agentName: AGENTS.ENGINEER,
            planName,
            details: summarizeWorkflowDecision(executionDecision),
        });
        if (executionDecision.kind === "run_validation") {
            const plan = await loadPlanImpl(projectRoot, planName);
            if (shouldRunWorkflowValidationImpl(decisionTriageMeta)) {
                await runValidationLoopImpl({
                    hostedSession,
                    planName,
                    planContent: plan?.markdown || "",
                    triageMeta: decisionTriageMeta,
                    uiAPI,
                    sessionManager,
                    finalAgentName: agentName,
                    __deps: { recordWorkflowMetric: recordWorkflowMetricImpl },
                });
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "feature_project_outcome",
                    agentName: AGENTS.ENGINEER,
                    planName,
                    details: {
                        routingIntent: normalizedTriage.routingIntent,
                        outcome: "validation_completed",
                        executionDecisionKind: executionDecision.kind,
                    },
                });
            } else {
                await recordWorkflowMetricImpl({
                    category: "execution",
                    event: "feature_project_outcome",
                    agentName: AGENTS.ENGINEER,
                    planName,
                    details: {
                        routingIntent: normalizedTriage.routingIntent,
                        outcome: "validation_skipped",
                        executionDecisionKind: executionDecision.kind,
                    },
                });
            }
        } else if (executionDecision.kind === "stay_with_agent") {
            const nextAgentName = /** @type {string} */ (executionDecision.payload.agentName || AGENTS.ENGINEER);
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "feature_project_outcome",
                agentName: nextAgentName,
                planName,
                details: {
                    routingIntent: normalizedTriage.routingIntent,
                    outcome: "execution_incomplete",
                    executionDecisionKind: executionDecision.kind,
                },
            });
            setActiveAgentImpl(hostedSession, nextAgentName, createAgentHandlerImpl(nextAgentName), uiAPI);
        } else {
            // halt or repair_plan — stay with Engineer for manual recovery
            const reason = executionDecision.payload?.reason || "unknown";
            await recordWorkflowMetricImpl({
                category: "execution",
                event: "feature_project_outcome",
                agentName: AGENTS.ENGINEER,
                planName,
                details: {
                    routingIntent: normalizedTriage.routingIntent,
                    outcome: "execution_halted",
                    executionDecisionKind: executionDecision.kind,
                    hasReason: Boolean(reason),
                },
            });
            uiAPI.appendSystemMessage(
                `Execution stopped: ${reason}. Staying with Engineer for manual intervention.`,
                true,
                "RunWield",
            );
            setActiveAgentImpl(hostedSession, AGENTS.ENGINEER, createAgentHandlerImpl(AGENTS.ENGINEER), uiAPI);
        }
    }
}
