---
classification: "PROJECT"
complexity: "HIGH"
summary: "Reframe PROJECT work as non-executable Epics that are decomposed by an interactive Slicer into independently executable FEATURE plans."
affectedPaths:
    - "src/plan-store.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/workflow/slicer-prompt.md"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/plans/index.js"
    - "src/tools/plan-written.js"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "CONTEXT.md"
    - "docs/plan-lifecycle.md"
    - "docs/prd/done/project-decomposition-PRD.md"
createdAt: "2026-06-16T16:25:04Z"
status: "verfied"
---

# PROJECT Decomposition into Executable FEATURE Plans

## Context

Harns currently treats a `PROJECT` plan as a large executable unit. The Architect writes a design, the Slicer silently
adds a task table, and the system attempts to execute the resulting task graph as one workflow. That model makes large
work harder to steer: the user cannot easily pick an MVP slice, defer later work, or revise the decomposition before
execution starts.

The product direction in `docs/prd/done/project-decomposition-PRD.md` reframes `PROJECT` as an Epic container. The
Architect still creates the broad design, but the Slicer becomes an interactive PM/lead-engineer agent that helps the
user split the Epic into independently executable `FEATURE` plans.

This plan set uses two slice labels:

- `AFK`: "away from keyboard." An agent should be able to implement the slice unattended once it starts.
- `HITL`: "human in the loop." The slice contains an intentional product decision or interactive review point and should
  not pretend the agent can decide the outcome alone.

## Objective

Build the new PROJECT decomposition workflow in thin vertical slices:

1. Preserve Epic and child FEATURE metadata.
2. Represent new PROJECT plans as non-executable Epics.
3. Make `load-plan` Epic-aware.
4. Materialize child FEATURE plans from a decomposition draft.
5. Replace the silent Slicer with an interactive decomposition session.
6. Show Epic hierarchy in `hns plans`.
7. Warn when child FEATURE dependencies are unmet.
8. Add an Epic progress and "done enough for now" affordance.
9. Remove the old task-DAG path from new PROJECT execution.
10. Reconcile docs and lifecycle language.

## Approach

Implement the foundation first, then the interactive flow:

- First make the plan store capable of representing Epics and nested child FEATURE plans.
- Then make workflow and `load-plan` treat Epics as containers rather than executable work.
- Then add the child-plan creation path the Slicer will call.
- Then update the Slicer conversation model and the user-facing plan list.
- Finally retire the old PROJECT task-DAG path from active use and update the domain docs.

Avoid implementing the full future `on_hold` status in this Epic. Deferred work can be represented in v1 by omitted
child plans, draft child plans, or explicit notes in the Epic summary.

## Files to Modify

- `src/plan-store.js` - preserve Epic and child FEATURE front matter, support nested plan discovery, and add parent
  lookup helpers.
- `src/shared/workflow/plan-lifecycle.js` - add only the lifecycle events required for Epics and avoid making Epics
  executable through the normal `ready_for_work` path.
- `src/shared/workflow/workflow.js` - route new PROJECT/Epic work away from direct execution and old task dispatch.
- `src/shared/workflow/workflow-slicer.js` - evolve the old one-shot Slicer into an interactive decomposition flow.
- `src/shared/workflow/slicer-prompt.md` - rewrite the Slicer role around PM-style decomposition.
- `src/cmd/load-plan/index.js` - add Epic-specific actions and child FEATURE selection.
- `src/cmd/plans/index.js` - show Epic hierarchy and child progress.
- `src/tools/plan-written.js` - ensure approved PROJECT/Epic plans enter the new readiness/decomposition path.
- `CONTEXT.md` - update the domain glossary to reflect Epic containers and child FEATURE plans.
- `docs/plan-lifecycle.md` - document Epic lifecycle behavior without confusing it with executable plan status.
- `docs/prd/done/project-decomposition-PRD.md` - reconcile v1 scope after implementation decisions are known.

## Reuse Opportunities

- `src/plan-store.js` - reuse existing front matter parsing and update functions rather than creating a parallel store.
- `src/shared/workflow/plan-lifecycle.js` - reuse `recordPlanEvent` as the durable status-change boundary.
- `src/shared/session/session.js` - reuse existing session persistence for Slicer pause/resume behavior.
- `src/cmd/load-plan/index.js` - reuse existing recovery and plan-selection prompts where the workflow remains a normal
  FEATURE plan.
- `src/cmd/plans/index.js` - reuse current list output shape and add hierarchy rather than introducing a new board UI.

## Implementation Steps

- [ ] Complete `plans/project-breakdown-epic/feature1-preserve-epic-and-child-plan-metadata.md`.
- [ ] Complete `plans/project-breakdown-epic/feature2-represent-project-plans-as-epics.md`.
- [ ] Complete `plans/project-breakdown-epic/feature3-load-epic-and-select-next-action.md`.
- [ ] Complete `plans/project-breakdown-epic/feature4-create-child-feature-plans-from-draft.md`.
- [ ] Complete `plans/project-breakdown-epic/feature5-interactive-slicer-mvp.md`.
- [ ] Complete `plans/project-breakdown-epic/feature6-show-epic-hierarchy-in-plans-list.md`.
- [ ] Complete `plans/project-breakdown-epic/feature7-warn-on-unmet-child-feature-dependencies.md`.
- [ ] Complete `plans/project-breakdown-epic/feature8-epic-progress-and-done-enough.md`.
- [ ] Complete `plans/project-breakdown-epic/feature9-retire-old-project-dag-from-new-flow.md`.
- [ ] Complete `plans/project-breakdown-epic/feature10-reconcile-docs-and-lifecycle-language.md`.

## Verification Plan

- Automated: run `deno run ci` after code changes are implemented.
- Automated: add focused tests alongside each modified module before or during each FEATURE slice.
- Manual: create a sample PROJECT request, approve the Epic, decompose it, inspect generated child FEATURE plans, load a
  child FEATURE, and verify that the Epic itself is never executed directly.
- Expected result: users can ship one child FEATURE from a large PROJECT without executing every planned slice.

## Edge Cases & Considerations

- Legacy PROJECT task-table plans may still exist. The new Epic path should not break import or test coverage for old
  code kept as future dead code.
- `ready_for_work` currently means executable. Epic usage must avoid accidentally sending an Epic to Engineer execution.
- The PRD mentions `on_hold`, but v1 should not depend on a new general deferred status.
- Parent-child pointers should stay loose enough that an Epic can discover children by scanning front matter, but stable
  enough that nested child names do not collide across Epics.
