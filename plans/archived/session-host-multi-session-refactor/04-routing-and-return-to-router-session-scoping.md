---
planId: "cc28596a-966c-480b-ab73-2bf3a9d6ea15"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Make triage dispatch, active agent switching, pending handoff consumption, and the return_to_router tool operate on the current HostedSession without affecting other sessions."
affectedPaths:
    - "src/shared/session/agent-handler.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/tools/return-to-router.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/workflow/orchestrator.test.js"
    - "src/tools/__tests__/return-to-router.test.js"
frontend: false
createdAt: "2026-07-03T18:03:46.155Z"
updatedAt: "2026-07-05T16:21:22.366Z"
status: "verified"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 4
dependencies:
    - "tui-single-hosted-session-adapter"
verifiedAt: "2026-07-05T16:21:22.366Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Routing and Return-to-Router Session Scoping

## Context

Router handoff is one of RunWield's most important UX invariants: new requests start at Router, specialist handoffs
persist as the active root Agent, and `return_to_router` can queue a root swap plus handoff prompt. That behavior is
sourced from the existing TUI behavior, `docs/prd/runwield-acp-session-host-PRD.md`,
`docs/adr/009-session-host-as-external-integration-boundary.md`, and the parent Epic. The intended product behavior is
not changing in this slice.

After the TUI is backed by one `HostedSession`, routing and return-to-router must become session-scoped. The key proof
is that routing or return-to-router activity in HostedSession A cannot mutate HostedSession B. This includes the active
handler/Agent marker, pending root swap, pending switch handoff, root turn reuse, and any handoff drains performed after
sub-agent or workflow activity.

Precondition: this plan assumes the dependency slices have already introduced `HostedSession`, made the core root
runtime accept HostedSession context, and adapted the TUI to hold one current HostedSession. If the execution branch
lacks those APIs, stop and execute or restore dependency slices 01-03 first rather than recreating them inside this
slice.

## Objective

Refactor routing and return-to-router paths so triage dispatch, post-triage active-Agent selection, root swap
application, pending handoff consumption, and `return_to_router` tool execution all target an explicit current
`HostedSession`.

The visible behavior should stay the same for the single TUI session:

- `/new` starts at Router.
- Router triage switches to the chosen specialist.
- Follow-up input stays with that specialist until the user switches Agent or an Agent calls `return_to_router`.
- `return_to_router` terminates the current turn and delivers its `reason` as Router's next user message.

## Approach

Thread `HostedSession` through the workflow-aware active handler, post-triage dispatch, chat handoff loop, and
return-to-router tool execution. Keep the existing routing decisions and handoff semantics intact; change only where
state is read, written, drained, or used to run a root turn.

Use the explicit seam from the dependency slices instead of introducing a production `getCurrentHostedSession()` global.
A practical implementation shape is:

- `createAgentHandler(agentName, { hostedSession, ...deps })` closes over the current HostedSession and returns the
  existing message-handler callback shape.
- `dispatchPostTriage({ hostedSession, triage, ... })` uses HostedSession-bound `setActiveAgent()`,
  `applyPendingRootSwap()`, `runRootTurn()`, and planning/execution entry points where needed.
- `executeReturnToRouter({ reason }, { hostedSession, uiAPI }, deps)` or an equivalent explicit options object queues
  Router state on the supplied HostedSession only.
- `session.js` auto-wiring for the `return_to_router` custom tool closes over the same HostedSession used by the root
  AgentSession, rather than falling back to active UI/global session state.
- The TUI submission loop consumes pending switch handoffs from the current HostedSession only.

Intermediate plan execution and validation flows may still be incomplete until child FEATURE 05. Any skipped tests for
plan execution or validation must be labeled as owned by `05-workflow-execution-and-validation-session-scoping`; tests
for routing, active-Agent switching, return-to-router, and handoff consumption belong to this slice and should be
enabled.

## Files to Modify

- `src/shared/session/agent-handler.js` — bind created handlers to the current HostedSession; use HostedSession root
  state for root reuse, pre-turn message counts, triage outcome handling, plan outcome handling that remains in scope,
  task-completion reads that can be safely scoped now, and current-session handoff drains.
- `src/shared/session/session.js` — update `return_to_router` auto-wiring to pass the current HostedSession/tool context
  into `executeReturnToRouter()`; avoid `getActiveUiAPI()` or any process-global fallback when wiring a root session's
  tool implementation.
- `src/shared/interactive/chat-session.js` — ensure the current TUI HostedSession is passed into `createAgentHandler()`
  and `dispatchPostTriage()` paths, and consume pending switch handoffs from only that HostedSession in the submit loop.
- `src/shared/workflow/orchestrator.js` — require/pass HostedSession in `dispatchPostTriage()` and perform active-Agent
  switching, pending root swap application, root turns, and handoff drains through HostedSession-aware helpers.
- `src/tools/return-to-router.js` — make the core tool logic receive the current HostedSession explicitly; record
  pending handoff and root switch intent on that session only while preserving the terminate/details result shape.
- `src/shared/session/agent-handler.test.js` — adapt handler tests to HostedSession context and add isolation assertions
  for stale outcome handling across sessions.
- `src/shared/interactive/chat-session.test.js` — add or unskip coverage for submit-loop pending handoff consumption
  against the current HostedSession, including a second HostedSession with a pending handoff that must remain untouched.
- `src/shared/workflow/orchestrator.test.js` — adapt post-triage dispatch tests to HostedSession state and prove
  switches/root turns target only the supplied HostedSession.
- `src/tools/__tests__/return-to-router.test.js` — prove return-to-router mutates only the target HostedSession and no
  longer depends on global active UI/session state.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/hosted-session.js` — reuse HostedSession accessors for active handler, root SessionManager, root
  Agent name/session, pending root swap, pending switch handoff, active UI/event sink, and active workflow metadata
  where available.
- `src/shared/interactive/chat-session.js` — reuse HostedSession-aware `setActiveAgent(hostedSession, ...)` and
  `applyPendingRootSwap(hostedSession, ...)` introduced by the TUI adapter slice.
- `src/shared/session/session.js` — reuse HostedSession-aware `runRootTurn()`/`runAgentSession()` and the existing
  custom-tool auto-wiring pattern for declarative agent frontmatter tools.
- `src/shared/workflow/decisions.js` — reuse existing post-planning and post-execution decision logic unchanged.
- `src/shared/workflow/orchestrator.js` — reuse `normalizeTriageOutcome()`, `buildTriageBlock()`, and session naming
  logic.
- `src/shared/session/agents.js` — reuse agent display-name and definition loading behavior for active-Agent switches.
- `src/tools/return-to-router.js` — preserve current tool result semantics: terminate current turn and deliver `reason`
  as Router's first user message.

## Implementation Steps

- [ ] Step 1: Add or unskip `return_to_router` tests that create two Hosted Sessions, execute the tool in HostedSession
      A, and assert A receives Router pending root swap + pending handoff while B's active handler, pending root swap,
      and pending handoff remain unchanged.
- [ ] Step 2: Add or unskip submit-loop tests proving the chat handoff loop consumes only the current HostedSession's
      pending switch handoff, preserves the existing chained-handoff limit, and does not drain another session's queued
      handoff.
- [ ] Step 3: Refactor `executeReturnToRouter()` and the exported tool wiring so the current HostedSession is supplied
      explicitly from the root session/tool construction context. Keep the no-session error clear, but remove reliance
      on `getActiveUiAPI()` or `session-state.js` for production execution.
- [ ] Step 4: Refactor `session.js` return-to-router auto-wiring to close over the current HostedSession and pass its
      active UI/event sink into tool logic where the UI is still needed for visible render requests.
- [ ] Step 5: Refactor `createAgentHandler()` so root reuse, pre-turn message counts, triage outcome handling, scoped
      handoff drains, and follow-up active-Agent changes read from the bound HostedSession rather than process globals.
      Keep broad active-execution-workflow migration deferred to child FEATURE 05 if not already available.
- [ ] Step 6: Refactor `dispatchPostTriage()` to accept HostedSession and call HostedSession-aware `setActiveAgent()`,
      `applyPendingRootSwap()`, `runRootTurn()`, `runPlanningAgent()`, `runMechanicalValidation()`, `executePlan()`, and
      validation helpers where their current signatures require session context. Do not change routing policy.
- [ ] Step 7: Update all `createAgentHandler()` call sites touched by this flow so handlers for Router, Guide, Ideator,
      Operator, Engineer, Planner, and Architect are created with the current HostedSession.
- [ ] Step 8: Preserve the UX invariant that `/new` starts at Router and handoff to a specialist persists as the active
      root Agent for follow-up turns.
- [ ] Step 9: Remove or replace remaining production imports of `getActiveUiAPI()`, `getRootAgentName()`,
      `getRootAgentSession()`, `consumePendingSwitchHandoff()`, `setPendingSwitchHandoff()`, or other singleton
      session-state helpers from the files owned by this slice, except where a later-slice skip explicitly names the
      remaining workflow owner.
- [ ] Step 10: Keep plan execution/validation tests skipped only when they are blocked on child FEATURE 05, and label
      them accordingly.

## Verification Plan

- Automated: run focused return-to-router tests: `deno test -A src/tools/__tests__/return-to-router.test.js`.
- Automated: run focused routing/handler/chat tests:
  `deno test -A src/shared/workflow/orchestrator.test.js src/shared/session/agent-handler.test.js src/shared/interactive/chat-session.test.js`.
- Automated: search the slice-owned production files for old singleton access in the routing/return-to-router path, for
  example
  `grep -R "getActiveUiAPI\|setPendingSwitchHandoff\|consumePendingSwitchHandoff\|getRootAgentName\|getRootAgentSession" src/shared/session/agent-handler.js src/shared/session/session.js src/shared/interactive/chat-session.js src/shared/workflow/orchestrator.js src/tools/return-to-router.js`,
  and verify any remaining matches are legacy comments or explicitly deferred workflow cleanup.
- Automated: run `deno task ci`; CI must pass with only explicitly justified future-slice skipped tests.
- Manual: in the TUI with model credentials available, submit a request that routes from Router to a specialist and
  confirm follow-up input stays with the specialist.
- Manual: use `/new` and confirm the fresh session starts at Router without inheriting a previous specialist handoff.
- Manual: trigger `return_to_router` if feasible, or exercise an equivalent test seam, and confirm the Router receives
  the tool `reason` as the next user message while the active root switches coherently.
- Expected result: routing and return-to-router state is per HostedSession, with no cross-session mutation and no
  visible behavior change for the single TUI session.

## Edge Cases & Considerations

- This is a scoping refactor, not a routing policy change. Do not change which Routing Intent maps to which Agent, when
  mechanical validation runs, or how plan execution decisions are interpreted.
- Do not introduce a production singleton such as `getCurrentHostedSession()` to make migration easier; that would
  violate ADR-009 and preserve the single-session assumption.
- `return_to_router`'s `reason` remains the exact next user message for Router. Preserve `terminate: true`, empty
  content, and `{ agentName, reason }` details.
- Pending handoff consumption must drain only the current HostedSession's handoff. This applies both to the interactive
  chained-handoff loop and to any post-sub-agent drains that intentionally discard switch requests.
- Root reuse depends on comparing the handler's Agent name to the current HostedSession's root Agent name. Do not fall
  back to process-global root comparisons.
- Session naming and terminal-title updates are TUI-visible behavior; keep existing `sessionName` sanitization and title
  update behavior, but route it through the current HostedSession/TUI adapter context.
- Workflows still have a dedicated follow-up slice. If handler or orchestrator code touches active execution workflow
  state, scope what is straightforward now but avoid redesigning plan execution/validation state in this plan.
- Keep all implementation in pure JavaScript with JSDoc typedefs; do not introduce TypeScript syntax or `.ts` files.
