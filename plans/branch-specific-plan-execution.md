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
updatedAt: "2026-07-05T05:20:15.605Z"
status: "draft"
origin: "internal"
---

# Branch-Specific Plan Execution

## Context

RunWield already creates an execution worktree for approved plans and records runtime worktree metadata in plan front
matter (`worktreeId`, `worktreePath`, `worktreeBranch`, `worktreeBaseBranch`, `worktreeStatus`). Merge-back and recovery
already understand `worktreeBaseBranch` as the branch that validated work should merge into.

The current execution start path still creates new worktrees from `HEAD`, so the base branch is effectively whatever
branch the primary checkout has at execution time. That means a user who wants hands-off execution against another
branch must manually switch the checkout first. The requested behavior is to optionally record the intended target
branch during planning, then have execution create the worktree from that branch and merge back to that same branch.

Product decision from the request: target branch selection is optional. If no branch is recorded, preserve existing
current-checkout behavior.

## Objective

Add first-class support for plan-authored target branches by reusing the existing `worktreeBaseBranch` front matter
field:

- Planning agents can write `worktreeBaseBranch: "<local-branch>"` when the user specifies an execution target branch.
- Execution creates a new worktree from that branch, even if the primary checkout is currently on another branch.
- Validation and recovery continue to merge back into the recorded target branch.
- Existing plans without `worktreeBaseBranch` keep the legacy `HEAD`/current-checkout fallback.

## Approach

Use the existing `worktreeBaseBranch` field rather than inventing a new public key. Treat it as both the user-authored
target branch before execution and the durable runtime merge target after execution starts.

Execution should normalize the desired branch early in `startActiveExecutionWorkflow()`:

- If the plan has a non-empty `worktreeBaseBranch`, create the execution worktree from `refs/heads/<worktreeBaseBranch>`
  (or equivalent local-branch ref) and pass `baseBranch: worktreeBaseBranch` into `createExecutionWorktree()`.
- If the plan has no target branch, keep `baseRef: "HEAD"` and let `createExecutionWorktree()` record the currently
  checked out branch as today.
- If a reusable worktree already exists for the plan, do not recreate it; report/record the reusable worktree’s existing
  target branch. Avoid silently moving an in-progress plan to a different target branch.
- Fail before Engineer starts if the recorded target branch is not a local branch.

Planning/docs should make the field discoverable but optional. Agents should not invent a branch; they should only write
it when the user request, follow-up clarification, or explicit plan-review feedback supplies it.

## Files to Modify

- `src/shared/workflow/workflow.js` — use plan `worktreeBaseBranch` when starting execution worktrees; add test
  injection if needed for focused unit coverage.
- `src/shared/workflow/workflow.test.js` — cover `executePlan()`/workflow start with a recorded target branch and the
  no-branch fallback.
- `src/shared/worktree.js` — add/reuse a local-branch validation/ref helper so planned branch targets resolve as branch
  refs instead of ambiguous tags or commits.
- `src/shared/worktree.test.js` — cover explicit target branch creation from a non-current branch and invalid target
  branch rejection.
- `src/plan-store.js` — ensure `ChildFeaturePlanDescriptor` can carry `worktreeBaseBranch` for child FEATURE plans when
  needed.
- `src/plan-store.test.js` — cover saving child FEATURE plans with `worktreeBaseBranch` front matter.
- `src/shared/workflow/workflow-slicer.js` — when an Epic has `worktreeBaseBranch`, propagate it to materialized child
  FEATURE plans unless a child explicitly overrides it.
- `src/agent-definitions/planner.md` — tell Planner to include `worktreeBaseBranch` when the user specifies a target
  execution branch.
- `src/agent-definitions/architect.md` — tell Architect to include `worktreeBaseBranch` on Epics when the user specifies
  a target branch, so Slicer can pass it to children.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — tell Slicer to preserve/inherit the parent Epic target
  branch for child plans.
- `src/agent-definitions/document-formats/planner-plan-format.md` — document optional `worktreeBaseBranch` front matter.
- `src/agent-definitions/document-formats/architect-plan-format.md` — document optional `worktreeBaseBranch` front
  matter.
- `docs/adr/005-concurrent-worktree-isolation.md` — update the ADR to describe planned target-branch front matter and
  merge-back behavior.
- `README.md` — add a concise user-facing note showing how to request or record a target branch for hands-off plan
  execution.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — `PlanFrontMatter` already defines `worktreeBaseBranch`, and front matter parse/format paths
  already preserve it.
- `src/shared/worktree.js` — `createExecutionWorktree()` already accepts `baseRef` and `baseBranch`;
  `mergeExecutionWorktree()` already supports `targetBranch`.
- `src/shared/workflow/validation.js` — validation already reads `activeExecutionWorkflow.worktreeBaseBranch` and merges
  validated work into that target.
- `src/cmd/load-plan/index.js` — recovery already resolves/persists `worktreeBaseBranch`, recreates worktrees from
  recorded base refs, and manual merge passes `targetBranch`.
- `docs/adr/005-concurrent-worktree-isolation.md` — existing worktree lifecycle language is the right home for the
  behavior update.

## Implementation Steps

- [ ] Step 1: Add a small normalization helper in `src/shared/workflow/workflow.js` for `triageMeta.worktreeBaseBranch`
      / loaded plan attrs: trim strings, treat `"HEAD"`/empty as legacy fallback, and produce `{ baseRef, baseBranch }`
      for new worktree creation.
- [ ] Step 2: Update `startActiveExecutionWorkflow()` to create new worktrees with the normalized plan target branch
      (`baseRef: refs/heads/<branch>`, `baseBranch: <branch>`) instead of always using `baseRef: "HEAD"`.
- [ ] Step 3: Ensure reusable or active worktree handling does not silently change targets. If an existing worktree
      target differs from a now-recorded plan target, surface a clear error or warning before execution rather than
      creating a second worktree.
- [ ] Step 4: Add or export a local-branch validation/ref helper in `src/shared/worktree.js` and use it for planned
      target branches so branch names with slashes resolve through `refs/heads/<branch>` and tags/commits are rejected.
- [ ] Step 5: Extend child FEATURE plan support: add optional `worktreeBaseBranch` to the child descriptor
      typedef/schema and have Slicer/materialization inherit the parent Epic’s target branch into child front matter.
- [ ] Step 6: Update Planner/Architect/Slicer prompts and plan-format markdown so planning agents know to write
      `worktreeBaseBranch` only when the user explicitly supplies a target branch.
- [ ] Step 7: Update ADR/README docs to describe the user workflow: “ask for the plan to target branch X” or manually
      include `worktreeBaseBranch: "X"`; execution starts from X and merges back to X.
- [ ] Step 8: Add/adjust tests for branch-targeted worktree creation, workflow execution metadata, child plan
      inheritance, and invalid local-branch handling.

## Verification Plan

- Automated: `deno task ci`
- Targeted automated during development:
  - `deno test -A src/shared/worktree.test.js`
  - `deno test -A src/shared/workflow/workflow.test.js`
  - `deno test -A src/plan-store.test.js`
- Manual:
  - Create or edit a draft plan with `worktreeBaseBranch: "feature-base"` while the primary checkout is on another
    branch.
  - Approve/execute the plan.
  - Confirm the execution worktree starts from `feature-base` content, `execution_started` records
    `worktreeBaseBranch: "feature-base"`, and validation merge-back updates `feature-base` without requiring the primary
    checkout to be switched first.
- Expected results:
  - Existing plans without `worktreeBaseBranch` behave as they do today.
  - Plans with a valid local `worktreeBaseBranch` execute from and merge back to that branch.
  - Plans with a missing/non-local target branch fail before Engineer implementation begins with a clear message.

## Edge Cases & Considerations

- Branch names with slashes are valid (`feature/foo`). Use `refs/heads/<branch>` or equivalent to avoid ambiguity with
  tags/commits.
- Do not let user-authored `worktreeBaseBranch` overwrite the target of an already-active worktree. Recovery should
  continue using recorded runtime metadata.
- Remote-only branches are out of scope for this feature; require a local branch to avoid implicit fetch/checkout
  behavior.
- `worktreeBaseBranch` is an internal-sounding name, but it is already the durable field used by merge/recovery. Reusing
  it avoids a migration or alias layer.
- PROJECT Epics are not executed directly; branch targeting matters for their child FEATURE plans, so inheritance
  through Slicer is important.
