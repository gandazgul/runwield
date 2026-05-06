/**
 * @module shared/triage
 * Utilities for extracting plan data from agent output.
 */

/**
 * Extract plan_written result from planning conversation messages.
 *
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
 * @returns {{ planName: string, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> } | null}
 */
export function extractPlanWritten(messages) {
    for (const msg of messages) {
        if (
            "role" in msg &&
            msg.role === "toolResult" &&
            "toolName" in msg &&
            msg.toolName === "plan_written"
        ) {
            // @ts-ignore details is set by our tool implementation
            const details = msg.details || null;
            if (
                details && typeof details.planName === "string" &&
                details.planName.trim()
            ) {
                return {
                    planName: details.planName.trim(),
                    tasks: Array.isArray(details.tasks) ? details.tasks : undefined,
                };
            }
        }
    }

    return null;
}
