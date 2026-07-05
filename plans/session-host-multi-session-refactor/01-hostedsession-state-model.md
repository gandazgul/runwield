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
status: "verified"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 1
dependencies:
    []
verifiedAt: "2026-07-04T17:59:22.590Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-05T14:29:29.698Z"
restoredAt: "2026-07-05T14:29:29.698Z"
restoredFromPath: "plans/archived/session-host-multi-session-refactor/01-hostedsession-state-model.md"
---

# HostedSession State Model

## Context

RunWield currently stores root interactive runtime state in `src/shared/session/session-state.js` as process-global
mutable state. That blocks ACP, Takopi, Workspace UI, and any in-process multi-session runtime because active Agent,
root session, pending swaps, model state, UI API, and workflow state can only represent one conversation at a time.

This child FEATURE is the first implementation slice of the `session-host-multi-session-refactor` Epic. The behavior is
sourced from `docs/prd/runwield-acp-session-host-PRD.md`,
`docs/adr/009-session-host-as-external-integration-boundary.md`, and the parent Epic: introduce Session Host as the
runtime seam and move session-scoped state into Hosted Sessions rather than adding a production singleton compatibility
facade.

This work is expected to run on an isolation branch. Intermediate branch states may break current TUI internals or flows
as long as CI passes and the targeted tests for this slice prove the intended state model. Full TUI restoration belongs
to later child FEATUREs.

## Objective

Create the new Session Host state seam and prove that two Hosted Sessions can coexist in one process without sharing
session-scoped state. This slice establishes the public state model that later slices will thread through the root agent
runtime, TUI, routing, and workflow code.

The enabled test harness for this slice must prove isolation for active Agent state, active handler, root session
manager/reference, root Agent name/session reference, transient sub-Agent set, pending root swap, pending switch
handoff, model/thinking state, project-state context, UI/event sink, cwd, and active execution workflow metadata.

## Approach

Add `HostedSession` as the owner of the mutable state shape currently represented by `session-state.js`, and add
`SessionHost` as the host-level registry/lifecycle module that creates, adopts, looks up, lists, and disposes Hosted
Sessions. Keep this slice focused on state and lifecycle behavior only; do not thread HostedSession through the full
runtime yet.

Use TDD for the new seam: write failing tests for `HostedSession` and `SessionHost`, implement the minimal API, then run
the focused tests and full CI. The existing `session-state.js` globals may remain temporarily for existing production
callers so CI can pass, but no new production global "current HostedSession" facade should be introduced. If
`session-state.js` is touched in this slice, prefer extracting/reusing JSDoc typedefs or documenting its legacy status;
leave broad caller migration to later slices.

Recommended API shape for this slice:

- `new HostedSession({ id, cwd, sessionManager, uiAPI, eventSink })` or an equivalent factory with pure JavaScript/JSDoc
  typedefs.
- Explicit getters/setters or small methods mirroring the current state shape: agent info stack/model override, active
  handler, root session manager, root AgentSession/name, sub-Agent Sessions, pending root swap, pending switch handoff
  with consume semantics, thinking level, project-state context, active execution workflow, active UI/event sink, and
  disposal state.
- `HostedSession#dispose()` marks the session disposed, clears owned runtime references, disposes root/sub AgentSessions
  when they expose `dispose()`, and makes future mutation fail clearly with an error instead of silently mutating dead
  state.
- `SessionHost#createSession({ cwd, sessionManager, id, uiAPI, eventSink })` creates or adopts a HostedSession,
  `getSession(id)`/`requireSession(id)` look up sessions, `listSessions()` returns stable metadata, and
  `disposeSession(id)` removes and disposes one HostedSession.

## Files to Modify

- `src/shared/session/hosted-session.js` — new per-session state container for active Agent/handler, root/sub sessions,
  pending swaps/handoffs, model/thinking state, project-state context, UI/event sink, session manager, cwd, and active
  execution workflow.
- `src/shared/session/session-host.js` — new host-level registry and lifecycle API for creating/adopting, looking up,
  listing, and disposing Hosted Sessions.
- `src/shared/session/session-state.js` — keep legacy singleton state for existing callers unless a small typedef/helper
  extraction is useful. Do not add a global current-HostedSession facade for production code.
- `src/shared/session/session-host.test.js` — new tests for SessionHost creation/adoption, lookup/require behavior,
  stable ids, cwd/session-manager ownership, list metadata, duplicate id rejection, and disposal/removal.
- `src/shared/session/hosted-session.test.js` — new tests for per-HostedSession state mutation, consume semantics,
  disposal behavior, and two-session isolation.
- `docs/prd/runwield-acp-session-host-PRD.md` — update only if the implemented state boundary reveals a small
  terminology clarification; avoid broad PRD edits in this executable slice.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-state.js` — reuse the existing JSDoc typedef names for `PendingRootSwap`,
  `PendingSwitchHandoff`, `AgentInfo`, model/thinking state, and active workflow metadata while moving new ownership
  into `HostedSession`.
- `src/shared/session/root-session.js` — reuse `createRootSessionManager()` and cwd/session directory helpers when a
  HostedSession needs a real persisted SessionManager; tests may inject lightweight SessionManager stubs.
- `src/shared/session/active-agent-session.js` — preserve active-agent persistence semantics for later runtime slices;
  do not rewrite this logic yet.
- Existing Deno tests under `src/shared/session/` — follow the current test style: `Deno.test`, `@std/assert`, small
  local stubs, pure JavaScript, and JSDoc typedefs rather than TypeScript syntax.
- `@earendil-works/pi-coding-agent` `SessionManager` primitives — use `getSessionId()`, `getCwd()`, `dispose()` where
  available instead of inventing a competing transcript format.

## Implementation Steps

- [ ] Step 1: Add `src/shared/session/hosted-session.test.js` with failing tests that create two Hosted Sessions and
      independently mutate/read active agent info stack, active handler, root Agent name/session, model override,
      thinking level, pending root swap, pending switch handoff, project-state context, UI/event sink, sub-Agent set,
      cwd/session manager, and active execution workflow.
- [ ] Step 2: Add `src/shared/session/session-host.test.js` with failing tests for create/adopt, lookup, require-missing
      error, list metadata, duplicate id protection, and disposal removing only the target HostedSession.
- [ ] Step 3: Implement `HostedSession` in `src/shared/session/hosted-session.js` with explicit methods/properties for
      the state currently owned by `session-state.js`, using pure JavaScript and JSDoc typedefs.
- [ ] Step 4: Implement `SessionHost` in `src/shared/session/session-host.js` with create/adopt/lookup/list/dispose
      behavior sufficient for in-process multi-session management. Prefer deterministic injected ids in tests and
      generated ids in production helpers.
- [ ] Step 5: Define and test minimal lifecycle behavior: active sessions accept mutation; disposed sessions clear owned
      references, leave inert metadata readable where useful, and throw a clear error on later mutation.
- [ ] Step 6: Touch `session-state.js` only if needed to share typedefs or add legacy comments. Do not migrate broad
      production imports or create a production global current-session bridge in this slice.
- [ ] Step 7: If future-slice expectations are useful, add skipped tests only when they name the owning child FEATURE
      explicitly, such as `02-root-agent-runtime-uses-hostedsession` or `03-tui-single-hostedsession-adapter`.

## Verification Plan

- Automated: run the focused new tests directly, for example
  `deno test -A src/shared/session/hosted-session.test.js src/shared/session/session-host.test.js`.
- Automated: run `deno task ci` and keep CI passing, even if later-slice tests are intentionally skipped.
- Automated: verify enabled tests prove two Hosted Sessions do not share active Agent info, active handler,
  model/thinking state, pending swap/handoff, project-state context, root/sub sessions, UI/event sink, cwd/session
  manager, or active execution workflow.
- Automated: search for any newly added skipped tests and confirm each skipped test name or reason identifies the later
  child FEATURE that owns unskipping it.
- Manual: no full TUI behavior restoration is required in this slice; if the TUI is temporarily broken on the isolation
  branch, record that as expected branch state.
- Expected result: the new state model exists, is independently testable, and becomes the target API for later slices.

## Edge Cases & Considerations

- Avoid reintroducing a singleton by another name. A module-level registry of many Hosted Sessions is acceptable inside
  a `SessionHost` instance; a module-level current HostedSession for production code is not.
- Keep this first slice narrow. Broad migration of `session.js`, `chat-session.js`, routing, commands, and workflow
  imports is owned by child FEATUREs 02–06.
- Disposal must not leak mutable references. Clear root/sub AgentSessions and call `dispose()` defensively when stubs or
  Pi AgentSessions expose it; swallowed dispose errors are acceptable only if tests document the choice.
- Duplicate ids should fail fast so two host entries cannot point at the same logical session id.
- Keep cwd/session-manager ownership explicit. If a SessionManager reports a cwd/session id, prefer that metadata; if a
  test stub does not, use the provided `cwd`/`id` options.
- Be explicit about skipped tests. Skipped tests are allowed only as temporary escrow for later slices and must identify
  their owner.
- Keep project language strictness: executable code is `.js` only, with JSDoc typedefs instead of TypeScript syntax.
