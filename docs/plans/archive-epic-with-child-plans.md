---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Add an Archive Epic action to the Epic menu that archives a terminal Epic together with all of its child Plans and keeps the docs/plans folder structure in docs/plans/archived."
affectedPaths:
    - "src/cmd/load-plan/plan-epic-flow.ts"
    - "src/cmd/load-plan/plan-epic-archive.ts"
    - "src/cmd/load-plan/index.integration.test.ts"
    - "src/plan-store.js"
objectiveChecks:
    - id: "OC1"
      command: "grep -q \"load-plan archives a verified Epic with every child Plan and keeps the folder structure\" src/cmd/load-plan/index.integration.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/index.integration.test.ts --filter \"load-plan archives a verified Epic with every child Plan and keeps the folder structure\""
      rationale: "Proves the end-to-end outcome: a verified Epic and both children move to docs/plans/archived with the nested layout intact and the source directory removed. Red today because the test name does not exist. The grep guard is required because a --filter matching nothing exits 0 (verified empirically), which would give a falsely green baseline."
    - id: "OC2"
      command: "grep -q '\"archive_epic\"' src/cmd/load-plan/plan-epic-flow.ts && grep -q '\"Archive Epic\"' src/cmd/load-plan/plan-epic-flow.ts && grep -q \"archiveEpicWithChildren\" src/cmd/load-plan/plan-epic-flow.ts && grep -q \"runArchiveTransition\" src/cmd/load-plan/plan-epic-archive.ts && grep -q \"isRecoverableWorktreeStatus\" src/cmd/load-plan/plan-epic-archive.ts"
      rationale: "Pins the wiring the behavioral tests cannot distinguish: the menu entry exists with the exact label \"Archive Epic\" (the closing quote in the pattern rejects any longer label), it dispatches to the new module, and that module goes through the archive transaction and the recoverable-worktree pre-flight rather than calling archivePlan bare. Red today because plan-epic-archive.ts does not exist."
    - id: "OC3"
      command: "grep -q \"load-plan refuses to archive an Epic whose child has a recoverable worktree\" src/cmd/load-plan/index.integration.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/index.integration.test.ts --filter \"load-plan refuses to archive an Epic whose child has a recoverable worktree\""
      rationale: "Proves the guard actually blocks before any move, so a child with a live worktree cannot be half-archived. Red today because the test name does not exist. Same grep guard rationale as OC1."
    - id: "OC4"
      command: "grep -q \"export function isTerminalArchivableStatus\" src/plan-store.js && grep -q \"isTerminalArchivableStatus\" src/cmd/load-plan/plan-epic-flow.ts"
      rationale: "Forces the menu gate to reuse the Plan store's single definition of the terminal archivable statuses instead of re-listing them, so archivePlan's guard and the menu can never disagree. Red today because the predicate is not exported."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-09T10:04:14-0400"
updatedAt: "2026-08-09T14:26:40.167Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
humanReviewMode: null
humanReviewDecision: null
worktreeStatus: "abandoned"
routingIntent: "PLANNED_CHANGE"
sessionName: "archive epic option"
planId: "9c81e9a0-c2f4-47eb-ae13-285d3ae04c42"
---

# Archive an Epic With Its Child Plans

## Context

A finished Epic is a dead end in the TUI today. `handleEpicPlan` (`src/cmd/load-plan/plan-epic-flow.ts:62`) builds its
own action menu and always returns `"handled"`, so an Epic never reaches the verified-Plan menu in
`src/cmd/load-plan/index.ts:354-393`. That menu is for single Plans, it archives one file, and this Plan does not change
it or its wording. For an Epic at `verified`, `user_verified`, or `closed_without_verification`, every conditional menu
entry is false:

- `canPickChild` needs a decomposed, approved, or legacy-executable status.
- `canReviewWithArchitect` needs `draft`, `feedback`, or `approved`.
- `canOpenSlicer` needs an approved, decomposition, or ready-for-work status.
- `done_enough` needs `ready_for_work`.
- `isUserVerifiableStatus` and `isHoldableStatus` both exclude the three terminal statuses
  (`src/cmd/load-plan/plan-hold.ts:85-106`).

The user is left with **View Epic details** and **Cancel**. The only way to archive a finished Epic is the CLI
(`wld plans archive --all --status verified`), which archives every matching Epic in the project rather than the one the
user loaded.

## Objective

Give the Epic action menu an **Archive Epic** entry for terminal Epics, and make it move the Epic and every child Plan
into `docs/plans/archived/` while preserving the on-disk hierarchy:

```
docs/plans/my-epic.md          ->  docs/plans/archived/my-epic.md
docs/plans/my-epic/01-plan.md  ->  docs/plans/archived/my-epic/01-plan.md
docs/plans/my-epic/02-plan.md  ->  docs/plans/archived/my-epic/02-plan.md
```

The structure requirement is already satisfied by the Plan store and does not need new path logic.
`getArchivedPlanLocation` (`src/plan-store.js:2661-2670`) builds the destination from the Plan's own canonical name
segments, and `archivePlan` creates the parent directory before the write (`src/plan-store.js:2777`). A Plan named
`my-epic/01-plan` therefore lands at `docs/plans/archived/my-epic/01-plan.md` by construction. The work in this Plan is
the menu action, the multi-Plan sequencing, the safety guards, and a test that proves the resulting layout.

## Approach

Add a small UI-facing module beside the existing `plan-hold.ts` that owns the whole Epic archive interaction, and wire
one new option into the Epic menu.

**Ordering: children first, Epic last.** An Epic that is archived before its children leaves the children active behind
a parent that no longer appears in the Plan catalogue, and they become unreachable from the Epic menu. Archiving
children first means a mid-way failure leaves the Epic active as a retryable entry point.

**Retry converges.** The child list is recomputed from active Plans on every attempt through `findPlansByParent`, so
children that already moved are simply absent from a retry.

**Pre-flight before any move.** `archivePlan` refuses a Plan whose `worktreeStatus` is recoverable, and `force` does not
bypass that guard (`src/plan-store.js:2740-2744`). Check the Epic and every child up front and abort without moving
anything, rather than discovering the block halfway through.

**Children archive with `force: true`.** This matches `archivePlansByStatusTransactionally`
(`src/cmd/plans/archive.ts:157-166`): the Epic's terminal status is what authorizes the archive, and unfinished children
go with it after an explicit confirmation that states how many are unfinished.

**Each move runs inside `runArchiveTransition`** (`src/shared/workflow/state-transition.ts:1634`), giving catalog and
Plan locking, a revision check, and a settled-effect marker, exactly as the CLI does.

Explicit non-goals, to keep the change bounded:

- `src/cmd/plans/archive.ts` keeps its current best-effort, parent-first bulk semantics. Its contract is "archive every
  Plan matching a status, report per-Plan failures", which is genuinely different from "archive this one Epic atomically
  or refuse". Do not refactor the bulk path onto the new helper.
- The single-Plan TUI archive at `src/cmd/load-plan/index.ts:377` still calls `archivePlan` directly without a
  transaction. That inconsistency is noted but out of scope here.

## Files to Modify

- `src/plan-store.js` — export two predicates over the existing private status sets so the menu and the pre-flight share
  one definition with `archivePlan`'s own guards: `isTerminalArchivableStatus` over `TERMINAL_ARCHIVABLE_STATUSES`
  (`:2617`) and `isRecoverableWorktreeStatus` over `RECOVERABLE_WORKTREE_STATUSES` (`:2618`). `archivePlan` must call
  the new predicates instead of testing the sets inline, so there is exactly one definition of each rule.
- `src/cmd/load-plan/plan-epic-archive.ts` — new module owning `archiveEpicWithChildren`: pre-flight, confirmation,
  ordered transactional moves, empty-directory cleanup, and the user-facing messages.
- `src/cmd/load-plan/plan-epic-flow.ts` — add the `archive_epic` option to the Epic menu for terminal Epic statuses and
  dispatch it to `archiveEpicWithChildren`.
- `src/cmd/load-plan/index.integration.test.ts` — add two integration tests against the real Plan store.

No domain-language change is needed. `docs/domain-language.md` has no canonical term for an archived Plan state, and
archiving stays a physical file move that records `archivedFromStatus` rather than a Plan Status transition. This Plan
introduces no new domain term and must not edit the glossary.

## Reuse Opportunities

- `src/plan-store.js` — `archivePlan` (destination layout, front-matter stamping, atomic write, rollback on failed
  removal), `findPlansByParent` (`:3441`), `compareChildPlansByOrder` (`:3052`), `loadPlan` (returns `revision`).
- `src/shared/workflow/state-transition.ts` — `runArchiveTransition` for locking and the revision check.
- `src/cmd/load-plan/transition-failure.ts` — `transitionFailureError` turns a non-committed transition into an error
  that carries the recovery recipes; the load-plan modules already use it (`plan-hold.ts:421-423`).
- `src/cmd/load-plan/plan-epic-children.ts` — `formatEpicProgressSummary` for the child status roll-up shown before the
  confirmation, the same way `putPlanOnHold` does (`plan-hold.ts:153-160`).
- `src/cmd/load-plan/plan-hold.ts` — the shape to copy for the new module: a `{ projectRoot, plan, uiAPI }` options
  object, its own prompting, and a `Promise<boolean>` result the menu uses to decide whether to close or re-prompt.

## Implementation Steps

- [ ] `src/plan-store.js` exports `isTerminalArchivableStatus` and `isRecoverableWorktreeStatus`, and the status and
      worktree guards inside `archivePlan` call those exported predicates rather than testing
      `TERMINAL_ARCHIVABLE_STATUSES` or `RECOVERABLE_WORKTREE_STATUSES` directly.
- [ ] `src/cmd/load-plan/plan-epic-archive.ts` exports
      `archiveEpicWithChildren(options: ArchiveEpicOptions):
      Promise<boolean>`, where `ArchiveEpicOptions` names
      `projectRoot: string`, `plan: { planName: string; attrs:
      PlanFrontMatter }`, and `uiAPI: UiAPI`. No `any`,
      `unknown`, or `object` appears in the module.
- [ ] `archiveEpicWithChildren` resolves its child set with `findPlansByParent(projectRoot, plan.planName)` without
      filtering on classification, sorted by `compareChildPlansByOrder`, so a non-`PLANNED_CHANGE` child cannot be left
      behind.
- [ ] `archiveEpicWithChildren` returns `false` after emitting one error message that names every blocking Plan and its
      `worktreeStatus`, and archives nothing, when the Epic or any child has a recoverable worktree status. The check
      runs before the first move.
- [ ] `archiveEpicWithChildren` shows `formatEpicProgressSummary(children)` when children exist, plus an explicit line
      stating that the child Plans are archived with the Epic and how many of them are not at a terminal archivable
      status, and then requires a `confirm` selection before any move. The menu label is only `Archive Epic`, so this
      prompt is the only place the user learns that the children move too; it must state the child count even when every
      child is terminal. Selecting anything else archives nothing and returns `false`.
- [ ] `archiveEpicWithChildren` archives every child before the Epic, each through `runArchiveTransition` with
      `action: "archive"` and the `expectedRevision` read from `loadPlan`, passing `force: true` for children and no
      `force` for the Epic, and sharing one `now` timestamp across the whole set so every archived Plan records the same
      `archivedAt`. A non-committed transition raises `transitionFailureError`.
- [ ] `archiveEpicWithChildren` removes the Epic's active child directory with a non-recursive `Deno.remove` after the
      Epic moves, and reports a message instead of failing when the directory is missing or not empty. The directory
      path is derived from the Epic's own resolved file path, captured before the Epic is archived, so a nested Epic
      name resolves correctly and no recursive delete is ever issued.
- [ ] `archiveEpicWithChildren` emits a success message that lists each archived Plan with its archived relative path
      and names `wld plans archive restore <name>` as the way back, then returns `true`.
- [ ] `src/cmd/load-plan/plan-epic-flow.ts` offers `{ value: "archive_epic", label: "Archive Epic" }` in the Epic menu
      when `isTerminalArchivableStatus(plan.attrs.status)` is true, positioned after the `hold` entry and before `view`.
      The handler calls `archiveEpicWithChildren`, returns `"handled"` when it returns `true`, and `continue`s the menu
      loop when it returns `false`.
- [ ] `src/cmd/load-plan/index.integration.test.ts` contains a test named
      `load-plan archives a verified Epic with every
      child Plan and keeps the folder structure` that drives
      `runLoadPlanCommand` with the selections `["archive_epic", "confirm"]` against a `verified` Epic with children
      `epic/01-first` (`verified`) and `epic/02-second` (`ready_for_work`), and asserts all of: `loadPlan` returns
      `null` for all three Plans; `loadArchivedPlan` returns `archivedFromStatus` `verified`, `verified`, and
      `ready_for_work` respectively; `Deno.stat` succeeds for `docs/plans/archived/epic.md`,
      `docs/plans/archived/epic/01-first.md`, and `docs/plans/archived/epic/02-second.md`; and `docs/plans/epic` no
      longer exists.
- [ ] `src/cmd/load-plan/index.integration.test.ts` contains a test named
      `load-plan refuses to archive an Epic whose
      child has a recoverable worktree` that drives the selections
      `["archive_epic", "cancel"]` against a `verified` Epic whose child carries `worktreeStatus: "active"`, and asserts
      that both Plans are still loadable through `loadPlan`, that `loadArchivedPlan` returns `null` for both, and that
      the emitted messages name the blocking child.

## Verification Plan

Automated:

- `deno run -A scripts/run-tests.js src/cmd/load-plan/index.integration.test.ts`
- `deno run -A scripts/run-tests.js src/cmd/plans/archive.test.ts`
- `deno task ci`

Never run `deno test` directly; it shares one process and the real `HOME`.

Manual:

1. Load a verified Epic that has child Plans: `wld load-plan <epic-name>`.
2. Confirm the menu now offers **Archive Epic**, and that the child status roll-up, the statement that children are
   archived with the Epic, and the unfinished count all appear before the confirmation prompt.
3. Confirm the archive.
4. Check the resulting layout: `docs/plans/archived/<epic-name>.md` exists, every child sits at
   `docs/plans/archived/<epic-name>/NN-<child>.md`, and `docs/plans/<epic-name>/` is gone.
5. Check the reverse path works: `wld plans archive restore <epic-name>/01-<child>`.

Expected results for key scenarios:

- Terminal Epic, all children terminal — one confirmation, everything moves, structure preserved.
- Terminal Epic with unfinished children — the confirmation states the unfinished count; on confirm the children archive
  anyway and record their own `archivedFromStatus`.
- Any child with a recoverable worktree — nothing moves, the message names the blocking child, and the Epic menu
  re-prompts.
- Non-terminal Epic — the option is absent and the existing menu is unchanged.

Behavior that must still be protected:

- The single-Plan archive path is untouched. `load-plan archives a verified Plan through the real Plan store`
  (`index.integration.test.ts:170`) and every test in `src/cmd/plans/archive.test.ts` must keep passing **without
  edits**. If one of them needs changing, the change has drifted outside this Plan's scope.
- The Epic menu's existing entries and their gating conditions are unchanged.
  `load-plan marks an Epic done enough only
  after the real lifecycle write` (`index.integration.test.ts:239`) and
  `load-plan recursively loads a real child selected
  from an Epic` (`:418`) must keep passing.
- Golden TUI scenarios in `src/ui/tui/golden-scenarios/load-plan-workflow.ts` and `project-workflow.js` drive Epics at
  non-terminal statuses, so the new option must not appear in them and no golden expectation should need updating.

No behavior is expected to stop existing. Nothing in this Plan removes an API, a menu entry, or a test.

## Edge Cases & Considerations

- **Recoverable worktree on the Epic or a child** — pre-flight blocks the whole operation and archives nothing. Handling
  this after a partial move would leave the user with a half-archived Epic and no clear next action.
- **Retry after a failure** — a failed transition throws and leaves already-archived children in place. Re-running the
  action recomputes the child set from active Plans, so the already-archived children are absent and the retry finishes
  the remainder. This is why children are archived before the Epic: the Epic stays loadable as the retry entry point.
- **Destination already exists** — `archivePlan` throws `Archived Plan already exists` rather than overwriting
  (`src/plan-store.js:2754-2756`). The message surfaces to the user, who must move or restore the conflicting archived
  Plan by hand. Do not add an overwrite path.
- **A child whose name is not nested under the Epic** — `findPlansByParent` matches on the `parentPlan` field, not on
  the path, so a child could in principle live elsewhere. Such a child still archives correctly, because the destination
  is built from its own name segments. The directory cleanup only ever touches the Epic's own expected directory.
- **The Epic directory is not empty after the children move** — a stray non-Plan file makes the non-recursive
  `Deno.remove` fail. Report it and leave the directory. Never use a recursive delete here; the whole point of the
  non-recursive call is that it cannot destroy a file this Plan did not archive.
- **Assumption: the confirmation is always required**, even when every child is terminal. There is no undo inside the
  TUI and restore is CLI-only, so the extra keystroke is worth it. The success message names the restore command.
- **Assumption: `closed_without_verification` Epics are included.** It is one of the three statuses `archivePlan`
  accepts without `force`, and gating the menu on the same set keeps one rule instead of two.
