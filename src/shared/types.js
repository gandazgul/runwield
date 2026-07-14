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
 * @typedef {Object} RuntimeAdapterCapabilities
 * @property {string} kind
 * @property {Record<string, unknown>} capabilities
 */

/**
 * @typedef {Object} RuntimeSelectOption
 * @property {string} value
 * @property {string} label
 * @property {string} [description]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {Object} RuntimeMessageAppender
 * @property {(delta: string) => void} appendText
 */

/**
 * @typedef {Object} RuntimeThinkingAppender
 * @property {(delta: string) => void} appendDelta
 * @property {() => void} end
 */

/**
 * @typedef {Object} RuntimeToolExecutionPort
 * @property {(text: string) => void} appendOutput
 * @property {(isError: boolean, durationMs: number) => void} endExecution
 * @property {string} [bodyText]
 * @property {number} startTime
 * @property {(expanded: boolean) => void} [setExpanded]
 */

/**
 * Transitional adapter-neutral presentation port used while legacy workflow
 * call sites migrate to SessionRuntime events and interactions.
 *
 * @typedef {Object} SessionUiPort
 * @property {(text: string, isError?: boolean, header?: string, style?: { headingColor?: string, bodyColor?: string }) => void} appendSystemMessage
 * @property {(agentName: string) => RuntimeMessageAppender} appendAgentMessageStart
 * @property {() => RuntimeThinkingAppender} [appendThinkingStart]
 * @property {(text: string) => void} [appendUserMessage]
 * @property {(base64: string, mimeType: string) => void} [appendImage]
 * @property {() => void} requestRender
 * @property {() => void} [advanceSpinner]
 * @property {(busy: boolean) => void} [setBusy]
 * @property {(tasks: Array<{ task: number, assignee: string, description: string }>) => void} [setRunningTasks]
 * @property {() => void} [clearMessages]
 * @property {(title: string, options: RuntimeSelectOption[]) => Promise<string | null>} promptSelect
 * @property {(title: string, options?: { defaultValue?: string, placeholder?: string, allowEmpty?: boolean }) => Promise<string | null>} promptText
 * @property {() => Promise<void> | void} showModelSelector
 * @property {(agentName: string, agentModel?: string) => void} [setAgentInfo]
 * @property {() => void} [disableInput]
 * @property {() => void} [enableInput]
 * @property {(id: string, name: string, args: string) => RuntimeToolExecutionPort} [startToolExecution]
 * @property {(agentName: string, markdown: string, approved: boolean) => void} [appendReviewResult]
 * @property {(id: string) => RuntimeToolExecutionPort | undefined} [getActiveToolBlock]
 * @property {() => void} [toggleToolOutputsExpanded]
 * @property {(event: unknown) => void} [addToolInvoked]
 * @property {(event: unknown) => void} [addToolResult]
 * @property {() => boolean} [isOutputSuppressed]
 * @property {() => void} [suppressOutput]
 * @property {() => void} [abortActivePrompt]
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
 * @typedef {Object} SessionSnapshot
 * @property {string} id
 * @property {string} cwd
 * @property {string | null} sessionManagerId
 * @property {string | null} name
 * @property {boolean} disposed
 * @property {string | null} activeAgent
 * @property {{ model: string, provider: string }} activeModel
 * @property {string} thinkingLevel
 * @property {boolean} busy
 * @property {string | null} activeTurnId
 * @property {import('./session/session-runtime-events.js').RuntimeQueuedMessage[]} queuedMessages
 * @property {Record<string, unknown> | null} workflow
 * @property {{ kind: string, capabilities: Record<string, unknown> } | null} interactionAdapter
 */

export {};
