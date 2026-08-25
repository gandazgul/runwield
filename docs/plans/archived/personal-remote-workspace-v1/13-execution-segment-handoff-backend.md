---
planId: "4f16e83d-f127-42cd-8ea3-39fbbfec35fb"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Implement execution and semantic-repair segment handoffs using canonical Plan checks and the transactional rollover continuation marker."
affectedPaths:
    - "src/shared/workflow/execution-segment-handoff.ts"
    - "src/shared/workflow/plan-executor.ts"
    - "src/shared/workflow/engineer-runner.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/cmd/load-plan/"
    - "src/ui/workspace/server/session-continuation.js"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/shared/workflow/execution-segment-handoff.ts && test -f src/shared/workflow/execution-segment-handoff.test.ts && grep -Eq 'export (async )?function buildExecutionSegmentContinuation' src/shared/workflow/execution-segment-handoff.ts && grep -Eq 'export (async )?function buildSemanticRepairSegmentContinuation' src/shared/workflow/execution-segment-handoff.ts && grep -Eq 'export (async )?function resolvePendingSegmentHandoff' src/shared/workflow/execution-segment-handoff.ts && grep -q 'rejects changed canonical Plan and worktree evidence before handoff' src/shared/workflow/execution-segment-handoff.test.ts && grep -q 'treats a marker as pending only before the first seeded turn entry' src/shared/workflow/execution-segment-handoff.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/execution-segment-handoff.test.ts"
      rationale: "The handoff contract and test file do not exist. This requires all three packet/marker operations plus behavioral tests for canonical evidence and one-shot marker semantics."
    - id: "OC2"
      command: "test -f src/shared/session/execution-segment-runtime.test.ts && grep -q 'await this.rollManagedSessionSegment' src/shared/session/session-runtime.js && grep -q 'resolvePendingSegmentHandoff' src/shared/session/session-runtime.js && grep -q 'preparation failure leaves the planning segment current' src/shared/session/execution-segment-runtime.test.ts && grep -q 'committed execution marker resumes in the same successor without a duplicate seed turn' src/shared/session/execution-segment-runtime.test.ts && grep -q 'execution seed excludes Planner history and carries approval images' src/shared/session/execution-segment-runtime.test.ts && deno run -A scripts/run-tests.js src/shared/session/execution-segment-runtime.test.ts"
      rationale: "SessionRuntime does not compose preparation, rollover, and marker resume today. The new real-session suite must prove failure atomicity, exact-once resume, and bounded execution context."
    - id: "OC3"
      command: "test -f src/shared/workflow/semantic-repair-segment-handoff.test.ts && grep -q 'semantic_repair_handoff' src/shared/workflow/validation-types.ts && grep -q 'semantic_repair_handoff' src/shared/session/session-runtime.js && grep -q 'two semantic rejections create two repair segments while Reviewer sessions create none' src/shared/workflow/semantic-repair-segment-handoff.test.ts && grep -q 'repair root context excludes predecessor Engineer and Reviewer history' src/shared/workflow/semantic-repair-segment-handoff.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/semantic-repair-segment-handoff.test.ts"
      rationale: "Semantic rejection currently dispatches an in-memory repair Agent inside validation. This requires a typed engine-to-Runtime handoff and behavioral proof of persisted repeated repairs and context exclusion."
    - id: "OC4"
      command: "grep -q 'Approve for Later creates no execution segment' src/cmd/load-plan/index.integration.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/index.integration.test.ts"
      rationale: "Approve for Later must remain readiness-only. The named integration case is absent and must prove that the shared handoff routing does not create a successor segment."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:48:25.377Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 13
dependencies:
    - "12-session-activated-plan-actions"
implementedAt: "2026-08-12T19:34:21.328Z"
verifiedAt: "2026-08-12T20:30:08.918Z"
userVerifiedAt: null
executionReport: "- Implemented typed execution/semantic-repair continuation packets, canonical evidence validation, and pending-marker detection in `execution-segment-handoff.ts`.\n- Split managed execution through Runtime preparation → standalone rollover → marker resume; unmanaged execution path remains direct.\n- Added Runtime semantic-repair handoff rollover and root repair Agent execution; direct/unmanaged validation keeps legacy in-memory repair behavior unless handoff mode is enabled.\n- Added Workspace backend entrypoint for managed Plan execution handoff and kept Approve for Later readiness-only with no active execution workflow.\n- Tests: added 7 new handoff tests; removed 0 tests; rewrote affected validation-review assertions from disposable feedback-engineer repair to persisted `semantic_repair_handoff` behavior while preserving legacy direct-validation coverage.\n- Verification passed: focused handoff suites, existing rollover/execution/validation suites, Objective-Failing Checks, `deno task seams:check`, and full `deno task ci` (288 files passed, 0 failed).\n- Manual TUI interruption scenarios from the plan were not exercised interactively in this API session."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "4addb1a14d5d5a5a2440ca346a2c0dc118842f00"
    targetBranch: "main"
    targetHeadBeforeMerge: "f36967973eba3d3ac6fadb807675b8996dc031e0"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/13-execution-segment-handoff-backend.md"
---

# Execution and Semantic Repair Segment Handoff Backend

## Context

Approve & Run must move from planning to implementation without putting Planner history in the Engineer model context.
ADR-012 requires the Readiness Gate and execution preparation to succeed before Session Transcript Segment Rollover.
Each Semantic Code Review rejection must use the same boundary so repair starts in a fresh persisted segment rather than
in the execution segment or a disposable in-memory Agent Session.

Slices 10 and 12 are verified. Slice 10 provides standalone transactional rollover, managed segment metadata, and one
opaque continuation marker. Slice 12 provides Plan Action Evidence Check against canonical Plan revision, Plan Status,
and exact worktree evidence under Session Activation.

The current Runtime does not compose these capabilities. Managed `executePlan` and `runValidation` hold one Session
Activation across their full operation, so they cannot call the standalone rollover transaction. `executePlan` also
prepares execution and starts Engineer in one function. Semantic repair uses an in-memory Reviewer-Feedback Engineer
session. The continuation marker is written but no startup path reads it.

## Objective

Implement one execution-handoff backend that:

- completes Plan Action Evidence Check, the Readiness Gate, and execution preparation before it creates an execution
  segment;
- commits preparation as a managed operation, releases Session Activation, performs standalone transactional rollover,
  and starts Engineer in a second managed operation;
- seeds the execution segment with only the approved Plan, approval annotations/images, current lifecycle/worktree
  state, and execution ownership;
- keeps the execution segment current through implementation, isolated Semantic Code Review, and Workflow Validation;
- converts each Semantic Code Review rejection into a typed handoff, then rolls to a fresh repair segment containing the
  frozen Plan requirements, current execution and continuous integration (CI) state, complete open Review Issues,
  applicable repair claims, and bounded repository/diff evidence;
- resumes a committed but not-started handoff from the current segment marker without creating another successor;
- leaves the predecessor current and requires retry when preparation or rollover does not commit; and
- adds no second continuation store, workflow-progress database, or new injection seam.

## Approach

Add `src/shared/workflow/execution-segment-handoff.ts` as the application-owned contract for execution and
semantic-repair handoffs. It defines versioned JSON continuation packets, validates them, builds bounded seed requests,
compares current Plan Action Evidence with the expected Plan/worktree snapshot, and decides whether a current segment
still has a pending handoff. The packet is a startup instruction, not lifecycle authority. Before each consequential
step, canonical Plan and worktree sources are reloaded.

Split managed execution into three fenced operations:

1. A preparation operation revalidates the reviewed Plan, passes readiness where required, runs
   `startActiveExecutionWorkflow`, and checkpoints the resulting workflow/worktree evidence without running Engineer.
2. `rollManagedSessionSegment` commits a new `execution` segment with the execution continuation packet and releases its
   own activation.
3. A normal managed operation opens the generation-named current segment, validates the packet against canonical
   evidence, activates the approved execution owner, and runs the first Engineer turn from the packet seed.

Unmanaged local execution keeps the current direct `executePlan` path. Approve for Later stops after readiness and does
not call preparation or rollover.

Do not add a consumed-marker database or mutable checkpoint. A marker is pending only while the current transcript has
no user or Agent entry after it. Immediate continuation and restart use the same detector. Once the first seeded turn
writes transcript history, normal active-workflow resume applies. A stale, malformed, or canonically incompatible packet
fails closed with refresh or recovery guidance.

For Semantic Code Review, keep Reviewer Agent Sessions isolated and disposable. Change the session-independent
validation engine so a rejection returns a typed `semantic_repair` handoff result after it persists the complete Review
Issue Ledger and repair baseline. The Runtime checkpoints and releases the validation operation, rolls to a
`semantic_repair` segment, runs the execution owner as the root repair Agent with the bounded packet and reconstructed
diff tool, then re-enters Workflow Validation. Human code-review feedback keeps its current repair path; this Plan
changes only Semantic Code Review rejection, as required by ADR-012.

`WorkspaceSessionContinuationService` exposes the same Runtime handoff operation for the later Workspace review UI. It
does not add browser controls or a parallel Workspace workflow implementation.

## Files to Modify

- `src/shared/workflow/execution-segment-handoff.ts` and focused tests — own versioned continuation packet schemas,
  canonical evidence comparison, pending-marker detection, bounded execution/repair seeds, and typed rejection results.
- `src/shared/workflow/plan-executor.ts`, `execution-start.ts`, and `engineer-runner.ts` — separate preparation from the
  first Engineer turn and support execution from a validated handoff without repeating preparation.
- `src/shared/workflow/validation-semantic.ts`, `validation-types.ts`, and `validation-ports.ts` — return a typed
  semantic repair handoff after a rejected review instead of running a disposable repair Agent Session inside the
  validation operation.
- `src/shared/workflow/validation-session-adapter.ts` and tests — keep Reviewer sessions isolated, remove the in-memory
  semantic-repair manager path, and translate Runtime repair completion back into the existing validation contract.
- `src/shared/session/session-runtime.js` and managed Runtime tests — coordinate prepare, checkpoint, rollover, marker
  resume, root Engineer/repair turns, and validation re-entry as separate Session Activation operations.
- `src/shared/session/hosted-session.js` — retain the prepared active workflow across rollover replacement and restore
  it from a validated continuation packet without copying predecessor transcript history.
- `src/shared/session/workflow-context-session.js` — read the existing opaque marker together with transcript position
  so only a marker with no later turn history is pending.
- `src/cmd/load-plan/plan-execution.ts`, `plan-session-surface.ts`, `plan-session-types.ts`, and affected tests — route
  Approve & Run and Ready For Work execution through the shared Runtime handoff while Approve for Later creates no
  segment.
- `src/ui/workspace/server/session-continuation.js` and backend tests — expose the same activated Runtime handoff for a
  checked owner request; UI controls remain in child Plan 17.

No change is expected in `session-activations.js` or `sessions.js`. Slice 10's rollover transaction remains the storage
authority and is reused without workflow-specific behavior.

## Reuse Opportunities

- `src/shared/session/segment-rollover.ts` — use `rollSessionTranscriptSegment` through
  `SessionRuntime.rollManagedSessionSegment`; do not duplicate seal, generation, or orphan handling.
- `src/shared/workflow/plan-actions.ts` — reuse `loadPlanActionEvidence` and its exact worktree expectation shape for
  action-time comparisons.
- `src/shared/workflow/execution-start.ts` — reuse `startActiveExecutionWorkflow` as the only worktree and execution
  preparation authority.
- `src/shared/workflow/engineer-runner.ts` and `workflow-prompts.js` — reuse execution-owner activation and prompt
  construction after removing Planner-only inputs from the handoff seed.
- `src/shared/workflow/review-ledger.ts`, `validation-repair-prompt.ts`, and `review-diff-tool.js` — serialize complete
  open Review Issues and reconstruct the bounded repair prompt and diff access.
- `src/shared/session/workflow-context-session.js` — reuse `readPersistedPendingSegmentContinuation`; extend its result
  with marker position instead of adding another custom-entry type.
- `SessionRuntime.#runManagedOperation` — use the existing hydration, activation, heartbeat, generation publication, and
  active-Agent restoration boundaries for each pre- and post-rollover operation.

## Implementation Steps

- [ ] `execution-segment-handoff.ts` exports `buildExecutionSegmentContinuation`,
      `buildSemanticRepairSegmentContinuation`, and `resolvePendingSegmentHandoff` over closed, versioned `execution`
      and `semantic_repair` packet types. An execution packet contains stable Session/Plan identity, approved whole-file
      revision, approved Plan markdown, approval feedback and images, prepared Plan Action Evidence, prepared
      active-workflow fields, execution owner, and collaboration policy. A repair packet contains the frozen approved
      Plan, current prepared evidence, execution/CI state, semantic round, complete Review Issue Ledger, repair
      baseline, applicable prior repair claims, and the diff evidence needed to reconstruct bounded access. Neither
      packet contains Planner/Reviewer messages, a generated summary, activation proof, local owner-database handle, or
      lifecycle authority.
- [ ] Packet readers reject unknown versions/kinds, missing identity, a different stable Session or Plan, changed Plan
      revision/status/worktree evidence, incompatible execution CWD/worktree identity, and malformed image/diff
      payloads. Safe rejections distinguish refresh from recovery and do not expose local paths.
- [ ] The current-marker reader returns marker payload and entry position. A continuation is pending only when no later
      user, assistant, or tool-result entry exists. A marker with later turn history resumes normal workflow and never
      causes another rollover or duplicate seed turn.
- [ ] Managed execution preparation runs under Session Activation and checkpoints a complete active execution workflow
      before rollover. It uses the canonical reviewed revision and expected worktree evidence, runs readiness only from
      `approved`, accepts an already `ready_for_work` Plan for an explicit Run action, and runs
      `startActiveExecutionWorkflow` exactly once. Preparation failure leaves the planning segment current and does not
      call rollover.
- [ ] Approve for Later performs the existing Readiness Gate and returns with the Plan at Ready For Work. It creates no
      execution packet, successor segment, or active Engineer turn.
- [ ] After successful preparation, managed execution releases its operation, calls the existing standalone rollover
      once with `kind: "execution"`, and starts a second managed operation against the successor generation. The
      successor seed contains the approved Plan, annotations/images, prepared lifecycle/worktree state, and execution
      ownership only. Planner transcript messages and `routerMessage` do not enter the Engineer request.
- [ ] A process stop before rollover commit leaves the predecessor current and reports retry guidance. A stop after
      commit leaves the successor marker pending. Immediate continuation and reload both validate that marker and start
      the Engineer in the existing successor; neither path creates another segment.
- [ ] `executePlan` keeps its unmanaged local behavior. Managed Approve & Run, Ready For Work execution, Plan Recovery
      execution, TUI `load-plan`, and the Workspace continuation backend use the shared handoff coordinator rather than
      directly invoking the old monolithic managed path.
- [ ] A rejected Semantic Code Review persists semantic round, complete Review Issue Ledger, repair baseline, and
      current active workflow, then returns a typed `semantic_repair` handoff from the session-independent validation
      engine. It does not dispatch `feedback_engineer` or allocate an in-memory repair manager.
- [ ] `SessionRuntime.runValidation` checkpoints and releases the rejection operation, rolls once with
      `kind: "semantic_repair"`, and runs the execution owner as the root repair Agent in the prepared execution CWD.
      The repair turn receives the frozen requirements, complete open Review Issues, applicable repair claims, current
      execution/CI state, and a reconstructed `review_diff` tool. It receives no predecessor Engineer or Reviewer model
      history.
- [ ] A completed repair updates the active workflow with its task-completion report and re-enters Workflow Validation.
      A paused or interrupted repair remains the active execution workflow in the current repair segment. Each later
      Semantic Code Review rejection creates exactly one later repair segment. Reviewer Agent Sessions remain isolated
      and never become current Session segments.
- [ ] Engineer remains the active execution owner through implementation, Semantic Code Review, repair, validation,
      recovery, and successful validation. Terminal validation or an explicit new routed User Request remains the only
      path that clears or replaces this workflow ownership.
- [ ] Focused real-session tests cover preparation and rollover failure, stale canonical evidence, Approve for Later,
      approval images, Planner-context exclusion, committed-marker resume, no duplicate successor/turn, isolated
      Reviewer behavior, repeated semantic repairs, predecessor Engineer/Reviewer exclusion, aggregate projection, and
      execution-owner continuity.

## Verification Plan

- Automated: run focused handoff suites with
  `deno run -A scripts/run-tests.js src/shared/workflow/execution-segment-handoff.test.ts
  src/shared/session/execution-segment-runtime.test.ts
  src/shared/workflow/semantic-repair-segment-handoff.test.ts
  src/cmd/load-plan/index.integration.test.ts
  src/ui/workspace/owner-workspace.test.js`.
- Automated: run existing rollover, execution, validation, and managed-Runtime suites with
  `deno run -A scripts/run-tests.js src/shared/session/segment-rollover.test.js
  src/shared/session/session-runtime.test.js src/shared/workflow/plan-executor.integration.test.ts
  src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-review.test.js`.
- Automated: run `deno task seams:check` and prove no Plan, lifecycle, worktree, rollover, lock, or owner-database seam
  was added.
- Automated: run `deno task ci`.
- Automated: use real managed Session and Git fixtures to prove a preparation failure and a pre-commit rollover failure
  leave the predecessor current; a committed marker resumes the same successor and starts one seed turn; changed Plan or
  worktree evidence blocks the handoff before Agent execution.
- Automated: inspect the actual root Agent message arrays. The execution segment contains the approved seed and images
  but no unique Planner-history sentinel. Each repair contains the frozen Plan and complete open Review Issues but no
  unique predecessor Engineer or Reviewer sentinel. Aggregate Transcript Projection still contains all sentinels in
  their owner-visible source segments.
- Automated: prove Approve for Later adds no segment; two rejected semantic rounds add two ordered repair segments;
  Reviewer sessions add none; and Engineer ownership remains current through the final validation result.
- Automated: preserve existing unmanaged execution, worktree preparation, Plan Lifecycle, validation convergence,
  human-feedback repair, pair execution, and rollover behavior. No behavior is expected to stop except disposable
  in-memory repair dispatch for Semantic Code Review rejection; rewrite those assertions to require a persisted repair
  segment rather than delete their coverage.
- Manual: in a managed TUI Session, approve a Plan with an annotated image and Approve & Run. Confirm continuous
  scrollback, one visible Session identity, Engineer starts after preparation, and the model context report contains no
  planning messages.
- Manual: stop the process after execution rollover commits but before Engineer output, reopen the Session, and confirm
  the existing execution segment resumes without another blank segment or repeated seed turn.

## Edge Cases & Considerations

- Approval is not ambient authorization for a changed Plan, another Session, or a later revision. The packet snapshot is
  compared with canonical sources and never becomes authority.
- Readiness and execution preparation change Plan revision and worktree evidence. The execution packet records the
  approved input revision and the post-preparation evidence separately so both review provenance and startup validity
  can be proved.
- Rollover is a standalone fenced operation. Do not call it while `#runManagedOperation` still holds activation and do
  not weaken slice 10 by nesting activation or tolerating an unpublished successor.
- A process can stop after preparation commits but before rollover starts. The predecessor remains current with a
  prepared active workflow; retry revalidates and reuses that preparation instead of creating a second worktree.
- A process can stop after repair rollover but before the repair turn. The marker and canonical workflow evidence are
  sufficient to resume; uncertain external side effects still require normal recovery.
- Approval images cross the boundary as retained handoff inputs without granting access to planning model history. Apply
  existing image limits and validation before marker persistence.
- The Review Issue Ledger remains lifecycle-scoped workflow state. The rollover marker carries the frozen packet needed
  to start one repair, but it is not an Attention Dashboard source or durable workflow-progress database.
- Reviewer Agent Sessions remain disposable and read-only. Repair segments persist because the repair Agent mutates the
  execution worktree and must survive interruption.
- Non-Git in-place Plans still use the fresh segment boundary for managed Sessions. Unmanaged Sessions cannot provide
  cross-process continuity and keep the current direct behavior.
- No domain-language update is required. This Plan implements the existing definitions of Approve & Run, Session
  Transcript Segment Rollover, Plan Action Evidence Check, and Review Issue Ledger without introducing a new term.
