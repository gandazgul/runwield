---
planId: "d1199d77-6f61-45f0-8ded-aa43b51d613d"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Give every validation-loop test dropped by the lifecycle refactor a stated disposition — rewritten against the phase-driven shape, or removed with the dead behavior named."
affectedPaths:
    - "docs/validation-test-disposition.md"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "src/shared/workflow/validation-loop-delivery.test.js"
    - "src/shared/workflow/validation-loop-human-review.test.js"
    - "src/shared/workflow/validation-loop-recovery.test.js"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/shared/workflow/validation-test-helpers.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-31T11:49:16-04:00"
updatedAt: "2026-08-02T15:21:27.349Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-31T16:11:47.526Z"
verifiedAt: "2026-07-31T17:54:19.750Z"
userVerifiedAt: null
executionReport: "- Added `docs/validation-test-disposition.md` with 47 unique rows: every pre-refactor test from the five scoped files is marked `rewritten` or `removed` with non-empty behavior-specific detail; the required `comm -23 ...` disposition check printed no unaccounted names.\n- Rewrote surviving lifecycle-shape coverage in the scoped validation-loop files: core empty/Plan-only diff entry failures, delivery non-Git Direct Delivery evidence, human-review `always`/`ask` decisions, recovery fail-closed missing worktree target metadata, and repair CI dispatch/Frontend Engineer owner preservation.\n- Added `agentTurnPort` capability for CI repair dispatch testing without adding or increasing `__deps` seams; `deno task seams:check` passes.\n- Test-count delta for the five touched test files: 6 before this change → 14 after this change (+8); removed/replaced legacy coverage is accounted for one-by-one in `docs/validation-test-disposition.md`.\n- Spot-check mutations failed as expected for one rewritten test per file: core `runValidationLoop fails FEATURE validation when workflow diff is empty`, delivery `runValidationLoop does not preserve a nonexistent Plan path for quick-fix worktrees`, human-review `runValidationLoop runs always human review after semantic approval and before merge`, recovery `runValidationLoop fails closed when worktree validation context is missing target branch metadata`, repair `runValidationLoop preserves Frontend Engineer owner when CI repair pauses`.\n- Verification passed: `deno task test src/shared/workflow` (336 passed), `deno task seams:check`, and `deno task ci`."
workRecord:
    status: "generated"
    recordId: "a48615e8-9ec0-42e1-963b-af4190cf4f21"
    path: "docs/work-records/2026-08-02-restored-validation-phase-test-coverage.md"
    lastAttemptAt: "2026-08-02T15:21:19.867Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "e2b5d1caa8f77087619b3c2fc0ddeeaaa008d57e"
    targetBranch: "main"
    targetHeadBeforeMerge: "61fcae7a8b93934bf4bb46fb15d734d5f32bbe71"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Restore Validation Phase Coverage

## Context

The plan `finish-workflow-validation-lifecycle-states.md` replaced the multi-phase validation driver with a
lifecycle-state dispatcher. That refactor was approved and is correct, but it also reduced five validation-loop test
files to a single lifecycle-boundary test each. Measured against `932ed610`, the last commit before the refactor merged:

| file                                   | before          | after       |
| -------------------------------------- | --------------- | ----------- |
| `validation-loop-recovery.test.js`     | 1146 / 12 tests | 49 / 1      |
| `validation-loop-human-review.test.js` | 754 / 8 tests   | 57 / 1      |
| `validation-loop-delivery.test.js`     | 730 / 9 tests   | 57 / 1      |
| `validation-loop-repair.test.js`       | 691 / 9 tests   | 49 / 1      |
| `validation-loop-core.test.js`         | 426 / 9 tests   | 74 / 2      |
| **total**                              | **3747 / 47**   | **286 / 6** |

`validation-loop-review.test.js` was already restored during review (57 → 533 lines, 1 → 12 tests) and is **not** part
of this Plan. It is the worked example for everything below.

The surviving tests are good — "publishes only from `validated_reviewer` after human review is durably complete" is
worth having — but one boundary assertion per file is not the delivery, repair, and recovery behavior it replaced. The
whole suite stayed green throughout, which is exactly why the loss was invisible.

Some of those 47 tests are genuinely dead. They drove `haltReason`, nested CI retry loops, and continuation plumbing
through a single `runValidationLoop` call, and that driver no longer exists. `validation-loop-recovery.test.js` at 1146
lines is the most likely to be largely in this category. Restoring a test count would therefore be its own dishonesty.

## Objective

Every one of the 47 dropped tests ends this change with a stated disposition, and no test is left unaccounted for.

For each dropped test, exactly one of:

- **Rewritten** — the behavior it protected still exists, and a test now asserts it against the lifecycle shape: seed
  the Plan at the phase under test, call `runValidationLoop` once, assert both the observable behavior and the recorded
  Plan Event.
- **Removed** — the behavior it protected no longer exists, and the disposition names that behavior and why the refactor
  removed it.

The count of tests afterwards is an outcome, not a target. A file that legitimately ends with four rewritten tests and
five named removals has satisfied this Plan.

## Approach

Recover the dropped tests from `932ed610` and work one file at a time, because the disposition question is per-test and
cannot be answered in bulk.

For each file:

1. List its pre-refactor test names from `932ed610`.
2. For each name, read the original test and decide whether its subject survived the refactor.
3. Rewrite the survivors using the pattern already established in `validation-loop-review.test.js`.
4. Record every name and its disposition in `docs/validation-test-disposition.md`.

The rewrite pattern is fixed by the lifecycle shape and is visible in `validation-loop-review.test.js`: build a project
with `makeValidationProjectRoot` seeded at the phase under test, set the active execution workflow, call
`runValidationLoop` **once**, then assert the observable outcome — the returned result kind, the persisted Plan Status
and counters read back with `loadPlan`, and any durable Front Matter the phase owns. A behavior that previously needed
two phases in one call is now two calls with a Plan reload between them.

Do not reintroduce `__deps` seams to make a test convenient. Where a test needs an external boundary, use the existing
`semanticReviewPort` capability or fake the environment, per the test-writing skill.

The disposition document is the deliverable that makes this Plan checkable, not a report artifact. Format:

```markdown
| Test                                                                                 | File     | Disposition | Detail                                                                                                  |
| ------------------------------------------------------------------------------------ | -------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `runValidationLoop pauses with Engineer when CI repair does not call task_completed` | repair   | rewritten   | Now seeded at `implemented`; asserts paused result and `validationCiAttempts` increment.                |
| `<name>`                                                                             | recovery | removed     | Asserted `haltReason` propagation through the multi-phase driver, which the lifecycle refactor deleted. |
```

## Files to Modify

- `docs/validation-test-disposition.md` — new; one row per dropped test with its disposition. This is the artifact the
  Verification Plan checks.
- `src/shared/workflow/validation-loop-repair.test.js` — CI repair dispatch, repair completion detection, Frontend
  Engineer owner preservation, repair diff failures.
- `src/shared/workflow/validation-loop-delivery.test.js` — publication, merge-back proof, Direct Delivery evidence,
  sibling/Epic delivery interaction.
- `src/shared/workflow/validation-loop-human-review.test.js` — Local Human Code Review modes, decisions, feedback repair
  dispatch, durable human-review Front Matter.
- `src/shared/workflow/validation-loop-recovery.test.js` — fail-closed execution context resolution, worktree metadata
  recovery, unsettled-transition reporting.
- `src/shared/workflow/validation-loop-core.test.js` — entry conditions, scope rules, phase boundaries.
- `src/shared/workflow/validation-test-helpers.js` — extend only if a helper is needed by more than one file; prefer
  reusing what `validation-loop-review.test.js` already uses.

`docs/domain-language.md` needs no change: this introduces no domain language.

## Reuse Opportunities

- `src/shared/workflow/validation-loop-review.test.js` — the worked example for every rewrite in this Plan. Match its
  structure rather than inventing a second style.
- `src/shared/workflow/validation-test-helpers.js` — `makeValidationProjectRoot`, `makeRecordedSession`, `makeUi`,
  `noOpWorktreePlanHandoffDeps` already provide the fixtures.
- `semanticReviewPort` in `src/shared/workflow/validation.ts` — the existing capability for the Semantic Reviewer and
  user-interaction boundaries. Extend it rather than adding `__deps` seams.
- `src/skills/write-tests/SKILL.md` — the authority on what a real test is here; load it before writing.
- `932ed610` — the pre-refactor source of every dropped test.

## Implementation Steps

Steps are outcomes: each is true or false when the step is done.

- [ ] `docs/validation-test-disposition.md` exists and contains one row for **every** test name present in the five
      files at `932ed610`, each marked `rewritten` or `removed`, with a non-empty Detail. No name appears twice.
- [ ] Every row marked `removed` names the specific behavior that no longer exists and why the lifecycle refactor
      removed it. "Superseded", "no longer applicable", and "covered elsewhere" without naming where are not details.
- [ ] Every row marked `rewritten` corresponds to a test that exists in the matching file and asserts through
      `runValidationLoop` at a seeded Plan Status.
- [ ] `validation-loop-repair.test.js` covers CI repair dispatch and repair-completion detection for every rewritten row
      assigned to it.
- [ ] `validation-loop-delivery.test.js` covers publication and Direct Delivery evidence for every rewritten row
      assigned to it.
- [ ] `validation-loop-human-review.test.js` covers human-review modes and decision persistence for every rewritten row
      assigned to it.
- [ ] `validation-loop-recovery.test.js` covers fail-closed context resolution for every rewritten row assigned to it.
- [ ] `validation-loop-core.test.js` covers entry conditions and phase boundaries for every rewritten row assigned to
      it.
- [ ] No new `__deps` seam names exist; `deno task seams:check` passes without a baseline increase.
- [ ] Each rewritten test fails when the behavior it covers is broken on purpose. Spot-check at least one per file and
      record which one in the completion report.

## Verification Plan

- Automated:
  - `deno task test src/shared/workflow`
  - `deno task ci`
  - `deno task seams:check`
- **Check that fails if the objective was not met** — every dropped test name must be accounted for. This prints nothing
  when the Plan is complete, and prints the unaccounted names otherwise:

  ```sh
  comm -23 \
    <(for f in core delivery human-review recovery repair; do
        git show 932ed610:src/shared/workflow/validation-loop-$f.test.js
      done | grep -oE '^Deno\.test\("[^"]+"' | sed 's/^Deno.test("//;s/"$//' | sort -u) \
    <(grep -oE '`[^`]+`' docs/validation-test-disposition.md | tr -d '`' | sort -u)
  ```

  A run that outputs any test name is a failure, not a warning.

- Manual:
  - Read the `removed` rows. Each should describe behavior a reader can confirm is gone from `validation.ts` — if a row
    could equally describe surviving behavior, it is a rewrite that was skipped.
  - Confirm the rewritten tests seed a Plan and call `runValidationLoop` once, rather than reconstructing a driver loop
    inside the test.
- Expected results:
  - The disposition check prints nothing.
  - `deno task ci` passes with a **higher** total test count than before this change.
  - `deno task seams:check` reports no increase.

## Edge Cases & Considerations

- The count is not the goal. A file may legitimately end with fewer tests than it had; what may not happen is a test
  disappearing without a named reason.
- A rewritten test may fail because it found a real defect the lifecycle refactor introduced. That is a success of this
  Plan. Fix it if the fix is small and clearly in scope; otherwise stop and report it with the failing assertion rather
  than adjusting the test to pass.
- Behavior that legitimately died includes `haltReason` propagation, nested CI retry loops,
  `pauseForExecutionContinuation`, and any assertion that depended on multiple phases running inside one
  `runValidationLoop` call.
- Some original tests asserted call counts or call order on injected fakes. Those must not be reproduced as-is even when
  the behavior survives; assert the observable state the phase persisted instead.
- If a behavior survived but cannot be reached without reintroducing a seam, stop and report the exact boundary rather
  than adding one.
- `validation-loop-review.test.js` is out of scope. Do not rewrite it; it is the reference.
