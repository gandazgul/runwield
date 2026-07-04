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
updatedAt: "2026-07-03T18:03:46.154Z"
status: "draft"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 2
dependencies:
    - "hosted-session-state-model"
---

# Root Agent Runtime Uses HostedSession

## Context

After the HostedSession state model exists, `src/shared/session/session.js` still owns important runtime behavior
through implicit reads and writes to `session-state.js`. Root AgentSession construction, prompt execution,
abort/steer/reload, model resolution, sub-agent tracking, UI subscriber fallback, and root metadata must become explicit
HostedSession operations before TUI, routing, and workflow code can be safely multi-session.

This work is still on an isolation branch. Intermediate UX and higher-level flows may be broken while this runtime
boundary is rebuilt. Do not spend time on shims or adapter facades that preserve the old singleton model.

## Objective

Make the root agent runtime accept and mutate a specific HostedSession. Prove that two Hosted Sessions can each own
independent root AgentSessions and transient sub-agent turns in one process.

## Approach

Thread a `hostedSession` option through the core runtime functions in `session.js`. Replace calls to global state
getters/setters with HostedSession methods. Keep existing Pi `AgentSession`, `SessionManager`, prompt assembly, tool
resolution, model resolution, and UI subscriber logic where possible; move ownership, not behavior.

Tests should lead the refactor. Any skipped tests for TUI or workflow behavior must identify the later slice that
unskips them. Runtime tests for root/sub-session isolation in this slice must be enabled and passing.

## Files to Modify

- `src/shared/session/session.js` — update `ensureRootAgentSession()`, `runRootTurn()`, `runAgentSession()`,
  `abortActiveSession()`, `steerRootSession()`, `steerRootSessionWithTarget()`, `reloadRootAgentSession()`, and
  subscriber fallback paths to use HostedSession state.
- `src/shared/session/hosted-session.js` — add any runtime helpers needed by `session.js`, such as root metadata
  accessors or disposal hooks, without leaking global state.
- `src/shared/session/session-host.js` — expose creation/loading hooks needed to provide a session manager and cwd to
  runtime tests.
- `src/shared/session/root-session.js` — keep persistence helpers reusable for per-HostedSession root manager
  creation/loading.
- `src/shared/session/active-agent-session.js` — keep `recordActiveAgent()` scoped to the HostedSession's own
  SessionManager.
- `src/shared/session/session-prompt.test.js` — adapt prompt/root-turn tests to pass a HostedSession.
- `src/shared/session/session-subscribers.test.js` — adapt subscriber tests to HostedSession-owned UI/event sink
  behavior.
- `src/shared/session/abort-active-session.test.js` — prove abort only affects sessions owned by the target
  HostedSession.
- `src/shared/session/image-attachments.test.js` — adapt image/session-manager expectations to HostedSession context
  where needed.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` — reuse `buildAgentSession()`, `runPrompt()`, `attachUiSubscribers()`,
  `resolveModel()`, `assembleFinalSystemPrompt()`, skill loading, prompt-template expansion, and custom tool resolution.
- `src/shared/session/root-session.js` — reuse `createRootSessionManager()` and image directory helpers for the
  HostedSession's persisted root session.
- `src/shared/session/active-agent-session.js` — reuse active-agent marker persistence, but always call it with the
  current HostedSession's manager.
- `src/shared/session/hosted-session.js` — reuse the state APIs created by the previous slice rather than adding local
  state in `session.js`.

## Implementation Steps

- [ ] Step 1: Write or unskip runtime tests showing two Hosted Sessions can each build/rebuild their own root
      AgentSession without overwriting each other's root agent name, model state, or root session reference.
- [ ] Step 2: Change `ensureRootAgentSession()` to require or receive a HostedSession and to dispose/rebuild only that
      HostedSession's root session.
- [ ] Step 3: Change `runRootTurn()` and `runAgentSession()` to resolve root reuse, project-state context, sub-agent
      tracking, UI subscriber fallback, and model/thinking state from the passed HostedSession.
- [ ] Step 4: Change abort, steer, and reload helpers to operate on a specific HostedSession. Do not leave production
      fallback paths that silently use process-global root state.
- [ ] Step 5: Keep root session metadata keyed by actual AgentSession objects if useful, but ensure all access is
      mediated through the owning HostedSession.
- [ ] Step 6: Adapt enabled session-runtime tests and label any intentionally skipped higher-level tests with their
      owning later slice.

## Verification Plan

- Automated: run adapted `src/shared/session/*session*.test.js` tests relevant to root prompt/runtime behavior.
- Automated: run `deno run ci`; CI must pass even if later-slice tests are intentionally skipped.
- Automated: enabled tests must prove root AgentSession A and root AgentSession B are independent, and a transient
  sub-agent in one HostedSession does not appear in another.
- Manual: no full TUI verification is required yet. If interactive boot is broken after this runtime cut, note it as
  expected intermediate branch state.
- Expected result: core prompt execution APIs are HostedSession-aware and no longer depend on `session-state.js` mutable
  globals for root/sub-session ownership.

## Edge Cases & Considerations

- `rootSessionMetadata` can remain module-level if it is keyed by actual AgentSession objects, but callers must not be
  able to ask for "the" root metadata without passing or deriving the owning HostedSession.
- UI subscriber fallback currently uses active UI global state. Replace that with the HostedSession's UI/event sink;
  avoid a global UI fallback.
- Runtime APIs may become more verbose temporarily. Prefer explicit context plumbing over convenience globals.
- Preserve existing model resolution behavior unless a test proves a change is required for per-session isolation.
