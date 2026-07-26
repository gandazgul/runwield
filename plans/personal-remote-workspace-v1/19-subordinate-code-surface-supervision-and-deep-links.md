---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add code-server supervision as a subordinate high-trust Code Surface for registered main checkouts only, plus safe deep links from eligible search results. It cannot claim Plan worktrees or RunWield workflow ownership."
affectedPaths:
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/cmd/"
    - "docs/usage.md"
    - "docs/prd/runwield-workspace-PRD.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-26T20:48:25.379Z"
updatedAt: "2026-07-26T20:48:25.379Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 19
dependencies:
    - "18-workspace-artifact-and-cymbal-search"
---

# Subordinate Code Surface Supervision and Deep Links

## Context

Personal Workspace should let the owner inspect or manually edit a registered Project's main checkout from the remote
browser. code-server is a subordinate process and separate trust seam, not the Workspace shell and not a RunWield
workflow owner. It must only open registered main checkouts, never Plan worktrees, and search deep links must target
Code Surface routes only when the result corresponds to eligible main-checkout content.

## Objective

Build Code Surface supervision so that:

- code-server can be started, stopped, monitored, and routed for registered Project main checkouts only;
- health, failed/stopped states, prerequisites, and logs/errors are visible to the owner;
- Workspace routes cannot resolve unregistered paths, removed/disabled Projects, or RunWield Plan worktrees as Code
  Surface roots;
- eligible search/code results deep-link to the correct Project main-checkout file and line where supported;
- manual edits are treated as local filesystem ownership and may later make Plans stale or create merge conflicts that
  normal checks surface;
- deployment docs cover code-server prerequisites, private-network/TLS expectations, and trust boundaries.

## Approach

Add a Workspace server service that supervises code-server as a child process with explicit Project-root authorization
and lifecycle state. Keep its authentication/proxying separate from RunWield Session/Plan workflow ownership. Add
browser UI for starting/stopping/opening Code Surface and connect search results from slice 18 only after verifying
registered main-checkout containment.

## Files to Modify

- `src/ui/workspace/server/` — add code-server process supervision, Project root authorization, route/proxy handling,
  health, and safe path resolution.
- `src/ui/workspace/pages/` — add Code Surface routes and Project-specific entry points.
- `src/ui/workspace/components/` and `src/ui/workspace/islands/` — add Code Surface status panels, start/stop controls,
  failed/prerequisite states, and deep-link affordances.
- `src/cmd/` — add code-server prerequisite checks or launch helpers if useful for Workspace startup diagnostics.
- `docs/usage.md` — document local code-server prerequisite, private network/TLS guidance, and operational trust
  boundary.
- `docs/prd/runwield-workspace-PRD.md` — align product wording with subordinate Code Surface constraints if needed.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- Owner Project registry and root evidence APIs — authorize registered main checkout roots.
- Search result metadata from slice 18 — build deep links only for eligible main-checkout files.
- Workspace server auth/device pairing middleware — protect owner-only Code Surface routes without reusing public Shared
  Space capabilities.
- `src/ui/design-system/` — use existing Workspace panel, badge, button, and degraded-state patterns.
- Worktree registry helpers — identify and reject Plan worktree paths where needed.

## Implementation Steps

- [ ] Define Code Surface process state, Project-root authorization checks, port/proxy strategy, and failure
      diagnostics.
- [ ] Implement code-server prerequisite detection and child-process supervision with start, stop, restart, health, and
      log/error capture.
- [ ] Add safe route/proxy handling that only targets registered enabled Project main checkouts and never Plan worktrees
      or arbitrary paths.
- [ ] Add Code Surface UI for Project entry, health, start/stop controls, failed/stopped states, and security/trust
      messaging.
- [ ] Convert eligible code search results into deep links after verifying registered main-checkout containment and
      sanitizing paths.
- [ ] Add tests for unregistered path rejection, removed/disabled Project rejection, Plan worktree exclusion, route
      sanitization, process health, failed startup, and deep-link eligibility.
- [ ] Update docs for code-server prerequisites, private-network/TLS deployment, and the fact that manual edits may
      affect Plan freshness/merge checks.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: tests should verify code-server registered-root enforcement, Plan worktree exclusion, sanitized deep links,
  failed/stopped health states, and route/proxy authorization.
- Manual headed browser: run `deno task workspace:dev`, open a registered Project Code Surface, stop/restart
  code-server, verify health states, and open an eligible search result deep link.
- Manual security: attempt to open an unregistered path, disabled Project, and Plan worktree; each must be rejected
  visibly and safely.

## Edge Cases & Considerations

- code-server has terminal and filesystem power within its configured environment; treat it as a separate high-trust
  integration.
- Code Surface cannot claim RunWield worktrees or Plan workflow ownership.
- Manual edits may make Plans stale or create merge conflicts; normal RunWield checks should surface those later.
- Pairing authorizes Workspace access, not transport encryption; TLS/private-network guidance remains required.
