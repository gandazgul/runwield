---
planId: "76e4b286-5dcf-48e2-9609-0114d07493c0"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add RunWield Guided Review policy for validation-time human code reviews, reusing Plannotator's guided review capability while keeping plain Diff review available and making LLM-call cost/decision reasons visible."
affectedPaths:
    - "src/shared/settings.js"
    - "config.schema.json"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/code-review.js"
    - "src/shared/workflow/review-launcher.js"
    - "src/shared/workflow/review-diff-tool.js"
    - "src/shared/workflow/code-review.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/settings.test.js"
    - "docs/settings.md"
    - "docs/plan-lifecycle.md"
    - "docs/design-system.md"
    - "third_party/plannotator/"
frontend: true
createdAt: "2026-07-08T14:04:33-04:00"
updatedAt: "2026-07-08T14:04:33-04:00"
status: "draft"
origin: "internal"
routingIntent: "FEATURE"
sessionName: "guided review validation code reviews"
---

# Guided Review Validation Code Reviews

## Context

RunWield already supports optional human code review during Workflow Validation through the `codereview` setting. When
enabled, the gate runs after local CI and semantic review pass, before merge-back, so human feedback can still be sent
back to Engineer in the execution worktree.

Plannotator's current guided review feature organizes a PR or local diff into importance-ordered chapters with live,
annotatable diffs and per-section reviewed state. The installed compiled Plannotator bridge and pinned source checkout
already contain guide support (`guide` provider, `/api/guide/*`, Guide UI, intro/hint), so this plan should integrate
and harden existing capability rather than reimplementing the guide generator from scratch.

## Objective

Add a RunWield-flavored Guided Review experience for validation-time human code reviews:

- keep plain Diff review available at all times;
- automatically generate a Guided Review only when deterministic review-complexity thresholds say it is worthwhile;
- let users opt into ask/off/always behavior through settings;
- make the extra LLM call visible through system/tool output and browser job stats;
- avoid adding Plan lifecycle statuses or Plan front matter for guided-review internals.

## Resolved Product Decisions

- Guided Review is only for validation-time human code review, not Planner/Architect Plan review.
- Existing `codereview: none | ask | always` remains the human review gate.
- Add `guidedReview: none | ask | auto | always`, defaulting to `auto`.
- `auto` uses a deterministic threshold rule, not another LLM pre-classifier.
- `guidedReview: none` disables automatic/prompted generation but still leaves manual **Generate guided review** visible
  in the browser review UI.
- Generated guides and cost/job stats are ephemeral review-session/job state, not Plan front matter.
- Auto-generation must not steal focus. The user can keep reading Diff view; when generation finishes, show **Guided
  Review ready**.
- When RunWield generates or recommends a guide, system/tool output explains the reason and notes that it uses an extra
  LLM call.
- Child FEATURE Plans are scored independently. The child diff dominates; declared dependencies/Epic context may add a
  small bump, but parent Epic size does not force guide generation.

## Technical Approach

### 1. Add Guided Review setting

Add a project/global setting helper for `guidedReview` with normalized values:

- `none`: do not auto-generate or prompt; manual generation remains available in the review UI.
- `ask`: when thresholds pass, ask before starting guide generation.
- `auto`: when thresholds pass, start generation automatically.
- `always`: start guide generation whenever human code review opens.

Document it beside `codereview` and update `config.schema.json`.

### 2. Compute deterministic recommendation before launching human review

After semantic review approval and before `runPlannotatorCodeReview`, derive a recommendation from already-available
Plan and diff facts. Reuse `review-diff-tool.js` parsing helpers where practical so line/file stats are consistent with
large-diff semantic review behavior.

Initial scoring recommendation:

- `+3` Plan complexity is `HIGH`.
- `+2` Plan complexity is `MEDIUM`.
- `+2` semantic review used the large-diff path.
- `+2` changed files `>= 8`.
- `+2` changed lines `>= 800`.
- `+1` changed files `>= 4`.
- `+1` changed lines `>= 300`.
- `+2` child FEATURE has declared `dependencies`.
- `+1` child FEATURE belongs to an Epic, if Epic context is available.
- `+2` changed files span `>= 3` meaningful top-level areas.
- `-3` changes are only docs, Plan markdown, lockfiles, generated files, or other low-review-signal paths.

Recommend generation at score `>= 4`.

The recommendation object should include user-readable reasons such as `HIGH complexity`, `12 changed files`,
`940
changed lines`, `4 areas`, `child dependencies`, or `large diff path`.

### 3. Pass guide startup intent through the review launcher seam

Extend the code review launch path behind `src/shared/workflow/review-launcher.js` rather than coupling validation
directly to Plannotator internals.

The review surface should receive enough metadata to support:

- initial view preference: Diff remains usable immediately;
- guide policy result: no prompt, ask, auto-start, or always-start;
- recommendation reasons for UI/system display;
- plan name/git ref and execution cwd already passed today;
- diff stats, if the browser needs them for concise messaging.

Before implementation, audit the current compiled Plannotator `startReviewServer` contract to confirm whether guide
initialization can be requested via existing options/API or needs a small RunWield-side wrapper/Workspace route.

### 4. Browser review UX

In the code review UI:

- Always allow switching between Diff and Guided Review.
- When no guide exists, show **Generate guided review** with text indicating it uses one LLM call.
- In `auto`/`always`, start generation according to policy but keep Diff view active.
- While generating, show a job state with elapsed time, model/provider when available, and token/cost stats when
  available.
- When finished, show **Guided Review ready** instead of auto-switching.
- Manual generation remains available even when `guidedReview` is `none`.
- Reuse Plannotator guide components and annotation state. Annotations made inside Guided Review must flow into the same
  code-review feedback payload as plain Diff annotations.
- Apply RunWield theme/design-system language: RunWield labels and `--rw-*` tokens should frame the experience, even
  where Plannotator components are reused.

### 5. System/tool output and metrics

When guide generation starts from RunWield policy, append a RunWield system message similar to:

> Generating Guided Review because this looks like a long/cross-cutting human review: HIGH complexity, 14 files, 920
> changed lines, 4 areas. This uses one additional LLM call. Review UI remains usable in Diff mode while it runs.

Record workflow metrics for the policy decision and generation outcome without storing diff text, comments, token
secrets, full prompts, or cost-sensitive payloads. If token/cost data is only available inside Plannotator job state,
show it in the browser and keep RunWield metrics coarse.

## Files to Modify

- `src/shared/settings.js` and `config.schema.json`: add `guidedReview` normalization/schema.
- `src/shared/workflow/review-diff-tool.js`: expose or reuse diff stat helpers if currently private.
- `src/shared/workflow/validation.js`: compute recommendation after semantic review approval, handle `guidedReview`
  policy, emit system messages, and pass guide options to human review.
- `src/shared/workflow/code-review.js`: accept guide options and forward them to the review surface.
- `src/shared/workflow/review-launcher.js`: preserve the adapter seam and pass guide startup metadata to the compiled or
  Workspace-hosted Plannotator surface.
- `docs/settings.md`: document `guidedReview` values and relationship to `codereview`.
- `docs/plan-lifecycle.md`: clarify that Guided Review is a review aid inside human review, not Plan metadata or a new
  lifecycle status.
- `docs/design-system.md`: document RunWield wording/visibility expectations for generated-guide LLM-call affordances if
  new UI patterns are added.
- Tests for settings normalization, threshold scoring, policy behavior, launch payloads, and validation ordering.

## Out of Scope

- Using Guided Review for Plan approval/review.
- Persisting `guideGeneratedAt`, token counts, model, or Guide job IDs in Plan front matter.
- Adding a new Plan Status for guided review.
- Building a new guide generator if existing Plannotator guide support is sufficient.
- Removing plain Diff review.
- Making parent Epic size force guide generation for every child FEATURE.

## Acceptance Criteria

1. `guidedReview` defaults to `auto` and normalizes invalid values safely.
2. `codereview: none` still suppresses the human review gate entirely.
3. When human review opens, `guidedReview` controls only guide generation behavior, not whether review happens.
4. `auto` uses deterministic thresholds and emits an explainable reason when it generates a Guide.
5. `ask` prompts only when thresholds recommend generation.
6. `none` does not auto-generate or prompt, but the browser still offers manual **Generate guided review**.
7. Auto-generated Guides do not switch the user away from Diff view; completion shows **Guided Review ready**.
8. Guide generation shows LLM-call/job stats where available: model/provider, elapsed time, token/cost data if exposed.
9. Guided Review annotations are included in the same feedback payload as plain Diff annotations.
10. No Guided Review details are written to Plan front matter.
11. Child FEATUREs are scored by their own diff, with only a small bump for dependencies/Epic context.
12. Headed browser verification confirms Diff view remains usable during generation and switching to Guided Review
    works.

## Verification Plan

- Automated:
  - settings tests for `guidedReview` default and normalization;
  - unit tests for threshold scoring and explanation reasons;
  - validation tests for `none`, `ask`, `auto`, and `always` policy branches;
  - code-review/review-launcher tests that guide options are passed without changing decision handling;
  - regression tests proving Plan front matter does not gain guided-review fields.
- Manual/frontend:
  - run a small LOW-complexity review and confirm Diff opens with manual Generate available;
  - run a HIGH/large review and confirm generation starts, system message explains why, Diff remains active, and
    **Guided Review ready** appears;
  - add annotations in Guided Review and send feedback, confirming Engineer receives the combined feedback.
