import { AGENTS, SUBAGENTS } from "../../../constants.js";
import { resolvePlanExecutionRuntimeAgent } from "../../workflow/execution-agent.ts";
import { runActiveAgentTurn } from ".././agent-switching.js";
import { emitSystemStatus, RuntimeEventTypes } from ".././session-runtime-events.js";
import { readPersistedPendingSegmentContinuationEntry } from ".././workflow-context-session.js";
import { executePlanAction } from "../../workflow/plan-actions.ts";

import { buildSemanticRepairCiState, isRuntimeRootSessionManager } from "./support.ts";

import type { RuntimeServices } from "./base.ts";
import { isManagedOperationFailure } from "./types.ts";
import type { RuntimeEvents } from "./events.ts";
import type { RuntimeLifecycle } from "./lifecycle.ts";
import type { RuntimeManagedOperations } from "./managed-operations.ts";
import type { RuntimeQueues } from "./queues.ts";
import type { RuntimeReads } from "./reads.ts";
import type { RuntimeAgentSettings } from "./agent-settings.ts";
import type { RuntimeManagedSync } from "./managed-sync.ts";
import type { RuntimeTurns } from "./turns.ts";

interface RuntimeTriageFields {
    status?: string | null;
    classification?: string | null;
    planId?: string | null;
    planName?: string | null;
    revision?: string | null;
    executionAgent?: string | null;
    parentPlan?: string | null;
    routingIntent?: string | null;
    complexity?: string | null;
    validationCiAttempts?: number;
    validationSemanticRounds?: number;
    worktree?: import("../../workflow/plan-actions.ts").PlanWorktreeExpectation;
}
type RuntimePersistedTriageInput =
    & Omit<import("../../../plan-store.js").PlanFrontMatter, "status" | "executionAgent">
    & {
        status?: string;
        worktree?: import("../../workflow/plan-actions.ts").PlanWorktreeExpectation;
    };
type RuntimeTriageInput =
    | RuntimeTriageFields
    | RuntimePersistedTriageInput
    | import("../../../tools/plan-written.ts").TriageMeta
    | import("../../../plan-store.js").PlanFrontMatter;
type RuntimeExecutePlanOptions =
    & Partial<
        Omit<
            import("../../workflow/plan-executor.ts").ExecutePlanOptions,
            "hostedSession" | "triageMeta"
        >
    >
    & {
        triageMeta?: RuntimeTriageInput;
        expectedGeneration?: number;
        initialRequest?: string;
        planContent?: string;
    };
type RuntimePlanningOptions =
    & Partial<
        Omit<
            import("../../workflow/planning-agent.ts").RunPlanningAgentOptions,
            "hostedSession" | "sessionManager" | "triageMeta"
        >
    >
    & { triageMeta?: RuntimeTriageInput };
type RuntimeSlicerOptions = Partial<
    Omit<
        import("../../workflow/workflow-slicer.ts").RunSlicerAgentOptions,
        "hostedSession" | "sessionManager"
    >
>;
type RuntimeValidationOptions =
    & Partial<
        Omit<
            import("../../workflow/validation-supervisor.ts").ContinueWorkflowValidationArgs,
            | "triageMeta"
            | "hostedSession"
            | "sessionManager"
            | "git"
            | "semanticReviewPort"
            | "localCI"
            | "workRecordMnemotecaPort"
            | "supportsSemanticRepairHandoff"
        >
    >
    & {
        triageMeta?: RuntimeTriageInput;
        expectedGeneration?: number;
        skipPendingSegmentResume?: boolean;
    };
type RuntimeWorkflowOptions =
    | RuntimeExecutePlanOptions
    | RuntimePlanningOptions
    | RuntimeSlicerOptions
    | RuntimeValidationOptions;
type WorkflowValidationResult = import("../../workflow/validation.ts").WorkflowValidationResult;
interface SemanticRepairHandoffResult {
    kind: "semantic_repair_handoff";
    planName?: string;
    projectRoot?: string;
    semanticRepairHandoff: NonNullable<WorkflowValidationResult["semanticRepairHandoff"]>;
}
type SemanticRepairContinuation =
    & Omit<
        import("../../workflow/execution-segment-handoff.ts").SemanticRepairSegmentContinuation,
        "activeWorkflow"
    >
    & { activeWorkflow: import("../hosted-session.js").ActiveExecutionWorkflow };
interface RuntimeSemanticRepairOptions {
    planName: string;
    planContent?: string;
    triageMeta?: import("../../../tools/plan-written.ts").TriageMeta;
}
interface SemanticRepairOutcome {
    kind: string;
    planName: string;
    projectRoot: string;
    reason?: string;
}
type PlanExecutionResult = Awaited<ReturnType<typeof import("../../workflow/workflow.js").executePlan>>;
export interface RuntimeValidationResult {
    kind?: string;
    ok?: boolean;
    error?: string;
    planName?: string;
    projectRoot?: string;
    reason?: string;
    executionComplete?: boolean;
    executionContext?: import("../hosted-session.js").ActiveExecutionWorkflow;
    executionSegmentHandoff?: import("../../workflow/execution-segment-handoff.ts").ExecutionSegmentContinuation;
    epicContinuation?: NonNullable<WorkflowValidationResult["epicContinuation"]>;
    semanticRepairHandoff?: WorkflowValidationResult["semanticRepairHandoff"];
}

function isValidationTriageMeta(
    value: RuntimeTriageInput,
): value is import("../../../tools/plan-written.ts").TriageMeta {
    const classifications = new Set(["QUICK_FIX", "PLANNED_CHANGE", "FEATURE", "PROJECT"]);
    const complexities = new Set(["LOW", "MEDIUM", "HIGH"]);
    const statuses = new Set([
        "approved",
        "draft",
        "feedback",
        "ready_for_decomposition",
        "ready_for_work",
        "in_progress",
        "failed",
        "implemented",
        "validated_ci",
        "validated_reviewer",
        "validated",
        "blocked",
        "canceled",
        "abandoned",
        "superseded",
    ]);
    const executionAgents = new Set(["engineer", "frontend-engineer"]);
    return value.planId !== null && value.parentPlan !== null &&
        (value.classification === undefined ||
            (value.classification !== null && classifications.has(value.classification))) &&
        (value.complexity === undefined || (value.complexity !== null && complexities.has(value.complexity))) &&
        (value.status === undefined || (value.status !== null && statuses.has(value.status))) &&
        (!("executionAgent" in value) || value.executionAgent === undefined ||
            (typeof value.executionAgent === "string" && executionAgents.has(value.executionAgent)));
}

type RuntimeEventsDependency = Pick<RuntimeEvents, "emitSessionEvent" | "runBusyOperation">;
type RuntimeLifecycleDependency = Pick<
    RuntimeLifecycle,
    "closeSession" | "createInteractiveSession" | "materializeDeferredWorkflowSession"
>;
type RuntimeManagedOperationsDependency = Pick<
    RuntimeManagedOperations,
    | "awaitSettlement"
    | "currentCapability"
    | "hasOperation"
    | "isCurrentContext"
    | "runManagedOperation"
    | "runManagedStandaloneMutation"
>;
type RuntimeQueuesDependency = Pick<RuntimeQueues, "removeAllQueueSourceSubscriptions">;
type RuntimeReadsDependency = Pick<RuntimeReads, "getSessionSnapshot">;
type RuntimeAgentSettingsDependency = Pick<RuntimeAgentSettings, "activateSessionAgent" | "renameSession">;
type RuntimeManagedSyncDependency = Pick<
    RuntimeManagedSync,
    "ensureInitialSessionGeneration" | "synchronizeManagedSession"
>;
type RuntimeTurnsDependency = Pick<RuntimeTurns, "rollManagedSessionSegment">;

export class RuntimeWorkflows {
    private events!: RuntimeEventsDependency;
    private lifecycle!: RuntimeLifecycleDependency;
    private managedOperations!: RuntimeManagedOperationsDependency;
    private queues!: RuntimeQueuesDependency;
    private reads!: RuntimeReadsDependency;
    private settings!: RuntimeAgentSettingsDependency;
    private sync!: RuntimeManagedSyncDependency;
    private turns!: RuntimeTurnsDependency;

    constructor(private readonly services: RuntimeServices) {}

    connect(
        events: RuntimeEventsDependency,
        lifecycle: RuntimeLifecycleDependency,
        managedOperations: RuntimeManagedOperationsDependency,
        queues: RuntimeQueuesDependency,
        reads: RuntimeReadsDependency,
        settings: RuntimeAgentSettingsDependency,
        sync: RuntimeManagedSyncDependency,
        turns: RuntimeTurnsDependency,
    ) {
        this.events = events;
        this.lifecycle = lifecycle;
        this.managedOperations = managedOperations;
        this.queues = queues;
        this.reads = reads;
        this.settings = settings;
        this.sync = sync;
        this.turns = turns;
    }
    async runWorkflowOperation<T>(
        session: import(".././hosted-session.js").HostedSession,
        _operationName: string,
        options: RuntimeWorkflowOptions,
        operation: () => Promise<T>,
    ): Promise<T> {
        await this.lifecycle.materializeDeferredWorkflowSession(session);
        const managed = session.getManagedMetadata?.();
        if (!managed) {
            return await this.events.runBusyOperation(session.id, operation);
        }
        const currentCapability = this.managedOperations.currentCapability(session.id);
        if (currentCapability) {
            if (this.managedOperations.isCurrentContext(session.id, currentCapability)) {
                return await this.events.runBusyOperation(session.id, operation);
            }
            await this.managedOperations.awaitSettlement(session.id);
            return await this.runWorkflowOperation(session, _operationName, options, operation);
        }
        await this.restoreDormantManagedInvariant(session);
        if (session.getRootSessionManager?.()) {
            throw new Error("managed_operation_in_progress");
        }
        const result = await this.managedOperations.runManagedOperation(
            session.id,
            {
                name: "workflow_operation",
                emitPromptEvents: false,
                options: {
                    ...options,
                    expectedGeneration: managed.generation ?? undefined,
                },
                activateAgent: true,
            },
            async () => await operation(),
        );
        if (isManagedOperationFailure(result)) throw new Error(result.error);
        return result;
    }

    async runPlanAction(
        sessionId: string,
        request: import("../../workflow/plan-actions.ts").PlanActionRequest,
    ): Promise<import("../../workflow/plan-actions.ts").PlanActionResult> {
        const session = this.services.sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runPlanAction: session not found");
        const managed = session.getManagedMetadata?.();
        if (!managed) return await executePlanAction(session.cwd, request);
        await this.restoreDormantManagedInvariant(session);
        if (session.getRootSessionManager?.()) throw new Error("managed_operation_in_progress");
        const result = await this.managedOperations.runManagedOperation(
            session.id,
            {
                name: "workflow_operation",
                options: { expectedGeneration: managed.generation ?? undefined },
                activateAgent: false,
                hydrate: false,
                emitPromptEvents: false,
            },
            async () => await executePlanAction(session.cwd, request),
        );
        if (isManagedOperationFailure(result) && result.error === "refresh_required") {
            return {
                kind: "refresh_required",
                message: "Session generation changed. Refresh and retry.",
                evidence: {
                    planId: request.planId,
                    planName: "",
                    revision: request.expectedRevision,
                    status: request.expectedStatus,
                    worktree: request.expectedWorktree,
                },
            };
        }
        if (isManagedOperationFailure(result) && result.error === "managed_operation_in_progress") {
            return {
                kind: "activation_unavailable",
                message: "Session activation is not available for this Plan action.",
            };
        }
        if (isManagedOperationFailure(result)) throw new Error(result.error);
        return result;
    }

    async restoreDormantManagedInvariant(session: import(".././hosted-session.js").HostedSession) {
        const managed = session.getManagedMetadata?.();
        if (
            !managed ||
            !session.getRootSessionManager?.() ||
            this.managedOperations.hasOperation(session.id) ||
            session.isTurnActive()
        ) return false;
        const activation = this.services.sessionStore?.inspectSessionActivation(managed.runwieldSessionId);
        if (activation?.activation?.state === "active") return false;
        console.error("[RunWield] recovered_orphaned_managed_hydration");
        session.dehydrateManagedSession();
        this.queues.removeAllQueueSourceSubscriptions(session.id);
        await this.sync.ensureInitialSessionGeneration(managed.runwieldSessionId);
        await this.sync.synchronizeManagedSession(session.id, { emitEvents: false });
        return true;
    }

    async executePlan(
        sessionId: string,
        options: RuntimeExecutePlanOptions,
    ): Promise<RuntimeValidationResult> {
        const session = this.services.sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.executePlan: session not found");
        return await this.events.runBusyOperation(sessionId, async () => {
            await this.lifecycle.materializeDeferredWorkflowSession(session);
            const managed = session.getManagedMetadata?.();
            if (!managed) {
                return await this.runWorkflowOperation(session, "executePlan", options, async () => {
                    const { executePlan } = await import("../../workflow/workflow.js");
                    return await executePlan({ ...options, hostedSession: session });
                });
            }
            const pendingResult = await this.resumePendingExecutionSegmentHandoff(session, options);
            if (pendingResult) return pendingResult;
            const prepared = await this.runWorkflowOperation(session, "prepareExecutePlan", options, async () => {
                const { executePlan } = await import("../../workflow/workflow.js");
                return await executePlan(
                    {
                        ...options,
                        hostedSession: session,
                        prepareSegmentHandoff: true,
                    },
                );
            });
            if (!prepared?.executionSegmentHandoff) {
                if (prepared?.error) {
                    console.error("[RunWield] execution_handoff_preparation_failed", prepared.error);
                }
                return prepared;
            }
            const latestManaged = session.getManagedMetadata?.() || managed;
            await this.turns.rollManagedSessionSegment(sessionId, {
                kind: "execution",
                continuation: prepared.executionSegmentHandoff,
                expectedGeneration: latestManaged.generation,
            });
            return await this.resumePendingExecutionSegmentHandoff(session, options) || prepared;
        });
    }

    async resumePendingExecutionSegmentHandoff(
        session: import(".././hosted-session.js").HostedSession,
        options: RuntimeExecutePlanOptions,
    ): Promise<RuntimeValidationResult | null> {
        const managed = session.getManagedMetadata?.();
        if (!managed) return null;
        return await this.managedOperations.runManagedStandaloneMutation(
            session.id,
            "workflow_operation",
            async (activeSession) => {
                const manager = activeSession.getRootSessionManager?.();
                const marker = isRuntimeRootSessionManager(manager)
                    ? readPersistedPendingSegmentContinuationEntry(manager)
                    : null;
                const { resolvePendingSegmentHandoff } = await import("../../workflow/execution-segment-handoff.ts");
                const resolved = await resolvePendingSegmentHandoff({
                    marker: marker,
                    projectRoot: activeSession.cwd,
                    runwieldSessionId: managed.runwieldSessionId,
                });
                if (resolved.kind === "absent" || resolved.kind === "consumed") return null;
                if (resolved.kind === "refresh_required" || resolved.kind === "recovery_required") {
                    throw new Error(resolved.message);
                }
                if (resolved.continuation.kind === "semantic_repair") {
                    const activeWorkflow = resolved.continuation.activeWorkflow;
                    return await this.runSemanticRepairContinuation(
                        activeSession.id,
                        activeSession,
                        {
                            planName: options.planName || resolved.continuation.plan.planName,
                            planContent: options.planContent,
                            triageMeta: activeWorkflow.triageMeta,
                        },
                        resolved.continuation,
                        true,
                    );
                }
                const { executePreparedPlanSegmentHandoff } = await import("../../workflow/workflow.js");
                return await executePreparedPlanSegmentHandoff(
                    {
                        continuation: resolved.continuation,
                        hostedSession: activeSession,
                    },
                );
            },
            { activateAgent: false },
        );
    }

    async runPlanningAgent(sessionId: string, options: RuntimePlanningOptions) {
        const session = this.services.sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runPlanningAgent: session not found");
        return await this.runWorkflowOperation(session, "runPlanningAgent", options, async () => {
            const { runPlanningAgent } = await import("../../workflow/workflow.js");
            const manager = session.getRootSessionManager();
            return await runPlanningAgent({
                ...options,
                hostedSession: session,
                sessionManager: isRuntimeRootSessionManager(manager) ? manager : undefined,
            });
        });
    }

    async runSlicerAgent(sessionId: string, options: RuntimeSlicerOptions) {
        const session = this.services.sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runSlicerAgent: session not found");
        if (!options.planName) throw new Error("SessionRuntime.runSlicerAgent: Plan name is required");
        const planName = options.planName;
        return await this.runWorkflowOperation(session, "runSlicerAgent", options, async () => {
            const { runSlicerAgent } = await import("../../workflow/workflow-slicer.ts");
            const manager = session.getRootSessionManager();
            return await runSlicerAgent({
                ...options,
                planName,
                hostedSession: session,
                sessionManager: isRuntimeRootSessionManager(manager) ? manager : undefined,
            });
        });
    }

    async runValidation(
        sessionId: string,
        options: RuntimeValidationOptions,
    ): Promise<RuntimeValidationResult | null> {
        const session = this.services.sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runValidation: session not found");
        if (
            !options.planName || !options.planContent || !options.triageMeta ||
            !isValidationTriageMeta(options.triageMeta)
        ) {
            throw new Error("SessionRuntime.runValidation: Plan context is required");
        }
        const planName = options.planName;
        const planContent = options.planContent;
        const triageMeta = options.triageMeta;
        if (options.skipPendingSegmentResume !== true) {
            const pendingResult = await this.resumePendingExecutionSegmentHandoff(session, options);
            if (pendingResult) return pendingResult;
        }
        const result = await this.runWorkflowOperation(session, "runValidation", options, async () => {
            const { SYSTEM_SEMANTIC_REVIEW_PORT } = await import("../../workflow/validation.ts");
            const { runWorkflowValidationToStableBoundary } = await import(
                "../../workflow/validation-supervisor.ts"
            );
            const { createGitPort } = await import("../../git-port.ts");
            const { systemLocalCIPort } = await import("../../workflow/validation-local-ci.ts");
            const { SYSTEM_WORK_RECORD_MNEMOTECA_PORT } = await import("../../work-records/mnemoteca-port.ts");
            const validationPorts = {
                git: createGitPort(),
                localCI: systemLocalCIPort,
                workRecordMnemotecaPort: SYSTEM_WORK_RECORD_MNEMOTECA_PORT,
            };
            const latestResult = await runWorkflowValidationToStableBoundary(
                {
                    ...options,
                    planName,
                    planContent,
                    triageMeta,
                    hostedSession: session,
                    ...validationPorts,
                    semanticReviewPort: SYSTEM_SEMANTIC_REVIEW_PORT,
                    supportsSemanticRepairHandoff: true,
                },
            );
            return latestResult;
        });
        if (result.kind === "semantic_repair_handoff" && result.semanticRepairHandoff) {
            return await this.runSemanticRepairSegmentHandoff(
                sessionId,
                { ...options, planName, triageMeta },
                { ...result, kind: "semantic_repair_handoff", semanticRepairHandoff: result.semanticRepairHandoff },
            );
        }
        await this.continueEpicAfterValidation(session, result);
        return result;
    }

    async runSemanticRepairSegmentHandoff(
        sessionId: string,
        options: RuntimeSemanticRepairOptions,
        validationResult: SemanticRepairHandoffResult,
    ): Promise<RuntimeValidationResult | null> {
        const session = this.services.sessionHost.getSession(sessionId);
        if (!session) throw new Error("SessionRuntime.runSemanticRepairSegmentHandoff: session not found");
        const managed = session.getManagedMetadata?.();
        const activeWorkflow = session.getActiveExecutionWorkflow?.() || null;
        if (!activeWorkflow) throw new Error("Semantic repair handoff requires an active execution workflow.");
        const workflow = {
            ...activeWorkflow,
            ...validationResult.semanticRepairHandoff.activeWorkflow,
        };
        const { loadPlanActionEvidence } = await import("../../workflow/plan-actions.ts");
        const { getPlanRevisionForText } = await import("../../../plan-store.js");
        const { buildSemanticRepairSegmentContinuation } = await import("../../workflow/execution-segment-handoff.ts");
        const planId = workflow.triageMeta?.planId || options.triageMeta?.planId;
        if (!planId) throw new Error("Semantic repair handoff requires Plan identity.");
        const evidence = await loadPlanActionEvidence(workflow.projectRoot || session.cwd, planId);
        if (evidence.kind !== "success") throw new Error(evidence.message);
        const handoff = validationResult.semanticRepairHandoff;
        const builtContinuation = buildSemanticRepairSegmentContinuation({
            runwieldSessionId: managed?.runwieldSessionId || session.id,
            planId,
            planName: options.planName,
            approvedRevision: await getPlanRevisionForText(options.planContent || ""),
            approvedStatus: workflow.triageMeta?.status || "implemented",
            approvedMarkdown: options.planContent || "",
            preparedEvidence: evidence.evidence,
            activeWorkflow: { ...workflow, ...handoff.activeWorkflow },
            // The handoff names the Agent that resumes the repair; `activeWorkflow`
            // above still carries the canonical `engineer` owner.
            executionOwner: resolvePlanExecutionRuntimeAgent(workflow.executionAgent),
            semanticRound: handoff.semanticRound,
            repairGeneration: handoff.repairGeneration,
            reviewLedger: handoff.reviewLedger,
            repairBaselineTree: handoff.repairBaselineTree,
            lastRepairReport: handoff.lastRepairReport,
            executionState: {
                ...(workflow.executionCwd ? { executionCwd: workflow.executionCwd } : {}),
                ...(workflow.baselineTree ? { baselineTree: workflow.baselineTree } : {}),
            },
            ciState: buildSemanticRepairCiState(options, workflow, handoff),
            priorRepairClaims: workflow.lastRepairReport ? [workflow.lastRepairReport] : [],
            diffText: handoff.diffText,
            findingsSection: handoff.findingsSection,
        });
        const continuation: SemanticRepairContinuation = {
            ...builtContinuation,
            activeWorkflow: workflow,
        };
        if (managed) {
            const latestManaged = session.getManagedMetadata?.() || managed;
            await this.turns.rollManagedSessionSegment(sessionId, {
                kind: "semantic_repair",
                transcriptCwd: workflow.executionCwd,
                continuation,
                expectedGeneration: latestManaged.generation,
            });
        }
        return await this.runSemanticRepairContinuation(sessionId, session, options, continuation);
    }

    async runSemanticRepairContinuation(
        sessionId: string,
        session: import(".././hosted-session.js").HostedSession,
        options: RuntimeSemanticRepairOptions,
        continuation: SemanticRepairContinuation,
        alreadyManaged: boolean = false,
    ): Promise<RuntimeValidationResult | null> {
        const workflow = continuation.activeWorkflow || {};
        const projectRoot = workflow.projectRoot || session.cwd;
        const executionCwd = workflow.executionCwd || session.cwd;
        const runRepair = async () => {
            const planId = continuation.plan?.planId || workflow.triageMeta?.planId || options.triageMeta?.planId;
            const planName = continuation.plan?.planName || options.planName;
            if (planId && planName && session.getManagedOperationCapability?.()) {
                session.recordPlanAssociation({ planId, planName, purpose: "recovery" });
            }
            session.setActiveExecutionWorkflow(continuation.activeWorkflow);
            const { buildValidationRepairPrompt } = await import("../../workflow/validation-repair-prompt.ts");
            const { getWorktreeReviewDiff } = await import("../../workflow/git-snapshot.js");
            const { createReviewDiffTool, buildDiffInspectionSection } = await import(
                "../../workflow/review-diff-tool.js"
            );
            const { acknowledgeTaskCompletion, claimPendingTaskCompletion } = await import(
                "../task-completion-session.ts"
            );
            const diffText = workflow.executionMode === "non_git_in_place" || workflow.nonGitInPlace
                ? continuation.repair.diffText
                : await getWorktreeReviewDiff(executionCwd, workflow.worktreeBaseBranch || "");
            await runActiveAgentTurn({
                hostedSession: session,
                agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
                userRequest: buildValidationRepairPrompt({
                    executionCwd,
                    repairCwd: executionCwd,
                    worktreeId: workflow.worktreeId,
                    worktreeBranch: workflow.worktreeBranch,
                    worktreeBaseBranch: workflow.worktreeBaseBranch,
                    ciStateSummary: JSON.stringify(continuation.repair.ciState),
                    authorityNote: "A code reviewer found these issues. Fix every finding.",
                    repairsNeeded: [
                        " Findings",
                        "",
                        continuation.repair.findingsSection || "(no findings text supplied)",
                        "",
                        buildDiffInspectionSection(diffText),
                    ].join("\n"),
                    completionInstruction:
                        "Report a disposition for every finding, then call task_completed. If a finding is still open because something blocked you, stop in plain text instead and name it.",
                }),
                cwd: executionCwd,
                dispatchKind: "validation_repair",
                subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
                customTools: [createReviewDiffTool({ full: diffText }, { hostedSession: session })],
            });
            const acceptedCompletion = claimPendingTaskCompletion(session, null);
            const completed = Boolean(acceptedCompletion);
            const report = acceptedCompletion?.report || "";
            if (acceptedCompletion) acknowledgeTaskCompletion(session, acceptedCompletion);
            session.setActiveExecutionWorkflow(
                {
                    ...continuation.activeWorkflow,
                    lastRepairReport: report,
                },
            );
            if (!completed) {
                return {
                    kind: "paused",
                    planName: continuation.plan.planName || options.planName,
                    projectRoot,
                    reason: "Semantic repair segment paused before task_completed.",
                };
            }
            const { recordValidationRepairCompletion } = await import(
                "../../workflow/validation-supervisor.ts"
            );
            await recordValidationRepairCompletion({
                projectRoot: executionCwd,
                planName: continuation.plan.planName,
                repairGeneration: continuation.repair.repairGeneration,
                report,
            });
            return {
                kind: "semantic_repair_completed",
                planName: continuation.plan.planName || options.planName,
                projectRoot,
            };
        };
        const repairResult = alreadyManaged
            ? await runRepair()
            : await this.runWorkflowOperation(session, "semanticRepairSegment", options, runRepair);
        if (repairResult?.kind === "semantic_repair_completed") {
            const { loadPlan } = await import("../../../plan-store.js");
            const completedPlan = await loadPlan(
                executionCwd,
                continuation.plan.planName || options.planName,
            );
            if (!completedPlan) throw new Error("Completed semantic repair Plan is unavailable.");
            const refreshedWorkflow = {
                ...(session.getActiveExecutionWorkflow?.() || continuation.activeWorkflow),
                triageMeta: {
                    ...(continuation.activeWorkflow?.triageMeta || options.triageMeta),
                    ...completedPlan.attrs,
                    revision: completedPlan.revision,
                },
            };
            session.setActiveExecutionWorkflow(refreshedWorkflow);
            return await this.runValidation(sessionId, {
                ...options,
                planName: continuation.plan.planName || options.planName,
                planContent: completedPlan.markdown || options.planContent,
                triageMeta: refreshedWorkflow.triageMeta,
                executionContext: refreshedWorkflow,
                trigger: "repair",
                taskCompletionId: continuation.repair.repairGeneration,
                skipPendingSegmentResume: true,
            });
        }
        return repairResult;
    }

    async continueEpicAfterValidation(
        oldSession: import(".././hosted-session.js").HostedSession,
        validationResult: RuntimeValidationResult | undefined | null,
    ): Promise<{ replaced: boolean; sessionId?: string }> {
        let currentContinuation = validationResult?.epicContinuation || null;
        if (!currentContinuation) return { replaced: false };
        let currentOldSession = oldSession;
        let latestSessionId;
        while (currentContinuation) {
            const { resolveEpicContinuation, runEpicChildContinuation } = await import(
                "../../workflow/epic-continuation.ts"
            );
            const resolution: import("../../workflow/epic-continuation.ts").EpicContinuationResolution =
                currentContinuation.resolution || await resolveEpicContinuation({
                    cwd: currentContinuation.projectRoot,
                    completedPlanName: currentContinuation.completedPlanName,
                });
            if (
                !["plan", "readiness_execute", "execute"].includes(resolution.kind) || !resolution.childPlanName ||
                !resolution.parentPlanName
            ) {
                const message = resolution.kind === "blocked"
                    ? `Epic continuation stopped at ${resolution.childPlanName || "next child"}: ${
                        resolution.reason || "blocked"
                    }.`
                    : `Epic continuation complete: ${resolution.reason || "no remaining work"}.`;
                emitSystemStatus(currentOldSession, message, {
                    level: resolution.kind === "blocked" ? "warning" : "success",
                    header: "RunWield",
                });
                return { replaced: Boolean(latestSessionId), sessionId: latestSessionId };
            }
            const action = resolution.kind;

            const adapter = currentOldSession.getInteractionAdapter();
            const created = await this.lifecycle.createInteractiveSession({
                cwd: currentContinuation.projectRoot,
                mode: "new",
                deferManagedActivationUntilAgentReady: true,
            });
            const newSessionId = created.sessionId;
            const newSession = this.services.sessionHost.getSession(newSessionId);
            if (!newSession) throw new Error("Epic continuation replacement session was not retained");
            try {
                newSession.notificationSurface = currentOldSession.notificationSurface;
                newSession.localInputSurface = currentOldSession.localInputSurface;
                newSession.setInteractionAdapter(adapter);
                await this.settings.activateSessionAgent(newSession, {
                    agentName: action === "plan" ? AGENTS.PLANNER : AGENTS.ENGINEER,
                    mcpRootTools: currentOldSession.getMcpRootTools?.() || [],
                });
                await this.settings.renameSession(newSessionId, `Epic child: ${resolution.childPlanName}`);
                currentOldSession.moveMcpStateTo?.(newSession);
            } catch (error) {
                await this.lifecycle.closeSession(newSessionId);
                throw error;
            }
            this.events.emitSessionEvent(currentOldSession.id, {
                type: RuntimeEventTypes.SESSION_REPLACED,
                oldSessionId: currentOldSession.id,
                newSessionId,
                reason: "epic_continuation",
                parentPlanName: resolution.parentPlanName,
                completedPlanName: resolution.completedPlanName,
                childPlanName: resolution.childPlanName,
                action,
            });
            await this.lifecycle.closeSession(currentOldSession.id);
            latestSessionId = newSessionId;
            const nextManaged = newSession.getManagedMetadata?.();
            if (!nextManaged) throw new Error("Epic continuation destination is not managed");
            const nextManager = newSession.getRootSessionManager();
            const nextResult:
                | Awaited<ReturnType<typeof runEpicChildContinuation>>
                | import("./types.ts").ManagedOperationRunFailure = await this.managedOperations.runManagedOperation(
                    newSessionId,
                    {
                        name: "workflow_operation",
                        options: { expectedGeneration: nextManaged.generation ?? undefined },
                        activateAgent: true,
                    },
                    async () =>
                        await runEpicChildContinuation({
                            hostedSession: newSession,
                            resolution,
                            sessionManager: isRuntimeRootSessionManager(nextManager) ? nextManager : undefined,
                        }),
                );
            if (isManagedOperationFailure(nextResult)) throw new Error(nextResult.error);
            currentContinuation = nextResult?.epicContinuation || null;
            currentOldSession = newSession;
        }
        return { replaced: Boolean(latestSessionId), sessionId: latestSessionId };
    }

    async recordPlanAssociation(
        sessionId: string,
        entry: { planId: string; planName: string; purpose: import(".././plan-association.ts").AssociationPurpose },
    ) {
        try {
            const before = this.reads.getSessionSnapshot(sessionId)?.managed?.generation ?? null;
            const result = await this.managedOperations.runManagedStandaloneMutation(
                sessionId,
                "workflow_operation",
                (session, capability) => {
                    const association = session.recordPlanAssociation(entry);
                    return {
                        ok: true,
                        association,
                        committedGeneration: capability ? null : null,
                        operationId: capability?.operationId || null,
                    };
                },
                { activateAgent: false },
            );
            if (result?.ok === false) return result;
            const after = this.reads.getSessionSnapshot(sessionId)?.managed?.generation ?? null;
            return {
                ...result,
                committedGeneration: before === after ? null : after,
            };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
}
