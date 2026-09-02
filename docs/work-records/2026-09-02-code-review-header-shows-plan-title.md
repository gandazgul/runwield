---
kind: "work_record"
recordId: "dee1a319-065d-4a51-b87e-8e6bc99e44dd"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-02T01:29:41.500Z"
provenance:
    sourcePlans:
        - "584d0b85-8b6a-47b3-850f-9dd30d275679"
---

# Code Review Header Shows Plan Title

## Summary

Code Review now shows the producing Plan title in the header for both standalone and Workspace review paths. The title
is derived from the first non-empty level-one Plan heading, falls back safely, travels through the TUI and Workspace
payloads, and remains accessible while long titles ellipsize without hiding review actions. Verification passed with
targeted tests, project checks, seams check, full test suite, and headed browser checks.

## Deviations from Plan

Browser checks used this worktree's dev server on port 5175 because port 5173 was already in use by another checkout.

## Future Planning Notes

For future review-surface identity fields, project the smallest stable display value from workflow code and transport it
through existing launch payloads instead of making browser UI parse Plan markdown.
