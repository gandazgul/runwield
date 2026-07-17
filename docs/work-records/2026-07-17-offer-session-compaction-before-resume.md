---
kind: "work_record"
recordId: "d72f0c3e-8ab5-460b-97b6-05b8d3506f64"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:50:01.896Z"
provenance:
    sourcePlans:
        - "a1d46cfe-1b25-4144-bd33-f71e4316e09d"
---

# Offer Session Compaction Before Resume

## Summary

Updated `/resume` to estimate the selected session’s token usage before loading it. Sessions exceeding the configured
context-window threshold now offer Compact now, Resume as-is, or Cancel. The flow handles estimation, model-context
fallback, configurable thresholds, compaction failures or cancellation, and normal message restoration. Verification
completed successfully.
