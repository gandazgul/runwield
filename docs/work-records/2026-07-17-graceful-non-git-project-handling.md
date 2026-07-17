---
kind: "work_record"
recordId: "839a6cf8-b614-4c9d-bbac-00dd1054ff2f"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:47:27.336Z"
provenance:
    sourcePlans:
        - "a0ef3214-49ec-4d7a-8a0d-6df62774c23d"
---

# Graceful Non-Git Project Handling

## Summary

Added explicit, project-scoped consent for running FEATURE Plans and QUICK_FIX work directly in non-Git project roots.
Git-backed projects retain normal Worktree isolation, validation, merge, and recovery behavior. Non-Git Plan validation
runs available CI while clearly skipping Git-dependent semantic and human diff review, and recovery paths now provide
friendly Git-required guidance instead of raw command failures.

## Future Planning Notes

Non-Git validation remains intentionally weaker than Git-backed validation because it cannot provide Worktree isolation,
baseline restoration, commit-history checks, merge-back, or diff-based review.
