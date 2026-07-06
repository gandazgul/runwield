---
planId: "8255da0d-5877-440d-ba67-9cb5d754b982"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the reviewer-facing remote Shared Space UI for decrypting and reading revisions, adding encrypted comments with display names, resolving/reopening comments, and switching revisions. This is the main frontend slice and requires headed browser verification."
affectedPaths:
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/routes/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/static/styles.css"
    - "src/shared/collaboration/"
    - "src/ui/workspace/workspace.test.js"
frontend: true
devServerCommand: "RUNWIELD_WORKSPACE_MODE=remote deno task workspace:dev"
devServerUrl: "http://localhost:5173"
devServerHmr: true
createdAt: "2026-07-04T14:52:22.903Z"
updatedAt: "2026-07-06T20:52:17.122Z"
status: "draft"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 5
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
    - "03-remote-workspace-sqlite-shared-space-api"
    - "04-wld-plans-share-remote-publish-flow"
---

# Remote Browser Review MVP

## Context

Collaborative Planning becomes useful when reviewers can open a browser link, read the shared Plan, and leave encrypted
feedback without installing RunWield or creating accounts. Slices 01, 03, and 04 are verified enough to provide the
protocol/crypto/url helpers, remote SQLite Shared Space APIs, typed client methods, and `wld plans share` URLs.

Important existing seams discovered for this slice:

- `src/ui/workspace/server.js` already supports `createWorkspaceApp({ mode: "remote" })`, registers static assets and
  `/api/spaces...`, and keeps local Plan Board routes isolated from remote mode.
- The remote API stores only revision/comment ciphertext plus metadata such as ids, timestamps, revision numbers, and
  resolved flags. Comment semantic content must remain inside encrypted payloads.
- `src/shared/collaboration/urls.js` already uses `/p/<space-id>#key=...&cap=...&role=...`, so browser code can parse
  all secret material from the URL fragment without sending it to the server.
- `src/shared/collaboration/crypto.js` uses Web Crypto APIs and should run in the browser.
- The normal Vite dev entry currently starts local Workspace mode; this slice should add a remote-mode dev path so the
  headed browser can exercise `/p/:spaceId` through HMR.

Product decision from planning: this MVP **must include inline/anchored comments**, not only global revision comments.
Copy/adapt as much Plannotator review UX as practical, or use Plannotator directly only if it is browser-compatible with
this Fresh/Preact app and does not pull in the full unrelated editor surface. Keep all new RunWield source in pure
`.js`/`.jsx` with JSDoc, not TypeScript.

This slice deliberately keeps destructive unshare/delete out of the browser. Unshare remains CLI-only for v1.

## Objective

Implement a remote reviewer UI at `/p/:spaceId` that:

- Parses key/capability/role from the URL fragment and never sends fragment material in route URLs.
- Fetches Shared Space metadata, revisions, and comments from remote APIs using the bearer capability.
- Decrypts revision payloads and comment payloads in the browser.
- Renders Plan markdown in a reviewer-friendly layout.
- Captures a free-form reviewer display name and encrypts it with each comment.
- Supports both global revision comments and inline/anchored comments created from selected Plan text/block context.
- Shows inline comment highlights/anchors and a comment sidebar/list.
- Lets reviewer and maintainer links resolve/reopen comments.
- Switches revisions and keeps comments scoped to their original revision.

Acceptance criteria:

- Reviewer and maintainer URLs can view, comment, resolve, and reopen; neither role sees push/unshare/delete controls in
  the browser MVP.
- Decrypted comment payload fields include at least `displayName`, `body`, `type`, `originalText`, and anchor/context
  metadata (`blockId`, offsets and/or stable text-selection metadata); all are encrypted inside `ciphertext` before API
  submission.
- API requests and SQLite rows never contain plaintext Plan body, comment body, display name, selected/original text, or
  anchor context outside encrypted blobs.
- Wrong key/tampered ciphertext/missing fragment/capability failures are clear to users and redact secrets/ciphertext.
- Closed Shared Spaces remain readable but block new comments and comment state changes with readable UI.

## Approach

Add a remote review route and hydrated island to the existing Fresh Workspace remote mode. Keep route/API behavior
separate from local Plan Board routes and do not require local Workspace token auth for `/p/:spaceId` in remote mode.

Use a small RunWield-native remote review surface rather than importing the full Plannotator app wholesale. First check
whether the compiled Plannotator package exposes compatible browser components/utilities. If direct reuse is not viable,
copy/adapt only the relevant Plannotator concepts into `.jsx`/JSDoc modules:

- annotation shape (`COMMENT`, `GLOBAL_COMMENT`, `originalText`, `blockId`, offsets, optional start/end metadata),
- text-selection toolbar/comment popover behavior,
- sidebar annotation/comment cards,
- restore highlights from decrypted comments by using stored selection metadata first, then text fallback,
- global-comment action and revision-scoped comment list behavior.

Do not bring over Plannotator-only concerns such as AI chat, images, deletion/redline, quick labels, code review,
Obsidian/Bear integrations, or full theme systems unless they are required to make inline comments work. If
`@plannotator/web-highlighter` or another small Plannotator dependency is the cleanest way to preserve inline selection
behavior, add the minimal import to `deno.json` and document why. Otherwise implement a lightweight DOM Selection helper
that records selected text plus stable block/offset context.

Remote comment records should use the existing API shape `{ ciphertext }`. The decrypted per-comment payload should be
versioned so future pull/push flows can consume it, for example:

```js
{
    schemaVersion: 1,
    type: "comment" | "global_comment",
    displayName: "Alice",
    body: "Please clarify this.",
    originalText: "selected Plan text",
    anchor: {
        blockId: "...",
        startOffset: 12,
        endOffset: 42,
        startMeta: { ... },
        endMeta: { ... }
    },
    createdAt: "..."
}
```

Use `MarkdownView`/`renderMarkdown` where practical for safe HTML rendering, but wrap rendered content in a remote
review component that can attach `data-block-id`/selection anchors or derive block anchors after render. If the existing
markdown renderer cannot provide stable block ids, add a small browser-side block/anchor mapper rather than rewriting
all markdown rendering in this slice.

## Files to Modify

- `deno.json` — add only the minimal Plannotator/highlighter dependency or remote dev task support if required.
- `src/ui/workspace/dev.js` — support `RUNWIELD_WORKSPACE_MODE=remote` and optional remote DB path for Vite/HMR browser
  verification while preserving local dev behavior by default.
- `src/ui/workspace/server.js` — register the remote review browser route in remote mode and keep local routes/token
  behavior unchanged.
- `src/ui/workspace/routes/remote-review.jsx` — new route for `/p/:spaceId`; SSR a minimal shell that passes `spaceId`
  to the client island and loads the existing Workspace CSS stack.
- `src/ui/workspace/routes/remote-api.js` — adjust only if the UI exposes a minor response-shape mismatch; do not add
  plaintext fields to API payloads.
- `src/ui/workspace/components/MarkdownView.jsx` — reuse or lightly adapt markdown rendering to support stable review
  anchors/highlight containers without weakening HTML/link safety.
- `src/ui/workspace/components/RemoteCommentPanel.jsx` — new presentational sidebar/list for decrypted comments,
  resolved state, author display name, anchor text/context, and resolve/reopen buttons.
- `src/ui/workspace/components/RemoteCommentPopover.jsx` — new copied/adapted Plannotator-style popover for selected
  text/global comment entry, simplified for RunWield and Preact.
- `src/ui/workspace/islands/RemotePlanReview.jsx` — client island for fragment parsing, API client setup, browser
  decryption, revision loading, comment loading/decryption, inline selection/comment creation, resolve/reopen, display
  name persistence, and revision switching.
- `src/shared/collaboration/protocol.js` — add JSDoc typedefs/normalizers for encrypted remote comment payloads if
  useful for tests and later pull flow; keep API boundary ciphertext-only.
- `src/shared/collaboration/crypto.js` and `src/shared/collaboration/urls.js` — only adjust if browser bundling exposes
  incompatibilities; preserve existing semantics.
- `src/ui/workspace/static/styles.css` / `src/ui/workspace/static/workspace.css` — style remote review layout, inline
  highlights, selection toolbar/popover, comment sidebar/list, revision selector, display-name form, empty/loading/error
  states, closed/deleted states, and responsive mobile stacking.
- `src/ui/workspace/workspace.test.js` — add server route tests, response-shape tests, and focused pure helper tests for
  payload/anchor/decryption behavior where practical.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/collaboration/urls.js` — parse URL fragments and ensure API URLs are fragment-free.
- `src/shared/collaboration/crypto.js` — import/export content keys and encrypt/decrypt JSON payloads in the browser.
- `src/shared/collaboration/client.js` — typed methods for metadata, revisions, comments, comment state, and lifecycle.
- `src/shared/collaboration/protocol.js` — ciphertext-only boundary checks and JSDoc typedef location.
- `src/ui/workspace/server.js` / `routes/remote-api.js` — existing remote-mode and API route isolation.
- `src/ui/workspace/components/MarkdownView.jsx` — safe markdown rendering via `quikdown`.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — localStorage and fetch/error/loading conventions for islands.
- `src/ui/workspace/static/workspace.css` and `src/ui/design-system/components.css` — existing visual tokens, badges,
  notices, cards, buttons, responsive breakpoints, and markdown styling.
- `../plannotator/packages/ui/components/Viewer.tsx` — selection-to-comment flow, global comment action, and highlight
  restoration concepts.
- `../plannotator/packages/ui/hooks/useAnnotationHighlighter.ts` — web-highlighter lifecycle, annotation creation,
  selected text capture, and fallback highlight restoration logic to copy/adapt.
- `../plannotator/packages/ui/components/CommentPopover.tsx` — popover positioning, keyboard handling, draft behavior,
  and submit UX to copy/adapt without React-only dependencies.
- `../plannotator/packages/ui/components/AnnotationPanel.tsx` — comment/annotation sidebar density and selected-card
  behavior to copy/adapt.
- `../plannotator/packages/ui/utils/sharing.ts` and `../plannotator/packages/ui/types.ts` — compact annotation shape and
  global-vs-inline comment semantics as reference.
- `../plannotator/packages/ui/utils/parser.ts` — line label/export semantics for block-scoped feedback as reference for
  later pull flow; do not port the full parser unless needed.

## Implementation Steps

- [ ] Step 1: Re-check the compiled Plannotator package exports and current bundle constraints. Decide and document in
      code comments whether to directly reuse small Plannotator modules or copy/adapt them into RunWield `.jsx`/JSDoc.
      Prefer copying/adapting if direct reuse drags in React app/global theme/AI/editor dependencies.
- [ ] Step 2: Add remote Vite dev support in `src/ui/workspace/dev.js`, e.g. `RUNWIELD_WORKSPACE_MODE=remote` plus an
      optional DB path env var. Keep default `deno task workspace:dev` local-mode behavior unchanged.
- [ ] Step 3: Add and register `/p/:spaceId` only in remote Workspace mode. Verify local mode still token-protects local
      routes and remote mode still returns `404` for local Plan Board/API routes.
- [ ] Step 4: Build `RemotePlanReview` island skeleton: parse `location.href` with `parseCollaborationUrl`, construct a
      `CollaborationClient`, import the content key, remove or ignore fragment material in visible UI/errors, and show
      clear states for missing/invalid fragment, missing bearer, wrong key, API unauthorized, and not found/deleted.
- [ ] Step 5: Fetch Shared Space metadata and the latest revision, decrypt the revision payload with
      `decryptJsonPayload`, normalize expected plan payload fields, and render title/metadata/body. Keep ciphertext and
      fragment secrets out of errors/logs.
- [ ] Step 6: Add revision selector/timeline from Shared Space metadata. Switching revisions fetches/decrypts the
      selected revision and reloads only that revision's comments; comments do not carry forward.
- [ ] Step 7: Add display-name capture with accessible label/help text. Store it in `localStorage` scoped to remote
      review UI only, but encrypt the display name inside each submitted comment payload; never submit it as plaintext
      metadata.
- [ ] Step 8: Implement global comment creation using the same comment popover/form and encrypted payload schema.
- [ ] Step 9: Implement inline/anchored comment creation. At minimum, users can select text in rendered Plan content,
      click/comment from a floating toolbar or action, enter feedback, and submit an encrypted payload containing body,
      display name, selected/original text, block/context id, offsets and/or Plannotator-style start/end metadata.
- [ ] Step 10: Implement inline highlight/anchor restoration after comments decrypt. Prefer stored selection metadata;
      fall back to searching for `originalText` in the rendered revision. If restoration fails, keep the comment visible
      in the sidebar with an "anchor not found in this revision" style message.
- [ ] Step 11: Implement comment list/sidebar: decrypt each comment, sort by creation time/API order, show display name,
      body, selected/original text context, resolved state, and unreadable/tampered comment placeholders without
      breaking the whole page.
- [ ] Step 12: Implement resolve/reopen controls through `setCommentState`, refresh or patch local state, and prevent
      duplicate clicks while pending. Closed spaces should disable these controls with a readable closed-state notice.
- [ ] Step 13: Add closed/deleted/wrong-key/tampered/loading/empty states. Closed spaces remain readable; deleted or
      unavailable spaces explain the remote state without implying local Plan edits.
- [ ] Step 14: Add responsive styling for desktop split view and mobile stacked view, selection highlights, focus
      states, keyboard-accessible buttons/forms, long names/comments, and sidebar overflow.
- [ ] Step 15: Add tests for `/p/:spaceId` route availability only in remote mode, local/remote route isolation,
      fragment-free API calls, encrypted comment payload construction, comment payload normalization, wrong-key/tamper
      handling helpers, and route SSR smoke output.
- [ ] Step 16: Run focused tests, full CI, and headed browser verification.

## Verification Plan

- Automated: `deno test -A src/ui/workspace src/shared/collaboration`
- Automated: `deno task ci`
- Frontend setup: start remote Workspace dev mode with `RUNWIELD_WORKSPACE_MODE=remote deno task workspace:dev` at
  `http://localhost:5173`. If the implementation uses an env var for a persistent SQLite file, document and use that
  exact command in the task completion notes.
- Frontend data setup: create/seed a Shared Space through the verified share/API flow and produce a reviewer URL like
  `http://localhost:5173/p/<space-id>#key=...&cap=...&role=reviewer`.
- Headed browser: open the reviewer URL, verify the Plan decrypts/renders, no secret material appears in visible error
  text, and the URL/API requests do not send fragment data.
- Headed browser: enter a display name, create a global comment, refresh, and verify it decrypts/persists.
- Headed browser: select text in the rendered Plan, create an inline comment, verify the highlighted/anchored selection
  appears in the document and the sidebar shows the selected text context.
- Headed browser: resolve and reopen the comment, verify state changes are visible and duplicate clicks are guarded.
- Headed browser: switch from revision 2 to revision 1 and verify comments are scoped to the selected revision; anchors
  that cannot be restored show a sidebar fallback instead of disappearing.
- Headed browser: check mobile/narrow viewport stacking and keyboard focus/submit behavior for the comment popover and
  resolve/reopen buttons.
- Browser diagnostics: inspect console errors and failed fetch/XHR requests; none should remain unexplained.
- Security/manual: inspect network requests and SQLite rows after adding comments. Plan body, comment body, display
  name, selected/original text, and anchor/context metadata must appear only inside ciphertext payloads.
- Expected: reviewer capability can view/comment/resolve/reopen; maintainer link behaves at least as reviewer in the UI;
  no browser push, close, delete, or unshare control is available in this slice.

## Edge Cases & Considerations

- URL fragment data is not sent to the server by browsers; preserve that invariant when constructing fetch URLs and when
  navigating/reloading.
- Wrong-key and tampered-ciphertext failures should be user-readable and should not leak ciphertext, bearer
  capabilities, or content keys.
- Display names, comment bodies, selected/original text, block ids, offsets, and surrounding context are semantic review
  content and must be encrypted, not stored as plaintext metadata.
- Inline anchors may fail to re-bind after markdown rendering changes, duplicate text, or revision switching. Keep the
  comment visible and mark the anchor as unavailable rather than dropping it.
- Avoid importing the full Plannotator React app into the Fresh/Preact Workspace unless proven lightweight and
  compatible. Copy/adapt focused code where direct reuse would introduce TypeScript, React-only runtime, theme, AI, or
  editor dependencies.
- Do not use `dangerouslySetInnerHTML` with unsanitized user content. Continue relying on `quikdown` safety behavior or
  a reviewed sanitizer path.
- Closed Shared Spaces are readable but reject comment creation and resolve/reopen mutations; show the closed state near
  controls.
- Browser unshare/delete is explicitly out of scope for v1; destructive delete remains CLI-only.
- No TypeScript files or TypeScript syntax in RunWield source; use `.js`/`.jsx` and JSDoc typedefs.
