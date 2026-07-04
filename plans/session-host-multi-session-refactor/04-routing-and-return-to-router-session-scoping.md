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
updatedAt: "2026-07-03T18:03:46.155Z"
status: "draft"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 4
dependencies:
    - "tui-single-hosted-session-adapter"
---

# Routing and Return-to-Router Session Scoping

## Context

Router handoff is one of RunWield's most important UX invariants: new requests start at Router, specialist handoffs
persist as the active root agent, and `return_to_router` can queue a root swap plus handoff prompt. Today that path
reads and writes global active agent, pending root swap, pending switch handoff, root agent name, root session, and
active handler state.

After the TUI is backed by one HostedSession, routing and return-to-router must become session-scoped. The key proof is
that routing or return-to-router activity in HostedSession A cannot mutate HostedSession B.

## Objective

Refactor `agent-handler.js`, `orchestrator.js`, and `return-to-router.js` so triage dispatch, post-triage active-agent
selection, root swap application, and pending handoff consumption all target an explicit HostedSession.

## Approach

Thread HostedSession through the workflow-aware active handler, post-triage dispatch, and return-to-router tool
execution. Keep the existing decision logic and routing semantics intact; change only where state is read or written.
Unskip or add isolation tests for return-to-router and triage dispatch.

Intermediate plan execution and validation flows may still be incomplete until the next slice. Any skipped tests for
plan execution or validation must be labeled as owned by the workflow scoping slice.

## Files to Modify

- `src/shared/session/agent-handler.js` — make `createAgentHandler()` produce handlers bound to or invoked with a
  HostedSession; use HostedSession root state for root reuse, pre-turn message counts, pending handoff drain, and active
  workflow lookup.
- `src/shared/workflow/orchestrator.js` — pass HostedSession into `dispatchPostTriage()` and use HostedSession-scoped
  active-agent switching and pending swap application.
- `src/tools/return-to-router.js` — use tool execution context or explicit parameters to locate the current
  HostedSession; record pending handoff and root switch intent on that session only.
- `src/shared/session/agent-handler.test.js` — adapt handler tests to HostedSession context and add isolation assertions
  for stale outcome handling across sessions.
- `src/shared/workflow/orchestrator.test.js` — adapt post-triage dispatch tests to HostedSession state.
- `src/tools/__tests__/return-to-router.test.js` — prove return-to-router mutates only the target HostedSession.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/decisions.js` — reuse existing post-planning and post-execution decision logic unchanged.
- `src/shared/workflow/orchestrator.js` — reuse `normalizeTriageOutcome()`, `buildTriageBlock()`, and session naming
  logic.
- `src/shared/session/agents.js` — reuse agent display-name and definition loading behavior for active-agent switches.
- `src/shared/interactive/chat-session.js` — reuse HostedSession-aware `setActiveAgent()` and `applyPendingRootSwap()`
  from the previous slice.
- `src/tools/return-to-router.js` — preserve current tool result semantics: terminate current turn and deliver `reason`
  as Router's first user message.

## Implementation Steps

- [ ] Step 1: Write or unskip tests proving `return_to_router` in HostedSession A queues Router swap and handoff only in
      A, while HostedSession B remains unchanged.
- [ ] Step 2: Refactor `createAgentHandler()` so root reuse, pre-turn message count, triage outcome handling, plan
      outcome handling, and task completion handling read from the provided HostedSession.
- [ ] Step 3: Refactor `dispatchPostTriage()` to accept HostedSession and to perform active-agent switching and pending
      swap application through HostedSession-aware helpers.
- [ ] Step 4: Refactor `executeReturnToRouter()` and the exported tool to receive or discover the current HostedSession
      from tool/session context rather than global UI state.
- [ ] Step 5: Preserve the UX invariant that `/new` starts at Router and handoff to a specialist persists as the active
      root agent for follow-up turns.
- [ ] Step 6: Keep plan execution/validation tests skipped only when they are blocked on the next slice, and label them
      accordingly.

## Verification Plan

- Automated: run `src/tools/__tests__/return-to-router.test.js` and verify two-session isolation for pending handoff and
  pending root swap.
- Automated: run `src/shared/workflow/orchestrator.test.js` and `src/shared/session/agent-handler.test.js` after
  adapting to HostedSession context.
- Automated: run `deno run ci`; CI must pass with only explicitly justified future-slice skipped tests.
- Manual: in the TUI, submit a request that routes from Router to a specialist and confirm follow-up input stays with
  the specialist; use `/agent router` or a return-to-router path if feasible to confirm the root switch remains visible
  and coherent.
- Expected result: routing and return-to-router state is per HostedSession, with no cross-session mutation.

## Edge Cases & Considerations

- `return_to_router` currently depends on active UI state. Replace that dependency with HostedSession/event-sink context
  so future ACP use does not require TUI globals.
- Root reuse depends on comparing the handler's agent name to the HostedSession's current root agent name. Do not fall
  back to process-global root comparisons.
- Pending handoff consumption must drain only the current HostedSession's handoff, not all sessions.
- Existing routing semantics should not change: this is a scoping refactor, not a routing policy change.
