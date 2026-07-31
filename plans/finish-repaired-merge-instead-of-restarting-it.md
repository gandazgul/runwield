---
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Carry the merge repair worktree across validation calls so a repaired merge is published instead of restarted, restoring repair-then-finish behavior lost when validation became phase-driven."
affectedPaths:
    - "src/plan-store.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-loop-delivery.test.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "docs/plan-lifecycle.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-31T13:58:11-04:00"
status: "ready_for_work"
planId: "21bd9fe8-84b7-4b23-80cf-9f9fbf22f303"
---

# Finish a Repaired Merge Instead of Restarting It

## Context

Publishing a Plan can fail on a merge conflict. RunWield handles that by creating a **merge worktree**, dispatching the
execution Agent to resolve the conflict there, and then publishing that already-merged tree — it does not re-run the
merge from scratch.

`mergeExecutionWorktree` still supports this: given `repairMergeWorktreePath` it calls `publishRepairedMergeWorktree`
instead of starting a new merge (`src/shared/worktree.js:950` and `:979`). Merge failures still carry the path on the
typed error, readable with the `getMergeWorktreePath(error)` helper that the pre-refactor driver used.

What is missing is the connection between the two. The old driver held the path in a loop-local variable:

```js
let pendingRepairMergeWorktreePath;                                  // validation.js:2578
pendingRepairMergeWorktreePath = getMergeWorktreePath(error) || …;   // on failure
repairMergeWorktreePath: pendingRepairMergeWorktreePath,             // on the retry merge
pendingRepairMergeWorktreePath = undefined;                          // on success
```

When validation became phase-driven, that variable died with the loop. The retry is now a **separate**
`runValidationLoop` call, so nothing survives between the failure and the retry. `validation.ts` neither captures the
path nor passes it, so a repaired merge worktree is abandoned and the next publication attempt starts a fresh merge into
the same conflict.

Recent fixes restored the rest of the sequence — repair is dispatched, it goes to `error.repairCwd`, the failure is
announced before the Agent starts, and a completed repair leaves the Plan at `validated_reviewer` so publication retries
directly. This Plan supplies the one remaining piece: the retry must finish the repaired merge.

## Objective

A merge conflict repaired by the execution Agent is published, not merged again.

After this change, when publication fails with a merge worktree and the Agent repairs it, the next `runValidationLoop`
call passes that worktree to `mergeExecutionWorktree` as `repairMergeWorktreePath`, so publication completes the
repaired tree. The path is durable Plan state, so it survives the process ending between the repair and the retry.

A stale path must never be used: any event that returns the Plan to `implemented` invalidates the repaired merge,
because the code changed underneath it.

## Approach

Store the path in Plan Front Matter rather than in session state. The session already lost this once by holding it in
memory, and a merge repair can outlive the process that started it. Front Matter is RunWield-owned, already carries
`validationCiAttempts` and `validationSemanticRounds`, and is read back through the same canonical load the phase
dispatcher uses.

Add `validationMergeRepairWorktree` to Plan Front Matter, written only through `recordPlanEvent`:

| event                           | effect on the field                                               |
| ------------------------------- | ----------------------------------------------------------------- |
| `worktree_merge_failed`         | set to the merge worktree path from the typed error, when present |
| `validation_passed`             | cleared — the merge published, the worktree is spent              |
| any transition to `implemented` | cleared — repair edited code, so the merged tree is stale         |

In `runPublicationPhase`, read the field from the canonical Plan attributes already loaded by the phase dispatcher and
pass it to `mergeExecutionWorktree` as `repairMergeWorktreePath`. Capture `getMergeWorktreePath(error)` on failure and
include it in the details recorded with `worktree_merge_failed`.

The successful-repair path currently returns without recording an event, which keeps the Plan at `validated_reviewer`.
That path must still persist the worktree path, or the retry has nothing to read. Record it through the existing Front
Matter transition rather than writing the Plan directly.

## Files to Modify

- `src/plan-store.js` — add `validationMergeRepairWorktree` to the Plan Front Matter typedef and any list that preserves
  known metadata.
- `src/shared/workflow/plan-lifecycle.js` — set the field on `worktree_merge_failed`, clear it on `validation_passed`
  and on every transition into `implemented`, alongside the existing counter resets.
- `src/shared/workflow/validation.ts` — add a local `getMergeWorktreePath(error)` beside `getMergeRepairCwd`; pass the
  stored path into `mergeExecutionWorktree`; persist it when a repair completes.
- `src/shared/workflow/validation-loop-delivery.test.js` — cover the retry passing the stored path, and clearing.
- `src/shared/workflow/plan-lifecycle.test.js` — cover set/clear across the three events.
- `docs/plan-lifecycle.md` — document the field with the counters it sits beside.

`CONTEXT.md` needs no change: merge worktree and Direct Delivery are already defined terms.

## Reuse Opportunities

- `src/shared/worktree.js` `publishRepairedMergeWorktree` and the `repairMergeWorktreePath` parameter — the publishing
  half already exists and is unchanged by this Plan.
- `getMergeWorktreePath(error)` at `932ed610:src/shared/workflow/validation.js:764` — the extraction helper to port.
- `src/shared/workflow/plan-lifecycle.js` `buildPlanEventUpdates` — the one place Front Matter changes on an event; the
  counter resets there are the pattern to follow.
- `validationCiAttempts` / `validationSemanticRounds` — precedent for durable per-phase validation state.
- `getMergeRepairCwd` in `validation.ts` — the sibling helper this one sits next to.

## Implementation Steps

- [ ] `validationMergeRepairWorktree` exists in the Plan Front Matter typedef and survives a `savePlan`/`loadPlan` round
      trip.
- [ ] `recordPlanEvent` with `worktree_merge_failed` and a merge worktree path in details persists that path.
- [ ] `recordPlanEvent` with `validation_passed` clears the field.
- [ ] Every transition that produces `implemented` clears the field, including `validation_failed` and
      `semantic_review_feedback`.
- [ ] `runPublicationPhase` passes the stored path to `mergeExecutionWorktree` as `repairMergeWorktreePath` when the
      canonical Plan carries one, and omits it otherwise.
- [ ] A completed merge repair persists the merge worktree path before returning, so the next call can read it.
- [ ] `getMergeWorktreePath` exists in `validation.ts` beside `getMergeRepairCwd` and reads `mergeWorktreePath` off the
      typed merge error.

## Verification Plan

- Automated:
  - `deno task test src/shared/workflow`
  - `deno task ci`
  - `deno task seams:check` — must not increase.
- **Checks that fail if the objective was not met:**
  - Seed a Plan at `validated_reviewer` with `validationMergeRepairWorktree` set, run `runValidationLoop` with a
    `mergeExecutionWorktree` fake that records its arguments, and assert `repairMergeWorktreePath` was passed. This
    fails today.
  - Seed the same Plan without the field and assert `repairMergeWorktreePath` is absent, so the field is not invented.
  - Record `validation_passed`, then assert `validationMergeRepairWorktree` is absent from the Plan.
  - Record `semantic_review_feedback` from `validated_ci`, then assert the field is cleared, proving a stale repaired
    merge cannot be published after code changed.
  - Break each on purpose once and confirm it goes red.
- Manual:
  - Force a merge conflict on a Planned Change, let the Agent repair it, and confirm the retry publishes the repaired
    tree rather than reporting the same conflict again.
  - Confirm the transition journal for the successful retry records `direct_delivery_target_ref_moved`.
- Expected results:
  - A repaired merge publishes on the next validation call without a second conflict.
  - A Plan returned to `implemented` carries no merge worktree path.

## Edge Cases & Considerations

- **A stale path is worse than no path.** Publishing a merge worktree built before a repair edited the code would ship
  the wrong tree. Clearing on every entry to `implemented` is the guard; do not narrow it to specific events.
- The merge worktree may no longer exist when the retry runs — the user may have removed it. Treat a missing path as "no
  repaired merge available" and fall back to a fresh merge rather than failing.
- Do not write the field outside `recordPlanEvent`. Direct Front Matter writes are how protected lifecycle state has
  been corrupted before.
- This Plan does not change `mergeExecutionWorktree`, `publishRepairedMergeWorktree`, or the repair dispatch. If the
  repaired merge still fails to publish, report it rather than widening scope into the merge implementation.
- Do not add `__deps` seams. The delivery tests already fake the environment; extend that rather than injecting
  RunWield's own merge machinery.
