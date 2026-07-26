/**
 * @typedef {Object} SessionAvailabilityInput
 * @property {{ enabled?: boolean, status?: string } | null | undefined} [protocol]
 * @property {string | null | undefined} [state]
 * @property {string | null | undefined} [activeSurface]
 * @property {boolean} [bootstrapRequired]
 * @property {number | null | undefined} [generation]
 * @property {{ activeAgent?: string | null, workflowContext?: unknown }} [snapshot]
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
    const protocolEnabled = input.protocol?.enabled !== false && input.protocol?.status !== "disabled";
    if (!protocolEnabled) {
        return {
            key: "protocol-disabled",
            label: "Continuation disabled",
            explanation: "Session activation is disabled for this Workspace server.",
            intent: "danger",
            canPrepare: false,
            canContinue: false,
        };
    }
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
            key: "prepare",
            label: "Preparation needed",
            explanation: "Prepare this legacy Session before reading or continuing its committed timeline.",
            intent: "warning",
            canPrepare: true,
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
            explanation: "Another surface currently owns this Session. Refresh after it becomes idle.",
            intent: "warning",
            canPrepare: false,
            canContinue: false,
        };
    }
    const activeAgent = String(input.snapshot?.activeAgent || "");
    if (activeAgent && activeAgent !== "Ideator") {
        return {
            key: "non-ideator",
            label: "Readable only",
            explanation: `This tracer bullet can continue only idle Ideator Sessions. Current agent: ${activeAgent}.`,
            intent: "info",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.snapshot?.workflowContext) {
        return {
            key: "workflow-context",
            label: "Workflow Session",
            explanation:
                "This Session already has workflow context. Phone continuation is limited to ordinary Ideator conversations.",
            intent: "info",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.state === "idle" && activeAgent === "Ideator") {
        return {
            key: "available",
            label: "Available",
            explanation: "Idle Ideator Session with a complete committed timeline.",
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
