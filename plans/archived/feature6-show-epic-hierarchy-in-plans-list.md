---
planId: "affd463b-c841-4409-97e6-9842875936ca"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Update hns plans so Epics and their child FEATURE plans are shown as a hierarchy with concise progress."
affectedPaths:
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/index.test.js"
    - "src/plan-store.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-07-17T04:43:39.596Z"
status: "verified"
origin: "internal"
workRecord:
    status: "generated"
    recordId: "34e65816-be73-4b59-ba79-9e446b328dd7"
    path: "docs/work-records/2026-07-17-show-epic-hierarchy-in-plans-list.md"
    lastAttemptAt: "2026-07-17T04:43:28.930Z"
worktreeStatus: "abandoned"
---

# Show Epic Hierarchy in Plans List

## Context

This is an `AFK` slice. The visual output is constrained by the PRD and can be tested through command output snapshots
or focused string assertions.

Once Epics have child FEATURE plans, `hns plans` needs to show that relationship. Users should be able to see which
large PROJECTs exist, what child slices they contain, and how much has been verified without opening every plan.

## Objective

Group Epics and child FEATURE plans in `hns plans` while preserving visibility for standalone plans.

## Approach

Use recursive plan discovery and `parentPlan` metadata to build an in-memory hierarchy. Print Epics first with child
progress, then print standalone plans. Keep output concise and terminal-friendly.

## Files to Modify

- `src/cmd/plans/index.js` - group plans into Epics, child FEATURE plans, and standalone plans.
- `src/cmd/plans/index.test.js` - add tests for hierarchy output and standalone output.
- `src/plan-store.js` - reuse or expose helper functions needed to identify parent-child relationships.

## Reuse Opportunities

- `src/cmd/plans/index.js` - reuse existing status, classification, summary, and worktree display logic.
- `src/plan-store.js` - reuse recursive `listPlans` and `findPlansByParent`.
- Existing worktree status display can remain attached to each child FEATURE where present.

## Implementation Steps

- [x] Identify Epic plans by `classification: "PROJECT"` and `type: "epic"`.
- [x] Group child FEATURE plans by `parentPlan`.
- [x] Show Epic rows with status and child progress such as `2/5 features verified`.
- [x] Render child rows with status, summary, and worktree state where useful.
- [x] Render standalone plans separately.
- [x] Add tests for empty lists, one Epic with children, orphan child FEATUREs, and standalone FEATURE plans.

## Verification Plan

- Automated: `deno test src/cmd/plans/index.test.js` — passed on 2026-06-17.
- Automated: `deno run ci`
- Manual: create one Epic with child FEATURE plans plus one standalone plan and run `hns plans`.
- Expected result: the hierarchy is clear, and standalone plans are not hidden.

## Edge Cases & Considerations

- Orphan child plans with missing parents should still be visible, probably under standalone or an "orphaned" group.
- Do not implement a full board UI in this slice.
- Keep output useful in narrow terminals.
