---
planId: "03373eb8-8a1f-47a6-b944-d93a917ed942"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Package remote Workspace mode for self-hosted SQLite deployment and document setup, CLI collaboration workflows, privacy guarantees, secret handling, deleted-remote recovery, and the deferred Cloudflare/D1 follow-up."
affectedPaths:
    - "Dockerfile"
    - ".dockerignore"
    - "docker-compose.yml"
    - "deno.json"
    - "src/ui/workspace/remote-server.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/workspace.test.js"
    - "docs/collaboration.md"
    - "docs/index.md"
    - "docs/usage.md"
    - "docs/workflows.md"
    - "docs/settings.md"
    - "docs/prd/collaborative-planning-PRD.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-workspace-PRD.md"
    - "docs/adr/008-remote-canonical-collaborative-shared-spaces.md"
    - "README.md"
frontend: false
createdAt: "2026-07-16T16:40:36-04:00"
updatedAt: "2026-07-16T21:45:43.154Z"
status: "in_progress"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 9
dependencies:
    - "05-remote-browser-review-mvp"
    - "06-wld-plans-pull-maintainer-revision-flow"
    - "07-wld-plans-push-remote-revision-publish-flow"
    - "08-wld-plans-unshare-cli-delete-and-recovery"
    - "10-remote-review-plannotator-markdown-annotations"
humanReviewMode: null
humanReviewDecision: null
executionBaselineTree: "032d4eacc5ec587d4ff615042da1ddd3e0e5bac6"
worktreeId: "8ffc919c"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-collaborative-planning-remote-shared-spaces-09-s-8ffc919c"
worktreeBranch: "runwield/worktree/collaborative-planning-remote-shared-spaces-09-s-8ffc919c"
worktreeBaseBranch: "main"
worktreeStatus: "active"
---

# Self-Hosted Packaging and Collaboration Docs

## Context

The Collaborative Planning Epic is now implemented far enough to package the self-hosted path: the remote Workspace API,
remote review page, `wld plans share`, `wld plans pull`, `wld plans push`, `wld plans unshare`, and Plannotator-backed
remote annotations are verified sibling slices. The remaining work is to make the remote Workspace mode repeatable for a
team running its own Plan Server and to document the collaboration model in the public docs.

The current codebase uses the Astro/React Workspace under `src/ui/workspace/`, not the older Fresh/Preact wording still
present in some older planning material. This slice should update docs to match the implemented architecture and keep
Cloudflare/D1 or hosted RunWield Workspace deployment explicitly deferred.

## Objective

Add self-hosted packaging for remote Workspace mode with persistent SQLite storage, a documented startup path, and clear
collaboration docs for setup, CLI workflows, privacy guarantees, secret handling, recovery, and deferred hosted scope.
After this slice, a user should be able to run a self-hosted Plan Server, point `wld plans share|pull|push|unshare` at
it, complete an end-to-end Shared Space review loop, and understand the security/operational limits.

## Approach

Create a Deno-native container path around the existing `createWorkspaceApp({ mode: "remote", dbPath })` /
`startWorkspaceServer({ mode: "remote", ... })` seam instead of inventing a separate server stack. Add a small runtime
entry point that reads environment variables, starts only remote Workspace mode, uses a SQLite database path under a
mounted volume, and does not grant local Plan Board authority. Add a root `Dockerfile`, `.dockerignore`, and
`docker-compose.yml` that build the Astro Workspace runtime, run the remote server on port `8080`, and persist SQLite
under `/data`.

Documentation should consolidate the user-facing story around canonical RunWield terms: Plan Server, Shared Space,
Revision, Shared Plan Lock, reviewer/maintainer bearer capabilities, `planServerUrl`, and the plural `wld plans` command
family. Update stale PRD/ADR language only where it conflicts with verified implementation or current scope: v1 is
self-hosted SQLite first; hosted Cloudflare/D1 remains a follow-up; the browser does not expose push/close/delete; and
secrets stay out of Plan Front Matter and normal settings.

## Files to Modify

- `Dockerfile` — build and run the self-hosted remote Workspace Plan Server image; avoid baking in local Plans, `.wld/`
  runtime state, secret stores, or developer-specific paths.
- `.dockerignore` — exclude `.git/`, `plans/`, `.wld/`, local secret files, local databases, `node_modules/`, and other
  build/runtime artifacts not needed in the image.
- `docker-compose.yml` — provide a local self-host deployment with port mapping, a persistent SQLite volume, environment
  variables, restart policy, and health/smoke guidance.
- `deno.json` — add dedicated tasks for remote Workspace server startup and any packaging smoke command that keeps
  contributor and Docker docs copy/pasteable.
- `src/ui/workspace/remote-server.js` — add a tiny runtime entry point that reads remote server env vars, starts
  `startWorkspaceServer({ mode: "remote" })`, logs non-secret startup information, and shuts down cleanly.
- `src/ui/workspace/server.js` — add a minimal remote-mode health endpoint if needed for Docker health checks, without
  registering local Plan Board routes in remote mode.
- `src/ui/workspace/workspace.test.js` — cover remote server/health behavior and confirm local Workspace route isolation
  is preserved.
- `docs/collaboration.md` — create the main user guide for self-hosted collaboration setup, CLI workflow, privacy,
  secret storage, recovery, and operational caveats.
- `docs/index.md` — link the collaboration guide from the documentation table of contents.
- `docs/usage.md` — add daily-use CLI collaboration examples and point to the full collaboration guide.
- `docs/workflows.md` — describe how Shared Spaces fit the Plan workflow without replacing local Plan Lifecycle.
- `docs/settings.md` — document `planServerUrl` as a non-secret normalized Plan Server URL and explain when to use
  `--plan-server`.
- `docs/prd/collaborative-planning-PRD.md` — refresh stale assumptions and command names to match the verified
  self-hosted-first architecture.
- `docs/prd/runwield-core-prd.md` — update the current collaborative planning surface now that pull/push/unshare and the
  self-hosted packaging path are part of Core.
- `docs/prd/runwield-workspace-PRD.md` — correct stale Workspace technology/deployment wording where it still implies
  Fresh/Preact or a hosted-first v1.
- `docs/adr/008-remote-canonical-collaborative-shared-spaces.md` — add a concise status note reflecting the packaged
  self-hosted SQLite decision and deferred Cloudflare/D1 follow-up.
- `README.md` — add a short pointer to self-hosted collaborative planning and the new docs.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server.js` — existing `createRemoteWorkspaceApp`, `createWorkspaceApp({ mode: "remote" })`, and
  `startWorkspaceServer({ mode: "remote", dbPath })` support.
- `src/ui/workspace/server/remote-db.js` — SQLite open/migration behavior, including WAL for file-backed databases.
- `src/ui/workspace/server/remote-adapter.js` and `src/ui/workspace/routes/remote-api.js` — remote Shared Space API
  surface used by the packaged server.
- `src/ui/workspace/server/remote-dev-api.js` — existing environment variable names `RUNWIELD_REMOTE_DB_PATH` /
  `RUNWIELD_WORKSPACE_REMOTE_DB_PATH` for dev remote database selection.
- `deno task workspace:build` and `scripts/build-workspace-runtime.js` — existing Astro Workspace production build and
  runtime bundling flow used by release builds.
- `src/shared/settings.js` — `planServerUrl` normalization and validation for CLI share/pull/push/unshare.
- `src/shared/collaboration/secrets.js` — documented global and project-local secret store paths and ignore behavior.
- `src/cmd/registry.js` — current command descriptions for `wld plans share|pull|push|unshare`.
- `docs/prd/runwield-workspace-PRD.md` and `docs/adr/008-remote-canonical-collaborative-shared-spaces.md` — canonical
  product vocabulary for Shared Spaces, Shared Plan Lock, and ciphertext-only remote storage.

## Implementation Steps

- [ ] Step 1: Add `src/ui/workspace/remote-server.js` as a pure JavaScript/JSDoc entry point. It should read
      `RUNWIELD_REMOTE_HOST`/`HOST` with default `0.0.0.0`, `RUNWIELD_REMOTE_PORT`/`PORT` with default `8080`, and
      `RUNWIELD_REMOTE_DB_PATH`/`RUNWIELD_WORKSPACE_REMOTE_DB_PATH` with a container-friendly default such as
      `/data/runwield-shared-spaces.sqlite`.
- [ ] Step 2: Have the entry point call `startWorkspaceServer({ mode: "remote", host, port, dbPath, signal })`, install
      SIGINT/SIGTERM shutdown handling, and print only non-secret startup details: bind address, port, database path,
      and a reminder to configure the CLI `planServerUrl` or pass `--plan-server`.
- [ ] Step 3: Add a remote-mode `GET /healthz` endpoint if the packaged server needs an HTTP health check. It should
      return `200` with non-secret JSON such as `{ ok: true, mode: "remote" }`, and it must not expose local Plan data,
      database contents, capabilities, or content keys.
- [ ] Step 4: Add tests proving remote health/startup routing works and local mode remains isolated: local Plan Board
      routes are not registered in remote mode, `/p/:spaceId` remains remote-only in dev gating, and `/healthz` behavior
      is exactly as documented.
- [ ] Step 5: Add `deno.json` tasks such as `workspace:remote` for source-run remote server startup and, if useful,
      `workspace:remote:build` for `deno task workspace:build && deno run -A scripts/build-workspace-runtime.js`. Keep
      existing `workspace:dev` behavior unchanged.
- [ ] Step 6: Create `.dockerignore` so the image build context cannot include local Plan markdown, `.wld/` state,
      collaboration secret stores, local SQLite databases, sessions, `node_modules/`, or git metadata.
- [ ] Step 7: Create a root `Dockerfile` using the Deno runtime. Build the Workspace runtime with
      `deno task workspace:build` and `deno run -A scripts/build-workspace-runtime.js`, copy only the files needed to
      run `remote-server.js`, create `/data`, expose `8080`, run as a non-root user where practical, and scope Deno
      permissions as tightly as the Astro runtime and `node:sqlite` allow.
- [ ] Step 8: Create `docker-compose.yml` with a `runwield-plan-server` service, `8080:8080` mapping, persistent SQLite
      volume mounted at `/data`, `RUNWIELD_REMOTE_DB_PATH=/data/runwield-shared-spaces.sqlite`, and a health check
      against `/healthz` if Step 3 adds one.
- [ ] Step 9: Add `docs/collaboration.md` covering self-host startup with Docker Compose, reverse proxy/TLS guidance,
      how to set `planServerUrl` in global/project settings or pass `--plan-server`, and how to use placeholder domains
      such as `https://plans.example.com` without committing a production domain.
- [ ] Step 10: In the same guide, document the CLI workflow: `wld plans share <plan>`, send reviewer URLs, reviewers add
      browser comments, maintainers run `wld plans pull <maintainer-url-or-plan>`, Planner/Architect incorporate
      decrypted review context, maintainers run `wld plans push <plan>`, and maintainers use `wld plans unshare <plan>`
      for destructive deletion.
- [ ] Step 11: Document the privacy model precisely: Plan bodies, comment bodies, display names, original/selected text,
      and anchor/context metadata are encrypted as semantic payloads; allowed plaintext server metadata includes ids,
      `planId`, timestamps, status, Revision numbers, resolved flags, and capability hashes; content keys remain in URL
      fragments/local secret stores; bearer capabilities authorize requests and are stored server-side only as hashes.
- [ ] Step 12: Document secret handling: global default store `~/.wld/collaboration-secrets.json`, optional ignored
      project-local `.wld/collaboration-secrets.json` via `--project-secrets`, powerful maintainer URLs, reviewer URLs,
      `planServerUrl` as non-secret settings, and the rule that content keys/capabilities never belong in Plan Front
      Matter, normal settings, docs, logs, commits, or issue trackers.
- [ ] Step 13: Document recovery and failure cases: lost local secrets can be re-imported from a maintainer URL;
      reviewer-only URLs cannot pull/push/unshare; unavailable or 5xx Plan Servers leave local Shared Plan Lock metadata
      intact; already-deleted remotes require explicit `wld plans unshare` cleanup; wrong Plan Server overrides are
      refused; out-of-band local edits while locked require pull/recovery instead of silent overwrite.
- [ ] Step 14: Refresh stale PRD/ADR docs to match verified scope: plural `wld plans` commands, remote-canonical Shared
      Spaces, self-hosted SQLite first, Astro/React Workspace where technology is mentioned, CLI-only unshare in v1, no
      browser push/close/delete controls, and Cloudflare/D1 as a deferred follow-up rather than this Epic's done
      criteria.
- [ ] Step 15: Update README, docs index, usage, workflows, and settings docs with concise links and examples without
      duplicating the full collaboration guide.
- [ ] Step 16: Run formatting, focused tests, Workspace build/runtime checks, Docker build/compose smoke verification,
      and full CI. Fix all failures before marking implementation complete.

## Verification Plan

- Automated:
  `deno fmt --check README.md docs deno.json src/ui/workspace/remote-server.js src/ui/workspace/server.js src/ui/workspace/workspace.test.js`
- Automated:
  `deno test -A src/ui/workspace/workspace.test.js src/shared/settings.test.js src/shared/collaboration/secrets.test.js`
- Automated: `deno task workspace:build && deno run -A scripts/build-workspace-runtime.js`
- Automated: `docker compose config`
- Automated: `docker build -t runwield-plan-server:local .`
- Automated: `deno task ci`
- Manual: Run `docker compose up -d`, verify `/healthz` responds if implemented, verify the service writes SQLite data
  under the configured volume, then restart the container and confirm data persists.
- Manual: Configure the CLI with the compose URL via project/global `planServerUrl` or use
  `--plan-server
  http://127.0.0.1:8080`; run `wld plans share <plan>`, open the reviewer URL, add comments from two
  display names, resolve/reopen at least one comment, run `wld plans pull`, revise through Planner/Architect, run
  `wld plans push`, verify the same reviewer URL can switch/read the new Revision, then run `wld plans unshare`.
- Manual: Inspect the SQLite database and representative network payloads to verify semantic content remains ciphertext
  while only documented plaintext metadata is present.
- Expected results: a self-hosted Plan Server can complete the share → browser review → pull → revise → push → unshare
  loop without Cloudflare/D1, without local Plan Board authority, and without storing content keys or plaintext Plan
  semantic content on the server.

## Edge Cases & Considerations

- The Docker image must not bake in `plans/`, `.wld/`, collaboration secret stores, local SQLite files, sessions,
  developer home paths, or generated reviewer/maintainer URLs.
- Reverse proxies must preserve URL fragments client-side by normal browser behavior; fragments are never sent to the
  server, but bearer capabilities from the fragment are sent as `Authorization` headers by the browser client. Docs
  should warn operators not to log authorization headers.
- The public Plan Server base URL used by CLI share links must match the externally reachable reverse-proxy URL, not an
  internal Docker hostname, unless the user is only testing locally.
- Maintainer URLs are powerful bearer credentials. Anyone with a maintainer URL can pull, push, and unshare where the
  local command has corresponding secrets/capability material.
- Deleted or unavailable remotes must not silently unlock local Plans. Recovery should remain explicit and should
  preserve the Shared Plan Lock after ambiguous network/server failures.
- Browser-side unshare/delete, browser push, browser Plan body editing, hosted RunWield Workspace, and Cloudflare/D1
  deployment remain deferred unless a later Plan explicitly adds them.
- Use pure JavaScript with JSDoc for executable code outside the existing `src/ui/workspace/` TypeScript exception zone.
