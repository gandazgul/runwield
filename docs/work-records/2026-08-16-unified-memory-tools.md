---
kind: "work_record"
recordId: "2d976ac0-ab27-40c0-8715-c3c27bbe6e62"
status: "approved"
scope: "planned_change"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-16T20:09:06.910Z"
provenance:
    sourcePlans:
        - "39b939be-a544-422f-a765-8d65c632814c"
---

# Unified Memory Tools

## Summary

RunWield replaced the separate memory recall, store, and delete tools with `memory_recall` and `memory_write`. Recall
now searches project and global memory with provenance labels, while write handles store and delete with safe defaults,
validation, global init, and core tags. Prompts, agent tool lists, Claude bridging, metrics, TUI titles, docs, and tests
were updated. Workflow Validation passed with targeted suites and `deno task ci`.

## Deviations from Plan

Manual TUI/session checks were not run interactively; the covered behavior was verified through updated automated tests
and runtime title tests.

## Future Planning Notes

When tool names change, keep compatibility for retired transcript names in historical UI and metrics consumers while
removing the old names from current model-facing tool lists.
