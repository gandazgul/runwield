# Plan Lifecycle

Plan status is the durable state machine for saved Plans. Workflow code records facts as Plan Events, and the Plan
Lifecycle decides the next status and front matter updates.

Before execution starts, Plan lifecycle metadata is canonical in the target project's Plan file. Once RunWield activates
an execution worktree, that worktree's Plan file is authoritative for the attempt through execution, recovery,
validation, and publication. The corresponding file in the user's checkout may remain behind and must never be used to
move the active attempt backward. Plan Markdown stores the definition, lifecycle status, and human-facing history. The
controller stores execution mode, validation checkpoints and counters, review decisions, and delivery proof in
`.wld/controller/plans/<planId>.json`. The worktree registry owns attempt identity, path, branch, baseline, and
publication state. These facts are not copied into Plan Front Matter and are never compared against obsolete copies
there.

Every PROJECT Plan is an Epic container. PROJECT Plans are decomposed interactively by the Slicer into child FEATURE
Plans under `docs/plans/<epic-name>/` and are not executed as implementation work themselves. Child FEATURE Plans point
back to the Epic with `parentPlan` and may list sibling `dependencies`.

## Statuses

`draft`: A Plan exists but has not completed a Review Loop.

`feedback`: The Review Loop returned user feedback, or the planning agent was interrupted while handling feedback.

`approved`: The Review Loop ended with user approval, but pre-execution preparation may still be unfinished.

`ready_for_decomposition`: An Epic PROJECT Plan has been approved and can be opened by the Slicer. This is not an
executable status.

`ready_for_work`: The executable status for FEATURE Plans. For a PROJECT Epic, it means decomposition has been finalized
and child FEATURE Plans can be selected; the Epic itself is still a container, not executable implementation work.

`in_progress`: Execution has started. For executable plans, implementation work runs in the recorded execution worktree.

`failed`: Execution started from `ready_for_work` but implementation work did not finish. The worktree is left in place
when one is recorded.

`implemented`: Implementation work finished in the execution worktree and is ready for the next Mechanical Validation
phase. CI failure or semantic/human feedback returns here so the next validation call restarts at CI with durable retry
counters.

`validated_ci`: Mechanical Validation passed for the current implementation. The next Workflow Validation call resumes
at Semantic Code Review and must not rerun CI first.

`validated_reviewer`: Semantic Code Review passed for the current implementation. The next Workflow Validation call
handles durable Local Human Code Review metadata and publication; only this status may produce `validation_passed`.

`validated`: Workflow Validation succeeded. For worktree-backed execution this status is committed to the execution
branch before publication begins and never changes again. The separate publication attempt record proves whether those
validated commits reached the target branch and whether cleanup finished.

`verified`: A retained terminal status for non-worktree and older lifecycle outcomes. For an Epic PROJECT Plan,
`verified` may also mean the user marked the Epic "done enough for now"; remaining child FEATURE Plans stay visible and
loadable. New worktree-backed Planned Changes finish validation at `validated`.

`closed_without_verification`: A terminal manual closure outcome. The user intentionally ended the Plan without Workflow
Validation passing. It is distinct from `verified` and does not set `verifiedAt`, human review metadata, or Epic
done-enough metadata.

`on_hold`: A paused-but-resumable Plan. Holding preserves the previous status in `heldFromStatus` plus hold metadata so
callers can run a Resume Check before restoring the Plan. Holding a Plan mutates only that Plan file; Epic/child
visibility and blocking are listing/UI behavior.

## Physical Archival

Archival is not a Plan Status. Archived Plans keep their last durable lifecycle status and move on disk from
`docs/plans/` to `docs/plans/archived/`, preserving nested relative paths. Normal active listings hide
`docs/plans/archived/`, while explicit archive commands can list, read, and restore those plaintext markdown files.

`verified`, `user_verified`, and `closed_without_verification` are terminal outcomes that can be archived without
`--force`. Other statuses, including `on_hold`, require `--force` because they may represent unfinished or resumable
work. Even with `--force`, Plans with recoverable worktree states (`active`, `completed`, `execution_failed`,
`validation_failed`, or `validated`) remain blocked until the user resolves or abandons that worktree state through a
dedicated flow.

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
| `validated`         | Validation passed; the nested publication attempt owns integration, publication, and cleanup. |
| `abandoned`         | The user chose to abandon/delete the execution worktree instead of continuing or merging it.  |

## Events

| Event                                | From                                                                                            | To                            | Notes                                                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `review_feedback`                    | `draft`, `feedback`, `approved`                                                                 | `feedback`                    | The user returned Feedback from Plannotator.                                                                                                                                                                                   |
| `review_approved`                    | `draft`, `feedback`, `approved`                                                                 | `approved`                    | User approval is durable before the Readiness Gate runs.                                                                                                                                                                       |
| `epic_readiness_passed`              | `approved`                                                                                      | `ready_for_decomposition`     | PROJECT Epics pass approval into decomposition; they are not executable yet.                                                                                                                                                   |
| `decomposition_finalized`            | `approved`, `ready_for_decomposition`                                                           | `ready_for_work`              | Slicer finalized at least one child FEATURE Plan, so the Epic can offer child selection.                                                                                                                                       |
| `readiness_passed`                   | `approved`                                                                                      | `ready_for_work`              | FEATURE Plans pass without an LLM call.                                                                                                                                                                                        |
| `execution_started`                  | `ready_for_work`                                                                                | `in_progress`                 | Captures `executionBaselineTree` and records active worktree metadata before executable Plan work begins.                                                                                                                      |
| `execution_failed`                   | `in_progress`                                                                                   | `failed`                      | Sets `failureReason`, `failedAt`, and `worktreeStatus: "execution_failed"` when a reason is available.                                                                                                                         |
| `implementation_finished`            | `in_progress`                                                                                   | `implemented`                 | Sets `implementedAt` and `worktreeStatus: "completed"`; Workflow Validation still needs to run.                                                                                                                                |
| `mechanical_validation_failed`       | `implemented`                                                                                   | `implemented`                 | Increments `validationCiAttempts`, resets semantic rounds, records CI failure context, and returns for a later validation call.                                                                                                |
| `mechanical_validation_passed`       | `implemented`                                                                                   | `validated_ci`                | Resets `validationCiAttempts`, clears CI failure state, and returns before Semantic Code Review.                                                                                                                               |
| `semantic_review_feedback`           | `validated_ci`                                                                                  | `implemented`                 | Increments `validationSemanticRounds`, resets CI attempts, dispatches/records semantic repair context, and returns so fresh CI runs next.                                                                                      |
| `semantic_review_passed`             | `validated_ci`                                                                                  | `validated_reviewer`          | Records the semantic approval boundary; terminal verification and publication cannot bypass it.                                                                                                                                |
| `validation_failed`                  | `implemented`, `validated_ci`, `validated_reviewer`                                             | `implemented`                 | Records terminal failed validation-attempt metadata, sets `worktreeStatus: "validation_failed"` where applicable, and resets phase counters on implemented re-entry.                                                           |
| `validation_passed`                  | `validated_reviewer`                                                                            | `validated`                   | Records successful validation and delivery evidence in the authoritative execution Plan before publication starts. Publication progress never rewrites this status.                                                            |
| `recovery_continue`                  | `in_progress`, `failed`                                                                         | `ready_for_work`              | Records the retry in the authoritative execution Plan before the normal execution-start transition returns it to `in_progress`; the primary-checkout copy is not read or rewritten.                                            |
| `recovery_reset`                     | `in_progress`, `failed`, `implemented`                                                          | `ready_for_work`              | Records that recovery abandoned the current attempt before retrying.                                                                                                                                                           |
| `review_reopened`                    | `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`, `implemented`, `verified` | `feedback`                    | The user chose to revise the Plan instead of continuing execution.                                                                                                                                                             |
| `epic_done_enough`                   | `ready_for_work`, `verified`                                                                    | `verified`                    | The user marked an Epic complete enough for now; child FEATURE Plans remain visible and loadable.                                                                                                                              |
| `manual_status_change`               | Board-safe non-terminal statuses                                                                | Dynamic target                | User-driven board movement among `draft`, `feedback`, `approved`, `ready_for_work`, `in_progress`, `implemented`; `ready_for_decomposition` is included only for Epics. Records an event instead of editing `status` directly. |
| `manual_closed_without_verification` | Board-safe non-terminal statuses                                                                | `closed_without_verification` | Terminal manual closure without Workflow Validation; does not set `verifiedAt` or review metadata.                                                                                                                             |
| `manual_user_verified`               | Board-safe non-terminal statuses                                                                | `user_verified`               | Terminal user attestation with required `userVerificationNote`; sets `userVerifiedAt`, never sets `verifiedAt`, and preserves failure, execution, review, Delivery Evidence, and worktree facts as history.                    |
| `plan_held`                          | Any non-terminal, non-closed status                                                             | `on_hold`                     | Records `heldFromStatus`, `heldAt`, optional `holdReason`, and optional `holdStalenessBaseline`; preserves recovery/worktree metadata.                                                                                         |
| `hold_resumed`                       | `on_hold`                                                                                       | `heldFromStatus`              | Caller must run the Resume Check first and provide/read the held-from status; clears hold metadata.                                                                                                                            |
| `hold_reset_to_draft`                | `on_hold`                                                                                       | `draft`                       | Clears hold and execution/recovery/validation fields while preserving identity/context fields and Plan body.                                                                                                                   |

## Transaction Inventory

Every lifecycle writer must fit one of these transition inventory rows. The table is intentionally operational: it names
caller inputs, locked resources, owned effects, success proof, rollback limit, and recovery action.

| Event/writer                                                | Required inputs              | Locked resources                                         | Owned effects                                           | Success proof                            | Rollback limit                             | Recovery action                |
| ----------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------- | ------------------------------------------ | ------------------------------ |
| `review_feedback`                                           | Review feedback payload      | Plan                                                     | Feedback metadata                                       | Status `feedback`                        | None                                       | Review retry                   |
| `review_approved`                                           | Approved Plan markdown       | Plan                                                     | Approval metadata                                       | Status `approved`                        | None                                       | Review retry                   |
| `readiness_passed`                                          | FEATURE approved Plan        | Plan                                                     | Ready-for-work metadata                                 | Status `ready_for_work`                  | None                                       | Review reopen                  |
| `epic_readiness_passed`                                     | PROJECT approved Plan        | Plan                                                     | Ready-for-decomposition metadata                        | Status `ready_for_decomposition`         | None                                       | Review reopen                  |
| `decomposition_finalized`                                   | Slicer child Plan set        | Catalog, Epic, child Plans                               | Child drafts and Epic ready state                       | Children persisted                       | CAS-written child drafts only              | Slicer retry                   |
| `execution_started` / `execution_preparation`               | Worktree creation facts      | Catalog, Plan, worktree registry, target ref             | Plan `in_progress`, registry attempt, optional worktree | Baseline/worktree facts                  | Owned new worktree and registry entry only | Load-plan recovery             |
| `execution_failed`                                          | Engineer failure report      | Plan, attempt                                            | Failed status and reason                                | Failure reason/timestamp                 | None                                       | Recovery reset/continue        |
| `implementation_finished` / `implementation_checkpoint`     | Checkpoint commit            | Plan, attempt                                            | Implemented status and completed attempt                | Implementation commit                    | None                                       | Validation retry               |
| `validation_failed`                                         | CI/review failure proof      | Catalog, Plan, attempt, target ref                       | Validation failure metadata                             | Failure reason                           | None                                       | Validation retry               |
| `validation_passed`                                         | Delivery evidence            | Catalog, Plan, attempt, target ref                       | Verified metadata and publication evidence              | Delivery Evidence and target proof       | Primary Plan snapshot restore only         | Publication recovery           |
| `worktree_merge_failed` / `validation_merge_failed`         | Merge failure facts          | Catalog, Plan, attempt, target ref                       | Merge-conflict metadata                                 | Merge failure kind                       | Primary Plan snapshot restore only         | Merge repair                   |
| `direct_delivery_publication`                               | Publication proof            | Catalog, Plan, parent/sibling Plans, attempt, target ref | Target movement proof and registry settlement           | Target ancestry plus sibling eligibility | Primary Plan snapshot restore only         | Transition recovery            |
| `recovery_continue`                                         | Resume decision              | Plan, attempt                                            | Ready-for-work retry metadata                           | Current attempt retained                 | None                                       | Recovery retry                 |
| `recovery_reset` / `recovery_recreate` / `recovery_abandon` | Recovery action              | Plan, attempt                                            | Attempt reset/recreate/abandon metadata                 | Exact attempt identity                   | Owned registry/worktree cleanup only       | Recovery retry/manual recovery |
| `review_reopened`                                           | Reopen decision              | Plan                                                     | Feedback metadata                                       | Status `feedback`                        | None                                       | Review loop                    |
| `epic_done_enough`                                          | Done-enough attestation      | Catalog, Epic, sibling Plans                             | Epic verified metadata                                  | Done-enough timestamp/summary            | None                                       | Manual reopen                  |
| `manual_status_change`                                      | Workspace lifecycle action   | Plan                                                     | Board-safe status metadata                              | Requested status/timestamp               | None                                       | Workspace retry                |
| `manual_closed_without_verification`                        | Closure reason               | Plan                                                     | Terminal closure metadata                               | Closure reason/timestamp                 | None                                       | Manual reopen                  |
| `manual_user_verified`                                      | User attestation             | Plan and parent/siblings when child                      | User-verified metadata                                  | Attestation note/timestamp               | None                                       | Manual reopen                  |
| `plan_held`                                                 | Hold reason/baseline         | Plan                                                     | Hold metadata                                           | `heldFromStatus` and `heldAt`            | None                                       | Resume/reset hold              |
| `hold_resumed`                                              | Resume Check result          | Plan                                                     | Held status restored                                    | Hold fields cleared                      | None                                       | Hold reset                     |
| `hold_reset_to_draft`                                       | Reset hold decision          | Plan                                                     | Draft reset metadata                                    | Hold/execution fields cleared            | None                                       | Review loop                    |
| `plan_review_write`                                         | Review markdown/front matter | Plan                                                     | Plan review write                                       | Written revision                         | None                                       | Review retry                   |
| `plan_front_matter`                                         | Front Matter updates         | Plan                                                     | Metadata update                                         | CAS revision                             | None                                       | Caller retry                   |
| `plan_archive` / `plan_restore`                             | Archive/restore action       | Catalog, Plan                                            | Physical move metadata                                  | Archive/active path                      | Rename CAS only                            | Restore/archive retry          |

The matching checked-in table in `src/shared/workflow/state-transition.test.js` fails if a row lacks inputs, locks,
effects, proof, rollback limits, or recovery actions.

## Manual Board Movement and Closure

Board actions are lifecycle events, not direct Front Matter edits. Generic board movement uses `manual_status_change`
and may move both directions only within the safe board set: `draft`, `feedback`, `approved`, `ready_for_work`,
`in_progress`, and `implemented`. For PROJECT Epics, `ready_for_decomposition` is also board-safe.

Generic board movement cannot enter or leave `failed`, cannot produce `verified` or `user_verified`, cannot enter
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
`classification`, `complexity`, `summary`, `affectedPaths`, `createdAt`, `origin`, `parentPlan`, and `dependencies`.

## Readiness Gate

The Readiness Gate is classification-aware.

For FEATURE Plans, the gate does not call an LLM. It promotes `approved` to `ready_for_work`.

For PROJECT Epics, the gate records `epic_readiness_passed` and promotes `approved` to `ready_for_decomposition`. The
Slicer then runs as an interactive decomposition agent. When the user explicitly finalizes the decomposition seams, the
Slicer materializes child FEATURE Plans as `draft`, records `decomposition_finalized`, and the Epic becomes
`ready_for_work` for child selection. That status does not mean the Epic itself can be executed, and draft child FEATURE
Plans still go through Planner/Plannotator review before execution.

## Execution Worktrees

Before executable implementation starts, RunWield creates or reuses a git worktree for the Plan and records its attempt
metadata in that worktree's Plan file and `.wld/worktrees.json`. From that point forward, Agent sessions, built-in file
tools, custom edit tools, lifecycle transitions, local CI, workflow diffs, reviewer sessions, and repair sessions all
use the execution worktree. RunWield does not use `Deno.chdir()` for this because workflow operations stay scoped to
their explicit execution context.

The user's primary checkout remains the discovery root for settings and local runtime files, but its copy of an active
Plan is only a possibly stale checkout. `wld load-plan` resolves a live attempt through its recorded worktree evidence
and reads lifecycle truth there. It must not compare the execution status with the primary copy, synchronize the active
Plan backward, or dirty the user's checkout. Registry and lock files remain ignored local runtime state.

Each worktree-backed execution must also contain the canonical Plan Markdown at `docs/plans/<plan-name>.md` before the
execution baseline is captured. If the execution worktree was created from a commit that did not yet contain that Plan
file, RunWield copies the full primary-checkout Plan into the absent execution path first; the copied Plan then becomes
part of the baseline given to implementation and validation. After recording `execution_started`, RunWield creates a
preparation commit on the execution branch containing the materialized Plan and any other RunWield-owned preparation
files. The target `baseCommit` remains unchanged and `executionBaselineTree` remains the pre-implementation comparison
tree; the preparation commit exists so the Plan is tracked, durable Git evidence before the execution Agent begins.

Before accepting `task_completed`, RunWield verifies the execution Plan again. If the Agent deleted it, RunWield
restores the exact Plan from `executionBaselineTree` before recording `implementation_finished` and checkpointing the
work. An existing malformed, non-regular, or conflicting Plan is preserved and blocks completion rather than being
overwritten.

During Workflow Validation or `wld load-plan` recovery, a missing execution Plan file is repairable only after RunWield
proves the recorded registry entry, linked worktree path, repository common directory, checked-out branch, target
branch, and baseline tree all match the primary Plan identity. When those proofs pass and only
`docs/plans/<plan-name>.md` is absent, RunWield restores it from the canonical Project Plan, emits a non-error notice
naming the relative path, and continues validation. Existing evidence is never overwritten: malformed Front Matter,
unreadable files, symlinks, directories or other non-regular paths, symlinked parents, and conflicting Plan IDs all
block with an exact path and reason so the user can inspect or recover the worktree manually.

## Workflow Validation and Merge-Back

Workflow Validation applies only to executable Plan work. It advances through durable Plan Statuses one phase per call:
`implemented` runs Mechanical Validation, `validated_ci` runs Semantic Code Review, and `validated_reviewer` handles
Local Human Code Review plus publication. Operational retries, operational pauses, and fatal operational halts do not
advance or reset Plan Status. They preserve the last valid status so a later run resumes from the same phase. Workflow
Validation promotes worktree-backed Plans to `validated` after local validation, semantic review, any configured human
code review gate, and delivery evidence succeed. Publication then advances independently through its proof-bearing
registry record. Worktree-backed FEATURE Plans fail closed when the execution mode or worktree publication context is
unknown; missing volatile Session state is not treated as proof that validation should run in the primary checkout.

Normal owner-facing progress uses shorter labels for these same phases. Mechanical Validation appears as **tests and
CI**. Semantic Code Review appears as **AI code review**. Local Human Code Review appears as **human review**. Raw Plan
Status values stay in technical details and diagnostics.

For worktree-backed plans:

1. Implementation runs in the execution worktree.
2. Before `implementation_finished` can record Plan Status `implemented` and worktree status `completed`, RunWield
   checkpoints every tracked and untracked execution-worktree change in a branch commit and requires the checkout to be
   clean. The controller reads the attempt baseline and worktree identity from the registry, never from Plan metadata. A
   stale Plan copy cannot reset that state. A missing execution context or failed checkpoint leaves the Plan
   `in_progress` and the worktree recoverable. The registry keeps the immutable worktree creation tree separate from the
   execution-attempt baseline, which may advance when a failed worktree is reused. Completion does not merge into the
   primary checkout.
3. Workflow Validation reads `validationCiAttempts` and `validationSemanticRounds` from the current controller record,
   runs exactly one lifecycle phase for the current Plan Status, records at most one Plan Event for that phase, and
   returns. Repeated calls resume from durable status instead of an in-memory validation loop.
4. The `validated_ci` phase computes the workflow diff and starts semantic review rounds in the execution worktree.
   Review narrows as rounds progress: rounds one and two review the implementation against the whole Plan, and rounds
   three and above only verify the open findings and check the latest repair for regressions. Two full sweeps give a
   requirement overlooked in round one a second independent look; narrowing after that is what lets the loop terminate
   instead of rediscovering the implementation indefinitely.

   The Reviewer never receives an inlined diff — it reads changes through the bounded `review_diff` tool in every round,
   so there is one delivery path regardless of size. A decision reached without inspecting the diff is not accepted.

   Findings carry stable identities in a Review Issue Ledger that lives for the attempt. Later rounds resolve items,
   keep them open, and append newly discovered ones; identities are never reused or renumbered. Code smells are reported
   as non-blocking advisories rather than as findings, so an accumulating maintainability backlog cannot stall the loop.
5. A rejection dispatches the Reviewer-Feedback Engineer, which repairs the open findings in a fresh isolated session
   seeded with the Plan, the findings, and diff access. It does not inherit the execution transcript, and it reports a
   per-item disposition that the next round independently verifies — a repair claim is evidence, never resolution.
6. After three automatic rounds without approval, RunWield stops and asks whether to run another verification round or
   open human code review now. There is no dead end: the work is never left with nowhere to go.
7. If `codereview` is `ask` or `always`, RunWield opens or offers Plannotator human code review after semantic review
   passes and before merge-back. The optional `guidedReview` setting can generate a Guided Review Explainer inside that
   already-open human review, but it does not create a Plan Status, Plan Event, or Front Matter field. Human feedback
   goes to the Reviewer-Feedback Engineer in the same fresh-session way, along with the annotations and images, and
   human review then reopens. Human review always sees the full workflow diff, never a repair-scoped one. Human approval
   reached through the round-limit escape hatch is authoritative and permits merge-back even though semantic review
   never approved; the record distinguishes that case.

   Once the change is in a human's hands the loop belongs to them: CI reruns and code review reopens after every
   feedback round, for as many rounds as they give, and automatic semantic rounds do not resume. **The only exits are
   approval or quitting the review.** Feedback never exhausts a budget, and the three-round semantic cap does not apply
   — it counts automatic rounds, not human ones. Interrupting and resuming mid-cycle returns to code review rather than
   restarting semantic review.
8. If validation fails, RunWield keeps Plan Status `implemented`, records `worktreeStatus: "validation_failed"`, and
   leaves the worktree for recovery.
9. If validation passes, RunWield checkpoints the implementation first. The resulting commit is the immutable
   implementation commit recorded in Delivery Evidence. It then records `validation_passed` only in the execution
   worktree, moving the Plan to `validated`, generates the Work Record there, and commits both. The Plan Front Matter is
   final at this point; publication does not add another status or delivery stamp.
10. RunWield assembles publication in a temporary clone, never in the user's primary checkout. It combines the latest
    configured upstream target with the validated execution branch, then pushes the assembled commit to the Plan's
    recorded target branch using a lease. It verifies the exact remote commit before reporting success.
11. Until remote verification succeeds, `.wld/worktrees.json` retains the execution attempt and its monotonic
    publication record: `candidate_sealed`, `artifacts_committed`, `target_integrated`, `target_published`,
    `publication_verified`, then `cleanup_complete`. Each phase carries the Git evidence needed to prove it. Any push
    failure annotates the current phase and leaves the implementation, validated Plan, Work Record, worktree, and branch
    intact for retry.
12. After remote verification, RunWield may remove the clean execution checkout and branch and then removes the registry
    entry. Operationally, a validated attempt is published when the remote contains its commit and no pending worktree
    entry remains. The Plan itself stays `validated`; it is not dirtied by a second `published` transition. RunWield
    tells the user to update any local checkout that still points at an older target commit.

Publication recovery is defined by [ADR-016](./adr/016-proof-bearing-publication-state-machine.md). RunWield does not
translate partial states from retired publication flows.

Human code review does not add a new primary Plan Status. While human review is pending, returning feedback, or
canceled, the Plan remains `implemented`. Final `validation_passed` metadata records whether human review was not
required, skipped, or approved. Manual recovery and legacy staged worktrees preserve canonical human-review mode,
decision, and timestamp evidence when no newer review result is supplied. RunWield clears stale human-review metadata
when execution starts again, when recovery resets a plan, or when a plan is re-opened for review.

After the push is remotely verified, registry updates, metrics, and cleanup are post-publication bookkeeping. Their
failures never rewrite the validated Plan. Inconclusive remote verification retains the worktree and registry entry.

For PROJECT Epics, child FEATURE Plans run their own Workflow Validation. The Epic can be marked done enough for now,
but it does not run a validation loop as if it were an implementation diff.

For executable FEATURE Plans, the workflow diff must contain implementation changes. An empty scoped diff, or a diff
that only changes Plan documents under `docs/plans/`, is a validation failure. OPERATION and QUICK_FIX are not saved as
executable Plans. OPERATION ends after Operator self-verification and `task_completed`. QUICK_FIX runs no-plan
Mechanical Validation after Engineer `task_completed`, without Plan lifecycle state.

## Front Matter Fields

Front Matter contains document and planning fields, not the workflow controller's working state. Optional fields are
omitted when unused; empty runtime placeholders are never written.

`planId`: Stable identity joining this document to its controller record.

`classification`, `workKind`, `complexity`, `affectedPaths`, `executionAgent`, and `collaborationRecommendation`:
Planning and execution policy. `targetBranch` names the actual branch selected for delivery, not a description or
`HEAD`. Once execution starts, the registry owns the selected attempt and its target; changing unrelated checkout
metadata does not retarget an active attempt.

`createdAt`, `origin`, `userVerifiedAt`, `userVerificationNote`, archive metadata, supersession links, and Epic
completion notes: durable human-facing history. Dev-server hints and child ordering remain planning metadata when
applicable.

There is no stored `summary`: lists and prompts derive it from the first paragraph of the Plan's `## Context` section.

`status`: Current Plan Status.

`parentPlan`: Child FEATURE pointer to the parent Epic plan name.

`dependencies`: Optional sibling FEATURE Plan identifiers that should be complete first. Loading a child FEATURE warns
when dependencies are missing or neither RunWield Verified nor User Verified, but the user may choose to proceed. User
Verified dependencies are satisfied but labeled distinctly.

`heldFromStatus`, `heldAt`, `holdReason`: the user's hold decision and the status to return to.

## Controller Fields

The following fields are controller state, **not Plan Front Matter**. Loaded workflow views join them with the document
for callers; serializers always remove them from Markdown. Existing documents are imported once, then any obsolete
runtime fields left in those files are ignored. Controller updates use their own revision and OS lock; checkpoint-only
updates do not change Plan bytes. Failed lifecycle transitions restore only writes they can prove they own.

`failureReason`: Optional concise reason for `failed` status, validation failure, or merge-back failure.

`failedAt`: Timestamp set when execution fails before implementation finishes.

`implementedAt`: Timestamp set when execution work finishes.

`verifiedAt`: Timestamp set when Workflow Validation passes and merge-back succeeds, or when an Epic is marked done
enough for now.

`humanReviewMode`: Human code review mode used for final validation: `none`, `ask`, or `always`.

`humanReviewDecision`: Human code review outcome included in final validation: `not_required`, `skipped`, or `approved`.
`changes_requested` is the one non-final value: the user read the diff and asked for changes. It makes the user the
owner of this Plan's review, so the repair round runs the tests and hands the diff straight back to them instead of
sweeping it with the Semantic Code Reviewer again.

`humanReviewedAt`: Timestamp set when a human code review approved final validation.

`executionMode`: Explicit execution publication mode. `worktree` means implementation must be validated and published
through a Git-backed execution worktree. `non_git_in_place` means validation ran against the primary checkout by an
explicit non-Git path. Missing mode is unknown for FEATURE validation, not an implicit primary-checkout fallback.

`deliveryEvidence`: Versioned proof recorded with `validation_passed`. Worktree evidence records
`mode: "worktree_merge"`, the sealed `executionCommit`, the concrete `targetBranch`, and `targetHeadBeforeMerge` so Git
ancestry can prove the delivered implementation and metadata reached the target. Non-Git evidence records only
`{ version: 1, mode: "non_git_in_place" }`; it must not contain absolute paths.

`executionBaselineTree`: Git tree captured in the execution worktree at `execution_started`.

`worktreeId`: Durable id of the matching `.wld/worktrees.json` registry entry.

`worktreePath`: Filesystem path to the linked execution worktree.

`worktreeBranch`: Git branch checked out in the execution worktree, usually under `worktree/`.

`worktreeStatus`: Worktree lifecycle state. See [Worktree Statuses](#worktree-statuses).

`holdStalenessBaseline`: Optional baseline used by caller-owned Resume Check logic before `hold_resumed`.

## Recovery

Loading an `in_progress`, `failed`, or `implemented` executable Plan starts Plan Recovery. For worktree-backed plans,
RunWield resolves worktree context from the controller registry, then reads the Plan in that worktree. Inspect/report
shows plan status, worktree status, path, branch, base commit/ref when available, git status, and changes since the
execution baseline.

Recovery actions are deliberately scoped to the execution worktree:

- **Continue execution from current worktree**: Rebuilds a missing registry entry when the Plan and Git attachment prove
  the same attempt, records the retry against the execution-worktree Plan, rehydrates active execution state, and
  resumes there. A stale primary-checkout Plan status is ignored.
- **Retry Workflow Validation**: For `implemented` plans, reruns validation in the recorded execution worktree and only
  merges after validation passes.
- **Merge worktree changes**: For worktree-backed `implemented` plans, attempts to merge the recorded worktree branch
  into the primary checkout. Merge failure records `worktreeStatus: "merge_conflict"` and leaves the worktree intact.
- **Restore worktree record and continue**: Rebuilds RunWield's missing worktree registry entry from imported recovery
  hints and `git worktree list` evidence when the recorded path, branch, and target branch still agree. It does not
  delete the worktree or reset the user's work.
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

`wld plans` shows Epic hierarchy for PROJECT Plans. Child FEATURE Plans are grouped under their parent Epic using
`parentPlan`, and Epics show verified/active/remaining/failed progress. Child FEATURE Plans whose `parentPlan` does not
match an existing Epic are shown as orphaned child plans.

`wld plans` also shows concise worktree state for plans with worktree metadata:

```text
Worktree: validation_failed (worktree/example-plan-1234abcd)
```

The parenthesized value is the recorded worktree branch when available, otherwise the path.

## Invariants

- `ready_for_work` is the executable status for FEATURE Plans.
- `ready_for_work` on a PROJECT Epic means child FEATURE selection is available, not that the Epic executes directly.
- `ready_for_decomposition` is not executable.
- `approved` is durable but not executable.
- `failed` only occurs after work started from `ready_for_work`.
- `implemented` means implementation finished in the execution worktree, even if validation or merge-back later fails.
- `verified` requires successful Workflow Validation and, for worktree-backed plans, successful merge-back, except for
  PROJECT Epics marked `done_enough`.
- `user_verified` is terminal user attestation and never implies RunWield Workflow Validation passed.
- `closed_without_verification` is terminal manual closure and never implies validation passed.
- `on_hold` is a pause state; resume/reset must clear hold metadata.
- Human code review is optional Workflow Validation metadata, not a separate Plan Status.
- Executable FEATURE validation cannot pass with an empty or Plan-document-only workflow diff.
- Workflow code should record Plan Events instead of directly mutating Plan Status.

## User Verified Plans

`user_verified` is a terminal Plan Status for outcomes the user personally verified outside RunWield Workflow
Validation. The canonical event is `manual_user_verified`; it requires a trimmed, non-empty `userVerificationNote` and
records `userVerifiedAt`. It does not set `verifiedAt`, synthesize Delivery Evidence, clean up worktrees, erase prior
`failureReason`, or relabel human review/validation history.

User Verified Plans satisfy child dependencies and Epic completion accounting, but reports must keep them separate from
proof-bearing RunWield `verified` Plans. A mixed Epic can advance when every child is either RunWield Verified with
mode-appropriate Delivery Evidence or User Verified. The manual action does not start automatic next-child execution.
Re-opening from `user_verified` returns to `feedback` and clears stale user attestation fields.

Canonical domain term follow-up: `User Verified Plan` should be added to `docs/domain-language.md` by Ideator/Init in a
separate context update; this feature intentionally leaves `docs/domain-language.md` and ADRs unchanged.

## Transactional lifecycle writes

Lifecycle-changing code must request one semantic transition instead of sequencing Plan writes, registry writes, Git
commands, and cleanup in the caller. The transition re-reads the canonical Plan, holds the same-Plan mutation lock while
it applies the change, writes through atomic Plan persistence, verifies the requested postconditions, and either
commits, rolls back, or leaves a recovery record under `.wld/plan-transitions/`.

The lock protects the logical transition, not just the final file rename. Different Plans may still execute at the same
time. Shared resources, such as a parent Epic, sibling set, target branch, or registry entry, are acquired only when
that transition depends on them. The worktree registry file itself is locked only for brief targeted read-modify-write
updates.

Malformed Front Matter is fail-closed. RunWield distinguishes a missing Plan from malformed YAML, preserves the original
bytes, blocks mutation, and reports the Plan path and parse error. Repair must be explicit; ordinary lifecycle updates
do not rebuild unknown or conflicted Front Matter.

Git-backed transitions record proof before and after worktree or branch operations. If Git state is uncertain after an
interruption, RunWield does not replay the command blindly. It either proves the already-completed outcome or asks the
user to inspect/retry/abandon the exact recorded worktree or branch.

Non-Git Projects remain supported. When a repository has no Git/VCS metadata and the user has allowed in-place FEATURE
execution, lifecycle transactions still protect Plan metadata, but Git worktree, branch, registry, and merge-back steps
are skipped. The FEATURE executes in the current checkout and validation records non-Git delivery evidence rather than
worktree merge evidence.

## Transaction boundary matrix

| Workflow action                     | Inputs                                                                     | Locked resources                                                                  | Durable effects                                                                                | Success proof                                                            | Rollback limit                                                                         | Recovery actions                                                                |
| ----------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Review approved/feedback            | Plan name, opened revision, reviewed markdown, decision                    | Plan lock; catalog lock when parent/child state can change                        | Reviewed Plan bytes and review lifecycle status are written in one revision-checked transition | New Plan revision contains both reviewed content and expected status     | Never overwrite a newer revision; stale review must reload                             | Reload review, inspect unresolved transition journal                            |
| Execution preparation               | Plan id/name, expected ready status, target branch or non-Git consent      | Plan lock, exact attempt id, registry file, target ref when Git exists            | Controller execution mode and registry attempt identity/baseline                               | Registry attempt matches actual Git identity and baseline                | If Git/registry facts are uncertain, do not delete by default                          | Retry prepare, inspect worktree, abandon explicit attempt                       |
| Implementation checkpoint           | Plan id/name, attempt id, execution report                                 | Plan lock and exact attempt lock                                                  | Attempt checkpoint and implemented/failed lifecycle metadata                                   | Registry attempt and Git checkpoint prove the implementation             | Do not roll back implementation files after checkpoint uncertainty                     | Resume implementation, reset attempt, inspect worktree                          |
| Validation passed / Direct Delivery | Child Plan, attempt id, delivery evidence, parent/siblings when applicable | Catalog, child Plan, parent Epic, complete sibling set, exact attempt, target ref | Child verified metadata, eligible parent advancement, publication evidence                     | Lifecycle status, controller delivery proof, and Git effects are settled | Final child and parent must settle together; uncertain publication remains recoverable | Retry validation publication, inspect target ref, recover/abandon exact attempt |
| Validation failed / retry           | Plan id/name, attempt id, failure reason                                   | Plan lock and exact attempt lock                                                  | Failure metadata preserving retryable worktree identity                                        | Controller failure saved; registered attempt remains retryable           | Do not discard worktree without explicit abandon/reset                                 | Retry validation, continue repair, abandon explicit attempt                     |
| Hold/resume/reset                   | Plan id/name, expected status, hold/resume data                            | Plan lock; exact attempt lock when attempt metadata is present                    | Held-from state or restored lifecycle state                                                    | Plan revision has expected status and hold fields                        | Stale caller state aborts before write                                                 | Resume with staleness confirmation, reset to draft                              |
| Archive/restore                     | Plan id/name, expected terminal/recoverable state                          | Catalog, Plan path, archived path, exact attempt when recoverable                 | Physical move plus archive/restore metadata                                                    | Active/archived path and Plan metadata agree                             | Existing target or malformed source aborts without overwrite                           | Restore, force archive after explicit confirmation                              |
| Doctor/repair                       | Plans, registry, journals, Git facts                                       | Registry lock only for proven metadata repair; no destructive lockless action     | Report issues; apply only mechanically proven safe repair                                      | Repair result is re-read and reported                                    | Missing paths/branches are not abandonment proof                                       | Inspect, retry, explicit abandon/delete with evidence                           |
