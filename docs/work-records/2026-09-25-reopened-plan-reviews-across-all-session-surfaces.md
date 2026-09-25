---
kind: "work_record"
recordId: "c306922c-8c08-42d2-851e-ee9b408b2778"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-25T20:34:50.680Z"
provenance:
    sourcePlans:
        - "4576bb13-1e2d-4af1-a32c-2ef682973314"
---

# Reopened Plan Reviews across all Session surfaces

## Summary

Delivered `/plan-review` for Terminal, Workspace, and ACP. It reuses a live review or opens the latest saved Plan Review
in the current Session after interruption, without a model turn. Ordinary Plans, PROJECT Epics, and Sequences keep their
existing decision rules. Updated requirements, command documentation, and ADR 015; added automated and TUI golden
coverage. Focused tests and headed browser checks passed, and the Plan is marked validated.

## Deferred Work

Investigate the review page’s optional `/api/skills` request, which returned 404 during browser checks; review decisions
still worked.
