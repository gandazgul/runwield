---
planId: "a27652c4-f583-4618-8b9c-fc83c6f586a7"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Update worktree lifecycle to record the source branch in plan metadata and ensure merge-back targets that specific branch instead of the current primary checkout HEAD."
affectedPaths:
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.js"
    - "src/plan-store.js"
    - "src/shared/workflow/validation.js"
    - "src/cmd/load-plan/index.js"
    - "src/shared/worktree.test.js"
frontend: false
createdAt: "2026-07-03T14:03:13-04:00"
updatedAt: "2026-07-17T04:47:11.849Z"
status: "verified"
origin: "internal"
failureReason: "Engineer stopped without task_completed during semantic repair."
implementedAt: "2026-07-03T19:12:28.789Z"
verifiedAt: "2026-07-05T02:27:16.926Z"
workRecord:
    status: "generated"
    recordId: "f9212311-026d-4e30-85a7-a5036e34fa7d"
    path: "docs/work-records/2026-07-17-fix-worktree-merge-target-branch.md"
    lastAttemptAt: "2026-07-17T04:47:02.870Z"
archivedAt: "2026-07-05T04:17:45.096Z"
archiveReason: "Verified and archived after clearing stale worktree state"
archivedFromStatus: "verified"
archivedFromPath: "plans/fix-worktree-merge-target-branch.md"
routingIntent: "FEATURE"
sessionName: "fix worktree branch targeting"
---

# Fix Worktree Merge Target Branch

## Context

Feature plan execution worktrees are created from the primary checkout's current `HEAD`, and `createExecutionWorktree()`
already records the current source branch as `baseBranch` in the local `.wld/worktrees.json` registry. However, plan
front matter only records the execution worktree branch/path/status, and merge-back currently runs
`git merge --no-ff <worktreeBranch>` in whatever branch the primary checkout is on at validation or manual recovery
time.

The intended behavior is: a worktree created from branch `feature-base` should merge its validated changes back into
`feature-base`, even if the primary checkout later moved to `main` or another branch. `main` should not be special or
hardcoded.

User-confirmed product direction: merge-back must work independently of the primary checkout and must be safe when
multiple `wld` instances are executing/merging worktrees at the same time. Therefore, the merge design should not rely
on checking out the target branch in the primary checkout as the normal path.

Additional user-confirmed behavior: when merge-back fails, RunWield should immediately involve Engineer with a concrete
conflict/merge repair request, then retry merge-back. The user should get help resolving conflicts instead of only being
prompted to manually fix and retry.

## Objective

Persist each execution worktree's source/target branch durably in plan metadata and thread that target branch through
validation and manual recovery so merge-back always targets the branch the worktree was created from, while supporting
concurrent merge-back attempts from multiple RunWield instances. When merge-back fails, dispatch Engineer with the
conflict context, then retry merge-back before leaving the plan in manual recovery.

## Approach

Add a `worktreeBaseBranch` (or similarly named) plan front matter field alongside `worktreeBranch`. Populate it from the
`baseBranch` already returned by `createExecutionWorktree()` and by reusable registry entries. Extend active execution
workflow state and recovery context to carry this target branch.

Update merge-back to use an explicit `targetBranch`. The preferred implementation path is:

1. Commit any dirty execution worktree state as today.
2. Verify the execution branch and target branch both exist.
3. Inspect all Git worktrees to determine whether `targetBranch` is currently checked out anywhere.
4. If `targetBranch` is not checked out anywhere, perform the merge in a temporary detached merge worktree created from
   the current target branch tip. This keeps the primary checkout untouched.
5. After the temporary merge commit is produced, update `refs/heads/<targetBranch>` with a compare-and-swap
   (`git update-ref <targetRef> <mergeCommit> <oldTargetCommit>`). If another RunWield instance advanced the same target
   branch first, retry the detached merge against the new target branch tip up to a small bounded retry count.
6. If `targetBranch` is checked out in an existing worktree, do not update the branch ref behind that checkout via
   `update-ref` because that leaves the checked-out worktree inconsistent/dirty. Instead, use a safe fallback:
   - If the target branch is checked out at the current project root, merge there under the same merge-back flow and
     dirty-path protections.
   - If it is checked out in a different worktree, fail clearly and keep the plan recoverable; the user can switch/close
     that worktree or run recovery from the checkout that owns the target branch.

Keep backward compatibility for older plans: when plan front matter lacks `worktreeBaseBranch`, recover it from the
registry entry's existing `baseBranch`; if neither source has it, keep current-checkout behavior only as an explicit
legacy fallback with user-facing messaging.

On merge-back failure, integrate with the existing completion-gated Engineer repair pattern in `runValidationLoop()`:
mark the worktree/plan as recoverable, send Engineer a targeted request that includes the plan name, execution worktree
path/branch, target branch, failure reason, current status/diff context when available, and exact expectation to resolve
conflicts or make the merge retryable, run verification, and call `task_completed`. For detached merge worktree
conflicts, preserve the temporary merge worktree and surface its path on the thrown error/result so validation can run
Engineer in the right `cwd`. After Engineer completes, retry `mergeExecutionWorktree()` automatically. Bound the number
of merge-repair attempts so repeated conflicts do not loop forever; after exhaustion or missing `task_completed`, leave
the plan in the existing `merge_conflict` recovery state with clear instructions.

## Files to Modify

- `src/plan-store.js` — add `worktreeBaseBranch` to `PlanFrontMatter`, key ordering, front matter formatting, injection,
  parsing, and null-clearing behavior.
- `src/shared/workflow/plan-lifecycle.js` — include `worktreeBaseBranch` in plan event details, persist it during
  `execution_started`/`recovery_reset`, and clear it when worktree metadata is cleared or abandoned.
- `src/shared/session/session-state.js` — add `worktreeBaseBranch` to active execution workflow state typing.
- `src/shared/workflow/workflow.js` — store `worktree.baseBranch` in active workflow state and in `execution_started`
  plan event details.
- `src/shared/worktree.js` — extend merge-risk inspection and merge-back helpers with an explicit target branch; add
  target-branch detection, detached merge worktree, compare-and-swap update, retry, and checked-out-target fallback
  behavior.
- `src/shared/worktree-registry.js` — keep existing `baseBranch` registry field; update JSDoc only if return/context
  types need clarification.
- `src/shared/workflow/validation.js` — read `worktreeBaseBranch` from active workflow and pass it to
  `mergeExecutionWorktree()`; improve system messages to name both execution branch and merge target branch; replace the
  merge-failure prompt-only path with bounded completion-gated Engineer merge repair followed by automatic retry.
- `src/cmd/load-plan/index.js` — resolve recovery context from plan metadata plus registry `baseBranch`, display target
  branch in recovery reports, pass target branch for manual merge, and preserve it when recreating/resetting worktrees.
- `src/shared/worktree.test.js` — add branch-targeting and concurrency-style tests for create, inspect, detached merge,
  checked-out-target safety, and compare-and-swap retry helpers.
- `src/plan-store.test.js` — update front matter round-trip/clear tests for `worktreeBaseBranch`.
- `src/shared/workflow/plan-lifecycle.test.js` — verify lifecycle events persist and clear `worktreeBaseBranch` with the
  rest of worktree metadata.
- `src/shared/workflow/validation.test.js` — verify validation passes the recorded target branch to merge-back,
  dispatches Engineer for bounded merge repair on merge-back failure, retries merge-back after `task_completed`, and
  records recoverable failure metadata when repair cannot complete.
- `src/cmd/load-plan/index.test.js` — verify manual recovery uses plan/registry base branch and includes the target
  branch in user-facing recovery output.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/worktree.js:createExecutionWorktree()` — already captures `baseBranch`, `baseCommit`, `baseTree`, and
  `baseRef`; reuse this instead of inventing a second source of truth.
- `src/shared/worktree-registry.js` — registry entries already include `baseBranch`; use it as fallback for older plans
  whose front matter lacks the new field.
- `src/shared/worktree.js:resolveWorktreeParent()` and existing path/branch slug conventions — reuse for temporary merge
  worktree placement/naming, with a distinct prefix so cleanup is obvious.
- `src/shared/workflow/plan-lifecycle.js:recordPlanEvent()` — continue using plan events to mutate execution/worktree
  metadata rather than direct ad hoc front matter edits.
- `src/plan-store.js:optionalFrontMatterValue()` — use the existing optional string/null-clearing front matter pattern.
- Existing worktree tests in `src/shared/worktree.test.js` — extend the existing temporary git repo fixtures instead of
  adding a new test harness.

## Implementation Steps

- [ ] Step 1: Add `worktreeBaseBranch` to plan metadata plumbing.
  - Update `PlanFrontMatter` JSDoc in `src/plan-store.js`.
  - Add the key to `PLAN_FRONT_MATTER_KEYS` near `worktreeBranch` as a stable worktree metadata field.
  - Include it in `formatFrontMatter()`, `injectFrontMatter()`, and `parsePlanFrontMatter()` using optional
    string/null-clearing semantics.
  - Extend `src/plan-store.test.js` worktree front matter round-trip test to assert the field persists and clears.

- [ ] Step 2: Thread the target branch through lifecycle and active workflow state.
  - Add `worktreeBaseBranch` to active workflow JSDoc in `src/shared/session/session-state.js`.
  - In `startActiveExecutionWorkflow()`, set `worktreeBaseBranch: worktree.baseBranch` for new and reusable worktrees.
  - Add `worktreeBaseBranch` to `execution_started` event details.
  - Update `PlanEventDetails` and `buildPlanEventUpdates()` so `execution_started` and `recovery_reset` persist it, and
    `validation_passed` cleanup, `hold_reset_to_draft`, and `review_reopened` clear it with the rest of worktree
    metadata.
  - Add/update lifecycle tests for persistence and clearing.

- [ ] Step 3: Add target-branch-aware worktree inspection helpers.
  - Add or extend a parser for `git worktree list --porcelain` records that returns each worktree path and checked-out
    branch ref.
  - Add a helper to determine whether `targetBranch` is checked out, and where.
  - Extend `inspectExecutionWorktreeMergeRisk({ projectRoot, branch, targetBranch, allowedDirtyPaths })`.
  - Verify both the execution branch and `targetBranch` exist when `targetBranch` is provided.
  - Compute branch-changed paths against `targetBranch...branch` instead of `HEAD...branch` when a target is provided.
  - Run merge-tree checks against `targetBranch` and `branch`, without mutating any checkout.

- [ ] Step 4: Implement checkout-independent merge-back for the normal path.
  - Extend `mergeExecutionWorktree({ projectRoot, branch, targetBranch, worktreePath, allowedDirtyPaths })`.
  - Commit dirty worktree changes with `commitDirtyWorktreeState()` as today.
  - If no `targetBranch` is provided, retain the legacy current-checkout merge path for backward compatibility, but make
    callers pass a target whenever known.
  - For the target-branch path when `targetBranch` is not checked out anywhere:
    - Read `oldTargetCommit = git rev-parse refs/heads/<targetBranch>`.
    - Create a temporary detached merge worktree rooted at `oldTargetCommit` under the RunWield worktree parent with a
      clear temporary prefix.
    - In the temporary merge worktree, run `git merge --no-ff <executionBranch>` after applying the same plan metadata
      isolation strategy with target-neutral wording.
    - Capture `mergeCommit = git rev-parse HEAD`.
    - Run `git update-ref refs/heads/<targetBranch> <mergeCommit> <oldTargetCommit>` so the update only succeeds if no
      concurrent merge advanced the target.
    - Remove the temporary merge worktree in a `finally` block.
    - If the compare-and-swap fails because the target branch moved, retry from the new target tip up to a bounded
      count; if conflicts appear on retry, fail recoverably.
    - If the detached merge has unresolved conflicts, keep the temporary merge worktree instead of deleting it
      immediately, and throw a structured `Error` with extra JSDoc-documented properties such as `repairCwd`,
      `mergeWorktreePath`, and `mergeFailureKind` so validation can dispatch Engineer there.
  - Keep all messages and commit messages target-neutral; replace the misleading `"Align plan files with main..."` text.

- [ ] Step 5: Implement safe checked-out-target handling.
  - If `targetBranch` is checked out at `projectRoot`, use a protected in-place merge fallback:
    - Confirm current branch is `targetBranch`.
    - Apply existing dirty-path overlap checks against `targetBranch...executionBranch`.
    - Merge with `git merge --no-ff <executionBranch>`.
  - If `targetBranch` is checked out in a different worktree, throw a clear recoverable error explaining that RunWield
    will not update a checked-out branch behind another worktree because that would corrupt/dirty that checkout.
  - Do not use `git update-ref` on a branch that is checked out in any worktree.

- [ ] Step 6: Update validation merge-back flow.
  - Read `worktreeBaseBranch` from `getActiveExecutionWorkflow()`.
  - Pass `targetBranch: worktreeBaseBranch` to `mergeExecutionWorktree()`.
  - Update system messages from “into primary checkout” to include the target branch when known, e.g. “Merging validated
    worktree branch X into target branch Y.”
  - Ensure merge failures remain recoverable: registry status becomes `merge_conflict`, plan event remains
    `worktree_merge_failed`, and plan metadata retains both execution branch and target branch.

- [ ] Step 7: Add automatic Engineer help for merge-back failures, then retry.
  - Replace or extend the current `promptForMergeFailureAction()` path in `runValidationLoop()` so a merge-back failure
    first dispatches Engineer via the existing `runCompletionGatedRepair()` wrapper.
  - Use a bounded merge-repair attempt counter, e.g. one or two automatic Engineer attempts, to avoid infinite
    merge/retry loops.
  - Build a focused Engineer request that includes:
    - plan name and current plan status,
    - execution worktree path and branch,
    - recorded target branch,
    - whether merge-back used the detached merge worktree path or checked-out target fallback,
    - failure reason and any Git conflict output,
    - instruction to resolve/stage conflicts or otherwise make merge-back retryable, run appropriate verification, and
      call `task_completed`.
  - Run Engineer in the correct working directory for the recoverable merge state. If a temporary detached merge
    worktree has an active conflict, keep it available and pass that path as `cwd`; otherwise pass the execution
    worktree path or project root as appropriate.
  - After Engineer returns `task_completed`, retry `mergeExecutionWorktree()` automatically.
  - If Engineer stops without `task_completed` or repair attempts are exhausted, keep the plan recoverable with
    `worktreeStatus: merge_conflict`, restore the final active agent as today, and show instructions for manual
    recovery.
  - Preserve or update tests around existing user prompt behavior; manual retry/stop can remain as a fallback after
    automatic Engineer repair is exhausted.

- [ ] Step 8: Update manual recovery flow.
  - Extend `resolveRecoveryWorktree()` context to include `baseBranch` from
    `plan.attrs.worktreeBaseBranch || entry?.baseBranch`.
  - Display `Worktree target: <baseBranch>` in `appendRecoveryReport()`.
  - Pass `targetBranch: worktreeContext.baseBranch` to manual `mergeExecutionWorktree()`.
  - On worktree recreation/reset, persist the recreated worktree's `baseBranch` into plan front matter.
  - If a recovered old plan has no target branch in plan metadata or registry, show a clear warning that merge target is
    unknown and current-checkout fallback is being used.

- [ ] Step 9: Add focused regression tests.
  - Create a temp repo with a non-main branch, create an execution worktree from that branch, switch the primary
    checkout elsewhere, merge with `targetBranch`, and assert the changes land on the recorded source branch rather than
    the incidental current branch.
  - Assert detached merge-back leaves the primary checkout branch and working tree untouched when the target branch is
    not checked out there.
  - Assert two simulated merge-back attempts against the same target branch handle a moved target ref via
    compare-and-swap/retry rather than overwriting each other.
  - Assert `inspectExecutionWorktreeMergeRisk()` uses `targetBranch` without mutating current checkout.
  - Assert missing/deleted target branch produces a clear failure and does not merge into current branch.
  - Assert target branch checked out in another worktree produces a clear recoverable failure instead of `update-ref`
    dirtying that worktree.
  - Assert validation and manual recovery pass `targetBranch` through dependency-injected merge functions.
  - Assert merge-back failure dispatches Engineer with conflict context, retries merge-back after `task_completed`, and
    stops recoverably if Engineer does not complete or bounded repair attempts are exhausted.

## Verification Plan

- Automated:
  `deno test -A src/shared/worktree.test.js src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/validation.test.js src/cmd/load-plan/index.test.js`
- Automated: `deno task ci`
- Manual:
  - Create or use a non-main branch, approve/execute a feature plan from that branch, switch the primary checkout to
    another branch before validation merge-back, and confirm the plan's worktree branch merges into the recorded source
    branch while the primary checkout remains on its original branch if the target branch is not checked out there.
  - Run two RunWield executions from the same source branch concurrently enough that both are ready to merge; confirm
    one merge advancing the target branch does not cause the other to overwrite it, and the second either retries
    successfully or fails recoverably on a real conflict.
  - Force a merge-back conflict; confirm RunWield immediately dispatches Engineer with conflict context, retries
    merge-back after Engineer calls `task_completed`, and only falls back to manual recovery if Engineer cannot complete
    the repair.
  - Repeat with the target branch checked out in another worktree; confirm RunWield refuses to update it behind that
    checkout and leaves the plan recoverable with clear metadata.
- Expected results:
  - New plan front matter records `worktreeBaseBranch` during execution and retains it through recoverable failures.
  - Successful merge-back targets the recorded source branch.
  - The primary checkout branch is not the implicit merge target.
  - Concurrent merge-back attempts use compare-and-swap/retry semantics and do not lose earlier target branch updates.
  - Merge-back conflicts trigger bounded Engineer repair before manual recovery.
  - No code path hardcodes `main` as a worktree merge target.

## Edge Cases & Considerations

- Git allows low-level `update-ref` to move a branch that is checked out in a worktree, but doing so leaves that
  worktree inconsistent/dirty; this plan explicitly avoids that.
- Older in-flight plans may lack `worktreeBaseBranch`; recover from `.wld/worktrees.json` `baseBranch` when possible.
- The registry is local runtime state and should remain ignored/untracked; do not make `.wld/worktrees.json` part of
  durable branch-to-branch merge semantics beyond recovery fallback.
- If the recorded target branch has been deleted or renamed, fail clearly and keep the plan in recovery rather than
  guessing a target.
- If a concurrent merge advances the target branch and retry hits a real merge conflict, fail clearly and keep the plan
  recoverable.
- Temporary detached merge worktrees must be cleaned up on success and best-effort cleaned up on failure.
- Preserve pure JavaScript/JSDoc style; do not introduce TypeScript syntax.
