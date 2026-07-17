---
kind: "work_record"
recordId: "7d1b41b6-5dd6-45f9-9c8b-0687676d02ae"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:48:29.847Z"
provenance:
    sourcePlans:
        - "efca91ed-f3fc-4ee4-ba95-86fd76cee5aa"
---

# Loaded Pi-Compatible External Skills

## Summary

Added ~/.agents/skills as the lowest-priority skill source. External skills now flow through existing discovery into
autocomplete, system prompts, boot banners, and slash-command expansion while preserving local, home, and bundled
collision precedence.

## Deviations from Plan

External skill loading gained a global enableExternalSkills setting, defaulting to enabled, so users can opt out without
changing the planned default behavior.
