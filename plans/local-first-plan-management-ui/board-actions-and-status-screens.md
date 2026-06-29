---
planId: "a091b302-e5f9-4560-9f84-b9aa95d420c8"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add lifecycle-mediated board actions, closed/on-hold screens, token-protected mutation APIs, and a DnD-ready board architecture where buttons and future drag gestures use the same action path."
affectedPaths:
    - "src/ui/workspace/"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "docs/plan-lifecycle.md"
createdAt: "2026-06-24T20:14:08.683Z"
updatedAt: "2026-06-29T14:31:04.822Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "lifecycle-board-semantics"
    - "secure-workspace-read-only-board"
    - "correct-workspace-design-foundation"
---

# Board Actions and Status Screens

## Context

The Workspace now has the prerequisites this slice should build on: durable `planId` identity, lifecycle-owned manual
board semantics, token-gated Fresh/Preact Workspace routes, status-column active/closed/on-hold screens, Epic cards and
Epic detail, and a body-only editor path. The remaining gap is that the board and detail pages are still mostly
inspection/edit-body surfaces: users cannot yet perform Plan Lifecycle actions from the browser.

Product behavior is sourced from `docs/prd/local-first-plan-management-ui-PRD.md`, `docs/prd/on-hold-plan-status.md`,
`docs/plan-lifecycle.md`, and the verified prerequisite plans. The key product constraints are: Plan Status changes must
go through the central lifecycle module, `verified` remains Workflow Validation-owned, `closed_without_verification` is
a distinct terminal outcome, `failed` remains recovery-specific, `on_hold` is paused-but-resumable, and the board should
be designed so future drag-and-drop gestures are an input-layer addition over the same lifecycle action path.

The current implementation details to preserve:

- `src/ui/workspace/server.js` already gates HTML/API routes with the Workspace token and registers body-save mutation
  APIs.
- `src/ui/workspace/server/plan-adapter.js` already builds active/closed/on-hold board screens from lifecycle status
  constants and serializes safe Plan DTOs without absolute path leakage.
- `src/shared/workflow/plan-lifecycle.js` already exports lifecycle events/helpers for manual status movement, manual
  closure, hold, resume, and reset-to-draft.
- Workspace source must remain JavaScript/JSDoc/JSX only; do not add TypeScript or a nested
  `src/ui/workspace/deno.json`.

## Objective

Add lifecycle-safe Plan actions to the Workspace:

- Token-protected mutation API for manual status movement, close without verification, put on hold, resume from hold,
  and reset held Plan status to draft.
- UI action controls on board cards and detail screens that call the same action dispatcher.
- Closed and on-hold screens with appropriate action/terminal messaging: closed Plans are terminal/read-only for this
  slice; on-hold Plans expose Resume from hold and Reset status to draft.
- A DnD-ready movement model using explicit movement/action intent objects, stable card/column IDs, and allowed-target
  metadata. Full pointer/touch drag-and-drop gestures are intentionally deferred unless they fall out trivially; buttons
  and future drag gestures must share the same dispatch path.

## Approach

Add a narrow Workspace lifecycle-action boundary rather than letting UI code write front matter. Server action routes
should resolve a Plan by `planId`, derive action metadata from lifecycle helpers/current front matter, call
`recordPlanEvent()`, and return refreshed safe Plan/board DTOs. The API should reuse existing token middleware and
return structured `400`/`401`/`404`/`409` errors for invalid requests, missing Plans, blocked transitions, stale resume
checks, or duplicate `planId` repairs.

Model all user actions as a single `PlanLifecycleActionIntent` shape. Explicit card buttons, detail-page controls,
keyboard/menu actions, and future drag/drop handlers should all create that intent and submit it through one browser
`dispatchPlanLifecycleAction()` function. The first shipped UI can refresh the current SSR page after success for
simplicity, but the action island should be factored so replacing reloads with local board-state updates later does not
change lifecycle semantics.

Treat Resume from hold as a guarded mutation. The Workspace API should run a conservative Resume Check before recording
`hold_resumed`: when worktree metadata is present, verify the worktree path/branch enough to catch obvious stale or
missing state, and surface warnings requiring explicit user confirmation before proceeding. If no substantive risk data
is present, pass with a clear message. Do not silently resume through hard failures.

## Files to Modify

- `src/ui/workspace/server/plan-adapter.js` — add lifecycle action metadata to Plan DTOs, action request handling
  helpers, refreshed board/detail return helpers, and Workspace Resume Check support.
- `src/ui/workspace/routes/api/handlers.js` — add a lifecycle-action API handler with validation, lifecycle error
  mapping, and structured JSON responses.
- `src/ui/workspace/server.js` — register the lifecycle-action route behind the existing token middleware.
- `src/ui/workspace/constants.js` — add shared action names, API path helpers, or token/header constants only if needed
  by both server and browser modules.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` or equivalent — implement the browser action dispatcher, pending
  state, blocked/warning messages, confirmation flow, and reload/refresh behavior after success.
- `src/ui/workspace/components/PlanCard.jsx` — add compact action controls/menu seams while preserving read-first card
  linking and direct edit links.
- `src/ui/workspace/components/EpicCard.jsx` — add Epic-safe action controls and hold confirmation copy without implying
  child status mutation.
- `src/ui/workspace/components/Board.jsx` and `src/ui/workspace/components/BoardColumn.jsx` — pass screen/column action
  metadata, stable IDs, and DnD-ready data attributes to cards/columns.
- `src/ui/workspace/components/PlanDetail.jsx` and `src/ui/workspace/components/EpicDetail.jsx` — add detail-page action
  panels for the same lifecycle actions used on cards.
- `src/ui/workspace/static/styles.css` — style action menus/buttons, warning/confirmation messages, disabled/blocked
  states, DnD-ready drop-target affordance classes, and responsive card controls.
- `src/ui/workspace/workspace.test.js` — cover lifecycle action API behavior, token rejection, action metadata, blocked
  transitions, resume warnings, SSR/action markup, and DnD-ready intent seams.
- `src/shared/workflow/plan-lifecycle.js` — add/adjust pure helper exports only if the Workspace would otherwise
  duplicate lifecycle action eligibility rules.
- `src/shared/workflow/plan-lifecycle.test.js` — add coverage for any new/changed helper exports or lifecycle edge cases
  discovered while wiring the API.
- `docs/plan-lifecycle.md` — document the Workspace-visible manual action path and any final API/UI language that
  clarifies lifecycle semantics.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/plan-lifecycle.js` — reuse `recordPlanEvent`, `buildPlanEventUpdates`,
  `getAllowedManualPlanStatuses`, `isManualBoardStatusChangeAllowed`, hold events, and lifecycle errors; add pure helper
  exports rather than reimplementing rules in UI code.
- `src/plan-store.js` — reuse `findPlanById`, `listPlanResources`, `updatePlanFrontMatter` via `recordPlanEvent`, Plan
  hierarchy helpers, body-safe detail loading, and duplicate `planId` repair behavior.
- `src/ui/workspace/server.js` — reuse the existing token middleware; do not add permissive CORS or a second auth path.
- `src/ui/workspace/server/plan-adapter.js` — reuse `loadBoard`, `loadWorkspaceDetail`, `serializePlanSummary`,
  `serializePlanError`, `STATUS_META`, and current active/closed/on-hold screen DTOs.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — reuse the same pattern of client islands reading the URL token and
  sending `PLAN_UI_TOKEN_HEADER` for state-changing same-origin API calls.
- `src/shared/worktree.js` — reuse exported worktree inspection helpers for Resume Check where existing metadata makes
  that possible; avoid inventing destructive worktree cleanup in this slice.

## Implementation Steps

- [ ] Step 1: Define action DTOs and lifecycle action metadata.
  - Use a single request shape such as
    `{ action: "move_status"|"close_without_verification"|"put_on_hold"|"resume_from_hold"|"reset_to_draft", targetStatus?, holdReason?, acceptResumeWarnings? }`.
  - Return a single response shape such as `{ plan, board, actions, message }` on success and
    `{ error, repair?, blockedReason?, resumeCheck?, requiresConfirmation? }` on blocked/guarded actions.
  - Add serialized per-Plan action metadata: allowed manual target statuses, can close without verification, can put on
    hold, can resume from hold, can reset to draft, and human-readable blocked reasons where helpful.
  - Keep status and action labels in one server-side metadata table so board cards, details, and future DnD previews use
    the same labels.

- [ ] Step 2: Add or refine lifecycle helper exports if needed.
  - Prefer a pure helper such as `getPlanLifecycleActionMetadata(attrs)` or smaller predicates for `canHoldPlan`,
    `canCloseWithoutVerification`, `canResumeHold`, and `canResetHoldToDraft`.
  - Helpers must not perform filesystem writes or know about Workspace routes.
  - Tests should prove helpers keep `verified`, `closed_without_verification`, `failed`, and `on_hold` behind the
    correct dedicated actions.

- [ ] Step 3: Implement the token-protected lifecycle action API.
  - Register `POST /api/plans/:planId/lifecycle-action` (or a similarly explicit route) in `server.js` behind the
    existing Workspace token middleware.
  - Validate JSON body shape and reject unknown actions/unknown target statuses with `400`.
  - Resolve the Plan with `findPlanById(cwd, planId)`; use the resource `planName`, current `attrs.status`, and current
    front matter as lifecycle details.
  - For `move_status`, call `recordPlanEvent()` with `manual_status_change` and `details.manualTargetStatus`.
  - For `close_without_verification`, call `manual_closed_without_verification`.
  - For `put_on_hold`, call `plan_held`, preserve the current status in lifecycle details, and store optional
    `holdReason`; Epic hold messaging must say children will not be mutated.
  - For `resume_from_hold`, run Resume Check first, then call `hold_resumed` with the current `heldFromStatus` only when
    the check passes or the user explicitly accepts warnings.
  - For `reset_to_draft`, call `hold_reset_to_draft`; do not delete worktrees in this slice.
  - Return refreshed `loadWorkspaceDetail()`/`loadBoard()` data after mutation so clients do not need to infer the new
    state.

- [ ] Step 4: Implement conservative Workspace Resume Check.
  - If the Plan is not `on_hold` or lacks `heldFromStatus`, return a blocked lifecycle error before mutation.
  - If no worktree metadata and no `holdStalenessBaseline` are present, pass with a message that there was no recorded
    worktree/staleness state to inspect.
  - If `worktreePath` is present, use `getWorktreeStatus()` to verify the path exists and the recorded branch matches
    when `worktreeBranch` is present.
  - If `worktreeBranch` is present, use `inspectExecutionWorktreeMergeRisk()` where applicable to collect obvious merge
    or dirty-checkout warnings/failures.
  - If a baseline/affected-path staleness check cannot be performed with existing helpers, surface it as a warning that
    requires explicit confirmation rather than silently passing.
  - Return warnings with `409`/`requiresConfirmation: true`; a second request with `acceptResumeWarnings: true` may
    proceed unless hard failures are present.

- [ ] Step 5: Add a browser action dispatcher island.
  - Add `PlanLifecycleActions` or equivalent that accepts a Plan summary/detail DTO and renders context-appropriate
    controls.
  - Read the token from `PLAN_UI_TOKEN_QUERY` and send it as `PLAN_UI_TOKEN_HEADER`, matching the body editor pattern.
  - Convert every button/menu action into a `PlanLifecycleActionIntent` and submit it through one
    `dispatchPlanLifecycleAction()` function.
  - Handle pending/disabled state, lifecycle errors, blocked messages, resume-warning confirmation, and success
    messages.
  - Refresh the current page or navigate to the appropriate board screen after success; do not try to hand-edit YAML or
    locally fake lifecycle metadata.

- [ ] Step 6: Add card and detail actions without breaking read-first behavior.
  - On active board cards/details, show allowed manual status moves, Put on hold, and Close without verification.
  - On on-hold cards/details, show Resume from hold and Reset status to draft, plus hold metadata and reason.
  - On closed cards/details, show terminal explanatory copy and no generic lifecycle mutation controls in this slice.
  - Keep FEATURE Plans from moving directly to `verified`; show a blocked explanation if that target appears in UI copy.
  - Keep `failed` Plans out of generic move controls; they may expose Put on hold, but leaving `failed` remains a
    recovery-specific workflow outside this slice.
  - Ensure clickable card hit areas do not cover or steal focus/clicks from action buttons; use accessible labels and
    keyboard-operable controls.

- [ ] Step 7: Add DnD-ready seams while deferring full drag gestures.
  - Give columns stable `data-status`/`data-action-target-status` and cards stable `data-plan-id`/`data-status` attrs.
  - Build movement preview metadata from the same allowed-target list used by action buttons.
  - Add pure helpers/tests for creating a `move_status` intent from `{ planId, fromStatus, toStatus }` so a future drop
    handler can call the dispatcher directly.
  - Do not add a second drag-specific API route or duplicate lifecycle validation in browser code.
  - Full pointer/touch drag-and-drop, drag ghost styling, auto-scroll, and cross-device gesture polish are follow-up
    work unless they are trivial after the dispatcher is in place.

- [ ] Step 8: Update Workspace metadata and APIs.
  - Update `workspaceMetadata()` capabilities to distinguish `bodyEditing` from lifecycle actions, e.g.
    `lifecycleActions: true`, `dragDrop: false`, and either `mutations: true` or explicit mutation capability flags.
  - Include lifecycle action metadata in `/api/plans`, `/api/board`, and `/api/plans/:planId` where clients need it.
  - Keep responses free of absolute paths and keep all filesystem access scoped to the launched `cwd`.

- [ ] Step 9: Add tests.
  - API tests: missing token rejects; invalid action payload rejects; unknown `planId` returns repair-oriented error;
    allowed `move_status`, close, hold, resume, and reset actions update front matter via lifecycle events.
  - Negative API tests: direct move to `verified`, generic move into/out of `failed`, generic move to/from `on_hold`,
    closing verified/closed Plans, holding closed/verified Plans, and resuming without `heldFromStatus` are blocked.
  - Resume Check tests: missing worktree/branch mismatch yields hard failure or warning as appropriate; warnings require
    `acceptResumeWarnings` before mutation.
  - Adapter/component tests: action metadata appears on board/detail DTOs and SSR markup; closed screen shows terminal
    messaging; on-hold screen shows resume/reset controls.
  - DnD-ready tests: button actions and generated move intents produce the same API request shape.
  - Lifecycle tests: add only if new helper exports or edge cases are introduced.

- [ ] Step 10: Update lifecycle documentation.
  - Add a short Workspace/manual-action section to `docs/plan-lifecycle.md` explaining that browser board controls call
    lifecycle action APIs and never directly write `status`.
  - Document that Workspace Resume from hold runs a guarded Resume Check and may require explicit warning acceptance.
  - Document that full DnD gestures are not required for this slice, but any future gesture must call the same lifecycle
    action path as buttons.

## Verification Plan

- Automated:
  - `deno task ci`
  - `deno task workspace:check`
  - `deno task workspace:test`
- Manual:
  - Run `wld plans ui --no-open`, open the tokenized URL, and confirm active board cards show lifecycle actions without
    losing read-first card/detail navigation.
  - Move a Plan among allowed manual statuses such as `draft`, `feedback`, `approved`, `ready_for_work`, `in_progress`,
    and `implemented`; refresh and verify canonical Plan front matter changed through lifecycle metadata.
  - Try to move a FEATURE Plan to `verified` and try to casually move into/out of `failed`; verify the UI/API blocks the
    action with a clear explanation.
  - Close an implemented or active Plan without verification; verify it moves to the Closed screen as
    `closed_without_verification` and does not gain `verifiedAt`.
  - Put a standalone Plan, child FEATURE, and Epic on hold; verify only the selected Plan file changes, hold metadata is
    recorded, and the Plan appears on the On Hold screen.
  - Resume an on-hold Plan with and without warning conditions; verify warnings require confirmation and successful
    resume restores `heldFromStatus` while clearing hold metadata.
  - Reset an on-hold Plan to draft; verify hold/worktree/recovery metadata is cleared while body and identity/context
    fields remain.
  - Remove the token/header from a lifecycle action request and verify the mutation is rejected.
- Expected results for key scenarios:
  - Board/detail actions, future keyboard actions, and future drag gestures have one shared lifecycle-action path.
  - No Workspace code directly edits Plan Status front matter outside `recordPlanEvent()`/lifecycle-owned helpers.
  - Closed and held Plans remain separated from active work and expose only lifecycle-appropriate actions.

## Edge Cases & Considerations

- Product assumption checkpoint: v1 ships explicit action controls and DnD-ready intent seams, not polished drag/drop
  gestures. This matches the current request's "future drag gestures use the same action path" constraint.
- Product assumption checkpoint: hold reason capture can be a lightweight optional field/control; blank reason is valid.
- Product assumption checkpoint: closed Plans are terminal/read-only in this slice; reopening closed Plans is out of
  scope unless a separate lifecycle/UI decision says otherwise.
- Resume Check should be conservative. If the server cannot prove resume is safe, it should warn or fail rather than
  silently mutate.
- `closed_without_verification` must not set `verifiedAt`, human review metadata, or Epic done-enough metadata.
- `hold_reset_to_draft` must not delete worktrees; if a worktree exists, clearing metadata should be non-destructive and
  visibly explained.
- Holding an Epic affects UI visibility/blocking semantics but must not mutate child FEATURE statuses.
- Failed execution, validation failure, and merge-conflict recovery remain specialized workflow paths.
- Mutation APIs must not enable permissive CORS, expose arbitrary filesystem access, or trust client-provided Plan
  paths.
- Keep source in JavaScript/JSDoc/JSX only; do not add `.ts`/`.tsx` files or TypeScript syntax.
