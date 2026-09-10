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

export interface WorkflowPresentationStageFact {
    id: string;
    label?: string | null;
    state?: string | null;
    detail?: string | null;
    updatedAt?: string | null;
}

export interface WorkflowPresentationInput {
    planName?: string | null;
    epicName?: string | null;
    intent?: string | null;
    classification?: string | null;
    status?: string | null;
    stages?: WorkflowPresentationStageFact[];
    degradedMessage?: string | null;
    sessionState?: string | null;
    hasWorkingSession?: boolean;
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

export interface WorkflowPresentation {
    active: boolean;
    epic: string | null;
    plan: string;
    intent: string;
    stages: WorkflowPresentationStage[];
    currentStage: WorkflowPresentationStage | null;
    blocker: string | null;
    action: WorkflowPresentationAction | null;
}

const DEFAULT_STAGE_FACTS: WorkflowPresentationStageFact[] = [
    { id: "planning", label: "Planning", state: "pending", detail: "Planning evidence is unavailable." },
    { id: "execution", label: "Execution", state: "pending", detail: "Execution has not started." },
    { id: "mechanical", label: "Tests and CI", state: "pending", detail: "Tests and CI have not started." },
    { id: "semantic", label: "AI review", state: "pending", detail: "AI review has not started." },
    { id: "repair", label: "Repair", state: "not_required", detail: "No repair is active." },
    { id: "delivery", label: "Delivery", state: "pending", detail: "Delivery has not started." },
    { id: "completion", label: "Completion", state: "pending", detail: "Completion has not started." },
];

const ACTIVE_STATES = new Set(["running"]);
const BLOCKED_STATES = new Set(["needs_attention", "failed"]);
const PAUSED_STATES = new Set(["paused"]);
const DONE_STATES = new Set(["passed", "completed"]);
const SKIPPED_STATES = new Set(["not_required", "skipped"]);

function clean(value?: string | null): string {
    return typeof value === "string" ? value.trim() : "";
}

function stageState(factState: string, isCurrent: boolean): WorkflowPresentationStepState {
    if (BLOCKED_STATES.has(factState)) return "blocked";
    if (PAUSED_STATES.has(factState)) return "paused";
    if (ACTIVE_STATES.has(factState)) return "current";
    if (DONE_STATES.has(factState)) return "completed";
    if (SKIPPED_STATES.has(factState)) return "skipped";
    if (factState === "unknown") return "unavailable";
    return isCurrent ? "current" : "upcoming";
}

function orderedFacts(input: WorkflowPresentationInput): WorkflowPresentationStageFact[] {
    const facts = input.stages?.length ? input.stages : DEFAULT_STAGE_FACTS;
    return facts.filter((fact) => !SKIPPED_STATES.has(clean(fact.state)));
}

function currentFactIndex(facts: WorkflowPresentationStageFact[]): number {
    const urgent = facts.findIndex((fact) =>
        BLOCKED_STATES.has(clean(fact.state)) || PAUSED_STATES.has(clean(fact.state))
    );
    if (urgent >= 0) return urgent;
    const running = facts.findIndex((fact) => ACTIVE_STATES.has(clean(fact.state)));
    if (running >= 0) return running;
    const pending = facts.findIndex((fact) =>
        !DONE_STATES.has(clean(fact.state)) && !SKIPPED_STATES.has(clean(fact.state))
    );
    if (pending >= 0) return pending;
    return facts.length - 1;
}

function actionFor(
    stage: WorkflowPresentationStage,
    input: WorkflowPresentationInput,
): WorkflowPresentationAction | null {
    if (stage.state === "blocked") {
        return { kind: "recover", label: "Recover", detail: "Use the existing recovery flow for this Plan." };
    }
    if (stage.state === "paused") {
        return { kind: "resume", label: "Resume", detail: "Use the existing continuation flow for this Plan." };
    }
    if (stage.id === "planning" && stage.state === "current") {
        return { kind: "review_plan", label: "Review Plan", detail: "Open the existing Plan review." };
    }
    if (stage.id === "semantic" && stage.state === "current") {
        return { kind: "review_code", label: "Review code", detail: "Open the existing code review." };
    }
    if (stage.id === "execution" && stage.state === "current") {
        return { kind: "run", label: "Run", detail: "Start the existing Plan continuation flow." };
    }
    if (clean(input.sessionState) === "active") {
        return { kind: "open_session", label: "Open Session", detail: "Open the working Session." };
    }
    return input.hasWorkingSession
        ? { kind: "open_session", label: "Open Session", detail: "Open the latest proven Session for this Plan." }
        : { kind: "open_plan", label: "Open Plan", detail: "Open the Plan home." };
}

export function buildWorkflowPresentation(input: WorkflowPresentationInput): WorkflowPresentation {
    const plan = clean(input.planName);
    const epic = clean(input.epicName);
    const intent = clean(input.intent).replaceAll("_", " ");
    const active = Boolean(plan || epic || intent);
    if (!active) {
        return {
            active: false,
            epic: null,
            plan: "No active Plan",
            intent: "No active workflow",
            stages: [],
            currentStage: null,
            blocker: null,
            action: null,
        };
    }

    const facts = orderedFacts(input);
    const currentIndex = currentFactIndex(facts);
    const stages = facts.map((fact, index) => {
        const rawState = clean(fact.state) || "pending";
        const isCurrent = index === currentIndex;
        return {
            id: clean(fact.id) || `stage-${index + 1}`,
            label: clean(fact.label) || clean(fact.id) || `Stage ${index + 1}`,
            state: stageState(rawState, isCurrent),
            detail: clean(fact.detail) || "No detail is available.",
            current: isCurrent,
        };
    });
    const currentStage = stages[currentIndex] || null;
    const blocker = clean(input.degradedMessage) ||
        (currentStage && ["blocked", "paused", "unavailable"].includes(currentStage.state)
            ? currentStage.detail
            : null);
    return {
        active,
        epic: epic || null,
        plan: epic && plan.startsWith(`${epic}/`) ? plan.slice(epic.length + 1) : plan || "No active Plan",
        intent: intent || "Plan workflow",
        stages,
        currentStage,
        blocker,
        action: currentStage ? actionFor(currentStage, input) : null,
    };
}
