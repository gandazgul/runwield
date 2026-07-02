---
planId: "88a9aa5c-489a-46fe-bbbf-c1e9f650f02c"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Replace the \"Move to X\" buttons in the Plan Board with a drag-and-drop UX. This involves implementing drag-and-drop logic between columns, adding visual feedback (grabbing state, \"not allowed\" icons for invalid transitions), and ensuring the underlying lifecycle action engine is still used for the actual status updates."
affectedPaths:
    - "src/ui/workspace/components/Board.jsx"
    - "src/ui/workspace/components/BoardColumn.jsx"
    - "src/ui/workspace/components/PlanCard.jsx"
    - "src/ui/workspace/islands/PlanLifecycleActions.jsx"
createdAt: "2026-06-29T21:39:56-04:00"
status: "verified"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "board-actions-and-status-screens"
implementedAt: "2026-06-30T02:15:16.009Z"
verifiedAt: "2026-06-30T02:23:28.326Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "drag and drop plan board"
updatedAt: "2026-07-02T15:19:15.153Z"
archivedAt: "2026-07-02T15:19:15.153Z"
archiveReason: "Parent epic verified"
archivedFromStatus: "verified"
archivedFromPath: "plans/local-first-plan-management-ui/drag-and-drop-board-actions.md"
---

# Drag-and-Drop Board Actions

## Context

The verified `board-actions-and-status-screens` slice intentionally shipped lifecycle-safe action buttons and DnD-ready
metadata first. The current active board now renders every allowed status move as a visible `Move to X` button on each
card, which makes Plan Cards look like control panels instead of draggable board cards. The user now wants the board to
behave like a direct manipulation Kanban surface: grab a card, move it to another status column, and drop only when the
Plan Lifecycle engine allows that transition.

Product behavior is sourced from the user's request and the existing local-first Plan UI PRD:

- The user's request explicitly replaces `Move to X` board-card buttons with drag-and-drop between columns.
- The request calls for good card UX: cards should read as cards, show grab/moving affordances, and show a blocked/not
  allowed cue for invalid transitions.
- `docs/prd/local-first-plan-management-ui-PRD.md` says board drag-and-drop may apply immediately, but must record Plan
  Lifecycle/manual status actions rather than mutating YAML directly.
- Existing lifecycle metadata in `serializePlanSummary().actions.allowedManualTargetStatuses` is the client-visible
  engine-owned source of truth for allowed status drops; the server API still performs final validation.

Current implementation facts to preserve:

- `src/ui/workspace/server/plan-adapter.js` already exposes per-Plan lifecycle action metadata, including
  `manualTargetOptions`, `allowedManualTargetStatuses`, and `actions.dnd.allowedTargetStatuses`.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` already exports `createMoveStatusIntent()` and
  `dispatchPlanLifecycleAction()` so drag/drop and buttons can submit the same `move_status` intent shape.
- `BoardColumn.jsx` and card components already render stable `data-status`, `data-action-target-status`, and
  `data-plan-id` attributes, but the cards do not yet render allowed-target data for client-side drop affordances.
- `.card-hit-area` currently makes the whole card clickable by overlaying a link; the drag implementation must preserve
  read-first click navigation while allowing drag gestures to start reliably.

## Objective

Build a polished board drag-and-drop interaction for status movement:

- Remove the noisy board-card `Move to X` status button list from the board view.
- Make movable Plan/Epic cards visually draggable with grab/grabbing cursors, a drag handle/affordance, lifted-card
  styling, and a clear drag ghost/preview.
- Allow dropping only onto columns listed by the dragged card's lifecycle metadata.
- Show clear allowed and blocked column feedback while dragging, including a blocked/not-allowed icon or equivalent cue
  when hovering an invalid lifecycle target.
- On a valid drop, dispatch the existing `move_status` lifecycle action API and reload/refresh through the current
  lifecycle-safe path.
- Keep non-drag lifecycle actions available on detail pages; do not make board cards a dense button surface.

## Approach

Add a small client island that enhances the server-rendered board DOM rather than reimplementing the whole board as a
client-rendered Kanban. The island should use event delegation from the board root, read `data-plan-id`, `data-status`,
and allowed-target data from each card, and call `dispatchPlanLifecycleAction(createMoveStatusIntent(...))` for valid
drops. Invalid target columns should never call the API; they should set `dropEffect = "none"`, avoid preventing the
browser's default rejection behavior, and apply blocked CSS classes so users get an immediate "no" affordance.

Do not duplicate lifecycle rules in the browser. The client only uses server-provided allowed-target metadata for
preview/drop affordances; the server remains authoritative and may still reject a drop if the Plan changed since render.
When that happens, show the API error in an ARIA live status region and leave the board unchanged until the user
reloads.

Product assumption checkpoint: on board cards, this feature removes the visible per-target `Move to X` button list.
Status movement on the board is drag/drop-first. Detail pages keep explicit lifecycle controls for accessibility and for
non-column actions such as Put on hold, Close without verification, Resume, and Reset to draft. If later card-level
shortcuts are needed, add a compact overflow/menu rather than restoring the full button list.

## Files to Modify

- `src/ui/workspace/components/Board.jsx` — add the board drag/drop island and board-level data attributes/status live
  region hook without changing server-side screen loading.
- `src/ui/workspace/components/BoardColumn.jsx` — mark droppable columns with stable labels/status data used by the DnD
  island and CSS feedback states.
- `src/ui/workspace/components/PlanCard.jsx` — render draggable-card data (`draggable`, allowed target statuses, current
  status, card title), add a visible drag affordance, and stop rendering compact status-move buttons on board cards.
- `src/ui/workspace/components/EpicCard.jsx` — apply the same draggable-card data and drag affordance for Epic cards,
  including `ready_for_decomposition` eligibility from lifecycle metadata.
- `src/ui/workspace/islands/PlanBoardDragDrop.jsx` — new Preact island for drag state, event delegation, allowed/blocked
  target feedback, lifecycle dispatch, pending/error messages, and page refresh after success.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — add a prop or helper to suppress manual target buttons in board
  card contexts while preserving detail-page controls and exported dispatch helpers.
- `src/ui/workspace/server/plan-adapter.js` — update Workspace metadata capability `dragDrop` to `true` and adjust DnD
  metadata only if card rendering needs a clearer serialized allowed-target field.
- `src/ui/workspace/static/styles.css` — style card surfaces, drag handles, grabbed/lifted states, ghost/placeholder
  cues, allowed/blocked drop columns, not-allowed icon, and responsive behavior.
- `src/ui/workspace/workspace.test.js` — cover rendered DnD attributes/metadata, hidden board move buttons, intent
  creation/dispatch reuse, and API rejection paths for stale or invalid drops.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — reuse `createMoveStatusIntent()` and
  `dispatchPlanLifecycleAction()` so drops and existing buttons share the same lifecycle API path.
- `src/ui/workspace/server/plan-adapter.js` — reuse `actions.allowedManualTargetStatuses`, `actions.dnd`, `STATUS_META`,
  and lifecycle API responses instead of inventing drag-specific endpoints or rules.
- `src/shared/workflow/plan-lifecycle.js` — keep using `getPlanLifecycleActionMetadata()` and server-side lifecycle
  validation as the source of truth for legal manual board moves.
- `src/ui/workspace/components/PlanCard.jsx` / `EpicCard.jsx` — build on the existing read-first clickable card markup,
  status badges, and lifecycle metadata props rather than creating separate drag-card components.
- `src/ui/workspace/static/styles.css` — extend current card/column classes and existing DnD-ready selectors such as
  `.board-column[data-action-target-status]`.

## Implementation Steps

- [ ] Step 1: Separate board-card status moves from detail lifecycle controls.
  - Add a `showStatusMoves`/`surface` style prop to `PlanLifecycleActions` so board cards can suppress
    `manualTargetOptions` buttons without affecting detail pages.
  - On board `PlanCard` and `EpicCard`, stop rendering the full compact lifecycle action list for status moves. Prefer
    no board lifecycle button cluster for this slice; keep hold/close/resume/reset on detail pages.
  - Ensure tests or SSR assertions prove `Move to Feedback`/`Move to Approved` no longer appear in board-card markup.

- [ ] Step 2: Render drag-ready card and column metadata.
  - Add `data-draggable-plan-card="true"`, `draggable="true"`, `data-plan-id`, `data-plan-name`, `data-status`, and a
    compact serialized allowed-target field such as `data-allowed-target-statuses="feedback approved ..."` to top-level
    board cards.
  - Keep `data-action-target-status` on every status column and add an accessible label/title for drop feedback.
  - Do not make orphan-repair cards draggable unless their lifecycle metadata can safely move them and the repair lane
    has status columns; repair-lane drag/drop can remain out of scope.
  - Preserve card click navigation: a click still opens detail, while drag gestures suppress accidental link activation
    only for the active drag.

- [ ] Step 3: Add `PlanBoardDragDrop` island.
  - Mount the island from `Board.jsx` only for board screens that have status columns.
  - Use delegated `dragstart`, `dragover`, `dragenter`, `dragleave`, `drop`, and `dragend` handling from the board root.
  - Track the active dragged card `{ planId, fromStatus, allowedTargetStatuses }` in component state/ref.
  - On drag start, add board/card classes such as `.is-dragging-plan` and `.is-drag-source`, set
    `dataTransfer.effectAllowed = "move"`, and set a useful text payload for browser compatibility.
  - Use `setDragImage()` with the card or a lightweight clone when practical so the preview looks like the card being
    moved.

- [ ] Step 4: Implement allowed/blocked drop affordances.
  - On `dragover` for a column, compare the column's `data-action-target-status` to the dragged card's allowed target
    set.
  - For allowed targets: call `event.preventDefault()`, set `dataTransfer.dropEffect = "move"`, and apply
    `.drop-allowed`/`.drop-target-active` styles.
  - For blocked targets: do not enable the drop; set `dropEffect = "none"` where possible and apply `.drop-blocked` so
    CSS can show a not-allowed icon/overlay.
  - Treat the source column as not droppable; moving to the same status should do nothing and show a neutral or blocked
    affordance.
  - Clear all drag classes on `dragleave`, `drop`, cancellation, and `dragend`.

- [ ] Step 5: Submit valid drops through the lifecycle action dispatcher.
  - On `drop`, ignore invalid targets and same-status drops without calling the API.
  - For valid targets, call `dispatchPlanLifecycleAction(createMoveStatusIntent({ planId, fromStatus, toStatus }))`.
  - Show a pending message such as `Moving <plan> to <column>…` in a board-level ARIA live region.
  - On success, show the response message briefly and reload the current page, matching existing lifecycle action
    behavior.
  - On `409`/non-OK, show `blockedReason`/`error` from the API and do not locally move the card.

- [ ] Step 6: Polish card and board visuals.
  - Make cards look more like tangible cards: stronger hover elevation, clear border/shadow, and a visible drag grip or
    "grab" affordance in the card header.
  - Use `cursor: grab` on draggable cards and `cursor: grabbing` while dragging.
  - While dragging, dim the source card, lift/rotate the drag preview subtly, and highlight allowed columns.
  - For blocked columns, use a red/amber border or overlay plus a not-allowed symbol (`⊘`/icon-like pseudo-element) and
    explanatory text for screen readers via the live region.
  - Ensure mobile/touch does not regress: native HTML drag/drop may be desktop-first, so touch users should still be
    able to open detail pages and use detail lifecycle controls.

- [ ] Step 7: Update Workspace capability metadata.
  - Change `workspaceMetadata().capabilities.dragDrop` from `false` to `true` once the board has real drag/drop.
  - Keep `lifecycleActions: true` and `mutations: true`; do not add a drag-specific mutation capability unless a client
    needs it.

- [ ] Step 8: Add tests.
  - SSR/component tests: active board cards expose drag metadata and allowed-target statuses; columns expose drop target
    statuses; board cards no longer render per-target `Move to X` buttons.
  - Metadata tests: `serializePlanSummary()` continues to omit `verified`, `failed`, and `on_hold` from manual drop
    targets for normal FEATURE Plans while allowing engine-approved manual statuses.
  - Intent tests: drag/drop helper code reuses `createMoveStatusIntent()` and produces the same request shape as the old
    buttons.
  - API behavior tests: valid manual drop target updates through lifecycle events; invalid/stale drop targets return
    `409` and a user-facing blocked reason.
  - If practical in Deno DOM tests, unit-test the island's pure allowed-target decision helper separately from browser
    drag events.

## Verification Plan

- Automated:
  - `deno task ci`
  - `deno task workspace:test`
- Manual:
  - Run `wld plans ui --no-open`, open the tokenized Workspace URL, and confirm active board cards look like cards
    rather than rows of status buttons.
  - Drag a `draft` FEATURE card over allowed manual columns such as `Feedback`, `Approved`, `Ready for Work`,
    `In Progress`, and `Implemented`; verify allowed columns highlight and dropping records the lifecycle move.
  - Drag the same card over blocked columns such as `Failed`, `Verified`/closed screen targets if visible, `On Hold`, or
    its current source column; verify the cursor/column shows not-allowed feedback and no API call/mutation happens.
  - Drag an Epic card and verify Epic-only allowed targets such as `Ready for Decomposition` are honored when
    applicable.
  - Click a card without dragging and verify read-first detail navigation still works.
  - Use a detail page to perform non-drag actions such as Put on hold, Close without verification, Resume, and Reset;
    verify those controls still work after board-card cleanup.
  - Simulate a stale board by changing a Plan status in another process/tab before dropping; verify the API rejection is
    surfaced and the board is not locally falsified.
- Expected results for key scenarios:
  - Board status movement feels like direct card movement, not button-click workflow.
  - The browser only enables drops that lifecycle metadata says are legal, and the server remains authoritative.
  - Invalid lifecycle transitions never mutate Plan front matter and communicate clearly why the target is unavailable.

## Edge Cases & Considerations

- Native HTML drag/drop is desktop-oriented. This slice should make desktop pointer UX good and preserve mobile/touch
  fallback through detail-page lifecycle controls; full touch-reorder support can be a later enhancement.
- The clickable full-card link may conflict with drag start. The implementation must explicitly test click-vs-drag so a
  small pointer move does not accidentally navigate and a click does not start a move.
- `verified`, `failed`, `closed_without_verification`, and `on_hold` remain protected by lifecycle semantics. Do not
  special-case these only in CSS; derive blocked/allowed behavior from action metadata and server validation.
- Orphan repair cards are visible for repair and may not belong to normal status columns. Do not enable confusing drag
  behavior there unless it has a clear lifecycle destination.
- If `setDragImage()` behaves inconsistently across browsers, prefer reliable source-card/column feedback over a fragile
  custom ghost.
- Keep source in JavaScript/JSDoc/JSX only; do not add `.ts`/`.tsx` files or TypeScript syntax.
