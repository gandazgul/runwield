---
planId: "25fee6ed-0faa-4968-bc5c-5c23a10e9c04"
classification: "FEATURE"
complexity: "HIGH"
summary: "Harden the accountless self-hosted Plan Server with bounded requests, optional visible inactivity retention, safe reverse-proxy defaults, database-aware readiness and shutdown, tested backup/restore/upgrade guidance, and corrected Collaborative Planning product documentation."
affectedPaths:
    - "docker-compose.yml"
    - "deno.json"
    - "docs/examples/runwield-plan-server.nginx.conf"
    - "docs/collaboration.md"
    - "docs/prd/collaborative-planning-PRD.md"
    - "docs/prd/runwield-workspace-PRD.md"
    - "plans/collaborative-planning-remote-shared-spaces.md"
    - "src/shared/collaboration/protocol.js"
    - "src/shared/collaboration/protocol.test.js"
    - "src/cmd/plans/share.js"
    - "src/cmd/plans/share.test.js"
    - "src/cmd/plans/pull.js"
    - "src/cmd/plans/pull.test.js"
    - "src/ui/workspace/remote-server.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/routes/remote-api.js"
    - "src/ui/workspace/server/remote-adapter.js"
    - "src/ui/workspace/server/remote-db.js"
    - "src/ui/workspace/server/remote-schema.js"
    - "src/ui/workspace/server/remote-dev-api.js"
    - "src/ui/workspace/react/RemotePlanReview.tsx"
    - "src/ui/workspace/static/workspace.css"
    - "src/ui/workspace/workspace.test.js"
frontend: true
devServerCommand: "RUNWIELD_WORKSPACE_MODE=remote RUNWIELD_REMOTE_DB_PATH=.wld/remote-workspace.sqlite RUNWIELD_REMOTE_RETENTION_DAYS=7 deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-18T22:15:51-04:00"
updatedAt: "2026-07-19T03:52:29.003Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 11
dependencies:
    - "09-self-hosted-packaging-and-collaboration-docs"
    - "10-remote-review-plannotator-markdown-annotations"
implementedAt: "2026-07-19T02:58:25.833Z"
verifiedAt: "2026-07-19T03:52:29.003Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-19T03:52:28.915Z"
---

# Self-Hosted Plan Server Hardening, Retention, and Operations

## Context

The self-hosted remote Workspace Plan Server is implemented as a source-built Deno container with SQLite, accountless
reviewer/maintainer bearer capabilities, browser review, and `wld plans share|pull|push|unshare`. The packaging proves
the collaboration loop, but its current defaults and docs are not yet a safe operational baseline for an internet-facing
instance:

- Docker Compose publishes port `8080` on every host interface even though the container serves plain HTTP.
- `POST /api/spaces` is intentionally unauthenticated, and request bodies have no application-level size ceiling.
- The docs recommend HTTP Basic Auth even though protected Plan Server requests already use the `Authorization` header
  for bearer capabilities.
- `/healthz` reports process liveness but not SQLite readiness, and shutdown does not explicitly close the remote
  adapter/database.
- Volume persistence is documented, but backup, restore, integrity checking, upgrade, and rollback are not.
- The parent Epic and Collaborative Planning PRDs retain stale Fresh/Preact, legacy API, D1 success-metric, Basic Auth,
  and already-completed TODO language.

This follow-up keeps the selected accountless model. RunWield will not terminate TLS and will not add an instance-wide
creation credential. Public deployments are expected to place the loopback-bound container behind an operator-managed
reverse proxy such as Nginx. Application payload limits, reverse-proxy rate limits, and optional inactivity retention
bound the immediate abuse/storage risk; stronger public-instance authentication remains future work if operational
evidence requires it.

## Objective

Make the source-built self-hosted Plan Server safer and operable without changing its reviewer/maintainer capability
model:

- bind the Compose service to loopback by default and provide a tested Nginx-oriented proxy example that preserves
  bearer authorization, applies request/rate limits, and leaves TLS certificate management to the operator;
- reject remote JSON request bodies larger than a configurable 5 MiB default with a structured `413` response;
- support optional server-wide inactivity retention, disabled by default, with a documented seven-day public-instance
  example and visible expiry in browser/CLI surfaces;
- refresh expiry on meaningful writes, never on reads, and hard-delete expired Shared Spaces through a bounded cleanup
  loop so existing deleted-remote recovery remains authoritative;
- add database-aware readiness, explicit adapter/database closure, and safe SQLite migration behavior;
- document and verify cold backup/restore, integrity checks, upgrades, rollback limits, single-container SQLite
  operation, and public/private deployment trade-offs; and
- update the Collaborative Planning PRDs and parent Epic so current architecture, scope, risks, and completed work are
  described as reality rather than mixed with historical v1 proposals.

Acceptance criteria:

- A default `docker compose up` does not expose the plain-HTTP Plan Server beyond the host loopback interface.
- Nginx or an equivalent reverse proxy remains responsible for public TLS; RunWield does not read certificates or serve
  HTTPS.
- Proxy guidance does not recommend Basic Auth and explicitly forwards `Authorization: Bearer` unchanged.
- Direct and chunked JSON bodies over 5 MiB are rejected before unbounded buffering; the limit is configurable with a
  validated environment variable and cannot be disabled accidentally by an invalid value.
- With retention unset or disabled, Shared Spaces do not expire. With `RUNWIELD_REMOTE_RETENTION_DAYS=7`, a new or
  meaningfully mutated Shared Space reports an expiry seven days ahead.
- New Revisions, comments, resolve/reopen, and close refresh inactivity expiry; reads do not. Cleanup hard-deletes
  expired ciphertext and capability hashes, and subsequent requests return the same not-found/deleted semantics used by
  `wld plans unshare` recovery.
- Existing v1 SQLite databases migrate without data loss, unsupported newer schema versions fail fast, and operators are
  told to back up before upgrades.
- The remote review page and relevant CLI output identify when expiry is enabled and show the current expiry without
  storing it in Plan Front Matter or exposing secrets.
- SIGTERM/SIGINT stop cleanup work, close the SQLite adapter exactly once, and let the container exit cleanly.
- The documentation clearly distinguishes source-built packaging from a published image distribution channel and does
  not claim hosted Cloudflare/D1 deployment is part of current completion criteria.

## Approach

Keep abuse controls layered. The Plan Server owns a hard request-size boundary because it must remain safe even when a
proxy is misconfigured. The example Nginx edge owns per-IP rate limiting, public TLS termination, and security headers;
its baseline should use a stricter creation rate than ordinary review traffic and a body limit matching the server.
Compose should publish `127.0.0.1:8080:8080`, requiring an operator to make public exposure intentional.

Add optional inactivity retention to the existing SQLite adapter rather than an external cleanup script. Introduce a
nullable `expires_at` column through an ordered schema migration. When retention is enabled, creation and meaningful
mutations transactionally update both `updated_at` and `expires_at`; reads never do. The packaged remote server owns a
startup sweep plus a fixed hourly cleanup interval, logs aggregate deletion counts only, clears the timer on shutdown,
and closes the adapter in `finally`. Enabling retention on an existing database grants rows without an expiry a full
retention window from startup; changing the retention value applies to newly created or subsequently mutated Shared
Spaces. Disabling retention stops cleanup and clears persisted expiry so clients no longer advertise an inactive policy.

Expose optional `expiresAt` in Shared Space metadata and protocol normalization. Show it as a warning/metadata notice in
the existing RunWield remote review header using current badge/notice tokens. `wld plans share` should print initial
expiry when enabled, and `wld plans pull` should report the fetched expiry so maintainers understand that an inactive
public Shared Space can disappear. Do not copy expiry into collaboration Front Matter because remote comment activity
can change it independently of the local Plan.

Treat `/healthz` as liveness and add `/readyz` for database readiness. Compose should use readiness. Refactor packaged
server ownership narrowly enough that shutdown closes the adapter without changing local Plan Board or Review Loop
server behavior.

## Files to Modify

- `docker-compose.yml` — publish the Plan Server on host loopback only, use `/readyz` for health, and keep retention
  disabled unless an operator opts in.
- `deno.json` — update remote packaging/test tasks only if needed for new configuration or repeatable verification.
- `docs/examples/runwield-plan-server.nginx.conf` — add a syntax-checkable Nginx baseline with upstream forwarding,
  explicit bearer-header preservation, 5 MiB body limit, stricter Shared Space creation rate, general API rate limit,
  and security headers; omit certificate ownership and explain that operators incorporate it into their TLS server.
- `docs/collaboration.md` — document private/VPN and accountless public profiles, reverse-proxy/TLS ownership, absence
  of built-in creation authentication, payload/rate limits, retention behavior, expiry/recovery, backup/restore,
  integrity checks, upgrade/rollback, SQLite constraints, and source-build-only packaging.
- `docs/prd/collaborative-planning-PRD.md` — replace legacy API/schema examples and D1 completion metrics with the
  implemented Shared Space contract; remove completed/open-question drift; specify current hardening and explicitly
  defer hosted deployment and stronger public-instance authentication.
- `docs/prd/runwield-workspace-PRD.md` — remove Basic Auth guidance, align self-hosted deployment constraints and
  retention language, and preserve hosted Workspace as future scope.
- `plans/collaborative-planning-remote-shared-spaces.md` — refresh the parent Epic's Fresh/Preact and pre-implementation
  findings, record completed child slices plus this hardening follow-up, and state current accountless public/private
  deployment boundaries.
- `src/shared/collaboration/protocol.js` — add optional `expiresAt` normalization to Shared Space metadata without
  changing ciphertext/privacy boundaries.
- `src/shared/collaboration/protocol.test.js` — cover valid, absent, and malformed expiry metadata.
- `src/cmd/plans/share.js` / `src/cmd/plans/share.test.js` — preserve expiry from create metadata and print a concise
  inactivity-expiry notice when enabled.
- `src/cmd/plans/pull.js` / `src/cmd/plans/pull.test.js` — report current remote expiry after metadata fetch without
  persisting it into Plan Front Matter or Agent context unnecessarily.
- `src/ui/workspace/remote-server.js` — parse request-size/retention configuration, own the adapter and cleanup timer,
  log non-secret policy state, and close resources exactly once on shutdown.
- `src/ui/workspace/server.js` — pass the injected remote adapter/request limit into remote composition, separate
  `/healthz` liveness from `/readyz`, and avoid affecting local Workspace/review server callers.
- `src/ui/workspace/routes/remote-api.js` — enforce bounded JSON reads and return structured `413` errors before route
  payload normalization.
- `src/ui/workspace/server/remote-adapter.js` — persist/refresh/map expiry, expose readiness and expired-space cleanup,
  and keep cleanup transactionally consistent with normal writes.
- `src/ui/workspace/server/remote-db.js` / `remote-schema.js` — replace the v1 create-and-mark behavior with ordered,
  transactional migrations, add nullable `expires_at`, and reject unsupported newer database versions.
- `src/ui/workspace/server/remote-dev-api.js` — honor request-size and retention configuration in remote development so
  browser verification matches the packaged server.
- `src/ui/workspace/react/RemotePlanReview.tsx` — show an accessible expiry notice using existing Workspace status and
  notice patterns; do not add a new visual system or browser editing authority.
- `src/ui/workspace/static/workspace.css` — add only minimal remote expiry layout styling if existing badge/notice
  patterns are insufficient.
- `src/ui/workspace/workspace.test.js` — cover migration, retention, bounded requests, readiness, shutdown ownership,
  local/remote route isolation, and remote expiry rendering helpers/smoke behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/remote-adapter.js` — existing transactional Shared Space mutations and hard-delete semantics.
- `src/ui/workspace/server/remote-db.js` and `remote-schema.js` — current SQLite open/WAL/schema version seams to evolve
  into ordered migrations.
- `src/ui/workspace/routes/remote-api.js` — one shared `readJson` boundary for all remote write endpoints.
- `src/ui/workspace/remote-server.js` — current environment parsing, signal handling, and packaged process ownership.
- `src/shared/collaboration/protocol.js` — canonical Shared Space metadata normalization consumed by CLI and browser
  paths.
- `src/cmd/plans/share.js`, `pull.js`, and `unshare.js` — current metadata output and deleted-remote recovery language.
- `src/ui/workspace/react/RemotePlanReview.tsx` and `src/ui/workspace/react/plannotator.css` — existing remote header,
  badges, notices, and RunWield Design System bridge.
- `src/ui/design-system/tokens.css` and `components.css` — existing `--rw-*` warning/metadata tokens and accessible
  notice patterns; no new token should be added unless the existing patterns cannot express expiry.
- `docs/collaboration.md` — current end-to-end setup and recovery guide, to extend rather than duplicate.

## Implementation Steps

- [ ] Step 1: Add reusable parsers for `RUNWIELD_REMOTE_MAX_REQUEST_BYTES` (default `5242880`) and
      `RUNWIELD_REMOTE_RETENTION_DAYS` (unset/`0` disables; positive integer enables). Fail startup on malformed,
      negative, non-integer, or unsafe values and test precedence/config logging without printing secrets.
- [ ] Step 2: Refactor the remote API JSON reader to enforce the configured byte ceiling from the request stream,
      rejecting oversized `Content-Length` immediately and stopping chunked reads once the limit is crossed. Return
      `{ error, message, status: 413 }` with `cache-control: no-store`; preserve current invalid-JSON `400` behavior.
- [ ] Step 3: Convert SQLite schema handling into ordered transactional migrations. Preserve existing v1 databases,
      migrate to a new version with nullable `shared_spaces.expires_at`, record each migration once, and fail fast when
      the database contains a schema version newer than this runtime supports.
- [ ] Step 4: Extend Shared Space metadata and protocol normalization with optional ISO-8601 `expiresAt`. Keep expiry as
      allowed plaintext lifecycle metadata; do not include content keys, capabilities, ciphertext-derived content, or
      expiry in local Plan Front Matter.
- [ ] Step 5: Add retention policy support to `createRemoteWorkspaceAdapter`: creation calculates expiry when enabled;
      append Revision, append comment, resolve/reopen, and close update `updated_at` plus expiry in the same
      transaction; reads leave both untouched.
- [ ] Step 6: Add adapter operations for readiness (`SELECT 1` or equivalent) and hard deletion of rows whose
      `expires_at <= now`. Cleanup must cascade ciphertext/capability removal, return an aggregate count, tolerate an
      empty result, and use the same not-found behavior as explicit unshare afterward.
- [ ] Step 7: Reconcile retention configuration safely at packaged startup: enabling retention grants existing rows with
      null expiry a full window from startup; disabling it clears existing expiry and performs no cleanup; a changed
      enabled duration applies after the next meaningful mutation. Document these transition semantics.
- [ ] Step 8: Make `remote-server.js` own the remote adapter, startup cleanup, fixed hourly cleanup timer, and shutdown.
      Clear the timer and close the adapter exactly once after SIGINT/SIGTERM or startup/runtime failure. Log only
      retention mode, aggregate cleanup counts, bind address, port, database path, and request limit.
- [ ] Step 9: Keep `GET /healthz` as non-secret process liveness and add remote-only `GET /readyz` that returns `200`
      only when the SQLite adapter is usable. Update Compose health checks and prove local Plan Board/review modes do
      not expose either remote database authority or remote routes.
- [ ] Step 10: Update remote Astro development composition to use the same retention/request-limit parsing and adapter
      behavior so the headed-browser flow is representative.
- [ ] Step 11: Update `wld plans share` to retain optional create-response expiry and print the exact expiration time
      plus a short inactivity explanation. Update pull output to report current expiry when present. Keep expiry out of
      secrets, collaboration Front Matter, and normal settings.
- [ ] Step 12: Add an expiry notice to remote browser review using existing RunWield badge/notice styling. It should
      show the exact expiry and explain that a new Revision, comment, resolve/reopen, or close refreshes inactivity
      while viewing alone does not. Refresh displayed metadata after browser mutations.
- [ ] Step 13: Change Compose publishing to `127.0.0.1:8080:8080`. Keep container HTTP-only and retention disabled by
      default; do not add certificate mounts, ACME clients, Basic Auth, or an instance creation credential.
- [ ] Step 14: Add `docs/examples/runwield-plan-server.nginx.conf` with a syntax-checkable baseline that proxies to
      loopback, preserves `Authorization`, sets `client_max_body_size` consistently, returns `429` under per-IP limits,
      applies a stricter create limit than normal review API traffic, and adds appropriate proxy/security headers.
- [ ] Step 15: Expand `docs/collaboration.md` with explicit private/VPN and public accountless profiles. State that
      public creation remains unauthenticated, Nginx/equivalent owns TLS and edge rate limits, direct container
      publication is not the recommended public topology, and operators should monitor disk/use before considering
      future creation authentication.
- [ ] Step 16: Add tested cold backup/restore and upgrade instructions for the named SQLite volume: stop the service so
      WAL is checkpointed, copy the database with ownership preserved, verify the restored database, back up before
      rebuilding/upgrading, check `/readyz`, and restore the prior database/image when rollback is compatible. Warn
      against live main-file-only copies, shared NFS/network filesystems, and multiple containers against one SQLite
      file.
- [ ] Step 17: Update both PRDs and the parent Epic to remove stale Fresh/Preact, Basic Auth, legacy `/api/plans`, D1
      completion metrics, completed TODOs, and resolved encryption questions. Describe the implemented Astro/React
      Shared Space contract, source-built Docker packaging, accountless public-instance risk controls, optional
      inactivity retention, and deferred hosted/stronger-auth work.
- [ ] Step 18: Run focused backend/CLI/frontend tests, schema migration tests against a v1 fixture, Workspace checks,
      Nginx syntax validation, Docker build/Compose smoke tests, headed browser verification, and full CI.

## Verification Plan

- Automated:
  `deno test -A src/shared/collaboration/protocol.test.js src/cmd/plans/share.test.js src/cmd/plans/pull.test.js src/ui/workspace/workspace.test.js`
- Automated: `deno task workspace:check`
- Automated: `deno task workspace:build && deno run -A scripts/build-workspace-runtime.js`
- Automated: `docker compose config && docker build -t runwield-plan-server:hardening .`
- Automated: syntax-check `docs/examples/runwield-plan-server.nginx.conf` with a pinned Nginx container.
- Automated: `deno task ci`
- Migration: create a real v1 SQLite fixture with Shared Spaces, Revisions, comments, and capability hashes; start the
  new adapter, verify one-time migration and preserved data, restart to prove idempotence, and verify a newer unknown
  schema version is refused without mutation.
- Request limits: test declared and chunked bodies immediately below, at, and above 5 MiB; verify only oversized bodies
  return structured `413` and no partial row is written.
- Retention: use an injected clock to prove disabled retention, initial seven-day expiry, mutation refresh, read
  non-refresh, startup grace for existing null expiry, disabled-policy clearing, aggregate cleanup, cascade deletion,
  and post-expiry `404` behavior.
- Shutdown/readiness: prove `/healthz` remains liveness-only, `/readyz` checks SQLite, SIGTERM clears cleanup work and
  closes the adapter once, and a restarted server can reopen the same database.
- Frontend setup: run the Front Matter `devServerCommand`, seed/share a Plan, and use the generated reviewer URL at
  `http://127.0.0.1:5173/p/<space-id>#key=...&cap=...&role=reviewer`.
- Headed browser: verify the expiry notice is readable and uses established Workspace styling; a page reload/read does
  not move expiry; comment and resolve/reopen actions refresh it; closed/deleted/expired states remain understandable;
  and no secret appears in rendered HTML, console output, or request URLs.
- Proxy/manual: start Compose and prove host-LAN access is unavailable by default while loopback works; place the Nginx
  example in front, verify reviewer/maintainer bearer requests work, oversized bodies are rejected, and create/API rate
  limits return `429` without logging authorization values.
- Operations/manual: complete the documented stop/backup/start, destructive test change, stop/restore/start sequence;
  verify `/readyz`, old reviewer links, Revisions, and comments survive restoration.
- Expected: private self-hosting remains non-expiring by default; an intentionally proxied public accountless instance
  has bounded request/rate/storage growth and visible seven-day inactivity expiry without RunWield owning TLS or adding
  a new authentication model.

## Edge Cases & Considerations

- Public Shared Space creation remains unauthenticated by explicit product decision. Payload limits, rate limits, and
  retention bound abuse but do not establish identity or eliminate denial-of-service risk. A future Plan may add a
  dedicated creation credential after its CLI secret storage, rotation, and recovery UX are designed.
- Basic Auth is not a safe generic recommendation because both CLI and browser collaboration calls use
  `Authorization: Bearer`. Reverse proxies must preserve that header; cookie-based SSO, VPN, mTLS, or network controls
  require separate operator testing if used.
- RunWield serves HTTP inside the deployment boundary. Operators own TLS termination, certificate renewal, DNS, and
  external security policy; examples must use placeholder domains and must not imply that the container handles HTTPS.
- The 5 MiB limit applies to the complete JSON request body, including encoding overhead, not decrypted Plan size. Proxy
  and application limits should agree so failures are predictable.
- Retention uses server time. Operators need a reliable clock; tests must inject time rather than sleep.
- Reads do not refresh retention, preventing bots or passive viewers from preserving abandoned data forever. Meaningful
  writes refresh the whole Shared Space, not only one Revision.
- Enabling retention on an established private database must not immediately purge old rows. Existing null-expiry rows
  receive one full configured grace window at startup.
- Expired cleanup is destructive and intentionally indistinguishable from normal deleted/not-found state to clients.
  Local Plans remain under Shared Plan Lock until a maintainer uses the existing explicit unshare recovery path.
- SQLite WAL requires a clean stop/checkpoint or SQLite-aware backup. Copying only the main database while the service
  is live can lose committed data. A single database file must not be shared by multiple active Plan Server containers.
- Database migrations are forward-only unless explicitly proven otherwise. Rollback docs must restore a compatible
  pre-upgrade database rather than encouraging an older image to open a newer schema.
- Source-built Docker packaging remains the current distribution model. Publishing signed/versioned multi-architecture
  images is separate release work and must not be implied by this Plan.
- The expiry UI is a small status addition, not a remote Plan editor or visual redesign. Reuse the RunWield Design
  System and Plannotator token bridge; keep `frontend: true` and perform headed browser verification.
