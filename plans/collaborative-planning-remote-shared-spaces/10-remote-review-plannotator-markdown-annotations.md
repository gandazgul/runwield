---
planId: "471cc79f-7223-4316-b601-74407b73c47a"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Replace the remote Shared Space review UI's custom selection/comment components with Plannotator markdown annotation and renderer primitives while preserving encrypted comment payloads, revision scoping, and the pull/revise/push collaboration loop."
affectedPaths:
    - "src/ui/workspace/react/RemotePlanReview.tsx"
    - "src/ui/workspace/react/RemoteCommentPanel.tsx"
    - "src/ui/workspace/react/RemoteCommentPopover.tsx"
    - "src/ui/workspace/react/remote-review-payload.js"
    - "src/ui/workspace/react/plannotator.css"
    - "src/ui/workspace/static/workspace.css"
    - "src/ui/workspace/workspace.test.js"
    - "third_party/plannotator/packages/ui/"
frontend: true
devServerCommand: "RUNWIELD_WORKSPACE_MODE=remote RUNWIELD_REMOTE_DB_PATH=.wld/remote-workspace.sqlite deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-15T22:23:41-04:00"
updatedAt: "2026-07-16T14:29:12.453Z"
status: "implemented"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 10
dependencies:
    - "05-remote-browser-review-mvp"
    - "06-wld-plans-pull-maintainer-revision-flow"
    - "07-wld-plans-push-remote-revision-publish-flow"
failureReason: "Cannot stage validation_passed for collaborative-planning-remote-shared-spaces/10-remote-review-plannotator-markdown-annotations: primary Plan status is \"in_progress\", expected \"implemented\"."
worktreeId: "129a706d"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--/harns-runwield-collaborative-planning-remote-shared-spaces-10-r-129a706d"
worktreeBranch: "runwield/worktree/collaborative-planning-remote-shared-spaces-10-r-129a706d"
worktreeBaseBranch: "main"
worktreeStatus: "merge_conflict"
---

# Remote Review Plannotator Markdown Annotations

## Context

The remote Shared Space review MVP at `/p/:spaceId` works, but its browser annotation experience is still largely
custom. `RemotePlanReview.tsx` renders the Plan body through Plannotator `RenderedMarkdown`, then implements selection
capture, inline highlight restore, custom comment popover, custom comment sidebar, and custom remote CSS by hand. The
result is visibly different from the established Plannotator-backed local Review Loop, as shown in the supplied
screenshot: the selection and comment UI is functional but not the richer Plannotator markdown annotation experience.

RunWield already vendors Plannotator under `third_party/plannotator/` and the local `PlanReviewSurface.tsx` proves that
Workspace can reuse Plannotator `ThemeProvider`, `TooltipProvider`, `Viewer`, `MarkdownEditor`, `AnnotationPanel`,
`AnnotationToolstrip`, parser helpers, and review CSS within the `src/ui/workspace/` TypeScript/TSX exception zone.

This child FEATURE keeps the Epic invariants intact: remote servers store ciphertext only for Plan/comment semantic
content; reviewer and maintainer URLs stay accountless bearer-capability links; comments remain scoped to a single
Revision; and local Plan revision changes still happen through pull/revise/push rather than silent remote overwrites.

## Objective

Upgrade the remote Shared Space review page so it uses Plannotator's markdown annotation and markdown rendering
primitives instead of the current custom selection/comment components where they fit the remote review workflow.

Confirmed product scope: this slice must **not** add browser-side Plan body editing. The remote Revision workflow
remains pull → Planner/Architect revise locally → push. Plannotator `MarkdownEditor` can remain a reference/reuse
opportunity for future maintainer editing, but it should not be exposed as a remote body editor in this slice.

Acceptance criteria:

- Remote review renders Plan markdown through Plannotator's `Viewer`/parser-backed renderer, not the custom
  `RenderedMarkdown` plus hand-written DOM selection/highlight logic.
- Inline comments are created through Plannotator annotation affordances (`AnnotationToolstrip`, selection/pinpoint
  behavior, `CommentPopover` or the nearest compatible primitive) and displayed through Plannotator-style annotation
  sidebar/cards.
- The decrypted/encrypted remote comment payload remains compatible with `wld plans pull`: `schemaVersion`,
  `displayName`, `body`, `type`, `originalText`, anchor metadata, and `createdAt` stay inside the encrypted comment
  payload.
- Existing remote Review behavior remains: revision switching, display-name capture, global comments, inline comments,
  resolve/reopen, closed-space read-only mode, wrong-key/tampered-comment handling, and no push/close/delete browser
  controls.
- Plannotator styling is bridged back to RunWield theme tokens using the existing `plannotator.css`/RunWield Design
  System approach; do not create a separate Plannotator visual identity.
- The implementation does not send URL-fragment content keys or bearer capabilities to the server or display them in
  errors/logs.

## Approach

Refactor `RemotePlanReview.tsx` around the proven local `PlanReviewSurface.tsx` Plannotator composition, but keep the
remote data/security boundary owned by the remote review island.

Recommended model:

1. Keep `RemotePlanReview` responsible for parsing the collaboration URL fragment, creating the collaboration API
   client, importing the content key, fetching remote metadata/revisions/comments, decrypting and encrypting remote
   payloads, and mapping remote API failures to redacted UI messages.
2. Convert decrypted remote comments to Plannotator `Annotation` objects for rendering in `Viewer` and
   `AnnotationPanel`. Preserve remote-only fields such as `remoteCommentId`, `resolved`, `unreadable`, and
   `anchorMissing` in a thin local view model or annotation metadata so resolve/reopen still targets the server comment
   id.
3. Use Plannotator `parseMarkdownToBlocks`/`extractFrontmatter` and `Viewer` for the rendered Plan body and inline
   annotation behavior. Remove custom `readSelection`, `restoreInlineHighlights`, `highlightComment`,
   `rangeForTextOffsets`, and the custom `.rw-remote-inline-highlight` path once the Plannotator viewer owns highlights.
4. Use Plannotator `AnnotationToolstrip` for the comment input mode and `CommentPopover` for comment entry if its props
   are compatible. Keep the remote display-name input outside the popover unless a small wrapper can add it without
   forking the Plannotator component.
5. Use Plannotator `AnnotationPanel` or a small remote wrapper around it for the sidebar. If the stock panel cannot
   express remote resolved/unreadable states cleanly, wrap or lightly adapt rather than keeping the current custom
   `RemoteCommentPanel` as the primary UI.
6. Do not add browser-side remote Plan body editing. The Epic's current collaboration loop is still pull →
   Planner/Architect revise → push. Plannotator `MarkdownEditor` may be kept as a reference for a future maintainer
   editing slice, but remote browser body edits must not be exposed here.

## Files to Modify

- `src/ui/workspace/react/RemotePlanReview.tsx` — refactor the remote review island to use Plannotator parser/viewer,
  annotation toolstrip, popover/sidebar integration, and remote-to-Plannotator annotation mapping while preserving
  encrypted fetch/decrypt/submit/resolve behavior.
- `src/ui/workspace/react/RemoteCommentPanel.tsx` — remove, replace with a Plannotator `AnnotationPanel` wrapper, or
  reduce to a small adapter for remote-only resolved/unreadable controls.
- `src/ui/workspace/react/RemoteCommentPopover.tsx` — remove or replace with Plannotator `CommentPopover`; keep only a
  remote wrapper if display-name or closed-state behavior needs extra UI.
- `src/ui/workspace/react/remote-review-payload.js` — extend payload normalizers/builders to round-trip Plannotator
  annotation metadata (`blockId`, offsets, `startMeta`, `endMeta`) while preserving the existing schema consumed by
  pull.
- `src/ui/workspace/react/plannotator.css` — add/adjust remote-review bridge classes so Plannotator components inherit
  RunWield tokens and layout rules.
- `src/ui/workspace/static/workspace.css` — delete or shrink obsolete custom `.rw-remote-*` annotation/sidebar/popover
  styling; keep only remote page shell/layout states not covered by Plannotator CSS.
- `src/ui/workspace/workspace.test.js` — update/add route and helper tests covering remote review render smoke,
  encrypted payload mapping, revision scoping, closed-state controls, and local/remote route isolation.
- `third_party/plannotator/packages/ui/` — read-only reuse target. Do not modify vendored Plannotator unless a small
  compatibility fix is unavoidable and justified in the implementation notes.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/react/PlanReviewSurface.tsx` — known-good Workspace composition of Plannotator `ThemeProvider`,
  `TooltipProvider`, `Viewer`, `MarkdownEditor`, `AnnotationPanel`, `AnnotationToolstrip`, `OverlayScrollArea`, and
  `plannotator.css`.
- `third_party/plannotator/packages/ui/components/Viewer.tsx` — markdown block rendering, selection/pinpoint annotation
  behavior, inline highlights, image/checkbox hooks, and selected annotation behavior.
- `third_party/plannotator/packages/ui/components/CommentPopover.tsx` — keyboard-aware comment entry, anchoring, draft
  persistence, and accessible popover/dialog behavior.
- `third_party/plannotator/packages/ui/components/AnnotationPanel.tsx` — annotation list/sidebar density, empty states,
  selected-card scrolling, and edit/delete card structure.
- `third_party/plannotator/packages/ui/components/MarkdownEditor.tsx` — future reference only; do not expose remote Plan
  body editing in this slice.
- `third_party/plannotator/packages/ui/utils/parser.ts` and `third_party/plannotator/packages/ui/types.ts` —
  `parseMarkdownToBlocks`, `extractFrontmatter`, `Annotation`, and `AnnotationType` shapes.
- `src/shared/collaboration/urls.js`, `client.js`, and `crypto.js` — existing fragment parsing, bearer-auth API client,
  and browser-compatible encryption/decryption.
- `src/ui/workspace/react/remote-review-payload.js` — current encrypted payload schema, to evolve without breaking
  `wld plans pull` comment normalization.
- `docs/design-system.md` and `src/ui/workspace/react/plannotator.css` — RunWield Design System and Plannotator token
  bridge guidance.

## Implementation Steps

- [ ] Step 1: Inspect current Plannotator component props/exports in the pinned submodule and identify the smallest
      direct-reuse set for remote review: `ThemeProvider`, `TooltipProvider`, `Viewer`, `AnnotationToolstrip`,
      `CommentPopover`, `AnnotationPanel`, parser helpers, and types.
- [ ] Step 2: Add a remote annotation view-model adapter in or near `RemotePlanReview.tsx` that maps decrypted remote
      comments to Plannotator `Annotation` objects and maps new Plannotator annotations back to the encrypted remote
      comment payload schema.
- [ ] Step 3: Preserve display-name behavior: keep an accessible remote display-name field, persist it in
      `localStorage`, and inject it into encrypted comment payloads without adding plaintext API metadata.
- [ ] Step 4: Replace `RenderedMarkdown` plus custom `documentRef` selection handling with `parseMarkdownToBlocks`,
      `extractFrontmatter`, and Plannotator `Viewer`. Wire selected annotation id, annotation add/select callbacks, and
      the current annotation mode/input method.
- [ ] Step 5: Replace the custom `Comment on selection` button flow with Plannotator annotation affordances. If using
      `CommentPopover` directly, wrap `onSubmit(text)` so it builds/encrypts/submits the remote payload and then reloads
      only the current Revision comments.
- [ ] Step 6: Replace `RemoteCommentPanel` with `AnnotationPanel` or a remote wrapper around it. Add remote controls for
      resolve/reopen and unreadable/tampered placeholders without reintroducing the old custom card UI as the main
      experience.
- [ ] Step 7: Keep global comment creation available through a Plannotator-compatible global annotation/comment action,
      and ensure global comments become encrypted payloads with `type: "global_comment"`.
- [ ] Step 8: Preserve Revision switching behavior. Switching Revisions should reset selected annotation/comment state,
      load only the selected Revision's comments, and never show comments from other Revisions.
- [ ] Step 9: Preserve closed Shared Space behavior: the Plan remains readable, comments remain visible, but new comment
      creation and resolve/reopen controls are disabled with a readable notice.
- [ ] Step 10: Delete obsolete custom helpers (`readSelection`, `restoreInlineHighlights`, `highlightComment`,
      `findHighlightStart`, `rangeForTextOffsets`) after Plannotator owns annotation anchoring, and remove obsolete CSS
      selectors.
- [ ] Step 11: Update tests for payload mapping, tampered/unreadable comments, closed-state controls, revision scoping,
      and route smoke output. Prefer pure helper tests for mapping logic plus Workspace route tests for integration.
- [ ] Step 12: Run focused tests, Workspace checks, full CI, and headed browser verification.

## Verification Plan

- Automated: `deno test -A src/ui/workspace src/shared/collaboration`
- Automated: `deno task workspace:check`
- Automated: `deno task ci`
- Frontend setup: run
  `RUNWIELD_WORKSPACE_MODE=remote RUNWIELD_REMOTE_DB_PATH=.wld/remote-workspace.sqlite deno task workspace:dev` and use
  `http://127.0.0.1:5173` as the Plan Server URL.
- Headed browser: open a seeded reviewer URL at `http://127.0.0.1:5173/p/<space-id>#key=...&cap=...&role=reviewer` and
  verify the page uses the Plannotator-style markdown review layout and renderer rather than the old custom card/sidebar
  layout.
- Headed browser: select Plan text and create an inline comment through the Plannotator annotation UI; verify the inline
  highlight appears, the annotation appears in the Plannotator-style sidebar, and refreshing preserves/decrypts it.
- Headed browser: create a global comment and verify it appears in the same annotation sidebar without an inline anchor.
- Headed browser: resolve and reopen a comment, verify controls are disabled while pending and the visible state updates
  without duplicate submissions.
- Headed browser: switch Revisions and verify comments remain scoped to the selected Revision.
- Headed browser: check closed-space, wrong-key, tampered-comment, empty-comment, long-display-name, and mobile/narrow
  viewport states.
- Browser diagnostics: inspect console errors and failed fetch/XHR requests; none should remain unexplained.
- Security/manual: inspect network requests and SQLite rows after adding comments. Plan body, comment body, display
  name, selected/original text, and annotation anchor metadata must appear only inside ciphertext payloads.
- Expected: remote review looks and behaves like a Plannotator markdown annotation surface while keeping the remote
  collaboration privacy and Revision semantics unchanged.

## Edge Cases & Considerations

- Remote review must not import Plannotator app features that assume local Plan filesystem authority, review-decision
  APIs, AI/chat, code review, Obsidian/Bear integrations, or unrestricted Plan saving.
- Browser-side Plan body editing would change the remote-canonical workflow and is explicitly not included in this
  slice; the existing accepted loop is still pull locally, revise through Planner/Architect, then push a new Revision.
- Plannotator annotation metadata may include DOM-relative selection descriptors. Keep enough metadata encrypted so
  anchors restore across refreshes, but tolerate failed anchor restoration by keeping the comment visible.
- Existing `wld plans pull` comment rendering must still receive body/display name/type/original text/anchor context;
  update pull helpers/tests if the remote payload shape evolves.
- URL fragment secrets must stay client-only. Do not include key/capability fragments in fetch URLs, visible errors,
  console logs, or encrypted payload metadata.
- The Plannotator source checkout is a pinned submodule. If a worktree lacks it, run
  `git submodule update --init
  third_party/plannotator` for local build verification rather than replacing imports
  with custom components.
- Keep implementation in the Workspace TypeScript/TSX exception zone or pure `.js` with JSDoc for shared modules; do not
  add TypeScript syntax outside `src/ui/workspace/`.
