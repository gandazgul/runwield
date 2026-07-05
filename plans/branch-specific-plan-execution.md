---
planId: "c32ce3fa-1708-4da8-bb9d-82a75e780283"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Allow specifying a target branch during planning and use that branch for worktree creation and final merge-back, instead of defaulting to the current checkout's branch. This involves updating plan frontmatter to store the target branch and modifying the execution workflow to respect this branch during worktree setup and merge."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/worktree.js"
    - "src/cmd/load-plan/index.js"
    - "src/plan-store.js"
frontend: false
createdAt: "2026-07-05T01:12:56-04:00"
updatedAt: "2026-07-05T16:43:17.504Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-05T16:43:17.504Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Branch-Specific Plan Execution

## Context

RunWield already creates an execution worktree for approved FEATURE plans and records runtime worktree metadata in plan
front matter (`worktreeId`, `worktreePath`, `worktreeBranch`, `worktreeBaseBranch`, `worktreeStatus`). Merge-back and
recovery already understand `worktreeBaseBranch` as the branch that validated work should merge into.

The missing behavior is at execution start: new worktrees are still created from `HEAD`, so the base branch is whatever
the primary checkout happens to have checked out when execution begins. A user who wants hands-off execution against
another branch must manually switch the checkout first.

Product decisions from the request, review feedback, and existing ADR behavior:

- Target branch selection is optional.
- If no target branch is recorded, preserve the legacy current-checkout/`HEAD` behavior.
- Target branch selection can name an existing local branch, a remote branch, or a new branch name.
- If the target only exists on the remote, RunWield should create a local tracking branch for it before execution.
- If the target exists neither locally nor remotely, RunWield should create the local target branch from `main`'s
  current HEAD before execution.

Field-name assumption checkpoint: this plan reuses the existing `worktreeBaseBranch` front matter field as the
plan-authored target branch instead of adding a new alias such as `targetBranch`. That keeps the storage model aligned
with existing merge/recovery metadata, but the field name is internal-sounding. If plan review prefers a friendlier
public key, the implementation should add an alias layer instead of silently changing this contract.

## Objective

Add first-class support for plan-authored target branches by reusing `worktreeBaseBranch` before execution starts:

- Planning agents can write `worktreeBaseBranch: "<branch>"` when the user specifies a target execution branch.
- Execution creates or resolves that target branch before creating the worktree, even if the primary checkout is
  currently on another branch.
- Validation and recovery merge back into the same recorded target branch.
- Existing plans without `worktreeBaseBranch` keep the current `HEAD`/current-checkout fallback.
- PROJECT Epics can carry the target branch and have Slicer inherit it into executable child FEATURE plans.

## Approach

Treat `worktreeBaseBranch` as both the user-authored target branch before execution and the durable runtime merge target
after execution starts.

Normalize the desired branch early in `startActiveExecutionWorkflow()`:

- Trim `triageMeta.worktreeBaseBranch`; treat empty values and literal `"HEAD"` as the legacy fallback.
- For a non-empty target branch, resolve or prepare a local branch ref before worktree creation:
  - If `refs/heads/<branch>` exists, use it.
  - Else if `origin/<branch>` exists or can be fetched, create a local tracking branch from it and use that local ref.
  - Else create the local branch from `refs/heads/main` and use that new branch ref.
- For no target branch, keep `baseRef: "HEAD"` and let `createExecutionWorktree()` record the currently checked out
  branch as it does today.
- If a reusable/active worktree already exists for the plan, do not recreate it. If the reusable worktree's recorded
  target differs from the plan-authored target, fail before Engineer starts with a clear message rather than silently
  moving an in-progress plan to a different branch.

Make the field discoverable in plan formats, agent prompts, README, and ADR docs. Agents should not invent a branch;
they should write it only when the user request, follow-up clarification, or explicit plan-review feedback supplies it.

## Files to Modify

- `src/shared/workflow/workflow.js` — normalize `triageMeta.worktreeBaseBranch`, pass branch-specific `baseRef`/
  `baseBranch` into `createExecutionWorktree()`, and add focused test seams or exported pure helpers if needed.
- `src/shared/workflow/workflow.test.js` — cover execution start metadata, target normalization, reusable-worktree
  target mismatch handling, child FEATURE inheritance helper behavior, and no-target fallback.
- `src/shared/worktree.js` — add/reuse an exported target-branch preparation helper so planned branch targets resolve as
  `refs/heads/<branch>` instead of ambiguous tags or commits; support existing local branches, remote tracking branch
  creation, and new branch creation from `main`.
- `src/shared/worktree.test.js` — cover explicit target-branch worktree creation from a non-current branch, remote-only
  branch tracking setup, new branch creation from `main`, and invalid branch-name rejection.
- `src/cmd/load-plan/index.js` — surface a recorded target branch in plan summaries/recovery displays where worktree
  context is shown, and ensure recreate/merge recovery continues to pass the recorded target branch.
- `src/cmd/load-plan/index.test.js` — cover target branch display/recovery behavior for plans with `worktreeBaseBranch`.
- `src/plan-store.js` — add optional `worktreeBaseBranch` to child FEATURE descriptors and materialized child front
  matter metadata.
- `src/plan-store.test.js` — cover saving child FEATURE plans with `worktreeBaseBranch` front matter.
- `src/shared/workflow/workflow-slicer.js` — add `worktreeBaseBranch` to the Slicer child descriptor schema and inherit
  the parent Epic's target branch into child FEATURE descriptors unless a child explicitly overrides it.
- `src/agent-definitions/planner.md` — tell Planner to include `worktreeBaseBranch` when the user specifies a target
  execution branch.
- `src/agent-definitions/architect.md` — tell Architect to include `worktreeBaseBranch` on Epics when the user specifies
  a target branch, so Slicer can pass it to children.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — tell Slicer to preserve/inherit the parent Epic target
  branch for child plans.
- `src/agent-definitions/document-formats/planner-plan-format.md` — document optional `worktreeBaseBranch` front matter.
- `src/agent-definitions/document-formats/architect-plan-format.md` — document optional `worktreeBaseBranch` front
  matter for PROJECT Epics.
- `docs/adr/005-concurrent-worktree-isolation.md` — update the ADR to describe planned target-branch front matter and
  target-branch merge-back behavior.
- `README.md` — add a concise user-facing note showing how to request or record a target branch for hands-off plan
  execution.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — `PlanFrontMatter` already defines `worktreeBaseBranch`, and front matter parse/format paths
  already preserve it.
- `src/shared/worktree.js` — `createExecutionWorktree()` already accepts `baseRef` and `baseBranch`;
  `mergeExecutionWorktree()` already supports `targetBranch`; private `assertLocalBranchExists()` already shows the
  local-branch validation behavior to extend for prepared target branches.
- `src/shared/workflow/validation.js` — validation already reads `activeExecutionWorkflow.worktreeBaseBranch` and merges
  validated work into that target.
- `src/cmd/load-plan/index.js` — recovery already resolves/persists `worktreeBaseBranch`, recreates worktrees from
  recorded base refs, and manual merge passes `targetBranch`.
- `src/shared/workflow/workflow.test.js` and `src/shared/worktree.test.js` — existing workflow/worktree tests provide
  the right unit and temporary-git-repo patterns.
- `docs/adr/005-concurrent-worktree-isolation.md` — existing worktree lifecycle language is the right home for the
  behavior update.

## Implementation Steps

- [ ] Step 1: Add an exported target-branch helper in `src/shared/worktree.js`, e.g.
      `prepareTargetBranchRef(projectRoot, branch)`, that trims input, rejects empty/`HEAD`/invalid branch names,
      returns an existing local `refs/heads/<branch>` when present, creates a local tracking branch from
      `origin/<branch>` when the remote branch exists, or creates a new local branch from `refs/heads/main` when neither
      exists.
- [ ] Step 2: Update `startActiveExecutionWorkflow()` in `src/shared/workflow/workflow.js` to derive worktree creation
      args from `triageMeta.worktreeBaseBranch`: targeted plans use the prepared local branch ref and `baseBranch`;
      untargeted plans keep `{ baseRef: "HEAD" }`.
- [ ] Step 3: Keep reusable/active worktree behavior stable. If an existing reusable worktree has a target branch that
      differs from the normalized plan target, return/throw a clear pre-Engineer error; otherwise continue using the
      existing worktree and record its target.
- [ ] Step 4: Add focused test seams if needed. Prefer pure helper tests plus one workflow-level test that stubs
      worktree creation/registry/event recording without requiring the real project `CWD` to change.
- [ ] Step 5: Extend child FEATURE plan support: add optional `worktreeBaseBranch` to `ChildFeaturePlanDescriptor`,
      `SavedChildFeaturePlan.metadata`, and the Slicer tool schema; have Slicer/materialization inherit the parent
      Epic's target branch into children unless a child explicitly supplies its own branch or `null`.
- [ ] Step 6: Update `load-plan` summary/recovery text so a recorded target branch is visible before execution and while
      inspecting/recreating/merging a failed or implemented worktree.
- [ ] Step 7: Update Planner/Architect/Slicer prompts and plan-format markdown so planning agents know to write
      `worktreeBaseBranch` only when the user explicitly supplies a target branch.
- [ ] Step 8: Update ADR/README docs to describe the user workflow: “ask for the plan to target branch X” or manually
      include `worktreeBaseBranch: "X"`; execution starts from X and merges back to X.
- [ ] Step 9: Add/adjust tests for branch-targeted worktree creation from existing local branches, remote tracking
      setup, new branch creation from `main`, invalid branch-name handling, workflow execution metadata, reusable target
      mismatch, child plan inheritance, and load-plan target display/recovery.

## Verification Plan

- Automated: `deno task ci`
- Targeted automated during development:
  - `deno test -A src/shared/worktree.test.js`
  - `deno test -A src/shared/workflow/workflow.test.js`
  - `deno test -A src/cmd/load-plan/index.test.js`
  - `deno test -A src/plan-store.test.js`
- Manual:
  - Create or edit a draft/approved FEATURE plan with `worktreeBaseBranch: "feature-base"` while the primary checkout is
    on another branch.
  - Approve/execute the plan.
  - Confirm the execution worktree starts from `feature-base` content, `execution_started` records
    `worktreeBaseBranch: "feature-base"`, and validation merge-back updates `feature-base` without requiring the primary
    checkout to be switched first.
  - Repeat with a remote-only branch and a brand-new branch name to confirm tracking setup and creation from `main`.
- Expected results:
  - Existing plans without `worktreeBaseBranch` behave as they do today.
  - Plans with an existing local `worktreeBaseBranch` execute from and merge back to that branch.
  - Plans targeting a remote-only branch create a local tracking branch first, then execute from and merge back to that
    local branch.
  - Plans targeting a brand-new branch create it from `main`'s current HEAD before execution.
  - Child FEATURE plans produced from a targeted Epic inherit the same target branch unless explicitly overridden.

## Edge Cases & Considerations

- Branch names with slashes are valid (`feature/foo`). Always resolve through `refs/heads/<branch>` to avoid ambiguity
  with tags or commits.
- Do not let user-authored `worktreeBaseBranch` overwrite the target of an already-active worktree. Recovery should
  continue using recorded runtime metadata.
- Remote branch discovery/tracking introduces git-network behavior. Keep it bounded to the named target branch. If the
  remote lookup itself errors, fail clearly; if lookup succeeds and the branch is absent, create the new local branch
  from `main`.
- Creating a brand-new target branch depends on `main`; if `refs/heads/main` is missing, fail clearly instead of
  guessing another default branch.
- Reusing `worktreeBaseBranch` avoids a migration/alias layer, but it is an internal-sounding name. This is an explicit
  field-name assumption for plan review.
- PROJECT Epics are not executed directly; branch targeting matters for their child FEATURE plans, so inheritance
  through Slicer is required.
- Lifecycle cleanup currently clears runtime worktree fields after verified merge when merged worktree cleanup is
  enabled. That is acceptable for this plan because the target is needed for execution/recovery, not as long-term
  historical metadata after verification.
