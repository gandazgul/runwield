/**
 * @typedef {Object} SessionAvailabilityInput
 * @property {string | null | undefined} [state]
 * @property {string | null | undefined} [activeSurface]
 * @property {boolean} [bootstrapRequired]
 * @property {number | null | undefined} [generation]
 * @property {{ activeAgent?: string | null, workflowContext?: unknown, activeExecutionWorkflow?: unknown }} [snapshot]
 * @property {boolean} [timelineComplete]
 * @property {boolean} [localOperationActive]
 * @property {boolean} [truncated]
 */

const SURFACE_LABELS = {
    tui: "TUI",
    workspace: "Workspace",
    acp: "ACP",
    test: "another surface",
};

/** @param {string | null | undefined} value */
function surfaceLabel(value) {
    switch (String(value || "")) {
        case "tui":
            return SURFACE_LABELS.tui;
        case "workspace":
            return SURFACE_LABELS.workspace;
        case "acp":
            return SURFACE_LABELS.acp;
        case "test":
            return SURFACE_LABELS.test;
        default:
            return "another surface";
    }
}

/**
 * @param {SessionAvailabilityInput} input
 * @returns {{ key: string, label: string, explanation: string, intent: "success" | "warning" | "danger" | "info", canPrepare: boolean, canContinue: boolean }}
 */
export function deriveSessionAvailability(input) {
    if (input.localOperationActive) {
        return {
            key: "workspace-running",
            label: "Running in Workspace",
            explanation: "This phone already has a server-owned Session operation in progress.",
            intent: "warning",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.bootstrapRequired || input.state === "uninitialized" || input.generation === null) {
        return {
            key: "recovery-needed",
            label: "Session needs repair",
            explanation: "RunWield could not safely read this Session's transcript.",
            intent: "danger",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.truncated || input.timelineComplete === false) {
        return {
            key: "timeline-incomplete",
            label: "Read-only timeline",
            explanation: "The complete committed timeline was not loaded, so continuation is disabled until reload.",
            intent: "warning",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.state === "reconcile_required" || input.state === "uncertain") {
        return {
            key: "recovery-needed",
            label: "Recovery needed",
            explanation: "RunWield must reconcile Session ownership before a phone can continue this Session.",
            intent: "danger",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.state === "active") {
        const label = input.activeSurface === "workspace"
            ? "Running in Workspace"
            : `In use in ${surfaceLabel(input.activeSurface)}`;
        return {
            key: "active",
            label,
            explanation:
                "Another RunWield surface is using this Session. It becomes available when that surface stops.",
            intent: "warning",
            canPrepare: false,
            canContinue: false,
        };
    }
    const activeAgent = String(input.snapshot?.activeAgent || "");
    const workflowContext =
        input.snapshot?.activeExecutionWorkflow && typeof input.snapshot.activeExecutionWorkflow === "object"
            ? input.snapshot.activeExecutionWorkflow
            : input.snapshot?.workflowContext && typeof input.snapshot.workflowContext === "object" &&
                    ("phase" in input.snapshot.workflowContext || "state" in input.snapshot.workflowContext ||
                        "kind" in input.snapshot.workflowContext)
            ? input.snapshot.workflowContext
            : null;
    if (workflowContext) {
        const phase = String(workflowContext.phase || workflowContext.state || workflowContext.kind || "execution");
        const semantic = phase.includes("semantic") || phase.includes("review");
        const mechanical = phase.includes("mechanical") || phase.includes("ci");
        const repair = phase.includes("repair");
        const delivery = phase.includes("delivery") || phase.includes("publication") || phase.includes("merge");
        const failed = phase.includes("failed") || phase.includes("failure");
        const completed = phase.includes("completed") || phase.includes("verified");
        const label = failed
            ? "Work needs attention"
            : completed
            ? "Work completed"
            : repair
            ? "Repair running"
            : delivery
            ? "Delivery running"
            : semantic
            ? "Semantic Code Review running"
            : mechanical
            ? "Mechanical Validation running"
            : "Execution running";
        return {
            key: failed ? "workflow-failed" : completed ? "workflow-completed" : "execution-workflow",
            label,
            explanation: completed
                ? "This Session has completed work and remains read-only for this workflow."
                : failed
                ? "This Session has work that needs attention. Use the Plan progress view."
                : "This Session is running work. Use the Plan progress view for current state.",
            intent: failed ? "danger" : completed ? "success" : "warning",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.snapshot?.activeExecutionWorkflow) {
        return {
            key: "execution-workflow",
            label: "Running work",
            explanation: "This Session is running work. It becomes available when that work finishes.",
            intent: "warning",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.state === "idle" && activeAgent) {
        return {
            key: "available",
            label: "Available",
            explanation: `Idle ${activeAgent} Session with a complete committed timeline.`,
            intent: "success",
            canPrepare: false,
            canContinue: true,
        };
    }
    if (input.state === "idle") {
        return {
            key: "available",
            label: "Available",
            explanation: "Idle conversational Session with a complete committed timeline.",
            intent: "success",
            canPrepare: false,
            canContinue: true,
        };
    }
    return {
        key: "unavailable",
        label: "Readable only",
        explanation: "This Session is visible, but it is not eligible for phone continuation yet.",
        intent: "info",
        canPrepare: false,
        canContinue: false,
    };
}

/** @param {{ availability: ReturnType<typeof deriveSessionAvailability>, compact?: boolean }} props */
export function SessionActivationStatus({ availability, compact = false }) {
    return (
        <section
            className={`session-activation-status intent-${availability.intent}`}
            aria-label="Session availability"
        >
            <div className="session-activation-status__label">{availability.label}</div>
            {!compact ? <p>{availability.explanation}</p> : null}
        </section>
    );
}

export default SessionActivationStatus;
