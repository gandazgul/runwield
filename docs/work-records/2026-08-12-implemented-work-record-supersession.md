---
kind: "work_record"
recordId: "b6f4b4a5-629d-4bdc-88a9-52205b29b192"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-12T17:34:34.656Z"
provenance:
    sourcePlans:
        - "29ebfa42-f20b-4287-812e-220b3681f381"
---

# Implemented Work Record supersession

## Summary

RunWield now supports user-authorized Work Record supersession from approved Plan declarations and Recorder-proposed
corrections. The change added persisted pending proposals, confirmed supersession across all completion modes, atomic
canonical updates with locking and rollback evidence, index synchronization, TUI and headless resolution flows, backfill
handling, and the `wld wr supersede` command. Planner and Recorder contracts, command help, domain language, and PRD
documentation were updated. RunWield Workflow Validation passed, including objective supersession proof, focused tests,
seams check, type/check/formatting, and full CI with 280 test files.

## Future Planning Notes

Canonical Markdown remains the authority for supersession state; Mnemoteca index updates are best-effort projections
with rebuild guidance on failure. Recorder-proposed supersession must stay pending until explicit user confirmation,
including for backfill and headless flows.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
