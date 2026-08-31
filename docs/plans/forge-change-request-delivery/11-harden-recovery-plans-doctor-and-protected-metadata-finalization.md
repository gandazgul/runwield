---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/transition-recovery.ts"
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/cmd/load-plan/"
    - "src/cmd/plans/doctor.ts"
    - "src/ui/tui/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:48.020Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 11
dependencies:
    - "10-fold-selected-review-feedback-into-work-records"
planId: "2c7ca2e1-5f78-4e14-99e6-232c1de8d056"
targetBranch: "project/forge-change-request-delivery"
---

# Harden recovery, Plans Doctor, and protected metadata finalization

## Context

Change Request Delivery can remain open for a long time. RunWield can be offline while the request changes or merges.
Metadata finalization can also fail after code merge proof, especially on protected targets.

## Objective

Complete recovery and observability for long-lived delivery attempts. Resume safely after process loss, report known and
unknown external facts, and handle protected metadata finalization through a recoverable metadata-only request when
direct metadata publication is blocked.

## Approach

Make restart reconciliation read saved attempt identity and fresh provider/Git facts, then advance only phases those
facts prove. Plans Doctor and load-plan should explain the next safe action, not invent provider policy.

```text
resume/load-plan
  -> read saved ForgeDeliveryAttempt
  -> refresh provider + Git evidence
  -> advance proven phase only
  -> if metadata blocked, open or resume metadata-only request
```

The option set aside is a daemon or webhook. That would give faster updates, but V1 only needs foreground refresh and
resume reconciliation.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/plan-lifecycle.md` — document recoverable In Review and finalization-pending states.
- Forge coordinator and recovery modules under `src/shared/workflow/` — restart reconciliation, metadata-only
  finalization, and failure receipts.
- `src/shared/workflow/transition-recovery.ts` — reuse unresolved transition handling where appropriate.
- `src/shared/worktree-registry.js` — retain attempts until final proof and cleanup.
- `src/cmd/load-plan/` — present resume and recovery choices for Change Request Delivery.
- `src/cmd/plans/doctor.ts` — report stale, closed, inaccessible, merged-but-pending, and uncertain delivery states.
- `src/ui/tui/` — display recovery facts and next actions in terminal flows.
- `src/testing/` — add restart matrices and doctor coverage.

## Reuse Opportunities

- Publication failure matrix tests — reuse stop-after-each-effect pattern.
- Transition recovery journal — reuse idempotent recovery and uncertain-effect discipline.
- Plans Doctor issue formatting — reuse severity/guidance patterns.

## Implementation Steps

- [ ] Restart after each Forge side effect and local receipt write resumes without duplicate PR/MR creation, duplicate
      metadata, or lost repair/fold state.
- [ ] `load-plan` can refresh and reconcile open, stale, closed-unmerged, inaccessible, temporarily unavailable, merged,
      finalization_pending, and complete states.
- [ ] Plans Doctor reports delivery-state issues with clear owner, known fact, uncertainty, and next action.
- [ ] A proven code merge survives later Recorder, indexing, or metadata-publication failure as a durable receipt.
- [ ] When direct metadata publication is blocked by repository policy, RunWield opens or resumes a metadata-only Forge
      Change Request and finalizes only after proving its merge.
- [ ] Cleanup is idempotent and runs only after finalization proof.

## Verification Plan

- Automated: run multi-process restart matrices through `deno run -A scripts/run-tests.js <test paths>`.
- Automated: stop after each side effect and receipt write, then prove idempotent discovery, no duplicate metadata,
  retained repair state, exact evidence, and safe cleanup.
- Automated: cover closed-unmerged, inaccessible, network loss, rate limit, and protected metadata paths.
- Automated: run focused Plans Doctor and load-plan tests.
- Expected result: RunWield can recover truthful state without a daemon or webhook.

## Edge Cases & Considerations

- A protected metadata-only request can itself remain open; code merge proof remains safe but Plan completion stays
  pending.
- Inaccessible provider state is uncertainty, not failure proof.
- Doctor output must not tell the user that work is safe when proof is incomplete.
