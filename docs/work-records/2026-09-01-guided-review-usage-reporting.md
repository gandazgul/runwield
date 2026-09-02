---
kind: "work_record"
recordId: "99d0a618-adb5-461f-b344-1c2980fd08ae"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-01T23:07:44.426Z"
provenance:
    sourcePlans:
        - "4046a097-b84d-42f8-9d3c-9c1841dd89fc"
---

# Guided Review usage reporting

## Summary

Guided Review now forwards provider runtime usage from the hidden `wld guided-review` command to Workspace jobs without
mixing protocol data into review JSON. Workspace aggregates live token and USD cost totals, preserves partial totals on
failure, and the toolbar now shows clear pending, available, and unavailable usage states. Automated command, route,
runtime, workspace, seam, and full CI checks passed.

## Deviations from Plan

The headed browser check used port 5174 because 5173 was already in use.

## Deferred Work

The manual real-provider check was not run; no live LLM call was made.

## Future Planning Notes

Keep usage protocol data off stdout when a subprocess also returns machine-readable content. For runtime usage, event
presence must decide availability so valid zero-token or zero-cost reports are not shown as unavailable.
