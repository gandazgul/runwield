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
