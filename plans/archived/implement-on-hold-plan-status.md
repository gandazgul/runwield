---
planId: "2a5bea91-b8e6-4c4c-9319-c53787daded3"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement the 'on_hold' Plan Status as described in the PRD. This involves updating the plan store to handle hold metadata, modifying the `load-plan` command to include hold/resume/reset options and the Resume Check logic, and updating the `wld plans` command to display held plans in a separate section."
affectedPaths:
    - "src/cmd/load-plan/index.js"
    - "src/cmd/plans/index.js"
    - "src/plan-store.js"
createdAt: "2026-06-24T22:36:26-04:00"
updatedAt: "2026-06-25T15:31:16.061Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-25T15:31:16.061Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "on-hold plan status implementation"
---

# Implement On-Hold Plan Status

## Context

The PRD in `docs/prd/on-hold-plan-status.md` defines `on_hold` as a first-class Plan Status for intentionally deferring
non-verified Plans while preserving enough context to resume safely later. The codebase already has partial scaffolding
in `src/plan-store.js`, `src/shared/workflow/plan-lifecycle.js`, and `docs/plan-lifecycle.md`, but `load-plan` does not
yet expose hold/resume/reset flows and `wld plans` does not group held Plans as requested.

## Objective

Add user-facing support for putting Plans on hold, resuming held Plans through a Resume Check, resetting held Plans to
draft, blocking child FEATURE work while a parent Epic is on hold, and rendering held Plans in `wld plans` without
making that command interactive.

## Approach

Keep lifecycle metadata canonical by using the existing `recordPlanEvent` events (`plan_held`, `hold_resumed`,
`hold_reset_to_draft`) instead of direct status edits. Add small helpers in `load-plan` for hold prompts, Resume Check,
and reset-to-draft handling, then thread those helpers into each existing status menu. Reuse current worktree recovery
helpers and affected-path commit checks where possible. Update `wld plans` presentation by partitioning active vs held
top-level Plans while keeping individually held child FEATUREs inline under active Epics.

## Files to Modify

- `src/cmd/load-plan/index.js` — add hold/resume/reset menus, Resume Check, parent-Epic hold blocking for child
  FEATUREs, and hold entries in existing status menus.
- `src/cmd/load-plan/index.test.js` — cover hold, resume, reset, Epic/child semantics, and menu-first behavior.
- `src/cmd/plans/index.js` — group held top-level Plans/Epics in a bottom `On Hold:` section and include held-child
  progress/counts.
- `src/cmd/plans/index.test.js` — cover active Epics with held children, held Epics with children, standalone held
  Plans, and held metadata rendering.
- `src/plan-store.js` — verify existing hold front-matter normalization/progress helpers and adjust only if needed for
  held-child counts or missing metadata preservation.
- `src/plan-store.test.js` — add/adjust tests if store helpers need changes.
- `src/shared/workflow/plan-lifecycle.js` — verify event constraints match the PRD; adjust only for gaps discovered
  during implementation.
- `src/shared/workflow/plan-lifecycle.test.js` — add/adjust tests if lifecycle constraints or reset-clearing fields
  change.
- `src/shared/worktree.js` — add a non-mutating merge-risk inspection helper if needed so Resume Check can report
  mergeability/risk without invoking the mutating merge path.
- `src/shared/worktree.test.js` — cover any new merge-risk helper behavior.

## Reuse Opportunities

- `recordPlanEvent` / `buildPlanEventUpdates` in `src/shared/workflow/plan-lifecycle.js` — existing hold events and
  metadata clearing.
- `resolveRecoveryWorktree`, `hasWorktreeContext`, `confirmWorktreeAction`, and `confirmRecoveryWorktreeAvailable` in
  `src/cmd/load-plan/index.js` — worktree lookup and safety confirmation patterns.
- `listCommitsTouchingPathsSince` in `src/shared/workflow/git-snapshot.js` — affected-path staleness detection for
  Resume Check.
- `getWorktreeStatus` in `src/shared/worktree.js` — worktree existence and branch status inspection.
- Existing dirty-path/diff logic inside `mergeExecutionWorktree` in `src/shared/worktree.js` — extract/reuse as a
  read-only merge-risk check rather than duplicating git parsing in `load-plan`.
- `groupPlanHierarchy` / `countChildPlanProgress` in `src/plan-store.js` — hierarchy grouping for `wld plans`; extend
  presentation rather than duplicating store traversal.

## Implementation Steps

- [ ] Step 1: Add shared `load-plan` helpers for hold metadata and menus.
  - Implement an `isHoldableStatus(status)` helper that returns true for all non-`verified`,
    non-`closed_without_verification`, non-`on_hold` statuses.
  - Implement `getHoldStalenessBaseline(attrs)` using the last substantive pre-hold timestamp: prefer `updatedAt`, then
    `implementedAt`, `failedAt`, `createdAt` as available; do not use `heldAt`.
  - Implement `putPlanOnHold({ plan, uiAPI, recordPlanEvent, findPlansByParent })` that prompts for optional reason with
    `uiAPI.promptText`, confirms Epic/child warnings from the PRD, records `plan_held`, updates in-memory attrs, and
    reports the plan remains resumable via `wld load-plan <name>`.
  - Keep prompt labels exactly aligned with the PRD: `Put on hold`, `Resume from hold`, `Reset status to draft`,
    `Keep on hold`, `View plan details`.

- [ ] Step 2: Add Resume Check and held-plan handling to `load-plan`.
  - Add
    `runResumeCheck({ plan, uiAPI, listCommitsTouchingPathsSince, findWorktreeById, findWorktreeByPlanName, getWorktreeStatus })`
    returning pass/warn/fail plus human-readable messages.
  - Check worktree existence when worktree metadata is present; check recorded branch vs current branch when applicable;
    report missing/mismatched worktree as fail or warning based on whether recovery is possible.
  - For worktree-backed Plans with a recorded branch, inspect merge risk against the primary checkout without mutating
    either checkout; report overlapping dirty primary changes or likely merge conflicts as warnings/failures.
  - Check commits touching `affectedPaths` since `holdStalenessBaseline || updatedAt || createdAt`; warnings should
    offer `Proceed with resume` or `Keep on hold`.
  - Add `handleOnHoldPlan(...)` with menu: `Resume from hold`, `View plan details`, `Reset status to draft`,
    `Cancel / Keep on hold`.
  - On pass or accepted warnings, record `hold_resumed` with `heldFromStatus`, clear hold metadata, update `plan.attrs`,
    then continue normal `load-plan` handling for the restored status.
  - On fail, keep `status: on_hold`, show recovery options including `Reset status to draft`.

- [ ] Step 3: Add reset-to-draft support for held Plans.
  - Implement
    `resetHeldPlanToDraft({ plan, uiAPI, recordPlanEvent, findWorktreeById, findWorktreeByPlanName, updateWorktreeRegistryEntry, removeExecutionWorktree })`.
  - If a worktree exists, confirm before deleting it and offer a non-destructive option that resets metadata while
    keeping the worktree for manual rescue.
  - Record `hold_reset_to_draft`; ensure hold fields and execution/recovery fields are cleared while plan body and
    stable identity/context fields remain.
  - If deleting a worktree, remove the checkout and mark/remove registry entry using existing worktree helpers;
    otherwise leave filesystem/registry state untouched but clear Plan metadata.

- [ ] Step 4: Make `load-plan` consistently menu-first and wire hold actions into status flows.
  - For `draft` / `feedback`, show `Resume planning`, `Put on hold`, `View plan details`, `Cancel` before starting the
    planning agent.
  - For `approved` / `ready_for_work`, add `Put on hold` and `Cancel` to the existing execution/review menu.
  - For `in_progress` / `failed` / `implemented`, add `Put on hold` to the recovery menu without losing current
    inspect/continue/reset/validate options.
  - For PROJECT Epics (`draft`, `approved`, `ready_for_decomposition`, `ready_for_work`, done-enough `verified`), keep
    existing Epic options but add `Put Epic on hold` only when holdable.
  - Preserve existing `verified` behavior: already verified Plans cannot be put on hold.

- [ ] Step 5: Enforce Epic and child FEATURE semantics.
  - Run the parent-Epic hold gate before handling the child Plan’s own `on_hold` state; if a child’s parent Epic is
    held, show the blocking message and offer loading/resuming the parent Epic or canceling.
  - Holding an Epic mutates only the Epic and warns that child FEATURE Plans will be hidden/blocked while the Epic is
    held.
  - Loading a child FEATURE whose parent Epic is `on_hold` must show a message and force the user to resume the parent
    first; do not allow an override to work on the child.
  - Resuming an Epic should show child status summary after Resume Check succeeds, but mutate only the Epic.
  - Holding a child FEATURE should warn that only that child is being held; parent and siblings remain active.
  - If both parent Epic and child FEATURE are on hold, resuming the Epic must not resume the child.

- [ ] Step 6: Update `wld plans` grouping and progress display.
  - Partition top-level held Epics and standalone held Plans into a final `On Hold:` section.
  - Keep held child FEATUREs under active Epics inline and display `status: on_hold` / held metadata there.
  - For held Epics, render the Epic under `On Hold:` with its child FEATURE tree underneath; child statuses do not
    change.
  - Include `Held from:` and optional `Reason:` for held Plans.
  - Update child progress strings to count `on_hold` separately, matching the PRD style
    (`1/3 verified — 1 on hold — 1 remaining`).

- [ ] Step 7: Add focused tests.
  - `load-plan`: normal draft/feedback menu-first behavior, putting FEATURE on hold, putting Epic on hold with warning,
    child FEATURE hold warning, on-hold resume pass, resume warning keep/proceed, resume fail remains held,
    reset-to-draft with and without worktree deletion, parent-held child blocking.
  - `wld plans`: active Epic with held child inline, held Epic in bottom section with children, standalone held Plan in
    bottom section, held metadata printing, progress includes held count.
  - `shared/worktree`: read-only merge-risk helper returns clean/no-risk, overlapping dirty-path warning, missing branch
    failure, or conflict/risk text without changing repository state.
  - Lifecycle/store tests only where implementation changes those modules.

## Verification Plan

- Automated: `deno run ci`
- Targeted during development:
  `deno test src/cmd/load-plan/index.test.js src/cmd/plans/index.test.js src/shared/workflow/plan-lifecycle.test.js src/plan-store.test.js`
- Manual: create sample saved Plans covering `draft`, `ready_for_work`, `implemented` with worktree metadata, an Epic
  with child FEATUREs, and a held child; run `wld plans` and `wld load-plan <name>` through hold/resume/reset flows.
- Expected results: held Plans are not auto-resumed, Resume Check runs before restoration, failed Resume Check keeps
  `status: on_hold`, reset preserves plan body but clears hold/execution metadata, and `wld plans` remains read-only
  with held top-level Plans grouped at the bottom.

## Edge Cases & Considerations

- Existing lifecycle/store code already includes `on_hold` support; avoid duplicating state-machine logic in command
  code.
- `closed_without_verification` is terminal/protected like `verified` for hold purposes even though the PRD only names
  `verified`; current lifecycle rejects both.
- Resume Check should be conservative: warn when history checks fail or affected-path changes are found, fail when
  required worktree metadata points to an unavailable/mismatched recoverable state.
- Use JavaScript plus JSDoc only; do not introduce TypeScript syntax.
- Do not make `wld plans` interactive.
