---
planId: "08b0feb2-348b-4a47-a754-53c9d29bace9"
classification: "PROJECT"
complexity: "HIGH"
summary: "Implement Slice 1 of the ACP roadmap: refactor RunWield from a single-session global state model to a multi-session Hosted Session architecture. This is a high-complexity architectural shift requiring a TDD approach to ensure the existing TUI remains functional while enabling concurrent sessions. lauching as a PROJECT Epic."
affectedPaths:
    - "src/shared/session/session-state.js"
    - "src/shared/session/session.js"
    - "src/shared/interactive/chat-session.js"
    - "src/shared/workflow/orchestrator.js"
    - "docs/prd/runwield-acp-session-host-PRD.md"
frontend: false
createdAt: "2026-07-03T01:17:49-04:00"
updatedAt: "2026-07-06T18:44:35.061Z"
status: "verified"
origin: "internal"
type: "epic"
verifiedAt: "2026-07-06T18:44:35.061Z"
epicCompletionMode: "done_enough"
epicDoneEnoughAt: "2026-07-06T18:44:35.061Z"
epicDoneEnoughSummary: "Done enough for now: 6/6 child FEATUREs verified, 0 active/implemented, 0 remaining."
routingIntent: "PROJECT"
sessionName: "session host multi-session refactor"
---

# Session Host Multi-session Refactor

## Context

RunWield is betting on ACP as the long-term external integration contract, with Takopi/Telegram as an early adapter and
Workspace UI as a future client. The current runtime is still shaped around one interactive TUI session:
`session-state.js` stores active Agent, root Agent Session, active UI API, pending root swap, pending handoff,
model/thinking state, and active execution workflow as process-global state.

The PRD in `docs/prd/runwield-acp-session-host-PRD.md` defines four strategic slices. This Epic covers the first slice
only: create a multi-session Session Host and adapt the existing TUI to run through it with no intended behavior change.
ACP, Takopi, Slack/Discord, and native Telegram behavior remain future slices.

ADR-009 records the architectural decision to make Session Host the external integration boundary and to replace global
session state rather than preserve it through compatibility shims.

## Objective

Introduce a TUI-independent Session Host boundary that can own multiple Hosted Sessions in one process. Each Hosted
Session must own the state currently held globally for one root interactive session, including root Agent Session,
session manager, active Agent, active handler, sub-Agent Sessions, pending root swap, return-to-router handoff, active
execution workflow, model/thinking state, project-state context, and UI/event sink.

The first implementation objective is deliberately behavior-preserving for the current product: the existing TUI should
create and use one Hosted Session and continue to behave the same. The new capability proof is a TDD harness that can
run two Hosted Sessions concurrently in-process and demonstrate isolation of active Agent state, root session state,
pending swaps/handoffs, model state, and workflow state.

This plan references `docs/adr/009-session-host-as-external-integration-boundary.md`.

## Vertical Slice Findings

Current state ownership is centralized in `src/shared/session/session-state.js`. Callers import getters/setters directly
from TUI, slash dispatch, workflow, commands, and tools. Key examples:

- `src/shared/interactive/chat-session.js` owns interactive setup and submission flow, calls `setActiveAgent()`, queues
  pending root swaps, applies swaps at turn boundaries, reads root session/model/thinking state for footer and image
  handling, and calls the active handler.
- `src/shared/session/session.js` builds and reuses the root Agent Session through `ensureRootAgentSession()` and
  `runRootTurn()`, storing metadata in a module-level `WeakMap` keyed by the root session.
- `src/shared/session/agent-handler.js` decides whether to run the current root Agent Session or a transient one by
  comparing `getRootAgentName()` against the target Agent, then dispatches workflow outcomes.
- `src/shared/workflow/orchestrator.js` switches active Agents after Triage using `setActiveAgent()` and
  `applyPendingRootSwap()`.
- `src/shared/workflow/workflow.js` and `validation.js` use active execution workflow state to track Plan execution and
  validation context.
- Slash commands and command modules such as `resume`, `session`, `compact`, `copy`, and `load-plan` reach into root
  session state directly.

The main architectural seam is therefore not ACP. It is the runtime state boundary between one user-facing conversation
and the modules that execute turns/workflows. Session Host should become that seam; the TUI should be one adapter at the
seam.

## Files to Modify

- `src/shared/session/session-state.js` — replace singleton mutable state with per-HostedSession state ownership. Either
  remove the module or reduce it to types/helpers that do not hold process-global session state.
- `src/shared/session/session-host.js` (new) — define the Session Host interface and implementation for creating,
  loading, tracking, prompting, cancelling, and disposing Hosted Sessions.
- `src/shared/session/hosted-session.js` (new) — define the Hosted Session state container and behavior for one RunWield
  Agent Session lineage.
- `src/shared/session/session.js` — make root Agent Session construction, metadata, prompt execution, abort, steer,
  reload, and skill/template expansion operate against a Hosted Session rather than implicit globals.
- `src/shared/session/root-session.js` — keep Pi `SessionManager` persistence helpers reusable, but expose
  creation/loading in a way Session Host can call per cwd/session id.
- `src/shared/session/agent-handler.js` — make workflow-aware message handling use Hosted Session state and avoid global
  root comparisons.
- `src/shared/interactive/chat-session.js` — adapt TUI boot, submission, footer state, active Agent switching, pending
  root swaps, steering UI, model/thinking controls, and `/new` behavior to one Hosted Session.
- `src/shared/interactive/slash-dispatch.js` — pass Hosted Session context into slash command dispatch instead of
  reading root session globals.
- `src/shared/workflow/orchestrator.js` — scope Triage dispatch, active Agent switching, session naming, and post-triage
  workflow continuation to the current Hosted Session.
- `src/shared/workflow/workflow.js` — scope active execution workflow state and root-message access to the current
  Hosted Session.
- `src/shared/workflow/validation.js` — scope validation workflow access to the current Hosted Session.
- `src/cmd/resume/index.js` — resume should load or replace the TUI's current Hosted Session rather than setting a
  global root SessionManager.
- `src/cmd/load-plan/index.js` — load-plan recovery/execution flows should receive Hosted Session context when they need
  active Agent/workflow state.
- `src/cmd/session/index.js`, `src/cmd/compact/index.js`, `src/cmd/copy/index.js` — read the current Hosted Session
  instead of global root session state.
- `src/tools/return-to-router.js` — record pending handoff and root switch intent on the active Hosted Session.
- `src/tools/plan-written.js` — use Hosted Session context for session manager access and review-loop workflow
  follow-up.
- Existing tests under `src/shared/session/`, `src/shared/interactive/`, `src/shared/workflow/`, `src/cmd/`, and
  `src/tools/` — update behavior tests to exercise Session Host interfaces instead of globals.
- New Session Host tests — add integration-style tests proving two Hosted Sessions can coexist and run isolated state
  transitions in-process.

## Reuse Opportunities

- `src/shared/session/root-session.js` — reuse `getRunWieldSessionDir()`, `createRootSessionManager()`, image directory
  helpers, and export helpers as persistence primitives behind Hosted Sessions.
- `src/shared/session/session.js` — reuse `buildAgentSession()`, `runPrompt()`, `attachUiSubscribers()`, model
  resolution, skill/template loading, custom tool resolution, and existing Agent Session construction; move
  ownership/context rather than rewriting the agent runtime.
- `src/shared/session/active-agent-session.js` — reuse persisted active-Agent markers, but scope reads/writes to the
  Hosted Session's SessionManager.
- `src/shared/interactive/chat-session.js` — reuse TUI rendering, footer, image paste, submission queue, and slash
  command flow as the TUI adapter over one Hosted Session.
- `src/shared/workflow/orchestrator.js` and `src/shared/session/agent-handler.js` — reuse existing workflow decision
  logic, but pass Hosted Session context through the public interface.
- Existing regression tests — keep behavior assertions for Router handoff, agent switching, plan execution workflow,
  validation, model switching, resume, and slash command dispatch; these become high-value safety tests for the
  refactor.
- `@earendil-works/pi-coding-agent` SessionManager and AgentSession primitives — keep using the underlying Pi library
  rather than inventing a new transcript/session storage format.

## Verification Plan

- Automated: begin each child FEATURE with TDD. Write one behavior-level test, make it fail, implement the minimal
  Host/session change, and repeat. Avoid horizontal batches of speculative tests.
- Automated: add an early tracer-bullet test through the new Session Host public interface proving two Hosted Sessions
  can be created with independent ids and independent active Agent/model/pending state.
- Automated: add an integration-style two-session test proving a pending root swap or return-to-router handoff in
  session A does not affect session B.
- Automated: preserve existing TUI behavior tests by adapting them to the Hosted Session-backed TUI; no expected
  user-visible behavior should change.
- Automated: preserve workflow tests for Triage dispatch, Plan execution state, validation, `load-plan`, `resume`,
  `compact`, `copy`, and `return_to_router` after state scoping.
- Automated: run `deno run ci` after implementation changes and fix all issues.
- Manual: start the TUI normally, submit a request, confirm Router starts, specialist handoff persists as the active
  Agent, `/new` resets the conversation, `/agent router` returns to routing, `/model` and thinking controls still update
  footer/state, and `/resume` restores prior active Agent behavior.
- Manual: run a simple FEATURE planning flow through Plannotator and confirm approval/save/feedback behavior remains
  unchanged.
- Manual: run a small QUICK_FIX or OPERATION flow and confirm execution/validation state does not regress.

## Edge Cases & Considerations

- **Session leakage:** The central risk is session A mutating session B's active Agent, model override, pending root
  swap, active execution workflow, or root Agent Session. The first TDD harness should make this impossible to miss.
- **Module-level metadata:** `session.js` stores root metadata in a module-level `WeakMap`. It may remain module-level
  if keys are actual AgentSession objects, but access must be mediated by Hosted Session ownership so callers cannot
  accidentally use the wrong root.
- **TUI-only assumptions:** Some helpers call `getActiveUiAPIState()` as a fallback. Hosted Sessions need an event
  sink/UI adapter abstraction so headless future clients are not forced to provide TUI APIs.
- **Slash command context:** Slash commands currently read root state directly. Commands should receive session context
  through command options so future ACP/Workspace invocations can reuse them deliberately.
- **Workflow cwd:** `CWD` remains the primary project root today. Plan/worktree execution already has explicit execution
  cwd plumbing, but Hosted Sessions need cwd guards so future multi-project sessions do not accidentally share
  primary-project assumptions.
- **Branch isolation:** The refactor should happen on an isolation branch because it intentionally breaks internal
  assumptions before restoring behavior.
- **No frontend verification:** This Epic does not change Workspace UI or browser UX directly. If a later child FEATURE
  starts Workspace UI integration, that child should set `frontend: true` and use headed browser verification.
- **ACP is not in scope:** Do not implement ACP in this Epic's child FEATUREs until the Session Host boundary can drive
  the existing TUI with no intended behavior change and has a two-session isolation test harness.
