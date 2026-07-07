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
updatedAt: "2026-07-07T02:13:46.228Z"
status: "draft"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 2
dependencies:
    - "01-acp-sdk-and-stdio-entrypoint-skeleton"
---

# SessionRuntime Core for TUI-Preserved Prompting

## Context

The existing TUI already runs through `SessionHost` and `HostedSession`, but `chat-session.js` still owns high-level
turn submission and return-to-router handoff behavior. ACP must not wrap or import TUI internals. Before ACP can execute
real prompts, shared session behavior needs to move behind a reusable `SessionRuntime` layer while preserving the
current terminal experience.

## Objective

Create `SessionRuntime` as the adapter-neutral façade over `SessionHost` and `HostedSession`, and route the TUI's core
prompt submission/handoff behavior through it. The TUI should remain visually and behaviorally unchanged, while core
operations such as create, prompt, cancel, close/list, active handler invocation, pending root swaps, and handoff limits
become reusable by future sibling adapters.

## Approach

Implement `SessionRuntime` as composition over `SessionHost`, not as a replacement. Move or delegate the logic currently
in `runScopedSubmitHandoffLoop()` from `chat-session.js` into runtime-level operations, while keeping TUI-only concerns
in `chat-session.js`: rendering, keybindings, editor state, slash command input, image paste, terminal title, model
selector display, and visual prompt widgets. ACP should not consume the runtime in this slice beyond compile-safe
imports; the acceptance criterion is TUI behavior preserved through the new seam.

## Files to Modify

- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — update only if implementation details clarify the
  accepted boundary; preserve the sibling adapter decision.
- `src/shared/session/session-runtime.js` — new runtime façade with session create/adopt/list/close, prompt submission,
  cancellation, and handoff-loop behavior.
- `src/shared/session/session-host.js` — add only host-level helpers needed by `SessionRuntime`; keep prompt
  orchestration out of `SessionHost`.
- `src/shared/session/hosted-session.js` — add per-session fields only if runtime needs active prompt/cancellation
  metadata or adapter/runtime mode metadata.
- `src/shared/session/agent-handler.js` — ensure HostedSession-bound handlers can be invoked by `SessionRuntime` without
  TUI assumptions.
- `src/shared/interactive/chat-session.js` — delegate shared prompt/handoff behavior to `SessionRuntime` while retaining
  TUI-specific responsibilities.
- `src/shared/interactive/slash-dispatch.js` — ensure slash commands remain TUI concerns and do not become an
  ACP/runtime dependency.
- `src/shared/session/session-runtime.test.js` — add coverage for runtime create/prompt/cancel/close and handoff
  behavior with stubbed handlers.
- `src/shared/session/session-host.test.js` — update for any host helper additions without expanding host
  responsibilities.
- `src/shared/session/agent-handler.test.js` — preserve workflow-aware handler behavior when invoked through
  runtime-compatible dependencies.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-host.js` — keep as the process-local registry/lifecycle owner of HostedSessions.
- `src/shared/session/hosted-session.js` — keep as the owner of all mutable session-scoped runtime state.
- `src/shared/session/agent-handler.js` — reuse workflow-aware active agent handling instead of duplicating
  triage/planning/execution logic.
- `src/shared/interactive/chat-session.js` `runScopedSubmitHandoffLoop()` — use its current behavior as the migration
  source for runtime prompt loops.
- `src/shared/session/session.js` — reuse existing `abortActiveSession`, root session, handoff, and root swap mechanisms
  through HostedSession-bound APIs.

## Implementation Steps

- [ ] Step 1: Define JSDoc typedefs for `SessionRuntime` constructor/options and prompt/cancel/close results in
      `src/shared/session/session-runtime.js`.
- [ ] Step 2: Implement runtime construction around a supplied or internally-created `SessionHost`.
- [ ] Step 3: Implement create/list/close operations that delegate lifecycle ownership to `SessionHost` and preserve
      HostedSession invariants.
- [ ] Step 4: Move/delegate `runScopedSubmitHandoffLoop()` behavior into `SessionRuntime.promptSession`, including
      pending root swap application, active handler lookup, handoff limit enforcement, and final root swap draining.
- [ ] Step 5: Implement runtime cancellation by calling `abortActiveSession(hostedSession)` and aborting any active
      adapter prompt if available.
- [ ] Step 6: Update `chat-session.js` so TUI submit flow appends visual user/image messages itself, then calls
      `SessionRuntime.promptSession` for shared turn execution.
- [ ] Step 7: Keep TUI slash-dispatch behavior independent from runtime prompt turns unless explicitly invoked by the
      TUI adapter.
- [ ] Step 8: Add focused runtime tests using stubbed HostedSessions, handlers, and root swap functions to prove
      handoffs, handoff limits, cancellation, close, and no cross-session leakage.
- [ ] Step 9: Run existing interactive/session/workflow tests and repair regressions.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js`.
- Automated: run `deno test -A src/shared/session/session-host.test.js src/shared/session/agent-handler.test.js`.
- Automated: run existing tests touching `src/shared/interactive/chat-session.js` and slash dispatch if present.
- Automated: run `deno run ci` and fix all issues.
- Manual: run `wld` normally and verify the TUI starts at Router.
- Manual: submit a request that causes Router to hand off to another agent and verify the handoff appears as before.
- Manual: verify `/new`, `/agent router`, `/model`, thinking controls, and a simple prompt still behave as before.
- Manual: exercise a planning flow enough to confirm `plan_written` still opens the existing TUI/browser review path in
  TUI mode.
- Expected result: existing TUI behavior is preserved, but shared prompt/handoff orchestration is now available through
  `SessionRuntime` instead of being owned by `chat-session.js`.

## Edge Cases & Considerations

- This is the highest TUI regression slice; move only session behavior, not rendering or input mechanics.
- ACP modules must not import `chat-session.js`; shared helpers should live in runtime or lower-level session modules.
- Preserve the existing handoff limit semantics to avoid accidental infinite `return_to_router` chains.
- Be careful with pending root swaps queued during the final turn; the current TUI drains them after prompt completion.
- Keep `SessionHost` as registry/lifecycle only. Do not turn it into a prompt orchestrator.
- Avoid broad rewrites of slash command behavior; ACP command exposure is not part of this slice.
