---
kind: work_record
recordId: d88664f8-6e73-4989-a834-e71093cc731f
status: approved
scope: feature
origin: external
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    evidence:
        - path: src/plan-store.js
          note: Defines the canonical status, classification, and alphabetical ordering returned by core plan lists.
        - path: src/cmd/load-plan/index.js
          note: Builds the interactive load-plan menu directly from the core-ordered list.
        - path: src/cmd/load-plan/getArgumentCompletions.js
          note: Exposes load-plan completions without applying a separate UI-specific sort.
---

# Canonical Plan List Ordering

## Summary

Core plan listing now returns a deterministic UI-ready order: failed and implemented work first, followed by ready,
planning, terminal, and on-hold statuses; PROJECT plans precede FEATURE plans within each status, followed by
alphabetical plan name. The load-plan menu, command completions, and Workspace summaries preserve this shared order,
preventing UI-specific sorting rules from drifting apart.
