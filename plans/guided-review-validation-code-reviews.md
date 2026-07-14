---
planId: "76e4b286-5dcf-48e2-9609-0114d07493c0"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add RunWield Guided Review Explainers for validation-time human code reviews: generated single-column narrative documents with prose, callouts, Mermaid diagrams, live annotatable diffs, and exceptional sandboxed visual widgets."
affectedPaths:
    - "src/shared/settings.js"
    - "config.schema.json"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/code-review.js"
    - "src/shared/workflow/review-launcher.js"
    - "src/shared/workflow/review-diff-tool.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/routes/api/review-agent-handlers.js"
    - "src/ui/workspace/routes/api/review-widget-handlers.js"
    - "src/ui/workspace/react/CodeReviewSurface.tsx"
    - "src/ui/workspace/react/plannotator.css"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/shared/settings.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/workflow/code-review.test.js"
    - "src/shared/workflow/review-launcher.test.js"
    - "src/ui/workspace/workspace.test.js"
    - "docs/settings.md"
    - "docs/plan-lifecycle.md"
    - "docs/design-system.md"
    - "third_party/plannotator/"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-08T14:04:33-04:00"
updatedAt: "2026-07-14T21:49:27.475Z"
status: "implemented"
origin: "internal"
failureReason: "Semantic validation did not approve after 3 cycles."
worktreeId: "98077efc"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--/harns-runwield-guided-review-validation-code-reviews-98077efc"
worktreeBranch: "runwield/worktree/guided-review-validation-code-reviews-98077efc"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
routingIntent: "FEATURE"
sessionName: "guided review validation code reviews"
---

# Guided Review Validation Code Reviews

## Context

RunWield already supports an optional human Plannotator code review gate during Workflow Validation through the
`codereview` setting. The gate runs only after local validation and Semantic Code Review pass, before merge-back, so
User Code Review feedback can still be sent back to Engineer in the execution worktree.

The current code review surface is RunWield Workspace-hosted by default:

- `src/shared/workflow/review-launcher.js#startCodeReviewSurface()` starts `startReviewWorkspaceServer()` when no
  injected legacy server is provided.
- `src/ui/workspace/pages/review/code.astro` renders `src/ui/workspace/react/CodeReviewSurface.tsx` as a React island.
- `CodeReviewSurface.tsx` reuses Plannotator review-editor components for plain Diff review, file navigation,
  annotations, and feedback export.
- `src/ui/workspace/server.js#createReviewWorkspaceApp()` currently serves review decision/image/file/config endpoints,
  but it does not expose Plannotator agent-job, `/api/guide/*`, or sandboxed widget endpoints.

Plannotator already has a Guided Review implementation with useful pieces: a `guide` agent-job provider,
`createGuideSession()`, `GuideScreen`, `GuideEmptyState`, `GuideGenerating`, `GuideView`, `useGuideData()`, shared
agent-job types/SSE semantics, launch-time changed-file validation, and annotation parity inside embedded guide diffs.
However, the desired RunWield product shape is not a two-column chaptered dashboard. Guided Review should become a
**Guided Review Explainer**: a single-column review document that explains the change in the order that makes it easiest
to understand, embedding live Plannotator diffs exactly where they support the prose.

External prompt inspiration from `explain-diff-html.md` contributes output-quality principles, not a direct HTML
contract: clear explanatory prose, smooth transitions, reusable diagram families, callouts for key concepts/edge cases,
and correct code-block rendering. RunWield should adapt those principles into a structured, safe, review-specific
artifact.

Resolved product decisions for this Plan:

- Guided Review is only for validation-time human code review, not Planner/Architect Plan Review.
- Existing `codereview: none | ask | always` remains the human review gate.
- Add a separate `guidedReview: none | ask | auto | always`, defaulting to `auto`.
- `auto` conditionally generates a Guided Review only when deterministic diff/Plan signals suggest the User Code Review
  is long, cross-cutting, or conceptually hard; it does not generate for every review.
- Generated guides, job IDs, token/cost data, widget files, and completion state remain ephemeral review-session/job
  state, not Plan Front Matter or Plan Lifecycle state.
- The generated artifact should be structured JSON, not freeform HTML/Markdown.
- The primary generated content blocks are prose, callouts, Mermaid diagrams, and live annotatable diff blocks.
- Optional sandboxed HTML/CSS/JavaScript widgets are allowed only when prose, Mermaid diagrams, and diffs are inadequate
  for highly visual or interactive changes.
- Widgets must have no external network access. They may load only explicitly served local review assets through an
  allowlisted widget asset route; do not grant broad same-origin access.
- Presentation is a single scrollable column: prose, diagrams, widgets, and diffs flow as a document. No two-column
  guide layout.
- Default section order is conceptual: core implementation first, consequences/behavior/data flow next, support/glue
  last.
- Changed files the guide does not place appear at the bottom as “Everything else” diff blocks so coverage is explicit.
- Diffs inside the explainer are normal Plannotator `DiffViewer`s: annotatable, compatible with User Code Review
  feedback, and supplemented by Plannotator global comments with image attachments.

## Objective

Add a RunWield Guided Review Policy and Guided Review Explainer surface for validation-time human code reviews:

- keep plain Diff review available at all times;
- compute an explainable deterministic recommendation before the human code review opens;
- honor `guidedReview` independently of the existing `codereview` human review gate;
- pass guide startup intent through the existing validation → code-review → review-launcher seam;
- generate a structured explainer JSON document ordered for conceptual understanding, not filesystem order;
- render explainer blocks as a single-column document with prose, callouts, Mermaid diagrams, optional sandboxed
  widgets, and live annotatable Plannotator diffs;
- make LLM-call cost/reason visible in TUI/system output and browser UI;
- ensure automatic generation never switches the user away from plain Diff view;
- keep Guided Review annotations in the same feedback payload as plain Diff annotations.

## Approach

1. **Settings and policy are RunWield-owned.** Add `guidedReview` to RunWield custom settings and schema. Keep
   `codereview` responsible only for whether human review opens; `guidedReview` controls only Guided Review generation
   inside an already-open human review.

2. **Recommendation is deterministic and explainable.** Add a pure helper that uses Plan metadata, diff stats, and the
   large-diff knowledge already available in Workflow Validation. Do not call another LLM to decide whether to call an
   LLM.

3. **The guide artifact is structured JSON.** Replace the previous chapter-only guide contract with a
   `GuidedReviewExplainer` schema. It should be expressive enough for narrative review, but constrained enough that
   RunWield owns rendering, security, annotation wiring, and design-system consistency.

4. **Single-column document renderer.** Render the explainer as one scrollable document. Each section has an ordered
   sequence of blocks. The model decides conceptual order; the UI should not reorganize it by file tree.

5. **Safe visual richness.** Mermaid diagrams are first-class blocks. Sandboxed widgets are exceptional blocks backed by
   generated files in an ignored disposable location and served through review-token-protected routes with CSP/network
   restrictions.

6. **Keep the review-surface seam.** Extend `runPlannotatorCodeReview()` and `startCodeReviewSurface()` with a
   `guidedReview` policy payload. `validation.js` should not import Workspace or Plannotator UI/server internals.

7. **Use the Workspace-hosted runtime path.** Since RunWield serves code review through `src/ui/workspace`, implement
   the runtime-effective bridge there. Reuse Plannotator source modules/components where practical, but make the code
   that RunWield actually serves carry the behavior.

8. **Preserve Diff-first UX.** The review surface may start guide generation automatically, but plain Diff remains the
   active view. Completion creates a visible **Guided Review ready** affordance/button/banner; it does not open the
   explainer automatically.

9. **Make cost and reason visible.** TUI/system output should say why RunWield generated or recommended a guide and that
   it uses an additional LLM call. Browser job UI should show provider/model, elapsed time, token counts, and cost when
   job state exposes them; if exact spend is unavailable, show available stats and a clear “cost unavailable” state.

## Guided Review Explainer Shape

The generated guide should be a structured JSON artifact. Suggested shape:

- `schemaVersion` — version string for migration/validation.
- `title` — concise human title.
- `intent` — one or two sentence framing of why this change exists.
- `sections[]` — ordered conceptual sections.
  - `title` — concept-level title, not a file name paraphrase.
  - `role` — `core`, `consequence`, `data_flow`, `ui_behavior`, `edge_case`, `support`, or `glue`.
  - `blocks[]` — ordered document blocks.
- `everythingElse[]` — file refs not placed by the model, rendered at the bottom as diff blocks.
- `widgetAssets[]` — optional metadata for generated widget files/assets, served only through the sandboxed widget
  route.

Supported v1 block types:

- `prose` — narrative Markdown prose. Use for the main explanation; this should be the default block type.
- `callout` — labeled note for definitions, risk, edge cases, assumptions, “review this carefully,” or manual
  verification hints.
- `mermaid` — Mermaid source plus an accessible title/description. Prompt should include examples for flowcharts,
  sequence diagrams, state diagrams, UI sketches, and data-flow diagrams.
- `diff` — live Plannotator diff block referencing one file and, when possible, specific changed hunks/line ranges. The
  diff block includes a short summary explaining why this diff appears at this point in the narrative.
- `widget` — exceptional sandboxed visual aid. Requires a title, reason, entry file, declared local asset refs, and
  optional JSON data. Use only when prose + Mermaid + diffs cannot make highly visual/interactive behavior clear.
- `reviewCheckpoint` — optional prompt to the human reviewer, e.g. “Confirm the loading state still covers the failed
  request path.”

Prompt guidance for generation:

- Organize for understanding, not file order.
- Explain the core implementation first, then consequences/behavior/data flow, then glue/support.
- Prefer prose + embedded live diffs.
- Use Mermaid when structure, data flow, state, sequence, UI layout, or game loop behavior is clearer as a diagram.
- Use a sandboxed widget only for exceptional visual/interactivity needs, such as:
  - changed game mechanics or animation timing where stepping through states helps;
  - UI behavior where a small interactive mock clarifies transitions/responsive states;
  - complex graph/spatial/geometry behavior where a static diagram loses key relationships.
- Do not create widgets as decoration or generic “nice to have” visuals.
- Every placed diff must reference a real changed file from the launch-time diff.
- Any changed file not placed in the narrative must appear in `everythingElse`.

## Files to Modify

- `src/shared/settings.js` — add `guidedReview` to preserved custom keys and implement `getGuidedReviewMode()` returning
  `"none" | "ask" | "auto" | "always"`, default `"auto"` when unset, with invalid values falling back to `"none"` to
  avoid accidental extra LLM calls.
- `config.schema.json` — add the `guidedReview` setting next to `codereview`.
- `src/shared/workflow/review-diff-tool.js` — expose a compact diff-stat helper if `parseDiffFiles()` consumers would
  otherwise duplicate changed-file/line/area calculations.
- `src/shared/workflow/validation.js` — compute the recommendation after Semantic Code Review approval and before
  `runPlannotatorCodeReview()`; handle `guidedReview` `none`/`ask`/`auto`/`always`; emit system messages; record coarse
  workflow metrics; pass guide policy to human review.
- `src/shared/workflow/code-review.js` — accept and forward guide options without changing approval/feedback decision
  normalization.
- `src/shared/workflow/review-launcher.js` — extend `startWorkspaceHostedCodeReview()` and `startCodeReviewSurface()` to
  include guide policy in the review payload.
- `src/ui/workspace/server.js` — add authenticated review-agent/guide/widget routes to `createReviewWorkspaceApp()` and
  ensure job/widget cleanup happens when the ephemeral review server stops.
- `src/ui/workspace/routes/api/review-agent-handlers.js` — new focused host adapter for Plannotator-style agent jobs,
  guide launch, `/api/agents/*`, `/api/guide/:jobId`, `/api/guide/:jobId/reviewed`, failed-guide repair if needed, and
  explainer JSON retrieval.
- `src/ui/workspace/routes/api/review-widget-handlers.js` — new token-protected handler for generated widget documents
  and allowlisted local assets, with CSP that blocks external network/connect and restricts navigation/forms/popups.
- `src/ui/workspace/react/CodeReviewSurface.tsx` — integrate Guided Review controls/state, manual generation,
  auto-start-on-policy, ready affordance, single-column explainer rendering, Mermaid rendering, widget iframe rendering,
  and annotation parity while keeping the existing Diff review layout available.
- `src/ui/workspace/react/plannotator.css` — style explainer document blocks, callouts, Mermaid containers, widget
  frames, Generate/ready/cost disclosure affordances, and responsive single-column layout using RunWield Design System
  tokens.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — add dev payload fixtures for `guidedReview` modes, generated explainer
  states, Mermaid diagrams, widget blocks, guide-capability states, and failed generation.
- `third_party/plannotator/` — reuse and, only if necessary, minimally adapt source modules/components. Any changes here
  must be exercised through the Workspace-hosted runtime path, not left as source-only edits.
- `src/shared/settings.test.js` — cover default, normalization, and custom-setting preservation for `guidedReview`.
- `src/shared/workflow/validation.test.js` — cover recommendation scoring and `guidedReview` policy branches.
- `src/shared/workflow/code-review.test.js` — cover guide-option forwarding and unchanged decision handling.
- `src/shared/workflow/review-launcher.test.js` — cover adapter payload propagation to the Workspace-hosted review
  surface.
- `src/ui/workspace/workspace.test.js` — cover review-agent route token checks, explainer JSON validation, widget route
  token/CSP behavior, guide route behavior, job cleanup, and feedback payload preservation for Guided Review
  annotations.
- `docs/settings.md` — document `guidedReview` and its relationship to `codereview`.
- `docs/plan-lifecycle.md` — clarify that Guided Review is a review aid inside User Code Review, not a Plan Status, Plan
  Event, or Front Matter field.
- `docs/design-system.md` — document the explainer document pattern, LLM-call disclosure/ready notice, callout styles,
  Mermaid styling, and widget sandbox requirements.

## Reuse Opportunities

- `src/shared/settings.js#getMergedCustomSetting`, `getCodeReviewMode()`, and custom-setting preservation — mirror these
  for the new setting helper.
- `src/shared/workflow/review-diff-tool.js#parseDiffFiles()` — reuse for changed-file counts, changed lines, and
  top-level area detection.
- `src/shared/workflow/validation.js` large-diff Semantic Code Review branch — reuse the existing
  `REVIEW_INLINE_DIFF_MAX_BYTES` decision as one signal in the guide recommendation.
- `src/shared/workflow/review-launcher.js#startCodeReviewSurface()` — keep review-surface implementation details behind
  this adapter seam.
- `src/ui/workspace/server.js#createReviewWorkspaceApp()` — reuse its token gate and ephemeral server lifecycle for
  guide/job/widget routes.
- Plannotator `GuideDiffSection` and the existing `DiffViewer` prop wiring — reuse the annotation-parity adapter for
  diff blocks embedded in the explainer document.
- Plannotator `createGuideSession()` and agent-job shared types/SSE helpers — reuse guide command building, launch-time
  changed-file validation, guide result storage, and `/api/guide/*` contracts where compatible, adapting the output
  schema from section cards to explainer blocks.
- Existing Mermaid dependency in the Workspace toolchain — render Mermaid blocks client-side or via the established
  Workspace pattern if one exists.
- `src/ui/workspace/react/CodeReviewSurface.tsx` existing annotation creation/export — route Guided Review annotations
  through the same `annotations` state and `toWorkflowAnnotations()`/`exportReviewFeedbackWithImages()` path.
- RunWield Design System tokens (`--rw-*`) and `src/ui/workspace/react/plannotator.css` host classes — use for explainer
  block styling rather than introducing a separate visual language.

## Implementation Steps

- [ ] Step 1: Add the `guidedReview` setting.
  - Add `"guidedReview"` to `RUNWEILD_CUSTOM_SETTING_KEYS` in `src/shared/settings.js`.
  - Implement `getGuidedReviewMode(projectRoot)` with values `none`, `ask`, `auto`, `always`; default to `auto` when
    unset; treat invalid values as `none`.
  - Add schema/docs/tests for both global and project scopes, matching the existing `codereview` style.

- [ ] Step 2: Add a pure Guided Review recommendation helper.
  - Prefer a small exported helper in `validation.js` or a new local helper module if testability gets awkward.
  - Input should include Plan complexity, Plan attrs/body if needed for Epic/dependency context, diff text, and whether
    Semantic Code Review used the large-diff path.
  - Reuse `parseDiffFiles(diffText)` to compute changed-file count, added + removed changed lines, meaningful top-level
    areas, and low-signal-only diffs.
  - Return `{ recommended, score, reasons, stats }` where `reasons` are display-safe strings such as `HIGH complexity`,
    `12 changed files`, `940 changed lines`, `4 areas`, `child dependencies`, or `large diff path`.

- [ ] Step 3: Implement initial scoring thresholds.
  - `+3` Plan Complexity is `HIGH`.
  - `+2` Plan Complexity is `MEDIUM`.
  - `+2` Semantic Code Review used the large-diff path.
  - `+2` changed files `>= 8`.
  - `+2` changed lines `>= 800`.
  - `+1` changed files `>= 4`.
  - `+1` changed lines `>= 300`.
  - `+2` child FEATURE has declared dependencies.
  - `+1` child FEATURE belongs to an Epic, if Epic context is available.
  - `+2` changed files span `>= 3` meaningful top-level areas.
  - `+1` highly visual/UI/game-related affected paths or Plan language, as a hint that diagrams/widgets may help.
  - `-3` changes are only docs, Plan markdown, lockfiles, generated files, vendored files, or other low-review-signal
    paths.
  - Recommend generation at score `>= 4`.

- [ ] Step 4: Define and validate the `GuidedReviewExplainer` schema.
  - Replace or version Plannotator's current `CodeGuideOutput` shape with a schema that supports `prose`, `callout`,
    `mermaid`, `diff`, `widget`, and `reviewCheckpoint` blocks.
  - Validate all diff refs against launch-time changed files; drop or fail closed on fabricated file refs.
  - Validate Mermaid blocks as text only; rendering errors should show an error callout while preserving the rest of the
    guide.
  - Validate widget declarations against generated widget files and asset allowlists.
  - Preserve coverage: every changed file appears either in a placed `diff` block or in `everythingElse`.

- [ ] Step 5: Rewrite the guide generation prompt.
  - Ask for an explanatory document, not a file summary.
  - Include examples of useful Mermaid diagram families: data flow, sequence, state machine, simplified UI composition,
    game loop/timeline, and dependency graph.
  - Instruct the model to use widgets only when required for visual/interactive understanding and to include a reason
    for each widget.
  - Emphasize conceptual ordering: core implementation first, consequences/behavior/data flow next, support/glue last.
  - Prohibit decorative widgets, fabricated files/hunks, external network dependencies, and production-code claims not
    grounded in the diff/Plan.

- [ ] Step 6: Wire policy into Workflow Validation.
  - Import/use `getGuidedReviewMode()` next to `getCodeReviewMode()`.
  - After Semantic Code Review approval and before the human review launch, read both settings and compute the
    recommendation once for the current diff.
  - If `codereview` is `none` or the user skips `codereview: ask`, do not prompt or auto-generate a Guided Review.
  - For `guidedReview: none`, pass a disabled-auto policy while preserving manual generation in the browser.
  - For `guidedReview: ask`, prompt only when the recommendation passes; if declined, still open plain Diff review with
    manual generation available.
  - For `guidedReview: auto`, auto-start only when the recommendation passes.
  - For `guidedReview: always`, auto-start whenever human review opens, with reasons such as `guidedReview: always` plus
    stats.
  - Add system messages and `workflowMetrics` events for policy decision and generation outcome, avoiding diff text,
    prompts, secrets, absolute paths, widget source text, and detailed cost payloads.

- [ ] Step 7: Extend the code-review and launcher payloads.
  - Add JSDoc typedefs for the guide recommendation/policy object in pure JavaScript style.
  - Pass the guide policy from `runValidationLoop()` to `runPlannotatorCodeReview()` to `startCodeReviewSurface()`.
  - Include the policy in the Workspace review payload as a small object, e.g. `{ mode, autoStart, reasons, stats }`.
  - Keep `normalizeCodeReviewDecision()` unchanged except for tests proving guide annotations remain normal annotations
    in the returned decision.

- [ ] Step 8: Add Workspace review-agent/guide host support.
  - Audit direct imports from Plannotator's server/Pi modules under Deno. If direct reuse fails due Bun/node runtime
    assumptions, extract or wrap only the small agent-job/guide pieces needed by `createReviewWorkspaceApp()`.
  - Add authenticated routes for `/api/agents/capabilities`, `/api/agents/jobs`, `/api/agents/jobs/stream`, job kill,
    `/api/guide/:jobId`, `/api/guide/:jobId/reviewed`, and explainer retrieval.
  - Build guide commands server-side only; never spawn client-supplied command arrays for `guide` or marker providers.
  - Stamp jobs to the current local diff context and validate guide output against the launch-time changed-file set.
  - Kill all running guide jobs and clean disposable widget files when the ephemeral review server stops or the review
    exits.
  - Ensure failure leaves plain Diff review usable and surfaces retry/manual generation.

- [ ] Step 9: Add sandboxed widget support.
  - Store generated widget HTML/CSS/JS/assets in a disposable gitignored location under `.wld/` or another local runtime
    directory, never in tracked source by default.
  - Serve widget entrypoints and declared local assets only through review-token-protected routes.
  - Render widgets in sandboxed iframes with scripts allowed but no forms, popups, top navigation, downloads, or
    external connections.
  - Enforce CSP such as `connect-src 'none'`, `form-action 'none'`, restricted `img-src`/`style-src`/`font-src` to the
    review asset routes, and no external origins.
  - Do not use broad `allow-same-origin` as the isolation mechanism. If browser constraints require a same-origin iframe
    for local assets, offset it with a narrow route namespace, strict CSP, token checks, and tests proving no external
    network access.
  - Provide widget data as embedded JSON or `postMessage`, not arbitrary fetch access.

- [ ] Step 10: Integrate Guided Review Explainers into `CodeReviewSurface.tsx`.
  - Replace the two-column guide view with a single-column explainer document renderer.
  - Always expose **Generate guided review** when a guide-capable provider is available, including `guidedReview: none`.
  - Label the action as an extra LLM call before launch.
  - On `autoStart`, launch one guide job after capabilities are known; guard against duplicate launches across React
    re-renders and HMR.
  - Keep the Diff review active while generation runs.
  - Show **Guided Review ready** without focus stealing; open the explainer only when clicked.
  - Render prose/callout/Mermaid/widget/diff blocks in the order supplied by the explainer JSON.
  - Render `everythingElse` at the bottom as plain live diff blocks.
  - Show elapsed time, provider/model, tokens, and cost if job state exposes them; otherwise show available stats and a
    clear “cost unavailable” state.
  - Preserve keyboard/accessibility behavior for switching between Diff and Guided Review and for reviewing embedded
    diff blocks.

- [ ] Step 11: Preserve feedback semantics.
  - Route annotations created in Guided Review diff blocks through the same `annotations` state used by plain Diff
    review.
  - Preserve Plannotator global comments and image attachments.
  - Confirm Send Feedback and Approve payloads include Guided Review annotations, global comments, and image attachments
    in the same shape as plain Diff annotations.
  - Add a regression test if the seam can be exercised in RunWield tests; otherwise document the manual verification in
    the implementation notes.

- [ ] Step 12: Update docs.
  - `docs/settings.md`: add a `guidedReview` section and settings table row.
  - `docs/plan-lifecycle.md`: mention Guided Review in Workflow Validation without adding Plan Status/Event semantics.
  - `docs/design-system.md`: add the explainer document pattern, callout style, Mermaid style, widget sandbox pattern,
    and LLM-call disclosure/ready-notice pattern.

## Verification Plan

- Automated:
  - `deno test -A src/shared/settings.test.js`
  - `deno test -A src/shared/workflow/code-review.test.js src/shared/workflow/review-launcher.test.js src/shared/workflow/validation.test.js`
  - `deno test -A src/ui/workspace/workspace.test.js`
  - `deno task check`
  - `deno task workspace:check`
  - `deno task workspace:react:check` if additional Workspace React/TSX code is touched (currently aliases
    `workspace:check`)
  - `deno task ci`
- Manual/headed browser:
  - Start the Workspace dev server with `deno task workspace:dev` at `http://localhost:5173/`.
  - Use `http://localhost:5173/dev/code-review` or a targeted dev fixture to verify visible states for no guide
    provider, manual generation available, generation running, guide ready, failed generation, plain Diff view, and
    explainer view.
  - Verify explainer fixtures with prose, callouts, Mermaid diagrams, live diff blocks, `everythingElse`, and a
    sandboxed widget block.
  - Verify Mermaid render failures show a localized error without breaking the rest of the document.
  - Verify widget iframe cannot make external network/fetch/websocket requests, cannot navigate the parent/top frame,
    and can load only declared local review assets.
  - Also verify the real validation-time review flow by launching a human code review from RunWield, because production
    code review is an ephemeral local review server with a tokenized `/review/code` URL.
  - Small/LOW review: set `codereview: always`, `guidedReview: auto`, open review for a small diff, confirm Diff opens,
    no guide auto-starts, and manual **Generate guided review** is visible with an LLM-call disclosure.
  - Threshold-passing review: use HIGH Complexity or a large/cross-area/visual diff, confirm RunWield emits a reasoned
    system message, generation starts, Diff remains active and usable, and completion shows **Guided Review ready**
    without stealing focus.
  - `guidedReview: ask`: confirm RunWield prompts only when thresholds pass; decline keeps manual generation available;
    accept starts generation.
  - `guidedReview: none`: confirm no prompt/auto-start, but manual generation remains available when the guide provider
    is available.
  - `codereview: none`: confirm no human review or Guided Review opens at all.
  - Add annotations in Guided Review diff blocks and plain Diff, add a global comment with an image, send feedback, and
    confirm Engineer receives combined feedback in the existing human-review repair flow.
  - Check browser console/network for failed guide endpoints, failed Mermaid rendering, failed widget asset loads,
    duplicate auto-start launches, or accessibility regressions on Generate/ready/explainer controls.

## Edge Cases & Considerations

- **Current runtime path:** RunWield code review is Workspace-hosted by default. Editing only compiled or legacy
  Plannotator review-server code will not change validation-time behavior unless `startCodeReviewSurface()` actually
  serves that path.
- **Schema migration:** Existing Plannotator `CodeGuideOutput` is section/diff oriented. Either version the schema or
  add an adapter so old guide outputs fail gracefully instead of crashing the review UI.
- **Deno vs Plannotator server runtime:** Plannotator server/Pi agent-job modules include Bun/node assumptions. Reuse
  them through a thin Deno-compatible adapter, or extract the minimal compatible pieces; do not introduce broad runtime
  migration work in this feature.
- **No focus stealing:** Plannotator's full review app auto-opens completed guide jobs. RunWield-origin reviews must
  suppress that behavior so auto-generation only announces readiness.
- **Human review gate remains authoritative:** `guidedReview` never opens a review when `codereview` disables or skips
  human review.
- **No Plan Front Matter persistence:** do not add `guideGeneratedAt`, token counts, model names, guide job IDs, widget
  paths, or guide decisions to Plan Front Matter. Coarse workflow metrics are okay if they avoid sensitive payloads.
- **Widget slop risk:** The prompt and UI should make widgets exceptional. Decorative or generic widgets are a product
  failure even if they are technically valid.
- **Widget security:** Treat generated widget HTML/CSS/JS as untrusted. Token-gate it, serve it from disposable storage,
  apply strict CSP, block external connections, restrict local assets to an allowlist, and clean it up with the review
  server.
- **Cost accuracy:** display exact token/cost data only when available from job state. If unavailable, disclose that the
  action is an extra LLM call without estimating spend.
- **Large diffs and partial patches:** guide jobs must use the same launch-time diff context as the review surface so
  file references remain valid even if the user switches views while generation runs.
- **Low-signal diffs:** docs-only, Plan-only, lockfile-only, generated, or vendored changes should generally avoid
  automatic generation unless `guidedReview: always` is configured.
- **Language strictness:** keep RunWield core source in `.js` with JSDoc typedefs. TypeScript syntax is allowed only in
  `src/ui/workspace/` files such as React `.tsx` islands.
- **Out of scope:** using Guided Review for Plan approval/review, replacing plain Diff review, adding new Plan Statuses
  or Plan Events, persisting guide data in Plan Front Matter, and building an unrelated production widget framework.
