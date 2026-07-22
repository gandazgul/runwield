---
planId: "69a85422-96e5-46be-9042-078bf11129e7"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Split Workspace server composition into local and remote modes, then add a SQLite-backed ciphertext-only Shared Space API for revisions, comments, resolve/reopen, capability checks, and delete. This slice is API/adapter focused and deliberately excludes browser review UX."
affectedPaths:
    - "deno.json"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/routes/"
    - "src/ui/workspace/workspace.test.js"
    - "src/shared/collaboration/"
frontend: false
createdAt: "2026-07-04T14:52:22.901Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 3
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
verifiedAt: "2026-07-05T03:43:12.018Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-05T14:29:29.048Z"
restoredAt: "2026-07-05T14:29:29.048Z"
restoredFromPath: "plans/archived/collaborative-planning-remote-shared-spaces/03-remote-workspace-sqlite-shared-space-api.md"
---

# Remote Workspace SQLite Shared Space API

## Context

The current Workspace server is a checkout-local Fresh app that sets `ctx.state.cwd`, enforces a loopback token, and
serves local Plan Board routes. Remote collaboration needs a separate server mode that uses SQLite-backed Shared Spaces
and must not inherit local filesystem authority.

Slices 01 and 02 are verified. They provide the shared collaboration protocol/URL/capability/client primitives,
non-secret Plan collaboration metadata, and Shared Plan Lock enforcement. This slice proves the self-hosted backend path
before `wld plans share|pull|push|unshare` or browser review UI depend on it.

Product/API behavior is sourced from the Collaborative Planning PRD, ADR-008, the approved Epic, and the verified slice
01 protocol decision: Shared Spaces are remote-canonical while shared; reviewer and maintainer bearer capabilities are
separate from URL-fragment content encryption keys; reviewer capabilities can read/comment/resolve/reopen; maintainer
capabilities can also append revisions, close, and delete; the server stores ciphertext plus minimal routing metadata
only.

## Objective

Add a remote Workspace mode with SQLite schema/migrations and JSON APIs for Shared Space creation, revision
reads/writes, encrypted comment append/list, resolve/reopen, capability authorization, close, and destructive delete.
Local Workspace behavior must remain unchanged.

Acceptance criteria:

- Existing `createWorkspaceApp({ cwd, token })`, `startWorkspaceServer(...)`, `deno task workspace:dev`, and local Plan
  Board/API behavior continue to work in local mode.
- Remote mode does not set `ctx.state.cwd`, does not register local Plan Board routes or local Plan mutation APIs, and
  does not use the local Workspace token as collaboration authorization.
- Remote API creation receives only capability hashes and ciphertext payloads; raw bearer capabilities and content keys
  are never stored.
- Remote reads/mutations enforce reviewer vs maintainer capabilities using `Authorization: Bearer <capability>` and
  stored capability hashes.
- Plan bodies, comment bodies, display names/authors, anchors/original text, and context are stored only inside
  encrypted/ciphertext payload fields; plaintext metadata is limited to ids, timestamps, status, revision numbers,
  resolved flags, and capability hashes.
- Closed Shared Spaces remain readable but reject new revisions, new comments, and comment state changes; delete removes
  the remote Shared Space content/capabilities and subsequent calls return a clear not-found/deleted response.

## Approach

Refactor `src/ui/workspace/server.js` into mode-aware app composition while preserving the existing public local API.
Default `createWorkspaceApp({ cwd, token, skipTokenCheck })` should continue to mean local mode for current callers. Add
an explicit remote composition path, either `createWorkspaceApp({ mode: "remote", dbPath })` or a small
`createRemoteWorkspaceApp(...)` wrapper, that injects a collaboration adapter into request state and registers only
remote collaboration JSON API routes.

Use `node:sqlite` `DatabaseSync` for self-hosted SQLite if it remains compatible with the repository's Deno runtime;
this avoids adding a third-party SQLite dependency. If implementation proves `node:sqlite` unsuitable, add the smallest
Deno-compatible SQLite import in `deno.json` and document why in code/tests. Keep database logic Workspace-owned with
explicit migrations, `PRAGMA foreign_keys = ON`, and transactions for multi-table writes.

Use Shared Space API paths rather than overloading local Plan Board APIs. Recommended endpoint contract:

- `POST /api/spaces` — create a Shared Space with
  `{ planId, initialRevision: { payloadCiphertext }, capabilities: [{ scope, capabilityHash }] }`; no bearer capability
  is required because only hashes are submitted. Response `201` includes Shared Space metadata and revision `1`, but no
  raw secrets.
- `GET /api/spaces/:spaceId` — reviewer or maintainer bearer; returns metadata, status, latest revision, and revision
  list metadata.
- `GET /api/spaces/:spaceId/revisions/:revision` — reviewer or maintainer bearer; returns one revision ciphertext
  payload.
- `POST /api/spaces/:spaceId/revisions` — maintainer bearer only; appends the next revision ciphertext transactionally.
- `GET /api/spaces/:spaceId/revisions/:revision/comments` — reviewer or maintainer bearer; lists encrypted comment
  records for that revision.
- `POST /api/spaces/:spaceId/revisions/:revision/comments` — reviewer or maintainer bearer; appends one encrypted
  comment.
- `POST /api/spaces/:spaceId/comments/:commentId/state` — reviewer or maintainer bearer; body
  `{ action: "resolve" | "reopen" }`.
- `POST /api/spaces/:spaceId/lifecycle` — maintainer bearer; body `{ action: "close" | "delete" }`.

Use structured JSON errors with `error`, `message`, and `status` fields: `400` invalid JSON/payload, `401` missing
bearer for protected routes, `403` valid bearer but insufficient scope, `404` missing/deleted Shared Space or comment,
and `409` closed-space mutation or revision conflict. Avoid messages that disclose whether a different capability would
work.

## Files to Modify

- `deno.json` — add a SQLite import only if `node:sqlite` is rejected by implementation; otherwise no dependency change
  is needed. Add or adjust focused test tasks only if useful.
- `src/ui/workspace/server.js` — split common/static setup from local and remote route registration; preserve current
  local function signatures and add explicit remote-mode composition/start options.
- `src/ui/workspace/dev.js` — only change if the server signature requires an explicit local-mode/default-preserving
  update.
- `src/ui/workspace/server/remote-db.js` — open/close SQLite handles, enable foreign keys/WAL where appropriate, run
  migrations once, expose transaction helpers, and support temporary database paths for tests.
- `src/ui/workspace/server/remote-schema.js` — define migration SQL and schema versioning for Shared Spaces, revisions,
  comments, capability hashes, status/closed/deleted state, foreign keys, uniqueness constraints, and indexes.
- `src/ui/workspace/server/remote-adapter.js` — implement adapter operations for create Shared Space, verify capability,
  read/list metadata, append/read/list revisions, append/list encrypted comments, resolve/reopen, close, and destructive
  delete.
- `src/ui/workspace/routes/remote-api.js` — implement remote JSON route handlers, bearer extraction, request validation,
  status mapping, and no-store JSON responses.
- `src/shared/collaboration/protocol.js` — refine or add normalize helpers/typedefs for remote create, revision append,
  comment append, metadata list, and lifecycle payloads if the current protocol helpers are too generic.
- `src/shared/collaboration/client.js` — add typed convenience methods for the above Shared Space API endpoints on top
  of the existing redacting `requestJson` primitive so later CLI/browser slices do not duplicate paths.
- `src/shared/collaboration/*.test.js` — add protocol/client tests for any new typed methods or payload validation.
- `src/ui/workspace/workspace.test.js` or new focused tests under `src/ui/workspace/server/` — cover local mode
  unchanged, remote mode route isolation, adapter schema/migrations, authorization, ciphertext-only contracts, and
  remote API behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server.js` — Fresh `App` composition, static asset handling, wrappers, and route registration style.
- `src/ui/workspace/routes/api/handlers.js` — JSON/no-store response and error-mapping conventions, while keeping local
  Plan APIs local-only.
- `src/shared/collaboration/capabilities.js` — capability hashing, timing-safe comparison, scope constants, and
  redaction.
- `src/shared/collaboration/protocol.js` — payload typedefs and validation helpers from slice 01.
- `src/shared/collaboration/client.js` — existing fragment-free URL handling, bearer header placement, and redacted API
  errors.
- `src/shared/collaboration/urls.js` — `/p/<space-id>` URL convention and `/api/spaces/...` URL examples already used by
  tests.
- `../chores-app/src/utils/db.js` — `node:sqlite`/`DatabaseSync` precedent; reuse the dependency idea only, not its
  ad-hoc schema style.

## Implementation Steps

- [ ] Step 1: Verify `node:sqlite` works under this repository's Deno version and CI permissions. If yes, use
      `DatabaseSync` directly; if not, add the selected Deno SQLite import to `deno.json` with a short rationale in the
      implementation.
- [ ] Step 2: Refactor Workspace app creation into shared helpers plus local/remote registration while keeping existing
      `createWorkspaceApp({ cwd, token })` and `startWorkspaceServer({ cwd, host, port, token })` local behavior
      backward compatible.
- [ ] Step 3: Add explicit remote-mode creation/start options such as `{ mode: "remote", dbPath }` and ensure remote
      mode injects only a collaboration adapter/request context, not `ctx.state.cwd`.
- [ ] Step 4: Add tests proving local token-protected Plan Board routes still work in local mode and that `/`,
      `/api/plans`, `/api/board`, `/api/plans/:planId/body`, and local lifecycle APIs return `404` or are otherwise
      unavailable in remote mode.
- [ ] Step 5: Implement SQLite migration/schema code with tables similar to:
      `shared_spaces(id, plan_id, status, latest_revision, created_at, updated_at, closed_at)`,
      `space_capabilities(space_id, scope, capability_hash, created_at)`,
      `space_revisions(space_id, revision, payload_ciphertext, created_at)`, and
      `space_comments(id, space_id, revision, ciphertext, resolved, created_at, updated_at)`, with foreign keys, cascade
      delete, uniqueness on `(space_id, revision)` and `(space_id, scope)`, and indexes for revision/comment lookups.
- [ ] Step 6: Implement adapter creation so `POST /api/spaces` stores the initial revision plus reviewer/maintainer
      capability hashes transactionally, returns server-generated `spaceId` and revision metadata, and never receives or
      persists raw capabilities/content keys.
- [ ] Step 7: Implement adapter read/list operations for metadata, revisions, and comments, including latest revision
      tracking and per-revision comment scoping. Comments must not carry over between revisions.
- [ ] Step 8: Implement capability verification by hashing the presented bearer capability and comparing it to stored
      hashes for the requested scope. Allow maintainer capabilities anywhere reviewer capabilities are allowed, but not
      vice versa.
- [ ] Step 9: Implement adapter mutations for append revision, append comment, resolve/reopen comment, close Shared
      Space, and delete Shared Space. Use transactions for writes that update multiple tables or latest revision/status.
- [ ] Step 10: Implement `src/ui/workspace/routes/remote-api.js` with the endpoint contract above, robust JSON parsing,
      bearer extraction, protocol normalization, no-store JSON responses, and redacted structured errors.
- [ ] Step 11: Extend `src/shared/collaboration/protocol.js` only where needed so route/client/adapter tests share the
      same field names and avoid accepting plaintext fields such as `body`, `authorName`, `originalText`, or `context`
      outside encrypted payload blobs.
- [ ] Step 12: Extend `src/shared/collaboration/client.js` with typed methods such as `createSharedSpace`,
      `getSharedSpace`, `getRevision`, `appendRevision`, `listComments`, `appendComment`, `setCommentState`, and
      `updateSharedSpaceLifecycle`, preserving fragment-free URL construction and bearer redaction.
- [ ] Step 13: Add adapter/API tests covering create/read, revision append/read/list, comment append/list,
      resolve/reopen, close read-only behavior, destructive delete, wrong/missing capability, reviewer vs maintainer
      authorization, missing resources, invalid payloads, and revision conflict behavior.
- [ ] Step 14: Add ciphertext-only tests that insert through public adapter/API paths and inspect SQLite rows to prove
      plaintext Plan bodies, comment text, display names, anchors/original text, and context are absent; also test that
      obvious plaintext field names are rejected at the protocol/API boundary.
- [ ] Step 15: Run focused tests and the full project CI.

## Verification Plan

- Automated: `deno test -A src/ui/workspace src/shared/collaboration`
- Automated: `deno task ci`
- Manual: Using a temporary SQLite file and remote-mode app/server, create a Shared Space through `POST /api/spaces`,
  append a revision, append/list comments, resolve/reopen a comment, close the space, verify further mutations are
  rejected, then delete the space.
- Manual: Inspect the SQLite database after the API flow and verify Plan bodies, comment bodies, display names/authors,
  anchors/original text, and context are stored only as ciphertext payloads or not stored at all.
- Manual: Attempt local Workspace routes against the remote-mode server and verify they do not expose local Plan files,
  board data, or mutation APIs.
- Expected: reviewer capability can read/comment/resolve/reopen but cannot append revisions, close, or delete;
  maintainer capability can append revisions, close, and delete; deleted resources return a clear `404`/deleted-style
  JSON error without leaking whether another capability would have worked.

## Edge Cases & Considerations

- Remote mode must not accidentally expose local Plan files, local settings, `ctx.state.cwd`, or local Workspace routes.
- Do not introduce TypeScript files or TypeScript syntax; use `.js`/`.jsx` and JSDoc typedefs only.
- SQLite writes that update multiple tables must be transactional; enable foreign keys on every connection.
- WAL mode is useful for self-hosted concurrent reads, but tests should avoid depending on global persistent database
  state.
- Deletion is destructive by design. If implementation chooses a tombstone for friendlier deleted responses, the
  tombstone must not retain ciphertext content or capability hashes longer than necessary; a hard-delete plus `404` is
  acceptable for this slice.
- Capability hashes are plaintext authorization metadata, but raw bearer values are not stored. Redact bearer values in
  thrown errors and test output.
- Closed spaces are read-only: reads continue, but new comments/revisions and resolve/reopen mutations should return
  `409`.
- D1/Cloudflare compatibility is a future follow-up; keep SQL and adapter boundaries simple enough for a later prepared
  statement/batch adapter, but do not implement D1 here.
- Browser review UX is explicitly out of scope for this slice. Do not add `/p/:spaceId` UI beyond what is necessary to
  keep route reservations from conflicting with the later frontend slice.
