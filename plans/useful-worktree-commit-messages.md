---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "The `commitDirtyWorktreeState` function in `src/shared/worktree.js` currently uses a hardcoded commit message \"Apply execution worktree changes\". The user wants this to be useful and follow the guidelines in `src/prompt-templates/commit.md`. This will likely require integrating a call to an LLM to generate the commit message based on the diff, similar to how the commit prompt template works."
affectedPaths:
    - "src/shared/worktree.js"
frontend: false
createdAt: "2026-07-04T21:15:55-04:00"
updatedAt: "2026-07-05T02:00:25.416Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-05T01:48:57.813Z"
verifiedAt: "2026-07-05T02:00:25.416Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "useful worktree commit messages"
---

# Useful Worktree Commit Messages

## Context

Execution worktree merge-back currently commits any remaining dirty worktree state with the fixed subject
`Apply execution worktree changes` in `src/shared/worktree.js`. That makes history hard to scan. The requested product
behavior is deterministic and does not need an LLM call: commit messages should reference the plan and its description,
following the spirit of `src/prompt-templates/commit.md` by using a concise imperative subject and useful body details.

Relevant code paths found:

- Automatic merge-back after validation calls `mergeExecutionWorktree()` from `src/shared/workflow/validation.js`; it
  has `planName` and `triageMeta.summary` available.
- Manual recovery merge calls `mergeExecutionWorktree()` from `src/cmd/load-plan/index.js`; it has `plan.planName` and
  `plan.attrs.summary` available.
- `mergeExecutionWorktree()` currently calls `commitDirtyWorktreeState()` before merging; this is where the hardcoded
  message is used.

## Objective

Replace the hardcoded dirty-worktree commit message with a deterministic message that includes:

- A concise imperative subject under 50 characters.
- The full plan name.
- The plan description/summary when available.
- Enough fallback context to remain useful if older or test-only callers do not pass plan metadata.

Do not add an LLM dependency or invoke prompt-template execution during merge-back.

## Approach

Extend `mergeExecutionWorktree()` with optional plan metadata, pass that metadata from the validation and manual
recovery callers, and format the dirty-state commit message inside `src/shared/worktree.js`.

Recommended format:

```text
Complete <short plan name>

- Plan: <full plan name>
- Description: <plan summary>
- Files: <comma-separated staged paths, capped if needed>
```

Implementation notes:

- Clamp the subject to 50 characters, preserving an imperative first word such as `Complete`.
- Use `planDescription` as the internal option name and populate it from plan front matter `summary`.
- Keep body lines concise and omit empty metadata lines.
- When no plan name is supplied, fall back to a non-generic-but-stable subject such as
  `Commit execution worktree updates` and include the worktree branch in the body.
- Keep all implementation in pure JavaScript with JSDoc typedefs/param blocks; do not introduce TypeScript syntax.

## Files to Modify

- `src/shared/worktree.js` — add commit message formatting helpers; extend
  `mergeExecutionWorktree()`/`commitDirtyWorktreeState()` options; replace the hardcoded `git commit -m` call with
  generated `-m subject` plus optional `-m body` arguments.
- `src/shared/workflow/validation.js` — pass `planName` and `triageMeta.summary` into `mergeExecutionWorktree()` during
  automatic validation merge-back.
- `src/cmd/load-plan/index.js` — pass `plan.planName` and `plan.attrs.summary` into `mergeExecutionWorktree()` during
  manual merge recovery.
- `src/shared/worktree.test.js` — add or update coverage proving uncommitted worktree changes are committed with a
  message containing the plan and description, not the old hardcoded message.
- `src/shared/workflow/validation.test.js` — update merge-back assertions/mocks to verify validation forwards plan
  metadata.
- `src/cmd/load-plan/index.test.js` — update manual recovery merge test to verify load-plan forwards plan metadata.

## Reuse Opportunities

Existing functions and patterns to reuse:

- `src/shared/worktree.js` `runGit()` — continue using existing git invocation helper.
- `src/shared/worktree.js` `slugify()` style — follow local small-helper style for deterministic string
  normalization/truncation.
- `src/plan-store.js` `PlanFrontMatter.summary` — use the existing plan summary field as the requested plan description.
- `src/prompt-templates/commit.md` — reuse the guidelines conceptually: imperative subject, short subject, useful body;
  do not execute this template.

## Implementation Steps

- [ ] Step 1: In `src/shared/worktree.js`, add JSDoc typedefs for commit metadata/options if useful, plus helpers to
      normalize one-line text, clamp subject length to 50 characters, and build `{ subject, body }` from
      `{ planName, planDescription, branch, stagedPaths }`.
- [ ] Step 2: Change `commitDirtyWorktreeState(worktreePath, branch)` to accept optional commit metadata, use the
      already computed staged path list from `git diff --cached --name-only`, and commit with generated `-m` arguments.
- [ ] Step 3: Extend `mergeExecutionWorktree()`'s options JSDoc/destructuring with `planName` and `planDescription`, and
      pass those through to `commitDirtyWorktreeState()` before merge operations.
- [ ] Step 4: In `src/shared/workflow/validation.js`, pass `planName` and `triageMeta?.summary` as `planDescription` in
      the automatic merge-back call.
- [ ] Step 5: In `src/cmd/load-plan/index.js`, pass `plan.planName` and `plan.attrs.summary` as `planDescription` in the
      manual recovery merge call.
- [ ] Step 6: Update tests:
  - `src/shared/worktree.test.js`: create uncommitted changes, merge with explicit `planName`/`planDescription`, then
    inspect the execution branch's latest commit message and assert it includes the full plan and description and
    excludes `Apply execution worktree changes`.
  - `src/shared/workflow/validation.test.js`: capture merge args in the validation merge-back test and assert `planName`
    and `planDescription` are forwarded.
  - `src/cmd/load-plan/index.test.js`: capture merge args in manual recovery test and assert `planName` and
    `planDescription` are forwarded from the loaded plan.

## Verification Plan

- Automated:
  `deno test -A src/shared/worktree.test.js src/shared/workflow/validation.test.js src/cmd/load-plan/index.test.js`
- Automated: `deno task ci`
- Manual: Run a local plan execution in a worktree that leaves uncommitted changes at merge-back, then inspect the
  execution branch commit with `git log -1 --format=%B <worktree-branch>`.
- Expected results:
  - The dirty-worktree commit subject is imperative and no longer says `Apply execution worktree changes`.
  - The commit body includes the plan name and plan summary/description.
  - Automatic validation merge-back and manual recovery merge-back both produce the richer message when they have plan
    metadata.
  - Existing merge conflict repair and detached target-branch merge behavior remains unchanged.

## Edge Cases & Considerations

- Older/test-only callers may not pass plan metadata; keep a stable fallback message that includes the branch rather
  than throwing.
- Very long plan names/descriptions must not break commit creation; clamp only the subject, keep the body useful.
- Do not change the actual `git merge --no-ff` merge commit message unless needed; the reported hardcoded string comes
  from committing dirty worktree state before merge-back.
- If there are no dirty worktree changes, no commit should be created, preserving current behavior.
