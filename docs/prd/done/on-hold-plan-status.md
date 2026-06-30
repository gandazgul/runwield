---
title: On-Hold Plan Status
status: draft
createdAt: "2026-06-18T00:00:00.000Z"
---

# On-Hold Plan Status PRD

## Objective

Add a first-class `on_hold` Plan Status so users can intentionally defer non-verified Plans when priorities shift or
they change their mind for now, without archiving, deleting, or losing recovery context.

## Problem Statement

Today, `load-plan` tends to treat saved Plans as active work to resume, execute, decompose, recover, or validate. Users
need a durable way to say: “not now; keep this Plan, but stop surfacing it as active work.” This must work for
standalone FEATURE Plans, PROJECT Epics, child FEATURE Plans, and worktree-backed in-progress or implemented Plans.

`on_hold` must not mean done, canceled, or archived. It means paused-but-resumable.

## Resolved Assumptions

- `on_hold` is a normal Plan Lifecycle status, not a boolean flag.
- Holdable statuses are all non-`verified` statuses, including `draft`, `feedback`, `approved`,
  `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`, and `implemented`.
- `verified` Plans cannot be put on hold because verified means done.
- A held Plan preserves its previous status in `heldFromStatus`.
- Hold metadata is transient and cleared when the Plan resumes.
- `holdReason` is optional free text.
- Resume uses the label **Resume from hold**. Avoid “verify” in UI copy because it can be confused with Workflow
  Validation.
- The pre-resume safety gate is called a **Resume Check**.
- Resume Check compares staleness against the Plan’s last substantive pre-hold baseline, not `heldAt`.
- If Resume Check finds problems, the Plan remains `on_hold` until the user chooses recovery.
- If recovery fails or the user chooses to restart, RunWield can **Reset status to draft** while preserving the Plan
  body.
- `wld plans` remains non-interactive.
- `load-plan` should be consistently menu-first for every Plan status.

## Front Matter

Add hold metadata fields:

```yaml
status: on_hold
heldFromStatus: ready_for_work
heldAt: "2026-06-18T00:00:00.000Z"
holdReason: "priority shifted"
holdStalenessBaseline: "2026-06-17T00:00:00.000Z"
```

When resuming from hold, clear:

- `heldFromStatus`
- `heldAt`
- `holdReason`
- `holdStalenessBaseline`

When resetting status to draft from hold, preserve the Plan markdown body and stable identity/context fields, but clear
hold and execution/recovery fields:

- Set `status: draft`
- Clear hold fields
- Clear `worktreeId`, `worktreePath`, `worktreeBranch`, `worktreeStatus`, `executionBaselineTree`, `failureReason`,
  `failedAt`, `implementedAt`, `verifiedAt`
- Keep `classification`, `complexity`, `summary`, `affectedPaths`, `createdAt`, `origin`, `type`, `parentPlan`,
  `dependencies`

If a worktree exists, confirm before deleting it. Offer a non-destructive path that resets the Plan metadata while
keeping the worktree for manual diff/patch rescue.

## Lifecycle Events

Add Plan Lifecycle events:

- `plan_held`: any non-verified status → `on_hold`; records `heldFromStatus`, `heldAt`, optional `holdReason`, and
  `holdStalenessBaseline`.
- `hold_resumed`: `on_hold` → `heldFromStatus`; clears hold metadata after Resume Check succeeds or the user accepts
  warnings.
- `hold_reset_to_draft`: `on_hold` → `draft`; clears hold and execution/recovery metadata while preserving the Plan
  body.

## `load-plan` UX

`load-plan` should always show a first action menu instead of auto-starting planning/execution.

### Normal non-verified Plans

Menus should include the relevant primary action plus:

- Put on hold
- View plan details
- Cancel

Examples:

- `draft` / `feedback`: Resume planning, Put on hold, View plan details, Cancel
- `approved` / `ready_for_work`: Proceed with execution, Re-open for review, Put on hold, View plan details, Cancel
- `ready_for_decomposition` Epic: Open/resume Slicer decomposition, Put Epic on hold, View Epic details, Cancel
- `in_progress` / `failed` / `implemented`: recovery options plus Put on hold

### On-hold Plans

Layer 1 menu:

- Resume from hold
- View plan details
- Reset status to draft
- Cancel / Keep on hold

Selecting **Resume from hold** runs Resume Check.

Resume Check should inspect:

- Worktree exists, when worktree metadata is present
- Recorded branch matches, when applicable
- Mergeability/risk against the primary checkout, when applicable
- Commits touching `affectedPaths` since `holdStalenessBaseline`

Outcomes:

- Check passes: restore `heldFromStatus`, clear hold metadata, and immediately continue normal `load-plan` flow for the
  restored status.
- Check warns: show warnings and offer Proceed with resume or Keep on hold.
- Check fails: keep Plan `on_hold` and show recovery options.

Recovery options should include **Reset status to draft**.

## Epic and Child FEATURE Semantics

### Holding an Epic

Putting an Epic on hold mutates only the Epic:

- Epic gets `status: on_hold` and hold metadata.
- Child FEATURE Plan statuses do not change.
- Child FEATURE Plans inherit on-hold visibility/UX while the parent Epic is on hold.
- Loading a child FEATURE whose parent Epic is on hold must force resuming the parent first; no override to work on held
  project children.

Epic hold confirmation should warn:

> Child FEATURE Plans will be hidden/blocked while this Epic is on hold. Their statuses will not change.

Resuming a held Epic should show a child status summary, but only mutate the parent Epic.

If both an Epic and a child FEATURE are independently on hold, resuming the Epic does not resume the child.

### Holding a Child FEATURE

A child FEATURE can be individually put on hold while its parent Epic remains active.

- It remains displayed inline under the parent Epic with `status: on_hold`.
- Loading it runs normal Resume Check for that child.
- Resume mutates only that child; parent and siblings are unaffected.

Child hold confirmation should state:

> Only this child FEATURE will be held. The parent Epic and sibling FEATURE Plans stay active.

## `wld plans` UX

`wld plans` remains read-only.

Listing behavior:

- Active Epics keep their child tree inline, including individually held children marked `on_hold`.
- Held Epics move to a bottom `On Hold:` section and show their child FEATURE tree underneath.
- Standalone held Plans appear in the bottom `On Hold:` section.
- Held child FEATUREs under active Epics do not move to the bottom section.

Example:

```text
Epics:
  active-epic
    Progress: 1/3 verified — 1 on hold — 1 remaining
    Features:
      - active-epic/01-schema       verified
      - active-epic/02-api          on_hold
      - active-epic/03-ui           draft

Standalone plans:
  add-shortcut
    Status: ready_for_work

On Hold:
  paused-epic
    Held from: ready_for_work
    Reason: priority shifted
    Progress: 2/4 verified — 2 remaining
    Features:
      - paused-epic/01-core         verified
      - paused-epic/02-tests        verified
      - paused-epic/03-docs         draft
      - paused-epic/04-polish       ready_for_work

  standalone-paused-plan
    Held from: implemented
    Reason: cannot merge right now
```

## Out of Scope

- Making `wld plans` interactive.
- Archiving or deleting Plans as part of hold.
- Holding `verified` Plans.
- Mutating child FEATURE statuses when putting an Epic on hold or resuming it.
- Automatically deleting worktrees without confirmation.
