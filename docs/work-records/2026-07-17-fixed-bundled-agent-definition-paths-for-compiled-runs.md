---
kind: "work_record"
recordId: "2ddc6dd2-7cf5-4946-9a96-992ba06c4607"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:45:50.231Z"
provenance:
    sourcePlans:
        - "444b5669-d2a7-41bd-a985-bcd1146bd730"
---

# Fixed bundled agent-definition paths for compiled runs

## Summary

Extracted bundled agent-definition assets to a runtime-readable cache and updated prompt assembly to resolve format
references to absolute paths. Planner, Architect, and Slicer flows now access their format files outside the source tree
without ENOENT failures, while preserving source-mode fallback behavior.
