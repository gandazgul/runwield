---
planId: "552f3f06-bb0a-47c9-a79d-081d3f93e787"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Replace runValidationLoop's 1,900-line driving while loop with Plan Lifecycle statuses, so each validation phase is an event that mutates the Plan and validation resumes at the next phase instead of the start."
affectedPaths:
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/epic-continuation.js"
    - "src/shared/workflow/execution-context.js"
    - "src/shared/workflow/workflow.js"
    - "src/cmd/load-plan/index.js"
    - "src/plan-store.js"
    - "src/ui/workspace/server/plan-adapter.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-31T00:05:05-04:00"
updatedAt: "2026-08-02T22:10:46.885Z"
status: "user_verified"
origin: "internal"
implementedAt: "2026-07-31T04:24:40.791Z"
userVerifiedAt: "2026-08-02T22:10:36.242Z"
userVerificationNote: "│ Fulfilled by follow-up verified Plan plans/finish-workflow-validation-lifecycle-states.md / Work Record f19be9a2-515e-403b-acae-315c9d30d436. Original execution was partial│ and not itself Workflow-verified; verified implementation reached main via execution commit 789bb3cd...."
executionReport: "- Removed the dead `createExecutionWorktree` seam path from `startActiveExecutionWorkflow`: no `__deps?.createExecutionWorktree` alias remains in `src/` or `scripts/`.\n- Updated workflow/load-plan tests to use `createWorktreeGitArtifacts` instead of the removed zombie seam name, and kept registry settlement identity explicit for injected artifacts.\n- Tightened seam enforcement by removing `createExecutionWorktree` from `MACHINERY_SEAMS` and `scripts/injection-seam-baseline.json`; `deno task seams:check` passes (`150 seam(s) across 13 module(s), 24 machinery`).\n- Verification attempted: `deno task ci` does not pass in the current worktree; failures are in the in-progress validation lifecycle refactor (`plan-lifecycle`/handoff tests rejecting `validation_passed` from `implemented`, plus related golden timeout). Targeted `workflow.test.js` passed once after the fix, but later reruns in this dirty worktree hit leftover duplicate worktree registry entries from failed attempts."
workRecord:
    status: "generated"
    recordId: "ab4cb3d3-6bbe-46a5-8dc7-5bf4bbfa6b20"
    path: "docs/work-records/2026-08-02-workflow-validation-lifecycle-refactor-fulfilled-by-follow-up.md"
    lastAttemptAt: "2026-08-02T22:10:36.350Z"
humanReviewMode: null
humanReviewDecision: null
executionMode: "worktree"
executionBaselineTree: "047bcecc31d797d70da563fffa3152385c032e8c"
worktreeId: "69a8d3ad"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-model-workflow-validation-as-plan-lifecycle-stat-69a8d3ad"
worktreeBranch: "runwield/worktree/model-workflow-validation-as-plan-lifecycle-stat-69a8d3ad"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
---

# Model Workflow Validation as Plan Lifecycle States

## Context

`runValidationLoop` in `src/shared/workflow/validation.js` is 2,315 lines, of which roughly 1,900 are the body of a
single `while (!executionComplete && !haltReason)` loop. Inside that loop sit every validation phase in sequence:
Mechanical Validation (with its own nested retry `while`), Semantic Code Review, the implementation-diff gate, Local
Human Code Review, worktree merge and publication, and Work Record generation.

RunWield already models Plan progress as events that mutate the Plan. `src/shared/workflow/plan-lifecycle.js` holds
`ALLOWED_FROM` (which statuses an event is legal from) and `EVENT_STATUS` (what status the event produces), and
`recordPlanEvent` applies the mutation under a compare-and-set precondition. Every other part of the lifecycle is
expressed that way.

Workflow Validation is the exception. The whole of it occupies a single state — `implemented` goes in, and
`validation_passed`, `validation_failed`, or `worktree_merge_failed` comes out. Because no phase boundary is
represented, the ordering, the retry bounds, and the halt conditions are all inlined into loop control flow. The loop is
a hand-written driver for a machine the codebase already has everywhere else.

Two concrete consequences today:

- **Validation restarts from the top.** The loop body begins at Mechanical Validation on every entry, so a Plan that
  passed CI and then failed Semantic Code Review re-runs CI from scratch when resumed. Nothing records that CI already
  passed, so nothing can skip it.
- **The stop path unwinds the whole function.** When an agent ends its turn without calling `task_completed`, the CI
  repair path calls `return await pauseForExecutionContinuation(...)` from four levels of nesting, returning out of the
  entire 2,315-line function. Every phase needs its own version of that escape.

The codebase is already reaching for persisted phase state ad hoc: `humanReviewMode` and `humanReviewDecision` are Plan
Front Matter fields precisely because Local Human Code Review has to survive the turn that requested it. This change
applies that same answer to the phases that never got it.

Surviving a process restart is a welcome by-product, not the goal. The goal is that validation phases become readable
rows in the existing table rather than positions in a loop body.

## Objective

Make each Workflow Validation phase boundary a Plan Lifecycle status, reached by an event that mutates the Plan through
the existing `recordPlanEvent` machinery.

After this change `runValidationLoop` performs **one** phase per call: it reads the Plan's status, runs the phase that
status calls for, records the resulting event, and returns. It contains no `while` loop and no
`pauseForExecutionContinuation`. An agent turn that ends without a completing tool call records no event and simply
stops, which is the natural end of a session rather than a case to unwind from.

`verified` remains the only terminal success status, exactly as today.

## Approach

Add two statuses between `implemented` and `verified`:

- `validated_ci` — Mechanical Validation passed for the current code.
- `validated_reviewer` — Semantic Code Review approved the current code.

Human review does **not** get its own status. `humanReviewMode` and `humanReviewDecision` already persist that phase, so
`status: "validated_reviewer"` with `humanReviewDecision: null` unambiguously means "awaiting human review" and needs no
second representation of the same fact. Adding a status for it would create two authorities for one truth.

Add the events that produce these statuses to `ALLOWED_FROM` and `EVENT_STATUS`:

| event                          | allowed from                                        | produces             |
| ------------------------------ | --------------------------------------------------- | -------------------- |
| `mechanical_validation_passed` | `implemented`                                       | `validated_ci`       |
| `semantic_review_passed`       | `validated_ci`                                      | `validated_reviewer` |
| `validation_passed`            | `validated_reviewer`                                | `verified`           |
| `validation_failed`            | `implemented`, `validated_ci`, `validated_reviewer` | `implemented`        |
| `worktree_merge_failed`        | `validated_reviewer`                                | `implemented`        |

`validation_failed` and `worktree_merge_failed` both return the Plan to `implemented` rather than to the phase that
failed. This is deliberate: both are followed by a repair that edits code in the execution worktree, and code that
changed has not passed CI. Re-validating from the start after a repair is the current behavior and the correct one; what
changes is that resuming an _interrupted_ run no longer re-runs phases that nothing invalidated.

Move the retry bounds out of loop counters and into Plan Front Matter so the bound is state the next call reads rather
than a variable that dies with the process:

- `validationCiAttempts` — incremented by `mechanical_validation_failed`; at 3, validation halts.
- `validationSemanticRounds` — incremented by `semantic_review_feedback`; at the existing round limit, validation halts.

Both reset to `0` whenever a Plan re-enters `implemented`, so a repaired Plan gets a full budget.

Introduce `VALIDATION_PLAN_STATUSES` and an `isInValidation(status)` predicate in `plan-lifecycle.js`, alongside the
existing `ACTIVE_PLAN_STATUSES` and `ALL_KNOWN_STATUSES` sets. There are 43 sites across 9 files that compare against
`"implemented"`; each must be read and classified as meaning either "implementation just finished" (keep the literal
comparison) or "somewhere inside validation" (use the predicate). This conflation exists in the code today and is
invisible; the change makes it explicit at each site.

`runValidationLoop` keeps its signature and its `WorkflowValidationResult` return so callers are unaffected. Its body
becomes a status switch over the phase functions, each of which already exists as a block inside the current loop.

## Files to Modify

- `src/shared/workflow/plan-lifecycle.js` — add `validated_ci` and `validated_reviewer` to `PLAN_STATUSES`, add the new
  events to `ALLOWED_FROM`/`EVENT_STATUS`, add `VALIDATION_PLAN_STATUSES` and `isInValidation`, and reset the retry
  counters on re-entry to `implemented`.
- `src/shared/workflow/validation.js` — replace the driving `while` loop with a single-phase dispatch on Plan status;
  extract each phase body into a named function; delete `pauseForExecutionContinuation`.
- `src/plan-store.js` — add `validationCiAttempts` and `validationSemanticRounds` to the Plan Front Matter typedef.
- `src/shared/workflow/orchestrator.js`, `src/shared/workflow/epic-continuation.js`,
  `src/shared/workflow/execution-context.js`, `src/shared/workflow/workflow.js`, `src/cmd/load-plan/index.js`,
  `src/ui/workspace/server/plan-adapter.js` — classify each `"implemented"` comparison as literal or `isInValidation`.
- `src/cmd/load-plan/index.js` — the Plan Recovery menu must offer the same actions for the new statuses that it offers
  for `implemented`, so a Plan paused mid-validation is never left without a route.

`CONTEXT.md` needs no change: this introduces no new domain language. `validated_ci` and `validated_reviewer` are
lifecycle statuses, and Mechanical Validation and Semantic Code Review are already defined terms.

## Reuse Opportunities

- `src/shared/workflow/plan-lifecycle.js` `ALLOWED_FROM`/`EVENT_STATUS`/`recordPlanEvent` — the state machine and its
  compare-and-set precondition already exist. Add rows; do not build a second mechanism.
- `ACTIVE_PLAN_STATUSES` / `ALL_KNOWN_STATUSES` — the established idiom for a named status set.
  `VALIDATION_PLAN_STATUSES` follows it exactly.
- `humanReviewMode` / `humanReviewDecision` — already-persisted phase state for human review. Read it; do not duplicate
  it.
- `src/shared/workflow/state-transition.ts` — existing transition wrappers for the merge/publication phase. The
  publication transaction stays as it is; only what drives it changes.
- `src/shared/workflow/validation-progress.ts` — progress records and status emission already extracted; phases emit
  through it unchanged.
- `src/shared/workflow/validation-scope.ts` — `shouldRunWorkflowValidation` and `hasImplementationDiff` already own the
  routing and evidence rules the diff gate uses.

## Implementation Steps

Steps state the outcome that must be true when the step is done, not the action taken.

- [ ] `PLAN_STATUSES` contains `validated_ci` and `validated_reviewer`; `VALIDATION_PLAN_STATUSES` and
      `isInValidation(status)` are exported from `plan-lifecycle.js`.
- [ ] `ALLOWED_FROM` and `EVENT_STATUS` contain every row in the Approach table, and `recordPlanEvent` rejects
      `semantic_review_passed` from `implemented` as an illegal transition.
- [ ] `validationCiAttempts` and `validationSemanticRounds` exist in the Plan Front Matter typedef, are incremented by
      their failure events, and are reset to `0` on every transition into `implemented`.
- [ ] Each of the 43 `"implemented"` comparisons has been individually classified; every site that meant "anywhere in
      validation" calls `isInValidation`. No site is left comparing against a bare `"implemented"` literal where the new
      statuses would also apply.
- [ ] `runValidationLoop` contains no `while` loop, no `for` loop over phases, and no `pauseForExecutionContinuation`;
      it dispatches on Plan status, runs one phase, records one event, and returns.
- [ ] Each validation phase — mechanical validation, semantic review, diff gate, human review, merge/publication, work
      record — is a named function taking explicit parameters, with no reads of enclosing-scope mutable loop state.
- [ ] The Plan Recovery menu in `load-plan` offers actions for `validated_ci` and `validated_reviewer` equivalent to
      those it offers for `implemented`.
- [ ] `runValidationLoop` and the phase functions are TypeScript in `src/shared/workflow/`, with the phase result type
      named once and referenced (no inline `any`/`unknown` shapes, no `deno-lint-ignore` for `no-explicit-any`).

If any phase cannot be extracted without threading enclosing loop state, record the specific state it needs in the
Plan's execution report and stop for a decision. Do not leave it inline and continue: an un-extracted phase means this
change did not happen.

## Verification Plan

- Automated:
  - `deno task ci`
  - `deno task test src/shared/workflow src/cmd/load-plan`
- Checks that fail when the objective is not met (these are the point; a run that only proves "nothing broke" has not
  verified this change):
  - A test seeds a Plan at `validated_ci` and runs `runValidationLoop` with a Mechanical Validation port that throws if
    called; validation must proceed to Semantic Code Review without re-running CI.
  - A test seeds a Plan at `validated_reviewer` with `humanReviewDecision: null` and asserts neither CI nor Semantic
    Code Review runs.
  - A test asserts `recordPlanEvent` rejects `semantic_review_passed` from `implemented` and from `verified`.
  - A test asserts `validationCiAttempts` reaching 3 halts validation, and that re-entering `implemented` resets it to
    `0`.
  - A source assertion that `runValidationLoop` contains no `while` and is under 200 lines.
  - A source assertion that `pauseForExecutionContinuation` no longer exists anywhere in `src/`.
- Manual:
  - Run a Planned Change Plan end to end and confirm the Plan file passes through `validated_ci` and
    `validated_reviewer` before reaching `verified`.
  - Interrupt a run after CI passes, then `/load-plan` the Plan and confirm validation resumes at Semantic Code Review
    with no second CI run.
  - Force a merge conflict and confirm the Plan returns to `implemented` with both retry counters reset.
  - Confirm `wld plans doctor` reports the new statuses without reporting them as drift.
- Expected results:
  - Every existing validation and mechanical-validation test passes unchanged in behavior.
  - `deno task seams:check` does not increase; this change adds no `__deps` names.
  - The Workspace board renders the new statuses without an unknown-status fallback.

## Edge Cases & Considerations

- **The 43 call sites are the risk.** Each is a judgment about whether the author meant "implementation finished" or "in
  validation". Getting one wrong is a silent behavior change, not a type error. They must be classified individually
  with the reasoning visible in the diff, not bulk-replaced.
- **Existing Plans are mid-flight.** A Plan already at `implemented` must still validate correctly, because
  `implemented` remains the entry status. No migration of existing Plan files is required, and none should be written.
- **`validation_failed` returning to `implemented`** means a repaired Plan re-runs CI. That is intended: repair edits
  code, and code that changed has not passed CI. Do not "optimize" this into resuming at the failed phase.
- **Two sessions on one Plan** are already handled by the compare-and-set precondition in `recordPlanEvent`: the second
  writer sees a stale status and is refused. This change does not weaken that, and must not bypass it by writing status
  through any path other than `recordPlanEvent`.
- **Progress reporting** currently derives cycle and round numbers from loop counters. Those numbers must now come from
  the persisted counters so a resumed run reports the true attempt number rather than restarting at 1.
- **Golden TUI scenarios** assert validation output ordering. Phase boundaries now emit a lifecycle event where they
  previously did not; scenario expectations may need updating, and the update must preserve what each scenario was
  asserting rather than being rewritten to match new output.
- **Do not widen scope into the `__deps` bag.** Removing the injection seams from `validation.js` is separate work with
  its own Plan. This change must not add seam names, and `deno task seams:check` failing is a signal it did.
