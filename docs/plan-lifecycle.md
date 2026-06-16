# Plan Lifecycle

Plan status is the durable state machine for saved Plans. Workflow code records facts as Plan Events, and the Plan
Lifecycle decides the next status and front matter updates.

Plan metadata is canonical in the primary project checkout even when implementation runs in a linked execution worktree.
Worktree paths, branches, and registry records describe where execution work lives; they do not replace Plan Status.

## Statuses

`draft`: A Plan exists but has not completed a Review Loop.

`feedback`: The Review Loop returned user feedback, or the planning agent was interrupted while handling feedback.

`approved`: The Review Loop ended with user approval, but pre-execution preparation may still be unfinished.

`ready_for_work`: The only status that means a Plan may proceed to execution.

`in_progress`: Execution has started. For current plans, implementation work runs in the recorded execution worktree.

`failed`: Execution started from `ready_for_work` but implementation work did not finish. The worktree is left in place
when one is recorded.

`implemented`: Implementation work finished in the execution worktree, but Workflow Validation has not passed and merged
back into the primary checkout.

`verified`: Implementation work passed Workflow Validation and, for worktree-backed executions, the validated worktree
branch was merged back into the primary checkout.

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

| Event                     | From                                                                 | To               | Notes                                                                                                            |
| ------------------------- | -------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `review_feedback`         | `draft`, `feedback`, `approved`                                      | `feedback`       | The user returned Feedback from Plannotator.                                                                     |
| `review_approved`         | `draft`, `feedback`, `approved`                                      | `approved`       | User approval is durable before the Readiness Gate runs.                                                         |
| `readiness_passed`        | `approved`                                                           | `ready_for_work` | FEATURE Plans pass without an LLM call; PROJECT Plans pass after valid Slicer Tasks exist.                       |
| `execution_started`       | `ready_for_work`                                                     | `in_progress`    | Captures `executionBaselineTree` and records active worktree metadata before work begins.                        |
| `execution_failed`        | `in_progress`                                                        | `failed`         | Sets `failureReason`, `failedAt`, and `worktreeStatus: "execution_failed"` when a reason is available.           |
| `implementation_finished` | `in_progress`                                                        | `implemented`    | Sets `implementedAt` and `worktreeStatus: "completed"`; Workflow Validation still needs to run.                  |
| `validation_failed`       | `implemented`                                                        | `implemented`    | Keeps implemented status and sets `worktreeStatus: "validation_failed"` plus `failureReason`.                    |
| `worktree_merge_failed`   | `implemented`                                                        | `implemented`    | Validation passed but merge-back failed/refused; sets `worktreeStatus: "merge_conflict"`.                        |
| `validation_passed`       | `implemented`                                                        | `verified`       | Recorded only after validation passes and merge-back succeeds; clears worktree metadata when cleanup is enabled. |
| `recovery_continue`       | `in_progress`, `failed`                                              | `ready_for_work` | Records that recovery will continue from the current worktree.                                                   |
| `recovery_reset`          | `in_progress`, `failed`, `implemented`                               | `ready_for_work` | Records that recovery abandoned the current attempt before retrying.                                             |
| `review_reopened`         | `ready_for_work`, `in_progress`, `failed`, `implemented`, `verified` | `feedback`       | The user chose to revise the Plan instead of continuing execution.                                               |

## Readiness Gate

The Readiness Gate is classification-aware.

For FEATURE Plans, the gate does not call an LLM. It promotes `approved` to `ready_for_work`.

For PROJECT Plans, the gate ensures a parseable Tasks table exists. If Tasks are missing, it runs Slicer. If Slicer
fails or produces invalid Tasks, the Plan stays `approved` and records no executable status.

## Execution Worktrees

Before implementation starts, Harns creates or reuses a git worktree for the plan and records its metadata in the
primary plan file and `.hns/worktrees.json`. Agent sessions, built-in file tools, custom edit tools, local CI, workflow
diffs, reviewer sessions, and repair sessions receive the execution worktree as their cwd. Harns does not use
`Deno.chdir()` for this because PROJECT tasks can run concurrently.

The primary checkout remains the metadata root for saved plans, settings, `.hns/worktrees.json`, and
`.hns/worktrees.lock`. This means `hns plans` and `hns load-plan` can see current lifecycle state while implementation
files are isolated in a linked worktree.

## Workflow Validation and Merge-Back

Workflow Validation applies only to FEATURE and PROJECT Plans. It promotes `implemented` to `verified` only after local
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

For PROJECT Plans, the final tester-owned Task is the Integration Point. It checks cross-slice integration inside the
Task graph and may run the project's validation command, but it does not promote the Plan to `verified`. Only Workflow
Validation is the independent acceptance gate for `verified`.

For FEATURE and PROJECT Plans, the workflow diff must contain implementation changes. An empty scoped diff, or a diff
that only changes Plan documents under `plans/`, is a validation failure. QUICK_FIX workflows are operational and are
not saved as executable Plans, so the Operator is responsible for any needed self-verification before calling
`task_completed`.

## Front Matter Fields

`status`: Current Plan Status.

`failureReason`: Optional concise reason for `failed` status, validation failure, or merge-back failure.

`failedAt`: Timestamp set when execution fails before implementation finishes.

`implementedAt`: Timestamp set when execution work finishes.

`verifiedAt`: Timestamp set when Workflow Validation passes and merge-back succeeds.

`executionBaselineTree`: Git tree captured in the execution worktree at `execution_started`.

`worktreeId`: Durable id of the matching `.hns/worktrees.json` registry entry.

`worktreePath`: Filesystem path to the linked execution worktree.

`worktreeBranch`: Git branch checked out in the execution worktree, usually under `harns/worktree/`.

`worktreeStatus`: Worktree lifecycle state. See [Worktree Statuses](#worktree-statuses).

## Recovery

Loading an `in_progress`, `failed`, or `implemented` Plan starts Plan Recovery. For worktree-backed plans, Harns
resolves worktree context from the plan front matter first and the registry second. Inspect/report shows plan status,
worktree status, path, branch, base commit/ref when available, git status, and changes since the execution baseline.

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

`hns plans` shows concise worktree state for plans with worktree metadata:

```text
Worktree: validation_failed (harns/worktree/example-plan-1234abcd)
```

The parenthesized value is the recorded worktree branch when available, otherwise the path.

## Invariants

- `ready_for_work` is the only executable status.
- `approved` is durable but not executable.
- `failed` only occurs after work started from `ready_for_work`.
- `implemented` means implementation finished in the execution worktree, even if validation or merge-back later fails.
- `verified` requires successful Workflow Validation and, for worktree-backed plans, successful merge-back.
- FEATURE and PROJECT validation cannot pass with an empty or Plan-document-only workflow diff.
- A PROJECT Task graph must finish with an Integration Point before Workflow Validation starts.
- `verified` is the terminal success status.
- Workflow code should record Plan Events instead of directly mutating Plan Status.
