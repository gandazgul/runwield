---
planId: "ee7d93bf-4e9f-40dd-8db5-ca33bb6c696b"
classification: "FEATURE"
complexity: "HIGH"
summary: "Close the remaining self-hosted Plan Server review gaps by repairing Plan 09 lifecycle metadata, adopting Podman/OCI-first packaging, minimizing the runtime image, aligning current product docs with Astro/React, and completing remote-mode and collaboration verification."
affectedPaths:
    - "Containerfile"
    - ".containerignore"
    - "compose.yml"
    - "Dockerfile"
    - ".dockerignore"
    - "docker-compose.yml"
    - "deno.json"
    - "scripts/build-plan-server-runtime.js"
    - "scripts/build-plan-server-runtime.test.js"
    - "src/ui/workspace/remote-server.js"
    - "src/ui/workspace/server/remote-mode.js"
    - "src/ui/workspace/server/remote-dev-api.js"
    - "src/ui/workspace/pages/p/[spaceId].astro"
    - "src/ui/workspace/workspace.test.js"
    - "README.md"
    - "docs/collaboration.md"
    - "docs/usage.md"
    - "docs/settings.md"
    - "docs/prd/collaborative-planning-PRD.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-workspace-PRD.md"
    - "docs/adr/008-remote-canonical-collaborative-shared-spaces.md"
    - "plans/collaborative-planning-remote-shared-spaces.md"
    - "plans/collaborative-planning-remote-shared-spaces/09-self-hosted-packaging-and-collaboration-docs.md"
frontend: true
devServerCommand: "RUNWIELD_WORKSPACE_MODE=remote RUNWIELD_REMOTE_DB_PATH=.wld/remote-gap-close.sqlite deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-20T22:54:41-04:00"
updatedAt: "2026-07-21T04:13:07.050Z"
status: "implemented"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 12
dependencies:
    - "11-self-hosted-hardening-retention-and-operations"
implementedAt: "2026-07-21T04:13:07.050Z"
executionReport: "- Implemented Plan 12: restored Plan 09 verified lifecycle metadata, centralized/tested remote dev gating, added minimal generated Plan Server runtime builder, and replaced Docker-first packaging with `Containerfile`, `.containerignore`, and `compose.yml`.\n- Updated living docs/PRDs/ADR/Epic wording to Astro/React and Podman/OCI-first self-hosting; preserved historical Plan 09 body.\n- Verification passed: `deno task ci`; focused runtime/Workspace/collaboration tests; `deno task workspace:remote:build`; `podman build -f Containerfile -t runwield-plan-server:gap-close .`; `podman compose -f compose.yml config`; `podman compose -f compose.yml up --build -d` with healthy `/healthz` and `/readyz`, loopback port, API create smoke, restart health, and SQLite persistence.\n- Image-content check passed: final image contains generated runtime, CSS/logo/agent definition assets, and no broad executable source/test/state files.\n- Frontend/browser: pre-implementation headed browser preflight loaded remote dev UI at `http://127.0.0.1:5174/p/preflight-space` with HMR expected; after compaction no `agent-browser` tool was available here, so the full share/review/pull/push/unshare browser flow remains unverified in headed browser, but corresponding CLI/protocol and Workspace automated coverage passed."
worktreeStatus: "completed"
---

# Close Self-Hosted Plan Server Packaging and Verification Gaps

## Context

The self-hosted Plan Server implementation from child Plan 09 is merged into `main` and `origin/main`, and the later
verified Plan 11 hardened its request limits, inactivity retention, readiness, shutdown, migration, backup, and proxy
behavior. The original worktree and branch are gone, but Plan 09's merge conflict preserved stale `in_progress` and
active-worktree Front Matter instead of the verified metadata committed on the execution branch.

A review of the merged result found three remaining implementation/specification gaps: the living Core PRD still names
the retired Fresh/Preact Workspace stack, the Astro development gate for remote Shared Space routes is not directly
covered by a shared tested policy, and the final Plan Server image copies the repository's entire `src/` tree. Test code
around the remote server also retains inline JSDoc casts that drift from the repository's named-typedef and function
parameter conventions.

The previous packaging and documentation are Docker-first. The user has selected Podman/OCI-first packaging and does not
require Docker compatibility or Docker-based verification. Conventional Docker-named files should therefore be replaced
with `Containerfile`, `.containerignore`, and `compose.yml`, and current user-facing/product documentation should use
Podman and OCI terminology. Plans 09 and 11 remain historical specifications; only Plan 09's incorrect lifecycle Front
Matter should be repaired.

## Objective

Produce a review-complete, Podman/OCI-first self-hosted Plan Server path that:

- packages only a generated remote server runtime, the built Workspace runtime, and explicitly allowlisted passive
  assets instead of the full source tree;
- uses `podman` and `podman compose` as the documented and verified container workflow;
- applies one tested remote-development gate to both the Astro review page and remote API routes;
- describes the current Astro/React Workspace accurately across living docs, PRDs, ADR-008, and the active Epic;
- restores Plan 09's verified historical lifecycle metadata without inventing new timestamps or a child Work Record; and
- passes full CI plus a headed share → review → pull in another checkout → push → unshare verification against the
  composed Plan Server.

## Approach

Add a dedicated Plan Server runtime builder alongside the existing Workspace runtime builder. It should bundle
`src/ui/workspace/remote-server.js` into one Deno module and materialize a self-contained `dist/plan-server/` filesystem
root containing that bundle, `dist/workspace-runtime/`, `logo.svg`, and only the passive CSS files that `server.js`
serves by path. The `Containerfile` builder stage may use the repository source to create this artifact; the final stage
must copy only the generated Plan Server root (and a Deno cache if the bundle still needs one), create `/data`, retain
non-root execution, and preserve the existing scoped permissions.

Centralize the Astro development-mode decision in a small pure JavaScript module under
`src/ui/workspace/server/remote-mode.js`. Both `[spaceId].astro` and `remote-dev-api.js` should call the same helper so
a focused unit test covers the policy and route-specific tests verify local/remote isolation. Keep production composed
remote mode unchanged.

Restore Plan 09 Front Matter from the verified execution-branch state at `424b249a`: `status: verified`, the historical
`implementedAt`/`verifiedAt`/`updatedAt` values, and the recorded skipped human-review decision. Remove the stale
execution baseline and worktree fields. Do not rewrite its historical Docker-era body or manually force the parent Epic
status; normal Plan Lifecycle handling should verify the Epic after this final child and all siblings are verified.

## Files to Modify

- `Containerfile` — replace the root `Dockerfile`; build the generated Plan Server runtime and copy only that artifact
  into the final non-root Deno image.
- `.containerignore` — replace `.dockerignore` with Podman/Buildah-oriented build-context exclusions for Plans, `.wld/`
  state, secrets, SQLite files, sessions, VCS data, dependencies, and generated artifacts.
- `compose.yml` — replace `docker-compose.yml`; reference `Containerfile`, preserve loopback publication, `/data`
  persistence, remote configuration, `/readyz` health checks, and retention defaults for `podman compose`.
- `Dockerfile`, `.dockerignore`, `docker-compose.yml` — remove the superseded Docker-first files rather than maintaining
  duplicate packaging paths.
- `scripts/build-plan-server-runtime.js` — create a deterministic `dist/plan-server/` root by bundling the remote entry,
  copying the built Workspace runtime, and copying an explicit passive-asset allowlist into the paths expected by
  `runtime-root.js` and `server.js`.
- `scripts/build-plan-server-runtime.test.js` — cover runtime layout, asset allowlisting, missing-input failures, bundle
  command construction, stale-output cleanup, and exclusion of repository source/Plan/runtime-state files.
- `deno.json` — make `workspace:remote:build` produce the complete Plan Server runtime and add a concise Podman/OCI
  packaging task only if it improves copy/pasteable verification.
- `src/ui/workspace/server/remote-mode.js` — add the pure, testable remote-development gate shared by Astro page and API
  entry points.
- `src/ui/workspace/pages/p/[spaceId].astro` — replace its inline environment gate with the shared policy while keeping
  non-remote development requests at `404`.
- `src/ui/workspace/server/remote-dev-api.js` — use the same remote-development gate for API requests and retain cached
  adapter configuration/cleanup behavior.
- `src/ui/workspace/remote-server.js` — introduce named typedefs for main-option/dependency shapes and remove inline
  object-shape or body-cast drift without changing server ownership or shutdown behavior.
- `src/ui/workspace/workspace.test.js` — add shared gate and route-isolation coverage and replace inline `Deno.Env` test
  casts with reusable typed test helpers.
- `README.md`, `docs/collaboration.md`, `docs/usage.md`, `docs/settings.md` — make Podman/OCI the supported self-host
  path, update commands and filenames, and retain the established security, recovery, backup, and operational guidance.
- `docs/prd/collaborative-planning-PRD.md`, `docs/prd/runwield-core-prd.md`, `docs/prd/runwield-workspace-PRD.md` —
  describe source-built Podman/OCI packaging and the actual Astro/React Workspace; remove current Docker-first and
  Fresh/Preact claims without rewriting unrelated future scope.
- `docs/adr/008-remote-canonical-collaborative-shared-spaces.md` — update the packaged deployment status note to the
  selected Podman/OCI + SQLite decision while preserving remote-canonical and deferred hosted/D1 decisions.
- `plans/collaborative-planning-remote-shared-spaces.md` — update the active Epic's current packaging terminology and
  verification path; let lifecycle automation own its final status.
- `plans/collaborative-planning-remote-shared-spaces/09-self-hosted-packaging-and-collaboration-docs.md` — restore only
  the verified historical lifecycle Front Matter and remove stale worktree metadata.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `scripts/build-workspace-runtime.js` — reuse its Deno bundle command style, stale-output cleanup, explicit runtime
  directory construction, opaque client assets, and injectable command runner pattern.
- `scripts/build-workspace-runtime.test.js` — reuse its small pure-helper tests and command/output assertions.
- `runtime-root.js` and `src/ui/workspace/server.js` — preserve their root-relative runtime and passive-asset paths when
  laying out `dist/plan-server/`; do not add container-only path branches.
- `src/ui/workspace/remote-server.js` — retain existing environment parsing, adapter ownership, cleanup timer,
  readiness, and graceful shutdown behavior.
- `src/ui/workspace/server/remote-dev-api.js` and `src/ui/workspace/pages/p/[spaceId].astro` — replace duplicated gate
  expressions with one shared policy rather than introducing another mode flag.
- `compose.yml` health/readiness configuration — preserve the verified loopback, SQLite volume, request-limit, and
  `/readyz` behavior from Plan 11 while changing the packaging toolchain and filenames.
- Commit `424b249a` — authoritative source for Plan 09's historical verified Front Matter values.

## Implementation Steps

- [ ] Step 1: Restore Plan 09's exact verified lifecycle metadata from `424b249a`: set the historical `updatedAt`,
      `status`, `implementedAt`, `verifiedAt`, `humanReviewMode`, and `humanReviewDecision`; remove
      `executionBaselineTree`, `worktreeId`, `worktreePath`, `worktreeBranch`, `worktreeBaseBranch`, and
      `worktreeStatus`; leave its body and historical affected paths unchanged.
- [ ] Step 2: Add `remote-mode.js` with a named option typedef and a pure predicate for whether remote Shared Space
      development routes are enabled. Wire both `[spaceId].astro` and `handleRemoteSpaceApi` through it so
      non-development or non-remote requests preserve the intended `404` behavior and remote development remains
      enabled.
- [ ] Step 3: Add focused tests for the shared gate's development/mode matrix, the remote API entry's rejection path,
      and existing composed local/remote route isolation. Include a source/wiring assertion only if the Astro page
      cannot be invoked directly in the test harness; the Verification Plan must still exercise the real dev server in
      both modes.
- [ ] Step 4: Define reusable JSDoc typedefs for `remote-server.js` main dependencies/options and typed test environment
      helpers. Replace the reviewed inline object-shape declaration and `Deno.Env` parameter casts without changing
      runtime behavior.
- [ ] Step 5: Implement `build-plan-server-runtime.js`. Clean its destination, invoke Deno bundling with bundled package
      dependencies, copy `dist/workspace-runtime`, `logo.svg`, and an explicit passive CSS allowlist into a filesystem
      tree whose root-relative paths match `runtime-root.js`, and fail clearly when a required input or generated output
      is missing.
- [ ] Step 6: Add builder tests proving deterministic output layout, old output removal, exact passive-asset inclusion,
      bundle command arguments, and absence of executable repository source outside the one generated remote entry.
      Ensure Plans, `.wld/`, secrets, SQLite files, sessions, test files, and unrelated CLI/local Plan Board modules
      cannot enter the generated runtime through broad directory copies.
- [ ] Step 7: Update `workspace:remote:build` to run the Astro Workspace build, existing Workspace runtime preparation,
      and new Plan Server runtime builder in order. Keep `workspace:remote` available for source development.
- [ ] Step 8: Replace `Dockerfile`, `.dockerignore`, and `docker-compose.yml` with `Containerfile`, `.containerignore`,
      and `compose.yml`. The final image must copy only the generated Plan Server root, run as the Deno user, persist
      `/data`, retain current environment defaults and scoped permissions, and use `/readyz` through `podman compose`.
- [ ] Step 9: Add automated/container assertions that inspect the built image filesystem: expected bundle, Workspace
      runtime, logo, passive CSS, and `/data` exist; full `/app/src` JavaScript, Plans, `.wld/`, secret stores, SQLite
      build artifacts, sessions, tests, and VCS metadata do not.
- [ ] Step 10: Update current user documentation to use `podman build`, `podman compose`, `Containerfile`,
      `.containerignore`, `compose.yml`, and OCI image/container terminology. Preserve loopback-by-default exposure,
      reverse-proxy bearer-header guidance, cold SQLite backup/restore, upgrade/rollback, retention, and
      ciphertext/privacy requirements.
- [ ] Step 11: Update the three living PRDs, ADR-008 status note, README/usage/settings pointers, and active Epic so the
      current architecture is Astro/React with source-built Podman/OCI + SQLite packaging. Remove the stale Core PRD
      Fresh/Preact claims and Docker-first success criteria; keep hosted Workspace and Cloudflare/D1 deferred.
- [ ] Step 12: Run the focused build-script, Workspace, route-gate, remote server, collaboration protocol, CLI
      share/pull/push/unshare, and Plan-store tests. Build the Workspace and generated Plan Server runtime, inspect its
      manifest/tree, then run full `deno task ci` and fix every failure.
- [ ] Step 13: Build and launch the image with `podman build -f Containerfile` and `podman compose -f compose.yml`;
      verify `/healthz` and `/readyz`, loopback-only publication, SQLite creation, clean restart, data persistence,
      graceful shutdown, and image-content exclusions. Docker commands are neither required nor accepted as the sole
      verification path for this Plan.
- [ ] Step 14: In disposable checkouts, complete share → headed browser review by two display names → resolve/reopen →
      maintainer pull into a second checkout → Planner incorporation context capture → push Revision 2 → old/new
      Revision inspection → unshare. Inspect representative network/SQLite data for the documented ciphertext/plaintext
      boundary, then remove temporary Plans, secrets, databases, containers, volumes, and browser sessions.
- [ ] Step 15: Start the real Astro dev server without `RUNWIELD_WORKSPACE_MODE=remote` and confirm `/p/<spaceId>` and
      remote API routes return `404`; restart with remote mode and a disposable database and confirm the review page/API
      are available. Exercise the remote page in a headed browser to ensure the shared gate did not regress rendering.

## Verification Plan

- Automated: `deno test -A scripts/build-plan-server-runtime.test.js scripts/build-workspace-runtime.test.js`
- Automated: `deno test -A src/ui/workspace/workspace.test.js`
- Automated:
  `deno test -A src/shared/collaboration/*.test.js src/cmd/plans/share.test.js src/cmd/plans/pull.test.js src/cmd/plans/push.test.js src/cmd/plans/unshare.test.js`
- Automated: `deno task workspace:remote:build`
- Automated: inspect `dist/plan-server/` against the explicit runtime manifest and assert prohibited source/state paths
  are absent.
- Automated: `podman compose -f compose.yml config`
- Automated: `podman build -f Containerfile -t runwield-plan-server:gap-close .`
- Automated: inspect the built image filesystem and run the generated remote entry with Deno's cached/offline mode where
  practical to prove the final stage has no undeclared source dependency.
- Automated: `deno task ci`
- Manual: Run `podman compose -f compose.yml up -d`, verify `/healthz` and `/readyz`, stop/start the service, and
  confirm SQLite data survives through the named volume while the published port remains loopback-only.
- Manual: Run the full disposable share → browser review → second-checkout pull → incorporate → push → Revision switch →
  unshare flow, including two reviewer names and one resolve/reopen cycle; confirm old links fail after unshare.
- Manual: Inspect SQLite rows and representative API payloads to confirm semantic content remains ciphertext and only
  the documented lifecycle/routing metadata is plaintext.
- Manual: Run Astro development once without remote mode and once with remote mode; verify the real review page and API
  route gate, then use a headed browser against the enabled remote page.
- Expected result: the self-hosted Plan Server is documented and verified as Podman/OCI-first, its final image contains
  only the declared runtime, remote-development routes are consistently gated, current product docs name Astro/React,
  Plan 09 is historically `verified` without stale worktree metadata, this child Plan verifies normally, and the parent
  Epic becomes eligible for automatic verification.

## Edge Cases & Considerations

- `runtime-root.js` derives paths from `import.meta.url`; the generated bundle must be copied to the final image
  location that makes `/app` the runtime root, or static/Workspace runtime paths will silently break.
- The passive-asset allowlist must include every file served by remote mode while excluding JavaScript source used only
  by local Plan Board or review-authoring routes. Add an explicit test when the allowlist changes.
- Deno bundling may retain built-in `node:` imports such as `node:sqlite`; validate these against the final Deno base
  image and do not treat built-ins as missing vendored dependencies.
- Podman may delegate Compose parsing to the installed `docker-compose` provider. The supported invocation remains
  `podman compose`; document the provider behavior only where operators need it, without restoring Docker as a required
  runtime.
- `compose.yml` and `Containerfile` are standard OCI ecosystem conventions, but this Plan intentionally does not
  preserve duplicate Docker-named aliases.
- Plan 09's body remains an immutable historical implementation specification even though its packaging filenames are
  superseded. Only its lifecycle Front Matter is corrected. It is intentionally not a formal dependency of this Plan:
  its stale `in_progress` status is work this Plan must repair, so declaring it as a dependency would block readiness.
- Current Work Record policy excludes child FEATURE Plans in favor of the parent Epic record. Do not manufacture a Plan
  09 Work Record; allow normal parent-Epic Work Record generation after lifecycle completion.
- The primary checkout currently has unrelated local modifications. Execution must use its isolated worktree and must
  not absorb or overwrite those changes.
