---
classification: "FEATURE"
complexity: "HIGH"
summary: "Ensure wld handles non-git project roots gracefully across plan execution, worktree creation/merge, workflow diff/snapshot validation, recovery, and load-plan flows; planner/implementer should identify git-dependent situations and ask the user for policy where behavior is not evident."
affectedPaths:
    - "src/cmd/load-plan/index.js"
    - "src/shared/worktree.js"
    - "src/shared/workflow/git-snapshot.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/worktree.test.js"
    - "src/shared/workflow/git-snapshot.test.js"
    - "src/shared/workflow/validation.test.js"
frontend: false
createdAt: "2026-07-08T16:25:14-04:00"
updatedAt: "2026-07-09T04:02:26.788Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-09T01:54:17.770Z"
verifiedAt: "2026-07-09T04:02:26.788Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "non git graceful failure"
---

# Graceful Non-Git Project Handling

## Context

RunWield currently assumes the project root is a Git repository in several workflow paths. ADR-003 stores execution
baselines as Git tree objects, and ADR-005 makes Git worktrees the isolation mechanism for Plan execution, Workflow
Validation, merge-back, and Plan Recovery. In a project directory that does not use Git, these paths can surface raw
`git ... failed: fatal: not a git repository` errors or fail after partially entering a workflow.

The intended behavior is now an explicit non-Git fallback, not a hidden best effort. When Git is unavailable for the
current project root, RunWield should warn that it recommends Git, explain that changes will be made directly in the
current working directory instead of an isolated Worktree, ask for confirmation, remember that confirmation once per
project, and proceed in-place for that workflow type. This non-Git gate is ignored as soon as the project becomes a Git
repository, so normal Git Worktree behavior resumes automatically after `git init` or equivalent.

Confirmed product decisions from the user:

- FEATURE/Plan execution in a non-Git project should prompt once per project and, if confirmed, execute directly in the
  current project root instead of creating a Worktree.
- QUICK_FIX in a non-Git project should use the same style of warning/confirmation, but remembered separately from
  FEATURE/Plan execution.
- Non-Git FEATURE/Plan validation should not reimplement Git or filesystem diffing. RunWield should warn again that Git
  is not available, automated Semantic Code Review cannot run without a Git diff, and skip that review.
- Plan Recovery in a non-Git project should offer metadata-only cleanup where safe, but block
  inspect/continue/validate/recreate/reset/merge actions that require Git worktrees or Git baseline trees.

Current code findings:

- `startActiveExecutionWorkflow()` in `src/shared/workflow/workflow.js` creates or reuses an execution Worktree before
  dispatching Engineer; this must branch between Git Worktree mode and confirmed non-Git in-place mode.
- `src/shared/workflow/plan-lifecycle.js` currently assumes `execution_started` includes Worktree metadata/status; it
  needs to avoid recording misleading Worktree fields for non-Git in-place execution.
- `src/shared/worktree.js` shells out to Git for target branch resolution, Worktree creation/status, merge-back,
  removal, and risk inspection.
- `src/shared/workflow/git-snapshot.js` shells out to Git for baseline trees, diffs, commit history checks, and
  destructive restore.
- `src/shared/workflow/validation.js` assumes `getWorkflowDiff()` succeeds during Semantic Code Review and uses Git for
  merge verification/repair context.
- `src/shared/workflow/orchestrator.js` routes QUICK_FIX directly to Engineer and then Mechanical Validation; this is
  the correct place to gate non-Git QUICK_FIX edits before Engineer starts.
- `src/cmd/load-plan/index.js` has Plan Recovery, affected-path commit history checks, reset/recreate, inspect, merge,
  and abandon flows that should distinguish “not a Git repository” from ordinary recovery failures.

## Objective

Add shared Git capability detection and a remembered non-Git execution consent flow so RunWield can:

- Use the existing Git Worktree execution model unchanged in Git repositories.
- Prompt once per project before FEATURE/Plan execution writes directly to the current working directory in non-Git
  projects.
- Prompt once per project before QUICK_FIX writes directly to the current working directory in non-Git projects.
- Skip Git Worktree creation/merge-back paths when operating under remembered non-Git consent.
- Run CI/Mechanical Validation where available for non-Git in-place FEATURE/Plan execution, then skip Semantic Code
  Review and human diff review with a clear warning that Git diff is unavailable.
- Present clear Git-required messages for Plan Recovery actions that cannot be emulated without Git.
- Avoid raw Git stderr and uncaught `Deno.Command` errors in user-facing workflow output.

## Approach

Create a small shared Git capability module and a project-scoped non-Git consent setting. Then branch workflow start-up
between normal Git Worktree execution and explicitly confirmed in-place execution.

The implementation should avoid adding TypeScript files or TypeScript syntax. Use pure `.js` plus JSDoc typedefs.

Suggested project setting shape in `.wld/settings.json`:

```json
{
    "nonGitExecutionConsent": {
        "featurePlan": true,
        "quickFix": true
    }
}
```

This setting is only consulted when the current project root is not a Git work tree. If Git becomes available later,
RunWield should ignore the non-Git consent and use normal Worktree isolation.

For non-Git FEATURE/Plan execution, the active execution workflow should carry an explicit marker such as
`nonGitInPlace: true`. That marker lets Workflow Validation avoid Git diff/review and merge-back paths while still
running CI/Mechanical Validation and recording Plan Lifecycle events without Worktree metadata.

## Files to Modify

- `src/shared/git.js` — new shared helper for probing Git availability/repository state, detecting Git-required errors,
  formatting user-facing messages, and reading/writing non-Git consent if kept with Git policy helpers.
- `src/shared/settings.js` — preserve/read/write the project-scoped `nonGitExecutionConsent` custom setting.
- `src/shared/worktree.js` — use the Git helper before branch, Worktree, merge, status, and cleanup operations; throw a
  typed/friendly Git-required error instead of raw Git stderr for non-Git roots.
- `src/shared/workflow/git-snapshot.js` — use the Git helper for baseline capture, diff, restore, and commit-history
  calls; expose predictable Git-required failures to callers.
- `src/shared/workflow/plan-lifecycle.js` — avoid setting Worktree metadata/status during non-Git in-place
  `execution_started`, and preserve existing Worktree behavior for Git-backed execution.
- `src/shared/workflow/workflow.js` — implement FEATURE/Plan execution branching: Git Worktree mode when Git is
  available, confirmed in-place mode when not.
- `src/shared/workflow/validation.js` — support non-Git in-place validation by running CI, warning/skipping Semantic
  Code Review and human diff review, and skipping Worktree merge-back.
- `src/shared/workflow/orchestrator.js` — add QUICK_FIX non-Git warning/confirmation before Engineer runs, with a
  separate remembered project setting.
- `src/cmd/load-plan/index.js` — adjust affected-path history checks and Plan Recovery options/messages when Git is
  unavailable or the project root is not a Git repository.
- `src/shared/worktree.test.js` — cover worktree helper failures in non-Git temp directories.
- `src/shared/workflow/git-snapshot.test.js` — cover snapshot/diff/restore/commit-history behavior in non-Git temp
  directories.
- `src/shared/workflow/plan-lifecycle.test.js` — cover non-Git `execution_started` updates do not record misleading
  Worktree fields.
- `src/shared/workflow/workflow.test.js` — cover FEATURE/Plan non-Git prompt, remembered consent, in-place Engineer cwd,
  no Worktree metadata, and normal Git behavior after Git becomes available.
- `src/shared/workflow/validation.test.js` — cover non-Git in-place CI-only validation path and graceful Git-required
  failures for legacy recovery paths.
- `src/shared/workflow/orchestrator.test.js` — cover QUICK_FIX non-Git prompt, remembered consent, separate setting from
  FEATURE/Plan consent, and cancel behavior.
- `src/cmd/load-plan/index.test.js` — cover affected-path history skip messaging and recovery action behavior in non-Git
  mode.

## Reuse Opportunities

- `src/shared/project-state.js` — existing pattern for centralizing project-state detection and user-facing text; mirror
  this style for Git repository detection.
- `src/shared/settings.js` `getCustomSetting()` / `setCustomSetting()` — project-scoped custom settings already support
  preserving RunWield-owned keys in `.wld/settings.json`.
- `src/shared/worktree.js` `runGitResult()` — existing result-returning command helper can inform the shared helper or
  be replaced by it.
- `src/cmd/load-plan/index.js` `confirmAffectedPathChangesBeforeExecution()` — already catches commit-history failures
  and can specialize non-Git messaging without changing the confirmation flow.
- `src/shared/workflow/plan-lifecycle.js` — use existing Plan Events and Plan Statuses; avoid adding a new Plan Status
  for non-Git consent.
- Existing tests’ temp-directory patterns in `src/shared/worktree.test.js` and
  `src/shared/workflow/git-snapshot.test.js` — use temp directories without `git init` to reproduce non-Git project
  roots.

## Implementation Steps

- [ ] Add `src/shared/git.js` with JSDoc typedefs and helpers:
  - [ ] `probeGitRepository(cwd)` returning a structured result for: Git executable missing, not a Git work tree, valid
        work tree, bare/unsupported repository, and unexpected probe failure.
  - [ ] `isGitRepository(cwd)` convenience boolean.
  - [ ] `assertGitRepository(cwd, operation)` that throws a typed `GitRepositoryRequiredError` with a concise
        user-facing message.
  - [ ] `isGitRepositoryRequiredError(error)` and `formatGitRequiredMessage(error)` for UI callers.
  - [ ] Non-Git consent helpers if they are not placed in a separate workflow policy module.
- [ ] Add project-scoped non-Git consent support:
  - [ ] Add `nonGitExecutionConsent` to `RUNWEILD_CUSTOM_SETTING_KEYS` in `src/shared/settings.js`.
  - [ ] Add small helper functions to read/write `featurePlan` and `quickFix` consent with `getCustomSetting()` /
        `setCustomSetting()`.
  - [ ] Keep FEATURE/Plan and QUICK_FIX consent separate.
  - [ ] Consult consent only when `probeGitRepository(CWD)` says the project root is not a supported Git work tree.
- [ ] Update FEATURE/Plan execution in `src/shared/workflow/workflow.js`:
  - [ ] Before Worktree creation, probe Git.
  - [ ] If Git is available, keep current Worktree behavior exactly as-is.
  - [ ] If Git is unavailable/non-repo and `featurePlan` consent is absent, prompt: recommend Git, explain changes will
        happen directly in the current files with no Worktree isolation/merge-back, and offer proceed/cancel.
  - [ ] If the user proceeds, write `nonGitExecutionConsent.featurePlan = true` in project settings.
  - [ ] In confirmed non-Git mode, set active execution workflow with `executionCwd: CWD` and `nonGitInPlace: true`, but
        no `worktreeId`, `worktreeBranch`, `worktreePath`, or `executionBaselineTree`.
  - [ ] Record an `execution_started` Plan Event only after confirmation, with details that do not imply a Worktree
        exists.
  - [ ] Dispatch Engineer in `CWD`.
  - [ ] If the user cancels, do not dispatch Engineer and do not move into `in_progress`; return a controlled
        non-complete execution result.
- [ ] Update Plan Lifecycle handling in `src/shared/workflow/plan-lifecycle.js`:
  - [ ] Allow `execution_started` details to indicate non-Git in-place execution.
  - [ ] Set Plan Status to `in_progress` as usual once execution actually starts.
  - [ ] Do not set `worktreeStatus: "active"` or Worktree metadata when `nonGitInPlace` is true.
  - [ ] Keep existing reset/reopen cleanup behavior compatible with both absent Worktree metadata and Git-backed
        metadata.
- [ ] Update QUICK_FIX in `src/shared/workflow/orchestrator.js`:
  - [ ] Before Engineer runs for QUICK_FIX, probe Git.
  - [ ] If Git is unavailable/non-repo and `quickFix` consent is absent, prompt with the same risk language adapted for
        QUICK_FIX.
  - [ ] If the user proceeds, write `nonGitExecutionConsent.quickFix = true` in project settings.
  - [ ] If the user cancels, do not dispatch Engineer and do not run Mechanical Validation.
  - [ ] If Git becomes available later, skip the non-Git prompt and run normal QUICK_FIX behavior.
- [ ] Update `src/shared/worktree.js`:
  - [ ] Use the shared command/result helper or wrap existing `runGit()` so “not a Git repository” and missing `git`
        become `GitRepositoryRequiredError` where appropriate.
  - [ ] Gate `prepareTargetBranchRef()`, `resolveTargetBranchName()`, `createExecutionWorktree()`,
        `getWorktreeStatus()`, `mergeExecutionWorktree()`, and `removeExecutionWorktree()` with operation-specific
        messages.
  - [ ] Keep `pruneMissingWorktrees()` best-effort; it should not throw just because the primary project is non-Git.
- [ ] Update `src/shared/workflow/git-snapshot.js`:
  - [ ] Use the Git helper in `listCommitsTouchingPathsSince()`, `captureWorktreeTree()`, `getWorkflowDiff()`, and
        `restoreWorktreeTree()`.
  - [ ] Preserve existing behavior inside valid Git repositories.
  - [ ] Ensure temp index cleanup still runs when Git probing or Git commands fail.
- [ ] Update `src/shared/workflow/validation.js`:
  - [ ] Recognize active workflow metadata for non-Git in-place execution.
  - [ ] Run configured CI/Mechanical Validation in `CWD` as usual.
  - [ ] When CI passes for `nonGitInPlace`, append a warning that automated Semantic Code Review and human diff review
        are skipped because Git diff is unavailable and RunWield is not reimplementing Git.
  - [ ] Mark validation complete after the warning and skip Worktree merge-back/merge verification.
  - [ ] Catch Git-required failures around `getDiffText()` and retry diff computation for legacy Git-backed paths.
  - [ ] Avoid sending raw Git stderr to Reviewer or Engineer repair prompts when the underlying issue is “not a Git
        repository”.
- [ ] Update `src/cmd/load-plan/index.js`:
  - [ ] In `confirmAffectedPathChangesBeforeExecution()`, treat non-Git commit-history failure as an informational
        “skipping affected path history check because this project is not a Git repository” message and continue.
  - [ ] In Plan Recovery inspection, present “Git is required to inspect this Worktree/baseline” rather than raw command
        failure.
  - [ ] Disable or gracefully reject continue/validate/recreate/reset/merge actions that require Git when the project
        root is non-Git and the Plan has Worktree/baseline metadata.
  - [ ] Offer metadata-only abandon/reset cleanup where safe; do not delete arbitrary recorded Worktree paths without
        Git.
- [ ] Add tests:
  - [ ] Unit tests for `src/shared/git.js` using non-Git temp dirs and dependency injection or naturally available Git.
  - [ ] Settings tests or workflow tests that verify `nonGitExecutionConsent.featurePlan` and `.quickFix` are persisted
        separately at project scope.
  - [ ] Worktree and git-snapshot tests that assert friendly Git-required errors in non-Git dirs.
  - [ ] Plan Lifecycle tests that non-Git execution start changes Plan Status without adding Worktree metadata.
  - [ ] Workflow tests that assert FEATURE/Plan non-Git execution prompts once, records consent, dispatches Engineer in
        `CWD`, records no Worktree metadata, and uses normal Worktree behavior once Git is available.
  - [ ] Orchestrator tests that assert QUICK_FIX non-Git execution prompts once, records separate consent, dispatches
        Engineer in `CWD`, and cancels cleanly when declined.
  - [ ] Validation tests that assert non-Git in-place execution runs CI, skips Semantic Code Review with a warning,
        skips merge-back, and records validation success after CI passes.
  - [ ] Load-plan tests for affected-path history skip and recovery option behavior.

## Verification Plan

- Automated:
  - `deno test -A src/shared/worktree.test.js src/shared/workflow/git-snapshot.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/workflow.test.js src/shared/workflow/validation.test.js src/shared/workflow/orchestrator.test.js src/cmd/load-plan/index.test.js`
  - `deno task check`
  - `deno task test`
- Manual:
  - Create a temp directory with ordinary files but no `.git`, then run a saved Ready For Work FEATURE Plan through
    `wld load-plan <plan>` and choose execution.
  - Confirm RunWield warns that Git is recommended, explains in-place risk, asks once, records project-scoped
    FEATURE/Plan consent, runs Engineer in the current project root after confirmation, and does not create Worktree
    metadata.
  - Confirm Workflow Validation runs CI, warns that automated Semantic Code Review/human diff review are skipped because
    Git diff is unavailable, skips Worktree merge-back, and records validation success if CI passes.
  - Repeat FEATURE Plan execution in the same non-Git project and confirm the prompt is not repeated.
  - Run QUICK_FIX in the same non-Git project and confirm it prompts separately from FEATURE/Plan consent.
  - Initialize Git in that project, repeat execution, and confirm RunWield uses normal Worktree behavior and ignores the
    non-Git consent.
  - If a Plan contains stale Worktree/baseline metadata while the project is non-Git, verify Plan Recovery shows
    Git-required messages for Git-dependent actions and offers only safe metadata cleanup.
- Expected results:
  - No raw `fatal: not a git repository` or uncaught `Deno.Command` errors reach the user in the covered workflows.
  - Non-Git FEATURE/Plan and QUICK_FIX workflows do not write files until the user has confirmed the in-place risk or
    prior project consent exists.
  - FEATURE/Plan consent and QUICK_FIX consent are remembered separately.
  - Non-Git FEATURE/Plan validation clearly reports skipped automated review due to missing Git diff.
  - Valid Git repositories keep the existing Worktree, baseline, validation, merge-back, and recovery behavior.

## Edge Cases & Considerations

- Missing Git executable and “directory is not a Git repository” should be different probe reasons internally, but the
  user-facing prompt can use the same “Git is recommended/required for isolation” shape.
- Git subdirectories/worktrees should count as valid if `git rev-parse --is-inside-work-tree` succeeds in the RunWield
  project root.
- Bare repositories should not be treated as supported project work trees unless current behavior already supports them;
  prefer a graceful unsupported message.
- Existing ADR-005 behavior remains the normal path. Non-Git in-place execution is an explicit user-consented fallback
  for projects that do not currently have Git.
- Non-Git in-place execution cannot provide Git Worktree isolation, merge-back, Git baseline reset, affected-path commit
  history checks, or automated diff-based Semantic Code Review.
- Non-Git in-place validation success is weaker than Git-backed Workflow Validation because it is CI-only plus explicit
  skipped-review warning.
- If Git is initialized after consent is recorded, RunWield must ignore the non-Git consent and use normal Git Worktree
  behavior.
- There is an unrelated dirty file in the current checkout:
  `plans/workspace-astro-react-plannotator-migration/03-workspace-hosted-plan-and-code-review-surfaces.md`. This plan
  does not modify it.
