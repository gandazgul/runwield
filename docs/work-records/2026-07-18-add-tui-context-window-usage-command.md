---
kind: "work_record"
recordId: "f0d19353-2a32-4cab-bafa-38e65847d001"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-18T14:34:02.405Z"
provenance:
    sourcePlans:
        - "e438dbf6-4278-4d74-b7f5-a8c071cc4e00"
---

# Add TUI context-window usage command

## Summary

Implemented and verified the TUI-only `/context` command. It reports active Agent Session context-window usage,
estimated resident categories, loaded instruction files, and advertised Skills while preserving Runtime boundaries and
distinguishing estimated, provider-reported, and post-compaction unknown usage.
