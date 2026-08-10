---
kind: "work_record"
recordId: "d78e2b72-b74a-4f99-bb82-35ab1e1aaf5f"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-10T00:08:11.281Z"
provenance:
    sourcePlans:
        - "9c81e9a0-c2f4-47eb-ae13-285d3ae04c42"
---

# Archive Epic With Child Plans

## Summary

Implemented an Archive Epic action for terminal Epics. The action archives the Epic and all child Plans into
docs/plans/archived while it keeps the folder structure. It uses shared archive-status predicates, child-first
transactional moves, a recoverable-worktree pre-flight block, confirmation text with child and unfinished counts, safe
active child-directory cleanup, and restore guidance. Verification passed with targeted archive and load-plan tests plus
full CI.

## Deviations from Plan

CI found a broken relative link in an archived Plan document. The link was fixed as part of the verified change.

## Future Planning Notes

For multi-Plan archive flows, do recoverable-worktree checks before the first move and archive children before the
parent so a failed retry still has an active parent entry point.
