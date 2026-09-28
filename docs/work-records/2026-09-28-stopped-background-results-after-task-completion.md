---
kind: "work_record"
recordId: "3307f365-4b4b-4dee-ba39-49fb7d3f7f06"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-28T23:02:58.893Z"
provenance:
    sourcePlans:
        - "e81c84ba-087d-40ec-8c4a-e9ce6c311993"
---

# Stopped background results after task completion

## Summary

Verified the task-completion cleanup: an eligible call warns once about running Background Tasks; a retry cancels and
settles them before acceptance. Accepted completion suppresses pending and queued results and blocks stale generated
turns, while later work can still receive fresh results. Core requirements and Session guidance now describe this
boundary.

## Future Planning Notes

Suppress results at both the queue and model-dispatch boundaries; clearing pending task results alone does not stop
already queued or in-flight delivery.
