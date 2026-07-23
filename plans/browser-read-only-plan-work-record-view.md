---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Open Plans and Work Records from their CLI read commands in a shared Workspace read-only browser surface with Contents navigation and Close-only workflow controls."
affectedPaths:
    - "src/cmd/plans/read.js"
    - "src/cmd/plans/read.test.js"
    - "src/cmd/wr/index.js"
    - "src/cmd/wr/index.test.js"
    - "src/cmd/registry.js"
    - "src/ui/review/review-launcher.js"
    - "src/ui/review/review-launcher.test.js"
    - "src/ui/workspace/pages/review/plan.astro"
    - "src/ui/workspace/react/ArtifactReadSurface.tsx"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/ui/workspace/react/review-types.ts"
    - "src/ui/workspace/react/plannotator.css"
    - "src/ui/workspace/workspace.test.js"
    - "third_party/plannotator/packages/ui/components/Viewer.tsx"
    - "README.md"
    - "docs/usage.md"
    - "docs/user-facing-features.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev:plan-review"
devServerUrl: "http://127.0.0.1:5173/dev/plan-review"
devServerHmr: true
createdAt: "2026-07-23T10:12:55-04:00"
updatedAt: "2026-07-23T15:23:27.845Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-23T15:23:27.845Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Browser Read-Only Plan and Work Record View

## Context

`wld plans read <plan-name-or-id>` and `wld wr read <recordId>` currently print canonical Markdown to the terminal. The
requested behavior is to inspect either artifact in RunWield's Workspace browser UI based on Plannotator, while keeping
only the Contents sidebar and rendered document. The read surface must not expose the annotation sidebar, annotation
toolstrip, editor, mutable checkboxes, Feedback, or Plan approval actions.

## Objective

Make both CLI read commands resolve their artifact exactly as they do today, then open its canonical Markdown in one
shared, token-protected, ephemeral read-only browser surface. Label the surface as a Plan or Work Record, preserve Work
Record maintenance notices, and provide a top-right Close action that ends the temporary server, attempts to close the
tab, and leaves a manual-close fallback when the browser blocks `window.close()`.

## Approach

Add an explicit read-only Markdown artifact mode behind the existing Workspace review-launcher/server seam rather than
creating a second renderer or using the Plan Board detail route. Keep the existing `/review/plan` transport and
`/api/review/exit` one-shot decision lifecycle internally, but pass presentation metadata that selects a dedicated
`ArtifactReadSurface` instead of `PlanReviewSurface`.

The dedicated surface will reuse Plannotator parsing, `SidebarContainer`, `Viewer`, scrolling, and RunWield theme/CSS.
Extend the vendored `Viewer` with an explicit read-only capability so annotation highlighter, pinpoint/code annotation
interactions, global-comment controls, and checkbox mutation are disabled behaviorally—not merely hidden. Existing Plan
Review and remote review callers retain their current defaults.

## Files to Modify

- `src/cmd/plans/read.js` and `src/cmd/plans/read.test.js` — preserve active/archived name and stable-ID resolution, but
  launch and await the browser read surface with the resolved full Markdown and path instead of printing it.
- `src/cmd/wr/index.js` and `src/cmd/wr/index.test.js` — pass the hydrated Work Record's canonical Markdown, title,
  path, and notices to the same browser surface while preserving validation and `accessMode: "all"` lookup.
- `src/ui/review/review-launcher.js` and `src/ui/review/review-launcher.test.js` — add the shared read-surface launcher
  contract, browser-open result/URL reporting, active-surface cleanup, and Close-driven wait/stop lifecycle without
  invoking Plan Lifecycle behavior.
- `src/ui/workspace/pages/review/plan.astro`, `src/ui/workspace/react/ArtifactReadSurface.tsx`, and
  `src/ui/workspace/react/review-types.ts` — select and render the artifact-specific read mode, dynamic page/header
  labels, optional Work Record notices, Close request, and blocked-tab-close fallback.
- `third_party/plannotator/packages/ui/components/Viewer.tsx` — add an opt-in read-only prop that turns off all
  annotation creation and mutation paths while retaining rendering, Contents anchors, safe links, diagrams, images,
  selection/copy, and scrolling.
- `src/ui/workspace/react/plannotator.css` and `src/ui/workspace/react/ReviewDevSurface.tsx` — provide the two-column
  Contents/document layout, responsive styling, and Plan/Work Record development fixtures for headed-browser
  verification.
- `src/ui/workspace/workspace.test.js` — cover authenticated read payload delivery and one-shot Close/exit behavior at
  the Workspace server boundary.
- `src/cmd/registry.js`, `README.md`, `docs/usage.md`, and `docs/user-facing-features.md` — describe browser launch,
  read-only behavior, and Close lifecycle instead of terminal printing.

## Reuse Opportunities

- `src/ui/review/review-launcher.js` — reuse browser opening, active-surface registration, signal cleanup, and
  Workspace-hosted surface startup.
- `src/ui/workspace/server.js` and `src/ui/workspace/routes/api/review-handlers.js` — reuse token protection, ephemeral
  server startup, decision promises, and `/api/review/exit`; no separate artifact API or file-writing route is needed.
- `src/plan-store.js` — reuse `loadPlan`, `loadArchivedPlan`, `listArchivedPlans`, and `findPlanById`; their results
  already include full canonical Markdown.
- `src/shared/work-records/search.js` — reuse `readWorkRecordById`, whose hydrated result already includes canonical
  Markdown and maintenance notices.
- `src/ui/workspace/react/PlanReviewSurface.tsx` and Plannotator UI components — match the existing full-viewport theme,
  Contents navigation, centered document canvas, and responsive behavior without coupling read commands to review
  decisions.

## Implementation Steps

- [ ] Extend the review-launcher with a typed Plan/Work Record read-surface payload (`markdown`, artifact
      kind/title/path, notices, and explicit read presentation), start it through the current token-protected Workspace
      server, expose its URL/open result, and guarantee `stop()` in a `finally` block after Close, cancellation, or
      failure.
- [ ] Refactor `runPlansReadCommand` so every existing active, explicitly archived, archived-ID, and active-ID success
      path funnels into one browser-launch helper using the loaded object's `markdown`; preserve duplicate-ID and
      not-found errors and keep `--help` non-launching.
- [ ] Refactor the `wr read` branch to launch the same helper with the hydrated Work Record's `markdown`, title, path,
      and notices; preserve exact-argument/flag validation and all-state explicit access.
- [ ] Add `ArtifactReadSurface` and route selection for read payloads: render a dynamic Plan/Work Record header, Close
      as the only workflow action, visible Work Record notices, always-available Contents sidebar, centered rendered
      canonical Markdown, and no editor, annotation toolstrip/panel, Feedback, approval, or review settings.
- [ ] Implement Close as a token-authenticated one-shot exit request; disable it while pending, show a retryable error
      if exit fails, then attempt `window.close()` and show a clear manual-close state if the browser still owns the
      tab. Ensure the CLI unblocks and the ephemeral server stops after the successful exit.
- [ ] Add a default-off read-only option to Plannotator `Viewer` and guard annotation highlighter initialization,
      pinpoint/code/table annotation affordances, global comments/attachments, and checkbox callbacks while preserving
      ordinary text selection and non-mutating rendering. Verify existing Plan Review and remote review behavior remains
      unchanged when the prop is absent.
- [ ] Add focused command, launcher, server, and Viewer/read-surface regression coverage, including full Markdown/front
      matter forwarding, Work Record notices, resolution precedence, no writes/lifecycle events, opener failure URL
      recovery, Close cleanup, hidden controls, disabled annotation creation, and responsive Contents navigation.
- [ ] Update CLI help and user documentation to state that both read commands open a local read-only browser view and
      remain attached until Close or process cancellation.

## Verification Plan

- Automated: run
  `deno test -A src/cmd/plans/read.test.js src/cmd/wr/index.test.js src/ui/review/review-launcher.test.js src/ui/workspace/workspace.test.js`,
  `deno task workspace:check`, `deno task workspace:build`, then `deno task ci` and fix all failures.
- Manual: run the development read fixtures and use `agent-browser --headed` at desktop and mobile widths. Confirm the
  accessibility tree has a labeled Contents navigation, rendered document headings, and one Close workflow button;
  confirm Feedback/approval/editor/annotation controls and the annotation sidebar are absent.
- Manual: exercise `wld plans read` with active name, active Plan ID, explicit archived name, and archived Plan ID, plus
  `wld wr read` for current and maintenance-state records. Verify full Front Matter/body rendering, artifact-specific
  labels/path, prominent Work Record notices, heading navigation, safe scrolling/overflow, and RunWield theme
  consistency.
- Manual: select text, interact with code blocks/tables/checkboxes, and inspect DOM/network state to prove no annotation
  UI appears and no canonical file or lifecycle state changes. Click Close, verify the CLI returns and server stops, and
  verify either tab closure or the manual-close fallback. Check browser console, page errors, and failed requests before
  cleanup.
- Expected: browser-open failure prints the protected URL for manual opening and remains cancellable;
  malformed/missing/duplicate identifiers retain existing errors; ordinary Plan Review still supports annotation,
  editing, Feedback, and approval unchanged.

## Edge Cases & Considerations

- Browser security commonly blocks `window.close()` for externally opened tabs. A successful Close still resolves the
  CLI/server session first, then presents an in-page manual-close fallback if needed.
- Read-only must be enforced in component behavior, not only CSS. Do not mount active highlighters or pass mutating
  checkbox/attachment callbacks in read mode, and do not expose any save or Plan Lifecycle endpoint from the surface.
- Full canonical Markdown, including Front Matter, is the rendering source. Work Record notices are supplemental read
  warnings and must remain visible for draft, pending, superseded, or archived records.
- Keep current identifier resolution and archive precedence unchanged. This feature changes presentation, not Plan or
  Work Record retrieval semantics.
- Keep the token in the local launch URL and existing authenticated API requests; never log artifact plaintext. If the
  browser cannot open automatically, printing the tokenized local URL is the recovery path.
- The existing working tree contains unrelated changes, including another Plan file and `CONTEXT.md`; execution must not
  overwrite or fold those changes into this feature.
