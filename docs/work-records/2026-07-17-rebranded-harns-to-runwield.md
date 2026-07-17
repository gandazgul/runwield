---
kind: "work_record"
recordId: "cb5116f2-17d6-4457-acba-f661afe45a49"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:49:38.334Z"
provenance:
    sourcePlans:
        - "0c7f7798-b7d2-4b32-8ff3-b4c9d7623336"
---

# Rebranded Harns to RunWield

## Summary

Completed and verified the cross-cutting RunWield rebrand. The CLI is now `wld`, product-owned state uses `.wld`,
context files use `RUNWEILD.md`, release and installer assets use the new naming, and runtime, documentation, tests,
prompts, worktrees, session markers, and the boot logo were updated. The Router display name remains `Harns` as the sole
intentional legacy exception.

## Deviations from Plan

None recorded.

## Future Planning Notes

The clean break intentionally provides no migration, fallback, alias, or rescue behavior for prior `hns`, `.hns`,
`HARNS.md`, `harns.active_agent`, `HNS_*`, or Harns worktree state.
