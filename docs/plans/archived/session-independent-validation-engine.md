---
planId: "4a63fb51-d786-4e68-8772-2cbb4e928198"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Split src/shared/workflow/validation.ts (2,482 lines) into cohesive modules under 1000 lines and extract the Workflow Validation sequencing, convergence policy, and gate predicates into a session-independent engine that consumes Pi/session turn machinery only through a narrow port, so the Attached Mode coordinator can drive the same engine without a second validation implementation."
affectedPaths:
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-context.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-human-review.ts"
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/validation-emit.ts"
    - "src/shared/workflow/validation-interactions.ts"
    - "src/shared/workflow/review-ledger.ts"
    - "src/shared/workflow/architecture-boundary.test.ts"
    - "src/shared/session/architecture-boundary.test.js"
    - "docs/domain-language.md"
objectiveChecks:
    - id: "OC1"
      command: "test \"$(wc -l < src/shared/workflow/validation.ts)\" -lt 1000"
      rationale: "The 2,482-line monolith is no longer the entry point; this fails today and passes only after validation.ts is reduced below the requested ceiling."
    - id: "OC2"
      command: "for f in src/shared/workflow/validation*.ts; do test -f \"$f\" && test \"$(wc -l < \"$f\")\" -lt 1000 || exit 1; done"
      rationale: "Every validation*.ts module in the directory is under the requested ceiling; the directory glob (not an enumerated list) catches a renamed monolith that keeps a validation-* name regardless of what it is called."
    - id: "OC3"
      command: "F=\"validation-ports.ts validation-types.ts validation-engine.ts validation-context.ts validation-mechanical.ts validation-semantic.ts validation-human-review.ts validation-publication.ts validation-merge-repair.ts validation-emit.ts validation-interactions.ts\"; cd src/shared/workflow; for f in $F; do test -f \"$f\" || exit 1; done; ! grep -lE \"@earendil-works|\\.\\./session/\" $F"
      rationale: "The 11 engine modules exist and none imports Pi packages or ../session/ modules, proving the sequencing/convergence/gate logic is session-independent (the Attached Mode prerequisite)."
    - id: "OC4"
      command: "grep -q \"export async function runValidationLoop\" src/shared/workflow/validation-engine.ts && grep -q \"MAX_PHASES_PER_CALL\" src/shared/workflow/validation-engine.ts && grep -q \"createValidationSessionPort\" src/shared/workflow/validation-session-adapter.ts && grep -q \"from \\\"./validation-engine\" src/shared/workflow/validation.ts && ! grep -qE \"async function run(MechanicalValidationPhase|SemanticReviewPhase|HumanReviewPhase|ValidatedReviewerPhase|PublicationPhase)\" src/shared/workflow/validation.ts"
      rationale: "The engine owns the substantive loop body (not a re-export shim), the session adapter is real, the public entry delegates to the engine, and no phase implementation remains defined in validation.ts — a rename-plus-shims counterfeit fails these greps."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-04T23:20:19-0400"
status: "verified"
origin: "internal"
implementedAt: "2026-08-05T04:08:44.647Z"
verifiedAt: "2026-08-05T04:28:17.206Z"
userVerifiedAt: null
executionReport: "Session-independent validation engine extraction complete. All 11 Implementation Steps, all 4 Objective Checks, and the full Verification Plan pass.\n\n**Implementation**\n- `validation.ts` shrunk from 2,482 → 125 lines: public composition root only. Every prior runtime export preserved (10 validation-helpers re-exports, `SYSTEM_SEMANTIC_REVIEW_PORT`, `SemanticReviewPort`, `WorkflowValidationResult`, `runMechanicalValidation`, `runValidationLoop`, `runValidationPhase`); `runValidationLoop`/`runValidationPhase` keep the old `hostedSession`/`sessionManager?`/`semanticReviewPort`/`git`/`localCI`/`workRecordMnemosynePort` shape, verified by `git show HEAD` export diff and unchanged imports in `orchestrator.ts`, `epic-continuation.ts`, `agent-handler.ts`, `validation-test-helpers.js`.\n- 13 new `.ts` modules: `validation-ports.ts` (287), `validation-types.ts` (152), `validation-engine.ts` (226), `validation-context.ts` (239), `validation-mechanical.ts` (402), `validation-semantic.ts` (548), `validation-human-review.ts` (242), `validation-publication.ts` (418), `validation-merge-repair.ts` (179), `validation-emit.ts` (213), `validation-interactions.ts` (46), `validation-session-adapter.ts`, all under 1000 lines (OC1/OC2 green).\n- `validation-session-adapter.ts` is the only new session/Pi-coupled module: implements every `ValidationSessionPort` method (workflow state, position, progress, interactions, abort registration, completion-gated turns with claim/acknowledge, isolated sessions with opaque-handle casts, display names, handoffs) and translates engine requests to the pre-existing `IsolatedAgentSessionOptions` shape, converting returned Pi messages with `readLatestReviewOutcome`/`readLatestTaskCompletedReport`/`usedReviewDiffTool`/`hasTrustedClaudeMcpReview` — injected `semanticReviewPort` fixtures behave exactly as before (review-loop tests pass).\n- Stale diff-scope helpers deleted from `validation.ts`; engine imports canonical `validation-scope.ts` versions; `unaccountedOpenItems` moved to `review-ledger.ts` with `validation-helpers.ts` re-exporting it; the `validation.ts` re-export chain resolves.\n- No injection seams added: `deno task seams:check` green against unchanged baseline (0 seams); the port is a plain required engine argument; engine's `localCI` port takes only `{ cwd }` with the real HostedSession bound at the composition root.\n- `architecture-boundary.test.ts` lists the 6 new engine modules in `HIGH_LEVEL_FILES`; `session/architecture-boundary.test.js` gains the durable whitelist rule (only `validation.ts`, `validation-session-adapter.ts`, `validation-helpers.ts`, `validation-local-ci.ts`, `validation-position.ts`, `validation-progress.ts`, `validation-prompts.ts` may import `@earendil-works`/`../session/`) — passes green. `docs/domain-language.md` glossary names the session-independent engine without claiming Attached behavior.\n\n**Objective Checks** — OC1 (125 < 1000) ✓, OC2 (all `validation*.ts` < 1000) ✓, OC3 (11 engine modules exist, none import Pi/session) ✓, OC4 (engine owns `export async function runValidationLoop` + `MAX_PHASES_PER_CALL`; adapter real; entry imports `./validation-engine`; no phase impl defined in `validation.ts`) ✓.\n\n**Verification**\n- `deno task check` green (563 files); `deno task language-policy:check` green; `deno task seams:check` green; `deno task lint` clean.\n- Full verification-suite test list (20 files incl. both architecture boundaries): 140 passed, 0 failed.\n- `deno task ci` full run: green — 247 files passed, 0 failed (submodules, type-check, workspace check, lint, language policy, seams, doc-links, tests).\n- Manual: no `.wld/` lock/journal artifacts under the checkout after validation-loop runs (only the pre-existing tracked `settings.json`).\n- Behavior preservation covered by the unchanged suites: CI/Objective-Check repair gating and 3-round limits, semantic discovery/verify rounds + ledger nudges + round-limit decision + `changes_requested` re-entry, human-review modes/pauses/metadata, publication transaction/merge repair/settlement/handoffs, position memory, status healing, progress seeding/panel, metrics.\n\n**Test-count delta** — no tests deleted or added. `validation-lifecycle-source.test.js` was rewritten in place (same 3 tests and assertions): the dispatcher and publication-transaction tests now extract source from `validation-engine.ts` / `validation-publication.ts` — required because OC4 forbids `async function runPublicationPhase` in the entry, which the old test demanded there. `validation-progress.ts` gained one additive export (`setCurrentValidationProgress`) so the adapter can honestly implement the port's `setCurrentProgress` method; no behavior change."
workRecord:
    status: "generated"
    recordId: "23132ec9-d776-4762-94c4-971c940f64c4"
    path: "docs/work-records/2026-08-05-session-independent-workflow-validation-engine-extracted-from-validation-ts.md"
    lastAttemptAt: "2026-08-05T04:29:06.200Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "9009994cc9c04591f038faa220556d139b7a55bf"
    targetBranch: "main"
    targetHeadBeforeMerge: "2c407f872b8dcb04b64d976a6624e7a50851eb14"
routingIntent: "PLANNED_CHANGE"
sessionName: "validation engine refactor"
validationCiAttempts: 0
validationSemanticRounds: 1
updatedAt: "2026-08-09T05:03:26.240Z"
archivedAt: "2026-08-09T05:03:26.240Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/session-independent-validation-engine.md"
---

# Session-Independent Validation Engine

## Context

`src/shared/workflow/validation.ts` is a 2,482-line Workflow Validation driver with 102 symbols: the phase loop
(mechanical → semantic → delivery) driven by Plan Lifecycle statuses, CI repair and Objective-Failing Check convergence,
Semantic Code Review rounds with ledger convergence, optional human review, guarded publication/merge, merge-conflict
repair, progress-panel emission, and user pauses. It is the largest remaining P1 file.

It is also the hard prerequisite for Attached Mode. `plans/attached-mode-claude-feature-preview.md`
(ready_for_decomposition) records that the file "contains 86 direct references to Pi/session turn machinery; an
Attached-specific copy would be a second validation engine, not small adapter code." The Epic is blocked until a
separately approved Plan "extract[s] the Workflow Validation sequencing, convergence policy, and gate predicates into a
session-independent engine consumed by the existing Pi path," preserving current Core Session validation behavior under
the shared engine. ADR-014 names this engine as a domain authority the `AttachedWorkflowCoordinator` calls, while
SessionRuntime is deliberately absent from the Attached path.

The repository already has the extraction pattern this needs: `plans/split-workflow-entrypoint-modules.md` (verified)
split `workflow.js` into cohesive modules under 1000 lines with the original file kept as a thin public entry point, and
`docs/plans/finish-injection-seam-ownership-enforcement.md` establishes the capability-port ownership heuristic (agent
turns and user interactions are genuine boundaries and may be ports; Plan Lifecycle, transitions, registry, and locks
are RunWield-owned machinery and never ports). Sibling extractions already exist: `validation-helpers.ts` (646),
`validation-scope.ts` (74), `validation-prompts.ts` (56), `validation-progress.ts` (204), `validation-position.ts` (72),
`validation-local-ci.ts`, `execution-context.ts` (587), `review-ledger.ts` (155), `review-diff-tool.js` (477).

The split is also overdue on its own terms: `validation.ts` duplicates four diff-policy helpers (`isPlanDocumentPath`,
`extractDiffPaths`, `hasImplementationDiff`, `requiresImplementationDiff`) that already have canonical implementations
in `validation-scope.ts` (the loop's copies predate the extraction and can drift).

## Objective

Deliver a session-independent Workflow Validation engine that:

- splits `src/shared/workflow/validation.ts` into cohesive modules, every final file under 1000 lines, with
  `validation.ts` kept as the public entry point for existing callers;
- removes Pi/session turn machinery from the sequencing, convergence, and gate logic — engine modules import neither
  `@earendil-works/*` nor `../session/*` — and confines all such coupling to one adapter module;
- preserves current Core Session validation behavior exactly: same phases, statuses, events, convergence policy, repair
  limits, merge safeguards, user pauses, progress panel, and metrics; no user-visible lifecycle or status semantics
  change;
- keeps the existing public `runValidationLoop` / `runValidationPhase` signatures working, so `orchestrator.ts`,
  `epic-continuation.ts`, `validation-test-helpers.js`, and every validation-loop test file run unchanged;
- makes the engine consumable by the future Attached coordinator: the engine's public entry takes an explicit
  `session: ValidationSessionPort` argument that any runtime (SessionRuntime or AttachedWorkflowCoordinator) can
  implement.

## Approach

Extraction refactor, not behavior rewrite. The engine is what validation.ts already is minus the session surface; the
session surface becomes a port; one adapter wires the port to the real Pi/HostedSession machinery; `validation.ts`
becomes the Pi path's composition root with its current argument shape.

### Port contract (engine-owned, no session imports)

`validation-ports.ts` defines `ValidationSessionPort`, the only way the engine touches session machinery:

```ts
type ValidationSessionPort = {
    cwd: string;
    // Active execution workflow state (session-owned; coordinator owns its equivalent later)
    getActiveWorkflow(): ValidationWorkflowState | null;
    setActiveWorkflow(workflow: ValidationWorkflowState): void;
    // Per-run phase position memory (validation-position.ts behind the port)
    getPosition(planName: string): ValidationPosition | undefined;
    rememberPosition(planName: string, position: ValidationPosition): void;
    clearPosition(planName: string): void;
    // Progress panel + status lines (validation-progress.ts behind the port)
    getCurrentProgress(): ValidationProgressRecord | undefined;
    setCurrentProgress(progress: ValidationProgressRecord): void;
    emitStatus(
        message: string,
        level: "info" | "success" | "warning" | "error",
        progress?: ValidationProgressRecord,
    ): void;
    // User interactions (requestHostedSessionInteraction behind the port)
    requestInteraction(request: ValidationInteractionRequest): Promise<ValidationInteractionResponse>;
    // Escape-cancel registration for Objective-Failing Checks
    registerActiveInteraction(id: string, abortController: AbortController): void;
    unregisterActiveInteraction(id: string): void;
    // Completion-gated repair turns (runActiveAgentTurn + claim/acknowledgeTaskCompletion behind the port)
    runActiveAgentTurn(request: ActiveAgentTurnRequest): Promise<AgentTurnOutcome>;
    // Isolated agent sessions: Semantic Reviewer and Reviewer-Feedback Engineer
    createInMemorySessionManager(cwd: string): SessionManagerHandle;
    runIsolatedAgentSession(request: IsolatedAgentSessionRequest): Promise<IsolatedAgentSessionOutcome>;
    // Display names for messages (getAgentDisplayName behind the port)
    getAgentDisplayName(agentName: string, projectRoot: string): string;
    // Post-verification handoffs (runFeaturePostVerificationHandoffs behind the port)
    runPostVerificationHandoffs(params: PostVerificationHandoffParams): Promise<void>;
};
```

Key contract shapes (defined in `validation-ports.ts`, structurally compatible with the session types they replace):

- `ValidationWorkflowState` — the engine's own subset of `ActiveExecutionWorkflow` (planName, triageMeta,
  executionAgent, executionStarted, executionMode, baselineTree, projectRoot, executionCwd, worktreeId, worktreeBranch,
  worktreeBaseBranch, worktreeBaseRef, worktreeBaseCommit, nonGitInPlace, validationContinuation, semanticRound,
  reviewLedger, repairBaselineTree, lastRepairReport, humanReviewCycle). Structurally assignable both ways at the
  adapter boundary.
- `AgentTurnOutcome = { completed: boolean; report: string }` — the adapter runs the turn, then claims and acknowledges
  task completion internally (it owns `hostedSession.getRootAgentSession()`); the engine never sees Pi messages. This is
  what `dispatchCiRepair`, `dispatchObjectiveCheckRepair`, and `dispatchMergeRepair` consume.
- `IsolatedAgentSessionRequest` — discriminated:
  `{ kind: "reviewer"; agentName; userRequest; cwd; reviewerMode:
  "discovery" | "verify"; customTools: OpaqueToolDefinition[]; sessionManager: SessionManagerHandle }`
  or
  `{ kind: "feedback_engineer"; agentName; userRequest; cwd; images?; customTools: OpaqueToolDefinition[];
  sessionManager: SessionManagerHandle }`.
- `IsolatedAgentSessionOutcome` — typed, not raw messages: for reviewer sessions
  `{ reviewOutcome:
  ValidationReviewOutcome | null; usedDiffTool: boolean; trustedClaudeMcpReview: boolean; executionError?: string }`;
  for feedback-engineer sessions `{ taskReport: { completed: boolean; report: string }; executionError?: string }`. The
  adapter computes these by running the existing message inspectors (`readLatestReviewOutcome`,
  `readLatestTaskCompletedReport`, `usedReviewDiffTool`, `hasTrustedClaudeMcpReview`) against the returned messages, so
  the raw-message inspection stays in the session-coupled layer and the engine receives one semantic contract — the same
  direction the Epic requires for Pi tool results.
- `OpaqueToolDefinition` and `SessionManagerHandle` — phantom-branded opaque handles
  (`{ readonly __opaque: unique symbol }`), cast once inside the adapter to the Pi `ToolDefinition` / `SessionManager`
  types. The engine only creates review-diff tools through `createReviewDiffTool` (session-independent) and passes the
  handle through; it never imports a Pi type.

### Module layout (all new files under 1000 lines)

| File                            | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validation-ports.ts`           | Port interfaces, engine-owned contract types (`ValidationWorkflowState`, `ValidationProgressRecord`, `ValidationInteractionRequest/Response`, `AgentTurnOutcome`, `IsolatedAgentSessionRequest/Outcome`, `ValidationReviewOutcome`, `OpaqueToolDefinition`, `SessionManagerHandle`), reviewer tool policy note                                                                                                                                                                                                                                                                                                                                                   |
| `validation-types.ts`           | Shared engine-internal types (`WorkflowValidationResult`, `ValidationPhaseResult`, `ValidationLoopArgs`, `PhaseContext`, `SemanticRoundState`, `HumanReviewMetadata`, `PublicationOutcome`, `UserActionPause`, `ReviewFeedbackRepairPacket`, `ObjectiveCheckPhaseOutcome`) and constants (`AUTOMATIC_ROUNDS`, `DISCOVERY_ROUNDS`, `MAX_PHASES_PER_CALL`, `VALIDATION_STATUS_ORDER`, `PHASE_STATUS`, `MAX_AGENT_MERGE_REPAIRS`)                                                                                                                                                                                                                                   |
| `validation-engine.ts`          | `runValidationLoop`, `runValidationPhase`, `healStatusAheadOfPhase`, `resolveNextPhase`, `loadCanonicalValidationPlan`, `getPlanContentStatus` — the sequencing and phase-selection gate predicates, driven by Plan Lifecycle statuses                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `validation-context.ts`         | `resolvePhaseContext` (execution-context resolution + `workflowBase` construction), `getProjectRoot`, `getDiffText`, `recordMetric`, `getPlanAttrs`, front-matter readers (`readCiAttempts`, `readSemanticRound`, `readSemanticRoundState`, `hasFinalHumanReviewDecision`, `readHumanReviewMetadata`), `preserveValidationContinuationState`, `recordLifecycleEvent`, `phaseForRecordedStatus`                                                                                                                                                                                                                                                                   |
| `validation-mechanical.ts`      | `runMechanicalValidationPhase`, `runPlanObjectiveChecks`, `dispatchObjectiveCheckRepair`, `dispatchCiRepair`, `ObjectiveCheckPhaseOutcome`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `validation-semantic.ts`        | `runSemanticReviewPhase`, `runValidatedReviewerPhase`, `runReviewerRound`, `buildSemanticReviewAttempt`, `dispatchReviewFeedbackRepair`, `promptForSemanticRoundLimit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `validation-human-review.ts`    | `runHumanReviewPhase` (+ inner `requestHumanReviewDecision`), `normalizeHumanReview`, `formatCodeReviewAnnotations`, `persistHumanReviewMetadata`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `validation-publication.ts`     | `runPublicationPhase`, `attemptPublication`, `publishOnce`, `confirmPublishedPlanVerified`, `isPlanAlreadyPublished`, `settlePublishedWorktree`, `runPostVerificationHandoffs`, `buildVerifiedResult`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `validation-merge-repair.ts`    | `getMergeRepairCwd`, `getMergeFailureKind`, `getMergeWorktreePath`, `getBlockingPaths`, `resolveStoredValidationMergeRepairWorktree`, `readValidationMergeRepairWorktree`, `filesystemPathExists`, `persistValidationMergeRepairWorktree`, `describeMergePause`, `dispatchMergeRepair`                                                                                                                                                                                                                                                                                                                                                                           |
| `validation-emit.ts`            | `emitStatus`, `emitProgress`, `emitHalted`, `seedProgressForStatus`, `clampCycle` (progress-panel emission over the port)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `validation-interactions.ts`    | `requestInteraction`, `pauseForUserAction`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `validation-session-adapter.ts` | `createValidationSessionPort(hostedSession, { sessionManager?, semanticReviewPort? })` and `systemSemanticReviewPort`. The **only** module importing `../session/*` or `@earendil-works/*` for the engine's sake. Implements every port method over HostedSession, `runActiveAgentTurn`, `runIsolatedAgentSession`, `requestHostedSessionInteraction`, `emitSystemStatus`/`validation-progress.ts`, `validation-position.ts`, `claimPendingTaskCompletion`/`acknowledgeTaskCompletion`, `getAgentDisplayName`, `runFeaturePostVerificationHandoffs`, `REVIEWER_SUBAGENT_TOOLS` (reviewer tool names resolve here, not in the engine), and the message inspectors |
| `validation.ts`                 | Public entry point under 1000 lines: keeps the current exported signature `runValidationLoop({ hostedSession, planName, planContent, triageMeta, sessionManager?, executionContext?, git, localCI, semanticReviewPort?, workRecordMnemosynePort })`, builds the adapter port internally, delegates to the engine, and re-exports the existing surface (`SYSTEM_SEMANTIC_REVIEW_PORT`, `WorkflowValidationResult`, and the `validation-helpers.ts` / `validation-prompts.ts` / `validation-scope.ts` re-exports) so `orchestrator.ts`, `epic-continuation.ts`, and all test files import unchanged                                                                |

The engine modules import only session-independent modules: `plan-store.js`, `constants.js`, `validation-scope.ts`,
`validation-delivery-hierarchy.ts`, `worktree.js`, `worktree-registry.js`, `settings.js`, `metrics.js`,
`git-snapshot.js`, `objective-checks.ts`, `plan-lifecycle.js`, `execution-context.ts`, `state-transition.ts`,
`review-diff-tool.js`, `review-ledger.ts`, `validation-merge-verification.ts`, `work-records/mnemosyne-port.ts` (types),
and `git-port.ts` (types). Plan Lifecycle, transitions, registry writes, and locks remain direct engine imports — never
ported, per the ownership heuristic.

### Consolidations required by the split

- Delete `validation.ts`'s private copies of `isPlanDocumentPath`, `extractDiffPaths`, `hasImplementationDiff`,
  `requiresImplementationDiff`; the engine imports the canonical `validation-scope.ts` implementations. The scope
  versions are behavior-equivalent for current inputs (fail-open on unparseable diffs is the canonical intent).
- Move `unaccountedOpenItems` from `validation-helpers.ts` into `review-ledger.ts` (it is pure ledger logic and
  session-independent); keep the `validation.ts` re-export path intact by re-exporting from `review-ledger.ts`.
- The message inspectors (`readLatestReviewOutcome`, `readLatestTaskCompletedReport`, `usedReviewDiffTool`,
  `hasTrustedClaudeMcpReview`) stay where they are (workflow-results.js / validation-helpers.ts) and are called only
  from `validation-session-adapter.ts`.

### Compatibility guarantees

- Public args unchanged: `hostedSession` stays required, `semanticReviewPort` stays optional-and-injectable (tests pass
  `NO_ISOLATED_AGENT_PORT` and custom message-returning ports; the adapter translates engine requests to the old
  `IsolatedAgentSessionOptions` shape, calls the injected port, and converts returned messages back to typed outcomes
  with the same inspectors, so fixture behavior is preserved).
- `validation-test-helpers.js` needs no change beyond what the extraction requires (its `ValidationTestArgs` derives
  from `Parameters<typeof runValidationLoopImpl>`, which is unchanged).
- `orchestrator.ts` and `epic-continuation.ts` imports and re-exports are unchanged.
- Reviewer in-memory session manager: the engine calls `session.createInMemorySessionManager(executionCwd)` once per
  review round (as `runReviewerRound` does today with `SessionManager.inMemory(context.executionCwd)`) and passes the
  opaque handle through every nudge attempt, preserving the shared-manager-per-round behavior exactly.

## Files to Modify

- `src/shared/workflow/validation.ts` — shrink to the public entry/composition root under 1000 lines; preserve every
  current runtime export and the current `runValidationLoop` / `runValidationPhase` argument shape.
- `src/shared/workflow/validation-ports.ts` — new: port interfaces and engine-owned cross-boundary contract types.
- `src/shared/workflow/validation-types.ts` — new: shared engine-internal types and constants.
- `src/shared/workflow/validation-engine.ts` — new: loop + phase sequencing + gate predicates.
- `src/shared/workflow/validation-context.ts` — new: phase context resolution and shared lifecycle/metric helpers.
- `src/shared/workflow/validation-mechanical.ts` — new: Mechanical Validation phase, Objective-Failing Checks, CI and
  Objective-Failing Check repair dispatch.
- `src/shared/workflow/validation-semantic.ts` — new: Semantic Code Review phase, reviewer rounds, feedback repair,
  round-limit decision.
- `src/shared/workflow/validation-human-review.ts` — new: Local Human Code Review phase and metadata persistence.
- `src/shared/workflow/validation-publication.ts` — new: publication phase, merge transaction, settlement, handoffs.
- `src/shared/workflow/validation-merge-repair.ts` — new: merge failure classification, repair worktree persistence,
  merge repair dispatch, user-facing merge pause messages.
- `src/shared/workflow/validation-emit.ts` — new: status/progress panel emission over the port.
- `src/shared/workflow/validation-interactions.ts` — new: `requestInteraction` and `pauseForUserAction`.
- `src/shared/workflow/validation-session-adapter.ts` — new: the only session/Pi-coupled module; implements
  `ValidationSessionPort` over the real session machinery.
- `src/shared/workflow/review-ledger.ts` — move `unaccountedOpenItems` here (single implementation, session-free).
- `src/shared/workflow/validation-helpers.ts` — re-export `unaccountedOpenItems` from `review-ledger.ts` so existing
  import paths stay valid; no other change required.
- `src/shared/workflow/architecture-boundary.test.ts` — add the new engine modules that perform lifecycle/worktree
  orchestration to `HIGH_LEVEL_FILES` so raw Plan status/front-matter writes cannot re-enter through the split.
- `src/shared/session/architecture-boundary.test.js` — add a durable rule: any production `validation*.ts` module in
  `src/shared/workflow` that imports `@earendil-works/*` or `../session/*` must be exactly one of the whitelist
  `validation.ts`, `validation-session-adapter.ts`, `validation-helpers.ts`, `validation-local-ci.ts`,
  `validation-position.ts`, `validation-progress.ts`, `validation-prompts.ts` (test files excluded). This is green both
  before and after the refactor, so it guards the future: a renamed monolith or a new session-coupled engine module
  fails it.
- `docs/domain-language.md` — in the same change, extend the **Workflow Validation** glossary entry (or add one short
  entry for the session-independent validation engine) to state that validation sequencing/convergence is a
  session-independent engine shared by the Core Session runtime, without naming Attached behavior that does not exist
  yet. No user-visible lifecycle or status terms change.

## Reuse Opportunities

- `src/shared/workflow/validation-scope.ts` — canonical diff-scope and classification predicates; delete the stale
  copies in `validation.ts` and import these.
- `src/shared/workflow/validation-progress.ts` and `validation-position.ts` — keep as-is; the adapter calls them with
  the real HostedSession, the engine reaches them only through the port.
- `src/shared/workflow/validation-local-ci.ts` — keep `LocalCIPort` / `systemLocalCIPort` as the engine's CI port
  argument (already session-independent behind `spawnForegroundShell` and a settings lookup).
- `src/shared/workflow/execution-context.ts` — `resolveValidationExecutionContext` is already session-independent and
  takes `activeWorkflow` as a plain argument; the engine passes the port's `getActiveWorkflow()` result.
- `src/shared/workflow/state-transition.ts`, `plan-lifecycle.js`, `worktree.js`, `worktree-registry.js`,
  `validation-delivery-hierarchy.ts`, `validation-merge-verification.ts` — direct engine imports; no ports.
- `src/shared/workflow/review-ledger.ts`, `objective-checks.ts`, `review-diff-tool.js`, `git-snapshot.js`, `metrics.js`
  — session-independent, reused as today.
- `src/shared/workflow/validation-helpers.ts` / `workflow-results.js` — message inspection stays here and is consumed by
  the adapter to build typed port outcomes.
- `plans/split-workflow-entrypoint-modules.md` — the verified precedent for entry-point preservation, module list shape,
  line-ceiling objective checks, and verification commands.
- `src/shared/workflow/validation-test-helpers.js` — `makeRecordedSession`, `makeValidationProjectRoot`,
  `UNEXPECTED_VALIDATION_PORTS`, `NO_ISOLATED_AGENT_PORT` continue to drive the loop tests through the public entry.

## Implementation Steps

- [ ] `src/shared/workflow/validation.ts` is under 1000 lines and remains the public entry point: every runtime export
      it exposes today (including `runValidationLoop`, `runValidationPhase`, `SYSTEM_SEMANTIC_REVIEW_PORT`,
      `WorkflowValidationResult`, and the `validation-helpers.ts` / `validation-prompts.ts` / `validation-scope.ts`
      re-exports) is still importable from `./validation.ts`, and its `runValidationLoop` / `runValidationPhase`
      argument shape still accepts `hostedSession`, `sessionManager?`, `semanticReviewPort?`, `git`, `localCI`, and
      `workRecordMnemosynePort`.
- [ ] `src/shared/workflow/validation-ports.ts` owns and exports `ValidationSessionPort` with the methods listed in
      Approach (workflow state, position, progress/status, interaction, abort registration, agent turns, isolated
      sessions, display names, post-verification handoffs), plus the engine-owned contract types
      (`ValidationWorkflowState`, `AgentTurnOutcome`, `IsolatedAgentSessionRequest/Outcome`, `ValidationReviewOutcome`,
      `SessionManagerHandle`, `OpaqueToolDefinition`); it contains no `@earendil-works` or `../session/` import.
- [ ] `src/shared/workflow/validation-engine.ts` owns `runValidationLoop`, `runValidationPhase`,
      `healStatusAheadOfPhase`, `resolveNextPhase`, `loadCanonicalValidationPlan`, and `getPlanContentStatus`;
      `src/shared/workflow/validation.ts` no longer contains the substantive bodies of any of these (only the
      adapter-construction wrapper and re-exports).
- [ ] `src/shared/workflow/validation-mechanical.ts` owns `runMechanicalValidationPhase`, `runPlanObjectiveChecks`,
      `dispatchObjectiveCheckRepair`, and `dispatchCiRepair`; `src/shared/workflow/validation-semantic.ts` owns
      `runSemanticReviewPhase`, `runValidatedReviewerPhase`, `runReviewerRound`, `buildSemanticReviewAttempt`,
      `dispatchReviewFeedbackRepair`, and `promptForSemanticRoundLimit`;
      `src/shared/workflow/validation-human-review.ts` owns `runHumanReviewPhase`;
      `src/shared/workflow/validation-publication.ts` owns `runPublicationPhase` and `publishOnce`;
      `src/shared/workflow/validation-merge-repair.ts` owns the merge-repair helpers; none of these functions is defined
      in `src/shared/workflow/validation.ts`.
- [ ] `src/shared/workflow/validation-session-adapter.ts` owns
      `createValidationSessionPort(hostedSession, { sessionManager?, semanticReviewPort? })` and is the only new module
      with `@earendil-works` or `../session/` imports; its `runIsolatedAgentSession` implementation translates engine
      requests to the pre-existing `IsolatedAgentSessionOptions` shape (calling an injected `semanticReviewPort` when
      provided, the system implementation otherwise) and converts returned Pi messages into typed
      `IsolatedAgentSessionOutcome`s using `readLatestReviewOutcome`, `readLatestTaskCompletedReport`,
      `usedReviewDiffTool`, and `hasTrustedClaudeMcpReview`.
- [ ] `src/shared/workflow/validation.ts` builds the adapter port from its arguments and passes `session` plus the
      existing `git`, `localCI`, `workRecordMnemosynePort`, `planName`, `planContent`, `triageMeta`, and
      `executionContext` to the engine's `runValidationLoop` / `runValidationPhase`; the engine's `ValidationLoopArgs`
      requires `session: ValidationSessionPort` instead of `hostedSession`.
- [ ] The stale diff-scope helpers are gone from `src/shared/workflow/validation.ts`; the engine imports
      `isPlanDocumentPath`, `extractDiffPaths`, `hasImplementationDiff`, and `requiresImplementationDiff` from
      `validation-scope.ts`, and `src/shared/workflow/review-ledger.ts` owns `unaccountedOpenItems` with
      `validation-helpers.ts` re-exporting it (the `validation.ts` re-export chain still resolves).
- [ ] Every production module this Plan creates or reshapes is a `.ts` file under 1000 lines, and
      `deno task language-policy:check` stays green without expanding the JavaScript baseline.
- [ ] The extraction adds no injection seams: `deno task seams:check` passes against the unchanged baseline (no
      `__deps`/`__testDeps` bag, no conditional seam; the port is a plain required argument).
- [ ] `src/shared/workflow/architecture-boundary.test.ts` lists the new lifecycle/worktree-orchestrating engine modules
      (engine, mechanical, semantic, human-review, publication, merge-repair) in `HIGH_LEVEL_FILES`, and
      `src/shared/session/architecture-boundary.test.js` contains the whitelist rule asserting that the only
      session/Pi-coupled `validation*.ts` production modules are `validation.ts`, `validation-session-adapter.ts`,
      `validation-helpers.ts`, `validation-local-ci.ts`, `validation-position.ts`, `validation-progress.ts`, and
      `validation-prompts.ts` (test files excluded).
- [ ] `docs/domain-language.md` describes Workflow Validation as running on a session-independent validation engine
      (sequencing and convergence shared by the Core Session runtime), without claiming Attached behavior that is not
      implemented yet.

## Verification Plan

- Automated: `deno task check`
- Automated: `deno task language-policy:check`
- Automated: `deno task seams:check`
- Automated: `deno task lint`
- Automated: the full validation loop suite plus boundaries, unchanged imports:
  `deno run -A scripts/run-tests.js src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/validation-loop-recovery.test.js src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-publication-pause.test.js src/shared/workflow/validation-lifecycle-resume.test.js src/shared/workflow/validation-lifecycle-source.test.js src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-work-record-handoff.test.ts src/shared/workflow/mechanical-validation.test.ts src/shared/workflow/validation-manual-qa.test.ts src/shared/workflow/validation-prompts.test.js src/shared/workflow/validation-progress.test.ts src/shared/workflow/validation-scope.test.ts src/shared/workflow/execution-context.test.js src/shared/workflow/orchestrator.test.ts src/shared/workflow/architecture-boundary.test.ts src/shared/session/architecture-boundary.test.js`
- Automated: `deno task ci` (full suite, twice concurrently is not required for an extraction, but the parallel-lock
  property must not regress; a single `deno task ci` run must be green)
- Manual: confirm no `.wld/` lock/journal files appear under the checkout after a run that exercises a validation loop.
- Expected preserved behavior (existing tests that cover reshaped code must be kept, moved, or rewritten against the new
  module paths — never deleted without a replacement):
  - CI pass/fail, canceled-CI pause, Objective-Failing Check passed/skipped/unmet/broken, CI and Objective-Failing Check
    repair dispatch with `task_completed` gating, and the 3-round limit + Retry/Stop pauses.
  - Semantic Code Review discovery rounds 1–2, verify rounds 3+, diff-inspection and open-finding accountability nudges,
    ledger convergence, repair dispatch, round-limit Continue/Code Review/Stop decision, and `changes_requested`
    human-feedback re-entry.
  - Local Human Code Review mode none/ask/always, approval/feedback/closed-window pauses, and metadata persistence.
  - Publication: non-Git in-place, worktree merge with staging, primary-checkout plan-path snapshot/restore,
    `direct_delivery` transaction journaling, post-merge verification, merge-conflict repair worktree persistence,
    target-checked-out and dirty-primary-checkout pauses, worktree settlement/cleanup, post-verification handoffs, and
    verified-result construction with progress-panel closure.
  - Phase position memory, status healing (`healStatusAheadOfPhase`), `validation_failed` reset, progress seeding and
    panel emission, and metrics (`ci_attempt`, `objective_checks_attempt`, `semantic_review_result`).
- Expected stopped behavior: none. This is a structural extraction; no user-visible Workflow Validation, Plan Lifecycle,
  worktree, merge, or progress semantics are intentionally removed or changed.

### Objective-Failing Checks

Type-check, lint, and the existing suite would all pass on a no-op change, so these prove the requested shape changed.
They were adversarially reviewed: a counterfeit that renames the monolith and manufactures empty shims must fail at
least one check, and each check is red on today's tree.

- `OC1` — `test "$(wc -l < src/shared/workflow/validation.ts)" -lt 1000` — the 2,482-line monolith is no longer the
  entry point.
- `OC2` —
  `for f in src/shared/workflow/validation*.ts; do test -f "$f" && test "$(wc -l < "$f")" -lt 1000 || exit 1; done` —
  every `validation*.ts` module in the directory (entry, engine modules, adapter, and pre-existing siblings) is under
  the requested ceiling. This uses the directory glob rather than an enumerated list, so a renamed monolith that keeps a
  `validation-*` name is caught no matter what it is called.
- `OC3` —
  `F="validation-ports.ts validation-types.ts validation-engine.ts validation-context.ts validation-mechanical.ts validation-semantic.ts validation-human-review.ts validation-publication.ts validation-merge-repair.ts validation-emit.ts validation-interactions.ts"; cd src/shared/workflow; for f in $F; do test -f "$f" || exit 1; done; ! grep -lE "@earendil-works|\.\./session/" $F`
  — the 11 engine modules exist and none imports Pi packages or `../session/` modules: the engine is
  session-independent.
- `OC4` —
  `grep -q "export async function runValidationLoop" src/shared/workflow/validation-engine.ts && grep -q "MAX_PHASES_PER_CALL" src/shared/workflow/validation-engine.ts && grep -q "createValidationSessionPort" src/shared/workflow/validation-session-adapter.ts && grep -q "from \"./validation-engine" src/shared/workflow/validation.ts && ! grep -qE "async function run(MechanicalValidationPhase|SemanticReviewPhase|HumanReviewPhase|ValidatedReviewerPhase|PublicationPhase)" src/shared/workflow/validation.ts`
  — the engine owns the substantive loop (defined body, not a re-export shim), the adapter is real, the entry delegates
  to the engine, and no phase implementation is defined in the entry. A pass-through
  `export { runValidationLoop } from
  "./validation-impl.ts"` fails the `export async function runValidationLoop` and
  `MAX_PHASES_PER_CALL` greps; a monolith that still defines the phases in `validation.ts` fails the last grep.

## Edge Cases & Considerations

- **Counterfeit risk (rename + shims).** A fake implementation could move the 2,482 lines to a renamed file and leave a
  stub `validation.ts`; the checks were adversarially reviewed against exactly that. OC2's directory glob catches any
  renamed monolith that keeps a `validation-*` name; OC3 forces the 11 engine modules to exist import-free; OC4 forces
  the substantive loop body into the engine and the phase bodies out of the entry. A residual dodge would rename the
  monolith to a non-`validation*` name — that is why the durable whitelist rule in
  `src/shared/session/architecture-boundary.test.js` (green before and after, enforced by CI) and the behavioral
  validation-loop suite are part of this Plan's verification, not just the baseline checks.
- **JSDoc/typedef compatibility.** `ActiveExecutionWorkflow` and `WorkflowValidationResult` are JSDoc typedefs consumed
  through `import("...")` in tests and callers. The engine's `ValidationWorkflowState` must be structurally assignable
  to `ActiveExecutionWorkflow` (and vice versa at the adapter). Keep the two `WorkflowValidationResult` declarations
  (validation.ts type alias, validation-helpers.ts interface) reconcilable: one canonical shape in
  `validation-types.ts`, re-exported where the old names were imported.
- **Opaque handles vs the no-`any`/`unknown`/`object` rule.** `SessionManagerHandle` and `OpaqueToolDefinition` are
  phantom-branded interfaces; the single cast from the Pi types happens inside `validation-session-adapter.ts` with an
  explanatory comment. Do not spread `unknown` into engine logic.
- **Behavior preservation of the reviewer session manager.** `runReviewerRound` must keep one in-memory session manager
  per round shared across nudge attempts; the port's `createInMemorySessionManager` exists precisely so this survives
  the boundary.
- **Injected `semanticReviewPort` fixtures.** The loop tests inject `NO_ISOLATED_AGENT_PORT` and custom ports returning
  fake messages. The adapter must translate engine requests to the old options shape and convert returned messages with
  the same inspectors so every fixture behaves exactly as today; a translation bug shows up as a failed nudge or review
  outcome test, not a type error.
- **Position and progress remain session-keyed.** `validation-position.ts` / `validation-progress.ts` keep their
  WeakMap-on-HostedSession keying and are called only by the adapter; the engine's port methods hide the key. Widening
  their parameter types to `object` is not required by this Plan (the Attached coordinator's durable variants are Epic
  scope).
- **Seam ratchet.** No `__deps`/`__testDeps` seams are introduced; the port is an ordinary required argument. If the
  extraction accidentally moves an existing seam location, run `deno task seams:update` only with explicit `--move`
  semantics and never raise a count; expected outcome is that the baseline does not change at all.
- **Scope boundary.** `validation-helpers.ts`, `validation-local-ci.ts`, `execution-context.ts`, and the other
  pre-existing siblings are not de-coupled beyond what this Plan lists (`unaccountedOpenItems` move). Quick-Fix
  mechanical validation, manual QA prompt execution, and CI spawning remain where they are.
- **Open assumptions (reviewable).** (1) Keeping the public `runValidationLoop` signature session-typed, with the port
  built inside `validation.ts`, is correct for zero caller churn; the Attached coordinator will import the engine
  modules directly and implement `ValidationSessionPort` from its own record, which is Epic scope. (2)
  `docs/domain-language.md` gets a minimal glossary touch naming the session-independent engine, without describing
  Attached behavior. (3) No behavior change is intended; any deviation the implementation discovers must be raised
  rather than silently fixed.
