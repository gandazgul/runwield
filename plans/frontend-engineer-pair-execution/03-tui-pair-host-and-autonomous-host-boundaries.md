---
planId: "9afabaad-0575-43ee-bf9c-77def26287a2"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Make the local TUI the first Pair-capable Session Host while canonical Frontend Engineer Plans fall back to autonomous execution in ACP, Headless Mode, recovery, and any session without Pair-checkpoint capability."
affectedPaths:
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/acp/interaction-mapper.js"
    - "src/shared/workflow/workflow.js"
    - "src/cmd/load-plan/index.js"
    - "src/ui/tui/runtime-interaction-adapter.test.js"
    - "src/ui/tui/runtime-adapter.test.js"
    - "src/acp/server.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/cmd/load-plan/index.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-23T10:35:43-04:00"
updatedAt: "2026-07-23T14:40:02.556Z"
status: "in_progress"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 3
dependencies:
    - "02-pair-execution-core-workflow"
humanReviewMode: null
humanReviewDecision: null
executionBaselineTree: "2878eda699f22a828c53a7c69fb932f58ed9e2ff"
worktreeId: "a8ad3aba"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-frontend-engineer-pair-execution-03-tui-pair-hos-a8ad3aba"
worktreeBranch: "runwield/worktree/frontend-engineer-pair-execution-03-tui-pair-hos-a8ad3aba"
worktreeBaseBranch: "main"
worktreeStatus: "active"
---

# TUI Pair Host and Autonomous Host Boundaries

## Context

Plan 02 established the adapter-neutral Pair Execution contract: a canonical Frontend Engineer FEATURE Plan may activate
Pair only when the active interaction adapter explicitly supports `pair_checkpoint`, and the Pair checkpoint Custom Tool
handles continue, revise, switch-to-autonomous, stop, cancellation, and capability loss without crossing the Task
Completion boundary.

This slice turns that contract into host behavior. The local TUI can block for user direction while the headed browser
is the shared implementation surface, so it is the first Pair-capable Session Host. Agent Client Protocol (ACP),
Headless Mode, and sessions without a Pair-capable adapter must execute Frontend Engineer autonomously rather than infer
support from generic form elicitation or adapter presence.

The approved execution contract has also changed since this draft was first written: Approve & Run does not present a
second Pair/autonomous choice. A canonical Frontend Engineer Plan's `collaborationRecommendation` selects Pair when the
current host supports it; otherwise RunWield falls back to autonomous execution. Users change that recommendation during
the Review Loop, before approval. Runtime style remains ephemeral and is re-derived after context loss rather than
written to Plan Front Matter.

## Objective

Make Pair-recommended Frontend Engineer FEATURE Plans enter Pair Execution from the local TUI and render every Pair
checkpoint as a clear blocking TUI interaction. Ensure ACP, Headless Mode, legacy frontend Plans, and any session
without explicit Pair-checkpoint capability run Frontend Engineer autonomously with no Pair prompt or fabricated
checkpoint.

When an In-Progress Plan is recovered after runtime context loss, recover its execution owner and worktree context from
the Plan/recovery metadata, then derive the new runtime style from the Plan's recommendation and the currently attached
host. Do not persist or restore a stale runtime style.

## Approach

Keep `supportsHostedSessionInteraction(hostedSession, RuntimeInteractionTypes.PAIR_CHECKPOINT)` as the single capability
check introduced by Plan 02. The TUI interaction adapter advertises that interaction while attached; detaching the TUI
adapter removes the capability. Its Pair checkpoint renderer composes the existing `UiAPI.promptSelect` and
`UiAPI.promptText` primitives, keeping revision feedback atomic with the checkpoint response.

Make ACP's boundary explicit: ordinary select, text, approval, and Plan review interactions remain available according
to ACP client capabilities, but the ACP adapter never advertises Pair support and rejects a Pair checkpoint without
sending `elicitation/create`. Headless/no-adapter sessions naturally fail the same explicit capability check.

At execution start and Plan Recovery, use the loaded Plan as the source of truth. Canonical Frontend Engineer plus a
`pair` recommendation activates Pair only in a currently Pair-capable host. Canonical autonomous recommendations,
Engineer-owned Plans, legacy `frontend: true`, ACP, Headless Mode, and no-adapter sessions select autonomous without an
interaction. Keep the active style visible in the live SessionRuntime snapshot for consumers, but do not make the
snapshot or Session Transcript durable recovery state.

## Files to Modify

- `src/ui/tui/runtime-interaction-adapter.js` — advertise only Pair-checkpoint capability and render checkpoint context,
  decisions, revision feedback, cancellation, switch-to-autonomous, and intentional stop through existing TUI prompt
  primitives.
- `src/ui/tui/runtime-adapter.js` — keep Pair capability scoped to the lifetime of the attached TUI Runtime adapter and
  clear it on disposal/replacement.
- `src/acp/interaction-mapper.js` — explicitly withhold Pair capability and reject Pair checkpoint requests before ACP
  form elicitation while preserving existing ordinary interaction behavior.
- `src/shared/workflow/workflow.js` — derive runtime collaboration style from canonical Plan recommendation plus
  explicit Pair capability, with autonomous fallback and no pre-execution style prompt.
- `src/cmd/load-plan/index.js` — keep Plan Recovery focused on owner/worktree rehydration and allow execution startup to
  re-derive collaboration style from current Plan and host capability instead of restoring transient Pair state.
- `src/ui/tui/runtime-interaction-adapter.test.js` — cover Pair capability, complete checkpoint rendering/decisions,
  atomic revision feedback, and both selection and feedback cancellation.
- `src/ui/tui/runtime-adapter.test.js` — cover installation and removal of the real TUI interaction adapter so Pair
  capability exists only while the TUI is attached.
- `src/acp/server.test.js` — cover explicit lack of Pair capability, unsupported Pair requests with no elicitation, and
  preservation of ordinary ACP form interactions.
- `src/shared/session/session-runtime.test.js` — cover live snapshot projection of execution owner, recommendation,
  selected style, and checkpoint count without exposing internal Session objects.
- `src/shared/workflow/workflow.test.js` — cover the complete host/recommendation policy matrix, no redundant style
  prompt, and autonomous fallback messaging.
- `src/cmd/load-plan/index.test.js` — cover In-Progress Frontend Engineer Plan Recovery without persisted style and
  prove that resumed execution receives the Plan metadata needed for current-host style derivation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime-interactions.js#supportsHostedSessionInteraction` — use the explicit interaction
  capability check from Plan 02; do not add a parallel host enum or infer Pair from generic interactions.
- `src/shared/session/session-runtime-interactions.js#requestHostedSessionInteraction` — retain adapter-neutral request,
  cancellation, and Runtime event behavior.
- `src/ui/tui/api.js#UiAPI.promptSelect` and `UiAPI.promptText` — render checkpoints with established blocking TUI
  controls rather than creating a Pair-specific component system.
- `src/tools/pair-checkpoint.js#createPairCheckpointTool` — preserve its structured response values and capability-loss
  behavior; the host adapter only renders and returns the user's direction.
- `src/shared/workflow/workflow.js#selectRuntimeCollaborationStyle` — keep style resolution before worktree/lifecycle
  mutation and based on the loaded Plan policy.
- `src/cmd/load-plan/index.js#rehydrateActiveRecoveryWorkflow` — recover execution ownership and worktree context
  without treating runtime collaboration style as durable Plan state.
- `src/shared/session/session-runtime.js#getSessionSnapshot` — project a shallow copy of current active execution state
  for live consumers without exposing `HostedSession`.

## Implementation Steps

- [ ] Confirm the adapter contract treats support as explicit opt-in: missing adapters, missing/throwing
      `supportsInteraction`, and generic select/text support all return false for Pair Execution.
- [ ] Keep the TUI adapter's Pair capability narrowly scoped to `RuntimeInteractionTypes.PAIR_CHECKPOINT`; do not claim
      a shared browser surface for other hosts or add a separate host-type switch.
- [ ] Render checkpoint summary, checkpoint number when available, route, application state, viewport, evidence notes,
      diagnostics, and proposed next increment in a bounded readable TUI prompt while tolerating omitted optional data.
- [ ] Present decision labels for continue, revise this increment, finish autonomously, and stop while keeping the Plan
      In Progress. Preserve the response values expected by `pair-checkpoint` and keep explicit stop distinct from
      prompt cancellation.
- [ ] On revise, collect non-empty feedback with `promptText` and return it atomically in response `_meta.feedback`;
      canceling either the decision prompt or feedback prompt returns a canceled interaction with no fabricated user
      direction.
- [ ] Verify `attachTuiRuntimeAdapter()` installs the Pair-capable interaction adapter for the target Session and its
      disposal removes that adapter only when disposing the active registration.
- [ ] Give the ACP adapter an explicit negative Pair capability and short-circuit `pair_checkpoint` as unsupported
      before checking form elicitation or contacting the ACP client. Preserve Plan review and ordinary
      select/text/approval mappings unchanged.
- [ ] Keep execution style selection non-interactive. For canonical Frontend Engineer Plans, use `pair` only when the
      Plan recommends Pair and the current adapter explicitly supports Pair checkpoints; otherwise use autonomous.
- [ ] Keep Engineer-owned Plans and all legacy ownership sources autonomous. When a canonical Pair recommendation is
      unavailable in the current host, emit one clear status and continue autonomously without marking execution failed.
- [ ] Ensure sessions with no interaction adapter—including Headless Mode—take the same autonomous fallback path and do
      not attempt a select, text, or Pair checkpoint interaction.
- [ ] Preserve active owner/recommendation/style/checkpoint fields in live SessionRuntime snapshots so TUI/ACP consumers
      can inspect current execution state, without persisting runtime style as recovery metadata.
- [ ] On In-Progress Plan Recovery, rehydrate the execution owner and existing worktree/non-Git context from current
      Plan metadata. Leave collaboration style unset until `executePlan()` reloads the Plan and derives style against
      the newly attached host; never reuse a lost Pair choice or add a recovery style prompt.
- [ ] Add focused TUI, ACP, SessionRuntime, workflow, and Plan Recovery regression tests for these boundaries.
- [ ] Run focused tests, then run `deno task ci` and fix all failures.

## Verification Plan

- Automated: run `deno test -A src/ui/tui/runtime-interaction-adapter.test.js src/ui/tui/runtime-adapter.test.js` and
  verify TUI-only Pair capability, readable checkpoint context, all four decisions, atomic revision feedback,
  cancellation semantics, and adapter attach/dispose lifetime.
- Automated: run `deno test -A src/acp/server.test.js` and verify ACP continues ordinary form elicitation but reports
  Pair checkpoints unsupported without issuing `elicitation/create`.
- Automated: run `deno test -A src/shared/workflow/workflow.test.js` and verify canonical Pair recommendation activates
  Pair only with explicit capability; autonomous recommendation, ACP/no-adapter hosts, Engineer Plans, and legacy
  frontend Plans remain autonomous; no execution-start style prompt occurs.
- Automated: run `deno test -A src/shared/session/session-runtime.test.js src/cmd/load-plan/index.test.js` and verify
  live snapshot projection plus context-loss recovery that restores owner/worktree context but re-derives style from the
  Plan and newly attached host.
- Automated: run `deno task ci` after implementation and fix all failures.
- Manual: from the local TUI, Approve & Run a canonical Frontend Engineer Plan with `collaborationRecommendation: pair`;
  confirm execution enters Pair without a second style prompt, then exercise continue, revise, finish autonomously, and
  stop across representative checkpoints.
- Manual: detach/cancel the TUI at a checkpoint and confirm cancellation remains distinct from stop; if Pair capability
  is lost while execution remains active, confirm Plan 02's tool behavior switches safely to autonomous without claiming
  approval.
- Manual: run a Pair-recommended Frontend Engineer Plan through ACP and a no-adapter/Headless Mode path; confirm both
  run autonomously with no Pair form/checkpoint while normal Runtime events and Task Completion remain consumer-ready.
- Manual: recover an In-Progress Pair-recommended Plan first from TUI and then from an incapable host; confirm the owner
  and worktree are preserved, TUI re-derives Pair, the incapable host derives autonomous, and no runtime style is
  written to Plan Front Matter.
- Expected results: TUI is the only Pair-capable host in this Epic; unsupported hosts remain autonomous without extra
  ceremony; Pair checkpoints stay non-terminal; Task Completion and Workflow Validation boundaries remain unchanged.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted;
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer`, including TUI work.
  - A canonical Frontend Engineer `pair` recommendation activates Pair only in a Pair-capable host; it falls back to
    autonomous elsewhere. Legacy `frontend: true` remains Frontend Engineer/autonomous compatibility behavior.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`.

## Edge Cases & Considerations

- Pair capability means both blocking interaction and the local shared-browser workflow; ACP form elicitation alone is
  insufficient.
- Adapter absence, adapter exceptions, prompt cancellation, explicit stop, and capability loss are distinct outcomes.
  This slice must not collapse them into approval or execution failure.
- The Planner recommendation is the approved runtime policy for new canonical Plans. Users who want the other style
  return Feedback during the Review Loop rather than receiving a second choice after Approve & Run.
- Legacy `frontend: true` is always autonomous even in TUI; do not add Pair ceremony or opportunistically rewrite it in
  this slice.
- Runtime recovery must not write `collaborationStyle`, checkpoint count, switch state, or pause state to Plan Front
  Matter or Session Transcript metadata.
- A live snapshot may expose current runtime state to consumers, but it is not durable recovery authority.
- If the TUI adapter is detached after Pair begins, the existing Pair checkpoint tool owns capability-loss fallback; the
  host adapter must not fabricate a continue decision.
- Keep TUI code Engineer-owned and pure JavaScript with JSDoc. This slice adds no browser-rendered RunWield UI and needs
  no dev server or browser verification for RunWield itself.
