---
kind: "work_record"
recordId: "a89e245a-9b70-45f9-98c6-2bf3d97954b0"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-20T03:14:12.545Z"
provenance:
    sourcePlans:
        - "b8850b02-7ef6-4d15-a7f7-dfe876ecd519"
---

# Restore Validation Repair Follow-ups

## Summary

Fixed paused Validation Repair Engineer follow-ups when valid Project-stored transcripts retain a worktree cwd.
Transcript reopening now preserves storage validation, identity, locking, and generation guards. Repair thinking now
falls back from repair-specific settings to Engineer settings, then defaults, while preserving explicit overrides and
`off`. Added four regression tests and updated the Core PRD and settings documentation. Focused tests and the full
`deno task ci` passed with 368 files and no failures.

## Future Planning Notes

Keep transcript storage authority separate from the Agent working directory when Project storage and execution worktrees
differ. Resolve repair model and thinking independently through repair-specific settings, Engineer settings, then
defaults.
