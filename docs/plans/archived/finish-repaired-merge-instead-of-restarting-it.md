---
planId: "21bd9fe8-84b7-4b23-80cf-9f9fbf22f303"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Carry the merge repair worktree across validation calls so a repaired merge is published instead of restarted, restoring repair-then-finish behavior lost when validation became phase-driven."
affectedPaths:
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/state-transition.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-publication-pause.test.js"
    - "src/shared/workflow/validation-loop-delivery.test.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "docs/plan-lifecycle.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -q \"resumes publication from stored repaired merge worktree\" src/shared/workflow/validation-publication-pause.test.js && deno task test --filter \"stored repaired merge worktree\" src/shared/workflow/validation-publication-pause.test.js"
      rationale: "The command first requires the new real-Git regression test to exist, then runs only that scenario; it fails today because stored repaired merge worktrees are not resumed across validation calls."
    - id: "OC2"
      command: "grep -q \"clears validationMergeRepairWorktree\" src/shared/workflow/plan-lifecycle.test.js && deno task test --filter \"validationMergeRepairWorktree\" src/shared/workflow/plan-lifecycle.test.js"
      rationale: "The command requires and runs lifecycle coverage for clearing stale stored merge-repair paths when validation proof or implementation lineage changes."
    - id: "OC3"
      command: "grep -q \"validation_merge_repair_worktree\" src/shared/workflow/validation.ts && grep -q \"validationMergeRepairWorktree\" src/shared/workflow/validation-loop-delivery.test.js && deno task test --filter \"validationMergeRepairWorktree\" src/shared/workflow/validation-loop-delivery.test.js"
      rationale: "The command requires the status-preserving validation metadata transition to exist and runs delivery-state coverage for persisting/clearing the stored merge repair path."
objectiveChecksBaseline:
    recordedAt: "2026-08-02T23:03:24.808Z"
    head: "06e49895b97558081cb95d6f1e1b32af2184ca16"
    results:
        - id: "OC1"
          command: "grep -q \"resumes publication from stored repaired merge worktree\" src/shared/workflow/validation-publication-pause.test.js && deno task test --filter \"stored repaired merge worktree\" src/shared/workflow/validation-publication-pause.test.js"
          rationale: "The command first requires the new real-Git regression test to exist, then runs only that scenario; it fails today because stored repaired merge worktrees are not resumed across validation calls."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 6
          output: "\n"
        - id: "OC2"
          command: "grep -q \"clears validationMergeRepairWorktree\" src/shared/workflow/plan-lifecycle.test.js && deno task test --filter \"validationMergeRepairWorktree\" src/shared/workflow/plan-lifecycle.test.js"
          rationale: "The command requires and runs lifecycle coverage for clearing stale stored merge-repair paths when validation proof or implementation lineage changes."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 5
          output: "\n"
        - id: "OC3"
          command: "grep -q \"validation_merge_repair_worktree\" src/shared/workflow/validation.ts && grep -q \"validationMergeRepairWorktree\" src/shared/workflow/validation-loop-delivery.test.js && deno task test --filter \"validationMergeRepairWorktree\" src/shared/workflow/validation-loop-delivery.test.js"
          rationale: "The command requires the status-preserving validation metadata transition to exist and runs delivery-state coverage for persisting/clearing the stored merge repair path."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 5
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-31T13:58:11-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-02T23:19:44.641Z"
verifiedAt: "2026-08-03T01:59:59.872Z"
userVerifiedAt: null
executionReport: "- Implemented durable `validationMergeRepairWorktree` Front Matter support, transactional `validation_merge_repair_worktree` persistence/clearing, publication seeding from stored existing paths, and fail-closed handling for blocked persistence.\n- Updated Plan Lifecycle clearing so spent/stale merge repair paths are cleared on `validation_passed`, implemented re-entry, and execution/recovery/review/hold reset events; documented the field and its distinction from `worktree_merge_failed`.\n- Added automated coverage: +4 tests, 0 removed/replaced; new tests cover real-Git stored repaired merge publication resume, Front Matter round-trip/clearing, and lifecycle invalidation clearing.\n- Verification passed: targeted workflow tests, objective checks OC1/OC2/OC3, `deno task test src/shared/workflow`, `deno task seams:check`, and full `deno task ci`."
workRecord:
    status: "generated"
    recordId: "25b2cee1-cf4d-48b9-bda8-128f46042045"
    path: "docs/work-records/2026-08-03-resumed-repaired-merge-publication.md"
    lastAttemptAt: "2026-08-03T02:00:33.488Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "89b54779b252325903f1b13bf162152e10feae36"
    targetBranch: "main"
    targetHeadBeforeMerge: "bb11ce0630fd8a5dae820872ccab18192cb3ed60"
validationCiAttempts: 0
validationSemanticRounds: 0
updatedAt: "2026-08-10T00:10:08.345Z"
archivedAt: "2026-08-10T00:10:08.345Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/finish-repaired-merge-instead-of-restarting-it.md"
---

# Finish a Repaired Merge Instead of Restarting It

## Context

Publishing a Plan can fail on a Git merge conflict. RunWield's intended behavior is to create a detached **merge
worktree**, dispatch the execution Agent to resolve the conflict there, and then publish that already-resolved tree. It
must not restart the merge from scratch after the repair, because restarting walks back into the same conflict.

The publishing half already exists. `mergeExecutionWorktree` accepts `repairMergeWorktreePath` and, when present, calls
`publishRepairedMergeWorktree` before attempting a fresh merge (`src/shared/worktree.js:927` and
`src/shared/worktree.js:1132`). Typed merge errors also already expose both `repairCwd` and `mergeWorktreePath`, and
`validation.ts` now has `getMergeWorktreePath(error)` beside `getMergeRepairCwd(error)`.

The remaining gap is durability across validation calls. Current `runPublicationPhase` stores a repaired merge path only
in a local variable:

```ts
let repairMergeWorktreePath: string | undefined;
repairMergeWorktreePath = getMergeWorktreePath(error) || repairMergeWorktreePath;
// later: mergeExecutionWorktree({ ..., repairMergeWorktreePath })
```

That fixes retries that happen inside the same `runValidationLoop` call, but not the product case this Plan is for: a
merge repair can outlive the call that discovered it. The execution Agent may finish in a later Session turn, the
process may exit, or the user may resume the Plan after an interruption. The next phase-driven `runValidationLoop` call
reloads canonical Plan Front Matter, has no local variable, and starts a fresh merge instead of finishing the repaired
merge worktree.

This cannot be solved by recording the existing `worktree_merge_failed` Plan Event. That event intentionally transitions
`validated_reviewer -> implemented`, which means fresh Mechanical Validation and Semantic Code Review. The desired
behavior keeps the Plan at `validated_reviewer`: tests and review have already passed; only Direct Delivery publication
is outstanding.

## Objective

A merge conflict repaired by the execution Agent is published, not merged again.

After this change, when publication creates a detached merge worktree and dispatches a repair, RunWield stores that
merge worktree path as durable validation-continuation Front Matter while the Plan remains `validated_reviewer`. A later
`runValidationLoop` call reads the path from the canonical Plan and passes it to `mergeExecutionWorktree` as
`repairMergeWorktreePath`, so Direct Delivery finishes the repaired tree.

A stale path must never be used. Any lifecycle event that invalidates the current implementation or current validation
proof clears the stored merge repair path before the publication phase can see it.

## Approach

Add `validationMergeRepairWorktree` to Plan Front Matter as nullable validation-continuation state. It is not a new Plan
Status and not a user-facing workflow mode; it is the durable equivalent of the local `repairMergeWorktreePath` variable
that phase-driven validation can reload.

Persist the field with a small validation helper built on `runPlanFrontMatterTransition`, using an operation name such
as `validation_merge_repair_worktree`. This follows the existing Local Human Code Review metadata pattern: it updates
RunWield-owned Front Matter transactionally without forcing a lifecycle status change. The helper must check the
transition result and fail closed if the write is blocked or needs recovery; do not dispatch an Agent to repair a merge
whose repair worktree path was not durably recorded.

Do not use `recordPlanEvent("worktree_merge_failed")` for the normal Agent-repair path. That event remains the lifecycle
path for an actual merge-failure state that returns to `implemented`; using it here would recreate the bug by sending
the Plan back through validation instead of directly retrying publication.

Field behavior:

| workflow fact                                            | effect on `validationMergeRepairWorktree`                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| publication error exposes `mergeWorktreePath`            | persist the path before Agent repair or user pause while status stays as-is   |
| next `validated_reviewer` publication call sees the path | pass it to `mergeExecutionWorktree` as `repairMergeWorktreePath`              |
| stored path is missing before retry                      | clear the field and attempt a fresh merge rather than failing on stale state  |
| `validation_passed`                                      | clear the field; the repaired merge worktree has been published/spent         |
| any transition to `implemented`                          | clear the field; code or validation proof changed, so the merge tree is stale |
| execution/recovery/review-reopen transitions             | clear the field when they discard or replace the current validation lineage   |

In `runPublicationPhase`, seed the local `repairMergeWorktreePath` from `args.triageMeta.validationMergeRepairWorktree`
(the canonical Plan attributes loaded by `runValidationPhase`) and keep the existing same-call local retry behavior.
When a new typed merge failure supplies a path, persist it immediately and update the local variable. On successful
publication, rely on `validation_passed` lifecycle updates to clear the field.

## Files to Modify

- `src/plan-front-matter.js` — add `validationMergeRepairWorktree` to the canonical Front Matter key map/order near the
  other validation-continuation metadata.
- `src/plan-store.js` — add `validationMergeRepairWorktree?: string|null` to the `PlanFrontMatter` typedef and normalize
  it as an optional Front Matter string so `savePlan`/`loadPlan` round trips are typed and deterministic.
- `src/shared/workflow/plan-lifecycle.js` — clear the field on `validation_passed`, every transition whose target status
  is `implemented`, and validation-lineage reset/abandon events such as `execution_started`, `recovery_reset`,
  `recovery_continue`, `review_reopened`, and `hold_reset_to_draft`.
- `src/shared/workflow/state-transition.ts` — add a plain-language description for the
  `validation_merge_repair_worktree` Front Matter transition so recovery/blocking messages are understandable.
- `src/shared/workflow/validation.ts` — add helpers to read, validate, persist, and clear the stored merge repair
  worktree path; seed/pass `repairMergeWorktreePath`; persist typed merge paths before repair dispatch; clear missing
  stored paths before falling back to a fresh merge.
- `src/shared/workflow/validation-publication-pause.test.js` — add real-Git coverage for resuming publication from a
  stored repaired merge worktree in a fresh validation call.
- `src/shared/workflow/validation-loop-delivery.test.js` — add focused Plan Front Matter delivery-state coverage where a
  lightweight fixture is sufficient, without adding a new machinery seam.
- `src/shared/workflow/plan-lifecycle.test.js` — cover lifecycle clearing behavior for `validationMergeRepairWorktree`.
- `docs/plan-lifecycle.md` — document `validationMergeRepairWorktree` as transient validation continuation metadata and
  distinguish it from the `worktree_merge_failed` lifecycle event.

`docs/domain-language.md` needs no change: merge worktree, Direct Delivery, Front Matter, Workflow Validation, and Plan
Lifecycle are already canonical terms, and this field is implementation metadata rather than new domain language.

## Reuse Opportunities

- `src/shared/worktree.js` `mergeExecutionWorktree` / `publishRepairedMergeWorktree` — the publishing behavior for a
  repaired merge worktree already exists; this Plan only ensures validation passes it the stored path.
- `getMergeWorktreePath(error)` and `getMergeRepairCwd(error)` in `validation.ts` — existing typed merge-error helpers.
- `persistHumanReviewMetadata` in `validation.ts` — precedent for transactional, status-preserving validation metadata
  writes through `runPlanFrontMatterTransition`.
- `runPlanFrontMatterTransition` in `src/shared/workflow/state-transition.ts` — the protected Front Matter write
  boundary for non-status validation metadata.
- `buildPlanEventUpdates` in `src/shared/workflow/plan-lifecycle.js` — central lifecycle clearing point for stale
  validation metadata.
- Existing real-Git publication tests in `validation-publication-pause.test.js` and repaired-merge coverage in
  `src/shared/worktree-merge.test.js`.

## Implementation Steps

- [ ] `PlanFrontMatter` and `PLAN_FRONT_MATTER_KEYS` include `validationMergeRepairWorktree`, and a saved Plan with that
      field reloads it as the same string value.
- [ ] A validation helper persists `{ validationMergeRepairWorktree: <path> }` through `runPlanFrontMatterTransition`
      with operation `validation_merge_repair_worktree` and treats any non-committed transition result as a blocking
      validation outcome, not as a best-effort warning.
- [ ] The same helper clears the field with `null` when the stored path is spent, missing, or invalidated.
- [ ] `runPublicationPhase` seeds `repairMergeWorktreePath` from canonical Plan Front Matter before the first
      publication attempt, after verifying the stored path still exists.
- [ ] When a publication error exposes `mergeWorktreePath`, `runPublicationPhase` persists that path before dispatching
      merge repair or pausing for user action, then uses the path for same-call retries as it does today.
- [ ] `runPublicationPhase` passes `repairMergeWorktreePath` to `mergeExecutionWorktree` only when it has a current,
      existing stored path; otherwise the argument is omitted/`undefined` and a normal fresh merge is attempted.
- [ ] `buildPlanEventUpdates` clears `validationMergeRepairWorktree` on `validation_passed`, on every transition to
      `implemented` (including `validation_failed`, `semantic_review_feedback`, `mechanical_validation_failed`, and
      `worktree_merge_failed`), and on execution/recovery/review-reopen reset events that abandon the current validation
      lineage.
- [ ] Documentation states that `validationMergeRepairWorktree` keeps a `validated_reviewer` Plan publishable after an
      interrupted merge repair, while `worktree_merge_failed` still means the lifecycle returned to `implemented`.

## Verification Plan

- Automated:
  - `deno task test src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/validation-publication-pause.test.js`
  - `deno task test src/shared/workflow`
  - `deno task seams:check` — must not increase.
  - `deno task ci`

### Objective-Failing Checks

These checks are red on the current code and can only go green when the repaired-merge continuation behavior is
implemented and covered:

- `OC1` —
  `grep -q "resumes publication from stored repaired merge worktree" src/shared/workflow/validation-publication-pause.test.js && deno task test --filter "stored repaired merge worktree" src/shared/workflow/validation-publication-pause.test.js`
  — proves a fresh validation call publishes the already-repaired detached merge worktree instead of starting a new
  conflicting merge.
- `OC2` —
  `grep -q "clears validationMergeRepairWorktree" src/shared/workflow/plan-lifecycle.test.js && deno task test --filter "validationMergeRepairWorktree" src/shared/workflow/plan-lifecycle.test.js`
  — proves lifecycle events clear stale merge-repair paths when validation proof or implementation lineage changes.
- `OC3` —
  `grep -q "validation_merge_repair_worktree" src/shared/workflow/validation.ts && grep -q "validationMergeRepairWorktree" src/shared/workflow/validation-loop-delivery.test.js && deno task test --filter "validationMergeRepairWorktree" src/shared/workflow/validation-loop-delivery.test.js`
  — proves the validation metadata transition exists and is exercised by a delivery-state test, including
  persistence/clearing behavior for the stored path.

The implementation must also add these underlying test scenarios:

- A real-Git test creates a detached merge conflict, resolves it in the merge worktree, saves a Plan at
  `validated_reviewer` with `validationMergeRepairWorktree` set to that path, starts a fresh `runValidationLoop`, and
  asserts the target branch contains the repaired merge result and the Plan is `verified`. This fails today because the
  stored path is ignored and validation starts a fresh conflicting merge.
- A focused test saves `validationMergeRepairWorktree: "/tmp/missing-runwield-merge"`, runs publication with a
  non-conflicting worktree, and asserts the missing path is cleared and `repairMergeWorktreePath` is not used; the Plan
  should still publish through a fresh merge.
- Lifecycle tests assert `buildPlanEventUpdates("validation_passed", "validated_reviewer", ...)` and
  `buildPlanEventUpdates("semantic_review_feedback", "validated_ci", { triageMeta: { validationMergeRepairWorktree:
  "/tmp/m" } })`
  both produce `validationMergeRepairWorktree: null`.
- A persistence test asserts `savePlan`/`loadPlan` preserves a string `validationMergeRepairWorktree` and that the
  validation metadata helper clears it to `null`.

- Manual:
  - Force a Direct Delivery merge conflict for a Planned Change, let the execution Agent resolve the merge worktree,
    stop or restart before publication retries, then run the Plan again and confirm RunWield publishes the repaired tree
    rather than reporting the same conflict again.
  - Confirm the successful retry records `direct_delivery_target_ref_moved` in the Direct Delivery publication
    transition journal/metrics path and leaves no `validationMergeRepairWorktree` in the verified Plan.
- Expected results:
  - Same-call merge repair still publishes as before.
  - Interrupted or later-resumed merge repair publishes on the next validation call without re-running CI/review and
    without a second conflict.
  - A Plan returned to `implemented` or reset for new execution carries no usable merge repair worktree path.
- Existing behavior that must remain protected:
  - Primary-checkout dirty failures still pause for user action and must not dispatch an Agent.
  - `worktree_merge_failed` remains the lifecycle event for returning to `implemented`; this Plan must not repurpose it
    for the status-preserving repair continuation path.
  - No new `__deps` / `__testDeps` machinery seams are added; use real Git fixtures or existing environment fakes.

## Edge Cases & Considerations

- **A stale path is worse than no path.** Publishing a merge worktree built before an implementation or repair changed
  code could ship the wrong tree. Clear broadly when validation lineage changes rather than trying to enumerate only the
  common stale cases.
- The merge worktree may no longer exist when the retry runs. Treat that as "no repaired merge is available": clear the
  field and try a fresh merge instead of failing on a recorded path that the user or cleanup removed.
- If persisting the merge repair path is blocked by a Plan Front Matter transition problem, stop before dispatching
  merge repair. A repair that cannot be rediscovered after interruption recreates the current bug.
- Do not change `mergeExecutionWorktree`, `publishRepairedMergeWorktree`, or merge repair dispatch unless a test proves
  the existing repaired-merge contract is insufficient. The planned fix is to carry the path into the existing contract.
- Keep the field out of `docs/domain-language.md`; it is not domain language and should be documented in Plan Lifecycle
  docs instead.
