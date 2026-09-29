---
kind: "work_record"
recordId: "e24fc4b5-cf6e-488e-a977-b5f90016d8a2"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-29T21:51:38.721Z"
provenance:
    sourcePlans:
        - "8faf46c2-95d7-4e2d-8458-194172ff0e9a"
---

# Opt-in local workflow metrics across execution surfaces

## Summary

Delivered version-2, privacy-filtered local metrics for tool activity, exposure, model usage and cost, context, retries,
latency, delegation, and slash commands across Pi, CLI, TUI, ACP, and Workspace paths. Recording remains off by default
and separate by Project; missing measurements remain explicit. Focused metrics/session/backend tests (78), ACP server
tests (65), and the zero-seam check passed.

## Future Planning Notes

The separate dashboard/export Epic must build on this recording contract and reconcile its default-on proposal with the
owner's confirmed default-off policy. This change did not deliver a dashboard, export, retention controls, or a new
storage service.
