---
planId: "9afabaad-0575-43ee-bf9c-77def26287a2"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Make Pair Execution available from the local TUI and ensure ACP, headless, and sessions without Pair-capable adapters execute Frontend Engineer autonomously. This slice turns the core Pair workflow into the intended host behavior without pretending unsupported hosts share a browser surface."
affectedPaths:
    - "src/shared/session/session-runtime-interactions.js"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/acp/interaction-mapper.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/workflow/workflow.js"
    - "src/ui/tui/api.test.js"
    - "src/ui/tui/runtime-interaction-adapter.test.js"
    - "src/acp/server.test.js"
    - "src/acp/protocol-smoke.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/workflow/workflow.test.js"
frontend: false
createdAt: "2026-07-18T15:02:23.968Z"
updatedAt: "2026-07-18T15:02:23.968Z"
status: "draft"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 3
dependencies:
    - "02-pair-execution-core-workflow"
---

# TUI Pair Host and Autonomous Host Boundaries

## Context

The Epic explicitly scopes Pair Execution to hosts that can provide blocking interaction and the shared local browser
experience. The local TUI is the first supported Pair host. ACP and Headless Mode can run Frontend Engineer
autonomously, but they must not simulate checkpoints or imply a shared browser surface they cannot guarantee.

The previous slice adds Pair workflow semantics and a checkpoint tool. This slice wires those semantics into actual host
capabilities and adapter behavior.

## Objective

Expose Pair Execution from the TUI, render collaboration choices and Pair checkpoints through existing select/text
interaction patterns, and ensure ACP/headless/no-adapter contexts fall back to autonomous Frontend Engineer execution.
Runtime-loss recovery should recover the execution owner from the Plan and ask for collaboration style again only when a
Pair-capable host is present.

## Approach

Add a minimal host capability signal for Pair support to the interaction/session layer. The TUI adapter should advertise
Pair support and implement the existing interaction types needed for style selection, checkpoint decisions, revision
text, switch-to-AFK, and intentional stop. ACP should preserve ordinary elicitation behavior but not advertise Pair
support in this Epic. Workflow selection should consume these capabilities instead of inferring support from the mere
presence of any interaction adapter.

Keep this terminal/TUI work Engineer-owned; it is not browser frontend implementation.

## Files to Modify

- `src/shared/session/session-runtime-interactions.js` — expose or normalize host capability discovery for Pair support
  without changing ordinary interaction outcomes.
- `src/ui/tui/runtime-interaction-adapter.js` — advertise Pair support and render style selection plus checkpoint
  select/text prompts with clear labels for continue, revise, switch-to-AFK, and stop.
- `src/acp/interaction-mapper.js` — keep regular ACP elicitation behavior while ensuring Pair capability is not
  advertised and Pair checkpoint forms are not attempted.
- `src/shared/session/session-runtime.js` — preserve active execution workflow snapshots and recovery behavior needed to
  re-ask style after runtime context loss.
- `src/shared/workflow/workflow.js` — consume explicit Pair capability when deciding whether to ask for Pair/autonomous
  choice or silently select autonomous.
- `src/ui/tui/api.test.js` — cover TUI adapter capability advertisement and compatibility with existing TUI API
  expectations.
- `src/ui/tui/runtime-interaction-adapter.test.js` — cover style selection, checkpoint decisions, revision text
  collection, switch-to-AFK, and stop rendering.
- `src/acp/server.test.js` — cover autonomous fallback for frontend-owned execution in ACP sessions.
- `src/acp/protocol-smoke.test.js` — ensure ACP protocol behavior remains valid after interaction mapper changes.
- `src/shared/session/session-runtime.test.js` — cover recovery snapshots and rehydration behavior around execution
  owner/style.
- `src/shared/workflow/workflow.test.js` — cover TUI Pair offer, ACP/headless autonomous fallback, and runtime-loss
  style re-ask.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/runtime-interaction-adapter.js#requestInteraction` — reuse existing select/text rendering patterns instead
  of adding a separate Pair UI framework.
- `src/acp/interaction-mapper.js` — preserve existing form elicitation behavior while withholding Pair capability.
- `src/shared/session/session-runtime-interactions.js#requestHostedSessionInteraction` — keep checkpoint and style
  prompts adapter-neutral.
- `src/shared/session/session-runtime.js#getSessionSnapshot` — reuse existing session/workflow snapshot patterns for
  recovery.
- `src/shared/workflow/workflow.js` — centralize Pair capability decisions at execution start rather than scattering
  host checks through tools.

## Implementation Steps

- [ ] Define the minimum host capability contract needed to offer Pair Execution, such as `supportsPairExecution` or an
      equivalent explicit capability on the interaction adapter/session.
- [ ] Make the TUI runtime interaction adapter advertise Pair support.
- [ ] Render pre-execution collaboration selection in TUI using the existing select interaction path, with Planner
      recommendation visible but not binding.
- [ ] Render Pair checkpoints in TUI using existing select and text interactions, including clear options for continue,
      revise, switch-to-AFK, and stop.
- [ ] Collect revision feedback through a normal text interaction after a revise decision and return it to the Pair
      checkpoint tool as structured output.
- [ ] Ensure stop/cancel labels distinguish intentional stop from adapter cancellation or whole-turn abort.
- [ ] Ensure ACP does not advertise Pair support and never receives Pair checkpoint prompts in this Epic.
- [ ] Ensure sessions without an adapter or with unsupported Pair capability select autonomous without extra ceremony.
- [ ] Implement or verify recovery behavior: when runtime context is lost, resolve owner from Plan metadata and re-ask
      collaboration style only in a Pair-capable host.
- [ ] Add focused TUI, ACP, session-runtime, and workflow tests.
- [ ] Run `deno task ci` and fix all failures.

## Verification Plan

- Automated: run `deno test -A src/ui/tui/runtime-interaction-adapter.test.js` and verify TUI style
  selection/checkpoint/revision/switch/stop interactions.
- Automated: run `deno test -A src/shared/workflow/workflow.test.js` and verify Pair is offered only when the adapter
  advertises support, while ACP/headless/no-adapter runs autonomous.
- Automated: run `deno test -A src/acp/server.test.js src/acp/protocol-smoke.test.js` and verify ACP still handles
  normal elicitation but frontend-owned Plans execute autonomously with no Pair prompt.
- Automated: run `deno test -A src/shared/session/session-runtime.test.js` and verify active workflow snapshots preserve
  owner and recover style choice correctly after context loss.
- Automated: run `deno task ci` after implementation and fix all failures.
- Manual: from local TUI, execute a frontend-owned Plan, choose Pair, revise at a checkpoint, switch to AFK, and confirm
  TUI renders each blocking interaction clearly.
- Manual: execute the same frontend-owned Plan through ACP or a headless/no-adapter path and confirm autonomous
  execution occurs with no Pair checkpoint attempt.
- Expected results: only TUI offers Pair in this Epic; ACP/headless execution remains autonomous and consumer-ready
  Runtime events continue to work.

## Edge Cases & Considerations

- Do not infer Pair support from generic interaction support; ACP can elicit forms but lacks the shared local browser
  guarantee.
- Adapter cancellation should remain distinct from the user's explicit checkpoint stop decision.
- Runtime recovery should not write Pair choice to Plan front matter; it should re-ask when needed.
- Keep existing TUI look and interaction conventions; do not introduce a browser or Workspace UI for Pair in this slice.
- If Pair support is advertised but an interaction later fails, the workflow should report capability loss and fall back
  to autonomous where safe.
