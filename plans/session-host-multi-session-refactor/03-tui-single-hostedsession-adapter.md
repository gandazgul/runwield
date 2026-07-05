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
status: "verified"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 3
dependencies:
    - "root-agent-runtime-uses-hosted-session"
verifiedAt: "2026-07-05T00:56:25.425Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-05T14:29:31.009Z"
restoredAt: "2026-07-05T14:29:31.009Z"
restoredFromPath: "plans/archived/session-host-multi-session-refactor/03-tui-single-hostedsession-adapter.md"
---

# TUI Single HostedSession Adapter

## Context

The existing TUI is still shaped as the owner of a process-global interactive session: `startInteractiveSession()`
creates the root `SessionManager`, stores it through `session-state.js`, installs the active handler, owns active Agent
switching, applies pending root swaps, renders footer state from global root/sub sessions, and routes slash commands
through global session-state accessors.

This child FEATURE follows the verified Session Host state model and root-runtime slices. Product behavior is sourced
from `docs/prd/runwield-acp-session-host-PRD.md`, `docs/adr/009-session-host-as-external-integration-boundary.md`, and
the parent Epic: **the current TUI remains supported with no intended behavior change**, but it becomes one adapter over
one `HostedSession` instead of the owner of singleton runtime state.

Precondition: this plan assumes `src/shared/session/hosted-session.js`, `src/shared/session/session-host.js`, and the
HostedSession-aware runtime APIs from child FEATURE 02 are present in the execution branch. If they are missing, stop
and execute or restore the dependency slices first rather than recreating them inside this slice.

This work remains on the isolation branch. Routing, return-to-router, and workflow flows may still have temporary gaps
until later child FEATUREs, but the TUI should be restored enough in this slice to boot, own one HostedSession, switch
Agents, submit basic turns, update model/thinking/footer state, and reset with `/new`.

## Objective

Adapt `startInteractiveSession()` and adjacent interactive helpers so the terminal TUI creates and uses exactly one
current `HostedSession` through `SessionHost`. Preserve the visible behavior covered by this slice's tests:

- TUI boot creates a root session manager and initial Router root Agent through the current HostedSession.
- Active Agent switching queues and applies pending root swaps against the current HostedSession only.
- Slash command execution, prompt-template expansion, skill expansion, and cancellation receive HostedSession context.
- `/new` starts a fresh current HostedSession/root SessionManager for the TUI, clears the visible transcript, and leaves
  persisted default settings intact.
- `/model` and thinking controls update HostedSession-scoped model/thinking state and rebuild only that HostedSession's
  root AgentSession when required.
- Footer agent/model/thinking/token state is read from the current HostedSession's root and sub-Agent sessions.

## Approach

Create a `SessionHost` instance during interactive startup and keep `let hostedSession` inside the
`startInteractiveSession()` closure as the TUI's current session pointer. Do not add a production global
`getCurrentHostedSession()` shim. Pass `hostedSession` explicitly to runtime calls, slash dispatch, command execution,
message hydration, keybindings, UI API overrides, and helper functions that previously imported `session-state.js`
getters/setters.

Refactor top-level interactive helpers so their primary API is HostedSession-aware. Recommended shape:

- `setActiveAgent(hostedSession, agentName, handler, uiAPI, agentModel, options)` updates the HostedSession's active
  handler/UI state and queues a HostedSession-owned pending root swap.
- `applyPendingRootSwap(hostedSession, uiAPI)` drains only that HostedSession's pending root swap and calls
  `ensureRootAgentSession({ hostedSession, ... })`.
- `setActiveModel(hostedSession, model, provider)` updates the HostedSession's manual model override, persists defaults,
  and rebuilds only that HostedSession's current root when model capabilities change.
- TUI-local closures may bind these helpers, e.g.
  `const setCurrentActiveModel = (model, provider) =>
  setActiveModel(hostedSession, model, provider)`, for command/UI
  callback ergonomics.

For `/new`, prefer an explicit TUI callback passed through slash dispatch, such as `replaceHostedSession(nextSession)`,
that updates the closure variable, reattaches the existing `uiAPI`/event sink, resets active handler and root state to
Router, updates the Terminal Title, and clears pending submission/steering UI state. If the `HostedSession` API already
exposes a tested reset method from earlier slices, using that method is acceptable, but the TUI must still avoid a
process-global current-session pointer.

Skipped tests remain acceptable only for routing/workflow behavior owned by later slices
(`04-routing-and-return-to-router-session-scoping` or `05-workflow-execution-and-validation-session-scoping`). Tests for
TUI boot, active Agent switching, slash dispatch context, `/new`, `/model`, thinking state, and footer state should be
enabled and passing in this slice.

## Files to Modify

- `src/shared/interactive/chat-session.js` — create the TUI `SessionHost`/`HostedSession` in
  `startInteractiveSession()`, store the current HostedSession in the interactive closure, and thread it through
  startup, root Agent creation, submission, slash dispatch, image preflight/persistence, steering, footer rendering,
  active Agent switching, pending root swaps, `/model`, thinking controls, and `/new` replacement callbacks.
- `src/shared/interactive/slash-dispatch.js` — extend `SlashContext` with `hostedSession` plus TUI-bound callbacks such
  as `setActiveAgent`, `applyPendingRootSwap`, `setActiveModel`, and `replaceHostedSession`; pass HostedSession and its
  root `SessionManager` into built-in command options; call `abortActiveSession(hostedSession)` for cancellation; keep
  expanded prompts submitted through the TUI's HostedSession-bound active root path.
- `src/shared/interactive/message-hydration.js` — stop importing global active Agent state; accept HostedSession or an
  explicit active-Agent label and use it when replaying assistant/tool/task-completed transcript blocks.
- `src/shared/interactive/ui-api-overrides.js` — stop reading active model state from globals by default in the TUI
  path; accept a HostedSession-scoped `getActiveModelState` closure when installing the model selector override.
- `src/shared/interactive/keybindings.js` — remove direct global abort/root-session assumptions from Esc and steering
  cleanup paths by accepting HostedSession-bound `abortActiveSession`, `getRootAgentSession`, and related callbacks from
  `chat-session.js`.
- `src/cmd/new/index.js` — make `/new` use command options for the current `hostedSession`, `sessionHost`, and/or
  `replaceHostedSession` callback. It should create a fresh root `SessionManager`, install/replace the TUI's current
  HostedSession, update the Terminal Title, clear visible messages, and report the new session id without mutating
  `session-state.js`.
- `src/cmd/models/index.js` — prefer `options.setActiveModel` (or equivalent command option) over importing a global TUI
  setter so `/model` updates the current HostedSession. Preserve CLI output behavior when no TUI is present.
- `src/cmd/registry.js` — update the `CommandContext` JSDoc typedef with optional HostedSession/sessionHost and
  HostedSession-bound command callbacks used by slash dispatch. Keep this pure JavaScript/JSDoc only.
- `src/shared/interactive/chat-session.test.js` — adapt helper tests to construct HostedSession/SessionHost fixtures,
  prove active Agent/model/thinking/footer behavior is scoped to the supplied HostedSession, and add/unskip TUI startup
  coverage if existing harnesses support it.
- `src/shared/interactive/slash-dispatch.test.js` — assert built-in command dependencies include HostedSession context,
  cancellation calls `abortActiveSession(hostedSession)`, prompt-template macros switch Operator via the supplied
  HostedSession-bound setter, and expanded input does not fall back to global active handler/session state.
- `src/shared/interactive/message-hydration.test.js` — update hydration tests to pass HostedSession/active-Agent context
  explicitly and prove assistant/task-completed labels no longer come from global state.
- `src/cmd/new/index.test.js` — update `/new` tests to assert the TUI replacement callback/session host is used instead
  of `setRootSessionManager()`.

## Reuse Opportunities

Existing modules and seams to reuse:

- `src/shared/session/session-host.js` — create and replace the TUI's one current HostedSession using the state seam
  established in child FEATURE 01.
- `src/shared/session/hosted-session.js` — use the HostedSession state APIs for active handler, root manager,
  root/sub-Agent sessions, pending swaps/handoffs, model override, thinking level, project-state context, UI API, event
  sink, cwd, and disposal.
- `src/shared/session/session.js` — reuse HostedSession-aware `ensureRootAgentSession()`, `runAgentSession()`,
  `abortActiveSession()`, `steerRootSessionWithTarget()`, prompt-template/skill expansion, and reload behavior from
  child FEATURE 02.
- `src/shared/session/root-session.js` — keep using `createRootSessionManager()` for TUI startup and `/new` root
  persistence.
- `src/shared/interactive/chat-session.js` — preserve TUI layout, boot logo/banner, footer rendering mechanics, image
  paste UI, submission queue, steering UI, generation guard behavior, and modal prompt focus restoration.
- `src/shared/ui/terminal-title.js` — preserve Terminal Title behavior for startup, slash command title fallback, and
  `/new` session naming.
- Existing Deno test style — use `Deno.test`, `@std/assert`, small local stubs, pure `.js`, and JSDoc typedefs rather
  than TypeScript syntax.

## Implementation Steps

- [ ] Step 1: Add/adapt failing tests for HostedSession-scoped interactive helpers: `setActiveAgent()`,
      `applyPendingRootSwap()`, `setActiveModel()`, footer session collection, and thinking-level updates should read
      and mutate only the supplied HostedSession.
- [ ] Step 2: Refactor `startInteractiveSession()` boot to create a `SessionHost`, create/adopt one current
      HostedSession with the root `SessionManager`, cwd, UI API/event sink, project-state context, active handler, and
      initial Router root Agent setup.
- [ ] Step 3: Replace `session-state.js` reads/writes in `chat-session.js` with HostedSession method calls or narrow
      closure callbacks. Keep `let hostedSession` inside the TUI closure so `/new` can replace it without a global.
- [ ] Step 4: Refactor `setActiveAgent(hostedSession, ...)` and `applyPendingRootSwap(hostedSession, ...)` to queue,
      drain, clear manual model override, rebuild root, update UI, and report failures against only the current
      HostedSession. Preserve turn-boundary swap application.
- [ ] Step 5: Refactor model and thinking paths: `setActiveModel(hostedSession, ...)`, `getActiveModel()`, footer model
      resolution, model selector override, and Shift+Tab thinking cycling should use HostedSession state while still
      persisting defaults through settings.
- [ ] Step 6: Refactor submission, steering, image preflight, and keybindings so active handler/session manager,
      root/sub sessions, abort, steer, and queue cleanup come from the current HostedSession.
- [ ] Step 7: Refactor slash dispatch so built-in commands receive `hostedSession`,
      `sessionManager:
      hostedSession.getRootSessionManager()`, and HostedSession-bound callbacks. Expanded prompt
      templates and skills should submit through the existing `dispatchExpandedUserRequest` closure, not through global
      fallback state.
- [ ] Step 8: Refactor `/new` to create a fresh root `SessionManager` and replace/reset the TUI's current HostedSession,
      clear visible transcript and pending UI queues, reset active Agent/root to Router, update Terminal Title, and
      append `Started new session: <id>`.
- [ ] Step 9: Refactor `/model` command execution to use the HostedSession-bound `options.setActiveModel` callback in
      interactive mode, while preserving non-interactive CLI messages.
- [ ] Step 10: Refactor message hydration and UI API overrides to accept HostedSession-scoped state explicitly; remove
      their direct imports of active Agent/model globals.
- [ ] Step 11: Keep only future-slice tests skipped, and label each skip with the owning child FEATURE. Do not leave
      skipped tests for boot, `/new`, `/model`, thinking/footer, slash dispatch context, or helper scoping.

## Verification Plan

- Automated: run focused interactive and command tests:
  `deno test -A src/shared/interactive/chat-session.test.js src/shared/interactive/slash-dispatch.test.js src/shared/interactive/message-hydration.test.js src/shared/interactive/ui-api-overrides.test.js src/cmd/new/index.test.js`.
- Automated: run focused model command tests if added or existing after the refactor, e.g.
  `deno test -A src/cmd/models`.
- Automated: run `deno task ci`; CI must pass with only explicitly justified future-slice skipped tests.
- Automated: search for direct mutable `session-state.js` imports in `src/shared/interactive/chat-session.js`,
  `src/shared/interactive/slash-dispatch.js`, `src/shared/interactive/message-hydration.js`,
  `src/shared/interactive/ui-api-overrides.js`, `src/shared/interactive/keybindings.js`, `src/cmd/new/index.js`, and
  `src/cmd/models/index.js`. This slice should not leave those files using singleton session state for their targeted
  TUI paths.
- Manual: start the TUI normally with `deno task cli`; verify it boots without crashing, shows the expected footer,
  renders boot/startup messages, and builds the initial Router root Agent when model setup is satisfied.
- Manual: submit a simple User Request when model credentials are available and verify it goes through the current
  HostedSession-bound active root path.
- Manual: run `/agent router` or an equivalent active-Agent switch path if available and verify the footer changes only
  after the pending root swap is applied.
- Manual: run `/model` or the model selector and verify the footer updates, the root AgentSession rebuilds if model
  capabilities change, and errors are surfaced in the TUI instead of causing unhandled rejections.
- Manual: cycle thinking with Shift+Tab and verify footer thinking state updates and persists to settings.
- Manual: run `/new optional name`; verify the transcript clears, Terminal Title/session name updates, pending queues do
  not leak, and the new session starts from Router with a new root session id.
- Expected result: the existing TUI is now a one-HostedSession adapter, with scoped boot/session/model/footer/slash/new
  behavior, even if higher-level routing and workflow isolation are completed by later child FEATUREs.

## Edge Cases & Considerations

- Do not hide HostedSession in a production global TUI singleton. The interactive closure may retain the current
  HostedSession; commands should receive it through explicit options/callbacks.
- Be careful with `/new`: old root/sub-AgentSessions and subscriptions should be disposed or detached so later UI events
  from the old session cannot mutate the new transcript. Persisted default model/thinking settings should remain; only
  session-scoped overrides/queues/root state should reset.
- Footer state should remain honest: do not update the displayed active Agent before the pending root swap has actually
  rebuilt the HostedSession's root AgentSession.
- Prompt-template slash commands should keep existing semantics: template macros switch to Operator, expanded text is
  submitted through the active root path, and template model metadata remains ignored per the recorded slash semantics.
- Some built-in commands outside this slice (`resume`, `session`, `compact`, `copy`, `reload`, `load-plan`) may still
  read singleton state until child FEATURE 06. Slash dispatch should still pass HostedSession context now so those
  commands can migrate without another dispatcher rewrite.
- Keep all implementation in pure JavaScript with JSDoc typedefs; do not introduce TypeScript syntax or `.ts` files.
