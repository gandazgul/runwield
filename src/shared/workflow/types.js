/**
 * @module shared/workflow/types
 */

/**
 * @typedef {{
 *   status: "success" | "failed" | "blocked",
 *   error?: string,
 *   messages?: import('@mariozechner/pi-agent-core').AgentMessage[],
 * }} TaskExecutionResult
 */
