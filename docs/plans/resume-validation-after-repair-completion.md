---
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Make Workflow Validation resume automatically from a CI-repair task completion without competing consumers or stale Plan lifecycle writes."
affectedPaths:
    - "src/shared/session/task-completion-session.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-repair-completion-ownership.test.ts"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'human review CI repair task_completed resumes automatically with one completion' src/shared/workflow/validation-repair-completion-ownership.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-completion-ownership.test.ts --filter 'human review CI repair task_completed resumes automatically with one completion'"
      rationale: "The combined human-review/CI-repair continuation regression does not exist today and must prove the exact reported workflow reaches fresh validation without a second Task Completion or stale lifecycle error."
    - id: "OC2"
      command: "grep -q 'in-flight validation repair exclusively owns its task completion claim' src/shared/workflow/validation-repair-completion-ownership.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-completion-ownership.test.ts --filter 'in-flight validation repair exclusively owns its task completion claim'"
      rationale: "The current durable claim is non-exclusive, so this can pass only after a validation reservation prevents an ordinary competing claimant from acting on the same accepted completion."
    - id: "OC3"
      command: "grep -q 'parked validation repair releases completion ownership for later handler resume' src/shared/workflow/validation-repair-completion-ownership.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-completion-ownership.test.ts --filter 'parked validation repair releases completion ownership for later handler resume'"
      rationale: "This protects later-handler recovery while requiring the in-flight reservation to release cleanly when a repair parks without completion."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-03T17:01:39-04:00"
updatedAt: "2026-08-03T21:09:11.759Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "validation repair resume"
planId: "49e20ce4-692f-42fb-b5a9-ecb3766640cc"
---

# Resume Validation After Repair Completion

## Context

A real PLANNED_CHANGE run reached Local Human Code Review, received human feedback, returned to an Implemented Plan for
fresh Mechanical Validation, failed continuous integration (CI), and dispatched the Engineer for another repair. When
the Engineer called `task_completed`, RunWield displayed:

`Stale Plan lifecycle precondition for split-plan-recovery-flow: caller saw implemented, canonical status is validated_reviewer.`

The persisted Session Transcript establishes the critical ordering. The repair completion was accepted with a
validation-continuation workflow snapshot whose `triageMeta.status` was `implemented`; two milliseconds later its
durable Task Completion entry was marked consumed. The stale lifecycle error followed, and no further workflow activity
occurred until the user asked the Engineer to call `task_completed` a second time. That second completion correctly
reread the canonical Plan and resumed validation. The first completion was therefore not missing: it was acted on more
than once, consumed before the failing continuation settled, and unavailable to wake a retry.

The implementation exposes the race. Both the Agent Handler and the in-flight Mechanical Validation repair dispatcher
call `claimPendingTaskCompletion`. A durable claim is currently only a read of an unconsumed accepted event; it does not
exclude another live claimant before acknowledgment. Separately, Mechanical Validation records
`mechanical_validation_failed` with `currentStatus: "implemented"` only after the asynchronous repair turn returns. A
competing completion consumer can advance the Plan during that turn, leaving this post-dispatch write with exactly the
stale precondition reported by the user.

The Plan Lifecycle guard is correct and must remain strict. The fix belongs in Task Completion ownership and validation
checkpoint ordering, not in accepting a lifecycle event against whichever status happens to exist.

## Objective

One accepted `task_completed` from an in-flight CI or Objective-Failing Check repair automatically and exactly once
returns Workflow Validation to Mechanical Validation. The repair dispatcher is the sole live consumer while its Agent
turn is in flight; the Agent Handler remains the fallback consumer after a parked or restarted workflow. Mechanical
Validation persists the failed-check checkpoint before dispatch, so no lifecycle write based on the pre-dispatch status
runs after an arbitrarily long Agent turn.

The repaired workflow must rerun CI and Objective-Failing Checks as required, preserve Local Human Code Review
ownership, and continue without a second user prompt or a stale Plan lifecycle error.

## Approach

Add an in-process, workflow-attempt-scoped completion-consumer reservation to `task-completion-session.ts`. The
validation dispatcher reserves ownership before starting a root Engineer repair turn, claims with that reservation after
the turn, and releases in `finally`. An ordinary Agent Handler claim cannot take the same completion while that
reservation is live. The reservation is deliberately ephemeral: if the process dies, the unacknowledged accepted JSONL
entry remains recoverable by the normal Agent Handler path.

Move `mechanical_validation_failed` recording ahead of both CI-repair and Objective-Failing Check-repair dispatch. This
records the known failed attempt and retry-safe Implemented Plan before external Agent work starts. After dispatch,
validation only interprets whether the reserved completion arrived; it does not write another event using the old
`implemented` snapshot. A completed repair continues the existing loop into a fresh Mechanical Validation run. A repair
that stops without `task_completed` releases the reservation and parks, allowing a later root completion to be claimed
by the Agent Handler and resume normally.

Use a focused integration test at the real completion/lifecycle seam. It must combine the conditions omitted by current
coverage: human-review feedback, Implemented re-entry, failed CI, a root Engineer repair completion, and a competing
ordinary claim while validation owns the repair. Use a real `HostedSession`, in-memory `SessionManager`, Plan store, and
Plan Lifecycle transitions; fake only the Agent/model and CI boundaries. Do not add a dependency bag or bypass
RunWield-owned Plan machinery.

## Files to Modify

- `src/shared/session/task-completion-session.ts` — add workflow-attempt-scoped live consumer reservation/claim
  ownership while preserving durable accepted/consumed JSONL semantics, duplicate retirement, isolated-session
  exclusion, and process-restart replay.
- `src/shared/workflow/validation.ts` — reserve CI/objective repair completions around root Agent turns, persist failed
  Mechanical Validation outcomes before dispatch, acknowledge only the reserved completion, and release ownership on
  completion, no-completion, cancellation, and errors.
- `src/shared/workflow/validation-repair-completion-ownership.test.ts` — add the minimized race regression and the full
  human-review-feedback → CI failure → Engineer Task Completion continuation regression without touching currently dirty
  test files from other active work.

No `docs/domain-language.md` change is required: Task Completion, Implemented Plan, Mechanical Validation, Local Human
Code Review, and Workflow Validation retain their canonical meanings.

## Reuse Opportunities

- `src/shared/session/task-completion-session.ts` — reuse `workflowAttemptKey`, `matchesActiveWorkflow`, durable
  accepted event filtering, and explicit acknowledgment instead of creating a second completion store.
- `src/shared/workflow/validation-position.ts` — retain the existing `mechanical` / `awaiting: "ci_repair"` position as
  validation's phase marker; completion ownership supplements it rather than becoming another phase authority.
- `src/shared/workflow/validation-test-helpers.js` — reuse `makeValidationProjectRoot`, `HostedSession` recording, and
  real Plan transaction fixtures.
- `src/tools/task-completed.ts` — retain `recordAcceptedTaskCompletion` as the producer; the tool should not learn
  validation orchestration policy.
- `src/shared/workflow/plan-lifecycle.js` — retain `recordPlanEvent` compare-and-set behavior and legal
  `mechanical_validation_failed` transition from `implemented` unchanged.

## Implementation Steps

- [ ] `src/shared/workflow/validation-repair-completion-ownership.test.ts` reproduces the reported sequence with one
      accepted repair Task Completion and fails on the baseline stale-precondition/stranded-continuation behavior.
- [ ] `task-completion-session.ts` permits exactly one live consumer for a matching workflow attempt: a validation
      repair reservation excludes an ordinary Agent Handler claim, the reservation owner can claim and acknowledge the
      accepted completion, and release makes later completions claimable normally.
- [ ] Completion reservations are in-process coordination only; process loss, HostedSession replacement, and JSONL
      reopen leave unacknowledged accepted completions recoverable through the existing durable replay path.
- [ ] Mechanical Validation records `mechanical_validation_failed` and its attempt/failure detail before dispatching an
      Engineer for failed CI or unmet Objective-Failing Checks; neither path performs a lifecycle write with the old
      `implemented` precondition after the Agent turn returns.
- [ ] A repair that calls `task_completed` once is consumed by the in-flight validation owner, acknowledged once after
      the failed-attempt checkpoint exists, reruns Mechanical Validation, and reaches the next valid validation phase
      without the user asking for another completion.
- [ ] A repair that stops without `task_completed` releases its reservation, remains an Implemented Plan with failure
      bookkeeping recorded, and a later Agent Handler completion resumes validation automatically.
- [ ] Duplicate completions for one workflow attempt, wrong-workflow completions, isolated Reviewer-Feedback Engineer
      completions, initial implementation completion, QUICK_FIX completion, and Frontend Engineer validation repairs
      keep their current ownership and consume-once behavior.
- [ ] The strict stale-status check in `recordPlanEvent` remains unchanged; no catch-and-ignore path, status coercion,
      or caller-metadata overwrite can satisfy the regression.

## Verification Plan

- Automated:
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-completion-ownership.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/session/task-completion-session.test.ts src/shared/session/agent-handler.test.ts src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-loop-repair.test.js`
  - `deno task seams:check`
  - `deno task check`
  - `deno task ci`
- Expected regression sequence:
  - Local Human Code Review feedback produces `humanReviewDecision: changes_requested` and returns the Plan to
    `implemented`.
  - CI fails and the failed-attempt lifecycle update is already durable when the Engineer prompt starts.
  - The Engineer calls `task_completed` once; an ordinary concurrent claim cannot steal that completion from the active
    validation dispatcher.
  - Validation automatically reruns CI. No transcript/system event contains `Stale Plan lifecycle precondition`, and no
    second Task Completion or user nudge is required.
  - After CI passes, the existing human-review-owned path bypasses a broad Semantic Code Review sweep and returns the
    repaired diff to Local Human Code Review as before.
- Behavior protected afterwards:
  - Root Task Completion survives process/HostedSession replacement until a safe consumer acknowledges it.
  - Agent Handler still resumes a validation repair completed after the original dispatch parked.
  - Isolated Agent Session completion stays outside the root JSONL outbox.
  - CI and Objective-Failing Check failures increment/reset the existing counters exactly once per failed attempt.
  - Validation never reaches `validated_ci`, `validated_reviewer`, or publication without fresh Mechanical Validation
    after repair edits.
- Behavior expected to stop existing:
  - The Agent Handler and an in-flight validation dispatcher can no longer both act on the same accepted completion.
  - Mechanical Validation no longer records a failure event against a status snapshot captured before an Engineer turn.

### Objective-Failing Checks

- `OC1` —
  `grep -q 'human review CI repair task_completed resumes automatically with one completion' src/shared/workflow/validation-repair-completion-ownership.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-completion-ownership.test.ts --filter 'human review CI repair task_completed resumes automatically with one completion'`
  — the combined human-review/CI-repair continuation regression does not exist today and must prove the exact reported
  workflow reaches fresh validation without a second Task Completion or stale lifecycle error.
- `OC2` —
  `grep -q 'in-flight validation repair exclusively owns its task completion claim' src/shared/workflow/validation-repair-completion-ownership.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-completion-ownership.test.ts --filter 'in-flight validation repair exclusively owns its task completion claim'`
  — the current durable claim is non-exclusive, so the test can pass only after a validation reservation prevents a
  competing ordinary claimant from acting on the same accepted completion.
- `OC3` —
  `grep -q 'parked validation repair releases completion ownership for later handler resume' src/shared/workflow/validation-repair-completion-ownership.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-completion-ownership.test.ts --filter 'parked validation repair releases completion ownership for later handler resume'`
  — protects the recovery behavior observed after the user's second completion while requiring it to work automatically
  after a parked first dispatch.

## Edge Cases & Considerations

- A reservation must be scoped by the existing workflow-attempt identity, not just Plan name, so a stale repair cannot
  block or consume a later execution attempt for the same Plan.
- Reservation acquisition/release must be synchronous and exception-safe. Do not persist a `claimed` event: a process
  crash must leave the durable accepted completion replayable rather than permanently leased to a dead process.
- Recording failure before dispatch changes when the CI attempt counter becomes visible, not its meaning. Ensure one
  failed run produces one increment even when the Engineer stops, completes, throws, or is canceled.
- `acknowledgeTaskCompletion` currently retires duplicate accepted completions for the same workflow attempt. Preserve
  that behavior, but only the selected live owner may invoke it for the in-flight repair.
- Objective-Failing Check repair has the same post-dispatch stale-write shape as CI repair and must use the same
  ownership and checkpoint-ordering helper rather than retaining a parallel race.
- Do not weaken `recordPlanEvent` preconditions or derive lifecycle authority from `triageMeta`, validation position,
  transcript messages, or display state. The canonical locked Plan remains the status source of truth.
- The repository currently has unrelated dirty test files from other active work. The new regression file is intentional
  so this implementation does not overwrite those edits; source files listed above were clean when this Plan was
  written.
