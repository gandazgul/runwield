---
planId: "1d626bc7-e1de-4efc-b427-df70239333a3"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Deliver live steering messages to the current foreground Agent Session, including Reviewer and delegated sessions, at the earliest safe tool boundary."
affectedPaths:
    - "CONTEXT.md"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/early-steering.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/early-steering.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T12:10:11-04:00"
updatedAt: "2026-07-27T16:42:33.594Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-27T16:26:46.211Z"
verifiedAt: "2026-07-27T16:42:22.083Z"
userVerifiedAt: null
executionReport: "- Implemented foreground steering target stack in `HostedSession`, root/isolated session push-pop lifetimes, and active-target steering while preserving root-only helpers.\n- Added early steering interruption guard that forces sequential tool execution and skips later requested tools when steering is pending.\n- Updated `SessionRuntime` steering/queue source handling, documentation terminology, and targeted session tests.\n- Verification passed: `deno test -A src/shared/session/early-steering.test.js src/shared/session/session-runtime.test.js src/shared/session/session-prompt.test.js src/shared/session/session-catalog.test.js`.\n- Verification passed: `deno task ci` (one intermediate run hit a transient cwd cleanup failure in `settings.test.js`; immediate rerun passed cleanly)."
workRecord:
    status: "generated"
    recordId: "114c6d68-3d33-48b1-b7fc-c36a8a54f9ab"
    path: "docs/work-records/2026-07-27-early-foreground-steering-delivered.md"
    lastAttemptAt: "2026-07-27T16:42:27.488Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "afcba678c644bf77254b8bc5d309f8f6f0ea8257"
    targetBranch: "main"
    targetHeadBeforeMerge: "209632a099444fb09eb694d807fc9e6bcd273f3b"
---

# Early Foreground Steering Delivery

## Context

The user wants messages submitted while an Agent Session is already streaming to reach the active worker much earlier,
especially during Semantic Reviewer validation. Today RunWield accepts the steering message quickly, but effective
delivery has two delays:

1. `SessionRuntime.steerSession()` only targets `hostedSession.getRootAgentSession()`. Semantic Reviewer validation is
   intentionally run through `runIsolatedAgentSession()` with a fresh in-memory session so its judgment is isolated from
   the workflow transcript. That isolated Reviewer is registered as a sub-agent session, not the root Agent Session, so
   live user steering can miss the visible Reviewer and remain aimed at the previous root agent.
2. Pi's current steering contract drains steering after the current assistant turn finishes all tool calls already
   requested by the model. In the current low-level loop, multiple tool calls can run as one batch, and default tool
   execution is parallel. That means a steering message submitted during a long tool batch may not be injected until
   every tool in that batch has completed.

Repository evidence:

- `src/shared/session/session-runtime.js#steerSession()` uses `hostedSession.getRootAgentSession()` and
  `steerRootSessionWithTarget()`.
- `src/shared/session/session.js#steerRootSessionWithTarget()` explicitly steers only the root Agent Session.
- `src/shared/session/session.js#runIsolatedAgentSession()` registers transient sessions with
  `hostedSession.addSubAgentSession(session)` and uses them for isolated work such as Reviewer validation.
- `src/shared/workflow/validation.js` invokes Reviewer through `runIsolatedAgentSessionImpl()` without the shared
  SessionManager so each review attempt starts from clean context.
- `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` drains `getSteeringMessages()` after `turn_end`, not
  after each individual requested tool call, and default `Agent.toolExecution` is `parallel`.
- Existing Work Records show prior steering work already made queue state core-owned and visual feedback two-phase; this
  Plan preserves that behavior while changing the target and safe delivery boundary.

The user confirmed the desired policy: make steering earlier for Reviewer and also for delegated/sub-agent sessions, not
only root sessions.

## Objective

Build foreground steering delivery so that a user message submitted during streaming:

- targets the current foreground, visible Agent Session rather than only the root Agent Session;
- reaches Semantic Reviewer and other delegated/sub-agent sessions while they are the active visible worker;
- finishes the currently running tool safely, but avoids executing later already-requested tools when steering is
  pending;
- injects the steering message before the next provider call so the model can reconsider its next actions with the
  user's input;
- preserves existing queued-message lifecycle events, visual feedback, image handling, Up-arrow dequeue behavior, and
  fallback-to-next-turn behavior.

## Approach

Introduce a small shared steering module and a foreground steering target in `HostedSession`:

1. Track the current steerable foreground Agent Session as a stack. Root sessions remain steerable. Transient foreground
   sessions pushed by `runIsolatedAgentSession()` become the steering target while active. This makes Reviewer steerable
   even though it remains context-isolated and in-memory.
2. Change `SessionRuntime.steerSession()` to resolve the active steerable target instead of hard-coding the root Agent
   Session. Keep the core-owned queued message source as the actual session that accepted the steer call so consumption
   reconciliation continues to work for root and sub-agent sessions.
3. Preserve the existing root-specific `steerRootSession*` exports for callers/tests that deliberately need root-only
   behavior, but add a new active-target steering path for Runtime use.
4. Install an early-steering guard on every built Agent Session. The guard sets Pi's low-level `agent.toolExecution` to
   `sequential` so there is a real boundary between requested tool calls. It wraps `agent.beforeToolCall` and, when a
   steering message is already pending before a later tool starts, blocks that tool with a clear result such as:
   `Skipped because user steering is pending; reconsider after reading the user message.` After the turn ends, Pi drains
   the steering queue and injects the user's message before the next provider call.
5. Do not abort in-flight tools or cancel a currently streaming provider response. The earliest safe boundary is after
   the current provider response and after the currently executing tool result is finalized, before the next requested
   tool begins.

This intentionally trades some parallel-tool throughput for responsiveness. The change applies to root, Reviewer, and
delegated/sub-agent Agent Sessions because the user explicitly wants Reviewer steering and accepted sub-agent coverage.

## Files to Modify

- `CONTEXT.md` — add a concise definition for Steering Message / live steering behavior and its relationship to
  foreground Agent Sessions.
- `src/shared/session/hosted-session.js` — add foreground steering target stack state and methods, e.g.
  `pushSteeringTargetSession(session)`, `popSteeringTargetSession(id)`, and `getActiveSteeringTargetSession()`.
- `src/shared/session/session.js` — install the early-steering guard in `buildAgentSession()`; push/pop steering targets
  for root and isolated sessions; add active-target steering helper while preserving root-only helper behavior.
- `src/shared/session/session-runtime.js` — resolve and subscribe to the active steering target, not only the root; keep
  queued message transitions source-session-specific.
- `src/shared/session/early-steering.js` — new focused helper module for installing the sequential tool boundary and
  pending-steering `beforeToolCall` guard.
- `src/shared/session/session-runtime.test.js` — cover Runtime steering to active sub-agent/Reviewer-like sessions,
  queue reconciliation, and fallback when the foreground target stops streaming.
- `src/shared/session/session-catalog.test.js` — preserve root-only steering helper expectations and add active-target
  helper coverage if exported.
- `src/shared/session/session-prompt.test.js` — cover `runIsolatedAgentSession()` pushing/popping steerable foreground
  targets around delegated/Reviewer-like work.
- `src/shared/session/early-steering.test.js` — cover low-level tool-batch behavior: current tool completes, later tools
  are skipped, queued steering is injected before the next model call.

## Reuse Opportunities

Existing functions, modules, and contracts to reuse:

- `src/shared/session/session-runtime.js#trackQueuedMessage()` and `#reconcileQueuedMessages()` — retain core-owned
  queued-message lifecycle and source-session reconciliation.
- `src/shared/session/session.js#steerRootSessionWithTarget()` — reuse image preparation and model fallback behavior
  when implementing active-target steering.
- `src/shared/session/hosted-session.js#pushAgentInfo()` / `popAgentInfo()` — mirror the existing foreground agent
  display stack pattern for steering target ownership.
- `src/shared/session/session.js#runIsolatedAgentSession()` — already has the correct lifetime boundary for transient
  Reviewer/delegated sessions; add steering-target push/pop in its existing `try/finally`.
- Pi `Agent.toolExecution` and `Agent.beforeToolCall` public runtime properties — provide the available safe boundary
  without changing Pi dependencies.
- Existing fake steering session helpers in `src/shared/session/session-runtime.test.js` — extend them to model root and
  sub-agent targets.

## Implementation Steps

- [ ] Step 1: Update `CONTEXT.md` with implemented steering terminology.
  - Add a concise entry for **Steering Message** near the Agent Session/runtime terms.
  - Define it as a user message submitted while an Agent Session is streaming, routed to the current foreground
    steerable Agent Session and injected at the next safe boundary.
  - Mention that the current tool is allowed to finish, but later pending tool calls may be skipped so the Agent can
    reconsider with the user's input.

- [ ] Step 2: Add a foreground steering target stack to `HostedSession`.
  - Store stack entries with stable IDs and session references.
  - Add `pushSteeringTargetSession(session)` returning an ID, `popSteeringTargetSession(id)`, and
    `getActiveSteeringTargetSession()`.
  - Ensure `dehydrateManagedSession()` and `dispose()` clear the stack.
  - Keep the methods generic over existing `DisposableLike`/AgentSession-like objects and avoid TypeScript syntax.

- [ ] Step 3: Add `src/shared/session/early-steering.js`.
  - Export `installEarlySteeringInterruption(session, options = {})` or equivalent.
  - Use JSDoc typedefs only.
  - If `session.agent` exists, set `session.agent.toolExecution = "sequential"` to force between-tool boundaries.
  - Wrap any existing `agent.beforeToolCall` and preserve its blocking/error behavior.
  - Before starting each tool, check `session.getSteeringMessages?.()` for pending steering. If steering is pending,
    return
    `{ block: true, reason: "Skipped because user steering is pending; reconsider after reading the user message." }`
    unless the existing hook already blocks with its own reason.
  - Avoid checking follow-up messages; follow-up delivery should still wait until the Agent would otherwise stop.
  - Make installation idempotent using a module-local `WeakSet`/`WeakMap` so multiple setup paths do not double-wrap
    hooks.

- [ ] Step 4: Install the early-steering guard for all built Agent Sessions.
  - In `buildAgentSession()`, after `createAgentSession()` and before returning, call the installer for the new
    `session`.
  - Ensure this applies to root sessions, Reviewer, and delegated/sub-agent sessions because all use
    `buildAgentSession()`.
  - Do not install for arbitrary test stubs that lack `agent`.

- [ ] Step 5: Route Runtime steering to the active foreground target.
  - Add an active-target helper in `session.js`, e.g. `steerActiveSessionWithTarget(hostedSession, text, images)`.
  - Reuse existing image preparation logic by extracting a private helper that takes a concrete AgentSession-like
    target.
  - Resolve target order as: `hostedSession.getActiveSteeringTargetSession()` if streaming, otherwise root Agent Session
    if streaming, otherwise no live steering.
  - Keep `steerRootSession()` and `steerRootSessionWithTarget()` root-only for compatibility and targeted tests.
  - Update `SessionRuntime` dependency injection names/types from `steerRootSessionWithTarget` to the new active helper
    while preserving testability.

- [ ] Step 6: Push/pop steering targets through root and isolated lifetimes.
  - In `ensureRootAgentSession()`, after committing a root Agent Session, push or reset the root steering target so root
    prompts remain steerable.
  - When replacing a root session, remove its previous steering stack entry to avoid stale targets.
  - In `runIsolatedAgentSession()`, push the transient session as a steering target after it is registered/presented and
    pop it in the existing `finally` before disposal.
  - If parallel delegated sessions can overlap, use stack IDs so each `finally` removes only its own entry and the most
    recently foregrounded live session wins.

- [ ] Step 7: Update queue source subscription behavior in `SessionRuntime`.
  - In `steerSession()`, get the current active steering target and verify `isStreaming` before steering.
  - Subscribe to `queue_update` on the actual source session returned by the active-target helper.
  - Continue tracking `message.sourceSession` so `#reconcileQueuedMessages()` consumes only messages from the session
    that emitted the update.
  - If the foreground target changes or stops streaming before `steer()` accepts, fall back to next-turn queue as
    existing TUI behavior expects.

- [ ] Step 8: Add targeted tests.
  - Add `early-steering.test.js` with a fake Pi `Agent`/stream/tool setup that returns multiple tool calls. During the
    first tool, enqueue steering. Assert only the first tool executes, later requested tools receive skipped/error
    results, and the next provider call includes the steered user message before any further assistant action.
  - Extend `session-runtime.test.js` so a streaming sub-agent/Reviewer-like session is steered before a streaming root
    session, queue events are emitted for that source session, and consumption transitions to a normal user message when
    that source emits `queue_update`.
  - Extend `session-prompt.test.js` so `runIsolatedAgentSession()` pushes and pops the steerable target even when the
    run errors or is aborted.
  - Preserve existing tests proving non-streaming targets fall back to next-turn queue and image preparation still
    works.

- [ ] Step 9: Update comments and adapter expectations.
  - Replace comments that say sub-agent sessions are intentionally excluded from steering with the new foreground-target
    policy.
  - Keep TUI behavior unchanged at the call site: streaming submissions still call `sessionRuntime.steerSession()`, so
    this stays Runtime-owned and adapter-neutral.

## Verification Plan

- Automated:
  - `deno test -A src/shared/session/early-steering.test.js src/shared/session/session-runtime.test.js src/shared/session/session-prompt.test.js src/shared/session/session-catalog.test.js`
  - `deno task ci`
- Manual:
  - Start a workflow that reaches Semantic Reviewer validation.
  - While Reviewer is actively using read-only tools, type a steering message such as
    `Focus on the migration edge case first`.
  - Confirm the TUI immediately shows the steering block, then converts it to a normal user message when consumed by
    Reviewer.
  - Confirm Reviewer responds to the steering before continuing additional tool exploration where there are pending tool
    calls.
  - Try the same during a normal root Agent Session and during a delegated agent session; confirm the current visible
    worker receives the message.
- Expected results:
  - The currently running tool is not aborted.
  - Later tool calls already requested in the same assistant batch are skipped with a clear tool result once steering is
    pending.
  - The steering message is injected before the next provider call.
  - Follow-up/next-turn queued messages keep their existing behavior.
  - Image steering still uses existing model capability and fallback handling.
  - `CONTEXT.md` describes the implemented steering behavior and does not document unimplemented provider-stream
    interruption.

## Edge Cases & Considerations

- Sequential tool execution may slow independent tool batches. This is the intentional cost of creating a safe
  between-tool steering boundary.
- If a provider is still streaming an assistant response or one long-running tool is active, RunWield cannot safely
  inject steering until that response/tool finishes. The feature improves the next safe boundary, not mid-token or
  mid-tool cancellation.
- Blocking later tool calls produces tool-result messages the model will see. The skip reason must be clear and
  non-alarming so the model treats it as a request to reconsider, not as repository failure.
- Multiple overlapping delegated sessions can make “current foreground” ambiguous. The stack-based policy selects the
  most recently foregrounded live Agent Session; tests should lock this behavior down.
- Reviewer context isolation must remain intact: making Reviewer steerable must not give it the root Session transcript
  or shared SessionManager.
- Existing `steerRootSession*` exports should remain root-only to avoid surprising internal callers that depend on the
  old meaning.
- If Pi later exposes first-class per-tool steering or an official AgentSession option for this behavior, RunWield can
  replace the local guard with that public API while keeping the foreground-target policy.
