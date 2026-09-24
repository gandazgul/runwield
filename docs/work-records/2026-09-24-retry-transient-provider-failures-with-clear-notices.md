---
kind: "work_record"
recordId: "942e23d4-63cc-4125-9c28-0e075c3cf5bf"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-24T20:25:20.579Z"
provenance:
    sourcePlans:
        - "01d970e6-db23-4636-887d-b29193831935"
---

# Retry transient provider failures with clear notices

## Summary

Validated recovery now routes unexpected provider EOF through Pi’s existing retry policy, preserving the default three
retries with 2/4/8-second waits. Shared live and saved Session notices describe failures safely without hiding raw
diagnostics; cancellation, partial output, tool execution, and replay remain intact. The Core PRD, settings guide, and
regression tests were updated.
