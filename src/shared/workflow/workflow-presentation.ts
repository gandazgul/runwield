export type WorkflowPresentationStepState =
    | "completed"
    | "current"
    | "upcoming"
    | "blocked"
    | "paused"
    | "skipped"
    | "unavailable";

export type WorkflowPresentationActionKind =
    | "open_plan"
    | "open_session"
    | "review_plan"
    | "review_code"
    | "answer_agent"
    | "run"
    | "resume"
    | "recover";

export interface WorkflowProgressFact {
    kind: "validation_checkpoint" | "publication" | "registry" | "session";
    phase?: string | null;
    state?: string | null;
    status?: string | null;
    repairKind?: string | null;
    updatedAt?: string | null;
    failure?: boolean | null;
}

export interface WorkflowPresentationInput {
    planName?: string | null;
    epicName?: string | null;
    intent?: string | null;
    classification?: string | null;
    projectPlanType?: string | null;
    status?: string | null;
    progressFacts?: WorkflowProgressFact[];
    degradedMessage?: string | null;
    sessionState?: string | null;
    hasWorkingSession?: boolean;
    hasLiveQuestion?: boolean;
    hasPlanReview?: boolean;
    hasCodeReview?: boolean;
    canRun?: boolean;
    canResume?: boolean;
    canRecover?: boolean;
}

export interface WorkflowPresentationStage {
    id: string;
    label: string;
    state: WorkflowPresentationStepState;
    detail: string;
    current: boolean;
}

export interface WorkflowPresentationAction {
    kind: WorkflowPresentationActionKind;
    label: string;
    detail: string;
}

export interface WorkflowPresentationConnection {
    from: string;
    to: string;
    kind: "forward" | "repair_return";
}

export interface WorkflowPresentation {
    active: boolean;
    epic: string | null;
    plan: string;
    intent: string;
    stages: WorkflowPresentationStage[];
    connections: WorkflowPresentationConnection[];
    currentStage: WorkflowPresentationStage | null;
    blocker: string | null;
    action: WorkflowPresentationAction | null;
}

type StageDefinition = { id: string; label: string };

const EXECUTABLE_STAGES: StageDefinition[] = [
    { id: "planning", label: "Planning" },
    { id: "execution", label: "Execution" },
    { id: "mechanical", label: "Tests and CI" },
    { id: "semantic", label: "AI review" },
    { id: "repair", label: "Repair" },
    { id: "delivery", label: "Delivery" },
    { id: "completion", label: "Completion" },
];

const CONTAINER_STAGES: StageDefinition[] = [
    { id: "review", label: "Review" },
    { id: "decomposition", label: "Decomposition" },
    { id: "child_work", label: "Child work" },
    { id: "completion", label: "Completion" },
];

const ACTIVE_STATES = new Set(["running"]);
const BLOCKED_STATES = new Set(["needs_attention", "failed"]);
const PAUSED_STATES = new Set(["paused"]);
const DONE_STATES = new Set(["passed", "completed"]);
const SKIPPED_STATES = new Set(["not_required", "skipped"]);

function clean(value?: string | null): string {
    return typeof value === "string" ? value.trim() : "";
}

function isProject(input: WorkflowPresentationInput): boolean {
    return clean(input.classification) === "PROJECT";
}

function stageDefinitions(input: WorkflowPresentationInput): StageDefinition[] {
    return isProject(input) ? CONTAINER_STAGES : EXECUTABLE_STAGES;
}

function connectionDefinitions(stages: StageDefinition[], repairTarget: string): WorkflowPresentationConnection[] {
    const forward = stages.slice(0, -1).map((stage, index) => ({
        from: stage.id,
        to: stages[index + 1].id,
        kind: "forward" as const,
    }));
    return stages.some((stage) => stage.id === "repair") && repairTarget
        ? [...forward, { from: "repair", to: repairTarget, kind: "repair_return" as const }]
        : forward;
}

function stateFromRaw(raw: string, isCurrent: boolean): WorkflowPresentationStepState {
    if (BLOCKED_STATES.has(raw)) return "blocked";
    if (PAUSED_STATES.has(raw)) return "paused";
    if (ACTIVE_STATES.has(raw)) return "current";
    if (DONE_STATES.has(raw)) return "completed";
    if (SKIPPED_STATES.has(raw)) return "skipped";
    if (raw === "unknown") return "unavailable";
    return isCurrent ? "current" : "upcoming";
}

function baseStates(input: WorkflowPresentationInput, stages: StageDefinition[]): Map<string, string> {
    const status = clean(input.status).toLowerCase();
    const states = new Map(stages.map((stage) => [stage.id, "pending"]));
    if (states.has("repair")) states.set("repair", "not_required");
    if (isProject(input)) {
        if (status === "feedback" || status === "failed") states.set("review", "needs_attention");
        else if (status === "ready_for_decomposition") states.set("decomposition", "running");
        else if (status === "ready_for_work" || status === "in_progress") {
            states.set("review", "completed");
            states.set("decomposition", "completed");
            states.set("child_work", "running");
        } else if (["validated", "verified", "user_verified", "closed_without_verification"].includes(status)) {
            for (const stage of stages) states.set(stage.id, "completed");
        } else states.set("review", "running");
        return states;
    }

    if (status === "feedback" || status === "failed") states.set("planning", "needs_attention");
    else if (status === "ready_for_work") states.set("execution", "pending");
    else if (status === "in_progress") states.set("execution", "running");
    else if (status === "implemented") {
        states.set("execution", "completed");
        states.set("mechanical", "running");
    } else if (status === "validated_ci") {
        states.set("execution", "completed");
        states.set("mechanical", "completed");
        states.set("semantic", "running");
    } else if (status === "validated_reviewer") {
        states.set("execution", "completed");
        states.set("mechanical", "completed");
        states.set("semantic", "completed");
        states.set("delivery", "running");
    } else if (status === "validated") {
        states.set("execution", "completed");
        states.set("mechanical", "completed");
        states.set("semantic", "completed");
        states.set("delivery", "running");
    } else if (["verified", "user_verified", "closed_without_verification"].includes(status)) {
        for (const stage of stages) states.set(stage.id, stage.id === "repair" ? "not_required" : "completed");
    } else states.set("planning", "running");
    return states;
}

function stageForValidationPhase(phase: string): string {
    if (phase === "mechanical") return "mechanical";
    if (phase === "semantic") return "semantic";
    if (phase === "delivery") return "delivery";
    return "";
}

function stageStateFromCheckpoint(state: string): string {
    if (state === "awaiting_repair") return "needs_attention";
    if (state === "paused") return "paused";
    if (state === "ready" || state === "running") return "running";
    return "pending";
}

function mergedRawStates(input: WorkflowPresentationInput, stages: StageDefinition[]): Map<string, string> {
    const states = baseStates(input, stages);
    for (const fact of input.progressFacts || []) {
        const kind = clean(fact.kind);
        const phase = clean(fact.phase);
        if (kind === "validation_checkpoint") {
            const stageId = stageForValidationPhase(phase);
            if (stageId && states.has(stageId)) states.set(stageId, stageStateFromCheckpoint(clean(fact.state)));
            if ((clean(fact.state) === "awaiting_repair" || clean(fact.repairKind)) && states.has("repair")) {
                states.set("repair", clean(fact.state) === "paused" ? "paused" : "running");
            }
        } else if (kind === "publication") {
            if (fact.failure && states.has("delivery")) states.set("delivery", "needs_attention");
            else if (["publication_verified", "cleanup_complete"].includes(phase) && states.has("delivery")) {
                states.set("delivery", "completed");
            }
        } else if (kind === "registry") {
            const status = clean(fact.status);
            if (status === "execution_failed" && states.has("execution")) states.set("execution", "needs_attention");
            if (status === "validation_failed") {
                const planStatus = clean(input.status).toLowerCase();
                states.set(
                    planStatus === "implemented" ? "mechanical" : planStatus === "validated_ci" ? "semantic" : "repair",
                    "needs_attention",
                );
            }
            if (status === "active" && states.has("execution") && clean(input.status).toLowerCase() === "in_progress") {
                states.set("execution", "running");
            }
        } else if (kind === "session" && clean(fact.state) === "active" && states.has("execution")) {
            states.set("execution", "running");
        }
    }
    return states;
}

function repairReturnTarget(input: WorkflowPresentationInput): string {
    for (const fact of input.progressFacts || []) {
        if (clean(fact.kind) === "validation_checkpoint") {
            const target = stageForValidationPhase(clean(fact.phase));
            if (target) return target;
        }
        if (clean(fact.kind) === "registry" && clean(fact.status) === "validation_failed") {
            const status = clean(input.status).toLowerCase();
            return status === "implemented" ? "mechanical" : status === "validated_ci" ? "semantic" : "delivery";
        }
    }
    const status = clean(input.status).toLowerCase();
    return status === "implemented" ? "mechanical" : status === "validated_ci" ? "semantic" : "";
}

function currentStageIndex(stages: StageDefinition[], rawStates: Map<string, string>): number {
    const urgent = stages.findIndex((stage) => {
        const raw = rawStates.get(stage.id) || "pending";
        return BLOCKED_STATES.has(raw) || PAUSED_STATES.has(raw);
    });
    if (urgent >= 0) return urgent;
    const running = stages.findIndex((stage) => ACTIVE_STATES.has(rawStates.get(stage.id) || "pending"));
    if (running >= 0) return running;
    const pending = stages.findIndex((stage) => {
        const raw = rawStates.get(stage.id) || "pending";
        return !DONE_STATES.has(raw) && !SKIPPED_STATES.has(raw);
    });
    if (pending >= 0) return pending;
    return stages.length - 1;
}

function detailFor(stage: WorkflowPresentationStage): string {
    if (stage.state === "blocked") return `${stage.label} needs attention.`;
    if (stage.state === "paused") return `${stage.label} is paused.`;
    if (stage.state === "current") return `${stage.label} is current.`;
    if (stage.state === "completed") return `${stage.label} is complete.`;
    if (stage.state === "skipped") return `${stage.label} is not required.`;
    if (stage.state === "unavailable") return `${stage.label} evidence is unavailable.`;
    return `${stage.label} has not started.`;
}

function actionFor(
    _stage: WorkflowPresentationStage,
    input: WorkflowPresentationInput,
): WorkflowPresentationAction | null {
    if (input.hasLiveQuestion) {
        return {
            kind: "answer_agent",
            label: "Answer agent",
            detail: "Focus the waiting prompt in the working Session.",
        };
    }
    if (input.hasPlanReview) {
        return { kind: "review_plan", label: "Review Plan", detail: "Open the current Plan review." };
    }
    if (input.hasCodeReview) {
        return { kind: "review_code", label: "Review code", detail: "Open the current code review." };
    }
    if (input.canRecover) {
        return { kind: "recover", label: "Recover", detail: "Use the existing recovery flow for this Plan." };
    }
    if (input.canResume) {
        return { kind: "resume", label: "Resume", detail: "Use the existing continuation flow for this Plan." };
    }
    if (input.canRun) {
        return { kind: "run", label: "Run", detail: "Start the existing Plan continuation flow." };
    }
    if (clean(input.sessionState) === "active" || input.hasWorkingSession) {
        return { kind: "open_session", label: "Open Session", detail: "Open the working Session." };
    }
    return { kind: "open_plan", label: "Open Plan", detail: "Open the Plan home." };
}

export function buildWorkflowPresentation(input: WorkflowPresentationInput): WorkflowPresentation {
    const plan = clean(input.planName);
    const epic = clean(input.epicName);
    const intent = clean(input.intent || input.projectPlanType).replaceAll("_", " ");
    const active = Boolean(plan || epic || intent || clean(input.status));
    if (!active) {
        return {
            active: false,
            epic: null,
            plan: "No active Plan",
            intent: "No active workflow",
            stages: [],
            connections: [],
            currentStage: null,
            blocker: null,
            action: null,
        };
    }

    const definitions = stageDefinitions(input);
    const rawStates = mergedRawStates(input, definitions);
    const currentIndex = currentStageIndex(definitions, rawStates);
    const stages = definitions.map((definition, index) => {
        const state = stateFromRaw(rawStates.get(definition.id) || "pending", index === currentIndex);
        const stage: WorkflowPresentationStage = {
            id: definition.id,
            label: definition.label,
            state,
            detail: "",
            current: index === currentIndex,
        };
        return { ...stage, detail: detailFor(stage) };
    }).filter((stage) => stage.state !== "skipped");
    const currentStage = stages.find((stage) => stage.current) || stages.at(-1) || null;
    const blocker = clean(input.degradedMessage) ||
        (currentStage && ["blocked", "paused", "unavailable"].includes(currentStage.state)
            ? currentStage.detail
            : null);
    return {
        active,
        epic: epic || null,
        plan: epic && plan.startsWith(`${epic}/`) ? plan.slice(epic.length + 1) : plan || "No active Plan",
        intent: intent || (isProject(input) ? "Container workflow" : "Plan workflow"),
        stages,
        connections: connectionDefinitions(definitions, repairReturnTarget(input)),
        currentStage,
        blocker,
        action: currentStage ? actionFor(currentStage, input) : null,
    };
}
