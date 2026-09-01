---
kind: "work_record"
recordId: "c867c635-9988-4610-8524-ef548b0fcb49"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-01T19:22:16.042Z"
provenance:
    sourcePlans:
        - "c8d3b0b6-413d-468f-9444-950f6853eea2"
---

# Load Plan Menus Made Faster

## Summary

`/load-plan` now shows the first action menu without durable Session hydration, duplicate cleanup discovery,
repository-wide Doctor repair, or unscoped transition reconciliation. Plan continuation still renames the Session once
when work actually resumes. Verification passed targeted tests, seams check, type check, lint, format check, and full CI
with 370 test files passing.

## Deferred Work

The post-cancel agent restore can still publish a Session generation. This was pre-existing behavior outside this Plan's
scope.

## Future Planning Notes

For menu latency work, prefer tests that prove costly work is absent before the prompt instead of wall-clock thresholds.
Capture Session evidence at the menu boundary so later restore behavior does not hide hot-path regressions.
