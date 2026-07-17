---
kind: "work_record"
recordId: "e2729721-fe76-4b8f-8016-bf2c0a6661f8"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:40:52.144Z"
provenance:
    sourcePlans:
        - "b473615c-82bd-4b48-a2b5-4df052bc75fc"
---

# Add skill slash commands

## Summary

Added autocomplete and dispatch support for `/skill:{name} [instructions]`. Skill commands expand `SKILL.md` content
into a `<skill>` XML user message, support optional instructions, and handle unknown or unreadable skills without
disrupting the interactive session. The implementation passed verification.
