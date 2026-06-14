# Plan Lifecycle

Plan status is the durable state machine for saved Plans. Workflow code records facts as Plan Events, and the Plan
Lifecycle decides the next status and front matter updates.

## Statuses

`draft`: A Plan exists but has not completed a Review Loop.

`feedback`: The Review Loop returned user feedback, or the planning agent was interrupted while handling feedback.

`approved`: The Review Loop ended with user approval, but pre-execution preparation may still be unfinished.

`ready_for_work`: The only status that means a Plan may proceed to execution.

`in_progress`: Execution has started. The worktree may contain partial implementation work.

`failed`: Execution started from `ready_for_work` but implementation work did not finish.

`implemented`: Implementation work finished, but Workflow Validation has not passed.

`verified`: Implementation work and Workflow Validation both passed.

## Events

| Event                     | From                                                                 | To               | Notes                                                                                      |
| ------------------------- | -------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `review_feedback`         | `draft`, `feedback`, `approved`                                      | `feedback`       | The user returned Feedback from Plannotator.                                               |
| `review_approved`         | `draft`, `feedback`, `approved`                                      | `approved`       | User approval is durable before the Readiness Gate runs.                                   |
| `readiness_passed`        | `approved`                                                           | `ready_for_work` | FEATURE Plans pass without an LLM call; PROJECT Plans pass after valid Slicer Tasks exist. |
| `execution_started`       | `ready_for_work`                                                     | `in_progress`    | Captures `executionBaselineTree` before work begins.                                       |
| `execution_failed`        | `in_progress`                                                        | `failed`         | Sets `failureReason` and `failedAt` when a reason is available.                            |
| `implementation_finished` | `in_progress`                                                        | `implemented`    | Sets `implementedAt`; Workflow Validation still needs to run.                              |
| `validation_failed`       | `implemented`                                                        | `implemented`    | Keeps implemented status and sets `failureReason`.                                         |
| `validation_passed`       | `implemented`                                                        | `verified`       | Sets `verifiedAt` and clears stale failure detail.                                         |
| `recovery_continue`       | `in_progress`, `failed`                                              | `ready_for_work` | Records that recovery will continue from the current worktree.                             |
| `recovery_reset`          | `in_progress`, `failed`, `implemented`                               | `ready_for_work` | Records that recovery restored the execution baseline tree before retrying.                |
| `review_reopened`         | `ready_for_work`, `in_progress`, `failed`, `implemented`, `verified` | `feedback`       | The user chose to revise the Plan instead of continuing execution.                         |

## Readiness Gate

The Readiness Gate is classification-aware.

For FEATURE Plans, the gate does not call an LLM. It promotes `approved` to `ready_for_work`.

For PROJECT Plans, the gate ensures a parseable Tasks table exists. If Tasks are missing, it runs Slicer. If Slicer
fails or produces invalid Tasks, the Plan stays `approved` and records no executable status.

## Workflow Validation

Workflow Validation applies only to FEATURE and PROJECT Plans. It promotes `implemented` to `verified` only after local
verification and semantic review pass.

For FEATURE and PROJECT Plans, the workflow diff must contain implementation changes. An empty scoped diff, or a diff
that only changes Plan documents under `plans/`, is a validation failure. QUICK_FIX workflows are operational and are
not saved as executable Plans, so the Operator is responsible for any needed self-verification before calling
`task_completed`.

## Front Matter Fields

`status`: Current Plan Status.

`failureReason`: Optional concise reason for `failed` status or an `implemented` Plan whose validation failed.

`failedAt`: Timestamp set when execution fails before implementation finishes.

`implementedAt`: Timestamp set when execution work finishes.

`verifiedAt`: Timestamp set when Workflow Validation passes.

`executionBaselineTree`: Git tree captured at `execution_started`.

## Recovery

Loading an `in_progress` Plan means Harns cannot know whether execution succeeded, failed, or partially changed the
worktree. The recovery menu should offer:

- Inspect and report current state
- Continue execution from the current worktree
- Reset to the execution baseline tree and start over
- Re-open for review

Resetting to the execution baseline tree restores the worktree snapshot captured when execution started. The caller must
perform that restore before recording `recovery_reset`. The confirmation must clearly state that unrelated changes made
after that snapshot will be lost. Future isolated execution trees may make this safer, but current recovery is
baseline-tree based.

Loading a `failed` Plan should offer the same recovery options except that the failure reason can be shown before the
menu.

Loading an `implemented` Plan should favor validation recovery: retry Workflow Validation, inspect/report, reset to the
execution baseline tree, or re-open for review. Retried Workflow Validation must rehydrate `executionBaselineTree` so
the semantic review diff is scoped to the original execution attempt rather than unrelated local changes.

## Invariants

- `ready_for_work` is the only executable status.
- `approved` is durable but not executable.
- `failed` only occurs after work started from `ready_for_work`.
- `implemented` means implementation finished, even if validation later fails.
- FEATURE and PROJECT validation cannot pass with an empty or Plan-document-only workflow diff.
- `verified` is the terminal success status.
- Workflow code should record Plan Events instead of directly mutating Plan Status.
