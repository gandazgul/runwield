---
classification: "FEATURE"
complexity: "HIGH"
summary: "Make auto-compaction monitor and recover during long Agent Session tool-result loops, not only before user prompts or after full Agent Session completion."
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
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:10:26-04:00"
updatedAt: "2026-07-27T01:10:37.235Z"
status: "implemented"
origin: "internal"
failureReason: "Primary checkout has uncommitted changes that overlap execution worktree changes; refusing to merge: src/shared/session/session-runtime.test.js"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-mid-run-tool-result-auto-compaction-843f49e8"
worktreeBranch: "runwield/worktree/mid-run-tool-result-auto-compaction-843f49e8"
worktreeBaseBranch: "main"
worktreeStatus: "merge_conflict"
routingIntent: "FEATURE"
---

# Mid-run Tool-result Auto-compaction

## Context

The reported failure is that Session context reaches 100% while auto-compaction appears not to fire. The important
clarification is that the current gap is specifically during long autonomous Agent Session activity: tool-call responses
and tool result messages can grow context inside one outer Runtime turn, while RunWield's current proactive check runs
only before submitting a prepared User Request.

Repository evidence matches that symptom:

- `compactBeforePromptIfNeeded()` in `src/shared/session/session.js` estimates resident context plus the next prepared
  User Request, then delegates to Pi before `session.prompt(...)`. This protects large user prompts, not context growth
  caused by later tool results in the same Agent Session run.
- Pi's Agent Session auto-compaction currently handles threshold/overflow around completed Agent Session runs and
  provider overflow recovery, but that is too late for long tool loops that cross the context window before the next
  provider call.
- `docs/prd/session-context-resilience-prd.md` and the prior `plans/automatic-session-context-resilience.md` describe
  this same failure class. This refreshed plan narrows the framing to the user-confirmed tool-result gap and updates the
  execution prerequisite evidence.
- Current package discovery shows RunWield is pinned to `@earendil-works/pi-*` `0.80.5`. The latest npm package family
  observed during planning is `0.82.1`; `pi-agent-core` documents a low-level `AgentLoopConfig.shouldStopAfterTurn`, but
  the public `Agent`/`createAgentSession` path still must be characterized before RunWield depends on it.

This plan keeps the previously chosen upstream-first safety constraint: use Pi's public APIs and compaction machinery,
not private method access, a local Pi fork, or a competing summarizer, unless the user explicitly approves a separate
urgent-workaround plan.

## Objective

Make RunWield auto-compaction resilient during long Agent Session tool-result loops. RunWield should detect context
pressure at a safe completed-turn boundary, compact before another oversized provider request, verify that compaction
recovered useful headroom, and continue the same assignment without duplicate routing or a second user-visible request.

When compaction fails or cannot recover enough context, RunWield should pause automatic intervention, keep the Session
usable, and surface an actionable recoverable state instead of looping, wedging the Runtime, or treating partial stale
workflow outcomes as success.

## Approach

Start with a red-capable reproduction at the RunWield/Pi boundary: a deterministic long Agent Session fixture where
large tool results push usage over the threshold before the next provider call. The test must fail against the current
behavior by proving that no compaction occurs between pressured tool-result completion and the next oversized provider
submission.

Then upgrade the related Pi package family only if a released public contract can support the required control loop. The
minimum acceptable public contract is:

- a graceful stop after a completed assistant response and its tool results, before queue polling or another provider
  call;
- no aborted assistant transcript artifact and no dropped tool result;
- automatic compaction through Pi's normal summary/session machinery with observable success, failure, and cancellation;
- access to `tokensBefore` and `estimatedTokensAfter` before RunWield decides whether continuation is safe;
- a supported continuation path that preserves Agent Session identity and queued steering/follow-up order.

If the candidate Pi release only exposes the low-level core hook but not enough through `Agent`, `AgentSession`, or
`createAgentSession`, execution should stop after the characterization test and report the remaining upstream blocker.
Do not replace that missing contract with `_runAutoCompaction`, `agent.createLoopConfig()`, `agent.continue()` around
`AgentSession`, monkey-patching, or transcript mutation.

When the public contract is sufficient, implement a deep `session-context-resilience.js` module that owns the context
health policy and per-Agent Session state machine. Keep `session.js` focused on Agent construction, prompt preparation,
and Pi event subscription. Keep TUI and ACP as sibling consumers of adapter-neutral `SessionRuntime` events; neither
adapter calculates thresholds or recovery decisions.

Use the existing compaction settings rather than adding another percentage setting. For active model context window `W`
and effective reserve tokens `R`:

- trigger threshold `T = max(0, W - R)`;
- pressure exists only when tokens are strictly greater than `T`;
- minimum recovery `M = min(R, floor(T / 2))`;
- re-arm band `S = max(0, T - M)`;
- a compaction is effective only when it lands at or below `T` and recovers at least `M` tokens, or makes strict
  progress when `M` is zero.

## Files to Modify

- `deno.json` — update the related `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, and, if required,
  `pi-tui` constraints to one compatible released family after the prerequisite contract is characterized.
- `deno.lock` — lock the verified Pi package family without unrelated dependency upgrades.
- `src/shared/session/session-context-resilience.js` — add the W/R/T/M/S policy, per-Agent Session states, public Pi
  turn-boundary integration, recovery measurement, continuation instruction, pause/re-arm behavior, and cancellation
  coordination.
- `src/shared/session/session-context-resilience.test.js` — add the current red-capable long-tool-result reproduction,
  public Pi contract characterization, policy tests, state-machine tests, recovery measurement tests, and queue-ordering
  tests.
- `src/shared/session/session.js` — replace the standalone pre-prompt compaction helper with the coordinator, wire Pi
  lifecycle events into the coordinator, and route root/transient prompt execution through one resilient path.
- `src/shared/session/session-prompt.test.js` — cover pre-request compaction, mid-run continuation, no duplicate user
  request, oversized request fail-before-provider, and ordinary below-threshold behavior.
- `src/shared/session/session-subscribers.test.js` — verify completed-turn observation and non-duplicated context
  resilience status emission.
- `src/shared/session/hosted-session.js` — own the shared Hosted Session compaction arbiter and active intervention
  cancellation handles.
- `src/shared/session/hosted-session.test.js` — cover arbiter exclusivity, FIFO automatic waiters, manual contention,
  disposal, and Hosted Session isolation.
- `src/shared/session/abort-active-session.test.js` — verify root and transient Agent Session cancellation aborts
  streaming, compaction, and continuation without duplicate aborts.
- `src/shared/session/session-runtime.js` — preserve busy/turn/cancellation invariants while context intervention runs
  inside the same Runtime-owned turn.
- `src/shared/session/session-runtime.test.js` — cover recoverable pause settlement, cancellation races, busy-state
  continuity, root/transient parity, and independent Hosted Session progress.
- `src/shared/session/session-runtime-events.js` — add a canonical adapter-neutral `context_resilience` event with
  content-free status, reason, message, and optional pressure/recovery percentages.
- `src/shared/session/session-runtime-events.test.js` — validate event enums and reject producer payloads containing
  prompts, summaries, tool data, file content, URLs, or arbitrary details.
- `src/shared/session/types.js` — add a typed `context_paused` Agent turn result.
- `src/shared/session/agent-handler.js` — catch only the typed context pause before scanning message arrays for workflow
  tool outcomes.
- `src/shared/session/agent-handler.test.js` — prove stale `return_to_router`, `plan_written`, or `task_completed`
  content is ignored after a context pause.
- `src/tools/delegate-agent.js` — map transient Agent Session context pause to one deterministic failed delegation tool
  result instead of successful partial child output.
- `src/tools/__tests__/delegate-agent.test.js` — cover delegated context pause, cancellation, and shared arbiter
  behavior.
- `src/cmd/compact/index.js` — handle `compaction_in_progress` from the shared arbiter and allow manual compaction to
  re-arm a paused Agent Session when it recovers enough context.
- `src/cmd/compact/index.test.js` — cover manual contention, manual re-arm, and non-duplicated status.
- `src/ui/tui/runtime-adapter.js` — render canonical context-resilience messages once without implementing policy.
- `src/ui/tui/runtime-adapter.test.js` — verify TUI rendering for compacting, compacted, continuing, paused, failed,
  canceled, and rearmed statuses.
- `src/acp/event-mapper.js` — map the same event to ACP text plus structured `_meta` status/reason/percentage fields.
- `src/acp/server.test.js` — verify ACP parity without leaking Session content.
- `docs/sessions.md` — document mid-run tool-result monitoring, continuation, pause/recovery, cancellation, `/compact`,
  `/context`, `/session`, and the public Pi dependency.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `docs/prd/session-context-resilience-prd.md` — reuse the resolved product semantics and success criteria.
- `plans/automatic-session-context-resilience.md` — reuse the prior detailed policy, but focus implementation on the
  confirmed tool-result growth path.
- `src/shared/session/session.js` — reuse prepared User Request estimation, Agent Session construction, subscriber
  lifecycle, and Pi event translation.
- `@earendil-works/pi-coding-agent` — reuse Pi's `estimateTokens()`, `shouldCompact()`, SessionManager persistence,
  compaction summaries, settings, and public Agent Session operations.
- `src/shared/session/session-runtime-events.js` — reuse fail-fast event creation and adapter-neutral Runtime contracts.
- `src/shared/session/hosted-session.js` — reuse Hosted Session ownership of root and transient Agent Sessions for
  scoping the shared compaction arbiter.
- `src/shared/session/session-context-report.js` — reuse existing context-usage normalization where applicable.
- `src/cmd/settings/index.js`, `/context`, and `/session` diagnostics — preserve current user controls and reporting.

## Implementation Steps

- [ ] Step 1: Add a red-capable long-tool-result test fixture at the RunWield/Pi seam. It should simulate at least six
      internal assistant/tool-result turns, push estimated context over `W - R`, and assert current behavior attempts a
      provider call without an intervening compaction.
- [ ] Step 2: Check the selected released Pi package family against the public dependency contract. Include a no-network
      characterization proving completed tool results precede the stop decision, stop prevents the next provider call,
      no aborted assistant entry is persisted, compaction exposes recovery numbers before continuation, and queued
      messages preserve order. If this requires private access, stop with the Plan blocked.
- [ ] Step 3: Upgrade the related Pi package constraints and lockfile only after Step 2 identifies a sufficient released
      family. Run the existing full test suite before implementing feature logic to isolate dependency regressions.
- [ ] Step 4: Implement and unit-test the W/R/T/M/S policy and Agent Session state machine (`idle`, `waiting_for_lease`,
      `stopping`, `compacting`, `measuring`, `continuing`, `paused`, `disposed`).
- [ ] Step 5: Add a FIFO Hosted Session compaction arbiter shared by automatic and manual compaction. Automatic
      interventions may wait; manual `/compact` returns `compaction_in_progress` when the lease is owned.
- [ ] Step 6: Integrate the coordinator with `attachSessionEventSubscribers()` and `runPrompt()`: preserve the existing
      pre-request check, add safe completed-turn pressure detection, correlate compaction results, and distinguish
      normal completion, context pause, and user cancellation.
- [ ] Step 7: Continue effective mid-run recovery with one hidden internal `runwield_context_continuation` message that
      tells the Agent to rely on the compaction summary and continue the same assigned work without repeating unchanged
      discovery.
- [ ] Step 8: Apply the same coordinator to root and transient/delegated Agent Sessions. Map root pauses to
      `context_paused`; map transient pauses to one failed delegation result with
      `details.error:
      "context_resilience_paused"`.
- [ ] Step 9: Extend Runtime cancellation so cancellation wins races in `waiting_for_lease`, `stopping`, `compacting`,
      `measuring`, and `continuing`, clears queued user messages and still-queued internal continuation, releases
      leases, and emits no `TERMINAL_ERROR` for expected cancellation.
- [ ] Step 10: Add and map the canonical `context_resilience` Runtime event. Supported statuses should include
      `compacting`, `compacted`, `continuing`, `continued`, `ineffective`, `paused`, `canceled`, `failed`, and
      `rearmed`; reasons should include `threshold`, `oversized_request`, `compaction_failed`, `insufficient_recovery`,
      `user_cancel`, `manual_recovery`, and `capacity_recovery`.
- [ ] Step 11: Update `/compact` handling, docs, focused tests, and full repository verification.

## Verification Plan

- Automated prerequisite gate: run the new public Pi characterization test before feature implementation. Expected
  result: no private API usage, no provider call between pressured completed turn and compaction, no aborted assistant
  artifact, and preserved queued-message ordering.
- Automated focused tests:
  `deno test -A src/shared/session/session-context-resilience.test.js src/shared/session/session-prompt.test.js src/shared/session/session-subscribers.test.js src/shared/session/hosted-session.test.js src/shared/session/abort-active-session.test.js src/shared/session/session-runtime-events.test.js src/shared/session/session-runtime.test.js src/shared/session/agent-handler.test.js src/tools/__tests__/delegate-agent.test.js src/cmd/compact/index.test.js src/ui/tui/runtime-adapter.test.js src/acp/server.test.js`
- Automated full gate: `deno task ci`.
- Expected long-tool-result behavior: provider sequence is pressured turn, compaction, continuation turn; no oversized
  provider request occurs between pressure detection and compaction; one outer Runtime turn remains busy until
  continuation settles.
- Expected pre-request behavior: resident context plus prepared User Request can trigger compaction before submission;
  the original User Request is submitted exactly once and no hidden continuation is added.
- Expected ineffective/failure behavior: insufficient recovery or compaction failure emits a pause, performs no
  continuation provider call, makes no automatic retries while usage remains above the re-arm band, and leaves the
  Session usable for the next User Request or manual recovery.
- Expected cancellation behavior: cancellation in every intervention state releases the arbiter, starts no new provider
  call after cancellation, emits one cancellation outcome, and allows a later User Request.
- Adapter parity: TUI and ACP render or transmit the same canonical context-resilience outcomes once, with ACP metadata
  limited to status, reason, and optional percentages.

## Edge Cases & Considerations

- This is the tool-result/mid-run compaction gap, not just large user-prompt compaction. The existing pre-prompt helper
  is necessary but insufficient.
- Execution may discover that the latest Pi release still lacks the public Agent Session contract. In that case, stop
  after the characterization test and report the upstream blocker rather than implementing a private workaround.
- A single prepared User Request may exceed the safe threshold even after compaction; detect it before provider
  submission and ask the user to reduce the request or choose a larger-context model.
- Tool results must finish and persist before a graceful stop. Never stop in the middle of tool execution or discard a
  result needed by the summary or continuation.
- Failed or ineffective compaction must pause automatic retries until usage falls to the re-arm band through manual
  recovery or real capacity recovery.
- User cancellation wins every race and must not be reported as ineffective recovery.
- Transient Delegated Agent Sessions cannot be resumed after disposal; partial child output must not be reported as a
  successful result.
- Out of scope: private Pi method access, local Pi forks, replacement summarization, automatic model switching,
  arbitrary transcript compression, and new user-facing percentage settings.
