---
planId: "92a3ac2d-b93f-4ffa-8fa6-2844c5055532"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add read-first Plan detail pages with rendered markdown and a CodeMirror-style body-only editor that preserves front matter, detects stale saves, and supports browser-local draft recovery."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/ui/workspace/"
    - "deno.json"
    - "deno.lock"
createdAt: "2026-06-24T20:14:08.683Z"
status: "verified"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "secure-workspace-read-only-board"
    - "correct-workspace-design-foundation"
verifiedAt: "2026-06-26T22:59:54.402Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-02T15:19:13.951Z"
archivedAt: "2026-07-02T15:19:13.951Z"
archiveReason: "Parent epic verified"
archivedFromStatus: "verified"
archivedFromPath: "plans/local-first-plan-management-ui/body-only-plan-detail-editor.md"
---

# Body-Only Plan Detail Editor

## Context

The Workspace now has the prerequisites this slice should build on: `wld plans ui`, token-gated Fresh/Preact SSR pages,
read-only REST APIs, durable `planId` routes, status-column board screens, Epic detail pages, and read-first non-Epic
Plan detail pages with safe rendered markdown and structured front matter summaries. This slice turns the non-Epic Plan
detail page from read-only into deliberately editable while keeping canonical markdown Plans as the source of truth.

Product behavior is sourced from `docs/prd/local-first-plan-management-ui-PRD.md`,
`docs/adr/007-local-first-workspace-plan-board.md`, and prior planning decisions: the v1 editor is a conservative
CodeMirror-style markdown source editor; BlockSuite is deferred; the editor owns only the markdown body; raw front
matter editing is out of scope; edits write to disk only on explicit Save; unsaved browser-local drafts are recovery
aids, not canonical Plan state.

## Objective

Add body-only Plan editing to the Workspace detail experience:

- Keep the default detail route read-first with rendered markdown and a prominent `Edit body` action.
- Open a CodeMirror 6 markdown editor for the Plan body only.
- Save only the body text while preserving the existing front matter block exactly.
- Require an expected body hash/revision on save and reject stale writes when the on-disk body changed after the editor
  loaded.
- Store unsaved drafts in browser-local storage using an opaque workspace/project key plus `planId`, and offer recovery
  after refresh without writing drafts to disk.
- Keep lifecycle/status/front matter changes out of the editor path.

## Approach

Add narrow Plan-store body seams first, then expose them through the Workspace adapter/API, then add the client editor
island. The save helper should work from `planId` and raw markdown file contents, not by reparsing and reformatting
front matter through `injectFrontMatter()`. For this feature, preserving front matter means retaining the exact leading
YAML front matter block bytes/order/comments/unknown keys and replacing only the body section after the closing
delimiter. The helper should compute a stable body hash from the current on-disk body, compare it to the caller's
expected hash, and fail with a conflict before writing if they differ.

On the UI side, keep SSR read-first rendering. Add an editor island or focused client module that starts in read mode
unless the URL includes an edit hint such as `?edit=body`. The island mounts CodeMirror only after the user chooses to
edit. It tracks dirty state, stores draft snapshots in `localStorage`, warns before navigation when dirty, sends save
requests with the Workspace token, handles `409 Conflict` without clearing the draft, and clears the draft after a
successful save.

## Files to Modify

- `src/plan-store.js` — add body-splitting, body-hashing, body metadata, and body-only save helpers keyed by `planId`.
- `src/plan-store.test.js` — cover body metadata, exact front matter preservation, unknown/commented front matter,
  stale-save rejection, duplicate/missing Plan ID behavior, and markdown body fidelity.
- `src/ui/workspace/server/plan-adapter.js` — include editor-ready body metadata (`bodyHash`, `workspaceKey`,
  capabilities) in Plan detail DTOs and add a server adapter for body saves.
- `src/ui/workspace/routes/api/handlers.js` — add a state-changing body-save endpoint, returning `409` for stale saves
  and token-gated JSON errors for invalid payloads.
- `src/ui/workspace/server.js` — register the new body-save API route and keep it behind existing Workspace token
  middleware.
- `src/ui/workspace/routes/detail.jsx` — pass route URL/edit intent into Plan detail rendering.
- `src/ui/workspace/components/PlanDetail.jsx` — replace the disabled edit placeholder with a real read-first edit
  action and mount the editor island boundary for non-Epic Plans.
- `src/ui/workspace/components/PlanCard.jsx` and/or `EpicDetail.jsx` — add direct `Edit body` links to non-Epic Plan
  cards/child cards where low-risk, pointing at the same detail route with edit intent.
- `src/ui/workspace/components/MarkdownView.jsx` — reuse for the read-first preview; change only if the editor panel
  needs a small shared preview helper.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` or equivalent client module — implement CodeMirror mounting,
  Save/Cancel, dirty-state, stale-save UI, and draft recovery.
- `src/ui/workspace/static/styles.css` — style editor actions, conflict/draft notices, CodeMirror container, and
  read/edit layout states.
- `src/ui/workspace/workspace.test.js` — cover body-save API behavior, detail page edit affordances, token/security
  regressions, and editor metadata serialization.
- `deno.json` — add CodeMirror imports and ensure existing root Workspace check/test tasks cover the new `.jsx`/client
  files. Do not add a nested `src/ui/workspace/deno.json`.
- `deno.lock` — update dependency lock entries for CodeMirror packages.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `findPlanById`, `listPlanResources`, `parsePlanFrontMatter`, canonical plan resource
  metadata, duplicate `planId` checks, and archived-plan hiding.
- `src/plan-store.js` front matter knowledge — reuse existing parsing for validation/DTOs, but do not use
  `injectFrontMatter()` for body-only saves because it rewrites front matter.
- `src/ui/workspace/server.js` — reuse the existing token middleware and Fresh route registration pattern.
- `src/ui/workspace/server/plan-adapter.js` — reuse `loadWorkspaceDetail`, `serializePlanDetail`, `workspaceMetadata`,
  `serializePlanError`, and current safe DTO conventions that avoid exposing absolute filesystem paths.
- `src/ui/workspace/components/MarkdownView.jsx` — reuse safe markdown rendering for the read-first preview.
- `src/ui/workspace/components/PlanCard.jsx` — reuse `workspaceHref()`/`detailHref()` so edit links preserve the launch
  token in the query string.
- CodeMirror 6 — use `codemirror` `basicSetup`/`EditorView` plus `@codemirror/lang-markdown`; keep it behind one editor
  boundary so a future rich editor can replace it without touching Plan lifecycle or board code.

## Implementation Steps

- [ ] Step 1: Add raw Plan body splitting and hashing helpers in `src/plan-store.js`.
  - Add a helper that splits markdown into `{ frontMatterBlock, body }` when a valid leading `---` block is present.
  - Preserve the front matter block exactly as read from disk, including key order, unknown keys, comments, quoting, and
    trailing delimiter/newline shape.
  - Add an async `hashPlanBody(body)` helper using a stable digest such as SHA-256 and a `bodyHash` string safe for
    JSON.
  - Keep malformed front matter behavior repair-oriented: body save by `planId` should fail through normal lookup/parse
    errors rather than silently healing and rewriting raw YAML.
- [ ] Step 2: Add Plan body metadata and save helpers in `src/plan-store.js`.
  - Add `loadPlanBodyById(cwd, planId)` or equivalent returning `planId`, `planName`, `relativePath`, parsed `attrs`,
    body text, full markdown if needed server-side, and `bodyHash`.
  - Add `savePlanBodyById(cwd, planId, newBody, expectedBodyHash)` or equivalent.
  - On save, re-read the current file from disk, split current front matter/body, compute the current body hash, compare
    it to `expectedBodyHash`, and throw a typed/recognizable stale-save error if they differ.
  - Write `frontMatterBlock + newBody` only after the hash check passes. Do not update `updatedAt`; body-only saves must
    preserve front matter exactly.
  - Return the fresh body hash and safe resource metadata after a successful save.
- [ ] Step 3: Add Plan-store tests for canonical body save semantics.
  - Assert body saves preserve front matter bytes exactly while changing only body bytes.
  - Assert unknown front matter keys, comments, field ordering, status, worktree metadata, dependencies, and `planId`
    remain unchanged after body save.
  - Assert stale saves reject when the body changed externally between load and save.
  - Assert duplicate `planId` values still fail loudly and archived Plans remain hidden/uneditable through lookup.
  - Assert representative markdown body content round-trips without normalization: headings, lists, task lists, tables,
    links, code fences, and trailing newlines where practical.
- [ ] Step 4: Expose editor-ready detail DTOs from the Workspace adapter.
  - Add `bodyHash` to non-Epic detail DTOs returned by `loadWorkspaceDetail()` / `/api/plans/:planId`.
  - Add an opaque `workspaceKey` derived from the launched checkout path, preferably a SHA-256 digest of `cwd`, for
    browser-local draft keys without exposing the absolute path.
  - Update `workspaceMetadata()` capabilities from `bodyEditing: false` to `bodyEditing: true` once the save route is
    wired.
  - Keep absolute filesystem paths out of API/SSR DTOs.
- [ ] Step 5: Add the body-save API route.
  - Register `POST` or `PUT /api/plans/:planId/body` in `src/ui/workspace/server.js`.
  - Accept JSON shaped like `{ body: string, expectedBodyHash: string }` and reject invalid payloads with `400`.
  - Call the Plan-store body save helper from `routes/api/handlers.js` or a server adapter function.
  - Return `200` with the new `bodyHash` and updated safe Plan detail/summary metadata on success.
  - Return `409 Conflict` for stale body hashes with a clear message and the latest `bodyHash` if safe to include.
  - Rely on existing Workspace token middleware; client requests should also send `PLAN_UI_TOKEN_HEADER` from the URL
    token for same-origin API calls.
- [ ] Step 6: Add the read-first editor affordance to detail/card views.
  - Keep rendered markdown visible by default on `/plans/:planId`.
  - Replace `Edit body after editor slice` with a real `Edit body` button/link.
  - Support direct edit entry via `?edit=body` so card/detail shortcuts can open the same route in edit mode.
  - Keep front matter summaries read-only and clearly outside the editor.
  - Avoid adding lifecycle/status mutation controls in this slice.
- [ ] Step 7: Implement the CodeMirror body editor island/client module.
  - Mount CodeMirror only in the browser and only for body markdown, seeded from the server-provided Plan body.
  - Use `EditorView`, `basicSetup`, and `markdown()` from CodeMirror packages.
  - Provide Save, Cancel, and return-to-read controls; Cancel should leave disk unchanged and either keep or explicitly
    discard the local draft based on the user's choice.
  - Track dirty state and install a `beforeunload` warning while unsaved edits exist.
  - On successful save, update the read preview/body hash in UI state where practical, clear the draft, and show a
    confirmation.
- [ ] Step 8: Add browser-local draft recovery.
  - Store drafts in `localStorage` under a key like `runwield:workspace:${workspaceKey}:plan:${planId}:bodyDraft`.
  - Store `{ body, baseBodyHash, updatedAt }`, not front matter or full markdown.
  - When opening the editor, if a draft exists for the current `bodyHash`, offer to restore or discard it.
  - If a draft exists but its `baseBodyHash` differs from the current body hash, warn that the Plan changed on disk and
    keep the draft available for manual copy/merge; do not auto-overwrite current content.
  - Clear the draft only after a successful save or explicit discard.
- [ ] Step 9: Add Workspace tests and dependency wiring.
  - Add root `deno.json` imports for CodeMirror packages and update `deno.lock`.
  - Extend `src/ui/workspace/workspace.test.js` to cover the body-save route, stale-save response, preserved front
    matter, detail HTML edit action, and no-token rejection for state-changing requests.
  - Add small pure tests for draft key/recovery-decision helpers if they are factored out of the island.
  - Ensure `deno task workspace:check` covers new island/client modules.

## Verification Plan

- Automated:
  - `deno task ci`
  - `deno task workspace:check`
  - `deno task workspace:test`
- Manual:
  - Run `wld plans ui`, open a non-Epic Plan detail route, confirm the page is readable by default and shows a prominent
    `Edit body` action.
  - Edit body markdown containing headings, lists, task lists, code fences, links, and tables; save; refresh; verify the
    body changed and front matter bytes/fields remained unchanged.
  - Open a Plan in the editor, modify the same Plan body on disk externally, then try to save from the browser; verify a
    conflict message appears, the browser draft remains recoverable, and disk is not overwritten.
  - Start editing, refresh without saving, reopen the editor, and verify draft recovery is offered for the same
    workspace/Plan but not for a different Plan.
  - Verify raw front matter is never presented as an editable text area and lifecycle/status metadata remains controlled
    by existing non-editor surfaces.

## Edge Cases & Considerations

- Body-only save must preserve front matter exactly; do not use helpers that reformat YAML for this path.
- Stale-save protection is based on the latest on-disk body hash at save time, not a cached server/client value.
- The local server is single-user/local-first, but external editors and agents can modify Plan files concurrently; 409
  conflicts should be non-destructive and easy to recover from.
- Browser-local drafts are not canonical Plan state and must not be loaded by CLI/agent workflows.
- The draft key must include an opaque workspace/project identity plus `planId` to avoid cross-project contamination.
- CodeMirror should stay behind a replaceable boundary; do not couple lifecycle actions or front matter controls to the
  editor implementation.
- Keep implementation source JavaScript/JSDoc/JSX only; do not add `.ts`/`.tsx` files or TypeScript syntax.
- There is an unrelated dirty plan file in the working tree
  (`plans/local-first-plan-management-ui/epic-detail-and-progress.md`); this plan intentionally does not touch it.
