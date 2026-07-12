---
planId: "cc6000b2-35df-42b0-b141-03e81161afe0"
classification: "FEATURE"
complexity: "HIGH"
summary: "Bring the Workspace-hosted Plan Review surface to functional and visual parity with Plannotator, following the required priority order. This is multi-file frontend work spanning the React review composition, Plannotator component/provider integration, styling, decision transport, workflow launch wiring, and browser-backed verification; the current tree only has a basic Plannotator plan-body bridge and still defaults workflow reviews to the compiled server."
affectedPaths:
    - "src/ui/workspace/pages/review/plan.astro"
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/react/plannotator.css"
    - "src/ui/workspace/routes/api/review-handlers.js"
    - "src/ui/workspace/server.js"
    - "src/shared/workflow/review-launcher.js"
    - "src/ui/workspace/workspace.test.js"
    - "third_party/plannotator/packages/editor/App.tsx"
frontend: true
devServerCommand: "deno task workspace:dev:plan-review"
devServerUrl: "http://localhost:5173/dev/plan-review"
devServerHmr: true
createdAt: "2026-07-09T17:11:07-04:00"
updatedAt: "2026-07-12T13:45:16.085Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-10T06:26:49.981Z"
verifiedAt: "2026-07-12T13:45:16.085Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "plan review parity"
---

# Workspace Plan Review Parity

## Context

This is a focused follow-up to
`plans/workspace-astro-react-plannotator-migration/03-workspace-hosted-plan-and-code-review-surfaces.md`. It covers only
the **Plan Review Surface** required features, in their documented priority order; code-review parity remains out of
scope.

Execution will start from a fresh worktree based on updated `main`, after the completed Workspace migration has landed
there. This Plan assumes `main` contains the Astro review route, React `PlanReviewSurface`, token-protected review APIs,
Workspace review server, and workflow launcher delivered by that migration; if those prerequisites are absent, execution
must stop before editing rather than recreate or partially merge them. A headed comparison at 1440×1000 found that the
current dev surface starts 139 px below the viewport in a rounded Workspace card with a 75 px custom header, while
Plannotator uses a full-viewport surface and a sticky 48 px header. The current dev wrapper also adds an unrelated page
heading above the review.

Source and browser inspection found functional gaps in addition to styling drift:

- both the collapsed `SidebarTabs` and open `SidebarContainer` render at the same time; close/toggle callbacks are
  no-ops;
- the resize handles are not connected to `useResizablePanel`, so sidebars cannot be resized or collapsed as in
  Plannotator;
- `OverlayScrollArea` is not connected to `ScrollViewportContext`/`useActiveSection`, so Contents navigation and active
  heading tracking do not have the upstream scroll behavior;
- the toolstrip changes local state, but `Viewer` is hard-coded to `mode="comment"` and receives no `inputMethod`, so
  visible annotation controls do not consistently change Viewer behavior;
- annotations are displayed locally but are not composed into the feedback sent by Approve/Send Feedback;
- highlighted-text comments and quick labels are present in pinned `Viewer`, but the hard-coded Viewer mode prevents the
  surface from reliably exercising them;
- image attachments cannot work because the Workspace review server does not implement Plannotator's token-protected
  `/api/upload` and `/api/image` contracts, and the scaffold disables images in its header feedback popover;
- the right sidebar uses a custom text reopen button instead of Plannotator's header-positioned annotation toggle;
- submission controls do not expose a shared pending state, and rejected submissions can leave unhandled UI paths;
- `Settings` ignores the supplied `allowedTabs` and `showIntegrations` props because upstream does not define them, so
  Files, Saving, Hooks, Obsidian, Bear, and Octarine remain visible despite the scoped requirements;
- the dev fixture is too small to prove tables, code, HTML, diagrams, long scrolling, checkbox mutation, annotation
  selection, or responsive behavior;
- the Approve dropdown is populated with a hard-coded `Build`/`Engineer`/`Router` list, although Engineer is RunWield's
  only Plan executor and the Review Loop has no valid `agentSwitch` consumer;
- browser Exit resolves an `exit` decision, but `submitPlanForReview` currently treats it like ordinary feedback and may
  transition the Plan instead of canceling the Review Loop.

Product intent comes from the User Request, the required feature list in child Plan 03, and ADR-007's 2026-07 amendment.
The target should reuse pinned Plannotator components and geometry while keeping canonical Plan files, Plan Lifecycle,
token protection, and the selected `wld` theme under RunWield ownership.

## Objective

Deliver a full-viewport Workspace Plan Review surface whose information architecture, density, control placement,
sidebar behavior, document rendering, annotation workflow, editing, settings, completion, and responsive behavior are
recognizably equivalent to Plannotator's Plan review for the in-scope features.

Every visible control must be functional. In-scope annotation parity means highlighted-text annotations, global
comments, image attachments, and configured quick-label annotations, with edit and delete behavior; there is no separate
resolved state or resolved-history model. Annotations, attachments, and edited markdown must reach the decision payload.
Approve, Send Feedback, and Exit must resolve the Review Loop once with an explicit success/error state. Files, Archive,
AI, terminal/agent talk, integrations, linked documents, Goal Setup, export/import, and other features excluded by child
Plan 03 must not appear.

## Approach

Refactor `PlanReviewSurface` around the same composition and state hooks used by pinned Plannotator's `editor/App.tsx`
rather than approximating its layout with a custom CSS grid. Keep the integration shallow: compose `Viewer`,
`MarkdownEditor`, `AnnotationToolstrip`, Contents-only sidebar components, `AnnotationPanel`, toolbar buttons,
`CompletionOverlay`, `Settings`, `OverlayScrollArea`, and resize/sidebar hooks directly, without importing the full
Plannotator app and its out-of-scope backends.

Use a 48 px sticky header and full-height flex content region matching Plannotator's panel geometry. Brand the header as
RunWield and map colors through the existing `--rw-*` theme bridge. Preserve upstream Tailwind classes for component
internals and restrict custom CSS to the Workspace host, token aliases, print behavior, and responsive integration
seams.

Treat annotation state as decision data, not display-only state. Feed the selected toolstrip mode/input method into
`Viewer`, keep selection synchronized with `AnnotationPanel`, maintain `globalAttachments`, and format highlighted,
global, image, and quick-label feedback with Plannotator's existing parser utilities before posting. Match Plannotator's
header behavior: Send Feedback submits the current annotation/edit payload and opens an “Add Feedback First” dialog when
there is none; global comments and images are created from the Viewer action bar and annotation popovers rather than a
second header-only comment model. Keep edited markdown in the approve/deny body so `submitPlanForReview` can persist it
to the canonical Plan file.

Add the small media boundary that direct Plannotator component reuse expects. On the valid tokenized review-page
response, set a short-lived, HttpOnly, SameSite=Strict review cookie so nested image/upload requests can authenticate
without exposing the token in every image URL. The fixture route must set the fixed dev-review cookie and expose
DEV-only Astro API endpoints so the same attachment flow works under the direct HMR command; workflow mode continues to
use the RunWield server wrapper. Implement size/type-limited multipart upload to an OS temporary path and read-only
image serving for supported image paths, both scoped to the active review token. Preserve uploaded files long enough for
the Planner to read paths referenced in submitted feedback; rely on OS temporary-file cleanup rather than deleting them
when the ephemeral HTTP server stops.

Extend pinned `Settings` with a backward-compatible optional tab filter/integration visibility API. Its existing callers
must retain current defaults; the Workspace Plan Review caller will opt into exactly General, Display, Labels, and
Shortcuts.

The existing token-protected server/API boundary remains the decision authority. Tighten only the Plan decision shape
and Review Loop handling needed to make edited content, feedback, Exit, and the chosen Approve behavior observable end
to end.

**Confirmed product decisions:** execute from a fresh worktree based on updated `main`; use Plannotator's geometry,
density, and interaction patterns with RunWield branding and the selected `wld` theme; replace the inert
`ApproveDropdown` with a plain working `ApproveButton` because Engineer is the only Plan executor. This Plan does not
introduce post-review Agent switching.

## Files to Modify

- `src/ui/workspace/react/PlanReviewSurface.tsx` — rebuild the Plan review composition around Plannotator's header,
  scroll, sidebar, resize, Viewer/editor, annotation, submission, settings, and completion patterns; remove hard-coded
  and no-op controls.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — make the dev route render the real surface without an outer page
  header and expand its Plan fixture to exercise every supported document and interaction state.
- `src/ui/workspace/react/plannotator.css` — replace card/grid approximation styles with full-viewport host integration,
  exact 48 px header/panel geometry, RunWield token aliases, print rules, and narrow/mobile behavior; avoid overriding
  pinned component internals unnecessarily.
- `src/ui/workspace/layouts/ReviewLayout.astro` — ensure the review island owns the full viewport without inherited
  Workspace spacing or extra landmarks, while retaining theme/token styles and safe payload hydration.
- `src/ui/workspace/pages/review/plan.astro` — set the review media cookie only from the payload injected by the
  token-validating Workspace wrapper before hydrating the workflow surface.
- `src/ui/workspace/pages/dev/plan-review.astro` — set the fixed development review cookie while retaining the DEV
  guard.
- `src/ui/workspace/pages/api/upload.js` and `src/ui/workspace/pages/api/image.js` — DEV-only Astro adapters over the
  shared media handlers so direct HMR exercises image annotations; production workflow requests remain owned by
  `server.js`.
- `third_party/plannotator/packages/ui/components/Settings.tsx` — add optional allowed-tab and integration visibility
  controls with unchanged defaults for existing Plannotator callers.
- `src/ui/workspace/routes/api/review-handlers.js` — preserve edited Plan/feedback/exit fields in normalized Plan review
  decisions, share review-token extraction with media requests, and continue enforcing one decision per valid token.
- `src/ui/workspace/routes/api/review-media-handlers.js` — add token-scoped multipart image upload and safe image
  serving compatible with pinned `AttachmentsButton`/`ImageThumbnail` requests.
- `src/ui/workspace/server.js` — register `/api/upload` and `/api/image` only in review mode, issue the review cookie
  only after a valid tokenized page request, and carry cwd/token state into media handlers without weakening Workspace
  routes.
- `src/shared/workflow/submit-plan.js` — persist edited markdown and distinguish browser Exit/cancel from Feedback; do
  not add Agent-switch handling to the Review Loop.
- `src/shared/workflow/submit-plan.test.js` — cover edited-plan persistence, annotation/global feedback delivery,
  successful approval, and no-lifecycle-transition Exit cancellation.
- `src/ui/workspace/workspace.test.js` — extend review API tests for Plan approve, deny, exit, token rejection,
  duplicate decisions, and normalized payload fields.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `third_party/plannotator/packages/editor/App.tsx` — canonical composition reference for the 48 px header, flex panel
  layout, `ScrollViewportContext`, active section tracking, sidebar state, resizable panels, Viewer/editor switching,
  feedback formatting, direct-edit detection, and completion behavior.
- `third_party/plannotator/packages/editor/directEdits.ts` — `buildDirectEditsSection`,
  `composeFeedbackWithEditSections`, and `buildPlanEditPanelItem` for making MarkdownEditor changes visible in feedback
  and the right panel rather than silently relying on Plan-file replacement.
- `third_party/plannotator/packages/editor/components/AppHeader.tsx` — canonical toolbar spacing and control ordering;
  reproduce only the in-scope controls rather than importing its large out-of-scope prop surface.
- `third_party/plannotator/packages/ui/hooks/useSidebar.ts` — Contents open/close/toggle behavior.
- `third_party/plannotator/packages/ui/hooks/useResizablePanel.ts` and
  `third_party/plannotator/packages/ui/components/ResizeHandle.tsx` — persisted sidebar widths, reset, collapse, and
  drag-to-close behavior.
- `third_party/plannotator/packages/ui/hooks/useOverlayViewport.ts`,
  `third_party/plannotator/packages/ui/hooks/useActiveSection.ts`, and
  `third_party/plannotator/packages/ui/hooks/useScrollViewport.ts` — shared scroll element and Contents navigation.
- `third_party/plannotator/packages/ui/utils/parser.ts` — `parseMarkdownToBlocks`, `extractFrontmatter`, and
  `exportAnnotations` for render/feedback parity.
- `third_party/plannotator/packages/ui/components/Viewer.tsx`, `AttachmentsButton.tsx`, `ImageThumbnail.tsx`, and
  `MarkdownEditor.tsx` — highlighted/global/labeled/image annotations, attachment request contracts, block rendering,
  checkbox rendering, and direct markdown editing.
- `third_party/plannotator/apps/pi-extension/server/handlers.ts` — behavior reference for supported image extensions,
  multipart upload responses, image content types, and feedback-readable temporary paths; reimplement the boundary in
  Deno/Workspace code rather than importing Node HTTP handlers.
- `src/ui/design-system/theme-bridge.js` and review `/theme.css` — selected `wld` theme source; do not create a second
  review-only palette.
- `src/ui/workspace/routes/api/review-handlers.js` and `src/ui/workspace/server.js` — existing token-scoped, one-shot
  decision transport and timeout cleanup.

## Implementation Steps

- [ ] Confirm updated `main` contains the existing Workspace-hosted Plan Review files named in this Plan, then create a
      fresh execution worktree from `main`; stop before editing if the migration prerequisite is absent. Capture headed
      1440×1000 screenshots of `/dev/plan-review` and the compiled Plannotator Plan review with the same rich fixture so
      spacing, control placement, and panel dimensions have an explicit before/reference baseline.
- [ ] Replace the outer dev-page framing and `.rw-plannotator-host` card treatment with a full-viewport review root.
      Match Plannotator's sticky 48 px header, border rhythm, document padding/max width, panel surfaces, z-indexes, and
      scroll ownership while keeping the selected RunWield theme variables.
- [ ] Recompose the header in Plannotator order: RunWield identity on the left; Exit/cancel, Send Feedback, plain
      `ApproveButton`, separator, annotation toggle/count, and Options on the right. Remove `REVIEW_AGENTS`,
      `ApproveDropdown`, and all `agentSwitch` UI/payload behavior. Add shared `isSubmitting` and `isExiting` state,
      disable duplicate decisions, show actionable errors, and display `CompletionOverlay` only after a successful
      response.
- [ ] Replace no-op Contents wiring with `useSidebar(false, "toc")`. Render `SidebarContainer` only while open and
      `SidebarTabs` only while closed; expose Contents only; wire close/toggle behavior, persisted width, resize handle,
      collapse, and responsive visibility through the upstream hooks/components.
- [ ] Make `OverlayScrollArea` the single document scroll owner. Capture its viewport with `useOverlayViewport`, provide
      it through `ScrollViewportContext`, and derive `activeSection` with `useActiveSection` so Contents clicks scroll
      to headings and scrolling updates the active Contents row.
- [ ] Wire `AnnotationToolstrip` state into `Viewer` (`mode` and `inputMethod`) and keep `selectedAnnotationId`
      synchronized between selection highlights and `AnnotationPanel`. Support highlighted-text comments, global
      comments, quick-label annotations, annotation images, and global image attachments; include attachments in the
      annotation count and export. Verify add, select/navigate, edit, and delete behavior. Do not add a resolved
      state/history, and do not expose sharing, AI, linked-doc, or code-popout actions.
- [ ] Preserve complete Viewer behavior for headings, paragraphs, nested/ordered lists, task checkboxes, fenced code,
      tables, sanitized HTML, diagrams/math, long content, and selection toolbars. Keep checkbox changes in the edited
      Plan text and ensure they survive Viewer/editor toggles.
- [ ] Replace the custom two-button mode strip with Plannotator's compact View/Edit affordance and semantics. Retain the
      initially reviewed markdown as the diff baseline; ensure `MarkdownEditor` mounts with stable document identity,
      updates Plan state, does not lose text when toggled, and returns edited markdown through Approve or Feedback for
      canonical Plan persistence. Reuse `directEdits.ts` to expose the edit diff in submitted feedback and as a
      direct-edits item in `AnnotationPanel`.
- [ ] Remove the scaffold's header-anchored `CommentPopover` feedback model. Derive `hasFeedback` from annotations,
      global attachments, and direct Plan edits; make Send Feedback show Plannotator's “Add Feedback First” dialog when
      empty, otherwise submit `exportAnnotations(...)` output. Include the same payload on approve-with-notes, keep
      empty approval feedback undefined, and verify the server resolves each token exactly once.
- [ ] Implement review media support: authenticate nested requests via a cookie issued only after the tokenized review
      page succeeds; accept one supported image file per multipart upload with an explicit size limit; write it under
      the OS temp directory; return `{ path, originalName }`; serve supported local/temporary image paths with the
      correct content type, `nosniff`, no-store caching, and SVG sandboxing (or reject SVG if it cannot be served
      safely). Register the handlers in workflow review mode and add DEV-only Astro endpoint adapters plus the fixed dev
      cookie so HMR uses the identical upload/read implementation. Return clear 400/401/403/404/413 responses and never
      expose non-image files.
- [ ] Add backward-compatible `allowedTabs`/`showIntegrations` behavior to pinned `Settings`; guard active-tab state
      when filtering changes; configure the Workspace surface to show exactly General, Display, Labels, and Shortcuts.
      Keep theme selection and Print/Save PDF in Options, with integrations and all excluded Plan features absent.
- [ ] Normalize browser Exit as Review Loop cancellation: resolve/stop the review, leave the Plan's current Plan Status
      unchanged, avoid recording `review_feedback`, and return a canceled result consistent with TUI Escape.
- [ ] Expand automated review transport/workflow tests to cover valid/invalid/expired tokens, approve with edited Plan
      and highlighted/global/labeled/image feedback, deny with composed feedback, authenticated image upload/read,
      unsupported/oversized/non-image rejection, Exit cancellation, duplicate submission rejection, cleanup, and
      unchanged compiled-server injection behavior.
- [ ] Expand the dev fixture with front matter, long headings, nested lists, task checkboxes, code, table, sanitized
      HTML, diagram/math content, and enough vertical content to test active Contents tracking. Keep dev decisions
      observable without mutating workflow state.
- [ ] Remove any dead CSS, hard-coded agent list, unsupported props, no-op callbacks, and decorative controls left by
      the scaffold. Confirm the code-review surface is visually and functionally unchanged by shared CSS or pinned
      component changes.

## Verification Plan

- Automated: run `deno task -q workspace:check` to type/build the Astro/React/Plannotator surface and catch invalid
  component contracts.
- Automated: run `deno task -q workspace:test` for review API, Workspace server, route, and Plan decision tests.
- Automated: run targeted workflow tests with
  `deno test -A src/shared/workflow/submit-plan.test.js src/shared/workflow/code-review.test.js` to prove Plan Review
  persistence/cancel semantics and code-review non-regression.
- Automated: run `deno task -q check` and the repository's formatter/linter checks required by CI; finish with
  `deno task -q ci` when the focused checks pass.
- Manual/headed browser: start `deno task workspace:dev:plan-review`, open `http://localhost:5173/dev/plan-review` with
  `agent-browser --headed`, and verify at 1440×1000 against the compiled Plannotator reference screenshot: full
  viewport, 48 px header, equivalent panel widths/density, matching control locations, no extra dev-page chrome, and
  RunWield theme colors.
- Manual/headed browser: exercise Contents open/close, resize, reset/collapse, click-to-heading navigation, active row
  while scrolling, annotation panel toggle/count, highlighted-text comment, global comment, quick label, per-annotation
  image, global image upload/paste/preview/delete through the HMR API adapters, annotation edit/delete, empty-feedback
  prompt, direct-edit diff in feedback/right panel, task checkbox mutation, View/Edit/View round-trip, Options theme
  changes, print mode, and exactly the four allowed Settings tabs.
- Manual/headed browser: check 1440×1000, 1024×768, and 390×844. Confirm sidebars become usable mobile overlays or
  collapsed controls, toolbar actions remain reachable, dialogs/popovers fit, long content does not overlap, and
  keyboard focus/Escape behavior is visible and ordered.
- Manual/headed browser: inspect the accessibility snapshot for named toolbar/sidebar controls; check console errors,
  page errors, and failed fetches after each interaction; save before/after/reference screenshots as verification
  artifacts.
- Manual/workflow: launch a real `plan_written` Review Loop and verify (a) highlighted/global/labeled feedback and image
  paths reach the Planner in readable exported feedback, (b) uploaded images remain readable after the ephemeral server
  stops, (c) edited markdown is written back to the same canonical Plan file, (d) Approve proceeds to the existing
  save-vs-execute prompt, and (e) Exit returns without changing Plan Status.
- Expected: every control visible in the scoped Plan Review surface changes state or completes a workflow action; no
  Files, Archive, AI, terminal, integrations, linked-document, Goal Setup, or export/import UI appears; code review and
  the public `wld plans ui` Workspace remain unchanged.

## Edge Cases & Considerations

- The Plan depends on the completed Workspace migration already being present on `main`. The first execution check must
  fail closed if the named Astro/React review files are absent, rather than silently broadening this feature into a
  migration or merge task.
- Filtering `Settings` is a pinned shared-component API change. Defaults must preserve the full existing Plannotator
  settings set for editor/code-review callers, and the active tab must fall back safely if a caller excludes it.
- Review media routes are a local file boundary. Require the active review token for upload and read, allow only
  reviewed image extensions/content types and bounded sizes, prevent directory listing/non-image reads, and never serve
  active content without sandboxing and `nosniff` headers.
- Uploaded images cannot be deleted at server shutdown because the Planner receives filesystem paths after the Review
  Loop. Use a dedicated OS temp prefix and document that normal OS cleanup owns retention; do not place uploads in the
  repository or canonical Plan tree.
- Plannotator annotations use block IDs derived from parsed markdown. Editing can invalidate anchors; either clear/remap
  affected annotations using the upstream strategy or warn before carrying stale anchors across edited content. Do not
  silently submit annotations against the wrong text.
- `MarkdownEditor` reads initial markdown at mount. Use a stable-but-content-appropriate `documentId`/remount policy and
  the editor handle so View/Edit transitions neither reset changes nor display stale external content.
- Submission must be one-shot and race-safe. Disable all decision buttons while pending; a failed request must restore
  controls and preserve edits/feedback for retry; a successful decision must prevent further POSTs.
- Print must hide toolbars/sidebars/popovers and print the document at a readable width without losing RunWield theme
  contrast.
- Browser auto-close can fail when the tab was not script-opened; `CompletionOverlay` must retain a clear manual close
  message.
- The review token may appear in the URL for the local ephemeral server, but must not be logged into rendered Plan
  content, persisted settings, feedback, or artifacts.
- No new code-review functionality, Plannotator AI backend, integration backend, sharing, Files/Archive data source, or
  Plan Lifecycle rule is part of this Plan.
