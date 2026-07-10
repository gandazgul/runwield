---
classification: "FEATURE"
complexity: "HIGH"
summary: "Remove scheduled root swaps and replace them with an awaited SessionRuntime switch operation plus typed Agent Handler handoff results shared by sibling TUI and ACP adapters."
affectedPaths:
    - "src/shared/session/types.js"
    - "src/shared/session/agent-switching.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/workflow/workflow-results.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/tools/return-to-router.js"
    - "src/cmd/registry.js"
    - "src/cmd/agents/index.js"
    - "src/cmd/new/index.js"
    - "src/cmd/sleep/index.js"
    - "src/cmd/load-plan/index.js"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/slash-dispatch.js"
    - "src/acp/event-mapper.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/orchestrator.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/tools/__tests__/return-to-router.test.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/cmd/agents/index.test.js"
    - "src/cmd/new/index.test.js"
    - "src/cmd/sleep/index.test.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/ui/tui/chat-session.test.js"
    - "src/ui/tui/slash-dispatch.test.js"
    - "src/acp/event-mapper.test.js"
frontend: false
createdAt: "2026-07-10T09:32:05-04:00"
updatedAt: "2026-07-10T14:08:56.052Z"
status: "draft"
origin: "internal"
---

# Immediate Runtime Agent Switching

## Context

Agent switching currently exposes a two-phase interface: `setActiveAgent()` changes the Agent Handler and records a
pending root swap, then callers or `SessionRuntime.promptSession()` must later call `applyPendingRootSwap()`. Separate
pending fields hold the target root and a chained-turn reason. This scheduled-swap design predates RunWield's current
Session Host architecture, has repeatedly produced ordering bugs, and most recently allowed `/commit` to pair an
Engineer root Agent Session with an Operator Agent Handler.

ADR-010 establishes `SessionRuntime` as the shared core seam below sibling TUI and ACP adapters. Agent transitions
should therefore be complete core operations or explicit results from a completed Agent Handler turn—not mutable work
scheduled on `HostedSession` for an unknown caller to drain later.

The user confirmed that this refactor should remove pending root-swap and pending handoff state entirely. Prompt
Templates remain a TUI input feature, but switching, root Agent Session lifecycle, chained turns, and semantic events
remain shared core behavior used by both adapters. The current working tree contains a narrow `/commit` hotfix that
explicitly applies the queued swap before dispatch; execution should intentionally supersede that choreography rather
than preserve it.

## Objective

Replace scheduled Agent swaps with two small, explicit core interfaces:

1. An awaited immediate switch operation that returns only after the target Agent Handler and root Agent Session agree.
2. A typed Agent Handler result for an Agent-requested continuation such as `return_to_router`; `SessionRuntime`
   consumes the result after the old Agent Session settles, performs the immediate switch, and starts the next turn.

Remove `pendingRootSwap`, `pendingSwitchHandoff`, caller-managed apply steps, and adapter knowledge of Agent
Handler/root replacement details while preserving workflows, Agent Session history, cancellation, chained-turn limits,
and multi-Hosted-Session isolation.

## Approach

Create a typed async session-layer switch implementation and expose it through
`SessionRuntime.switchAgent(sessionOrId, options)`. The runtime-facing options contain only Agent Name plus optional
model and `allowReturnToRouter` overrides; adapters no longer construct Agent Handlers or pass compatibility rendering
objects. Shared workflows may call the same lower-level core implementation after their current Agent Session has
settled, while the runtime method protects adapter-initiated switches from racing an active turn. The implementation
builds the replacement root first with `ensureRootAgentSession()`, installs the matching Agent Handler only after the
build succeeds, and reports completion through the existing `agent_changed` semantic event.

Change `AgentMessageHandler` from `Promise<void>` to a typed result such as `{ kind: "complete" }` or
`{ kind: "handoff", agentName, userRequest, model? }`. `return_to_router` remains a terminating Custom Tool, but it no
longer mutates Hosted Session switching state. `createAgentHandler()` reads the current turn's tool result and returns a
handoff result to `SessionRuntime.promptSession()`. The runtime switches immediately between loop iterations and submits
the self-contained reason to Router, preserving the current handoff limit without scheduling mutable work.

Migrate workflow modules and TUI commands to await the same switch implementation. TUI keeps Prompt Template expansion,
terminal focus/title, and rendering. ACP keeps protocol framing. Both consume SessionRuntime state/events; neither owns
Agent switching or imports the other. This feature does not add an ACP user-facing Agent-selection protocol method, but
ACP should map Agent change events produced by Agent-driven transitions instead of silently dropping them.

## Files to Modify

- `src/shared/session/types.js` — define `AgentTurnResult`/handoff JSDoc typedefs and update `AgentMessageHandler` to
  return the typed result.
- `src/shared/session/agent-switching.js` — replace overloaded `setActiveAgent()` and `applyPendingRootSwap()` with one
  typed async switch transaction; lazily create the Agent Handler in core or accept an injected factory only for tests.
- `src/shared/session/hosted-session.js` — remove pending root-swap and pending handoff types, fields, accessors, reset,
  and disposal behavior.
- `src/shared/session/session.js` — preserve `ensureRootAgentSession()` as the replacement primitive and update stale
  mismatch diagnostics that instruct callers to schedule/apply a swap.
- `src/shared/session/session-runtime.js` — expose `switchAgent()`, own adapter-neutral Agent Handler creation and
  private compatibility presentation access, and drive chained turns from returned `AgentTurnResult` values rather than
  Hosted Session pending state.
- `src/shared/session/session-runtime-events.js` — ensure `agent_changed` clearly describes a completed transition and
  carries the canonical Agent Name/model needed by sibling adapters.
- `src/shared/session/agent-handler.js` — return explicit completion/handoff results, detect only current-turn
  `return_to_router` outcomes, and await immediate workflow transitions instead of scheduling handlers/swaps.
- `src/shared/workflow/workflow-results.js` — add a focused parser for the terminating `return_to_router` tool result,
  using the existing current-turn index rules to avoid replaying stale handoffs.
- `src/shared/workflow/orchestrator.js` — replace paired set/apply calls and unawaited final transitions with one
  awaited switch; delete handoff-drain workarounds from sub-Agent execution.
- `src/shared/workflow/validation.js` — make Agent activation helpers async, await transitions before validation/repair
  continues, and remove pending-handoff drains.
- `src/shared/workflow/workflow-slicer.js` — migrate its injected/default Agent switch dependency to the async
  interface.
- `src/tools/return-to-router.js` — stop constructing/installing Router's Agent Handler or mutating Hosted Session; emit
  terminating tool details that `createAgentHandler()` can turn into a typed handoff result.
- `src/cmd/registry.js` — replace TUI-shaped `setActiveAgent`/`applyPendingRootSwap` command dependencies with one
  async, adapter-neutral switch callback.
- `src/cmd/agents/index.js` — await the immediate switch before restoring editor focus and finishing `/agent`.
- `src/cmd/new/index.js` — initialize Router with one switch after SessionRuntime/Hosted Session replacement; remove
  manual pending-state resets and apply calls.
- `src/cmd/sleep/index.js` — await one Engineer switch before invoking the maintenance root turn.
- `src/cmd/load-plan/index.js` — migrate recovery and final-Agent transitions to the async interface and await them
  before subsequent work.
- `src/ui/tui/chat-session.js` — replace overloaded TUI switch/apply wrappers with a thin callback to
  `SessionRuntime.switchAgent()` and remove pending-swap startup/reset logic.
- `src/ui/tui/slash-dispatch.js` — switch Prompt Templates to Operator with one awaited callback and then submit
  expanded text; remove Agent Handler creation and all apply-swap knowledge.
- `src/acp/event-mapper.js` — map completed `agent_changed` events into ACP `session/update` metadata/text consistent
  with current ACP extension conventions, without adding TUI behavior.
- Corresponding tests listed in front matter — replace state/call-count assertions for scheduled swaps with behavior
  tests for atomic switches, typed handoffs, adapter event mapping, failure safety, and session isolation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` `ensureRootAgentSession()` — retain root build/replacement, Agent Definition, model,
  tools, metadata, and subscriber setup rather than duplicating lifecycle work.
- `src/shared/session/session-runtime.js` session lookup, dependency injection, private compatibility port, turn
  exclusion, and chained-handoff limit — keep these invariants behind the runtime interface.
- `src/shared/session/session-runtime-events.js` `RuntimeEventTypes.AGENT_CHANGED` — use the established adapter-neutral
  event instead of direct TUI messages.
- `src/shared/session/agent-handler.js` current-turn `preTurnCount` pattern — prevent old `return_to_router` tool
  results from triggering a new handoff on later prompts.
- `src/shared/workflow/workflow-results.js` latest-tool-result readers — follow the existing parsing and JSDoc style for
  the new handoff outcome.
- `src/shared/session/session-runtime.test.js` multi-Hosted-Session fixtures — prove one session's switch and handoff
  result cannot affect another.
- `src/ui/tui/runtime-adapter.js` and `src/acp/event-mapper.js` — preserve separate sibling adapters over the same
  semantic runtime event.
- ADR-010 dependency-direction tests — continue proving `src/shared` and `src/tools` do not import `src/ui` or
  `src/acp`.

## Implementation Steps

- [ ] Add `AgentTurnResult`, completion result, and handoff result JSDoc typedefs in `session/types.js`; update the
      Agent Handler contract and adjust test fakes to return explicit completion where useful.
- [ ] Add failing session-layer/runtime tests proving an immediate switch returns with matching root Agent Name and
      Agent Handler, emits one completed `agent_changed` event, supports same-Agent no-op/rebuild semantics, and leaves
      the previous pair usable if target construction fails.
- [ ] Implement one async switch transaction in `agent-switching.js`: resolve/create the target Agent Handler in core,
      build the target root with `ensureRootAgentSession()`, install the handler only after success, and avoid exposing
      rendering or Handler parameters to adapter callers.
- [ ] Expose that transaction as `SessionRuntime.switchAgent(sessionOrId, options)`, using the target Hosted Session's
      private runtime presentation port and normal runtime errors/events; reject missing/disposed sessions consistently
      with existing runtime actions.
- [ ] Add `readLatestReturnToRouterOutcome()` in `workflow-results.js`; change `return_to_router` to return only its
      terminating semantic details and change `createAgentHandler()` to return a typed handoff result for a current-turn
      call before processing unrelated workflow completion paths.
- [ ] Rewrite `SessionRuntime.promptSession()` so each Agent Handler result determines whether the loop ends or
      immediately switches and continues with a new request; preserve the maximum chained-handoff count, error events,
      cancellation settlement, turn ownership, and exact self-contained Router reason.
- [ ] Remove `PendingRootSwap`/`PendingSwitchHandoff` and all Hosted Session fields/accessors. Delete pre-turn/final
      `applyPendingRootSwap()` calls and all defensive `consumePendingSwitchHandoff()` drains now made unnecessary by
      typed results.
- [ ] Migrate `agent-handler.js`, `workflow/orchestrator.js`, `validation.js`, and `workflow-slicer.js` to one awaited
      switch dependency. Ensure every call site waits before invoking `runRootTurn()` or returning control to a user.
- [ ] Migrate command interfaces and implementations (`registry`, `/agent`, `/new`, `/sleep`, load-plan recovery) to one
      async switch callback; remove caller-supplied Agent Handler and compatibility UI arguments.
- [ ] Simplify the TUI adapter to call `SessionRuntime.switchAgent()`. In Prompt Template dispatch, await Operator once,
      then submit expansion through `SessionRuntime.promptSession()`; keep Prompt Template parsing and terminal UX local
      to TUI.
- [ ] Map `agent_changed` in ACP and verify both sibling adapters consume the same semantic event without core importing
      either adapter or ACP attempting to parse TUI Prompt Templates.
- [ ] Remove obsolete exports, wrapper overloads, injected apply functions, comments, and mismatch guidance. Run a
      repository search to prove no production reference to pending root/handoff swaps remains.

## Verification Plan

- Automated: run `deno test -A src/shared/session/hosted-session.test.js src/shared/session/session-runtime.test.js`.
- Automated: run
  `deno test -A src/shared/session/agent-handler.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/workflow/workflow.test.js src/tools/__tests__/return-to-router.test.js`.
- Automated: run
  `deno test -A src/shared/workflow/orchestrator.test.js src/shared/workflow/validation.test.js src/tools/__tests__/plan-written.test.js`;
  Slicer switch coverage remains in `src/shared/workflow/workflow.test.js`.
- Automated: run
  `deno test -A src/cmd/agents/index.test.js src/cmd/new/index.test.js src/cmd/sleep/index.test.js src/cmd/load-plan/index.test.js`.
- Automated: run
  `deno test -A src/ui/tui/chat-session.test.js src/ui/tui/slash-dispatch.test.js src/acp/event-mapper.test.js src/acp/server.test.js`.
- Automated: search `src/` for `applyPendingRootSwap`, `pendingRootSwap`, `pendingSwitchHandoff`, `setPendingRootSwap`,
  and `consumePendingSwitchHandoff`; expected result is no production runtime state or switching choreography using
  those concepts.
- Automated: run existing dependency-direction tests proving shared core/tools import neither `src/ui` nor `src/acp`.
- Automated: run `deno task ci` and fix every failure.
- Manual TUI: start on Engineer, run `/commit`, and verify Operator is active before expanded input is submitted, output
  appears once, and no `runRootTurn` Agent mismatch appears at completion.
- Manual TUI: exercise `/agent router`, `/new`, `/sleep`, a normal Router triage transition, plan execution/validation,
  and `return_to_router`; verify each visible transition completes before the next Agent turn.
- Manual ACP: create a session, prompt through a flow that returns to Router, and verify ordered Agent-change/message
  updates arrive with no terminal-specific behavior or TUI import.

## Edge Cases & Considerations

- `ensureRootAgentSession()` builds before replacing the current root, which supports failure safety. Do not install the
  target Agent Handler until that build succeeds; otherwise the refactor can recreate the original mismatch.
- Define same-Agent behavior explicitly: avoid an unnecessary root rebuild when Agent Name and effective model/options
  are unchanged, but rebuild when model/tool policy changes require it. In both cases the awaited result must guarantee
  Handler/root agreement.
- An adapter-requested immediate switch during an active Hosted Session turn should fail with a stable runtime error,
  not queue work. Shared workflow code may use the lower-level immediate switch only after its current Agent Session
  call has settled; a typed handoff result is the only supported transition requested from inside live generation.
- `return_to_router` still terminates the calling Agent Session immediately; only the switch mechanism changes. Preserve
  its self-contained reason, current-turn-only detection, maximum chained handoffs, and same-Hosted-Session isolation.
- Workflow sub-Agents may call `return_to_router`, but only a root Agent Handler result should drive SessionRuntime's
  chained turn. Without mutable pending state, ignored sub-Agent tool outcomes cannot hijack the root conversation.
- Preserve production root lifecycle rules: replacement reuses the root SessionManager/history and does not dispose the
  old production root except through the established `/new` lifecycle.
- Prompt Templates remain TUI-only input macros. Shared runtime owns switching and prompting; ACP remains a sibling
  adapter and receives semantic Agent changes without inheriting slash-command parsing or terminal UX.
- No ADR update is required: ADR-010 already places Agent switching in the session layer and defines TUI/ACP as sibling
  adapters. If implementation reveals a broader lifecycle decision, record that separately rather than weakening this
  Plan's scope.
