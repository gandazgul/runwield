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

/**
 * @param {SessionAvailabilityInput} input
 * @returns {{ key: string, label: string, explanation: string, intent: "success" | "warning" | "danger" | "info", canPrepare: boolean, canContinue: boolean }}
 */
export function deriveSessionAvailability(input) {
    if (input.localOperationActive) {
        return {
            key: "workspace-running",
            label: "Working",
            explanation: "Steer the agent or queue a follow-up.",
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
    if (input.state === "reconcile_required" || input.state === "uncertain") {
        return {
            key: "recovery-needed",
            label: "Recovery needed",
            explanation: "The last operation was interrupted. Retry to check the saved conversation.",
            intent: "danger",
            canPrepare: false,
            canContinue: false,
        };
    }
    if (input.state === "active") {
        return {
            key: "active",
            label: "Working",
            explanation: "Steer the agent or queue a follow-up.",
            intent: "warning",
            canPrepare: false,
            canContinue: false,
        };
    }
    const activeAgent = String(input.snapshot?.activeAgent || "");
    if (input.state === "idle" && activeAgent) {
        return {
            key: "available",
            label: "Available",
            explanation: `${activeAgent} is ready for your next message.`,
            intent: "success",
            canPrepare: false,
            canContinue: true,
        };
    }
    if (input.state === "idle") {
        return {
            key: "available",
            label: "Available",
            explanation: "Ready for your next message.",
            intent: "success",
            canPrepare: false,
            canContinue: true,
        };
    }
    return {
        key: "unavailable",
        label: "Readable only",
        explanation: "The conversation is not available yet. Try reloading.",
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
