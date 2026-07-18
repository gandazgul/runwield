---
kind: "work_record"
recordId: "91e6de99-184d-498d-bcd8-dc25b0d998b2"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-18T14:33:56.147Z"
provenance:
    sourcePlans:
        - "f5a19074-1b92-4bfe-b99f-0e4ec8c6d7c2"
---

# Added keyboard help TUI block

## Summary

Implemented and verified transient keyboard help in the TUI. Pressing `?` in an empty input toggles a help block above
the editor while preserving literal question marks in non-empty requests. Help dismisses on Escape, ordinary input, or
submission, and `Ctrl+O` remains dedicated to tool-output expansion.
