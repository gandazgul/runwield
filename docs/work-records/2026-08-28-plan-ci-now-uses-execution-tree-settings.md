---
kind: "work_record"
recordId: "e1581360-ea46-40c3-a9c8-8d9ad70b437f"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-28T19:58:18.685Z"
provenance:
    sourcePlans:
        - "d95497fb-0ec8-41ae-98e5-57f3fa7c0d51"
---

# Plan CI now uses execution-tree settings

## Summary

RunWield Plan Mechanical Validation now reads `verification_command` from the execution worktree before each local CI
run, while normal linked-worktree settings still resolve to the primary checkout. CI repair handoffs now direct repair
agents to inspect and fix the execution checkout `.wld/settings.json` and complete only after the configured command
passes. Regression, golden, full test, and CI suites passed.

## Future Planning Notes

Keep execution-tree settings behavior narrow to Plan CI. Do not weaken the ordinary primary-checkout settings policy for
linked worktrees.
