---
kind: "work_record"
recordId: "e93582b8-44d4-432c-a104-f91a0e52b8ad"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-02T23:16:00.668Z"
provenance:
    sourcePlans:
        - "08ebe9a4-346e-445a-81b8-136443d56f53"
---

# Task completion recorded as consume-once session state

## Summary

Implemented pending task-completion records on HostedSession so accepted `task_completed` calls are recorded with
ownership metadata and consumed exactly once by the root workflow handler. This replaces turn-window message scanning,
fixes steered execution completions that previously stranded workflows, preserves isolated-session completion handling,
updates QUICK_FIX steering coverage, and passed objective checks OC1–OC4 plus the targeted test suites,
`deno task seams:check`, and final `deno task ci`.

## Deviations from Plan

One full CI attempt hit a transient golden PROJECT timeout; the filtered scenario passed on rerun and a subsequent full
`deno task ci` passed.

## Future Planning Notes

Treat workflow completion as explicit session state rather than inferred transcript position. Consume-once records with
ownership scoping avoid both missed steered completions and stale follow-up replays while keeping isolated agent
sessions from advancing the root workflow.

## Execution Report

- Implemented HostedSession pending task-completion records: accepted `task_completed` calls now record
  agent/report/timestamp/owning session and consume exactly once; active workflow set/clear paths clear stale
  completions.
- Updated `createAgentHandler` to consume the root-session-owned completion record instead of scanning the root turn
  message window; removed the obsolete task-completion reader seam and tightened `scripts/injection-seam-baseline.json`.
- Preserved isolated-session behavior: `readLatestTaskCompletedReport`/message-stream readers remain for isolated
  callers, and root workflow advancement ignores completions owned by isolated steering targets.
- Added/updated tests for accepted-vs-rejected recording, consume-once follow-up turns, steered QUICK_FIX completion
  through `SessionRuntime.steerSession`, isolated completion isolation, and stale-completion clearing; test-count delta:
  +5 tests, 0 removed.
- Updated QUICK_FIX golden role journey to include queued steering coverage and declared
  `recovery:steered-task-completion` in the coverage matrix.
- Verification passed: objective checks OC1–OC4, `deno task test src/shared/session src/shared/workflow src/tools`,
  `deno task test src/ui/tui/golden-scenarios/role-journeys.test.js`, `deno task seams:check`, and final `deno task ci`
  all pass. One full CI attempt hit a transient golden PROJECT timeout; the failing filtered scenario passed on rerun,
  and a subsequent full `deno task ci` passed.
