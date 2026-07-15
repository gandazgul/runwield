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
updatedAt: "2026-07-14T22:37:08.235Z"
status: "implemented"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 5
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
    - "03-remote-workspace-sqlite-shared-space-api"
    - "04-wld-plans-share-remote-publish-flow"
implementedAt: "2026-07-14T22:37:08.235Z"
worktreeStatus: "completed"
---

# Remote Browser Review MVP

## Context

Collaborative Planning becomes useful when reviewers can open a browser link, read the shared Plan, and leave encrypted
feedback without installing RunWield or creating accounts. Slices 01, 03, and 04 are verified enough to provide the
protocol/crypto/url helpers, remote SQLite Shared Space APIs, typed client methods, and `wld plans share` URLs.

Product behavior is sourced from the Collaborative Planning PRD, ADR-008, the approved Epic, verified earlier slices,
and the planning decision for this slice: this MVP **must include inline/anchored comments**, not only global revision
comments. Reviewer and maintainer links are accountless bearer-capability URLs; semantic content stays client-side
encrypted; Shared Spaces are remote-canonical while shared; browser unshare/delete stays out of scope for v1.

Important existing seams discovered for this slice:

- `src/ui/workspace/server.js` already supports `createWorkspaceApp({ mode: "remote" })`, registers static assets and
  `/api/spaces...`, and keeps local Plan Board routes isolated from remote mode.
- The current Workspace is now Astro SSR plus React islands under `src/ui/workspace/`, with Tailwind/design-system CSS
  and selective Plannotator reuse. Fresh/Preact island assumptions in the older draft are superseded.
- `deno task workspace:dev` runs Astro dev directly at `http://localhost:5173`, so remote HMR needs an Astro dev path
  for both `/p/:spaceId` and remote `/api/spaces...` calls; the production/server-wrapper remote path still needs to
  serve the built `/p/:spaceId` page.
- The remote API stores only revision/comment ciphertext plus metadata such as ids, timestamps, revision numbers, and
  resolved flags. Comment semantic content must remain inside encrypted payloads.
- `src/shared/collaboration/urls.js` already uses `/p/<space-id>#key=...&cap=...&role=...`, so browser code can parse
  all secret material from the URL fragment without sending it to the server.
- `src/shared/collaboration/crypto.js` uses Web Crypto APIs and should run in the browser.
- Plannotator source is already pinned under `third_party/plannotator/`, and Workspace React review surfaces already
  import `Viewer`, `AnnotationPanel`, parser helpers, and `@plannotator/web-highlighter`-related dependencies.

This slice deliberately keeps destructive unshare/delete, push, pull, and local Plan mutation out of the browser. It is
a reviewer-facing remote Shared Space reader/commenter.

## Objective

Implement a remote reviewer UI at `/p/:spaceId` that:

- Parses key/capability/role from the URL fragment and never sends fragment material in route URLs or API requests.
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
- Decrypted comment payload fields include at least `schemaVersion`, `displayName`, `body`, `type`, `originalText`, and
  anchor/context metadata (`blockId`, offsets and/or stable text-selection metadata); all are encrypted inside
  `ciphertext` before API submission.
- API requests, API responses, and SQLite rows never contain plaintext Plan body, comment body, display name,
  selected/original text, or anchor context outside encrypted blobs.
- Wrong key/tampered ciphertext/missing fragment/capability failures are clear to users and redact secrets/ciphertext.
- Closed Shared Spaces remain readable but block new comments and comment state changes with readable UI.
- Astro dev mode with `RUNWIELD_WORKSPACE_MODE=remote deno task workspace:dev` supports HMR for the remote review page
  and uses the same remote API semantics as the server-wrapper remote app.

## Approach

Add a remote review page to the Astro Workspace and a hydrated React island for the interactive review surface. Keep
remote page/API behavior separate from local Plan Board routes and do not require local Workspace token auth for
`/p/:spaceId` in remote mode.

Use a small RunWield-owned remote review surface that selectively reuses Plannotator pieces already proven in Workspace,
rather than importing a full standalone Plannotator app. Prefer direct reuse of compatible React components/utilities
from the pinned checkout when they fit the remote Shared Space semantics:

- `Viewer`/markdown block parsing for rendered Plan content, stable block ids, selection flow, and highlight restore.
- `AnnotationPanel`/comment-card density and selected-card behavior.
- `CommentPopover` interaction ideas or component reuse if its props can stay simple and accessible.
- `parseMarkdownToBlocks`, `extractFrontmatter`, and annotation export/shape concepts for revision-scoped feedback.

If a Plannotator component expects unrelated app state, AI/chat/editor features, full theme systems, or local review
decision APIs, copy/adapt only the narrow behavior into Workspace React modules. Do not bring over Plannotator-only
concerns such as AI chat, images, deletion/redline, quick labels, code review, Obsidian/Bear integrations, or local Plan
save behavior unless required to make inline comments work.

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

Use the Workspace Astro/React exception zone for browser UI (`.astro`, `.tsx`, `.jsx` are acceptable under
`src/ui/workspace/`). Non-Workspace shared collaboration modules remain pure `.js` with JSDoc typedefs. Keep safe
markdown rendering through the existing Workspace/Plannotator markdown path; do not introduce unsafe raw HTML handling.

## Files to Modify

- `deno.json` — add a dedicated remote Workspace dev task only if useful, e.g. `workspace:dev:remote`; otherwise keep
  `RUNWIELD_WORKSPACE_MODE=remote deno task workspace:dev` working. Avoid adding new Plannotator dependencies unless
  current imports are insufficient.
- `src/ui/workspace/server.js` — register/render `/p/:spaceId` in remote Workspace mode through the Astro build, while
  preserving local token-protected routes and existing remote `/api/spaces...` route isolation.
- `src/ui/workspace/pages/p/[spaceId].astro` — new Astro page for the remote Shared Space review shell; SSR only
  non-secret route data (`spaceId`) and mount the React island with `client:load`.
- `src/ui/workspace/pages/api/spaces/[...segments].js` — if needed for Astro dev/HMR, add a dev-only remote API bridge
  enabled by `RUNWIELD_WORKSPACE_MODE=remote` and backed by `RUNWIELD_REMOTE_DB_PATH`/a cached remote adapter. It should
  return 404 outside remote dev mode so local Workspace dev APIs stay isolated.
- `src/ui/workspace/layouts/ReviewLayout.astro` — reuse or lightly extend the existing review layout for the public
  remote review shell without Plan Board navigation.
- `src/ui/workspace/react/RemotePlanReview.tsx` — new client island for fragment parsing, API client setup, browser
  decryption, revision loading, comment loading/decryption, inline selection/comment creation, resolve/reopen, display
  name persistence, and revision switching.
- `src/ui/workspace/react/RemoteCommentPanel.tsx` — new or co-located presentational sidebar/list for decrypted
  comments, resolved state, author display name, anchor text/context, and resolve/reopen buttons.
- `src/ui/workspace/react/RemoteCommentPopover.tsx` — new or co-located copied/adapted Plannotator-style popover for
  selected text/global comment entry, simplified for RunWield remote review.
- `src/ui/workspace/react/remote-review-payload.ts` or `src/shared/collaboration/protocol.js` — add comment-payload
  typedefs/normalizers in the smallest appropriate place. Shared future pull/push semantics should live in `.js` JSDoc;
  UI-only view models can stay in Workspace TS/TSX.
- `src/shared/collaboration/crypto.js`, `src/shared/collaboration/urls.js`, and `src/shared/collaboration/client.js` —
  only adjust if browser bundling or response normalization exposes incompatibilities; preserve existing semantics.
- `src/ui/workspace/routes/remote-api.js` — adjust only if the UI exposes a minor response-shape mismatch; do not add
  plaintext fields to API payloads.
- `src/ui/workspace/static/workspace.css` and/or design-system CSS — style remote review layout, inline highlights,
  selection toolbar/popover, comment sidebar/list, revision selector, display-name form, empty/loading/error states,
  closed/deleted states, and responsive mobile stacking.
- `src/ui/workspace/workspace.test.js` — add server route tests, Astro dev API bridge tests where practical,
  response-shape tests, and focused pure helper tests for payload/anchor/decryption behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/collaboration/urls.js` — parse URL fragments and ensure API URLs are fragment-free.
- `src/shared/collaboration/crypto.js` — import/export content keys and encrypt/decrypt JSON payloads in the browser.
- `src/shared/collaboration/client.js` — typed methods for metadata, revisions, comments, comment state, and lifecycle.
- `src/shared/collaboration/protocol.js` — ciphertext-only boundary checks and JSDoc typedef location.
- `src/ui/workspace/server.js` / `routes/remote-api.js` — existing remote-mode and API route isolation.
- `src/ui/workspace/pages/review/plan.astro` and `src/ui/workspace/react/PlanReviewSurface.tsx` — current Astro/React
  review-surface integration and Plannotator theme/layout bridging.
- `src/ui/workspace/layouts/ReviewLayout.astro` — review shell without Plan Board navigation.
- `src/ui/workspace/react/WorkspacePlanDocument.tsx` — current read-only rendered markdown use of Plannotator markdown.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` and nearby React/Preact islands — localStorage and fetch/error/loading
  conventions where still relevant.
- `src/ui/workspace/static/workspace.css` and `src/ui/design-system/components.css` — existing visual tokens, badges,
  notices, cards, buttons, responsive breakpoints, and markdown styling.
- `third_party/plannotator/packages/ui/components/Viewer.tsx` — selection-to-comment flow, global comment action, and
  highlight restoration concepts or direct component reuse.
- `third_party/plannotator/packages/ui/components/CommentPopover.tsx` — popover positioning, keyboard handling, draft
  behavior, and submit UX to reuse or copy/adapt.
- `third_party/plannotator/packages/ui/components/AnnotationPanel.tsx` — comment/annotation sidebar density and
  selected-card behavior to reuse or copy/adapt.
- `third_party/plannotator/packages/ui/utils/parser.ts` and `types.ts` — compact annotation shape, block ids, line
  labels, and global-vs-inline comment semantics as reference for later pull flow.

## Implementation Steps

- [ ] Step 1: Re-check current Plannotator component exports and Workspace bundle constraints. Decide in code whether
      `RemotePlanReview` can directly reuse `Viewer`/`AnnotationPanel`/`CommentPopover` or should copy/adapt narrower
      pieces. Prefer direct reuse where it does not import local review decisions, AI/editor state, or unrelated global
      app behavior.
- [ ] Step 2: Add the Astro remote review route at `src/ui/workspace/pages/p/[spaceId].astro` using `ReviewLayout` and a
      `RemotePlanReview` React island. Pass only `spaceId`; do not SSR or embed fragment secrets.
- [ ] Step 3: Extend `createRemoteWorkspaceApp`/remote wrapper routing so built remote mode serves `/p/:spaceId` through
      the Astro page while still returning 404 for local Plan Board routes and local Plan mutation APIs.
- [ ] Step 4: Add Astro dev remote API support for HMR if direct `astro dev` cannot reach `server.js` remote routes.
      Gate it with `RUNWIELD_WORKSPACE_MODE=remote`, support optional `RUNWIELD_REMOTE_DB_PATH`, cache/close the adapter
      safely, and keep normal `deno task workspace:dev` local behavior unchanged.
- [ ] Step 5: Build `RemotePlanReview` skeleton: parse `location.href` with `parseCollaborationUrl`, construct a
      `CollaborationClient`, import the content key, remove or ignore fragment material in visible UI/errors, and show
      clear states for missing/invalid fragment, missing bearer, wrong key, API unauthorized, and not found/deleted.
- [ ] Step 6: Fetch Shared Space metadata and the latest revision, decrypt the revision payload with
      `decryptJsonPayload`, normalize expected Plan payload fields, and render title/metadata/body. Keep ciphertext and
      fragment secrets out of errors/logs.
- [ ] Step 7: Add revision selector/timeline from Shared Space metadata. Switching revisions fetches/decrypts the
      selected revision and reloads only that revision's comments; comments do not carry forward.
- [ ] Step 8: Add display-name capture with accessible label/help text. Store it in `localStorage` scoped to remote
      review UI only, but encrypt the display name inside each submitted comment payload; never submit it as plaintext
      metadata.
- [ ] Step 9: Implement global comment creation using the same comment popover/form and encrypted payload schema.
- [ ] Step 10: Implement inline/anchored comment creation. At minimum, users can select text in rendered Plan content,
      click/comment from a floating toolbar or action, enter feedback, and submit an encrypted payload containing body,
      display name, selected/original text, block/context id, offsets and/or Plannotator-style start/end metadata.
- [ ] Step 11: Implement inline highlight/anchor restoration after comments decrypt. Prefer stored selection metadata;
      fall back to searching for `originalText` in the rendered revision. If restoration fails, keep the comment visible
      in the sidebar with an "anchor not found in this revision" style message.
- [ ] Step 12: Implement comment list/sidebar: decrypt each comment, sort by creation time/API order, show display name,
      body, selected/original text context, resolved state, and unreadable/tampered comment placeholders without
      breaking the whole page.
- [ ] Step 13: Implement resolve/reopen controls through `setCommentState`, refresh or patch local state, and prevent
      duplicate clicks while pending. Closed spaces should disable these controls with a readable closed-state notice.
- [ ] Step 14: Add closed/deleted/wrong-key/tampered/loading/empty states. Closed spaces remain readable; deleted or
      unavailable spaces explain the remote state without implying local Plan edits.
- [ ] Step 15: Add responsive styling for desktop split view and mobile stacked view, selection highlights, focus
      states, keyboard-accessible buttons/forms, long names/comments, and sidebar overflow.
- [ ] Step 16: Add tests for `/p/:spaceId` route availability only in remote mode, local/remote route isolation,
      fragment-free API calls, encrypted comment payload construction, comment payload normalization, wrong-key/tamper
      handling helpers, closed-space UI-state helpers, and route SSR smoke output.
- [ ] Step 17: Run focused tests, full CI, and headed browser verification.

## Verification Plan

- Automated: `deno test -A src/ui/workspace src/shared/collaboration`
- Automated: `deno task workspace:check`
- Automated: `deno task ci`
- Frontend setup: start remote Workspace dev mode with `RUNWIELD_WORKSPACE_MODE=remote deno task workspace:dev` at
  `http://localhost:5173`. If the implementation adds `workspace:dev:remote` or requires `RUNWIELD_REMOTE_DB_PATH`,
  document and use the exact command in task completion notes.
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
- Avoid importing the full Plannotator React app into the remote Shared Space UI unless proven lightweight and
  compatible. Reuse/copy focused code where direct reuse would introduce local review decisions, AI, editor-only state,
  or unrelated dependencies.
- Do not use unsafe raw HTML with user content. Continue relying on the existing safe markdown/Plannotator rendering or
  a reviewed sanitizer path.
- Closed Shared Spaces are readable but reject comment creation and resolve/reopen mutations; show the closed state near
  controls.
- Browser unshare/delete is explicitly out of scope for v1; destructive delete remains CLI-only.
- Workspace UI may use `.astro`/`.tsx` under `src/ui/workspace/`; non-Workspace RunWield source remains pure JavaScript
  with JSDoc.
