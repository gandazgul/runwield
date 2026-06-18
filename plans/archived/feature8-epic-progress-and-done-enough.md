---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add an Epic progress summary and a human-confirmed way to mark an Epic done enough without implementing every child FEATURE."
affectedPaths:
    - "src/cmd/load-plan/index.js"
    - "src/cmd/plans/index.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/cmd/plans/index.test.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-06-18T04:03:13.829Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-18T04:03:13.829Z"
---

# Epic Progress and Done Enough

## Context

The PROJECT decomposition flow lets a user ship one or more child FEATUREs as an MVP and defer the rest. Without an
explicit affordance, an Epic with unverified child FEATUREs looks permanently unfinished even when the user's current
objective has been met.

For v1, the user chose the lifecycle representation: marking an Epic "done enough for now" should set the Epic status to
`verified` and also write explicit done-enough metadata. Remaining child FEATURE plans must stay visible and loadable.
Do not introduce the future general `on_hold` status or a new `completed` status in this slice.

## Objective

Show useful Epic progress in `load-plan` and `hns plans`, then let the user explicitly confirm that an Epic is done
enough for now even when not every child FEATURE is verified.

## Approach

Add a narrow Epic lifecycle event, `epic_done_enough`, that is only available for Epic containers after decomposition
(`ready_for_work`) and moves the Epic to `verified`. The event should set `verifiedAt` plus explicit Epic metadata such
as `epicCompletionMode: "done_enough"`, `epicDoneEnoughAt`, and `epicDoneEnoughSummary`.

In `load-plan`, compute child FEATURE progress from `findPlansByParent`, display the summary whenever an Epic loads, and
add a confirmed action to mark the Epic done enough. A verified/done-enough Epic should still offer Slicer revision,
view details, and child FEATURE selection when children exist, so users can re-enter the work later.

In `hns plans`, keep the existing hierarchy output but make Epic progress and the done-enough state obvious.

## Files to Modify

- `src/plan-store.js` — add JSDoc/front-matter round-trip support for the Epic completion metadata fields.
- `src/shared/workflow/plan-lifecycle.js` — add `epic_done_enough` event, allowed transitions, status mapping to
  `verified`, and metadata updates.
- `src/cmd/load-plan/index.js` — add Epic progress formatting, done-enough option, confirmation prompt, lifecycle event
  recording, and verified-Epic child selection.
- `src/cmd/plans/index.js` — include done-enough metadata in Epic listing and keep child progress visible.
- `src/plan-store.test.js` — cover front-matter round-trip/clearing for the new Epic metadata.
- `src/shared/workflow/plan-lifecycle.test.js` — cover `epic_done_enough` status and metadata updates plus invalid
  transitions.
- `src/cmd/load-plan/index.test.js` — cover progress summary, confirm/cancel, verified re-entry, and no-children
  behavior.
- `src/cmd/plans/index.test.js` — cover listing of a done-enough Epic with remaining unverified children.

## Reuse Opportunities

- `src/plan-store.js` — reuse existing unknown/known front-matter serialization patterns and `updatePlanFrontMatter`.
- `src/shared/workflow/plan-lifecycle.js` — reuse event-driven updates instead of mutating status directly in commands.
- `src/cmd/load-plan/index.js` — reuse `findPlansByParent`, `buildPlanSummary`, and existing `promptSelect` loops.
- `src/cmd/plans/index.js` — extend the existing Epic hierarchy and `formatChildProgress` rather than adding a new UI.

## Implementation Steps

- [ ] Add Epic completion metadata fields in `src/plan-store.js`:
  - `epicCompletionMode` (`"done_enough"` for this slice; nullable for clearing)
  - `epicDoneEnoughAt` (ISO timestamp, nullable)
  - `epicDoneEnoughSummary` (human-readable generated summary, nullable)
- [ ] Add `epic_done_enough` to `PlanEvent`, `ALLOWED_FROM`, and `EVENT_STATUS` in
      `src/shared/workflow/plan-lifecycle.js`:
  - allow from `ready_for_work` and `verified`
  - set status to `verified`
  - set `verifiedAt`, `epicCompletionMode`, `epicDoneEnoughAt`, and `epicDoneEnoughSummary`
  - clear failure fields consistently with successful lifecycle transitions
- [ ] In `src/cmd/load-plan/index.js`, add helpers to count child FEATURE statuses and format an Epic progress summary:
  - total child FEATURES
  - verified count
  - active/in-progress or implemented count
  - draft/approved/ready-for-work remaining count
  - failed count when present
- [ ] Update `handleEpicPlan` to always display the progress summary for Epics with children and to show a clear
      done-enough banner when `epicCompletionMode === "done_enough"`.
- [ ] Update Epic actions in `handleEpicPlan`:
  - keep "Open or resume Slicer decomposition"
  - offer "Pick a child FEATURE plan" for Epics with children, including already `verified` done-enough Epics
  - offer "Mark Epic done enough for now" for non-verified `ready_for_work` Epics with at least one child
  - keep "View Epic details" and "Cancel"
- [ ] Implement the done-enough confirmation flow:
  - show the current progress and explain that unverified child FEATUREs remain visible/loadable
  - require explicit confirm/cancel via `promptSelect`
  - on confirm, call `recordPlanEvent({ event: "epic_done_enough", currentStatus: plan.attrs.status, ... })`
  - update local `plan.attrs` from the returned attrs and display the resulting done-enough message
- [ ] Update `src/cmd/plans/index.js` so Epic output shows both progress and done-enough state, e.g.
      `Progress: 1/3 features verified — done enough for now`.
- [ ] Add/extend tests for plan-store metadata, lifecycle event semantics, `load-plan` confirm/cancel/re-entry flows,
      and `hns plans` output.

## Verification Plan

- Automated:
  `deno test src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js src/cmd/load-plan/index.test.js src/cmd/plans/index.test.js`
- Automated: `deno run ci`
- Manual: create or use an Epic with one verified child FEATURE and one draft/approved child FEATURE; run
  `hns load-plan <epic>`, confirm "Mark Epic done enough for now", then run `hns plans`.
- Expected: the Epic status is `verified`, done-enough metadata is present in front matter, remaining child FEATUREs are
  still listed, and loading the Epic again still allows picking a child FEATURE or reopening Slicer work.

## Edge Cases & Considerations

- Do not implement `on_hold` in this slice.
- Do not add a new `completed` status; use existing `verified` plus explicit Epic metadata.
- Do not hide, delete, or auto-complete unverified child FEATUREs when an Epic is marked done enough.
- Avoid offering done-enough confirmation for Epics with no child FEATUREs.
- Verified/done-enough Epics must remain re-enterable: the user can still pick a child FEATURE or run Slicer later.
- Keep all executable code in JavaScript with JSDoc; no TypeScript files or syntax.
