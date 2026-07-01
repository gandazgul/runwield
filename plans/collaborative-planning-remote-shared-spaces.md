---
planId: "3a41af0c-710c-4ec1-b980-8b48649c5004"
classification: "PROJECT"
complexity: "HIGH"
summary: "The user wants to rehash and plan the implementation of the Collaborative Planning PRD. This is a large-scale architectural shift involving a new backend (D1/SQLite), a new Web Viewer (SPA), and new CLI commands for sharing, syncing, and pushing plans with end-to-end encryption. This requires a PROJECT/Epic plan."
affectedPaths:
    []
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173"
devServerHmr: true
createdAt: "2026-07-01T00:10:56-04:00"
updatedAt: "2026-07-01T04:26:48.569Z"
status: "ready_for_decomposition"
origin: "internal"
type: "epic"
routingIntent: "PROJECT"
sessionName: "collaborative planning implementation"
---

# Collaborative Planning Remote Shared Spaces

## Context

RunWield already has local markdown Plans, durable `planId` front matter, Epic/Child FEATURE decomposition, a local
Fresh Workspace UI under `src/ui/workspace/`, and Plannotator-backed local Review Loops. The Collaborative Planning PRD
expands this into team review: shared remote Plans with revisions, encrypted comments, reviewer-friendly browser access,
CLI pull/push flows, and self-hosted deployment.

The rehashed architecture changes the original PRD in four important ways:

- V1 is **self-hosted first**: Docker + Fresh Workspace remote mode + SQLite. Cloudflare/D1 hosted deployment is
  deferred to a separate follow-up Plan using a placeholder host such as `plans.example.com`.
- A shared Plan is **remote-canonical while shared**. Local markdown is protected by a hard Shared Plan Lock and can
  only be modified through collaboration command flows.
- The command language is **`wld plans ...`**: `share`, `pull`, `push`, and `unshare`, consistent with existing
  `wld plans ui`.
- Access is accountless but capability-based: reviewer and maintainer bearer capabilities support team handoff without
  tying ownership to the original creator.

ADR-008 records the core decision: remote-canonical Shared Spaces, Fresh Workspace remote mode, SQLite self-hosting
first, and separate reviewer/maintainer bearer capabilities.

## Objective

Implement a self-hosted collaborative planning system that lets a RunWield user share a Plan, collect encrypted browser
comments, let another maintainer pull the Plan into their checkout, invoke Planner/Architect to incorporate feedback,
push a new remote revision, and destructively unshare the remote Shared Space when needed.

The system must preserve these invariants:

- Remote servers store ciphertext for Plan bodies and comment semantic content.
- Local Plan files are not silently mutated while a Shared Space is remote-canonical.
- Maintainer handoff works without accounts: a maintainer URL or imported capability can authorize pull/push/unshare.
- Reviewer links can view, comment, and resolve/reopen comments, but cannot push revisions or delete the Shared Space.
- The existing Workspace app is extended by mode/adapters rather than replaced by a separate web stack.

## Vertical Slice Findings

- `src/ui/workspace/server.js` currently composes one Fresh app around checkout-local Plan routes and a loopback token.
  This is the right seam for a `local` vs `remote` Workspace mode, but remote mode must not inherit local filesystem
  authority.
- `src/cmd/plans/index.js` already supports subcommands via `wld plans ui`, so collaboration commands should extend this
  namespace rather than creating a singular `wld plan` command.
- Most legitimate Plan writes flow through `src/plan-store.js`, `src/shared/workflow/plan-lifecycle.js`,
  `src/ui/workspace/server/plan-adapter.js`, or `src/shared/workflow/submit-plan.js`. A Shared Plan Lock can be enforced
  at these seams, with special collaboration bypasses for pull/push/unshare.
- Existing Plannotator crypto provides a useful AES-GCM/content-key pattern, with the key kept in the URL fragment. The
  new protocol should adapt the idea in pure JavaScript/JSDoc and separate encryption keys from bearer authorization
  capabilities.
- Cloudflare D1 supports prepared statements and transactional `batch()` operations, so a later D1 adapter is feasible,
  but it should not be in the self-hosted-first Epic execution path.
- `.wld/` is not globally ignored today. Collaboration secrets must not be placed in tracked Plan front matter or
  unignored settings files.

## Files to Modify

- `docs/prd/collaborative-planning-PRD.md` — update terminology and resolved decisions if documentation is refreshed:
  Shared Space, remote-canonical lock, `wld plans` command names, self-hosted-first scope, deferred Cloudflare/D1
  follow-up.
- `docs/adr/008-remote-canonical-collaborative-shared-spaces.md` — ADR created for the main architecture decision.
- `.gitignore` — ignore project-local collaboration secret storage such as `.wld/collaboration-secrets.json` while
  preserving non-secret settings behavior.
- `deno.json` — add any needed imports/tasks for Workspace remote mode, SQLite, Docker verification, and
  collaboration-specific tests while keeping the project pure JavaScript/JSDoc.
- `src/cmd/plans/index.js` and new files under `src/cmd/plans/` — add `share`, `pull`, `push`, `unshare`, and argument
  parsing/help. `pull` must accept a maintainer URL for bootstrap and a plan id for already-imported local secrets;
  `--plan-server=url` overrides settings.
- `src/shared/settings.js` — add non-secret default Plan Server URL setting support. Do not store content keys or bearer
  capabilities here.
- New collaboration shared modules, likely under `src/shared/collaboration/` — define protocol payload shapes, URL
  fragment parsing/building, AES-GCM encryption/decryption, base64url helpers, capability hashing, API client, and
  secret store adapters using JSDoc typedefs.
- `src/plan-store.js` — add collaboration front matter fields for non-secret remote state and enforce Shared Plan Lock
  checks around body/status/front matter writes. Provide an explicit collaboration bypass only for trusted collaboration
  command paths.
- `src/shared/workflow/plan-lifecycle.js` and workflow callers — ensure lifecycle/status mutations respect the Shared
  Plan Lock and surface actionable messages when a shared Plan must be pulled or unshared first.
- `src/shared/workflow/submit-plan.js` — prevent local Plannotator Review Loop rewrites for shared remote-canonical
  Plans unless invoked as part of an approved collaboration flow.
- `src/shared/session/agent-handler.js` and related session/workflow wiring — support `wld plans pull` launching Planner
  or Architect with decrypted revision/comment context and an explicit instruction to revise through the controlled
  collaboration path.
- `src/ui/workspace/server.js` — split Fresh app composition into local and remote modes. Local mode keeps current
  checkout-backed routes/token. Remote mode uses SQLite-backed collaboration adapters and must not set `ctx.state.cwd`
  as an authority boundary.
- `src/ui/workspace/routes/**` — add remote Shared Space routes such as `/p/:planId`, revision APIs, comments APIs,
  resolve APIs, and unshare/delete APIs. Keep local Plan Board routes local-mode only.
- `src/ui/workspace/server/**` — add SQLite schema/migration/bootstrap code and remote collaboration adapters for Shared
  Spaces, revisions, comments, capabilities, and deletion.
- `src/ui/workspace/components/PlanDetail.jsx` and related components — reuse existing Plan detail/markdown rendering
  for the basic remote browser review UI, then adapt or copy Plannotator-style comment UX where practical.
- `src/ui/workspace/islands/**` — add client-side decryption, revision loading, comment creation, comment
  resolve/reopen, and basic reviewer name capture for remote mode.
- `src/ui/workspace/static/styles.css` — add basic styling for Shared Space revision selector, comment sidebar/list,
  locked/deleted states, and capability-specific controls.
- `Dockerfile` and `docker-compose.yml` — package the remote Workspace mode with SQLite volume, configuration
  environment variables, and documented startup path.
- `docs/**` — add self-hosted setup documentation, CLI collaboration command documentation, privacy model explanation,
  and recovery notes for deleted or unavailable Shared Spaces.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server.js` — Fresh app composition, static assets, theme CSS, and component shell. Extend with a
  mode seam rather than creating a separate server framework.
- `src/ui/workspace/components/PlanDetail.jsx` and `src/ui/workspace/components/MarkdownView.jsx` — basic Plan rendering
  for the remote review UI while comment UX matures.
- `src/cmd/plans/ui.js` — subcommand pattern, browser opening, and local URL construction conventions.
- `src/plan-store.js` — `planId`, front matter parsing/formatting, body hash, and existing Plan write seams for Shared
  Plan Lock enforcement.
- `src/shared/workflow/plan-lifecycle.js` — centralized status/event semantics; do not bypass it for local lifecycle
  changes.
- `src/shared/settings.js` — global/project setting read/write helpers for non-secret Plan Server URL configuration.
- `../plannotator/packages/shared/crypto.ts` and `../plannotator/packages/ui/utils/sharing.ts` — design reference for
  AES-GCM, URL-fragment keys, compressed payloads, and Plannotator comment payload shape. Port/adapt in pure
  JavaScript/JSDoc; do not introduce TypeScript files.
- `@gandazgul/plannotator-pi-extension-compiled` / Plannotator UI concepts — source of review/comment UX patterns. Reuse
  or copy UI ideas where compatible with the Workspace mode boundary.
- `../chores-app/src/utils/db.js` — simple Deno/SQLite precedent, but prefer a Workspace-owned database adapter with
  explicit migrations rather than ad hoc table creation scattered through route handlers.

## Verification Plan

- Automated: run `deno task ci` for full project checks after implementation slices.
- Automated: add unit tests for collaboration crypto round trips, wrong-key/tampered-ciphertext failures, capability
  hashing, URL parsing, and secret-store behavior.
- Automated: add Plan store tests proving Shared Plan Lock blocks normal local body/status/front matter writes, local
  Workspace edits, local review rewrites, and lifecycle actions, while collaboration pull/push/unshare paths can perform
  controlled writes.
- Automated: add API/adapter tests for SQLite schema migrations, revision creation, metadata reads, encrypted comment
  append/list, resolve/reopen, close, and destructive unshare/delete.
- Automated: add CLI tests for `wld plans share`, `pull`, `push`, `unshare`, `--plan-server=url`, maintainer URL
  bootstrap, missing secrets, wrong capability, deleted remote, and locked local Plan recovery messaging.
- Manual: start the Dockerized remote Workspace mode with a SQLite volume, share a local Plan, open the reviewer URL in
  a browser, add comments from two display names, resolve/reopen a comment, pull as a maintainer into another checkout,
  let Planner/Architect revise, push a new revision, and verify the revision switcher shows old comments only on their
  original revision.
- Manual: verify a network capture and SQLite inspection show encrypted Plan/comment content only; plaintext allowed
  metadata is limited to ids, timestamps, status, revision numbers, resolved flags, opaque anchors, and capability
  hashes.
- Manual: verify `wld plans unshare <plan-id>` warns before deletion, deletes the remote Shared Space, and causes other
  local checkouts/UI sessions to report a deleted/broken collaboration state without silently editing local Plans.
- Manual: verify default Plan Server URL can come from settings and can be overridden per command with
  `--plan-server=url`.
- Frontend: this Epic has UI/UX scope, so executable child FEATURE Plans that touch the remote browser review UI,
  comment interactions, revision switcher, local lock messaging in Workspace, or destructive unshare UI must set
  `frontend: true` and use headed browser verification.

## Edge Cases & Considerations

- **Remote-canonical lock safety:** local Plan files are still plain markdown and can be edited outside RunWield.
  RunWield can prevent its own writes and detect divergence via local body hash/revision metadata, but cannot stop a
  text editor. Pull/push must detect and report divergence instead of overwriting silently.
- **Secret leakage:** content keys and bearer capabilities must never be written to Plan front matter, normal settings,
  docs, logs, command output beyond initial explicit URLs, or agent prompts unless needed for the controlled pull
  context. Prefer redaction in logs and test fixtures.
- **Project-local secret store:** if enabled, it must be explicitly ignored. Global user secret storage should be the
  default safer path; project-local ignored storage supports CI/team workflows.
- **Capability handoff:** maintainer URLs are powerful bearer secrets. Documentation must explain that anyone with a
  maintainer URL can pull, push, close, or unshare.
- **Reviewer authority:** reviewers with reviewer capability can resolve/reopen comments by design. This may create
  social conflicts but matches the selected v1 trust model.
- **Metadata privacy:** author names, comment bodies, anchor/original text, and context are encrypted. Plaintext
  metadata is limited to routing/ordering fields and resolved state unless a later ADR changes the privacy model.
- **Unshare from UI:** UI destructive delete may strand local Plans that still think they are shared. Pull/push should
  detect 404/deleted remote and guide the user to clear local collaboration metadata intentionally.
- **Revision semantics:** comments do not carry over between revisions. The UI may show previous revisions and comments,
  but new revisions start with no inherited comments.
- **Agent pull flow:** `wld plans pull` should launch the correct planning Agent based on Plan classification and remote
  metadata. It should give decrypted comments/revision context, but should not expose bearer capabilities to the Agent
  unless strictly required by the collaboration command wrapper.
- **Cloudflare/D1:** hosted deployment is deferred. A separate draft Plan should later add a D1/Cloudflare
  adapter/deployment path after SQLite self-hosting proves the protocol. Use placeholder hostnames such as
  `plans.example.com`; do not bake a production domain into this Epic.
- **No TypeScript:** all new RunWield source files must be `.js`/`.jsx` with JSDoc typedefs, following the project
  language strictness policy.
- **Slicer guidance:** decompose around architectural seams: protocol/crypto/secret store, SQLite remote Workspace mode,
  CLI commands, Shared Plan Lock enforcement, pull-to-Agent flow, browser review UI, Docker/self-host docs, and deferred
  hosted deployment draft. Keep each child FEATURE independently verifiable.
