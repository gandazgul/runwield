/**
 * @module shared/types
 * Stable cross-module contracts for the UI-independent RunWield runtime.
 */

/**
 * @typedef {Object} ActiveExecutionWorkflow
 * @property {string} planName
 * @property {import('../tools/plan-written.ts').TriageMeta} triageMeta
 * @property {"engineer"|"frontend-engineer"} executionAgent
 * @property {boolean} [executionStarted]
 * @property {number} [executionAttemptStartedAtMs]
 * @property {"autonomous"|"pair"} [collaborationStyle]
 * @property {"autonomous"|"pair"} [collaborationRecommendation]
 * @property {number} [pairCheckpointCount]
 * @property {boolean} [pairSwitchedToAutonomous]
 * @property {boolean} [pairCapabilityLost]
 * @property {"stop"|"canceled"} [pairPauseReason]
 * @property {boolean} [pairStopRequested]
 * @property {"worktree"|"non_git_in_place"} [executionMode]
 * @property {string} [baselineTree]
 * @property {string} [projectRoot]
 * @property {string} [executionCwd]
 * @property {string} [worktreeId]
 * @property {string} [worktreeBranch]
 * @property {string} [worktreeBaseBranch]
 * @property {string} [worktreeBaseRef]
 * @property {string} [worktreeBaseCommit]
 * @property {boolean} [nonGitInPlace]
 * @property {boolean} [validationContinuation]
 * @property {string} [validationGeneration]
 * @property {string} [validationRepairGeneration]
 * @property {string} [manualQaName]
 * @property {string} [manualQaContext]
 * @property {number} [semanticRound]
 * @property {import('./workflow/review-ledger.ts').ReviewLedger} [reviewLedger]
 * @property {string} [repairBaselineTree]
 * @property {string} [lastRepairReport]
 * @property {number} [humanReviewCycle]
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
 * @property {{ runwieldSessionId: string, projectId: string, currentSegmentId?: string, generation: number | null, acknowledgedGeneration?: number | null, acknowledgedEventId?: string | null, syncState?: { status: import('./session/session-runtime-events.js').RuntimeManagedSyncStatus, localGeneration: number | null, latestGeneration: number | null, owningSurfaceKind?: "workspace" | "tui" | "acp" | "unknown", message?: string } | null, dormant: boolean } | null} [managed]
 * @property {string | null} activeAgent
 * @property {{ displayName: string, model: string, provider: string, agentName?: string } | null} activeAgentInfo
 * @property {{ model: string, provider: string }} activeModel
 * @property {string} thinkingLevel
 * @property {boolean} busy
 * @property {string | null} activeTurnId
 * @property {import('./session/session-runtime-events.js').RuntimeQueuedMessage[]} queuedMessages
 * @property {import('./session/workflow-context-session.js').WorkflowContext | null} workflowContext
 * @property {import('./session/file-session-store-types.ts').SessionArtifactReference[]} artifacts
 * @property {Record<string, unknown> | null} activeExecutionWorkflow
 * @property {ContextUsageSnapshot | null} contextUsage
 * @property {boolean | null} autoCompactionEnabled
 */

/**
 * @typedef {Object} SessionTranscriptSegment
 * @property {string} segmentId
 * @property {string} runwieldSessionId
 * @property {string} projectId
 * @property {string} piSessionId
 * @property {string} transcriptPath
 * @property {string} transcriptCwd
 * @property {number} ordinal
 * @property {string} kind
 * @property {string | null} sealedAt
 * @property {number | null} headerVersion
 * @property {string | null} headerTimestamp
 * @property {string} firstCatalogedAt
 * @property {string} lastCatalogedAt
 * @property {string | null} lineageParentSegmentId
 * @property {string | null} lineageParentPiSessionId
 * @property {string | null} lineageGroupKey
 * @property {string | null} lineageRecordedAt
 * @property {number | null} sealedByteLength
 * @property {string | null} sealedDigestHex
 * @property {string | null} sealedTerminalEntryId
 */

/**
 * @typedef {Object} SessionSegmentState
 * @property {string} runwieldSessionId
 * @property {string} projectId
 * @property {string | null} currentSegmentId
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} SessionSegmentLineageEvidence
 * @property {string} segmentId
 * @property {string} runwieldSessionId
 * @property {string | null} [parentSegmentId]
 * @property {string | null} [parentPiSessionId]
 * @property {string | null} [lineageGroupKey]
 * @property {'planning' | 'execution' | 'semantic_repair'} [kind]
 */

/**
 * @typedef {Object} SessionLineageDiagnostic
 * @property {'valid' | 'missing_lineage' | 'ambiguous_lineage' | 'cyclic_lineage' | 'orphaned_lineage'} code
 * @property {string | null} segmentId
 * @property {string} message
 */

export {};
