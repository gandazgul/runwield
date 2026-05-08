/**
 * @module shared/workflow/types
 */

/**
 * @typedef {{
 *   status: "success" | "failed" | "blocked",
 *   error?: string,
 *   messages?: import('@earendil-works/pi-agent-core').AgentMessage[],
 * }} TaskExecutionResult
 */
