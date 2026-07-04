---
planId: "27d6c7c0-37d6-4b32-bc60-0426c5214d17"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Introduce the SessionHost/HostedSession state boundary and move the current session-state data shape into per-session ownership with a two-session isolation test harness. This slice intentionally prioritizes architectural proof over preserving all current TUI flows on the isolation branch."
affectedPaths:
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session-host.js"
    - "src/shared/session/session-state.js"
    - "src/shared/session/session-host.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "docs/prd/runwield-acp-session-host-PRD.md"
frontend: false
createdAt: "2026-07-03T18:03:46.140Z"
updatedAt: "2026-07-03T18:03:46.140Z"
status: "draft"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 1
dependencies:
    []
---

# HostedSession State Model

## Context

RunWield currently stores root interactive runtime state in `src/shared/session/session-state.js` as process-global
mutable state. That blocks ACP, Takopi, Workspace UI, and any in-process multi-session runtime because active agent,
root session, pending swaps, model state, UI API, and workflow state can only represent one conversation at a time.

This Epic is expected to run on an isolation branch. Intermediate branch states may break current UX or flows as long as
CI passes and the targeted tests for the current slice prove the intended behavior. Do not add compatibility shims or a
production singleton facade to preserve the old global model.

## Objective

Create the new Session Host state boundary and prove that two Hosted Sessions can coexist in one process without sharing
session-scoped state. This slice establishes the public state model that later slices will thread through session
runtime, TUI, routing, and workflow code.

## Approach

Add `HostedSession` as the owner of all mutable state that currently lives in `session-state.js`, and add a
`SessionHost` that can create, look up, and dispose multiple Hosted Sessions. Start with state and lifecycle behavior
only; do not try to refactor the full runtime in this slice.

Tests should be written first. It is acceptable to commit skipped tests for behavior intentionally owned by later
slices, but each skipped test must name the follow-up slice that owns unskipping it. The tests in this slice that define
the state model and two-session isolation must be enabled and passing.

## Files to Modify

- `src/shared/session/hosted-session.js` — new per-session state container for active agent/handler, root/sub sessions,
  pending swaps/handoffs, model/thinking state, project-state context, UI/event sink, session manager, cwd, and active
  execution workflow.
- `src/shared/session/session-host.js` — new host-level registry and lifecycle API for creating, loading, looking up,
  and disposing Hosted Sessions.
- `src/shared/session/session-state.js` — begin reducing this module away from mutable singleton ownership. Keep only
  typedefs/helpers if immediately useful; do not introduce a production current-session facade.
- `src/shared/session/session-host.test.js` — new tests for SessionHost creation, lookup, ids, cwd ownership, and
  disposal.
- `src/shared/session/hosted-session.test.js` — new tests for per-HostedSession state mutation and isolation.
- `docs/prd/runwield-acp-session-host-PRD.md` — update only if the implemented state boundary reveals a small
  terminology clarification; avoid broad PRD edits.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-state.js` — reuse the existing JSDoc typedefs for `PendingRootSwap`,
  `PendingSwitchHandoff`, and workflow-state shape while moving storage into `HostedSession`.
- `src/shared/session/root-session.js` — reuse `createRootSessionManager()` and cwd/session directory helpers as
  persistence primitives behind HostedSession creation.
- `src/shared/session/active-agent-session.js` — preserve active-agent persistence semantics for later runtime slices;
  do not rewrite this logic yet.
- Existing Deno tests under `src/shared/session/` — follow the current test style and pure JavaScript/JSDoc conventions.

## Implementation Steps

- [ ] Step 1: Write failing tests that create two Hosted Sessions and mutate active agent, active handler, root agent
      name/session, model override, thinking level, pending root swap, pending switch handoff, project-state context,
      UI/event sink, sub-agent set, and active execution workflow independently.
- [ ] Step 2: Implement `HostedSession` with explicit methods/properties for the state currently owned by
      `session-state.js`, using pure JavaScript and JSDoc typedefs.
- [ ] Step 3: Implement `SessionHost` with create/load-or-create/lookup/list/dispose behavior sufficient for in-process
      multi-session management.
- [ ] Step 4: Decide and document in code comments the minimal supported HostedSession lifecycle states, including
      disposed behavior.
- [ ] Step 5: Reduce `session-state.js` only as far as this slice safely allows. Avoid adding a global current
      HostedSession or compatibility facade for production callers.
- [ ] Step 6: Add any skipped tests needed to describe later runtime/TUI migration, and label them with the owning child
      slice.

## Verification Plan

- Automated: run the new HostedSession and SessionHost tests directly with Deno.
- Automated: run `deno run ci` and keep CI passing, even if some future-slice tests are intentionally skipped.
- Automated: verify enabled tests prove two Hosted Sessions do not share active agent, handler, model/thinking state,
  pending swap/handoff, project-state context, root/sub sessions, UI/event sink, or active execution workflow.
- Manual: no full TUI behavior restoration is required in this slice; if the TUI is temporarily broken on the isolation
  branch, record that as expected branch state.
- Expected result: the new state model exists, is independently testable, and becomes the target API for later slices.

## Edge Cases & Considerations

- Avoid reintroducing a singleton by another name. A module-level registry of many Hosted Sessions is acceptable inside
  `SessionHost`; a module-level current HostedSession for production code is not.
- Avoid broad runtime refactors in this first slice. The goal is to prove state ownership, not to make every old caller
  compile against it immediately.
- Be explicit about skipped tests. Skipped tests are allowed only as temporary escrow for later slices and must identify
  their owner.
- Keep project language strictness: executable code is `.js` only, with JSDoc typedefs instead of TypeScript syntax.
