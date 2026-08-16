---
kind: "work_record"
recordId: "ad084bfc-ad05-4c6d-9a2b-97b85c48f7b8"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-16T15:06:11.340Z"
provenance:
    sourcePlans:
        - "e7be100d-d6b0-4df0-bb7f-e20cfb9efc97"
---

# Archived Plan Retention and Prune

## Summary

Implemented project-scoped archived Plan retention settings, prune selection, and the `wld plans prune` command.
Archived units are now eligible for deletion only when covered by a Work Record and past retention, with a keep-last
floor and Epic child grouping. Archive actions now print a prune nudge, and docs and tests cover the new policy and
command.

## Deviations from Plan

Safe manual checks used `--dry-run` and a canceled prompt run; destructive `plans prune --yes` was not run in this
repository. Full `deno task ci` still had unrelated golden TUI scenario failures, while the targeted objective checks
and related tests passed.

## Future Planning Notes

Archived Plan pruning can remove a large first backlog because old archived Plans were retained before this policy
existed. Future work that changes archive behavior should keep deletion manual, project-scoped, and covered by Work
Record provenance.
