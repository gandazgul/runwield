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
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-08T14:04:33-04:00"
updatedAt: "2026-07-08T18:17:06.079Z"
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

Plannotator already has a **Guided Review** mode for code review: the pinned source and installed compiled bridge
include the `guide` provider, `/api/guide/*` endpoints, guide job state, guide intro/hint UX, and
`GuideScreen`/`GuideEmptyState` client components. The current RunWield adapter
(`src/shared/workflow/review-launcher.js`) launches the compiled Plannotator code-review server and returns
`{ url, waitForDecision, stop, opened }`.

Important implementation facts from discovery:

- `src/shared/settings.js` currently preserves and normalizes `codereview` only; default human code review is `none`.
- `src/shared/workflow/review-diff-tool.js` already exports `parseDiffFiles`, `formatChangedFileList`, and related diff
  helpers used by large-diff semantic review.
- `src/shared/workflow/validation.js` computes the workflow diff and has a private large-diff threshold
  (`REVIEW_INLINE_DIFF_MAX_BYTES`) before launching human review.
- Plannotator's current `startReviewServer` options do not expose a RunWield guide-start policy, and the current
  Plannotator client auto-opens the guide takeover when a guide job completes. This conflicts with the RunWield product
  decision that auto-generated Guided Review must not steal focus from Diff view.
- RunWield currently imports `@gandazgul/plannotator-pi-extension-compiled@^0.22.0` at runtime and compile time. Changes
  to `third_party/plannotator/` are useful as source/reference, but they do not affect RunWield unless the runtime
  bridge is switched or the compiled package/import is updated.

Resolved product decisions for this Plan:

- Guided Review is only for validation-time human code review, not Planner/Architect Plan review.
- Existing `codereview: none | ask | always` remains the human review gate.
- Add a separate `guidedReview: none | ask | auto | always`, defaulting to `auto`.
- `auto` means RunWield conditionally generates a Guided Review only when deterministic diff/Plan signals suggest the
  human review is long or cross-cutting; it does not generate for every review.
- `none` disables automatic/prompted generation but still leaves manual **Generate guided review** available in the
  browser review surface.
- Generated guides, job IDs, token/cost data, and guide completion state remain ephemeral review-session/job state, not
  Plan Front Matter.
- Child FEATURE Plans are scored independently: the child diff dominates; declared dependencies/Epic context may add a
  small bump, but parent Epic size does not force guide generation.

## Objective

Add a RunWield-flavored **Guided Review Policy** for validation-time human code reviews:

- keep plain Diff review available at all times;
- compute an explainable deterministic recommendation before the human code review opens;
- honor `guidedReview` settings independently of the existing `codereview` human review gate;
- pass guide startup intent through the review-launcher adapter seam;
- show users that generation is an extra LLM call, including policy reasons and job/cost stats when available;
- ensure auto-generated Guided Reviews do not switch the user away from Diff view;
- keep Guided Review annotations in the same feedback payload as plain Diff annotations.

## Approach

1. **Settings and policy are RunWield-owned.** Add `guidedReview` to RunWield custom settings and schema. Keep
   `codereview` responsible only for whether human review happens; `guidedReview` controls only Guided Review generation
   inside an already-open human review.

2. **Recommendation is deterministic and explainable.** Add a pure helper that uses Plan metadata, diff stats, and
   large-diff knowledge already available in Workflow Validation. Do not call another LLM to decide whether to call an
   LLM.

3. **Review surface remains behind `review-launcher.js`.** Extend the existing adapter payload with a `guidedReview`
   object rather than coupling `validation.js` directly to Plannotator internals.

4. **Runtime bridge must be real, not source-only.** Because RunWield loads the compiled Plannotator package, the
   implementer must choose one runtime-effective path:
   - preferred: use or bump the compiled Plannotator bridge if a newer version exposes startup policy/suppress-auto-open
     options;
   - acceptable fallback: switch the adapter to a RunWield/Workspace-hosted code-review route that composes the existing
     Plannotator components and APIs behind the same `{ url, waitForDecision, stop, opened }` interface;
   - avoid: editing only `third_party/plannotator/` without changing what RunWield imports or serves.

5. **Preserve Diff-first UX.** The review surface may start guide generation automatically, but Diff remains the active
   view. Completion should create a visible **Guided Review ready** affordance/button/banner, not open the guide
   takeover.

6. **Make the cost and reason visible.** System/TUI output should say why RunWield generated or recommended a guide and
   that it uses one additional LLM call. Browser job UI should show model/provider, elapsed time, tokens, and cost when
   Plannotator exposes those fields; if exact spend is unavailable, show available stats and a clear “cost unavailable”
   state instead of inventing values.

## Files to Modify

- `src/shared/settings.js` — add `guidedReview` to preserved custom keys and implement `getGuidedReviewMode()` returning
  `"none" | "ask" | "auto" | "always"`, default `"auto"` when unset, with invalid values falling back to `"none"` to
  avoid accidental extra LLM calls.
- `config.schema.json` — document/schema `guidedReview` values next to `codereview`.
- `src/shared/workflow/review-diff-tool.js` — add or expose a compact diff-stat helper if `parseDiffFiles` consumers
  would otherwise duplicate changed-file/line/area calculations.
- `src/shared/workflow/validation.js` — compute the recommendation after semantic approval and before
  `runPlannotatorCodeReview`; handle `guidedReview` `none`/`ask`/`auto`/`always`; emit system messages; record coarse
  metrics; pass guide options to human review.
- `src/shared/workflow/code-review.js` — accept and forward guide options without changing approval/feedback decision
  normalization.
- `src/shared/workflow/review-launcher.js` — extend `startCodeReviewSurface()` options and bridge them to the actual
  served review surface.
- `third_party/plannotator/` — source/reference for Guided Review UI/server behavior; modify only if the runtime path
  also uses those changes through a compiled package update or Workspace-hosted route.
- `deno.json`, `deno.lock`, `scripts/compile.js`, `scripts/compile.test.js` — update only if the selected runtime path
  bumps the compiled Plannotator package or changes which review-editor asset/server module must be embedded.
- `src/shared/settings.test.js` — cover default, normalization, and custom-setting preservation for `guidedReview`.
- `src/shared/workflow/validation.test.js` — cover recommendation scoring and `guidedReview` policy branches.
- `src/shared/workflow/code-review.test.js` — cover guide-option forwarding and unchanged decision handling.
- `src/shared/workflow/review-launcher.test.js` — cover adapter payload propagation to the compiled/Workspace review
  surface.
- `docs/settings.md` — document `guidedReview` and its relationship to `codereview`.
- `docs/plan-lifecycle.md` — clarify that Guided Review is a review aid inside human code review, not a Plan Status or
  Plan Front Matter field.
- `docs/design-system.md` — document the RunWield wording/visibility expectations for generated-guide LLM-call
  affordances if new UI patterns are added.

## Reuse Opportunities

- `src/shared/settings.js#getMergedCustomSetting`, `getCodeReviewMode`, and custom-setting preservation — reuse for the
  new setting helper.
- `src/shared/workflow/review-diff-tool.js#parseDiffFiles` — reuse for changed-file counts, added/removed lines, and
  meaningful top-level area detection.
- `src/shared/workflow/validation.js` large-diff semantic review branch — reuse the existing large-diff decision as one
  signal in the guide recommendation.
- `src/shared/workflow/review-launcher.js#startCodeReviewSurface` — keep all review-surface implementation details
  behind this adapter seam.
- Plannotator guide provider/client/server support — reuse existing `/api/agents/jobs`, `/api/guide/*`, job state, guide
  rendering, and annotation export behavior rather than building a guide generator from scratch.
- RunWield Design System tokens (`--rw-*`) and Plannotator token bridge direction from ADR-007 — use for any RunWield
  wrapper/banner/notice around guide generation.

## Implementation Steps

- [ ] Step 1: Add the `guidedReview` setting.
  - Add `"guidedReview"` to the custom-setting preservation list in `src/shared/settings.js`.
  - Implement `getGuidedReviewMode()` with values `none`, `ask`, `auto`, `always`; default to `auto` when unset; treat
    invalid values as `none` to avoid accidental extra LLM calls from a typo.
  - Add schema/docs/tests for both global and project scopes, matching the existing `codereview` style.

- [ ] Step 2: Add a pure Guided Review recommendation helper.
  - Prefer a small exported helper in `validation.js` or a new local helper module if testability gets awkward.
  - Input should include Plan complexity, Plan attrs/body if needed for `parentPlan`/`dependencies`, diff text, and a
    boolean for whether semantic review used the large-diff path.
  - Reuse `parseDiffFiles(diffText)` to compute:
    - changed file count;
    - added + removed changed lines;
    - meaningful top-level areas (ignore low-signal/generated roots when counting areas);
    - low-signal-only diffs.
  - Return `{ recommended, score, reasons, stats }` where `reasons` are display-safe strings such as `HIGH complexity`,
    `12 changed files`, `940 changed lines`, `4 areas`, `child dependencies`, or `large diff path`.

- [ ] Step 3: Implement initial scoring thresholds.
  - `+3` Plan Complexity is `HIGH`.
  - `+2` Plan Complexity is `MEDIUM`.
  - `+2` semantic review used the large-diff path.
  - `+2` changed files `>= 8`.
  - `+2` changed lines `>= 800`.
  - `+1` changed files `>= 4`.
  - `+1` changed lines `>= 300`.
  - `+2` child FEATURE has declared `dependencies`.
  - `+1` child FEATURE belongs to an Epic, if Epic context is available.
  - `+2` changed files span `>= 3` meaningful top-level areas.
  - `-3` changes are only docs, Plan markdown, lockfiles, generated files, or other low-review-signal paths.
  - Recommend generation at score `>= 4`.

- [ ] Step 4: Wire policy into Workflow Validation.
  - After semantic review approval and before human review launch, read both `getCodeReviewMode()` and
    `getGuidedReviewMode()`.
  - If `codereview` is `none` or the user skips `codereview: ask`, do not prompt/generate a Guided Review.
  - For `guidedReview: none`, pass a disabled-auto policy while preserving manual generation in the browser.
  - For `guidedReview: ask`, prompt only when the recommendation passes; if declined, still open plain Diff review with
    manual generation available.
  - For `guidedReview: auto`, auto-start only when the recommendation passes.
  - For `guidedReview: always`, auto-start whenever human review opens, with reasons such as `guidedReview: always` plus
    stats.
  - Add system messages and `workflowMetrics` events for policy decision and generation outcome, avoiding diff text,
    prompts, secrets, and detailed cost payloads.

- [ ] Step 5: Extend the code-review and launcher payloads.
  - Add JSDoc typedefs for the guide recommendation/policy object in pure JavaScript style.
  - Pass the guide policy from `runValidationLoop()` to `runPlannotatorCodeReview()` to `startCodeReviewSurface()`.
  - Keep `normalizeCodeReviewDecision()` unchanged except for tests proving guide annotations remain normal annotations
    in the returned decision.

- [ ] Step 6: Bridge guide startup into the browser review surface.
  - First audit the exact compiled `startReviewServer` and client capabilities available in the installed package.
  - If a supported option exists, pass the RunWield policy through it.
  - If not, implement a runtime-effective bridge using one of the approved paths in the Approach section.
  - Ensure automatic startup uses Plannotator's existing guide provider/job API and stamps jobs to the current local
    diff context.
  - Ensure failed guide generation leaves the review usable and surfaces a retry/manual-generate path.

- [ ] Step 7: Adjust browser UX for RunWield policy.
  - Always expose **Generate guided review** when guide generation is available, including when `guidedReview` is
    `none`.
  - Label the action as an extra LLM call.
  - In auto/always generation, keep Diff view active while the job runs.
  - Replace Plannotator's current auto-open-on-guide-complete behavior for RunWield-origin reviews with a non-stealing
    **Guided Review ready** affordance.
  - Show elapsed time, provider/model, tokens, and cost if job state exposes them; otherwise show the available subset
    and avoid fabricated cost estimates.
  - Preserve keyboard/accessibility behavior for switching between Diff and Guided Review.

- [ ] Step 8: Preserve feedback semantics.
  - Confirm annotations created inside Guided Review flow into the same exported feedback payload as plain Diff
    annotations.
  - Add a regression test if the seam can be exercised in RunWield tests; otherwise document the manual verification.

- [ ] Step 9: Update docs.
  - `docs/settings.md`: add a `guidedReview` section and settings table row.
  - `docs/plan-lifecycle.md`: mention Guided Review in Workflow Validation without adding Plan Status/Event semantics.
  - `docs/design-system.md`: add the LLM-call disclosure/ready-notice pattern if new UI copy or pattern is introduced.

## Verification Plan

- Automated:
  - `deno test -A src/shared/settings.test.js`
  - `deno test -A src/shared/workflow/code-review.test.js src/shared/workflow/review-launcher.test.js src/shared/workflow/validation.test.js`
  - `deno task check`
  - `deno task workspace:react:check` if Plannotator/Workspace-hosted frontend code is touched
  - `deno task ci`
- Manual/headed browser:
  - Start the normal frontend dev server with `deno task workspace:dev` at `http://localhost:5173/` for any
    Workspace-hosted route or shared design-system changes.
  - Also verify the real validation-time review flow by launching a human code review from RunWield (or an equivalent
    test harness around `runPlannotatorCodeReview`) because the production code-review surface is an ephemeral local
    review server, not necessarily the public Plan UI Server.
  - Small/LOW review: set `codereview: always`, `guidedReview: auto`, open review for a small diff, confirm Diff opens,
    no guide auto-starts, and manual **Generate guided review** is visible with an LLM-call disclosure.
  - Threshold-passing review: use HIGH Complexity or a large/cross-area diff, confirm RunWield emits a reasoned system
    message, generation starts, Diff remains active and usable, and completion shows **Guided Review ready** without
    stealing focus.
  - `guidedReview: ask`: confirm RunWield prompts only when thresholds pass; decline keeps manual generation available;
    accept starts generation.
  - `guidedReview: none`: confirm no prompt/auto-start, but manual generation remains available.
  - `codereview: none`: confirm no human review or Guided Review opens at all.
  - Add annotations in Guided Review and plain Diff, send feedback, and confirm Engineer receives combined feedback in
    the existing human-review repair flow.
  - Check browser console/network for failed guide endpoints, failed job polling/SSE, or accessibility regressions on
    the Generate/ready controls.

## Edge Cases & Considerations

- **Compiled Plannotator runtime:** source-only edits under `third_party/plannotator/` will not change RunWield behavior
  while `review-launcher.js` imports `@gandazgul/plannotator-pi-extension-compiled`. Make the runtime path explicit.
- **No focus stealing:** current Plannotator auto-opens completed guide jobs. RunWield-origin reviews must suppress or
  override that behavior so auto-generation only announces readiness.
- **Human review gate remains authoritative:** `guidedReview` never opens a review when `codereview` disables or skips
  human review.
- **No Plan Front Matter persistence:** do not add `guideGeneratedAt`, token counts, model names, guide job IDs, or
  guide decisions to Plan Front Matter. Coarse workflow metrics are okay if they avoid sensitive payloads.
- **Cost accuracy:** display exact token/cost data only when available from job state. If unavailable, disclose that the
  action is an extra LLM call without estimating spend.
- **Large diffs and partial patches:** guide jobs must use the same launch-time diff context as the review surface so
  file references remain valid even if the user switches views while generation runs.
- **Low-signal diffs:** docs-only, Plan-only, lockfile-only, generated, or vendored changes should generally avoid
  automatic generation unless `guidedReview: always` is configured.
- **Pure JavaScript in RunWield code:** all new RunWield source must be `.js` with JSDoc typedefs. Do not add TypeScript
  syntax to RunWield executable code.
- **Out of scope:** using Guided Review for Plan approval/review, replacing plain Diff review, adding new Plan Statuses,
  and building a new guide generator from scratch.
