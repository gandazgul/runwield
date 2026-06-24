---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Extend the central Plan Lifecycle state machine with manual board movement, closed-without-verification, and on-hold semantics so the UI never mutates workflow-critical status directly."
affectedPaths:
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "docs/plan-lifecycle.md"
    - "docs/prd/on-hold-plan-status.md"
createdAt: "2026-06-24T20:14:08.682Z"
updatedAt: "2026-06-24T21:54:57.627Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    []
---

# Lifecycle Board Semantics

## Context

The Local-First Plan Management UI needs board actions for manual lifecycle movement, a terminal manual closure outcome,
and first-class on-hold behavior. These cannot be UI-only fields or direct YAML `status` writes because RunWield treats
`src/shared/workflow/plan-lifecycle.js` as the central Plan Lifecycle state machine, while `src/plan-store.js` parses
and normalizes Plan Status from canonical markdown files.

The PRD explicitly allows user-driven board movement without falsifying Workflow Validation. The user confirmed v1
should allow broad manual board movement among safe statuses, including `ready_for_decomposition` only for Epics, while
keeping `failed`, `verified`, `closed_without_verification`, and `on_hold` behind dedicated lifecycle or recovery
actions.

## Objective

Add lifecycle-owned support for:

- `manual_status_change` board movement among safe non-terminal statuses.
- `closed_without_verification` as a terminal manual Plan Status distinct from Workflow Validation `verified`.
- `on_hold` with `heldFromStatus`, `heldAt`, optional `holdReason`, and `holdStalenessBaseline` metadata.
- Resume/reset events that clear hold metadata correctly and keep recovery/validation states protected.

After this change, future Workspace API/UI code can invoke lifecycle helpers/events instead of mutating
workflow-critical Front Matter directly.

## Approach

Extend the existing Plan Lifecycle event model with explicit events and helper predicates. Keep existing workflow events
intact, add dynamic target handling for `manual_status_change`, and add dedicated events for manual closure and hold
semantics. Update the Plan Store status normalization and Front Matter typing so new statuses persist and reload without
being downgraded to `draft`.

Manual board movement should be a lifecycle-owned operation over an explicit safe set: `draft`, `feedback`, `approved`,
`ready_for_work`, `in_progress`, and `implemented`, plus `ready_for_decomposition` when `isEpicPlan(attrs)` is true. It
may move both directions within that set, but it must not enter or leave `failed`, produce `verified`, enter
`closed_without_verification`, or resume from `on_hold`. Use dedicated events for those cases.

## Files to Modify

- `src/shared/workflow/plan-lifecycle.js` — add statuses, events, dynamic manual target validation, hold metadata
  updates, terminal manual closure, and helper predicates for board-safe actions.
- `src/shared/workflow/plan-lifecycle.test.js` — add transition tests for manual movement, closure, hold/resume/reset,
  blocked verification, blocked failed-state shortcuts, Epic hold, child hold, metadata creation/clearing, and existing
  transition compatibility.
- `src/plan-store.js` — update `PlanFrontMatter` JSDoc, status normalization, known Front Matter ordering, and
  parse/inject handling for `closed_without_verification`, `on_hold`, and hold fields.
- `src/plan-store.test.js` — add parser/persistence tests proving new statuses and hold metadata survive load/update
  cycles and are not normalized back to `draft`.
- `docs/plan-lifecycle.md` — document new statuses/events, board movement constraints, hold fields, and manual closure
  versus Workflow Validation.
- `docs/prd/on-hold-plan-status.md` — update only if implementation details clarify or correct the existing hold
  contract.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/plan-lifecycle.js` — reuse `ALLOWED_FROM`, `EVENT_STATUS`, `buildPlanEventUpdates`,
  `recordPlanEvent`, `isEpicPlan`, and the existing clear-metadata patterns for execution/recovery/review events.
- `src/plan-store.js` — reuse `updatePlanFrontMatter`, `normalizePlanStatus`, `optionalFrontMatterValue`,
  `formatFrontMatter`, `injectFrontMatter`, and parse/load tests rather than introducing a second Plan persistence path.
- `docs/prd/local-first-plan-management-ui-PRD.md` — reuse the manual board movement constraints and closed-screen
  language.
- `docs/prd/on-hold-plan-status.md` — reuse `heldFromStatus`, `heldAt`, `holdReason`, `holdStalenessBaseline`, Resume
  Check, and reset semantics.

## Implementation Steps

- [ ] Step 1: Extend status/event JSDoc unions in `src/shared/workflow/plan-lifecycle.js`.
  - Add Plan Status values: `closed_without_verification`, `on_hold`.
  - Add Plan Event values: `manual_status_change`, `manual_closed_without_verification`, `plan_held`, `hold_resumed`,
    `hold_reset_to_draft`.
  - Add `PlanEventDetails` fields such as `manualTargetStatus`, `holdReason`, `holdStalenessBaseline`, and optional
    `heldFromStatus` if needed for resume.
- [ ] Step 2: Update `src/plan-store.js` before relying on new statuses.
  - Add new status literals to `PlanFrontMatter["status"]` and `normalizePlanStatus`.
  - Add hold fields to `PlanFrontMatter`: `heldFromStatus`, `heldAt`, `holdReason`, `holdStalenessBaseline`.
  - Add hold fields to `KNOWN_FRONT_MATTER_KEYS`, `formatFrontMatter`, `injectFrontMatter`, and `parsePlanFrontMatter`
    so they are ordered, typed, parsed, and clearable with `null`.
- [ ] Step 3: Implement dynamic `manual_status_change` validation.
  - Accept a target status through `details.manualTargetStatus` instead of a fixed `EVENT_STATUS` target.
  - Allow movement both directions only within the safe manual set: `draft`, `feedback`, `approved`, `ready_for_work`,
    `in_progress`, `implemented`, plus `ready_for_decomposition` only for Epic Plans.
  - Block missing/unknown targets with clear errors.
  - Block any move involving `failed`, `verified`, `closed_without_verification`, or `on_hold` through this generic
    event.
  - Clear stale completion/failure fields only when the target status makes them misleading; do not silently discard
    worktree recovery pointers.
- [ ] Step 4: Implement `manual_closed_without_verification`.
  - Allow closure from safe non-terminal/manual statuses where a user may intentionally end work without Workflow
    Validation.
  - Set `status: closed_without_verification` and `updatedAt`.
  - Do not set `verifiedAt`, `humanReviewDecision`, or `epicCompletionMode`.
  - Preserve evidence/worktree fields unless there is an explicit, safe cleanup rule; this status should not pretend
    validation or merge-back happened.
  - Treat `closed_without_verification` as terminal for generic board movement and hold.
- [ ] Step 5: Implement `plan_held`.
  - Allow any non-terminal, non-verified, non-closed status to move to `on_hold`, including `draft`, `feedback`,
    `approved`, `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`, and `implemented`.
  - Set `heldFromStatus` to the current status, `heldAt` to now, optional `holdReason`, and `holdStalenessBaseline` from
    `details.holdStalenessBaseline` when supplied.
  - Preserve execution/worktree recovery metadata; holding pauses work, it does not repair or abandon work.
  - Mutate only the selected Plan. Epic/child visibility and blocking remain UI/listing behavior.
- [ ] Step 6: Implement `hold_resumed` and `hold_reset_to_draft`.
  - `hold_resumed` should only apply from `on_hold`, restore the recorded `heldFromStatus`, and clear hold fields.
    Require the caller to pass or expose the held-from value if `buildPlanEventUpdates` cannot read it from current
    Front Matter.
  - `hold_reset_to_draft` should only apply from `on_hold`, set `status: draft`, clear hold fields, and clear
    execution/recovery/validation fields listed in `docs/prd/on-hold-plan-status.md` while preserving identity/context
    fields.
  - Do not implement Resume Check itself in this slice; document that callers must run it before recording
    `hold_resumed`.
- [ ] Step 7: Add lifecycle helper exports for future API/UI use.
  - Provide a pure helper such as `getAllowedManualPlanStatuses(currentStatus, attrs)` or equivalent.
  - Provide a predicate/validator such as `isManualBoardStatusChangeAllowed(currentStatus, targetStatus, attrs)` or
    equivalent.
  - Ensure helpers return/throw enough information for the Workspace API to surface blocked moves without duplicating
    lifecycle rules.
- [ ] Step 8: Add/extend automated tests.
  - Lifecycle tests for every new event and representative allowed manual moves, including allowed
    `ready_for_decomposition` Epic movement and blocked non-Epic `ready_for_decomposition` movement.
  - Negative lifecycle tests for direct FEATURE `verified`, casual entry/exit of `failed`, manual movement to/from
    `on_hold`, manual movement to `closed_without_verification`, and closure/hold from terminal statuses.
  - Hold tests for metadata creation, resume clearing, reset-to-draft clearing, Epic hold mutating only the Epic, and
    child hold mutating only the child.
  - Plan Store tests for parsing/injecting `closed_without_verification`, `on_hold`, and all hold fields.
  - Regression tests proving existing workflow events still produce the same updates.
- [ ] Step 9: Update documentation.
  - Add `closed_without_verification` and `on_hold` to `docs/plan-lifecycle.md` statuses.
  - Add event table rows for `manual_status_change`, `manual_closed_without_verification`, `plan_held`, `hold_resumed`,
    and `hold_reset_to_draft`.
  - Document that `verified` remains reserved for Workflow Validation except Epic `done_enough`.
  - Document that board movement records Plan Events and never directly edits `status`.
  - Keep `docs/prd/on-hold-plan-status.md` aligned if final field names or reset behavior differ from the PRD text.

## Verification Plan

- Automated: exact command(s) to run
  - `deno task ci`
- Manual: precise user flows / checks
  - In a fixture or REPL-style script, call lifecycle helpers for `draft`, `feedback`, `approved`,
    `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`, `implemented`, `verified`,
    `closed_without_verification`, and `on_hold`.
  - Save and reload Plan markdown containing `status: on_hold` and `status: closed_without_verification`; verify Plan
    Store preserves the status and hold fields.
  - Verify a held Epic update changes only the Epic Plan file, and a held child FEATURE update changes only that child
    Plan file.
- Expected results for key scenarios
  - Manual movement works only within the safe board set, including `ready_for_decomposition` only for Epics.
  - FEATURE Plans cannot be moved directly to `verified`.
  - `closed_without_verification` is terminal and never sets `verifiedAt`.
  - `on_hold` preserves held-from status and recovery metadata until resume/reset.
  - `hold_resumed` clears hold metadata and restores the held-from status only after caller-owned Resume Check.
  - `hold_reset_to_draft` clears stale hold/execution/recovery fields while preserving Plan body and identity/context
    Front Matter.

## Edge Cases & Considerations

- `verified` remains reserved for Workflow Validation except the existing Epic `done_enough` event.
- `closed_without_verification` is a closed outcome, not an archive and not a validation pass.
- `failed`, validation failure, and merge-conflict recovery remain recovery-specific; generic board movement must not
  paper over them.
- `ready_for_decomposition` is safe for manual board movement per user decision only for Epic Plans and only as Plan
  Status movement. It must not fabricate child FEATURE Plans or pretend decomposition was finalized.
- Holding an Epic must not mutate child statuses; loading/blocking children of held Epics is a future UI/listing
  concern.
- Holding a child FEATURE mutates only that child.
- Metadata clearing is as important as metadata creation; stale hold/worktree/human-review fields can mislead later
  workflows.
- `buildPlanEventUpdates` only receives the current status and details, so resume may need `heldFromStatus` supplied by
  the caller from current Front Matter.
- All executable source must remain JavaScript with JSDoc types only; do not add `.ts` files or TypeScript syntax.
