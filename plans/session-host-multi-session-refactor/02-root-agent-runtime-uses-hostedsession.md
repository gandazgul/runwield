---
planId: "329b2476-911e-440e-97dc-2bc1334da37e"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Refactor the core agent-session runtime so root turns, transient sub-agent turns, abort, steer, reload, and metadata access operate against an explicit HostedSession instead of implicit process globals."
affectedPaths:
    - "src/shared/session/session.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session-host.js"
    - "src/shared/session/root-session.js"
    - "src/shared/session/active-agent-session.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/session-subscribers.test.js"
    - "src/shared/session/abort-active-session.test.js"
    - "src/shared/session/image-attachments.test.js"
frontend: false
createdAt: "2026-07-03T18:03:46.154Z"
status: "verified"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 2
dependencies:
    - "hosted-session-state-model"
verifiedAt: "2026-07-04T22:19:29.403Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-04T22:19:26.599Z"
updatedAt: "2026-07-05T14:29:30.333Z"
restoredAt: "2026-07-05T14:29:30.333Z"
restoredFromPath: "plans/archived/session-host-multi-session-refactor/02-root-agent-runtime-uses-hostedsession.md"
---

# Root Agent Runtime Uses HostedSession

## Context

`HostedSession` and `SessionHost` now exist as the per-session state seam from child FEATURE 01. The next blocker is
`src/shared/session/session.js`: it still builds, reuses, aborts, steers, reloads, tracks sub-agent turns, resolves
manual model state, stores root metadata, and falls back to active UI through `session-state.js` process globals.

This behavior is sourced from `docs/prd/runwield-acp-session-host-PRD.md`,
`docs/adr/009-session-host-as-external-integration-boundary.md`, and the parent Epic. The intended product behavior is
not changing in this slice; this is an architectural ownership move so the same runtime can later power the TUI, ACP,
Workspace UI, and messaging adapters without a singleton conversation.

This work remains on the isolation branch. It is acceptable for higher-level interactive, routing, and workflow flows to
be temporarily incomplete until later child FEATUREs, but the enabled runtime tests in this slice must pass and prove
per-HostedSession isolation.

## Objective

Make the core agent runtime accept and mutate a specific `HostedSession` for root turns, transient sub-agent turns,
abort, steer, reload, model/thinking state, UI subscriber fallback, root metadata, and active-agent marker persistence.

The key proof is that two Hosted Sessions in one process can each own independent root AgentSessions and transient
sub-agent sessions: root reuse/rebuild, abort, steer, reload, active model/thinking updates, and metadata lookup in
HostedSession A must not observe or mutate HostedSession B.

## Approach

Thread a `hostedSession` option through the runtime-facing functions in `session.js` instead of reading from
`session-state.js`. Keep the existing Pi `AgentSession`, `SessionManager`, prompt assembly, tool resolution, model
resolution, image handling, and subscriber behavior; move ownership and lookup to `HostedSession`.

Use focused TDD with lightweight AgentSession/SessionManager/UI stubs where possible. If constructing a real Pi
`AgentSession` makes an isolation test expensive or credential-dependent, introduce a narrow test-only dependency seam
on runtime options (for example underscored `_buildAgentSession`, `_attachUiSubscribers`, or `_runPrompt` overrides) and
keep that seam internal to `session.js` tests. Do not introduce a production "current HostedSession" global or a
compatibility facade that hides the explicit session parameter.

Recommended runtime API shape for this slice:

- `ensureRootAgentSession({ hostedSession, ... })` disposes/rebuilds only `hostedSession`'s root session.
- `runRootTurn({ hostedSession, ... })` runs against `hostedSession.getRootAgentSession()` and
  `hostedSession.getRootAgentName()`.
- `runAgentSession({ hostedSession, ... })` uses the HostedSession for both root turns and `useRootSession: false`
  transient turns, including sub-agent tracking and UI stack updates.
- `abortActiveSession(hostedSession)`, `steerRootSession(hostedSession, text, images)`,
  `steerRootSessionWithTarget(hostedSession, text, images)`, and `reloadRootAgentSession(hostedSession, uiAPI)` operate
  on the supplied HostedSession only.
- `buildAgentSession()` and model/thinking resolution receive enough HostedSession context to use manual `/model`
  overrides and to update `hostedSession`'s thinking state instead of global state.
- `attachUiSubscribers()` uses `uiAPI || hostedSession.getActiveUiAPIState()` as its live UI target; if neither exists,
  it may keep the existing stdout behavior.

## Files to Modify

- `src/shared/session/session.js` — remove runtime dependence on `session-state.js` for root/sub session ownership,
  project-state context, active model override, thinking state, active UI fallback, abort/steer/reload, root metadata,
  and active-agent marker writes. Add explicit HostedSession parameters/options to runtime APIs.
- `src/shared/session/hosted-session.js` — add any small runtime helpers needed by `session.js`, especially root runtime
  metadata get/set/clear or disposal hooks, without leaking process-global state.
- `src/shared/session/session-host.js` — expose or preserve creation/adoption hooks that let tests create multiple
  Hosted Sessions with injected SessionManagers, cwd, UI APIs, and event sinks.
- `src/shared/session/root-session.js` — keep persisted root `SessionManager` creation/loading helpers reusable per
  HostedSession; only adjust if runtime tests need a clearer per-session factory surface.
- `src/shared/session/active-agent-session.js` — preserve `recordActiveAgent()` semantics, but ensure runtime callers
  pass `hostedSession.getRootSessionManager()` or an explicitly supplied manager for that HostedSession.
- `src/shared/session/session-prompt.test.js` — add/adapt root runtime tests for HostedSession root reuse/rebuild, root
  metadata, model/thinking state, and no cross-session leakage.
- `src/shared/session/session-subscribers.test.js` — replace the global active-UI fallback test with a HostedSession UI
  fallback test, and keep direct `uiAPI` behavior covered.
- `src/shared/session/abort-active-session.test.js` — rewrite abort tests around two Hosted Sessions; prove idle roots
  are not aborted, streaming roots are aborted only in the target session, queues are cleared only in the target root,
  and sub-agents are scoped.
- `src/shared/session/image-attachments.test.js` — adapt any session-manager/image expectations affected by using the
  HostedSession's manager/cwd during prompt preparation and steering fallback.
- `src/shared/session/hosted-session.test.js` — extend the state-model tests if new root metadata helpers or disposal
  behavior are added.
- `src/shared/session/session-host.test.js` — extend only if SessionHost needs additional test construction helpers.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` — reuse `buildAgentSession()`, `runPrompt()`, `attachUiSubscribers()`,
  `resolveModel()`, `assembleFinalSystemPrompt()`, skill loading, prompt-template expansion, custom tool resolution, and
  `shouldReuseExistingRootSession()`; change their state inputs, not their core behavior.
- `src/shared/session/hosted-session.js` — reuse the state APIs created in child FEATURE 01 for agent info stack, model
  override, thinking level, root/sub sessions, project-state context, UI API, event sink, cwd, and root manager.
- `src/shared/session/root-session.js` — reuse `createRootSessionManager()` and image directory helpers for the
  HostedSession's persisted root session.
- `src/shared/session/active-agent-session.js` — reuse active-agent marker persistence against the HostedSession's own
  SessionManager.
- Existing Deno test style under `src/shared/session/` — small local stubs, `Deno.test`, `@std/assert`, pure JavaScript,
  and JSDoc typedefs rather than TypeScript syntax.

## Implementation Steps

- [ ] Step 1: Add failing tests for `abortActiveSession(hostedSession)` and subscriber fallback showing two Hosted
      Sessions do not share root sessions, sub-agent sets, queues, or UI output.
- [ ] Step 2: Add failing root-runtime tests showing two Hosted Sessions can each build or reuse a root AgentSession
      without overwriting the other's root agent name, root metadata, root turn count, active model/thinking state, or
      SessionManager reference.
- [ ] Step 3: Update `HostedSession` with any required root runtime metadata helpers. Prefer `set/get/clear` methods on
      the HostedSession or a `session.js` helper keyed by the HostedSession's own root AgentSession; do not expose a
      global "current metadata" lookup.
- [ ] Step 4: Refactor `buildAgentSession()`/`resolveModel()` plumbing so manual model overrides and thinking level are
      read from and written to the passed HostedSession. Default cwd to `hostedSession.cwd` when no explicit cwd is
      supplied.
- [ ] Step 5: Refactor `ensureRootAgentSession()` to require `hostedSession`, dispose/unsubscribe only that session's
      existing root, build the new root with the HostedSession's manager/cwd/project context, update the HostedSession's
      root session/name/agent info, and call `recordActiveAgent()` with the HostedSession's root manager.
- [ ] Step 6: Refactor `runRootTurn()` to require `hostedSession`, validate the requested agent against
      `hostedSession.getRootAgentName()`, use HostedSession-owned metadata, increment that session's root turn count,
      and rebuild only that root when custom tools require it.
- [ ] Step 7: Refactor `runAgentSession()` so both root and `useRootSession: false` paths require HostedSession. The
      transient path must add/remove the sub-agent session on the HostedSession, push/pop that HostedSession's agent
      info stack, and unsubscribe/dispose exactly as before.
- [ ] Step 8: Refactor `attachUiSubscribers()` to use the explicit `uiAPI` first and the HostedSession's active UI API
      second, removing the `getActiveUiAPIState()` fallback from `session-state.js`.
- [ ] Step 9: Refactor abort, steer, and reload helpers to accept HostedSession and operate on that session's root,
      sub-agents, manager, metadata, model registry, and UI only. Preserve the idle-root abort regression behavior.
- [ ] Step 10: Remove unused `session-state.js` imports from `session.js`. If higher-level tests break because TUI,
      routing, or workflow callers have not yet been migrated, skip only those tests with names/reasons pointing to the
      owning later child FEATURE (`03-tui-single-hostedsession-adapter`,
      `04-routing-and-return-to-router-session-scoping`, or `05-workflow-execution-and-validation-session-scoping`).

## Verification Plan

- Automated: run focused runtime tests:
  `deno test -A src/shared/session/session-prompt.test.js src/shared/session/session-subscribers.test.js src/shared/session/abort-active-session.test.js src/shared/session/image-attachments.test.js src/shared/session/hosted-session.test.js src/shared/session/session-host.test.js`.
- Automated: run `deno task ci`; CI must pass with only explicitly justified future-slice skipped tests.
- Automated: enabled tests must prove root AgentSession A and root AgentSession B are independent, root metadata and
  root turn count do not cross sessions, abort/steer/reload target only the supplied HostedSession, and a transient
  sub-agent in one HostedSession does not appear in another.
- Automated: search for `from "./session-state.js"` in `src/shared/session/session.js` and verify `session.js` no longer
  imports singleton root/sub/model/UI state from that module.
- Manual: no full TUI verification is required in this slice. If interactive boot, routing, or workflow behavior is
  temporarily broken after this runtime cut, record it as expected isolation-branch state and point to the later child
  FEATURE that restores it.
- Expected result: core prompt execution APIs are HostedSession-aware and do not depend on `session-state.js` mutable
  globals for root/sub-session ownership, model/thinking state, UI subscriber fallback, abort/steer/reload, or metadata.

## Edge Cases & Considerations

- Do not add a production singleton such as `getCurrentHostedSession()`. That would preserve the single-session problem
  ADR-009 is trying to remove.
- `rootSessionMetadata` may remain in `session.js` only if callers must pass a HostedSession or its owned root
  AgentSession to access it. A bare "the root metadata" helper is not acceptable.
- Existing higher-level callers may still be global until later slices. It is acceptable for this slice to make runtime
  APIs stricter as long as compile/check/CI pass and skipped behavior tests clearly name the later owner.
- Preserve existing model resolution order and image fallback behavior unless a HostedSession isolation test proves a
  scoping change is required.
- Preserve the Esc idle-root regression behavior: an existing but non-streaming root session must not count as an active
  aborted run.
- Keep all implementation in pure JavaScript with JSDoc typedefs; do not introduce TypeScript syntax or `.ts` files.
