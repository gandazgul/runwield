/**
 * @module shared/workflow/workflow-results
 * Helpers for extracting workflow outcomes from agent message streams.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function extractText(value) {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return "";

    if (Array.isArray(value)) {
        return value.map(extractText).filter(Boolean).join("\n").trim();
    }

    const block = /** @type {{ type?: string, text?: unknown, content?: unknown, contentText?: unknown }} */ (value);
    if (typeof block.text === "string") return block.text.trim();
    if (typeof block.contentText === "string") return block.contentText.trim();
    if (block.type === "tool_result") return extractText(block.content);
    return "";
}

/**
 * @param {unknown} details
 * @returns {string | null}
 */
function extractTaskCompletedMessage(details) {
    if (!details || typeof details !== "object") return null;
    const message = /** @type {{ message?: unknown }} */ (details).message;
    return typeof message === "string" && message.trim() ? message.trim() : null;
}

/**
 * Extract the last text output from the agent's assistant messages.
 * Scans messages in reverse, checking all content blocks to handle cases where
 * tool_use blocks appear alongside text.
 * Falls back to the latest task_completed message because execution agents often
 * report their summary through the terminal tool call instead of a final text
 * response.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {string | null}
 */
export function extractAssistantOutput(messages) {
    /** @type {string | null} */
    let taskCompletedMessage = null;

    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];

        if (
            !taskCompletedMessage && msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "task_completed"
        ) {
            taskCompletedMessage = extractTaskCompletedMessage(
                /** @type {{ details?: unknown }} */ (msg).details,
            );
        }

        if (!("role" in msg) || msg.role !== "assistant") continue;

        const text = extractText(/** @type {{ content?: unknown }} */ (msg).content);
        if (text) {
            return text;
        }
    }

    return taskCompletedMessage;
}

/**
 * @typedef {"approved" | "feedback"} ReviewOutcome
 */

/**
 * @typedef {Object} ReviewOutcomeResult
 * @property {ReviewOutcome} outcome
 * @property {boolean} approved
 * @property {string} feedback
 */

/**
 * Read the latest review_complete tool result from a message stream.
 *
 * Returns null when no review_complete call is found (for example, the session
 * was interrupted, or the agent finished via text output instead of the tool).
 *
 * When `fromIndex` is provided, only messages at or after that index are searched,
 * preventing stale outcomes from earlier turns from being picked up.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @param {number} [fromIndex] - Only search messages from this index onwards.
 * @returns {ReviewOutcomeResult | null}
 */
export function readLatestReviewOutcome(messages, fromIndex) {
    const start = fromIndex != null && fromIndex <= messages.length ? fromIndex : 0;
    for (let i = messages.length - 1; i >= start; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "review_complete"
        ) {
            // @ts-ignore details set by tool implementation
            const details = msg.details || {};
            const outcome = details.outcome;
            if (outcome === "approved" || outcome === "feedback") {
                return {
                    outcome: /** @type {ReviewOutcome} */ (outcome),
                    approved: details.approved === true,
                    feedback: typeof details.feedback === "string" ? details.feedback : "",
                };
            }
        }
    }
    return null;
}

/**
 * @typedef {"approved_execute" | "approved_decompose" | "saved" | "feedback" | "canceled" | "repair_required" | "no_call"} PlanOutcome
 */

/**
 * @typedef {Object} PlanOutcomeResult
 * @property {PlanOutcome} outcome
 * @property {string} [planName]
 * @property {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} [tasks]
 * @property {import('../../tools/plan-written.js').TriageMeta} [triageMeta]
 */

/**
 * Read the latest plan_written tool result's outcome from a message stream.
 *
 * When `fromIndex` is provided, only messages at or after that index are searched,
 * preventing stale outcomes from earlier turns from being picked up.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @param {number} [fromIndex] - Only search messages from this index onwards (exclusive lower bound)
 * @returns {PlanOutcomeResult | null}
 */
export function readLatestPlanOutcome(messages, fromIndex) {
    const start = fromIndex != null ? fromIndex : 0;
    for (let i = messages.length - 1; i >= start; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "plan_written"
        ) {
            // @ts-ignore details set by tool implementation
            const details = msg.details || {};
            const outcome = details.outcome;
            if (outcome) {
                return {
                    outcome,
                    planName: details.planName,
                    tasks: details.tasks,
                    triageMeta: details.triageMeta,
                };
            }
        }
    }
    return null;
}

/**
 * Read the latest task_completed tool result's outcome from a message stream.
 *
 * When `fromIndex` is provided, only messages at or after that index are searched,
 * preventing stale completions from earlier root turns from advancing workflow state.
 * If the returned message stream is shorter than `fromIndex`, treat it as a fresh
 * or sliced transcript and search it from the beginning.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @param {number} [fromIndex] - Only search messages from this index onwards.
 * @returns {boolean}
 */
export function readLatestTaskCompletedOutcome(messages, fromIndex) {
    const start = fromIndex != null && fromIndex <= messages.length ? fromIndex : 0;
    for (let i = messages.length - 1; i >= start; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "task_completed"
        ) {
            // @ts-ignore details set by tool implementation
            const details = msg.details || {};
            if (details.outcome === "task_completed") {
                return true;
            }
        }
    }
    return false;
}
