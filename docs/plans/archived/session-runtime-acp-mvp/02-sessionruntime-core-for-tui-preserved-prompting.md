---
planId: "453ec3ec-725b-49f8-9fd5-a77504703f64"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Introduce the adapter-neutral SessionRuntime seam over SessionHost/HostedSession and route the existing TUI prompt/handoff loop through it without changing user-visible TUI behavior."
affectedPaths:
    - "docs/adr/010-session-runtime-sibling-adapters-and-acp.md"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-host.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/slash-dispatch.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/session-host.test.js"
    - "src/shared/session/agent-handler.test.js"
frontend: false
createdAt: "2026-07-07T02:13:46.228Z"
status: "verified"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 2
dependencies:
    - "01-acp-sdk-and-stdio-entrypoint-skeleton"
verifiedAt: "2026-07-07T19:12:38.121Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-14T12:18:19.886Z"
archivedAt: "2026-07-14T12:18:19.886Z"
archiveReason: "Epic verified and archived"
archivedFromStatus: "verified"
archivedFromPath: "plans/session-runtime-acp-mvp/02-sessionruntime-core-for-tui-preserved-prompting.md"
---

# SessionRuntime Core for TUI-Preserved Prompting

## Context

This is child FEATURE 02 under the approved `session-runtime-acp-mvp` Epic. Product intent is sourced from ADR-009,
ADR-010, and the parent Epic: RunWield needs ACP and future adapters to be siblings of the TUI over a shared runtime,
not wrappers around `src/shared/interactive/chat-session.js`.

The current codebase already has `SessionHost` as the live HostedSession registry and `HostedSession` as the owner of
session-scoped state. However, the TUI still owns important adapter-neutral turn behavior in `chat-session.js`:
`runScopedSubmitHandoffLoop()` applies pending root swaps, invokes the active HostedSession-bound handler, consumes
`return_to_router` handoffs, enforces the handoff limit, and drains a final root swap after a turn. Several core
workflow modules also import `setActiveAgent()` or `applyPendingRootSwap()` from `chat-session.js`, which means future
ACP runtime usage would accidentally load TUI internals.

This slice should introduce the core `SessionRuntime` seam and migrate the TUI prompt path onto it while preserving the
current terminal behavior. It should not implement ACP prompt streaming, runtime events, runtime interactions, or
session load/replay; those are covered by later sibling child plans.

## Objective

Create `SessionRuntime` as an adapter-neutral façade over `SessionHost` and `HostedSession`, then route the existing TUI
prompt submission and return-to-router handoff loop through that runtime. The TUI should remain visually and
behaviorally unchanged, while core operations such as create/adopt/list/close, prompt, cancel, active handler
invocation, pending root swaps, and handoff limits become reusable by future sibling adapters.

## Approach

Implement `SessionRuntime` by composition over `SessionHost`; do not replace `SessionHost` or turn it into a prompt
orchestrator. Keep `SessionHost` focused on registry/lifecycle and `HostedSession` focused on mutable per-session state.

Extract the shared agent-switching/root-swap operations out of `chat-session.js` into a session-layer helper (for
example `src/shared/session/agent-switching.js`) so runtime, workflow modules, tools, and agent handlers no longer need
to import TUI internals. `chat-session.js` may re-export those functions temporarily for compatibility, but core modules
should import the session-layer helper directly.

`SessionRuntime.promptSession()` should preserve the current `runScopedSubmitHandoffLoop()` semantics exactly:

- apply any pending root swap before each turn;
- read the active handler and root SessionManager from the target `HostedSession` only;
- set the active UI/API adapter object on that HostedSession for the duration of the turn;
- invoke the active handler with `(request, images, uiAPI, rootSessionManager)`;
- consume only that HostedSession's pending switch handoff;
- render handoff notices through the supplied adapter object when available;
- preserve the existing chained handoff limit and warning text;
- always drain one final pending root swap after the outer prompt completes, matching the current TUI `finally` block.

TUI-only responsibilities remain in `chat-session.js`: rendering, keybindings, editor state, slash command input, image
paste/preflight, terminal title, model selector display, steering/queued-message presentation, and visual prompt
widgets. Slash commands remain TUI concerns in this slice; expanded template/skill text should still route through the
same TUI submit function, which now delegates to `SessionRuntime` for the shared prompt turn.

## Files to Modify

- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — update only if the implementation clarifies a permanent
  boundary detail, such as the shared agent-switching helper; preserve the sibling-adapter decision.
- `src/shared/session/session-runtime.js` — new runtime façade with JSDoc typedefs and methods for construction,
  create/adopt/get/list/close, prompt, cancel, and root-swap/handoff orchestration.
- `src/shared/session/agent-switching.js` — new shared session-layer helper for `setActiveAgent()` and
  `applyPendingRootSwap()` semantics currently exported from `chat-session.js`.
- `src/shared/session/session-host.js` — add only host-level helpers needed by `SessionRuntime`; keep prompt
  orchestration out of this module.
- `src/shared/session/hosted-session.js` — add per-session fields only if runtime needs active prompt/cancellation
  metadata; preserve HostedSession-scoped mutable state.
- `src/shared/session/agent-handler.js` — remove the TUI import for `setActiveAgent`; use the session-layer helper so a
  HostedSession-bound handler can be invoked by `SessionRuntime` without loading `chat-session.js`.
- `src/shared/interactive/chat-session.js` — construct a `SessionRuntime` for the TUI's `SessionHost`, delegate the
  submit/handoff loop to it, and keep TUI-only responsibilities local.
- `src/shared/interactive/slash-dispatch.js` — keep slash command behavior independent from runtime prompt turns except
  through the existing `dispatchExpandedUserRequest` callback supplied by `chat-session.js`.
- `src/shared/workflow/orchestrator.js` — replace imports of agent-switching/root-swap helpers from `chat-session.js`
  with the session-layer helper while preserving workflow dispatch behavior.
- `src/shared/workflow/validation.js` — replace the TUI `setActiveAgent` import with the session-layer helper.
- `src/shared/workflow/workflow-slicer.js` — update lazy/type references for `setActiveAgent` so Slicer workflow code
  does not import TUI internals for agent switching.
- `src/tools/return-to-router.js` — replace the TUI `setActiveAgent` import with the session-layer helper and keep the
  existing `pendingSwitchHandoff` behavior.
- `src/shared/session/session-runtime.test.js` — new focused runtime tests for create/adopt/list/close, prompt/handoff,
  handoff limits, cancellation, final root-swap draining, and no cross-session leakage.
- `src/shared/session/session-host.test.js` — update only for any host helper additions.
- `src/shared/session/agent-handler.test.js` — preserve workflow-aware handler behavior when invoked through
  runtime-compatible dependencies.
- `src/shared/interactive/chat-session.test.js` — move or update tests that currently target
  `runScopedSubmitHandoffLoop` so runtime owns the handoff-loop assertions; keep TUI tests for re-export/compatibility
  only if needed.
- `src/shared/interactive/slash-dispatch.test.js` — verify template/skill expansion still delegates to the supplied
  root-submit callback and does not bypass runtime through a fallback path used by the TUI.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-host.js` — keep as the process-local registry/lifecycle owner of HostedSessions.
- `src/shared/session/hosted-session.js` — keep as the owner of all mutable session-scoped runtime state.
- `src/shared/session/session.js` `ensureRootAgentSession()` — use for pending root swaps in the session-layer helper.
- `src/shared/session/session.js` `abortActiveSession()` — use for runtime cancellation.
- `src/shared/session/agent-handler.js` — reuse workflow-aware active agent handling instead of duplicating
  triage/planning/execution/validation logic.
- `src/shared/interactive/chat-session.js` `runScopedSubmitHandoffLoop()` — use current behavior and test expectations
  as the migration source for `SessionRuntime.promptSession()`.
- `src/tools/return-to-router.js` — preserve the existing tool contract: queue Router as the active agent, store the
  handoff reason on the current HostedSession, and terminate the calling turn.

## Implementation Steps

- [ ] Step 1: Add `src/shared/session/agent-switching.js` with pure JavaScript/JSDoc exports for `setActiveAgent()` and
      `applyPendingRootSwap()`, copied from current behavior but depending only on session-layer modules and
      `ensureRootAgentSession()`.
- [ ] Step 2: Update `agent-handler.js`, `workflow/orchestrator.js`, `workflow/validation.js`, `workflow-slicer.js`, and
      `tools/return-to-router.js` to import agent-switching helpers from the session layer instead of
      `interactive/chat-session.js`.
- [ ] Step 3: In `chat-session.js`, import the session-layer helpers and keep any existing named exports needed by
      current tests or callers as compatibility re-exports.
- [ ] Step 4: Implement `SessionRuntime` construction around a supplied or internally created `SessionHost`, with JSDoc
      typedefs for runtime options, prompt options/results, cancel results, and close results.
- [ ] Step 5: Implement runtime create/adopt/get/list/close operations by delegating lifecycle ownership to
      `SessionHost` and preserving HostedSession invariants.
- [ ] Step 6: Implement `SessionRuntime.promptSession()` by moving `runScopedSubmitHandoffLoop()` behavior into the
      runtime, including pending root swap application, active handler lookup, handoff notices, handoff limit
      enforcement, current-session-only handoff consumption, and final root-swap draining in `finally`.
- [ ] Step 7: Implement `SessionRuntime.cancelSession()` using `abortActiveSession(hostedSession)` and any active prompt
      cancellation metadata added in this slice; make it safe for missing/idle sessions.
- [ ] Step 8: Update `chat-session.js` startup to create one `SessionRuntime` around the existing `SessionHost`, then
      update `submitToActiveRoot()` so it appends TUI visual user/image messages itself and calls
      `runtime.promptSession()` for shared turn execution.
- [ ] Step 9: Keep TUI slash-dispatch behavior independent: built-ins still receive TUI dependencies, while
      prompt-template and skill expansions still call `dispatchExpandedUserRequest`, which now reaches runtime through
      `submitToActiveRoot()`.
- [ ] Step 10: Add focused runtime tests with stubbed HostedSessions, handlers, root-swap functions, and UI/API objects
      to prove prompt order, handoff limits, final root-swap draining, cancellation, close, and two-session isolation.
- [ ] Step 11: Update existing chat-session/slash-dispatch/agent-handler tests for the new import locations and ensure
      no behavior regressions.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js`.
- Automated: run `deno test -A src/shared/session/session-host.test.js src/shared/session/agent-handler.test.js`.
- Automated: run
  `deno test -A src/shared/interactive/chat-session.test.js src/shared/interactive/slash-dispatch.test.js`.
- Automated: run focused workflow/tool tests affected by the agent-switching import move, including any tests for
  `src/shared/workflow/orchestrator.js`, `src/shared/workflow/validation.js`, `src/shared/workflow/workflow-slicer.js`,
  and `src/tools/return-to-router.js` if present.
- Automated: run a repository search guard that core session/workflow/tool modules no longer import
  `src/shared/interactive/chat-session.js` for `setActiveAgent` or `applyPendingRootSwap`.
- Automated: run `deno task ci` and fix all issues.
- Manual: run `wld` normally and verify the TUI starts at Router.
- Manual: submit a request that causes Router to hand off to another agent and verify the handoff appears as before.
- Manual: verify `/new`, `/agent router`, `/model`, thinking controls, Esc cancellation, image paste/preflight, and a
  simple prompt still behave as before.
- Manual: exercise a planning flow enough to confirm `plan_written` still opens the existing TUI/browser review path in
  TUI mode.
- Expected result: existing TUI behavior is preserved, core session/workflow modules no longer need TUI imports for
  agent switching/root swaps, and shared prompt/handoff orchestration is available through `SessionRuntime`.

## Edge Cases & Considerations

- This is the highest TUI regression slice; move only session behavior, not rendering or input mechanics.
- ACP modules and runtime code must not import `chat-session.js`; shared helpers should live in runtime or lower-level
  session modules.
- Preserve the existing handoff limit semantics exactly, including the warning text, to avoid accidental infinite
  `return_to_router` chains.
- `SessionRuntime.promptSession()` must consume pending handoffs only from the target HostedSession; sibling sessions'
  pending handoffs must remain untouched.
- Be careful with pending root swaps queued during the final turn; the current TUI drains them after prompt completion.
- Keep `SessionHost` as registry/lifecycle only. Do not turn it into a prompt orchestrator.
- Avoid broad rewrites of slash command behavior; ACP command exposure is not part of this slice.
- Assumption: because this is a child plan under the approved Epic and ADR-010 already establishes the product behavior,
  no additional product clarification is needed for this slice.
