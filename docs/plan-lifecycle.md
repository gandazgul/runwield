# Plan Lifecycle

Plan status is the durable state machine for saved Plans. Workflow code records facts as Plan Events, and the Plan
Lifecycle decides the next status and front matter updates.

Plan metadata is canonical in the primary project checkout even when implementation runs in a linked execution worktree.
Worktree paths, branches, and registry records describe where execution work lives; they do not replace Plan Status.

PROJECT Plans with `type: epic` are Epic containers. They are decomposed into child FEATURE Plans and are not executed
as implementation work themselves. Legacy non-Epic PROJECT task tables still exist for compatibility, but they are not
the active PROJECT workflow.

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
Epic "done enough for now"; remaining child FEATURE Plans stay visible and loadable.

## Worktree Statuses

Worktree status is stored separately from Plan Status so Harns can describe recoverable execution state without changing
the Plan state machine.

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

| Event                     | From                                                                                            | To                        | Notes                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `review_feedback`         | `draft`, `feedback`, `approved`                                                                 | `feedback`                | The user returned Feedback from Plannotator.                                                                     |
| `review_approved`         | `draft`, `feedback`, `approved`                                                                 | `approved`                | User approval is durable before the Readiness Gate runs.                                                         |
| `epic_readiness_passed`   | `approved`                                                                                      | `ready_for_decomposition` | PROJECT Epics pass approval into decomposition; they are not executable yet.                                     |
| `decomposition_finalized` | `approved`, `ready_for_decomposition`                                                           | `ready_for_work`          | Slicer finalized at least one child FEATURE Plan, so the Epic can offer child selection.                         |
| `readiness_passed`        | `approved`                                                                                      | `ready_for_work`          | FEATURE Plans pass without an LLM call; legacy non-Epic PROJECT Plans pass after valid Slicer Tasks exist.       |
| `execution_started`       | `ready_for_work`                                                                                | `in_progress`             | Captures `executionBaselineTree` and records active worktree metadata before executable Plan work begins.        |
| `execution_failed`        | `in_progress`                                                                                   | `failed`                  | Sets `failureReason`, `failedAt`, and `worktreeStatus: "execution_failed"` when a reason is available.           |
| `implementation_finished` | `in_progress`                                                                                   | `implemented`             | Sets `implementedAt` and `worktreeStatus: "completed"`; Workflow Validation still needs to run.                  |
| `validation_failed`       | `implemented`                                                                                   | `implemented`             | Keeps implemented status and sets `worktreeStatus: "validation_failed"` plus `failureReason`.                    |
| `worktree_merge_failed`   | `implemented`                                                                                   | `implemented`             | Validation passed but merge-back failed/refused; sets `worktreeStatus: "merge_conflict"`.                        |
| `validation_passed`       | `implemented`                                                                                   | `verified`                | Recorded only after validation passes and merge-back succeeds; clears worktree metadata when cleanup is enabled. |
| `recovery_continue`       | `in_progress`, `failed`                                                                         | `ready_for_work`          | Records that recovery will continue from the current worktree.                                                   |
| `recovery_reset`          | `in_progress`, `failed`, `implemented`                                                          | `ready_for_work`          | Records that recovery abandoned the current attempt before retrying.                                             |
| `review_reopened`         | `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`, `implemented`, `verified` | `feedback`                | The user chose to revise the Plan instead of continuing execution.                                               |
| `epic_done_enough`        | `ready_for_work`, `verified`                                                                    | `verified`                | The user marked an Epic complete enough for now; child FEATURE Plans remain visible and loadable.                |

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

Before executable implementation starts, Harns creates or reuses a git worktree for the plan and records its metadata in
the primary plan file and `.hns/worktrees.json`. Agent sessions, built-in file tools, custom edit tools, local CI,
workflow diffs, reviewer sessions, and repair sessions receive the execution worktree as their cwd. Harns does not use
`Deno.chdir()` for this because concurrent execution may still exist in future task-based workflows.

The primary checkout remains the metadata root for saved plans, settings, `.hns/worktrees.json`, and
`.hns/worktrees.lock`. This means `hns plans` and `hns load-plan` can see current lifecycle state while implementation
files are isolated in a linked worktree. The worktree registry and lock files are local runtime state and are ignored by
Git so execution branches cannot merge stale registry snapshots back into the primary checkout.

## Workflow Validation and Merge-Back

Workflow Validation applies only to executable Plan work. It promotes `implemented` to `verified` only after local
validation, semantic review, and merge-back all succeed.

For worktree-backed plans:

1. Implementation runs in the execution worktree.
2. `implementation_finished` records Plan Status `implemented` and worktree status `completed`; it does not merge into
   the primary checkout.
3. Workflow Validation runs local CI, computes the workflow diff, starts reviewer sessions, and starts repair sessions
   in the execution worktree.
4. If validation fails, Harns keeps Plan Status `implemented`, records `worktreeStatus: "validation_failed"`, and leaves
   the worktree for recovery.
5. If validation passes, Harns attempts to merge the execution branch into the primary checkout.
6. Only after that merge succeeds does Harns record `validation_passed` and set Plan Status `verified`. By default,
   Harns removes the execution checkout, deletes its `.hns/worktrees.json` entry, and clears `executionBaselineTree`,
   `worktreeId`, `worktreePath`, `worktreeBranch`, and `worktreeStatus` from the plan file. If `cleanupMergedWorktrees`
   is `false`, Harns keeps the merged checkout, registry entry, and plan pointers for inspection.
7. If merge-back fails or is refused because the primary checkout has blocking uncommitted changes, Harns records
   `worktree_merge_failed`, keeps Plan Status `implemented`, sets `worktreeStatus: "merge_conflict"`, and leaves the
   worktree intact.

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

`epicCompletionMode`: Set to `done_enough` when the user marks an Epic complete enough for now.

`epicDoneEnoughSummary`: Summary recorded with the done-enough Epic decision.

`executionBaselineTree`: Git tree captured in the execution worktree at `execution_started`.

`worktreeId`: Durable id of the matching `.hns/worktrees.json` registry entry.

`worktreePath`: Filesystem path to the linked execution worktree.

`worktreeBranch`: Git branch checked out in the execution worktree, usually under `harns/worktree/`.

`worktreeStatus`: Worktree lifecycle state. See [Worktree Statuses](#worktree-statuses).

## Recovery

Loading an `in_progress`, `failed`, or `implemented` executable Plan starts Plan Recovery. For worktree-backed plans,
Harns resolves worktree context from the plan front matter first and the registry second. Inspect/report shows plan
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

`hns plans` shows Epic hierarchy when PROJECT Plans use `type: epic`. Child FEATURE Plans are grouped under their parent
Epic using `parentPlan`, and Epics show verified/active/remaining/failed progress. Child FEATURE Plans whose
`parentPlan` does not match an existing Epic are shown as orphaned child plans.

`hns plans` also shows concise worktree state for plans with worktree metadata:

```text
Worktree: validation_failed (harns/worktree/example-plan-1234abcd)
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
- Executable FEATURE and legacy non-Epic PROJECT validation cannot pass with an empty or Plan-document-only workflow
  diff.
- Legacy non-Epic PROJECT Task graphs must finish with an Integration Point before Workflow Validation starts.
- Workflow code should record Plan Events instead of directly mutating Plan Status.
