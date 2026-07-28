---
kind: "work_record"
recordId: "e83e44ae-9c33-4721-8441-44ec8fef55ae"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-27T22:18:53.924Z"
provenance:
    sourcePlans:
        - "895523d4-f4ae-45de-9f9e-b508ad0f7889"
---

# Planned Change and Work Kind taxonomy shipped

## Summary

RunWield now separates planned workflow ceremony from work nature by using PLANNED_CHANGE with explicit Work Kind
metadata across routing, Plan handling, workflow dispatch, Slicer materialization, Engineer handoffs, Work Records,
TUI/Workspace labels, prompts, and current docs. Legacy FEATURE routing/classification and feature-scope Work Records
remain readable through planned-change normalization, while Work Kind FEATURE stays distinct. Verification passed with
`deno task ci`, including type checks, Workspace check, lint, and 1878 tests.

## Future Planning Notes

For future taxonomy changes, prefer compatibility-first normalization and new-artifact serialization over bulk rewriting
historical Plans or Work Records; ensure prompts, UI labels, schemas, and tests move together so agents and users see
the same domain language.

## Execution Report

- Implemented PLANNED_CHANGE taxonomy and Work Kind support across routing constants, triage normalization, workflow
  dispatch/context, Plan front matter/store/lifecycle/execution, Slicer child materialization, Engineer handoffs, Work
  Records, TUI/Workspace labels, Router/agent prompts, and current docs/glossary.
- Preserved legacy compatibility: routingIntent/classification FEATURE and Work Record scope feature normalize to
  planned-change semantics while Work Kind FEATURE remains distinct.
- Updated focused tests and compatibility expectations for triage, orchestrator, Plan Store/lifecycle/execution,
  Slicer/workflow, Work Records, TUI/session context, review transport, and router-eval scoring.
- Manual checks: simulated new planned bug-fix Plan front matter (`classification: PLANNED_CHANGE`,
  `workKind: BUG_FIX`), legacy `classification: FEATURE` parsing to `PLANNED_CHANGE`, and legacy Work Record
  `scope: feature` parsing to `planned_change`.
- Verification passed: `deno task ci` (includes submodule check, type check, Workspace check, lint, and full test suite:
  1878 passed).
