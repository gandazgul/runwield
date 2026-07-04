---
planId: "07270c85-74a8-4213-b68e-cb06fc8f2a22"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Rebuild the existing interactive TUI as a client of one HostedSession, including boot, active agent switching, slash dispatch, /new, model/thinking state, and footer state."
affectedPaths:
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/slash-dispatch.js"
    - "src/shared/interactive/message-hydration.js"
    - "src/shared/interactive/ui-api-overrides.js"
    - "src/cmd/new/index.js"
    - "src/cmd/models/index.js"
    - "src/shared/interactive/chat-session.test.js"
    - "src/shared/interactive/message-hydration.test.js"
frontend: false
createdAt: "2026-07-03T18:03:46.154Z"
updatedAt: "2026-07-03T18:03:46.154Z"
status: "draft"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 3
dependencies:
    - "root-agent-runtime-uses-hosted-session"
---

# TUI Single HostedSession Adapter

## Context

The current TUI is tightly coupled to the global runtime: it creates the root `SessionManager`, sets the active handler,
owns active agent switching, applies pending root swaps, renders footer state from global root/sub sessions, and routes
slash commands through global session-state accessors. After the core runtime is HostedSession-aware, the TUI must
become a Session Host client that uses exactly one HostedSession.

This is still an isolation-branch refactor. Some workflow/routing behavior may remain broken until later slices, but the
TUI should be restored enough in this slice to boot, own one HostedSession, switch agents, submit basic turns, and reset
with `/new`.

## Objective

Adapt `startInteractiveSession()` and adjacent interactive helpers so the existing TUI runs through a HostedSession
instead of process-global session state. Preserve the visible TUI behavior covered by this slice's tests, especially
active agent/footer/model/thinking behavior and `/new` reset semantics.

## Approach

Create the TUI's HostedSession during interactive startup through SessionHost. Store the HostedSession in the
interactive closure and pass it explicitly to helper functions, slash dispatch, command execution, and root runtime
calls. Convert top-level interactive helpers that used globals into functions that either accept HostedSession or are
clearly TUI-bound wrappers around HostedSession operations.

Skipped tests remain acceptable only for routing/workflow behavior owned by later slices. Tests for TUI boot, agent
switching, model/thinking state, slash dispatch context, and `/new` should be enabled and passing in this slice.

## Files to Modify

- `src/shared/interactive/chat-session.js` — create/use one HostedSession in `startInteractiveSession()`, refactor
  `setActiveAgent()`, `applyPendingRootSwap()`, model/thinking handlers, footer state reads, image capability rebuilds,
  and submission flow to use HostedSession.
- `src/shared/interactive/slash-dispatch.js` — pass HostedSession context into slash command dispatch and expanded
  prompt submission instead of reading root session globals.
- `src/shared/interactive/message-hydration.js` — read active agent name/session details from the supplied HostedSession
  where needed.
- `src/shared/interactive/ui-api-overrides.js` — replace active model global reads with HostedSession-scoped state.
- `src/cmd/new/index.js` — make `/new` replace/reset the current TUI HostedSession rather than setting a global root
  manager.
- `src/cmd/models/index.js` — ensure `/model` updates the current HostedSession and rebuilds only its root AgentSession
  when needed.
- `src/shared/interactive/chat-session.test.js` — adapt or unskip tests for TUI boot, active model switch, root rebuild,
  and footer state.
- `src/shared/interactive/message-hydration.test.js` — adapt hydration assertions to HostedSession context.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/interactive/chat-session.js` — reuse TUI layout, footer rendering, image paste, submission queue, steering
  UI, and generation guard behavior.
- `src/shared/session/session-host.js` — reuse SessionHost creation/loading for the TUI's one HostedSession.
- `src/shared/session/session.js` — reuse HostedSession-aware root runtime functions from the previous slice.
- `src/shared/session/root-session.js` — reuse session manager creation for `/new` and TUI startup.
- `src/shared/ui/terminal-title.js` — preserve terminal title behavior for current session manager/session names.

## Implementation Steps

- [ ] Step 1: Write or unskip tests proving TUI startup creates one HostedSession with a root SessionManager, cwd,
      UI/event sink, active handler, and initial Router agent setup.
- [ ] Step 2: Refactor `startInteractiveSession()` to create the HostedSession and pass it through submission, slash
      dispatch, model/thinking, and footer closures.
- [ ] Step 3: Refactor `setActiveAgent()` and `applyPendingRootSwap()` to operate on a supplied HostedSession. Keep
      pending swap application at turn boundaries.
- [ ] Step 4: Refactor footer model/agent/session usage to read from the HostedSession's root/sub sessions and
      model/thinking state.
- [ ] Step 5: Refactor slash dispatch so built-in commands receive HostedSession context in command options and expanded
      prompt macros submit through the HostedSession's active handler/session manager.
- [ ] Step 6: Refactor `/new` to replace/reset the TUI's current HostedSession and clear UI messages without touching
      global state.
- [ ] Step 7: Keep routing/workflow tests skipped if they depend on later slices, and label those skips with the owning
      slice.

## Verification Plan

- Automated: run adapted `src/shared/interactive/chat-session.test.js` and
  `src/shared/interactive/message-hydration.test.js`.
- Automated: run command tests for `/new` and `/model` behavior affected by HostedSession context.
- Automated: run `deno run ci`; CI must pass with only explicitly justified future-slice skipped tests.
- Manual: start the TUI normally and verify it boots without crashing, shows the expected footer, accepts a simple
  prompt path when model credentials are available, switches active agent through `/agent router` or an equivalent
  direct agent path if available, updates `/model`/thinking footer state, and starts a clean session with `/new`.
- Expected result: the current TUI is now a one-HostedSession adapter, even if higher-level routing/plan workflows are
  not fully restored until later slices.

## Edge Cases & Considerations

- Avoid hiding HostedSession in a global TUI singleton. It is acceptable for the interactive closure to retain its
  current HostedSession.
- Slash command context is the main bridge to many command modules. Prefer passing `hostedSession` in command options
  over letting commands import session state.
- `/new` must replace root session state for the current TUI session only; future Hosted Sessions in the same process
  must not be affected.
- Footer state should remain honest: do not update the active displayed agent before a pending root swap has actually
  been applied.
