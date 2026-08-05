---
planId: "e45aedd3-f831-401a-8661-2df652dbb48e"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "The Semantic Reviewer is failing with a context window error when the git diff is too large. I will modify `runValidationLoop` in `src/shared/workflow/validation.js` to avoid sending the entire diff to the Reviewer. Instead, I'll provide a list of changed files and instruct the Reviewer to use exploration tools to inspect the changes, effectively turning the Reviewer from a passive diff-reader into an active explorer."
affectedPaths:
    - "src/shared/workflow/validation.js"
frontend: false
createdAt: "2026-07-08T09:43:25-04:00"
updatedAt: "2026-07-17T04:46:54.074Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-08T14:21:32.797Z"
verifiedAt: "2026-07-08T14:45:17.003Z"
workRecord:
    status: "generated"
    recordId: "ecf6e199-a29a-4302-a449-c2fb84232372"
    path: "docs/work-records/2026-07-17-made-semantic-review-context-safe-for-large-diffs.md"
    lastAttemptAt: "2026-07-17T04:46:00.187Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
archivedAt: "2026-07-08T16:34:21.764Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/fix-semantic-reviewer-large-diffs.md"
routingIntent: "FEATURE"
sessionName: "fix reviewer context window"
---

# Fix Semantic Reviewer Large Diffs

## Context

Semantic Code Review currently builds one prompt containing the original plan and the entire workflow `git diff` in
`runValidationLoop`. Large worktree branches, such as the ACP worktree branch, can produce a diff large enough to exceed
the reviewer model context window before the reviewer can respond. The current failure is then treated as semantic
review failure with `(no reviewer output captured)`, sending useless feedback back to Engineer.

Existing constraints discovered in code:

- `runValidationLoop` already computes the workflow-scoped diff via `getWorkflowDiff(executionCwd, baselineTree)` and
  uses that diff for semantic review, human Plannotator review, and merge repair context.
- `loadReviewerPrompt` intentionally loads a bare workflow prompt outside the normal agent wrapper and currently returns
  `tools: []`.
- Reviewer semantic review runs as a fresh one-off session with `useRootSession: false`, preserving the root-session
  lifecycle invariant.
- The bundled reviewer prompt explicitly says to use only the supplied plan and diff and not inspect files.

Confirmed product decision: the semantic reviewer should remain automatic and isolated, but when the diff is too large
it may inspect the implementation with read-only tools (`read`, `grep`, `find`, `ls`) and a bounded diff-inspection tool
rather than receiving the entire diff inline. It should not receive bash, write/edit tools, memory, skills, or router
tools.

Additional confirmed behavior: if the reviewer invocation errors or returns no assistant output, validation must not
dispatch Engineer with empty feedback. It should stop at a user menu that offers retry or cancel/stop so the user
decides whether to rerun semantic review.

## Objective

Make semantic code review robust for large workflow diffs by giving the Reviewer a context-safe review packet and a
read-only way to inspect changed files/diff chunks on demand, while preserving current behavior for small diffs and
preventing empty/error reviewer responses from becoming Engineer repair requests.

## Approach

Keep small diffs fast: if the workflow diff is below a conservative inline threshold, continue sending the full diff in
the review prompt.

For large diffs, replace the inline full diff with a compact review packet:

- original plan content;
- total diff size and a clear notice that the full diff was omitted to avoid context overflow;
- changed file list extracted from diff headers;
- per-file summary where practical, such as path and approximate diff byte/line counts;
- explicit instructions to inspect the most relevant paths first based on the plan and changed-file list.

Add a dedicated read-only custom tool, likely `review_diff`, that is available only to the transient Reviewer
invocation. The tool should use the already-captured `diffText` from the workflow, not shell out to git, and support
bounded reads such as:

- list changed files with per-file metadata;
- return the diff for one file by path;
- return a byte/line window for very large per-file diffs with truncation metadata.

Update the reviewer workflow prompt to explain the two review modes:

- inline mode: read the supplied full diff;
- exploratory mode: use `review_diff` plus read/grep/find/ls as needed to inspect changed files and surrounding current
  code.

Do not grant Reviewer write/edit/multi-file-edit/bash/task completion/router tools. If read-only built-in file tools are
enabled, the prompt must explicitly forbid modifications and follow-up questions.

Also add a reviewer failure branch around the semantic review invocation: if `runAgentSession` throws, or if
`extractAssistantOutput(sessionMessages)` is empty/blank, show a `promptSelect` menu rather than sending feedback to
Engineer. The menu should offer retry semantic review or cancel/stop validation. Retrying should rerun semantic review
against the same already-passing implementation diff; canceling should halt validation with a clear reason and record
validation failure metadata.

## Files to Modify

- `src/shared/workflow/validation.js` — add the large-diff threshold, build the context-safe reviewer request, attach
  the read-only diff custom tool to Reviewer sessions, keep small-diff behavior unchanged, and add retry/cancel handling
  for reviewer errors or blank output.
- `src/shared/workflow/review-diff-tool.js` — new helper module for parsing workflow diff text into per-file chunks and
  exposing a bounded `review_diff` tool.
- `src/agent-definitions/workflow-prompts/reviewer-prompt.md` — revise Reviewer instructions from “diff only, no tools”
  to “inline diff or bounded exploratory review with read-only tools”.
- `src/shared/workflow/validation.test.js` — update existing Reviewer prompt/tool assertions and add coverage for
  large-diff prompt compaction and diff-tool availability.

## Reuse Opportunities

- `src/shared/workflow/validation.js` — reuse `extractDiffPaths`, `hasImplementationDiff`, and the existing
  `runAgentSession` transient reviewer flow.
- `src/shared/workflow/git-snapshot.js` — keep using `getWorkflowDiff` as the source of truth for workflow-scoped
  changes.
- `src/tools/user-interview.js` / other `defineTool` usage — mirror the existing custom tool pattern and JSDoc style for
  defining the read-only review tool.
- `src/shared/session/session.js` — rely on existing custom tool wiring; custom tools passed to `runAgentSession` become
  available even for workflow prompt overrides.

## Implementation Steps

- [ ] Add a pure-JS/JSDoc helper module `src/shared/workflow/review-diff-tool.js`.
  - [ ] Parse unified diff text into changed file entries keyed by path from `diff --git a/... b/...` headers.
  - [ ] Track per-file diff text, byte/line counts, and whether returned content was truncated.
  - [ ] Export `createReviewDiffTool(diffText)` using `defineTool` and `Type` schemas.
  - [ ] Support list/summary and per-file bounded diff reads; validate paths and offsets without throwing unhelpful
        errors.
- [ ] In `src/shared/workflow/validation.js`, add a named inline diff threshold constant.
  - [ ] Build a small-diff prompt that preserves the current `### Original Plan` + `### Git Diff` behavior.
  - [ ] Build a large-diff prompt that includes no full diff, only the compact summary and exploration instructions.
  - [ ] Attach `createReviewDiffTool(diffText)` through the `customTools` option when invoking Reviewer.
  - [ ] Permit only read-only exploration tools in the loaded reviewer definition when needed: `read`, `grep`, `find`,
        `ls` plus the custom `review_diff` tool; do not add bash/edit/write.
  - [ ] Wrap Reviewer invocation so thrown model/context/API errors are captured as reviewer execution failures instead
        of falling through as semantic issues.
  - [ ] Treat blank `reviewResponse` as reviewer execution failure, not semantic rejection.
  - [ ] Add a `promptSelect` retry/cancel menu for reviewer execution failures; retry reruns semantic review, cancel
        halts validation with recorded failure details.
- [ ] Update `loadReviewerPrompt` expectations and comments so it no longer claims semantic review always receives no
      tools.
- [ ] Update `src/agent-definitions/workflow-prompts/reviewer-prompt.md`.
  - [ ] State that mechanical CI has passed and the reviewer must output exactly `APPROVED` or concise semantic issues.
  - [ ] Document inline vs large-diff exploratory mode.
  - [ ] Instruct the reviewer to prioritize plan-named paths, changed files with substantive logic/UI/test changes, and
        edge cases called out by the plan.
  - [ ] Forbid code modification, skills, memory use, unrelated cleanup requests, or follow-up questions.
- [ ] Add/update tests in `src/shared/workflow/validation.test.js`.
  - [ ] Existing prompt-loading test should assert the intended read-only tools rather than `tools: []` if frontmatter
        changes.
  - [ ] Existing execution-cwd test should still prove reviewer runs in `executionCwd` and `useRootSession: false`.
  - [ ] Small diff test should prove the full diff still appears inline.
  - [ ] Large diff test should prove the full large hunk does not appear in `userRequest`, changed paths/size warning do
        appear, and `customTools` includes `review_diff`.
  - [ ] Reviewer error/blank-output tests should prove Engineer is not called, a retry/cancel menu is shown, retry
        reruns semantic review, and cancel records/announces validation halt.
  - [ ] Diff tool unit-style coverage should verify listing changed files and retrieving a bounded file diff.

## Verification Plan

- Automated: `deno test -A src/shared/workflow/validation.test.js`
- Automated: `deno task check`
- Automated: `deno task ci` if the targeted tests/check pass and time permits.
- Manual: simulate or add a test fixture with a large generated diff and confirm the Reviewer prompt stays well below
  the model context limit while still exposing changed paths and `review_diff`.
- Expected results:
  - Small semantic reviews behave as before and can approve from the inline diff.
  - Large semantic reviews no longer send the entire diff inline.
  - Reviewer can inspect changed file diffs in bounded chunks.
  - If Reviewer returns issues, Engineer receives meaningful reviewer feedback.
  - If Reviewer errors or returns no output, Engineer is not called; the user gets retry/cancel choices and cancel halts
    validation cleanly.

## Edge Cases & Considerations

- A single changed file can still have a very large diff; `review_diff` must support bounded windowing and report
  truncation/continuation instructions.
- Renames, deletes, binary files, and generated/lock files should appear in summaries without breaking parsing.
- The existing `hasImplementationDiff` guard must continue to detect plan-only diffs before review approval.
- Human Plannotator review currently still receives full `diffText`; this plan fixes the semantic reviewer context
  failure, not human review scalability.
- Avoid granting `bash`; a read-only diff tool is safer and more deterministic than asking Reviewer to run arbitrary git
  commands.
- Retrying reviewer execution should not send control back to Engineer or rerun CI unless the user later resumes
  validation from the normal workflow.
- Dirty working tree note from planning time:
  `plans/session-runtime-acp-mvp/04-runtime-interactions-and-acp-plan-review-link-out.md` is already modified and is
  unrelated to this plan file.
