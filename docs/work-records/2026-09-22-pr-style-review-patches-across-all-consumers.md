---
kind: "work_record"
recordId: "a36d95ab-5c2d-4623-9c55-6b436f266b45"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-22T17:26:48.815Z"
provenance:
    sourcePlans:
        - "4c50a988-e730-4699-a0c6-df199f54addf"
---

# PR-style review patches across all consumers

## Summary

Replaced direct target-tip review diffs with one common-ancestor-to-current-files patch shared by Reviewer tools, repair
and resume flows, standalone Code Review, and Workspace reload. The patch includes committed and uncommitted execution
work while excluding target-only changes. Invalid ancestry now fails closed, transient Git read fallbacks remain
available, and tests, checks, documentation updates, and headed browser verification confirmed the behavior.

## Future Planning Notes

Keep full review patches anchored to the target/execution common ancestor. Treat missing ancestry as an invalid
comparison, but preserve saved-patch fallback for transient checkout read failures.
