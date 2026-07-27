---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Use a focused semantic review after human code review feedback instead of rerunning full Plan-wide Semantic Code Review."
affectedPaths:
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation-loop-human-review.test.js"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "src/agent-definitions/workflow-prompts/reviewer-prompt.md"
    - "docs/plan-lifecycle.md"
    - "docs/settings.md"
    - "docs/prd/semantic-code-review-convergence-prd.md"
    - "docs/user-facing-features.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T00:12:10-04:00"
updatedAt: "2026-07-27T04:14:01.565Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
userVerificationNote: null
---

# Focused Semantic Review After Human Feedback

## Context

RunWield Workflow Validation currently runs local CI, full Semantic Code Review against the Approved Plan, optional
Human Code Review, then merge-back. If Human Code Review returns feedback, the feedback is sent to the Engineer and
validation loops again; the next pass reruns the expensive full Semantic Code Review before opening Human Code Review
again.

That is too costly for the post-human-feedback path. Full Semantic Code Review has already approved the implementation
before Human Code Review opens. After a human requests a change, the new semantic risk is narrower: whether the
Engineer's repair satisfies the human feedback, avoids obvious local regressions, and avoids violating the Plan outside
the scope of the human-requested repair. Human Code Review feedback is scoped authority; when it conflicts with the
Approved Plan inside the requested repair area, human judgment wins silently and should not create negative Plan or Work
Record provenance.

Relevant current seams:

- `runValidationLoop` in `src/shared/workflow/validation.js` owns CI, Semantic Code Review, Human Code Review, repair
  dispatch, merge-back, progress, and validation metrics.
- `captureWorktreeTree`, `diffTrees`, and `getWorkflowDiff` in `src/shared/workflow/git-snapshot.js` already support
  tree-based workflow diffs without mutating the real index.
- `review_complete` remains the terminal Reviewer result contract, so the focused path can reuse existing Reviewer
  tooling instead of adding a new tool.
- `validation-loop-human-review.test.js` already covers Human Code Review feedback routing but does not currently assert
  that a full Semantic Code Review is avoided after that repair.

## Objective

Change Workflow Validation so Human Code Review feedback repair uses a Focused Semantic Review instead of restarting the
full Plan-wide Semantic Code Review attempt.

The intended loop is:

1. CI passes.
2. Full Semantic Code Review approves the implementation against the Approved Plan.
3. Human Code Review opens.
4. If the human approves, validation proceeds to merge-back as today.
5. If the human returns feedback, the Engineer repairs it.
6. CI reruns.
7. Focused Semantic Review evaluates only the feedback repair patch and relevant Plan constraints.
8. Human Code Review opens again for explicit approval.
9. Steps 5-8 repeat until the human approves, exits/cancels, CI fails unrecoverably, the Engineer fails to complete a
   repair, or Reviewer execution fails after bounded continuation attempts.

There must be no fixed cap on human-driven Human Code Review feedback cycles. The existing full semantic validation
cycle limit must not halt the workflow merely because the human keeps requesting review changes. Reviewer execution
continuation attempts can remain bounded.

## Approach

Introduce a validation-owned state for the Human Code Review feedback repair path.

When Human Code Review returns feedback:

- Format feedback and annotations as today.
- Capture the current execution worktree tree before dispatching the Engineer. This becomes the focused repair baseline.
- Send the feedback and any images to the Engineer as today.
- Mark the next validation pass as a pending Human Code Review repair review.

On the next validation pass after CI succeeds:

- Compute both:
  - the current full workflow diff from the original execution baseline for later Human Code Review display and merge
    validation; and
  - the focused repair diff from the captured pre-repair tree to the current tree for focused semantic review.
- Run Focused Semantic Review instead of the full Semantic Code Review.
- The focused Reviewer prompt must combine triage and review in one call:
  - first decide whether the patch is obviously safe enough to approve quickly;
  - if deeper inspection is warranted, inspect only the human feedback, Engineer repair patch, relevant code context,
    and Plan requirements that constrain the touched area;
  - verify the repair satisfies the human feedback;
  - reject only for obvious local regressions, incomplete feedback repair, or Plan violations outside the scope of the
    human feedback;
  - treat human feedback as scoped authority over conflicting Plan instructions inside the requested repair area;
  - do not perform a full Plan-wide sweep;
  - call `review_complete` with the result.
- If Focused Semantic Review approves, reopen Human Code Review and require explicit human approval before merge-back.
- If Focused Semantic Review rejects, send its focused feedback back to the Engineer and keep the workflow in the
  pending focused-review path. Do not increment or enforce the full semantic validation cycle cap for these
  human-feedback repair cycles.
- If the focused repair patch is empty despite unresolved human feedback, the focused Reviewer should reject with
  concise feedback that the requested repair was not implemented.
- If the patch is broad, unrelated, or cannot be evaluated against the supplied human feedback, the focused Reviewer
  should reject/escalate in its feedback instead of silently approving. The workflow should not automatically create
  Plan or Work Record warnings for this.

Keep the existing Human Code Review UI contract: the user should still review the current implementation diff through
the existing `CODE_REVIEW` interaction. This plan does not require new Plannotator UI affordances.

## Files to Modify

- `src/shared/workflow/validation.js` — add focused Human Code Review repair state, capture the pre-repair tree, compute
  focused repair diffs, add focused review prompt construction, route focused approvals back to Human Code Review, route
  focused rejections to Engineer repair, and keep full semantic cycle limits separate from human-driven feedback cycles.
- `src/shared/workflow/validation-loop-human-review.test.js` — add/update tests proving post-human-feedback repair runs
  CI plus focused review and then opens Human Code Review again without rerunning full Semantic Code Review.
- `src/shared/workflow/validation-loop-review.test.js` — adjust assertions if shared semantic review prompt helpers or
  metrics gain a review-kind distinction.
- `src/agent-definitions/workflow-prompts/reviewer-prompt.md` — clarify that the Reviewer may be invoked in a Focused
  Human Feedback Repair Review mode and must obey the narrower mode-specific prompt when supplied.
- `docs/plan-lifecycle.md` — update Workflow Validation sequence so Human Code Review feedback repair reruns CI and
  Focused Semantic Review before reopening Human Code Review, instead of saying validation simply reruns.
- `docs/settings.md` — clarify that the `codereview` gate still opens after full semantic approval, and feedback repair
  uses focused semantic review plus repeated Human Code Review until approval/exit.
- `docs/prd/semantic-code-review-convergence-prd.md` — replace the resolved assumption that post-human-review changes
  start a new bounded full semantic attempt with the new focused-review rule.
- `docs/user-facing-features.md` — update the user-facing validation description to mention focused review after Human
  Code Review feedback.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/validation.js` — reuse `runIsolatedAgentSession`, `readLatestReviewOutcome`, `review_complete`,
  progress emission, repair dispatch, Reviewer execution continuation, and human review interaction orchestration.
- `src/shared/workflow/git-snapshot.js` — reuse `captureWorktreeTree` and `diffTrees` for the focused repair patch, and
  continue using `getWorkflowDiff`/`getGitDiffText` for the full workflow diff.
- `src/shared/workflow/review-diff-tool.js` — reuse `buildLargeDiffReviewPrompt`/`createReviewDiffTool` patterns for
  large focused repair diffs, or factor the small/large review-attempt builder so both full and focused modes get
  bounded large-diff handling.
- `src/shared/workflow/validation-loop-human-review.test.js` — extend existing Human Code Review feedback tests rather
  than creating an unrelated test harness.
- `src/tools/review-complete.js` and `src/shared/workflow/workflow-results.js` — keep the existing structured Reviewer
  completion signal.

## Implementation Steps

- [ ] Step 1: In `validation.js`, import `captureWorktreeTree` and `diffTrees` from `git-snapshot.js` alongside the
      existing workflow diff support.
- [ ] Step 2: Add a JSDoc typedef for pending Human Code Review repair state, e.g. feedback text, annotation/image
      counts for metrics, pre-repair tree, focused review attempts, and whether the next semantic check should be
      focused.
- [ ] Step 3: When Human Code Review returns feedback, capture `captureWorktreeTree(executionCwd)` before dispatching
      the Engineer and store it in the pending repair state. Preserve the existing Engineer feedback text/images
      behavior.
- [ ] Step 4: Refactor the existing full semantic review prompt builder inside `runValidationLoop` into a small helper
      shape that can build either a full Plan review prompt or a focused Human Code Review repair prompt while
      preserving large-diff fallback and `review_complete` tooling.
- [ ] Step 5: Add the focused review prompt text. It must state that full Semantic Code Review already approved, Human
      Code Review feedback is scoped authority, human feedback wins silently inside the requested repair scope,
      unrelated Plan violations/regressions remain blocking, and the Reviewer must call `review_complete`.
- [ ] Step 6: After CI passes, branch on the pending Human Code Review repair state. If present, compute the focused
      repair diff from the stored tree to the current tree and run Focused Semantic Review. If absent, run the existing
      full Semantic Code Review path.
- [ ] Step 7: Preserve current full workflow diff behavior for Human Code Review display and merge validation. A focused
      approval should reopen `CODE_REVIEW` with the current implementation diff and require explicit human approval.
- [ ] Step 8: On focused review approval, clear only the focused repair baseline/review state needed for that repair
      pass, then continue to Human Code Review. If the human gives more feedback, capture a new pre-repair tree and
      repeat.
- [ ] Step 9: On focused review rejection, dispatch the focused feedback back to the Engineer as a Human Code Review
      repair continuation, keep the pending repair baseline updated to the state before that repair dispatch, and rerun
      CI plus Focused Semantic Review afterward.
- [ ] Step 10: Separate counters and metrics so full semantic review rejection cycles still obey existing limits, while
      human-driven feedback/focused-review cycles are not stopped by `MAX_VALIDATION_CYCLES`. Keep Reviewer invocation
      continuation failures bounded at three attempts.
- [ ] Step 11: Record privacy-safe metrics that distinguish `reviewKind: "full_semantic"` from
      `reviewKind: "human_feedback_focused"` on semantic review result/repair dispatch events. Include counts/booleans
      only; do not store feedback, Plan text, or diff content.
- [ ] Step 12: Update docs listed above to reflect the new product rule and remove language saying post-human-review
      changes start a new full semantic attempt.
- [ ] Step 13: Add tests for the focused path:
  - initial full Semantic Code Review runs once before Human Code Review;
  - after Human Code Review feedback, CI reruns, Focused Semantic Review receives the focused repair diff and human
    feedback, and Human Code Review opens again;
  - focused review approval still requires explicit Human Code Review approval before merge;
  - focused review rejection dispatches focused feedback to the Engineer and repeats the focused path;
  - more than three human feedback cycles do not trigger the full semantic validation limit prompt;
  - Reviewer execution failures in focused mode still halt after the existing bounded continuation attempts.
- [ ] Step 14: Update any existing tests whose prompt text or metric expectations rely on every post-repair review being
      a full Plan-wide semantic review.

## Verification Plan

- Automated: `deno test --allow-all src/shared/workflow/validation-loop-human-review.test.js`
- Automated: `deno test --allow-all src/shared/workflow/validation-loop-review.test.js`
- Automated:
  `deno test --allow-all src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-delivery.test.js`
- Automated: `deno task ci`
- Manual: Run or simulate a Plan with `codereview: "always"` where Human Code Review returns feedback once, then
  approves on the second review.
  - Expected: full Semantic Code Review runs before the first Human Code Review only; after feedback repair, CI and
    Focused Semantic Review run; Human Code Review opens again; merge-back occurs only after explicit human approval.
- Manual: Simulate repeated Human Code Review feedback four or more times.
  - Expected: RunWield continues the human feedback loop without the full semantic validation cycle-limit prompt, unless
    CI/Reviewer execution/Engineer completion fails.
- Manual: Simulate focused Reviewer rejection.
  - Expected: RunWield sends focused feedback to the Engineer, reruns CI and Focused Semantic Review, and does not open
    merge-back or record verification until Focused Semantic Review and Human Code Review both approve.

## Edge Cases & Considerations

- The current repository working tree already has unrelated dirty changes in `src/shared/workflow/validation.js`,
  `src/shared/workflow/validation-loop-review.test.js`, and several docs/plans. The implementer should inspect the
  current branch before editing and avoid overwriting in-flight work.
- Human Code Review feedback is scoped authority, not blanket permission for unrelated rewrites. Focused Semantic Review
  should accept Plan conflicts only inside the requested repair area and directly necessary consequences.
- Do not add Plan Front Matter, Work Record warnings, or durable negative provenance for human feedback overriding the
  Plan inside scope.
- Non-Git in-place execution continues to skip Semantic Code Review and Human Code Review diff review because RunWield
  cannot compute the required diffs.
- Large focused repair diffs should retain bounded review behavior via the existing `review_diff` tool pattern rather
  than inlining unbounded diffs.
- Human feedback cycles are uncapped, but they are user-driven. Reviewer invocation continuation attempts, CI repair
  behavior, user exit/cancel handling, and Engineer `task_completed` pause behavior should remain bounded/fail-closed as
  they are today.
- If capturing the pre-repair tree fails, fail closed with a clear validation halt instead of falling back to a full
  semantic rerun or silently approving.
