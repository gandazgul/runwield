---
kind: "work_record"
recordId: "5bef62b8-2631-4361-b6d5-d7eae25af0be"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-03T13:49:43.833Z"
provenance:
    sourcePlans:
        - "40fbf2d7-4068-42c5-8841-61331361a950"
---

# Execution preparation progress and Approve & Run busy-spinner fix

## Summary

Plan execution now shows truthful, user-visible RunWield system-status checkpoints during deterministic preparation. A
new typed helper (`src/shared/workflow/execution-preparation-progress.ts`) centralizes checkpoint construction, and
`workflow.js` emits statuses for preparing the execution target, fresh worktree creation (before the Objective-Failing
Check baseline, since the baseline runs in the unmodified execution tree), reused worktrees, non-Git in-place execution,
baseline runs, Plan materialization/restoration, Plan status updates, and Engineer/Frontend Engineer launch.
`runtime-interaction-adapter.js` now restores the TUI busy spinner after approved `run` Plan Reviews, fixing the
stuck-idle Approve & Run experience without touching approve-for-later flows. Coverage grew by 5 tests (4 new behavior
tests in `execution-progress.test.ts`, 1 busy workflow-operation test in `session-runtime.test.js`), with existing
adapter and load-plan tests strengthened. RunWield Workflow Validation passed: all three Objective-Failing Checks,
targeted suites, full `deno task test`, and `deno task seams:check`.

## Deviations from Plan

Checkpoint ordering places worktree creation before the Objective-Failing Check baseline (correcting the initially
requested order) because the baseline must run in the unmodified execution worktree at the selected base commit. Manual
TUI verification steps from the Verification Plan were not performed because the execution session was non-interactive;
automated coverage exercises the same status and busy-state flows. A transient npm node_modules lock-message failure in
`src/cmd/help/index.test.ts` required one `deno task test` retry, which passed cleanly.

## Future Planning Notes

Checkpoint messages and spinner state remain projections only — Plan Lifecycle writes still go through `recordPlanEvent`
and busy ownership stays with `SessionRuntime`'s reference-counted workflow busy operation; future progress/status work
should keep that boundary and reuse `emitSystemStatus` rather than adding new UI event paths. Reused-worktree and
non-Git paths must keep distinct, truthful wording (never `creating worktree`). Manual TUI spot-checks of the Approve &
Run spinner resume and reused-worktree wording remain worth doing interactively since they were not exercised live here.
