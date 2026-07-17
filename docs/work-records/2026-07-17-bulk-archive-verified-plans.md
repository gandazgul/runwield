---
kind: "work_record"
recordId: "1b9dd2d0-7eb9-4335-a35a-7b36f6ece4d4"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:41:20.973Z"
provenance:
    sourcePlans:
        - "42910b23-b1a5-46f6-9312-0562840f5890"
---

# Bulk archive verified Plans

## Summary

Added `wld plans archive --all --status verified [--reason <text>]` to archive all matching active Plans. The operation
preserves single-Plan archival safeguards, processes Plans best-effort, reports successes and failures, and exits
non-zero on partial failure. Store and CLI tests, help text, README guidance, and the archival ADR were updated.
