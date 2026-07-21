---
planId: "9e0b3f7b-fd05-40ea-aef2-870f48cce594"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Change worktree-backed plan completion so the validation_passed lifecycle update is written inside the execution worktree before merge-back, causing verified plan metadata to be committed and merged with implementation changes instead of dirtying the primary checkout afterward. Cover both normal validation merge-back and manual merge recovery, including merge-failure/retry ordering and regression tests."
affectedPaths:
    - "src/shared/workflow/validation.js"
    - "src/cmd/load-plan/index.js"
    - "src/shared/workflow/validation.test.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
frontend: false
createdAt: "2026-07-09T17:11:20-04:00"
updatedAt: "2026-07-17T04:40:41.214Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-10T14:01:22.696Z"
workRecord:
    status: "generated"
    recordId: "2844dab0-71fe-42ba-a274-505498384d11"
    path: "docs/work-records/2026-07-17-merge-verified-plan-metadata-with-worktree-changes.md"
    lastAttemptAt: "2026-07-17T04:40:29.671Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "merge verified plan metadata"
---

# Merge Verified Plan Metadata with Worktree Changes

## Context

For worktree-backed FEATURE execution, Workflow Validation currently merges the execution branch first and then records
the `validation_passed` Plan Event against the primary project root. That post-merge Front Matter write changes the Plan
Status to `verified` but leaves the Plan file uncommitted in the primary checkout. The manual merge recovery path in
`wld load-plan` has the same ordering.

The verified Plan Front Matter should instead be staged in the execution worktree immediately before merge-back. The
existing `mergeExecutionWorktree` boundary commits dirty execution-worktree files before merging, so the Plan file can
travel in the same commit/merge as the validated implementation. This handoff must also account for the primary Plan
file already containing uncommitted `execution_started` and `implementation_finished` lifecycle updates: copy that
canonical active-execution state into the worktree, finalize it there, and temporarily return the primary path to its
checked-in state so Git can merge the branch version rather than refusing an overlapping local change. The primary
checkout only receives `verified` through a successful merge.

## Objective

Make successful worktree-backed validation and manual merge recovery deliver the `validation_passed` Plan Lifecycle
update through the execution branch, leaving the primary checkout clean after merge-back. Preserve in-place/non-worktree
behavior, cleanup settings, human-review evidence, parent Epic advancement, and merge-failure recovery semantics.

## Approach

Add a focused Plan Lifecycle helper that synchronizes the primary Plan's current Front Matter into its execution
worktree and records `validation_passed` there. Make the helper safe to call again when that worktree's Plan is already
`verified`. Pair it with a narrow worktree merge handoff that snapshots and cleans the primary Plan path only after the
verified worktree version is ready, restores the snapshot if merge-back fails, and lets the successful merge supply the
new primary file. Use the same flow for normal Workflow Validation and manual merge recovery. Retain the existing direct
primary-root event write for non-worktree execution.

The idempotent staging and rollback are both required: a newly created execution worktree predates `execution_started`,
while a failed merge may leave the execution branch containing the finalized verified Plan. Retries must preserve that
staged verification timestamp, and failures must keep the primary Plan's implemented/recovery state available rather
than losing lifecycle metadata while cleaning the path for Git.

## Files to Modify

- `src/shared/workflow/plan-lifecycle.js` — synchronize current primary Front Matter into the worktree and expose an
  idempotent execution-worktree `validation_passed` recorder while retaining strict lifecycle validation.
- `src/shared/workflow/plan-lifecycle.test.js` — cover initial synchronization/staging, retry no-op behavior, metadata
  preservation, parent Epic updates, and invalid source states.
- `src/shared/workflow/validation.js` — stage verified Plan Front Matter in `executionCwd`, hand off the dirty primary
  Plan path around merge-back, and avoid a post-merge primary write.
- `src/shared/workflow/validation.test.js` — regress normal success, merge failure/rollback/retry, cleanup-disabled
  metadata, non-worktree behavior, and primary-checkout cleanliness.
- `src/shared/worktree.js` — provide the narrow snapshot/clean/restore mechanics needed to hand an allowed dirty Plan
  path to its execution branch and ensure target-plan alignment does not overwrite the finalized version.
- `src/shared/worktree.test.js` — cover tracked and untracked primary Plan paths, successful handoff, rollback after
  merge failure, and target-branch alignment.
- `src/cmd/load-plan/index.js` — apply the same staging and primary-path handoff during manual merge recovery.
- `src/cmd/load-plan/index.test.js` — verify manual recovery uses the worktree path before merging, restores primary
  metadata on failure, and handles an already-staged verified Plan idempotently.
- `docs/plan-lifecycle.md` — document staging, primary-path handoff, rollback, and the point at which `verified` becomes
  canonical.

## Reuse Opportunities

- `src/shared/workflow/plan-lifecycle.js` — reuse `recordPlanEvent`, `loadPlan`, `updatePlanFrontMatter`,
  `buildPlanEventUpdates`, and existing parent Epic advancement instead of editing YAML directly.
- `src/shared/worktree.js` — extend the existing `mergeExecutionWorktree`, `commitDirtyWorktreeState`, and
  `alignPlanFilesWithMergeTarget` boundaries rather than adding shell logic to command/workflow callers.
- `src/shared/workflow/validation.js` — retain the existing `executionCwd`/`projectRoot` split, worktree cleanup
  handling, merge verification, metrics, and merge-repair loop.
- `src/cmd/load-plan/index.js` — reuse resolved `RecoveryWorktreeContext.path`, cleanup policy, and existing test
  dependency-injection conventions.
- Existing Deno test fixtures and `savePlan`/`loadPlan` helpers — create deterministic Plan Lifecycle and temporary Git
  worktree regression coverage.

## Implementation Steps

- [ ] Add an exported, JSDoc-typed Plan Lifecycle helper that loads the canonical Plan from `projectRoot`, checks the
      execution-worktree copy, synchronizes the canonical active-execution Front Matter into that copy, and records
      `validation_passed` there from canonical `implemented` state.
- [ ] Make worktree staging idempotent: if the execution copy is already `verified`, return it unchanged so merge
      retries/manual recovery preserve `verifiedAt`; reject missing Plans and unsafe canonical statuses rather than
      bypassing lifecycle rules.
- [ ] Preserve all final lifecycle details through staging, including cleanup-driven worktree-field clearing, retained
      `worktreeStatus: merged` when cleanup is disabled, implementation/human-review timestamps, failure cleanup, custom
      Front Matter, and child-to-parent Epic advancement in the execution branch.
- [ ] Add a worktree utility that snapshots the primary Plan path (including tracked-vs-untracked existence),
      restores/removes it to the current checkout's committed state for merge, and can restore the exact snapshot after
      a failed/refused merge. Do not broaden this into a generic cleanup of unrelated dirty paths.
- [ ] Adjust merge preparation/alignment ordering so `alignPlanFilesWithMergeTarget` cannot replace a finalized verified
      Plan after staging; if the target has advanced, base the finalized Plan on current target/canonical metadata or
      fail safely instead of silently dropping lifecycle fields.
- [ ] In `runValidationLoop`, stage verification in `executionCwd`, prepare the primary Plan path, then call
      `mergeExecutionWorktree`; on failure restore the primary snapshot before recording
      `worktree_merge_failed`/validation recovery metadata, and on success leave the merged Plan file as the only
      primary copy.
- [ ] Remove the post-merge `projectRoot` `validation_passed` write for worktree-backed runs, but keep the direct
      primary-root event path for executions without a worktree branch.
- [ ] Preserve merge verification, registry updates, cleanup, metrics, and repair-loop behavior after merge-back. A
      failed merge must leave the primary Plan non-verified/recoverable while the execution branch retains the staged
      verified file for retry.
- [ ] Apply the same stage/clean/merge/rollback sequence in manual merge recovery, supporting both legacy worktrees
      without staged lifecycle updates and newer failed-merge worktrees already containing `verified`.
- [ ] Update dependency injection and JSDoc typedefs in Workflow Validation and `load-plan` so tests can exercise the
      staging and handoff seams while keeping all executable code pure JavaScript.
- [ ] Add focused Plan Lifecycle tests for canonical-to-worktree synchronization, first-write and idempotent retry
      behavior, stable `verifiedAt`, custom metadata preservation, parent Epic advancement, and invalid source states.
- [ ] Add worktree tests for tracked modified and untracked primary Plan files, successful clean handoff, exact rollback
      on merge failure, and target alignment that retains finalized Plan metadata.
- [ ] Add Workflow Validation regression coverage using a temporary Git repository: prove the target Plan is `verified`,
      the merge history contains the Front Matter update, and `git status --porcelain` in the primary checkout is clean
      after success; retain failure/retry and non-worktree checks.
- [ ] Update manual recovery tests to prove the worktree root is used, failure restores primary recovery metadata, an
      already-verified worktree does not duplicate the transition, and cleanup/registry actions occur only after merge
      success.
- [ ] Revise Plan Lifecycle documentation to distinguish branch-local staging from canonical target state and describe
      rollback when merge-back fails.

## Verification Plan

- Automated:
  `deno test -A src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/validation.test.js src/shared/worktree.test.js src/cmd/load-plan/index.test.js`
- Automated: `deno task check`
- Automated: `deno task lint && deno task fmt:check`
- Automated: `deno task test` (full regression suite)
- Behavioral Git fixture: execute a worktree-backed validation success against a temporary repository; confirm the
  target Plan loads as `verified`, the verification metadata is included in merged history, and the primary checkout has
  no uncommitted Plan-file change.
- Behavioral failure/retry fixture: force the first merge to fail after staging; confirm the target Plan is not
  `verified` and the primary working file is restored to its pre-merge implemented/recovery state, then
  retry/manual-merge the same execution branch and confirm the original staged metadata merges without a duplicate
  lifecycle transition.
- Non-worktree check: complete in-place validation and confirm the Plan is still updated directly in the project root.

## Edge Cases & Considerations

- A staged worktree Plan may be `verified` before merge-back, but that branch-local state is not canonical; the primary
  snapshot/target branch remains `implemented`/recoverable until the merge succeeds.
- The execution worktree is created before `execution_started`, so its Plan copy may be stale or absent. Staging must
  start from the primary Plan's current content/Front Matter rather than assuming the worktree already says
  `implemented`.
- Merge retries and manual recovery must be idempotent because the first failed attempt may already have committed the
  verified Plan file on the execution branch.
- Cleaning the primary Plan path is transactional: never discard unrelated Plan edits, and restore the exact tracked or
  untracked pre-merge content before recording failure metadata if merge-back does not complete.
- With `cleanupMergedWorktrees: false`, the merged Plan must retain worktree pointers and `worktreeStatus: merged`; with
  cleanup enabled, those fields must be cleared in the staged Front Matter before merge.
- Child FEATURE verification can also advance its parent Epic. That parent Plan update must be made in the same
  execution worktree so it is included in merge-back rather than dirtying the primary checkout.
- Registry and lock files remain primary-root runtime state and must not be merged from the execution branch.
- The current working tree contains unrelated uncommitted edits in both `src/shared/workflow/validation.js` and
  `src/cmd/load-plan/index.js`; execution should not start until those overlapping changes are committed, stashed, or
  otherwise reconciled so the new worktree is based on the intended source and does not overwrite active work.
