/**
 * @module shared/types
 * Stable cross-module contracts for the UI-independent RunWield runtime.
 */

/**
 * @typedef {Object} ProjectContext
 * @property {string} projectRoot - Absolute root used for project-local configuration and persistence.
 */

/**
 * @typedef {Object} SessionRuntimeEventSink
 * @property {(event: Partial<import('./session/session-runtime-events.js').SessionRuntimeEvent> & { type: string }) => void} emit
 */

/**
 * @typedef {Object} SessionPromptRequest
 * @property {string} initialRequest
 * @property {import('./session/types.js').ImageAttachment[]} [initialImages]
 */

/**
 * @typedef {Object} SessionPromptResult
 * @property {boolean} ok
 * @property {number} turns
 * @property {number} handoffs
 * @property {boolean} handoffLimitReached
 * @property {string} [error]
 */

/**
 * @typedef {Object} ContextUsageSnapshot
 * @property {number | null} tokens
 * @property {number} contextWindow
 * @property {number | null} percent
 */

/**
 * @typedef {Object} SessionSnapshot
 * @property {string} id
 * @property {string} cwd
 * @property {string | null} sessionManagerId
 * @property {string | null} name
 * @property {boolean} disposed
 * @property {{ runwieldSessionId: string, projectId: string, generation: number | null, dormant: boolean } | null} [managed]
 * @property {string | null} activeAgent
 * @property {{ displayName: string, model: string, provider: string, agentName?: string } | null} activeAgentInfo
 * @property {{ model: string, provider: string }} activeModel
 * @property {string} thinkingLevel
 * @property {boolean} busy
 * @property {string | null} activeTurnId
 * @property {import('./session/session-runtime-events.js').RuntimeQueuedMessage[]} queuedMessages
 * @property {import('./session/workflow-context-session.js').WorkflowContext | null} workflowContext
 * @property {Record<string, unknown> | null} activeExecutionWorkflow
 * @property {ContextUsageSnapshot | null} contextUsage
 * @property {boolean | null} autoCompactionEnabled
 */

export {};
