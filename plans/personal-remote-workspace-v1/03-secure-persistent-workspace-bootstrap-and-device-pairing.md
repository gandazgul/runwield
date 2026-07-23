---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Create the persistent owner Workspace entry point with registered Project administration, Project-scoped Plan Boards, and paired-device authorization for later Session continuation surfaces."
affectedPaths:
    - "src/shared/owner-coordination/"
    - "src/ui/workspace/"
    - "src/cmd/workspace/"
    - "src/cmd/registry.js"
    - "src/cmd/__tests__/registry.test.js"
    - "src/constants.js"
    - "docs/usage.md"
    - "docs/design-system.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-21T23:56:51.460-04:00"
updatedAt: "2026-07-23T12:27:53.450Z"
status: "in_progress"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 3
dependencies:
    - "02-owner-coordination-database-and-session-catalog"
humanReviewMode: null
humanReviewDecision: null
executionBaselineTree: "f69d416188af35bff09bcae940845bedf1693a87"
worktreeId: "383c470f"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-personal-remote-workspace-v1-03-secure-persisten-383c470f"
worktreeBranch: "runwield/worktree/personal-remote-workspace-v1-03-secure-persisten-383c470f"
worktreeBaseBranch: "main"
worktreeStatus: "active"
---

# Secure Persistent Workspace Bootstrap and Device Pairing

## Context

Slice 2 delivered the owner coordination database and stable registered Project APIs. This slice turns that foundation
into the persistent owner Workspace entry point required before a phone can reach later Session continuation surfaces.
The existing browser Workspace is an Astro SSR/React application served in either ephemeral current-checkout mode or
public Shared Space mode; owner mode must be a third, explicit composition with its own database and authorization
grant.

Owner Workspace is one product, not a second Plan UI. Its Project detail reuses the existing Plan Board, status views,
and Plan detail presentation under a registered Project. Until slice 10 adds the cross-Project Attention Dashboard, the
owner home is a focused Project/setup surface. `wld plans ui` remains the lightweight, loopback-first, current-checkout
compatibility launcher and must not register a Project or open owner state implicitly.

The user selected a browser-initiated pairing flow: an unpaired browser requests access and displays a short code, then
the owner approves that specific request locally with `wld workspace pair <code>`. The persistent process starts with
`wld workspace serve`. Pairing is authorization, not transport encryption; non-loopback browser access still requires a
trusted TLS boundary.

## Objective

Build a persistent personal Workspace that:

- starts through `wld workspace serve` against `~/.wld/owner-coordination.sqlite3` while preserving `wld plans ui`;
- lets the owner register, inspect, disable/enable, remove/restore, relink, and rescan trusted Projects;
- presents the existing Plan Board and all Plan Status views within an enabled registered Project boundary;
- pairs a browser through one short-lived, locally approved, single-use request;
- authenticates owner HTTP and future WebSocket connections with persistent, hashed, revocable device credentials;
- protects state-changing owner routes with strict Host, Origin, cookie, and CSRF policy;
- lists and revokes paired devices, invalidating active owner connections without canceling unrelated workflows; and
- refuses unsafe non-loopback defaults and documents private-network/TLS-terminator operation.

This slice does not add the Attention Dashboard, Session continuation, Durable Workflow Checkpoints, Plan Workflow
Leases, accounts/passwords, built-in certificate management, or public-internet deployment. Owner-mode Plan detail is
read-only until the later ownership slices can authorize lifecycle and body mutations without bypassing Plan Workflow
Leases; ephemeral `wld plans ui` retains its current capabilities.

## Approach

Add a versioned device/pairing migration and services to `src/shared/owner-coordination/`, keeping raw SQLite private. A
pairing request contains a cryptographically random short approval code plus a separate high-entropy browser proof.
Store hashes only. The code identifies the request to the local CLI but cannot claim access; the waiting browser must
present its proof when claiming an approved request. Move requests atomically through `pending -> approved -> claimed`,
with expiry as a terminal rejection, so retries and concurrent approval/claim cannot mint multiple credentials.

On successful claim, generate a 256-bit device credential and independent CSRF secret. Persist only their hashes and set
host-only cookies with `Path=/` and `SameSite=Strict`; the device cookie is `HttpOnly`, and both cookies are `Secure`
for the configured HTTPS public origin. Use a one-year persistent cookie lifetime as a named, tested default so pairing
survives browser restarts; database revocation remains authoritative on every request and may end the session earlier.
Never place owner credentials in URLs, browser storage, logs, Plans, Session Transcripts, or repository files.

Extend `src/ui/workspace/server.js` with an `owner` mode rather than blending owner authority into local token mode or
the standalone Shared Space adapter. Owner middleware validates the configured Host/public origin, authenticates the
device, checks exact Origin on state changes and WebSocket upgrades, and requires the CSRF cookie value to match a
header and its stored hash for authenticated mutations. Pairing bootstrap endpoints remain narrowly unauthenticated but
still enforce Host/Origin, request limits, expiry, and the high-entropy browser proof. Add a connection registry/auth
hook so revocation closes registered owner WebSocket/SSE connections; later Session slices must reuse it rather than
invent another grant.

Serve loopback on a stable default port through `wld workspace serve`, with overrides for bind/port and an explicit
HTTPS public origin. Non-loopback binding must fail unless the caller explicitly selects trusted TLS-terminator mode and
supplies an `https://` public origin; ignore forwarded-host/proto headers and validate against that configured origin so
untrusted proxy headers cannot widen authority. RunWield does not issue certificates. Document loopback binding behind
Tailscale Serve or an equivalent trusted terminator as the preferred deployment, and require operators who expose a
non-loopback plaintext backend listener to isolate that listener from direct browser access.

Build owner Project APIs and Astro/React routes over the slice 2 service surface. Every Project-scoped request resolves
`projectId` through `requireEnabledProjectRoot()` server-side; client CWD/root headers and request fields never grant
filesystem authority. Return UI DTOs with stable IDs, display names, lifecycle, sanitized root labels, and health rather
than leaking absolute roots through normal cards or errors. Parameterize the existing Plan Board/detail links and API
bases for `/projects/:projectId/plans/...`, while keeping the ephemeral routes unchanged and suppressing owner-mode Plan
mutation controls until lease enforcement lands.

## Files to Modify

- `src/shared/owner-coordination/schema.js` and `database.js` — add the next ordered owner migration for pairing
  requests and paired devices, preserving backup/newer-schema behavior.
- `src/shared/owner-coordination/pairing.js` — create, approve, claim, expire, and prune bounded pairing requests with
  hashed codes/proofs, transactional state transitions, and injectable clock/randomness.
- `src/shared/owner-coordination/devices.js` — create/list/touch/revoke devices and verify credential/CSRF hashes with
  constant-time comparisons.
- `src/shared/owner-coordination/index.js` — expose narrow pairing/device methods without exposing the database handle.
- `src/shared/owner-coordination/*.test.js` — cover migrations, pairing races/expiry, hashing, persistence, and
  revocation.
- `src/cmd/workspace/index.js`, `serve.js`, and `pair.js` — implement `wld workspace serve` and local
  `wld workspace pair <code>` workflows, help, lifecycle cleanup, and safe bind/public-origin validation.
- `src/cmd/workspace/*.test.js`, `src/cmd/registry.js`, `src/cmd/__tests__/registry.test.js`, and `src/constants.js` —
  register and verify the CLI-only Workspace command without changing the Plans command contract.
- `src/ui/workspace/server.js` — compose owner mode, owner-store lifetime, authenticated page/API routing, internal
  Project-root resolution, security headers, and shutdown cleanup while preserving local and remote modes.
- `src/ui/workspace/server/owner-auth.js`, `owner-origin.js`, and `owner-projects.js` — centralize cookie/CSRF,
  Host/Origin/public-origin policy, live connection invalidation, sanitized Project DTOs, and registered-root
  resolution.
- `src/ui/workspace/routes/owner-api.js` — add pairing status/claim, Project administration/rescan, device list/revoke,
  and read-only Project Plan endpoints with bounded request parsing and stable error shapes.
- `src/ui/workspace/pages/pair.astro`, `devices.astro`, `projects/`, and `layouts/WorkspaceLayout.astro` — add unpaired,
  setup, Project administration, Project Plan Board/detail, and device management routes in canonical Workspace
  language.
- `src/ui/workspace/components/`, `islands/`, `constants.js`, and `static/workspace.css` — add responsive pairing,
  Project-health/repair, device revocation controls, and parameterized Plan Board navigation/API bases using `--rw-*`
  tokens and existing card, notice, form, dialog, and detail patterns.
- `src/ui/workspace/workspace.test.js` and focused owner Workspace tests — verify composition, route containment, auth,
  security policy, Shared Space isolation, and unchanged ephemeral behavior.
- `docs/usage.md` — document commands, pairing, revocation, loopback defaults, trusted private networking, supported TLS
  terminator configuration, and the fact that pairing does not provide encryption.
- `docs/design-system.md` — document only genuinely reusable pairing-code, Project-health, or device-list patterns that
  are not already covered by cards, notices, forms, dialogs, and danger actions.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/owner-coordination/index.js` — use its adapter-neutral store and Project/Session catalog methods; do not
  issue owner-database SQL from Workspace or CLI adapters.
- `src/shared/owner-coordination/database.js` and `schema.js` — extend ordered migrations, WAL, backup, busy-timeout,
  transaction, and newer-schema refusal behavior.
- `src/shared/owner-coordination/projects.js` — reuse `requireEnabledProjectRoot`, lifecycle, health, relink, and rescan
  services as the only Project authority.
- `src/ui/workspace/server.js` — retain its explicit app-mode composition and internal CWD-header overwrite pattern;
  never trust a browser-supplied `x-runwield-workspace-cwd`.
- `src/ui/workspace/server/plan-adapter.js` and existing Plan API projections — reuse canonical Plan loading after owner
  Project authorization instead of duplicating Plan parsing or lifecycle logic.
- `src/ui/workspace/components/Board.jsx`, `PlanCard.jsx`, `PlanDetail.jsx`, and `islands/` — parameterize existing Plan
  Board/status/detail presentation rather than building another dashboard.
- `src/ui/workspace/server/remote-adapter.js` and `routes/remote-api.js` — follow bounded parsing and hashed-secret
  conventions, but do not reuse Shared Space credentials, storage, bearer capabilities, or authorization decisions.
- `src/cmd/plans/ui.js` — reuse argument parsing, browser opening, and shutdown patterns where appropriate while leaving
  its ephemeral token workflow behavior intact.
- `src/ui/design-system/`, `src/ui/workspace/static/workspace.css`, and `docs/design-system.md` — preserve the RunWield
  Design System, responsive detail patterns, visible focus, text-plus-color health, and danger confirmation behavior.

## Implementation Steps

- [ ] Add owner schema migration v2 for pairing requests and paired devices. Pairing rows must include hashed approval
      code, hashed browser proof, requested device label, state, creation/expiry/approval/claim timestamps, and claimed
      device ID. Device rows must include stable ID/label, credential and CSRF hashes, created/last-seen/revoked
      timestamps, and no plaintext secrets. Add uniqueness/index constraints for active lookup and claim idempotency.
- [ ] Implement cryptographic helpers and pairing services. Generate collision-checked human codes and 256-bit browser
      proofs, cap outstanding requests, expire them eagerly, prune old terminal rows, and make approve/claim
      compare-and- set transactions. The CLI must reject unknown, ambiguous, expired, already claimed, or concurrently
      changed codes; the browser proof—not the short code—must be required to poll/claim.
- [ ] Implement device services using constant-time hash comparison. Generate the durable credential and CSRF secret
      only when an approved browser claims once; list safe device metadata, touch last-seen without excessive writes,
      and make revocation idempotent. Add tests using two database connections to prove one request produces at most one
      device.
- [ ] Add the CLI-only `workspace` command group. `wld workspace serve` defaults to `127.0.0.1:8787`, supports `--bind`,
      `--port`, `--public-origin`, trusted TLS-terminator mode, and `--no-open`, opens the owner store once, and shuts
      down cleanly on SIGINT/SIGTERM. `wld workspace pair <code>` approves through the shared store and prints only safe
      request/device-label/expiry information—never a credential or browser proof.
- [ ] Enforce startup transport policy. Loopback HTTP remains supported for same-machine use. Reject non-loopback binds
      unless TLS-terminator mode is explicit and `--public-origin` is an HTTPS origin with no path/query/fragment. Do
      not infer trust from `Forwarded` or `X-Forwarded-*`; validate request Host and Origin against configured
      loopback/public origins and document that the backend listener must be unreachable except through the trusted
      terminator.
- [ ] Add `owner` server composition and common security headers. Owner pages and APIs should send
      `Cache-Control:
      no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, frame denial,
      and a CSP containing at least `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
      `frame-ancestors 'none'`, and `form-action
      'self'`, adjusted only as required for verified Astro assets.
      Shared Space and ephemeral apps retain separate middleware and credentials.
- [ ] Implement the unpaired bootstrap route. Accept a bounded/sanitized device label, create a pending request only
      after Host/Origin/rate/total-pending checks, set a short-lived HttpOnly bootstrap-proof cookie, and display the
      short code with expiry and the exact `wld workspace pair <code>` instruction. Poll by proof with backoff; on
      approval, claim once, set persistent device/CSRF cookies, clear bootstrap state, and redirect to owner home.
- [ ] Add owner request authorization. Authenticate every protected HTTP request from the host-only device cookie; for
      mutations also require exact Origin plus equality among the CSRF cookie, `x-runwield-csrf` header, and stored
      hash. Apply the same device and exact-Origin checks to future WebSocket upgrades, expose a connection-registration
      hook, and close all connections for a revoked device. Recheck revocation on each ordinary request/upgrade.
- [ ] Add owner Project APIs over the shared store for list/register, lifecycle enable/disable, tombstoned
      remove/restore, relink, health, and explicit full Session catalog rescan. Require absolute path input only for
      register/relink, return sanitized DTOs/errors, never change process CWD, and never accept a browser root/CWD as
      subsequent authority.
- [ ] Build the temporary owner home and Project administration UI. Show enabled, disabled, removed, and unhealthy
      Projects with text health, repair guidance, accessible forms/dialogs, explicit destructive confirmation, rescan
      diagnostics, empty/setup state, and links only for enabled/available Projects. Keep it Project-focused rather than
      inventing the later Attention Dashboard or flattening Plans across Projects.
- [ ] Mount the existing Plan Board under `/projects/:projectId/plans`, with closed/on-hold tabs and detail routes.
      Parameterize links, search state, back navigation, and API bases without propagating the ephemeral token query.
      Resolve the Project root server-side for every page/API request, use stable `projectId` for owner route identity,
      and reject disabled, removed, missing, or relink-conflicted Projects without exposing absolute paths.
- [ ] Keep owner Project Plan views read-only in this slice. Do not register owner lifecycle/body POST handlers, and
      project capabilities into the UI so editing and lifecycle actions are unavailable with a clear ownership-safety
      explanation where absence would be confusing. Preserve current `wld plans ui` routes, token handling, and mutation
      behavior for compatibility; later Plan Workflow Lease work may enable equivalent owner actions safely.
- [ ] Add paired-device management. Show the current device, safe label, paired time, last seen, and revoked state; use
      a danger confirmation for revocation. Revoking the current device must clear cookies and return to pairing, while
      revoking another device must close its active registered connections and deny its next HTTP/upgrade request
      without changing Session, Plan, or workflow state.
- [ ] Add focused service, CLI, route, and SSR/component tests. Keep time/randomness/store/connection dependencies
      injectable, avoid brittle visual snapshots, and prove local/remote/owner modes cannot authorize one another.
- [ ] Update usage/TLS guidance and any genuinely new design-system patterns, then run the full quality gate and real
      browser checks against both the HMR visual surface and the built owner server.

## Verification Plan

- Automated: run `deno task ci` and fix all failures.
- Automated: owner database tests cover v1-to-v2 migration/backup, idempotent reopen, newer-schema refusal, code/proof/
  credential/CSRF hashing, code collisions, request caps, expiry boundaries, approve/claim races, duplicate polling,
  one- device claim, and revocation across independent connections.
- Automated: CLI tests cover exact `workspace serve`/`workspace pair` help and parsing, loopback defaults, invalid ports
  and origins, non-loopback refusal, explicit TLS-terminator mode, safe output, expired/unknown/claimed code errors,
  shutdown cleanup, and unchanged `plans ui` registration/help.
- Automated: owner route tests cover unpaired rejection, bootstrap proof binding, cookie flags/lifetimes, exact Host and
  Origin checks, CSRF missing/mismatch, credential rotation/claim replay, revoked HTTP and WebSocket authorization,
  connection closure, security headers, request bounds, and no secrets in URLs/bodies/log-shaped errors.
- Automated: Project tests cover two registrations, duplicate/symlink convergence, health/lifecycle states,
  remove/restore, relink conflicts, full rescan diagnostics, sanitized DTOs/errors, and refusal to open an unregistered,
  disabled, removed, missing, or client-supplied root.
- Automated: owner Plan Board tests cover active/closed/on-hold and Plan detail routes under two Project IDs, stable
  Project-scoped links/API bases, no query-token propagation, read-only owner capabilities, rejected owner mutation
  requests, and unchanged ephemeral current-checkout behavior.
- Automated: trust-separation tests prove a Shared Space capability cannot open owner routes, a paired-device cookie
  cannot authorize Shared Space operations, and owner tables/store handles are not used by the remote adapter.
- Manual visual/HMR: run `deno task workspace:dev` for component/layout iteration and inspect pairing, empty Project,
  unhealthy Project, Project Plan Board, and device-list states at desktop and phone widths; HMR is a visual aid only
  and does not substitute for owner-auth integration testing.
- Manual built owner flow: run `deno task workspace:build`, then
  `deno run -A --unstable-no-legacy-abort src/cli.js workspace serve --no-open`; open an unpaired browser, request
  access, approve with `wld workspace pair <code>`, register two temporary Projects, browse each Project's Plan Status
  views, revoke the browser, and verify it returns to pairing.
- Manual private-network flow: place the loopback listener behind a trusted Tailscale/WireGuard-compatible HTTPS
  terminator with the configured public origin, pair a phone-sized browser, and verify cookies are Secure, navigation
  and Project repair controls are touch/keyboard accessible, and direct plaintext non-loopback startup is refused.
- Expected result: one paired owner can persistently reach registered Project Plan Boards from a phone through a secure
  private-network boundary, while unpaired/revoked devices, unregistered roots, and Shared Space capabilities cannot
  cross into owner authority.

## Edge Cases & Considerations

- **First-device bootstrap:** there is no ambient browser administrator. Local CLI approval is the trust root; a short
  code alone is never a bearer credential and cannot be claimed without the browser's high-entropy proof.
- **Pairing races and clock changes:** use database compare-and-set state and an injected wall clock. Approval just
  before expiry does not extend claim indefinitely; the original bounded expiry remains authoritative.
- **Request flooding:** cap pending requests, expire/prune them, bound labels/bodies, and apply in-process request-rate
  limits. Restart may reset the rate bucket but must not bypass durable pending limits or expiry.
- **Cookie persistence:** the one-year lifetime is a low-risk v1 default, not an account-recovery promise. Browser data
  clearing, expiry, owner database loss, or revocation requires pairing again.
- **TLS boundary:** pairing authenticates but never encrypts. RunWield does not manage certificates, and proxy mode must
  not accept arbitrary forwarded headers or make a directly reachable plaintext listener appear safe.
- **DNS rebinding and cross-site requests:** exact Host/public-origin checks, `SameSite=Strict`, exact Origin, CSRF,
  CSP, and frame denial are cumulative controls; none should be treated as a substitute for the others.
- **Revocation:** close owner live connections and reject later requests, but do not cancel an Agent turn, release a
  future Session Activation Lease, or resolve a Durable Workflow Checkpoint merely because a browser was revoked.
- **Project authorization:** browser pairing authorizes the owner surface, not arbitrary filesystem access. Every
  Project operation still passes stable Project identity, lifecycle, health, and canonical-root checks.
- **Project path privacy:** absolute paths are accepted only by explicit register/relink operations and must be scrubbed
  from normal DTOs, notices, and errors. UI cards use display names and sanitized root labels.
- **Plan mutation sequencing:** owner Plan views remain read-only until Plan Workflow Lease enforcement can cover every
  consequential route. The compatibility launcher is not evidence that remote owner mutations are safe.
- **Shared Space isolation:** public ciphertext/capability storage and owner coordination remain separate databases,
  adapters, middleware, credentials, and exposure policies even if a future product shell links to both.
- **Database loss:** loss of owner coordination state does not delete Projects, Plans, or Session Transcripts, but
  paired devices and registration identity are lost and must be rebuilt/re-paired conservatively.
- **Temporary home:** Project/setup navigation is only the bootstrap landing surface. Slice 10 remains responsible for
  making the Attention Dashboard the default Workspace home without replacing Project-scoped Plan Boards.
