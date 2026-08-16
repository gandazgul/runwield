---
planId: "75527c5a-e7f1-4b84-add1-315f54114f00"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Finish the Workflow Validation lifecycle-state refactor by transplanting the prior execution worktree, removing legacy multi-phase delegation, and satisfying the reviewer feedback."
affectedPaths:
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/plan-store.js"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-legacy.ts"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/epic-continuation.js"
    - "src/shared/workflow/execution-context.js"
    - "src/shared/workflow/workflow.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/load-plan-recovery.test.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/shared/workflow/validation-lifecycle-resume.test.js"
    - "src/shared/workflow/validation-lifecycle-source.test.js"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/shared/workflow/validation-loop-human-review.test.js"
    - "src/shared/workflow/validation-loop-delivery.test.js"
    - "src/shared/workflow/validation-loop-recovery.test.js"
    - "src/shared/workflow/validation-prompts.test.js"
    - "src/shared/workflow/mechanical-validation.test.js"
    - "src/shared/workflow/architecture-boundary.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/ui/tui/testing/scenario-runner.js"
    - "scripts/check-injection-seams.js"
    - "scripts/injection-seam-baseline.json"
    - "scripts/language-policy-baseline.json"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-31T10:08:29-04:00"
updatedAt: "2026-07-31T15:49:32.160Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-31T15:15:09.472Z"
verifiedAt: "2026-07-31T15:48:57.572Z"
userVerifiedAt: null
executionReport: "- Implemented lifecycle-driven Workflow Validation: durable Plan status now selects the single validation phase, with invalid/missing statuses blocked instead of defaulting open.\n- Removed reachable legacy validation-machine entry points; retained legacy helpers only, restored QUICK_FIX mechanical validation repair-loop behavior, and preserved footer workflow context during validation repairs.\n- Updated lifecycle docs/tests and kept seam baseline from increasing (`deno task seams:check` passes).\n- Verification passed: `deno task ci` completed successfully (224 files passed, 0 failed)."
workRecord:
    status: "generated"
    recordId: "f19be9a2-515e-403b-acae-315c9d30d436"
    path: "docs/work-records/2026-07-31-workflow-validation-uses-lifecycle-states.md"
    lastAttemptAt: "2026-07-31T15:49:21.290Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "789bb3cd06d6233ffdd88f30528b3eb14a4bc255"
    targetBranch: "main"
    targetHeadBeforeMerge: "932ed6100c4751c6a584975d7c4fa08bb4374bcd"
routingIntent: "PLANNED_CHANGE"
sessionName: "validation lifecycle completion"
---

# Finish Workflow Validation Lifecycle States

## Context

`plans/model-workflow-validation-as-plan-lifecycle-states.md` was implemented only partially in execution worktree
`/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-model-workflow-validation-as-plan-lifecycle-stat-69a8d3ad`
(branch `runwield/worktree/model-workflow-validation-as-plan-lifecycle-stat-69a8d3ad`, committed head
`6e5738ae90dc0453f62cecf82b2203b2b5e4c556`). That worktree also contains uncommitted repair work, including the
`src/shared/workflow/validation.ts` wrapper and `src/shared/workflow/validation-legacy.ts` split.

The latest Reviewer rejection is correct: the attempted repair made the `implemented` entry path use a lifecycle-aware
Mechanical Validation phase, and it tightened some lifecycle rows, but the remaining Semantic Code Review and Local
Human Code Review/publication paths still call a legacy adapter around `runLegacyValidationMachine`. That preserves the
old multi-phase mutable driver instead of making Plan Status the Workflow Validation driver.

This continuation Plan starts from the prior worktree's actual code/test state, then finishes the architectural refactor
rather than re-reviewing or re-planning the original design. The prior worktree's old Plan Front Matter status edit is
not implementation source and must not be copied as protected lifecycle metadata.

## Objective

Complete the original lifecycle-state refactor so Workflow Validation is driven by Plan Lifecycle state, not by a hidden
loop in `validation-legacy.ts`.

After this change:

- `runValidationLoop` reads the Plan Status and persisted validation counters, runs at most one validation phase for
  that status, records at most one Plan Event for that phase, and returns.
- `runValidationLoop` and its phase functions do not call `runLegacyValidationMachine`, `runLegacyPhaseAdapter`, or any
  other legacy multi-phase driver.
- `validation_passed` and `worktree_merge_failed` are legal only from `validated_reviewer`.
- Semantic approval from `validated_ci` is represented by `semantic_review_passed`, producing `validated_reviewer`
  before any terminal verification or publication event can occur.
- Mechanical and semantic retry budgets are read from Plan Front Matter (`validationCiAttempts` and
  `validationSemanticRounds`) instead of local loop counters.
- Existing repair, Semantic Code Review, Local Human Code Review, Direct Delivery publication, Work Record generation,
  and recovery behavior is preserved, but any continuation happens through a later `runValidationLoop` call at the next
  durable Plan Status.

## Approach

First transplant the prior worktree's code and test changes into the new execution worktree, because that is the
requested starting point and contains useful partial extraction work. Apply it as source/test work, not as lifecycle
state: exclude the dirty `plans/model-workflow-validation-as-plan-lifecycle-states.md` status-only change and resolve
any patch conflicts against current `main` rather than overwriting newer commits.

Then finish the extraction by moving the remaining phase bodies out of `validation-legacy.ts` into explicit lifecycle
phase functions in `validation.ts`. `validation-legacy.ts` may remain temporarily as a compatibility module for stable
helpers such as prompt loading, CI execution, diff tools, review parsing, and publication utilities, but it must no
longer export or contain a callable multi-phase validation machine. The old driver loops should be deleted rather than
left reachable.

Use this lifecycle table as the authority:

| event                          | allowed from                                        | produces             | notes                                                                                             |
| ------------------------------ | --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `mechanical_validation_failed` | `implemented`                                       | `implemented`        | increments `validationCiAttempts`; dispatches/records CI repair context as needed, then returns   |
| `mechanical_validation_passed` | `implemented`                                       | `validated_ci`       | resets CI counter and clears CI failure state                                                     |
| `semantic_review_feedback`     | `validated_ci`                                      | `implemented`        | increments `validationSemanticRounds`; repair edits code, so validation restarts at CI            |
| `semantic_review_passed`       | `validated_ci`                                      | `validated_reviewer` | semantic approval boundary; no terminal event may bypass it                                       |
| `validation_failed`            | `implemented`, `validated_ci`, `validated_reviewer` | `implemented`        | terminal failed validation attempt metadata; resets phase counters when re-entering `implemented` |
| `validation_passed`            | `validated_reviewer`                                | `verified`           | only after human-review policy and publication proof are satisfied                                |
| `worktree_merge_failed`        | `validated_reviewer`                                | `implemented`        | publication/merge failure returns to CI because code or target integration may need repair        |

Preserve the existing user escape hatch from repeated Semantic Code Review repairs: when the automatic semantic round
limit is reached, the user may choose another semantic round or hand the change to Local Human Code Review. If a new
Plan Event or Front Matter field is needed to persist that choice without loop-local booleans, add the smallest explicit
lifecycle representation and document it in `docs/domain-language.md` and `docs/plan-lifecycle.md`; do not reintroduce
an in-memory `semanticEscapeToHumanReview` driver flag.

For `validated_reviewer`, use existing `humanReviewMode`, `humanReviewDecision`, and `humanReviewedAt` as the durable
human-review authority. A `validated_reviewer` Plan with undecided human-review metadata should run or request only the
human-review phase and return. A `validated_reviewer` Plan whose human review is complete or not required should run
publication and record either `validation_passed`, `worktree_merge_failed`, or `validation_failed`.

## Files to Modify

- `docs/domain-language.md` — add `validated_ci` and `validated_reviewer` to canonical Plan Status language and describe
  their stable relationship to Workflow Validation.
- `docs/plan-lifecycle.md` — document the new Workflow Validation statuses, events, retry counters, and resume behavior.
- `src/shared/workflow/plan-lifecycle.js` — add/finish Plan Status and Plan Event rows; export
  `VALIDATION_PLAN_STATUSES` and `isInValidation`; implement counter increments/resets and transition rejection tests.
- `src/plan-store.js` — add `validationCiAttempts` and `validationSemanticRounds` to Plan Front Matter typedefs and any
  schema/normalization lists that preserve known metadata.
- `src/shared/workflow/validation.ts` — make this the lifecycle-driven validation entry point; extract mechanical,
  semantic, human-review, publication, and Work Record phases into named functions with explicit typed parameter/result
  shapes.
- `src/shared/workflow/validation-legacy.ts` — keep only reusable helper functions needed by the extracted phases;
  delete `runLegacyValidationMachine`, enclosing validation loops, local retry counters, and adapter-only support.
- `src/shared/workflow/validation.js` — remove the legacy JavaScript implementation once importers use `validation.ts`.
- `src/shared/workflow/orchestrator.js`, `src/shared/workflow/epic-continuation.js`,
  `src/shared/workflow/execution-context.js`, `src/shared/workflow/workflow.js`, `src/cmd/load-plan/index.js`,
  `src/ui/workspace/server/plan-adapter.js` — finish import updates and classify `implemented` checks as literal
  implementation-complete checks or validation-in-progress checks using `isInValidation`.
- `src/cmd/load-plan/load-plan-recovery.test.js`, `src/shared/workflow/*validation*.test.*`,
  `src/shared/workflow/workflow.test.js`, `src/shared/workflow/architecture-boundary.test.js`,
  `src/shared/workflow/mechanical-validation.test.js`, `src/ui/tui/testing/scenario-runner.js` — update tests and golden
  expectations for single-phase validation calls without weakening the behavior each test originally protected.
- `scripts/check-injection-seams.js`, `scripts/injection-seam-baseline.json`, `scripts/language-policy-baseline.json` —
  carry forward/tighten baseline changes that are caused by deleting the legacy JS module and removing obsolete seams;
  do not increase seam allowances.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- Prior worktree `69a8d3ad` — source/test seed for statuses, counters, import migration, and initial Mechanical
  Validation extraction.
- `src/shared/workflow/plan-lifecycle.js` `recordPlanEvent` / `buildPlanEventUpdates` — the only authority for status
  and protected Front Matter transitions.
- `src/shared/workflow/execution-context.js` `resolveValidationExecutionContext` — reuse fail-closed validation context
  resolution before any CI, review, or publication work.
- `src/shared/workflow/state-transition.ts` publication transition helpers — preserve transactional Direct Delivery and
  merge-back proof behavior while changing only the phase driver.
- `src/shared/workflow/validation-progress.ts` — keep existing progress rendering and check state updates.
- `src/shared/workflow/validation-scope.ts` — keep implementation-diff and Workflow Validation scope rules.
- `src/shared/workflow/review-ledger.ts` and `src/shared/workflow/review-diff-tool.js` — preserve the converging
  Semantic Code Review workflow and diff-inspection guarantees.
- `humanReviewMode`, `humanReviewDecision`, and `humanReviewedAt` Plan Front Matter — reuse the existing durable Local
  Human Code Review decision fields instead of adding a duplicate human-review Plan Status.

## Implementation Steps

- [ ] Transplant the prior worktree into the new execution worktree before editing further: - Use old worktree path
      `/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-model-workflow-validation-as-plan-lifecycle-stat-69a8d3ad`.
      - Capture both committed branch diff from merge base `53bfc86667c18900e0c86a940c47b924764babc1` to old HEAD
      `6e5738ae90dc0453f62cecf82b2203b2b5e4c556` and the old worktree's dirty tracked diff. - Copy untracked files
      `src/shared/workflow/validation.ts` and `src/shared/workflow/validation-legacy.ts`. - Exclude/revert the dirty
      status-only edit to `plans/model-workflow-validation-as-plan-lifecycle-states.md`; do not copy protected lifecycle
      metadata from the old Plan. - Apply with three-way conflict handling and preserve newer current-`main` changes
      where the old branch predates them.
- [ ] After the transplant, inspect `git status --short` and ensure the changed file list is expected source, docs,
      tests, and baseline files only; no `.wld/` registry files or old Plan lifecycle status rewrites are present.
- [ ] Finish `plan-lifecycle.js`: include `validated_ci`, `validated_reviewer`, `mechanical_validation_failed`,
      `mechanical_validation_passed`, `semantic_review_feedback`, and `semantic_review_passed`; reject
      `validation_passed` and `worktree_merge_failed` from `implemented`; reset counters on repair/re-entry to
      `implemented` except for the incrementing failure event currently being recorded.
- [ ] Update `docs/domain-language.md` and `docs/plan-lifecycle.md` in the same change as the lifecycle behavior so
      glossary/docs do not describe the old one-status validation model.
- [ ] Replace the semantic-review adapter path in `validation.ts` with a real `runSemanticReviewPhase` extracted from
      the legacy semantic block. It must read `validationSemanticRounds`, run one reviewer round or one persisted user
      round-limit choice, record exactly one of `semantic_review_passed`, `semantic_review_feedback`, or
      `validation_failed`, and return.
- [ ] Replace the human-review/publication adapter path with explicit `runHumanReviewPhase` and `runPublicationPhase`
      functions. Human review may update human-review Front Matter and return without changing status; publication is
      the only path that records `validation_passed` or `worktree_merge_failed`.
- [ ] Preserve repair dispatch behavior without same-call loop continuation: CI repair, semantic repair, merge repair,
      and human-feedback repair may run the appropriate agent turn, but after the phase records its event it returns;
      the next call resumes from the Plan Status and counters.
- [ ] Delete `runLegacyPhaseAdapter`, `ValidationPhaseComplete`, `runLegacyValidationMachine`,
      `while (!executionComplete && !haltReason)`, nested CI retry loops, publication `while (executionComplete)`, and
      `pauseForExecutionContinuation` from reachable validation code. If reusable code remains in
      `validation-legacy.ts`, it must be helper-level code, not an alternate driver.
- [ ] Ensure `runValidationLoop` contains no `while`, no `for` over validation phases, no adapter call, and no local
      mutable state that controls multiple phases (`executionComplete`, `haltReason`, `mechanicalAttempts`,
      `semanticEscapeToHumanReview`, or equivalent).
- [ ] Update all importers to import from `./validation.ts` where needed, remove `validation.js`, and update TypeScript
      and seam baselines only in the tightening direction.
- [ ] Classify every `status === "implemented"` comparison touched by the old plan or transplant. Use
      `isInValidation(status)` only where the code means implemented-or-mid-validation; keep literal `implemented` only
      where the behavior truly starts before Mechanical Validation.
- [ ] Update tests so phase-specific behavior is asserted by seeding `implemented`, `validated_ci`, or
      `validated_reviewer`; end-to-end tests that still need full success should call `runValidationLoop` repeatedly and
      reload Plan Front Matter between calls.
- [ ] Add/keep source assertions that fail if `runValidationLoop` calls a legacy driver, contains a validation loop, or
      if reachable validation source still contains `pauseForExecutionContinuation`.

## Verification Plan

- Automated:
  - `deno task test src/shared/workflow/validation-lifecycle-resume.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/validation-lifecycle-source.test.js`
  - `deno task test src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/validation-loop-recovery.test.js`
  - `deno task test src/cmd/load-plan src/shared/workflow src/ui/tui/testing`
  - `deno task seams:check`
  - `deno task ci`
- Manual:
  - Inspect the final diff and confirm the old worktree was used as the seed, but
    `plans/model-workflow-validation-as-plan-lifecycle-states.md` protected lifecycle metadata was not transplanted.
  - Run or simulate a Planned Change validation through `implemented -> validated_ci -> validated_reviewer -> verified`.
  - Resume a Plan seeded at `validated_ci` and confirm Mechanical Validation is not run.
  - Resume a Plan seeded at `validated_reviewer` with human review undecided and confirm Semantic Code Review is not
    run.
- Expected results for key scenarios:
  - `recordPlanEvent` rejects `validation_passed` and `worktree_merge_failed` from `implemented`.
  - Semantic approval records `semantic_review_passed` from `validated_ci` before any `validation_passed` event can be
    recorded.
  - CI failure increments `validationCiAttempts` in Front Matter and the next validation call reads that value.
  - Semantic feedback increments `validationSemanticRounds` in Front Matter and code repair returns the Plan to
    `implemented` for fresh CI.
  - Publication/merge failures preserve Direct Delivery proof and recovery behavior while recording events from
    `validated_reviewer` only.
  - The glossary and lifecycle documentation describe the implemented statuses/events and do not promote stale one-state
    Workflow Validation language.

## Edge Cases & Considerations

- The old execution branch predates current `main` (`merge-base 53bfc866...`, current `main` observed at `92003bbc...`).
  Do not blindly overwrite current files with old copies; transplant with conflict awareness and retain later main
  fixes.
- The prior worktree is dirty. The uncommitted TypeScript files are intentional seed work, but the old Plan status edit
  is protected lifecycle state and must be excluded.
- The primary checkout currently has unrelated dirty files. They are not the transplant source; execution must use the
  prior worktree named above plus the new execution worktree created for this Plan.
- Human review intentionally has no separate Plan Status. Avoid a duplicate human-review status unless implementation
  proves the existing human-review Front Matter cannot represent a required durable decision.
- Do not add new dependency-bag seams. Removing obsolete seams should tighten `scripts/injection-seam-baseline.json`; a
  seam count increase is a failure.
- Do not treat golden TUI scenario updates as snapshots to bless blindly. Preserve each scenario's behavioral assertion
  while changing expected output ordering for lifecycle phase boundaries.
- If a validation phase cannot be extracted without a hidden loop-local control variable, stop and report the exact
  state that must become durable rather than leaving the legacy driver reachable.
