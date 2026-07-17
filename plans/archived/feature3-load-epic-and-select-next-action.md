---
planId: "45d43146-1061-4e05-b040-c79080120cae"
classification: "FEATURE"
complexity: "HIGH"
summary: "Make load-plan recognize Epics and offer decomposition or child FEATURE selection instead of direct execution."
affectedPaths:
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/plan-store.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-07-17T04:43:17.648Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-16T20:16:51.416Z"
verifiedAt: "2026-06-16T20:21:16.807Z"
workRecord:
    status: "generated"
    recordId: "d92fbb74-e227-4d87-812a-1b13d82b7869"
    path: "docs/work-records/2026-07-17-epic-aware-load-plan-action-selection.md"
    lastAttemptAt: "2026-07-17T04:43:11.977Z"
worktreeStatus: "merged"
---

# Load an Epic and Select the Next Action

## Context

This is an `AFK` slice. The interaction choices are specified by the PRD and can be implemented as ordinary TUI prompts.

When a user runs `hns load-plan` on an Epic, Harns should not treat the Epic like a FEATURE waiting for execution.
Instead, the user needs an Epic-specific menu: revise decomposition with Slicer, inspect existing child FEATURE plans,
or choose a child FEATURE to load normally.

## Objective

Make `load-plan` Epic-aware so users can resume decomposition or select executable child FEATURE work from the Epic.

## Approach

Add an early Epic branch in `runLoadPlanCommand` after plan resolution and recovery handling. Use parent-child discovery
from the plan store to show child FEATURE options. When a child is selected, delegate back into the existing FEATURE
load/execution behavior rather than duplicating execution code.

## Files to Modify

- `src/cmd/load-plan/index.js` - add Epic detection, Epic action prompts, child FEATURE selection, and delegation.
- `src/cmd/load-plan/index.test.js` - cover Epic action menus and child FEATURE delegation.
- `src/plan-store.js` - reuse or lightly extend child lookup helpers if feature 1 did not already expose the exact shape
  needed.

## Reuse Opportunities

- `src/cmd/load-plan/index.js` - reuse existing plan summary, prompt selection, review reopening, and execution paths.
- `src/plan-store.js` - reuse `findPlansByParent` and nested plan resolution.
- `src/shared/workflow/workflow-slicer.js` - later slices will provide the interactive Slicer target; this slice can use
  a dependency-injected stub in tests.

## Implementation Steps

- [ ] Add an Epic-specific branch after `resolvePlan` identifies `classification: "PROJECT"` and `type: "epic"`.
- [ ] For `draft` or `approved` Epics, offer to open or resume Slicer decomposition.
- [ ] For decomposed Epics, offer to open Slicer or pick a child FEATURE.
- [ ] Show child FEATURE labels with status and short summary.
- [ ] When a child FEATURE is selected, load it through the normal FEATURE behavior.
- [ ] Add tests for no children, some children, canceled selection, and child FEATURE selection.

## Verification Plan

- Automated: `deno test src/cmd/load-plan/index.test.js`
- Automated: `deno run ci`
- Manual: create an Epic with two child FEATURE plans and run `hns load-plan <epic>`.
- Expected result: the user sees Epic actions and can route into a child FEATURE without executing the Epic itself.

## Edge Cases & Considerations

- If an Epic has no children, the only useful action is Slicer decomposition or viewing details.
- If selected child dependencies are unmet, feature 7 should handle warnings; this slice should not duplicate that
  logic.
- Preserve existing recovery behavior for in-progress executable FEATURE plans.
