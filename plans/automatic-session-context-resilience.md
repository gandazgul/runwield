---
classification: "FEATURE"
complexity: "HIGH"
summary: "Prevent avoidable context-window overflow by monitoring active Agent Sessions, compacting at safe internal turn boundaries, and continuing the same assignment safely."
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/shared/session/session-context-resilience.js"
    - "src/shared/session/session-context-resilience.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/session-subscribers.test.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/abort-active-session.test.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-runtime-events.test.js"
    - "src/shared/session/types.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/tools/delegate-agent.js"
    - "src/tools/__tests__/delegate-agent.test.js"
    - "src/cmd/compact/index.js"
    - "src/cmd/compact/index.test.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/runtime-adapter.test.js"
    - "src/acp/event-mapper.js"
    - "src/acp/server.test.js"
    - "docs/sessions.md"
frontend: false
createdAt: "2026-07-20T23:46:14-04:00"
updatedAt: "2026-07-21T17:06:39.007Z"
status: "ready_for_work"
origin: "internal"
---

# Automatic Session Context Resilience

## Context

RunWield currently prevents one overflow path in `compactBeforePromptIfNeeded()` by estimating the resident Agent
Session context plus the prepared User Request before calling Pi. Pi 0.80.5 also performs threshold and overflow
compaction, but its `_handlePostAgentRun()` check runs only after a complete autonomous model/tool chain. A long
execution, validation repair, research, or delegated Agent Session can therefore cross the model context window between
the initial User Request and Pi's post-run check.

Pi core already defines a `shouldStopAfterTurn` loop hook that runs after an assistant response and its tool results but
before queue polling or another provider call. Neither RunWield's pinned Pi 0.80.5 nor the latest inspected 0.80.10
release publicly exposes and wires that hook through `AgentSession`; upstream issue
<https://github.com/earendil-works/pi/issues/4325> tracks the same long-tool-loop compaction gap. Calling `abort()` from
a Pi `turn_end` subscriber is not an acceptable substitute because it can start an aborted provider call, persist an
aborted assistant message, or deadlock settlement.

`docs/prd/session-context-resilience-prd.md` defines the intended Core behavior: monitor active Agent Sessions at
bounded internal turn boundaries, compact early, continue the same assignment, prevent ineffective retry loops, preserve
cancellation and Runtime ownership, and give TUI and ACP the same semantic outcomes. The user chose an upstream-first
architecture with no private Pi workaround. This Plan is therefore suitable for approval-for-later but is blocked until
a released Pi interface satisfies the dependency contract below.

The user also chose to derive trigger, recovery, and re-arm behavior from the active model context window and Pi's
existing effective `compaction.reserveTokens`, without introducing competing percentage settings.

## Objective

After the public Pi prerequisite is available, add automatic context resilience for root and transient Agent Sessions.
RunWield will detect pressure at a completed internal turn, prevent another provider request, serialize automatic
compaction per Hosted Session, verify recovered headroom, and continue the same assignment without a second User Request
or workflow dispatch. Failed or ineffective recovery must pause automatic intervention and leave the Session usable and
cancelable with actionable status instead of causing a compaction loop or provider context-window error.

## Approach

Treat the public Pi release as a hard execution prerequisite. The released interface must let RunWield, without private
property/method access:

- evaluate or request a graceful stop after a completed internal turn and before queue polling or another provider call;
- preserve the completed assistant response and all tool results without an aborted transcript artifact;
- run automatic compaction with normal Pi summaries and `threshold` lifecycle events;
- inspect `tokensBefore`, `estimatedTokensAfter`, cancellation, and failure before deciding whether to continue;
- continue from the compacted context through a supported Agent Session operation while preserving steering/follow-up
  ordering and Agent Session settlement; and
- suppress continuation after cancellation, failed recovery, or unsafe post-compaction pressure.

If the first candidate Pi release exposes only a low-level stop callback but not enough supported Agent Session control
to satisfy recovery and queue-ordering tests, this Plan remains blocked. Do not patch `Agent.createLoopConfig()`, call
`_runAutoCompaction()`, call `agent.continue()` around `AgentSession`, or otherwise replace the missing public contract
with private access. Once a qualifying release exists, upgrade the related `@earendil-works/pi-*` packages together and
capture the dependency contract in a no-network characterization test before integrating it.

Create a deep `session-context-resilience.js` module at the Agent Session/Runtime seam. Its small interface will accept
an Agent Session, Hosted Session arbiter, cancellation signal, and semantic event sink; observe the public Pi lifecycle;
and wrap one RunWield Agent invocation from pre-request pressure checking through any compact-and-continue cycles.
`session.js` remains responsible for Agent construction and subscription, while the new module owns the context-health
state machine. A Hosted-Session-level arbiter coordinates all root and concurrent transient Agent Sessions so only one
manual or automatic compaction can run for that Hosted Session; each Agent Session retains its own pressure/pause state.

For context window `W` and effective reserve `R`, use the user-approved policy:

- trigger threshold `T = max(0, W - R)`; pressure exists only when context tokens are strictly greater than `T`,
  matching Pi's exported `shouldCompact()` behavior;
- minimum recovery `M = min(R, floor(T / 2))`;
- safe re-arm band `S = max(0, T - M)`; paused monitoring re-arms when usage is less than or equal to `S`.

A compaction is effective only when Pi reports finite non-negative `tokensBefore` and `estimatedTokensAfter`, the
estimate lands at or below `T`, and it recovers at least `M` tokens (or makes strict progress when `M` is zero). Before
an initial User Request, include its estimated tokens when checking both the trigger and post-compaction safety. An
effective pre-request compaction then submits the original prepared request exactly once; it emits
`compacting(threshold), compacted(threshold)` but no continuation events or internal continuation entry because the
assignment has not started. If the prepared request alone exceeds `T` even against an empty history, skip compaction,
stop before provider submission, and emit only `paused(oversized_request)`. If the request can fit alone but attempted
compaction leaves total estimated context above `T` or recovers less than `M`, emit
`compacting(threshold), ineffective(insufficient_recovery), paused(insufficient_recovery)` and do not submit it. A
compaction error instead emits `compacting(threshold), failed(compaction_failed), paused(compaction_failed)`.

After failed or ineffective compaction, pause automatic intervention for that Agent Session. Recompute `W`, `R`, `T`,
`M`, and `S` whenever the public Pi model identity, model context window, compaction enabled flag, or reserve-token
value changes. Re-arm only when measured usage or a manual-compaction estimate is at or below the recomputed `S`; a
model or settings change does not re-arm by itself if pressure remains unsafe.

On effective recovery, continue with an internal custom message having `customType:
"runwield_context_continuation"`,
`display: false`, no details payload, and fixed content telling the Agent to rely on the compaction summary, continue
the same assigned work, and avoid repeating unchanged discovery. The entry may persist privately in the Session
Transcript as model context, but must not emit a Runtime `USER_MESSAGE`, appear as user-authored replay, rerun the Agent
Handler, restart Router Triage, change the active Agent, release Runtime busy state, or advance Plan Lifecycle. Use the
public Pi continuation/queue interface atomically: user steering and follow-up messages already queued at the
continuation decision point retain their native order ahead of the internal continuation; no message may be duplicated
or dropped.

A recoverable context stop is not a provider/runtime error. After emitting `context_resilience: paused`, `runPrompt()`
throws a typed internal `ContextResiliencePaused` outcome rather than returning a message array that could contain stale
workflow tool outcomes. For a root Agent, `agent-handler.js` catches only that typed outcome before scanning messages
and returns `{ kind: "context_paused" }`; the Agent turn result union includes that kind, `promptSession()` treats it as
a non-handoff terminal outcome and settles with `ok: true`, the active Agent and any In-Progress Plan remain unchanged,
and the next User Request is accepted. No Router, triage, Plan, or task-completion outcome is read from the partial
turn.

A transient Delegated Agent Session cannot remain available after its foreground tool call settles: the same typed pause
outcome reaches `delegate_agent`, which maps it to one deterministic `isError: true` tool result with
`details.error: "context_resilience_paused"`; the child is disposed, the parent Agent Session remains active, and
partial child text is not reported as a successful handoff. Unexpected implementation errors still use the existing
`TERMINAL_ERROR` path.

User cancellation preserves existing RunWield semantics: it clears all queued user steering/follow-up messages and any
still-queued internal continuation, emits the existing queued-message dequeue events, emits exactly one `CANCELLATION`,
emits context `canceled` at most once, never emits `TERMINAL_ERROR`, and wins every race against compaction or
continuation. Once the private internal continuation entry has been persisted and its provider turn has started,
cancellation aborts that active turn and preserves the transcript entry; it does not require unsupported transcript
rollback, and no later continuation/provider call may start. Manual `/compact` and automatic intervention share the
Hosted Session arbiter. A manual request acquires the lease when free; if any automatic or manual compaction already
owns it, the command returns immediately with `{ ok: false, error: "compaction_in_progress" }` and starts no second
compaction. Automatic waiters remain FIFO and remeasure after acquiring the released lease.

## Files to Modify

- `deno.json` — after the prerequisite release, update the related Pi package constraints to one compatible released
  family that provides the required public Agent Session lifecycle.
- `deno.lock` — lock the verified Pi release family; do not execute unrelated dependency upgrades.
- `src/shared/session/session-context-resilience.js` — add the pure derived-threshold policy, Hosted Session arbiter,
  per-Agent Session state machine, public Pi lifecycle integration, continuation message, overlap guard, recovery
  measurement, and pause/re-arm behavior.
- `src/shared/session/session-context-resilience.test.js` — characterize the released public Pi contract and cover the
  policy, state machine, long autonomous run, compaction serialization, queue ordering, continuation, pause, and re-arm.
- `src/shared/session/session.js` — replace the standalone pre-request helper with the coordinator, route relevant
  public Pi events into it, run root/transient prompts through one resilient path, and make the shared abort helper
  cancel streaming and compaction for root and transient Agent Sessions.
- `src/shared/session/session-prompt.test.js` — verify pre-request estimation, fail-before-provider behavior, internal
  continuation, no duplicate User Request/routing, and ordinary behavior below threshold.
- `src/shared/session/session-subscribers.test.js` — verify completed-turn observation and canonical context-resilience
  emission without duplicate generic compaction statuses.
- `src/shared/session/hosted-session.js` — own the shared manual/automatic compaction arbiter and active-turn
  cancellation state for one Hosted Session.
- `src/shared/session/hosted-session.test.js` — cover arbiter exclusivity, active-turn cancellation/settlement,
  disposal, and isolation between Hosted Sessions.
- `src/shared/session/abort-active-session.test.js` — verify the shared abort path handles streaming and compaction for
  root and every registered transient Agent Session without duplicate aborts.
- `src/shared/session/session-runtime.js` — make `cancelSession()` cancel the active Runtime turn and the Hosted Session
  intervention while preserving turn settlement and busy-state invariants.
- `src/shared/session/session-runtime.test.js` — cover cancellation races, recoverable paused settlement, busy-state
  continuity, root/transient parity, and independent Hosted Session progress.
- `src/shared/session/session-runtime-events.js` — add one canonical `context_resilience` event with validated status,
  reason, message, and content-free pressure/recovery fields.
- `src/shared/session/session-runtime-events.test.js` — enforce the new event's exact required fields/enums and producer
  payload allowlist.
- `src/shared/session/types.js` — add a `context_paused` Agent turn result so recoverable pressure is distinguishable
  from normal completion and handoff without becoming a provider/runtime error.
- `src/shared/session/agent-handler.js` — catch only `ContextResiliencePaused` before inspecting returned messages and
  return the typed `context_paused` result without dispatching stale workflow outcomes.
- `src/shared/session/agent-handler.test.js` — prove paused recovery returns `context_paused`, does not consume stale
  workflow outcomes, change active Agent, or transition an In-Progress Plan.
- `src/tools/delegate-agent.js` — map a transient Agent's typed context-pause outcome to one failed delegation tool
  result instead of presenting partial child output as a successful handoff.
- `src/tools/__tests__/delegate-agent.test.js` — verify delegated Agent cancellation and context pause preserve tool
  settlement, report `context_resilience_paused` deterministically, and respect Hosted Session compaction serialization.
- `src/cmd/compact/index.js` — handle Runtime's `compaction_in_progress` result without reading success-only compaction
  fields and display one concise retry-later message.
- `src/cmd/compact/index.test.js` — cover shared-arbiter acquisition, immediate `compaction_in_progress` behavior,
  manual-compaction re-arm, and non-duplicated manual/automatic status.
- `src/ui/tui/runtime-adapter.js` — render canonical context-resilience messages without implementing policy or
  normalization in the TUI.
- `src/ui/tui/runtime-adapter.test.js` — verify each user-visible context outcome renders once.
- `src/acp/event-mapper.js` — map the same semantic event to ACP text plus structured `_meta` status/reason fields.
- `src/acp/server.test.js` — verify ACP receives equivalent outcomes without Session content or TUI-specific semantics.
- `docs/sessions.md` — document the public-Pi dependency, automatic mid-run behavior, derived recovery policy,
  continuation, pause/recovery, cancellation, and relationship to `/compact`, `/context`, and `/session`.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `@earendil-works/pi-coding-agent` — after the prerequisite release, reuse only its public completed-turn hook,
  `shouldCompact()`, `estimateTokens()`, Agent Session compaction/continuation operations, summaries, extension hooks,
  and lifecycle events; do not build a second summarizer or transcript format.
- `src/shared/session/session.js` — reuse prepared User Request token estimation, Agent Session metadata, and
  subscription lifecycle while moving compaction policy out of this broad module.
- `src/shared/session/session-runtime-events.js` — reuse fail-fast canonical event creation so TUI and ACP remain
  sibling consumers of one semantic contract.
- `src/shared/session/hosted-session.js` — reuse per-Session turn ownership and transient Agent registration to scope
  the arbiter and cancellation.
- `src/shared/session/session-context-report.js` — reuse existing context-window/usage normalization where applicable;
  adapters must not inspect Agent Session internals.

## Implementation Steps

- [ ] Step 1: Check the selected released Pi package family against the prerequisite contract. Add a no-network
      characterization test proving: completed tool results precede the stop decision; returning stop prevents the next
      provider call; no aborted assistant entry is persisted; automatic compaction exposes its result before
      continuation; failed/unsafe recovery can suppress continuation; and native steering/follow-up order is preserved.
      If any assertion fails or requires private access, stop execution with the Plan still blocked and make no RunWield
      behavior changes.
- [ ] Step 2: Upgrade `@earendil-works/pi-ai`, `pi-agent-core`, and `pi-coding-agent` (plus `pi-tui` only if required
      for a compatible release family), update the lockfile, and run the existing full test suite before feature
      implementation to separate dependency regressions from context-resilience changes.
- [ ] Step 3: Implement and unit-test the pure `W/R/T/M/S` policy and explicit per-Agent Session states (`idle`,
      `waiting_for_lease`, `stopping`, `compacting`, `measuring`, `continuing`, `paused`, `disposed`). Use strict
      `tokens > T` pressure, `estimatedTokensAfter <= T` landing, `recoveredTokens >= M` progress, and `usage <= S`
      re-arm boundaries.
- [ ] Step 4: Add a FIFO Hosted Session arbiter shared by automatic and manual compaction. An automatic intervention
      acquires the sole lease or gracefully waits without another provider call; after acquisition it remeasures
      pressure, skips unnecessary compaction, and releases the lease on success, failure, cancellation, or disposal.
      Manual `/compact` acquires only when immediately free and otherwise returns `compaction_in_progress` without
      disturbing the owner or automatic FIFO waiters.
- [ ] Step 5: Integrate the coordinator with `attachSessionEventSubscribers()` and `runPrompt()`: check resident plus
      prepared User Request context before provider submission; after effective pre-request compaction submit the
      original prepared request exactly once without continuation events; request the public graceful stop at pressured
      internal turns; correlate compaction completion; and distinguish normal completion, recoverable pause, and user
      cancellation without private Pi access.
- [ ] Step 6: Continue only after effective recovery using the fixed hidden `runwield_context_continuation` message and
      the public queue-safe Agent Session operation. Preserve messages already queued at the decision point ahead of the
      internal continuation and test that no second Runtime User Request or Agent Handler invocation occurs.
- [ ] Step 7: Apply the same coordinator and Hosted Session arbiter to persistent root and transient/delegated Agent
      Sessions. Throw the typed pause outcome from `runPrompt()` for both paths; map root pauses to the new
      `context_paused` Agent turn result before any message/outcome scan, and map transient pauses to a failed
      delegation result before child disposal. Preserve active parent Agent identity, debug summaries, transcript
      replay, and Plan Lifecycle.
- [ ] Step 8: Extend Hosted Session/Runtime cancellation so canceling any intervention aborts the public graceful-stop,
      compaction, measurement, and continuation operations for root or transient Agent Sessions, clears any still-queued
      internal continuation and all queued user steering/follow-up messages as RunWield does today, preserves an
      internal continuation entry if its turn already started, emits applicable dequeue transitions, and retains the
      turn/busy lease until all underlying operations settle.
- [ ] Step 9: Add the canonical `context_resilience` Runtime event with statuses `compacting`, `compacted`,
      `continuing`, `continued`, `ineffective`, `paused`, `canceled`, `failed`, and `rearmed`; reasons `threshold`,
      `oversized_request`, `compaction_failed`, `insufficient_recovery`, `user_cancel`, `manual_recovery`, and
      `capacity_recovery`; a core-generated `message`; and optional numeric `usagePercent`/`recoveredPercent`. Use
      `threshold` for normal automatic lifecycle, `manual_recovery` when `/compact` enters `S`, and `capacity_recovery`
      when measured usage enters `S` after a model/context/settings recomputation. `oversized_request` is only a reason
      on `paused`, never a status. Reject producer payload keys for prompts, summaries, tool data, file content, URLs,
      or arbitrary details. Replace duplicate generic automatic-compaction statuses with this event.
- [ ] Step 10: Map the canonical event in TUI and ACP. TUI renders `message` once; ACP emits the same text and preserves
      only status, reason, and optional percentages in `_meta`; neither adapter calculates pressure or continuation
      policy.
- [ ] Step 11: Cover manual `/compact` re-arm, update Session documentation, run focused tests, then run the complete
      RunWield quality gate.

## Verification Plan

- Automated prerequisite gate: the public Pi characterization must assert zero provider calls between a pressured
  completed turn and compaction; zero persisted assistant messages with `stopReason: "aborted"`; one persisted tool
  result per completed tool call; and no private property/method access. Failure leaves the feature unimplemented.
- Automated focused tests: run
  `deno test -A src/shared/session/session-context-resilience.test.js
  src/shared/session/session-prompt.test.js src/shared/session/session-subscribers.test.js
  src/shared/session/hosted-session.test.js src/shared/session/abort-active-session.test.js
  src/shared/session/session-runtime-events.test.js src/shared/session/session-runtime.test.js
  src/shared/session/agent-handler.test.js src/tools/__tests__/delegate-agent.test.js
  src/cmd/compact/index.test.js src/ui/tui/runtime-adapter.test.js src/acp/server.test.js`.
- Automated full gate: run `deno task ci` and fix all check, Workspace check, lint, formatting, test, and release-check
  failures.
- Long-run fixture: script at least six internal turns with deterministic large tool results. Assert the provider-call
  sequence is `pressure turn -> compaction call -> continuation turn` with no oversized provider call between pressure
  and compaction; Agent Handler invocation count remains `1`; Runtime emits one outer `TURN_START`, remains busy, and
  emits one outer `TURN_END` only after continuation settles.
- Pre-request recovery: with pressure caused by resident context plus the prepared User Request, assert the event
  sequence is exactly `compacting(threshold), compacted(threshold)`, the original request produces exactly one Runtime
  `USER_MESSAGE` and one provider submission, and no `runwield_context_continuation`, `continuing`, or `continued`
  occurs.
- Effective mid-run recovery: for `W=128000`, `R=16384`, assert `T=111616`, `M=16384`, and `S=95232`. A result
  `{tokensBefore: 118000, estimatedTokensAfter: 90000}` emits exactly
  `compacting(threshold), compacted(threshold),
  continuing(threshold), continued(threshold)`, performs one
  continuation, and permits a later intervention only after usage crosses `111616` again.
- Ineffective/failure recovery: every attempted automatic compaction first emits `compacting(threshold)`. A result above
  `T` or recovery below `M` then performs zero continuation provider calls and emits exactly
  `ineffective(insufficient_recovery), paused(insufficient_recovery)`; a missing result or compaction error emits
  exactly `failed(compaction_failed), paused(compaction_failed)`. Both make zero additional automatic compaction
  attempts while usage remains above `S`. A request that exceeds `T` against empty history attempts no compaction and
  emits only `paused(oversized_request)`.
- Re-arm: manual compaction at exactly `S` emits one `rearmed(manual_recovery)`; recomputed model/context/settings usage
  at exactly `S` emits one `rearmed(capacity_recovery)`; usage at `S+1` emits neither. A model/settings change that
  remains above its recomputed `S` does not re-arm.
- Queue order: queue one steering message and two follow-up messages before continuation. Assert their persisted/model
  order remains Pi-native and all three precede the single `runwield_context_continuation` entry; assert no duplication,
  dropped messages, or Runtime `USER_MESSAGE` for the internal entry.
- Root pause: place stale `return_to_router`, triage, `plan_written`, and `task_completed` outcomes in the partial
  message array, then force ineffective recovery. Assert `runPrompt()` raises `ContextResiliencePaused`, the Agent
  Handler returns exactly `{ kind: "context_paused" }` without scanning or dispatching those outcomes, `promptSession()`
  settles `ok: true`, and active Agent/workflow/Plan Lifecycle state is unchanged.
- Delegated pause: force ineffective recovery in a transient Agent Session. Assert the child emits pause status,
  performs zero continuation calls, is disposed, and returns one parent tool result with `isError: true` and
  `details.error: "context_resilience_paused"`; partial child text never appears as a successful handoff.
- Cancellation: queue one steering and one follow-up message, then cancel once in each state (`waiting_for_lease`,
  `stopping`, `compacting`, `measuring`, `continuing`). Assert both queued user messages and any still-queued internal
  continuation are removed, each queued Runtime message receives one dequeue transition, one Runtime `CANCELLATION` and
  at most one `canceled(user_cancel)` occur, `TERMINAL_ERROR` count is zero, no new provider call starts after
  cancellation, busy changes to false once after settlement, no arbiter lease leaks, and a later User Request is
  accepted. When cancellation occurs after the internal continuation entry is persisted and its turn starts, assert the
  active turn aborts, the private entry remains in the Session Transcript, and no additional continuation starts.
- Hosted Session isolation: pressure two Agent Sessions in one Hosted Session and one in another. Assert maximum
  concurrent compactions are `1` for the first Hosted Session and independently `1` for the second; all automatic
  waiters settle. While an automatic lease is held, `/compact` returns `compaction_in_progress` and the concurrent
  compaction count remains unchanged; when idle, manual `/compact` acquires the same lease.
- Adapter parity: feed the same canonical events to TUI and ACP fixtures. Assert one displayed text per event and ACP
  `_meta` contains only `type`, `status`, `reason`, `usagePercent`, and `recoveredPercent` in addition to standard
  Runtime metadata.

## Edge Cases & Considerations

- This Plan is intentionally blocked on an external public Pi release. Approval should save it for later; execution must
  not begin by substituting a private compatibility shim when the prerequisite is absent.
- The dependency gate requires more than a low-level callback: RunWield must be able to observe recovery before
  continuation and preserve queues through a supported Agent Session operation. A release that exposes only
  `shouldStopAfterTurn` but cannot satisfy those assertions is insufficient.
- Pi reports context usage as unknown immediately after compaction. Use the public compaction result's
  `estimatedTokensAfter` for recovery measurement and retain an explicit unknown state until later provider usage
  replaces the estimate.
- A single prepared User Request may exceed `T` even with an empty compacted history. Detect this before submission,
  emit exactly `paused(oversized_request)`, and recommend reducing the request or choosing a larger-context model;
  compaction cannot solve it.
- Successful repeated compactions during an exceptionally long assignment are allowed only after each prior compaction
  demonstrates effective recovery and context later crosses `T` again. Failed or ineffective recovery never self-retries
  above `S`.
- Tool results finish and persist before graceful stop. Never stop in the middle of tool execution or discard a result
  needed by the compaction summary or continuation.
- A waiting Agent Session holds no Hosted Session compaction lease and starts no provider call. On lease acquisition it
  remeasures because another Agent Session's compaction does not change its isolated context.
- User cancellation wins every race and must not be reported as ineffective recovery or trigger re-arm. It retains the
  established behavior of discarding queued user steering/follow-up messages. Manual `/compact` remains available after
  pause when the shared arbiter is free and must not produce duplicate automatic status.
- A transient Delegated Agent Session cannot be resumed after disposal. On failed or ineffective recovery, report one
  failed tool result to the parent and require a fresh delegation for any retry; never label partial child output as a
  successful result.
- The exact `W/R/T/M/S` formula and inclusive/exclusive boundaries are explicit user decisions for this Plan. No new
  user-facing percentage setting is introduced.
- Automatic model switching, an in-repository Pi fork, private Pi access, a replacement summarizer, arbitrary transcript
  compression, optional workflow metrics, extra `/settings` diagnostics, and durable storage of compaction summaries
  outside the Session Transcript are outside this Plan.
