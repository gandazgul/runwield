---
planId: "df6b338e-3c46-45c6-ac6a-4300387be20d"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement a new 'codereview' setting with three options (none, ask, always) to integrate with Plannotator's new code review UI as an optional validation gate without adding new primary plan statuses."
affectedPaths:
    - "src/shared/settings.js"
    - "src/shared/workflow/code-review.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/plan-store.js"
    - "docs/settings.md"
    - "docs/plan-lifecycle.md"
    - "src/shared/settings.test.js"
    - "src/shared/workflow/code-review.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/plan-store.test.js"
createdAt: "2026-06-23T00:39:48-04:00"
updatedAt: "2026-07-17T04:49:30.339Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-24T02:52:34.395Z"
workRecord:
    status: "generated"
    recordId: "6ba74768-085e-4261-a50c-418327e2b57a"
    path: "docs/work-records/2026-07-17-added-optional-plannotator-human-code-review-gate.md"
    lastAttemptAt: "2026-07-17T04:49:24.255Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-06-24T02:52:34.395Z"
routingIntent: "FEATURE"
---

# Plannotator Human Code Review Setting

## Context

RunWield already runs mechanical Workflow Validation after plan execution: local validation, semantic reviewer, repair
loops, then worktree merge-back and cleanup. Plannotator now offers a code review UI, and users should be able to opt
into a human review gate after those mechanical checks.

The requested setting has three modes:

- `none`: keep today’s behavior.
- `ask`: after mechanical checks pass, prompt whether to open a human code review.
- `always`: after mechanical checks pass, open the Plannotator code review UI automatically.

Recommended lifecycle answer: do **not** add separate primary Plan Statuses for `human_review` or `human_verified`. Keep
`implemented` while validation/human review is still in progress, and keep `verified` as the terminal status after all
required gates for the configured mode pass and merge-back succeeds. Add lightweight human-review metadata fields
instead so users can tell whether final verification included a human code review.

## Objective

Add an optional human code review gate to executable plan validation without replacing the existing semantic reviewer.
If a human returns feedback, send it back to the Engineer in the same repair loop used for semantic review feedback,
then rerun validation. If the human approves or skips review, continue to merge-back and cleanup as today.

## Approach

Insert the human review gate in `runValidationLoop` after local CI and semantic reviewer approval, but before merging
and deleting the execution worktree. This preserves the ability to send human feedback back to the Engineer while the
execution worktree still exists. `codereview: "none"` should bypass all new UI and preserve current behavior.

Use Plannotator’s `startReviewServer` from `@gandazgul/plannotator-pi-extension-compiled/server` with the workflow diff
already computed by RunWield. The currently locked compiled package (`0.21.0`) already contains `startReviewServer` and
`review-editor.html`, so no dependency bump is expected. Load `review-editor.html` from the resolved npm package
location, because the current compiled package exports the review server but not a named review HTML asset.

## Files to Modify

- `src/shared/settings.js` — preserve the new custom setting and add a helper that normalizes `codereview` to
  `none | ask | always` with `none` as default.
- `src/shared/workflow/code-review.js` — new helper module that loads the Plannotator review HTML, starts the code
  review server, opens the browser, waits for approve/feedback/exit, and exposes test injection points.
- `src/shared/workflow/validation.js` — call the human review gate after semantic review approval and before merge-back;
  route feedback to Engineer repair; record final human-review metadata when validation passes.
- `src/shared/workflow/plan-lifecycle.js` — accept optional human-review metadata in event details and persist it on
  `validation_passed` / clear it on recovery/reopen where appropriate.
- `src/plan-store.js` — document optional human-review front matter fields in JSDoc and include them in the known front
  matter ordering.
- `docs/settings.md` — document `codereview` and its three modes.
- `docs/plan-lifecycle.md` — document that human review is an optional gate before merge-back, and that no new primary
  Plan Status is introduced.
- `src/shared/settings.test.js` — cover setting normalization and preservation.
- `src/shared/workflow/validation.test.js` — cover none/ask/always, approval, feedback repair, skip, and merge ordering.
- `src/shared/workflow/plan-lifecycle.test.js` and `src/plan-store.test.js` — cover metadata persistence/clearing.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/validation.js` — reuse the existing CI + semantic review loop and `runCompletionGatedRepair()`
  feedback-to-Engineer pattern.
- `src/shared/workflow/git-snapshot.js` — reuse `getWorkflowDiff()` output as the patch shown in Plannotator.
- `src/shared/settings.js` — reuse `getMergedCustomSetting()` and the custom-key preservation list pattern.
- `src/shared/workflow/submit-plan.js` — reuse the browser-opening and server wait/cancel pattern, extracting a tiny
  shared browser helper if duplication becomes awkward.
- `@gandazgul/plannotator-pi-extension-compiled/server` — reuse `startReviewServer` for the code review UI.

## Implementation Steps

- [ ] Add a normalized code-review setting helper.
  - In `src/shared/settings.js`, add `"codereview"` to `RUNWEILD_CUSTOM_SETTING_KEYS`.
  - Export `getCodeReviewMode()` returning only `"none"`, `"ask"`, or `"always"`; default invalid/missing values to
    `"none"`.
  - Add settings tests for global/project override, invalid fallback, and preservation across SettingsManager writes.

- [ ] Add Plannotator code-review launcher.
  - Create `src/shared/workflow/code-review.js` in pure JavaScript with JSDoc typedefs.
  - Import `startReviewServer` from `@gandazgul/plannotator-pi-extension-compiled/server`.
  - Resolve and read `review-editor.html` via
    `import.meta.resolve("@gandazgul/plannotator-pi-extension-compiled/server")` and
    `new URL("../review-editor.html", resolvedServerUrl)`.
  - Start the review server with
    `{ rawPatch: diffText, gitRef: "RunWield workflow diff: <planName>", htmlContent, origin: "runwield", agentCwd: executionCwd }`.
  - Open the server URL in the default browser, wait for `server.waitForDecision()`, normalize
    `{ approved, feedback, annotations, exit }`, and always stop the server.
  - Provide dependency injection for tests: server starter, HTML loader, browser opener.

- [ ] Wire the human review gate into validation.
  - In `runValidationLoop`, after semantic review returns `APPROVED`, evaluate `getCodeReviewMode()`.
  - For `none`, set `executionComplete = true` as today.
  - For `ask`, prompt with `uiAPI.promptSelect` to open or skip human review; skipped review continues to merge-back.
  - For `always`, launch Plannotator without prompting.
  - On human approval, continue to merge-back.
  - On human feedback, append a RunWield message and call the existing Engineer repair helper with the human feedback
    and annotations; then continue the outer validation cycle.
  - On exit/cancel/no decision, halt validation with a clear failure reason and leave the worktree recoverable.

- [ ] Persist human-review metadata without adding new primary statuses.
  - Add optional PlanFrontMatter fields such as `humanReviewMode`, `humanReviewDecision`, `humanReviewedAt`, and avoid
    storing full review feedback in front matter because it can be large and stale.
  - On `validation_passed`, record `humanReviewMode: "none" | "ask" | "always"` and
    `humanReviewDecision: "not_required" | "skipped" | "approved"`.
  - Use these final metadata semantics:
    - `none` -> `humanReviewMode: "none"`, `humanReviewDecision: "not_required"`.
    - `ask` + skip -> `humanReviewMode: "ask"`, `humanReviewDecision: "skipped"`.
    - `ask` + approval -> `humanReviewMode: "ask"`, `humanReviewDecision: "approved"`.
    - `always` + approval -> `humanReviewMode: "always"`, `humanReviewDecision: "approved"`.
    - cancel/exit/no decision -> validation failure, no merge, plan remains `implemented`.
  - Clear stale human-review fields on `execution_started`, `recovery_reset`, and `review_reopened`.
  - Keep `verifiedAt` as the final timestamp for the complete configured gate set.

- [ ] Update tests around the validation loop.
  - Existing tests with no code-review dependency should still pass because default mode is `none`.
  - Add an `always` test proving order: CI pass → semantic review pass → Plannotator review approve → worktree merge →
    `validation_passed`.
  - Add an `always` feedback test proving feedback is sent to Engineer and validation cycles continue.
  - Add an `ask` skip test proving no review server starts and merge-back proceeds.
  - Add an exit/cancel test proving validation fails and worktree metadata is not merged/cleaned.

- [ ] Update docs.
  - In `docs/settings.md`, add `codereview` examples and mode descriptions.
  - In `docs/plan-lifecycle.md`, clarify that optional human review is part of Workflow Validation when enabled, runs
    after semantic review and before merge-back, and does not require new Plan Statuses.

## Verification Plan

- Automated: `deno task ci`
- Targeted during development:
  - `deno test -A src/shared/settings.test.js src/shared/workflow/validation.test.js src/shared/workflow/plan-lifecycle.test.js src/plan-store.test.js`
- Manual:
  - With no `codereview` setting, execute a small FEATURE plan and confirm current merge/delete behavior remains
    unchanged.
  - With `codereview: "ask"`, confirm RunWield prompts after semantic review; choosing skip proceeds to merge.
  - With `codereview: "always"`, confirm the Plannotator code review UI opens after semantic review and before worktree
    cleanup.
  - Submit human feedback from Plannotator and confirm Engineer receives the feedback, validation reruns, and the
    worktree remains available until final approval.

## Edge Cases & Considerations

- Human review must run before worktree merge/delete; otherwise feedback cannot be repaired safely.
- The code review UI may return annotations separately from free-text feedback; combine both into the Engineer repair
  prompt.
- If browser opening fails, keep the review URL in the TUI and continue waiting.
- If the review server exits/cancels, treat it as validation not complete rather than verified.
- Avoid adding `human_verified` as a terminal status because many commands already key off `status === "verified"`;
  metadata is lower-risk and preserves lifecycle invariants.
- If Plannotator package exports change, prefer an official `reviewEditorHtml` asset export over resolving the package
  file manually.
