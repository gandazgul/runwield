# Plan Lifecycle

Plan status is the durable state machine for saved Plans. Workflow code records facts as Plan Events, and the Plan
Lifecycle decides the next status and front matter updates.

Plan metadata is canonical in the primary project checkout even when implementation runs in a linked execution worktree.
Worktree paths, branches, and registry records describe where execution work lives; they do not replace Plan Status.

PROJECT Plans with `type: epic` are Epic containers. They are decomposed interactively by the Slicer into child FEATURE
Plans under `plans/<epic-name>/` and are not executed as implementation work themselves. Child FEATURE Plans point back
to the Epic with `parentPlan` and may list sibling `dependencies`. Legacy non-Epic PROJECT task tables still exist for
compatibility, but they are not the active PROJECT workflow.

## Statuses

`draft`: A Plan exists but has not completed a Review Loop.

`feedback`: The Review Loop returned user feedback, or the planning agent was interrupted while handling feedback.

`approved`: The Review Loop ended with user approval, but pre-execution preparation may still be unfinished.

`ready_for_decomposition`: An Epic PROJECT Plan has been approved and can be opened by the Slicer. This is not an
executable status.

`ready_for_work`: The only executable status for FEATURE Plans and legacy non-Epic PROJECT Plans. For an Epic PROJECT
Plan, it means decomposition has been finalized and child FEATURE Plans can be selected; the Epic itself is still a
container, not executable implementation work.

`in_progress`: Execution has started. For executable plans, implementation work runs in the recorded execution worktree.

`failed`: Execution started from `ready_for_work` but implementation work did not finish. The worktree is left in place
when one is recorded.

`implemented`: Implementation work finished in the execution worktree, but Workflow Validation has not passed and merged
back into the primary checkout.

`verified`: Implementation work passed Workflow Validation and, for worktree-backed executions, the validated worktree
branch was merged back into the primary checkout. For an Epic PROJECT Plan, `verified` may also mean the user marked the
Epic "done enough for now"; remaining child FEATURE Plans stay visible and loadable. FEATURE Plans cannot be moved
directly to `verified` by board movement.

`closed_without_verification`: A terminal manual closure outcome. The user intentionally ended the Plan without Workflow
Validation passing. It is distinct from `verified` and does not set `verifiedAt`, human review metadata, or Epic
done-enough metadata.

`on_hold`: A paused-but-resumable Plan. Holding preserves the previous status in `heldFromStatus` plus hold metadata so
callers can run a Resume Check before restoring the Plan. Holding a Plan mutates only that Plan file; Epic/child
visibility and blocking are listing/UI behavior.

## Physical Archival

Archival is not a Plan Status. Archived Plans keep their last durable lifecycle status and move on disk from `plans/` to
`plans/archived/`, preserving nested relative paths. Normal active listings hide `plans/archived/`, while explicit
archive commands can list, read, and restore those plaintext markdown files.

`verified` and `closed_without_verification` are terminal outcomes that can be archived without `--force`. Other
statuses, including `on_hold`, require `--force` because they may represent unfinished or resumable work. Even with
`--force`, Plans with recoverable worktree states (`active`, `execution_failed`, `validation_failed`, or
`merge_conflict`) remain blocked until the user resolves or abandons that worktree state through a dedicated flow.

Archive metadata (`archivedAt`, `archiveReason`, `archivedFromStatus`, `archivedFromPath`) and restore metadata
(`restoredAt`, `restoredFromPath`) explain the physical move without changing the status state machine.

## Worktree Statuses

Worktree status is stored separately from Plan Status so RunWield can describe recoverable execution state without
changing the Plan state machine.

| Worktree status     | Meaning                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `none`              | No execution worktree is associated with the plan.                                            |
| `active`            | The execution worktree exists and implementation is in progress or ready to resume.           |
| `completed`         | Implementation finished in the worktree; validation and merge-back have not completed.        |
| `execution_failed`  | Implementation halted before completion; the worktree remains available for inspection/retry. |
| `validation_failed` | Implementation finished, but Workflow Validation failed; the worktree remains available.      |
| `merge_conflict`    | Validation passed, but merge-back into the primary checkout failed or was refused.            |
| `merged`            | Validation passed and the worktree branch was merged into the primary checkout.               |
| `abandoned`         | The user chose to abandon/delete the execution worktree instead of continuing or merging it.  |

## Events

| Event                                | From                                                                                            | To                            | Notes                                                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `review_feedback`                    | `draft`, `feedback`, `approved`                                                                 | `feedback`                    | The user returned Feedback from Plannotator.                                                                                                                                                                                   |
| `review_approved`                    | `draft`, `feedback`, `approved`                                                                 | `approved`                    | User approval is durable before the Readiness Gate runs.                                                                                                                                                                       |
| `epic_readiness_passed`              | `approved`                                                                                      | `ready_for_decomposition`     | PROJECT Epics pass approval into decomposition; they are not executable yet.                                                                                                                                                   |
| `decomposition_finalized`            | `approved`, `ready_for_decomposition`                                                           | `ready_for_work`              | Slicer finalized at least one child FEATURE Plan, so the Epic can offer child selection.                                                                                                                                       |
| `readiness_passed`                   | `approved`                                                                                      | `ready_for_work`              | FEATURE Plans pass without an LLM call; legacy non-Epic PROJECT Plans pass after valid Slicer Tasks exist.                                                                                                                     |
| `execution_started`                  | `ready_for_work`                                                                                | `in_progress`                 | Captures `executionBaselineTree` and records active worktree metadata before executable Plan work begins.                                                                                                                      |
| `execution_failed`                   | `in_progress`                                                                                   | `failed`                      | Sets `failureReason`, `failedAt`, and `worktreeStatus: "execution_failed"` when a reason is available.                                                                                                                         |
| `implementation_finished`            | `in_progress`                                                                                   | `implemented`                 | Sets `implementedAt` and `worktreeStatus: "completed"`; Workflow Validation still needs to run.                                                                                                                                |
| `validation_failed`                  | `implemented`                                                                                   | `implemented`                 | Keeps implemented status and sets `worktreeStatus: "validation_failed"` plus `failureReason`.                                                                                                                                  |
| `worktree_merge_failed`              | `implemented`                                                                                   | `implemented`                 | Validation passed but merge-back failed/refused; sets `worktreeStatus: "merge_conflict"`.                                                                                                                                      |
| `validation_passed`                  | `implemented`                                                                                   | `verified`                    | Recorded only after validation passes and merge-back succeeds; clears worktree metadata when cleanup is enabled.                                                                                                               |
| `recovery_continue`                  | `in_progress`, `failed`                                                                         | `ready_for_work`              | Records that recovery will continue from the current worktree.                                                                                                                                                                 |
| `recovery_reset`                     | `in_progress`, `failed`, `implemented`                                                          | `ready_for_work`              | Records that recovery abandoned the current attempt before retrying.                                                                                                                                                           |
| `review_reopened`                    | `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`, `implemented`, `verified` | `feedback`                    | The user chose to revise the Plan instead of continuing execution.                                                                                                                                                             |
| `epic_done_enough`                   | `ready_for_work`, `verified`                                                                    | `verified`                    | The user marked an Epic complete enough for now; child FEATURE Plans remain visible and loadable.                                                                                                                              |
| `manual_status_change`               | Board-safe non-terminal statuses                                                                | Dynamic target                | User-driven board movement among `draft`, `feedback`, `approved`, `ready_for_work`, `in_progress`, `implemented`; `ready_for_decomposition` is included only for Epics. Records an event instead of editing `status` directly. |
| `manual_closed_without_verification` | Board-safe non-terminal statuses                                                                | `closed_without_verification` | Terminal manual closure without Workflow Validation; does not set `verifiedAt` or review metadata.                                                                                                                             |
| `plan_held`                          | Any non-terminal, non-closed status                                                             | `on_hold`                     | Records `heldFromStatus`, `heldAt`, optional `holdReason`, and optional `holdStalenessBaseline`; preserves recovery/worktree metadata.                                                                                         |
| `hold_resumed`                       | `on_hold`                                                                                       | `heldFromStatus`              | Caller must run the Resume Check first and provide/read the held-from status; clears hold metadata.                                                                                                                            |
| `hold_reset_to_draft`                | `on_hold`                                                                                       | `draft`                       | Clears hold and execution/recovery/validation fields while preserving identity/context fields and Plan body.                                                                                                                   |

## Manual Board Movement and Closure

Board actions are lifecycle events, not direct Front Matter edits. Generic board movement uses `manual_status_change`
and may move both directions only within the safe board set: `draft`, `feedback`, `approved`, `ready_for_work`,
`in_progress`, and `implemented`. For PROJECT Epics with `type: epic`, `ready_for_decomposition` is also board-safe.

Generic board movement cannot enter or leave `failed`, cannot produce `verified`, cannot enter
`closed_without_verification`, and cannot enter or resume from `on_hold`. Those states remain behind recovery, Workflow
Validation, manual closure, or hold-specific events. `verified` is reserved for Workflow Validation except for the
existing Epic `epic_done_enough` event.

`manual_closed_without_verification` records that the user intentionally closed a Plan without Workflow Validation. This
is not an archive, not a validation pass, and not a merge-back signal; evidence/worktree fields are preserved unless a
separate recovery action changes them.

### Workspace manual actions

The browser Workspace board and detail controls call the token-protected lifecycle action API for every status mutation.
They never directly write `status` front matter. Button/menu actions use the same lifecycle intent shape that future
keyboard shortcuts or drag-and-drop drop handlers must use, so drag gestures are only an input layer over the existing
lifecycle path.

Workspace Resume from hold runs a conservative Resume Check before recording `hold_resumed`. If recorded worktree or
staleness metadata cannot be proven safe, the API returns a warning that requires explicit user confirmation; hard
failures block the resume. Full pointer/touch drag-and-drop gestures are not required for the current Workspace slice.

## On-Hold Plans

`plan_held` can pause any non-terminal, non-closed status, including `failed` and `implemented`. It sets:

- `heldFromStatus`: the status before the hold
- `heldAt`: when the hold was recorded
- `holdReason`: optional free text
- `holdStalenessBaseline`: optional caller-provided baseline for the Resume Check

`hold_resumed` restores `heldFromStatus` and clears all hold fields. The Resume Check itself is caller-owned and must
run before recording `hold_resumed`.

`hold_reset_to_draft` clears hold fields plus stale execution/recovery/validation fields: `worktreeId`, `worktreePath`,
`worktreeBranch`, `worktreeStatus`, `executionBaselineTree`, `failureReason`, `failedAt`, `implementedAt`, `verifiedAt`,
`humanReviewMode`, `humanReviewDecision`, and `humanReviewedAt`. It preserves identity/context fields such as
`classification`, `complexity`, `summary`, `affectedPaths`, `createdAt`, `origin`, `type`, `parentPlan`, and
`dependencies`.

## Readiness Gate

The Readiness Gate is classification-aware.

For FEATURE Plans, the gate does not call an LLM. It promotes `approved` to `ready_for_work`.

For PROJECT Epics, the gate records `epic_readiness_passed` and promotes `approved` to `ready_for_decomposition`. The
Slicer then runs as an interactive decomposition agent. It can write draft child FEATURE Plans without changing the Epic
status. When the user explicitly finalizes decomposition and at least one child FEATURE Plan exists, the Slicer records
`decomposition_finalized` and the Epic becomes `ready_for_work` for child selection. That status does not mean the Epic
itself can be executed.

For legacy non-Epic PROJECT Plans, the gate keeps the older task-table compatibility path: it ensures a parseable Tasks
table exists and runs the legacy Slicer if needed. That task-DAG path is legacy/future machinery, not the default
PROJECT behavior.

## Execution Worktrees

Before executable implementation starts, RunWield creates or reuses a git worktree for the plan and records its metadata
in the primary plan file and `.wld/worktrees.json`. Agent sessions, built-in file tools, custom edit tools, local CI,
workflow diffs, reviewer sessions, and repair sessions receive the execution worktree as their cwd. RunWield does not
use `Deno.chdir()` for this because concurrent execution may still exist in future task-based workflows.

The primary checkout remains the metadata root for saved plans, settings, `.wld/worktrees.json`, and
`.wld/worktrees.lock`. This means `wld plans` and `wld load-plan` can see current lifecycle state while implementation
files are isolated in a linked worktree. The worktree registry and lock files are local runtime state and are ignored by
Git so execution branches cannot merge stale registry snapshots back into the primary checkout.

## Workflow Validation and Merge-Back

Workflow Validation applies only to executable Plan work. It promotes `implemented` to `verified` only after local
validation, semantic review, any configured human code review gate, and merge-back all succeed.

For worktree-backed plans:

1. Implementation runs in the execution worktree.
2. `implementation_finished` records Plan Status `implemented` and worktree status `completed`; it does not merge into
   the primary checkout.
3. Workflow Validation runs local CI, computes the workflow diff, starts semantic reviewer sessions, and starts repair
   sessions in the execution worktree.
4. If `codereview` is `ask` or `always`, RunWield opens or offers Plannotator human code review after semantic review
   passes and before merge-back. Human feedback is sent back to the Engineer in the execution worktree, then validation
   reruns.
5. If validation fails, RunWield keeps Plan Status `implemented`, records `worktreeStatus: "validation_failed"`, and
   leaves the worktree for recovery.
6. If validation passes, RunWield attempts to merge the execution branch into the primary checkout.
7. Only after that merge succeeds does RunWield record `validation_passed` and set Plan Status `verified`. By default,
   RunWield removes the execution checkout, deletes its `.wld/worktrees.json` entry, and clears `executionBaselineTree`,
   `worktreeId`, `worktreePath`, `worktreeBranch`, and `worktreeStatus` from the plan file. If `cleanupMergedWorktrees`
   is `false`, RunWield keeps the merged checkout, registry entry, and plan pointers for inspection.
8. If merge-back fails or is refused because the primary checkout has blocking uncommitted changes, RunWield records
   `worktree_merge_failed`, keeps Plan Status `implemented`, sets `worktreeStatus: "merge_conflict"`, and leaves the
   worktree intact.

Human code review does not add a new primary Plan Status. While human review is pending, returning feedback, or
canceled, the Plan remains `implemented`. Final `validation_passed` metadata records whether human review was not
required, skipped, or approved. RunWield clears stale human-review metadata when execution starts again, when recovery
resets a plan, or when a plan is re-opened for review.

For PROJECT Epics, child FEATURE Plans run their own Workflow Validation. The Epic can be marked done enough for now,
but it does not run a validation loop as if it were an implementation diff. For legacy non-Epic PROJECT Plans, the final
tester-owned Task remains the Integration Point before Workflow Validation.

For executable FEATURE and legacy non-Epic PROJECT Plans, the workflow diff must contain implementation changes. An
empty scoped diff, or a diff that only changes Plan documents under `plans/`, is a validation failure. QUICK_FIX
workflows are operational and are not saved as executable Plans, so the Operator is responsible for any needed
self-verification before calling `task_completed`.

## Front Matter Fields

`status`: Current Plan Status.

`type`: Optional Plan subtype. `type: epic` marks a PROJECT Plan as an Epic container.

`parentPlan`: Child FEATURE pointer to the parent Epic plan name.

`dependencies`: Optional sibling FEATURE Plan identifiers that should be verified first. Loading a child FEATURE warns
when dependencies are missing or not verified, but the user may choose to proceed.

`failureReason`: Optional concise reason for `failed` status, validation failure, or merge-back failure.

`failedAt`: Timestamp set when execution fails before implementation finishes.

`implementedAt`: Timestamp set when execution work finishes.

`verifiedAt`: Timestamp set when Workflow Validation passes and merge-back succeeds, or when an Epic is marked done
enough for now.

`humanReviewMode`: Human code review mode used for final validation: `none`, `ask`, or `always`.

`humanReviewDecision`: Human code review outcome included in final validation: `not_required`, `skipped`, or `approved`.

`humanReviewedAt`: Timestamp set when a human code review approved final validation.

`epicCompletionMode`: Set to `done_enough` when the user marks an Epic complete enough for now.

`epicDoneEnoughSummary`: Summary recorded with the done-enough Epic decision.

`executionBaselineTree`: Git tree captured in the execution worktree at `execution_started`.

`worktreeId`: Durable id of the matching `.wld/worktrees.json` registry entry.

`worktreePath`: Filesystem path to the linked execution worktree.

`worktreeBranch`: Git branch checked out in the execution worktree, usually under `runwield/worktree/`.

`worktreeStatus`: Worktree lifecycle state. See [Worktree Statuses](#worktree-statuses).

`heldFromStatus`: Status captured before `plan_held` moved the Plan to `on_hold`.

`heldAt`: Timestamp set when `plan_held` moved the Plan to `on_hold`.

`holdReason`: Optional free-text reason recorded by the user when placing a Plan on hold.

`holdStalenessBaseline`: Optional baseline used by caller-owned Resume Check logic before `hold_resumed`.

## Recovery

Loading an `in_progress`, `failed`, or `implemented` executable Plan starts Plan Recovery. For worktree-backed plans,
RunWield resolves worktree context from the plan front matter first and the registry second. Inspect/report shows plan
status, worktree status, path, branch, base commit/ref when available, git status, and changes since the execution
baseline.

Recovery actions are deliberately scoped to the execution worktree:

- **Continue execution from current worktree**: Rehydrates active execution state with the primary project root,
  execution cwd, worktree id/branch, and baseline tree before rerunning execution.
- **Retry Workflow Validation**: For `implemented` plans, reruns validation in the recorded execution worktree and only
  merges after validation passes.
- **Merge worktree changes**: For worktree-backed `implemented` plans, attempts to merge the recorded worktree branch
  into the primary checkout. Merge failure records `worktreeStatus: "merge_conflict"` and leaves the worktree intact.
- **Delete/recreate worktree and start over**: Removes the recorded worktree, marks the old registry entry abandoned,
  creates a fresh execution worktree from recorded base metadata when available, records `recovery_reset`, and retries
  from `ready_for_work`.
- **Delete/abandon worktree**: Removes the worktree, marks the registry entry abandoned, clears worktree id/path/branch
  from plan front matter, and leaves the plan recoverable for another choice.
- **Re-open for review**: Moves the plan back to `feedback` so it can be revised instead of continued.

Legacy plans that have an `executionBaselineTree` but no worktree metadata keep the older baseline-tree reset path. That
path restores the primary checkout to the execution-start snapshot, so the confirmation must clearly state that
unrelated changes made after that snapshot will be lost.

## Plan List Visibility

`wld plans` shows Epic hierarchy when PROJECT Plans use `type: epic`. Child FEATURE Plans are grouped under their parent
Epic using `parentPlan`, and Epics show verified/active/remaining/failed progress. Child FEATURE Plans whose
`parentPlan` does not match an existing Epic are shown as orphaned child plans.

`wld plans` also shows concise worktree state for plans with worktree metadata:

```text
Worktree: validation_failed (runwield/worktree/example-plan-1234abcd)
```

The parenthesized value is the recorded worktree branch when available, otherwise the path.

## Invariants

- `ready_for_work` is the only executable status for FEATURE and legacy non-Epic PROJECT Plans.
- `ready_for_work` on a PROJECT Epic means child FEATURE selection is available, not that the Epic executes directly.
- `ready_for_decomposition` is not executable.
- `approved` is durable but not executable.
- `failed` only occurs after work started from `ready_for_work`.
- `implemented` means implementation finished in the execution worktree, even if validation or merge-back later fails.
- `verified` requires successful Workflow Validation and, for worktree-backed plans, successful merge-back, except for
  PROJECT Epics marked `done_enough`.
- `closed_without_verification` is terminal manual closure and never implies validation passed.
- `on_hold` is a pause state; resume/reset must clear hold metadata.
- Human code review is optional Workflow Validation metadata, not a separate Plan Status.
- Executable FEATURE and legacy non-Epic PROJECT validation cannot pass with an empty or Plan-document-only workflow
  diff.
- Legacy non-Epic PROJECT Task graphs must finish with an Integration Point before Workflow Validation starts.
- Workflow code should record Plan Events instead of directly mutating Plan Status.
