---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/plan-store.js"
    - "src/shared/workflow/state-transition.ts"
    - "src/shared/work-records/supersession.ts"
    - "src/plan-store.test.js"
    - "src/shared/workflow/plan-location.integration.test.ts"
    - "src/shared/workflow/validation-lifecycle-resume.test.js"
    - "src/shared/workflow/validation-operational-recovery.test.ts"
executionAgent: "engineer"
createdAt: "2026-08-29T03:04:57.881Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 4
dependencies:
    - "03-move-primary-runtime-stores"
planId: "a1a0491f-1e3f-44c4-b083-9b71558f239f"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Move Selected-Checkout Runtime Stores

## Context

Plan document locks, catalog locks, transition journals, and Work Record supersession locks are selected-checkout state.
They protect the checkout that owns the document mutation or checkout-local operation. Today they use the old `.wld/`
runtime location.

Primary stores moved in the previous child Plan. This child Plan moves selected-checkout stores and preserves their
authority.

## Objective

Move selected-checkout runtime readers and writers below the selected checkout's `.wld/internal/` root. Plan lifecycle
behavior must remain the same: Plan Markdown remains the human lifecycle authority, and transaction journals continue to
protect rollback and recovery.

## Approach

Replace selected-checkout uses of the old runtime root with named layout helpers. Keep the existing lock order,
stale-lock rules, and transition journal semantics.

Selected ownership after this slice:

```text
selected .wld/internal
  plan-locks/*.lock
  plan-transitions/*.json
  work-record-supersession.lock
  work-record-supersession-recovery.lock
```

The main option set aside is making all selected locks primary-owned. That would simplify paths, but it would break
linked execution worktree isolation and let one checkout lock the wrong document owner.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/plan-store.js` — move Plan and catalog locks to the selected internal root.
- `src/shared/workflow/state-transition.ts` — move transition journals to the selected internal root.
- `src/shared/work-records/supersession.ts` — move Work Record supersession and recovery locks to the selected internal
  root.
- Plan-store, lifecycle, and Work Record tests — update expected paths and preserve concurrency/recovery behavior.

## Reuse Opportunities

- `src/shared/project-runtime-layout.ts` — use selected-checkout path helpers.
- `src/plan-store.js` — keep existing lock naming, stale-lock, and revision-checked write behavior.
- `src/shared/workflow/state-transition.ts` — keep journal recovery and rollback guarantees.
- `src/shared/work-records/supersession.ts` — keep existing heartbeat and stale-lock rules.

## Implementation Steps

- [ ] Plan locks and catalog locks are created only below the selected checkout internal root.
- [ ] Transition journals are created, read, and removed only below the selected checkout internal root.
- [ ] Work Record supersession and recovery locks are created only below the selected checkout internal root.
- [ ] Linked-worktree fixtures prove selected-document locks and journals stay in the selected checkout, while primary
      records remain in the primary checkout.
- [ ] Recovery paths still find journals created in registered execution worktrees where applicable.
- [ ] Existing stale-lock and rollback behavior remains covered by tests.
- [ ] CI remains green after selected-checkout runtime stores stop writing legacy paths.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/plan-store.test.js src/shared/workflow/plan-location.integration.test.ts src/shared/workflow/validation-lifecycle-resume.test.js src/shared/workflow/validation-operational-recovery.test.ts src/shared/work-records`.
- Automated: `deno task seams:check`.
- Automated: `deno task ci` must pass before the next child Plan starts.
- Expected result: selected-checkout runtime artifacts are created below selected `.wld/internal/` and not below legacy
  selected `.wld/` paths.
- Expected result: behavior expected to remain protected includes Plan lock exclusivity, catalog lock ordering,
  transition rollback, and Work Record supersession recovery.
- Expected result: any temporary skipped tests must be marked for final cleanup and must not cover behavior owned by
  this child.

## Edge Cases & Considerations

- Plan locks protect document writes, not controller state.
- Transition journals can exist in execution worktrees as well as the primary checkout.
- Work Record locks were missing from the old owned-path list; the internal boundary must now contain them
  automatically.
