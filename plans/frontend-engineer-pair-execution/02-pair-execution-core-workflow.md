---
planId: "70d7d21d-c9e6-46b4-a5ea-288feb542c30"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add runtime Pair Execution selection and non-terminal visual checkpoints for Frontend Engineer while preserving Task Completion, Plan Lifecycle, and Workflow Validation boundaries."
affectedPaths:
    - "src/agent-definitions/frontend-engineer.md"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/workflow/decisions.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/tools/pair-checkpoint.js"
    - "src/tools/task-completed.js"
    - "src/tools/registry.js"
    - "src/shared/session/tool-event-title.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/pair-execution.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/session/agent-switching.test.js"
    - "src/shared/session/tool-event-title.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/tools/__tests__/pair-checkpoint.test.js"
    - "src/tools/__tests__/task-completed.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-18T11:02:23-04:00"
updatedAt: "2026-07-22T13:56:09.264Z"
status: "implemented"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 2
dependencies:
    - "01-frontend-engineer-autonomous-execution-foundation"
implementedAt: "2026-07-22T13:56:09.264Z"
executionReport: "- Implemented Pair Execution runtime workflow: recommendation-aware pre-start selection, runtime-only active workflow state, workflow-scoped `pair_checkpoint`, checkpoint transitions, pause/cancel handling, and autonomous fallback.\n- Updated Frontend Engineer prompt/definition, static tool policy, Task Completion guards, Agent Handler pause behavior, runtime interaction capability checks, and Runtime tool event titles.\n- Added/replaced focused coverage for workflow selection/dispositions, pair checkpoint behavior, Task Completion rejection, session/tool policy, same-root continuation, and tool title identity.\n- Verification passed: `deno test -A src/shared/workflow/workflow.test.js src/shared/workflow/pair-execution.test.js`.\n- Verification passed: `deno test -A src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/task-completed.test.js`.\n- Verification passed: `deno test -A src/shared/session/hosted-session.test.js src/shared/session/agent-handler.test.js src/shared/session/agent-switching.test.js src/shared/session/__tests__/session-tools-policy.test.js`.\n- Verification passed: `deno test -A src/shared/session/tool-event-title.test.js`.\n- Verification passed: `deno task ci` (1503 tests passed; release build/smoke check passed)."
humanReviewMode: null
humanReviewDecision: null
executionBaselineTree: "cedc06d0d7185ddec17c864222bc640fde027692"
worktreeId: "a5c49991"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-frontend-engineer-pair-execution-02-pair-executi-a5c49991"
worktreeBranch: "runwield/worktree/frontend-engineer-pair-execution-02-pair-executi-a5c49991"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
---

# Pair Execution Core Workflow

## Context

Plan 01 established **Frontend Engineer** as the owner of materially visual or interactive browser FEATURE Plans while
leaving all execution autonomous. This slice adds the core **Pair Execution** semantics: a capable Session Host may ask
the user to choose Pair or autonomous execution before work starts, and Pair execution may block after coherent visible
increments without ending the Frontend Engineer Agent Session or entering Workflow Validation.

Main currently contains partial Pair remnants from an earlier implementation: a checkpoint interaction type and tool,
TUI rendering, a protected-tool registry entry, and a `pairStopRequested` guard. They do not form a safe workflow. There
is no runtime collaboration style, the tool can be statically exposed, cancellation is treated as explicit stop,
switch-to-autonomous does not change workflow state, and Task Completion can emit terminal side effects after a stop.
This Plan replaces those remnants with the approved runtime-only contract.

Host-specific Pair capability advertisement and rendering remain Plan 03 scope. This slice consumes only an explicit
Pair-checkpoint capability exposed through the existing interaction adapter contract; it does not modify TUI or ACP
adapters. Pair metrics, active Plan migration, Skills, and user documentation remain Plan 04 scope.

## Objective

Add Pair/autonomous runtime selection for canonical Frontend Engineer FEATURE Plans and a workflow-scoped
`pair_checkpoint` Custom Tool. Pair checkpoints must return structured continue, revise, switch-to-autonomous, or stop
directions while preserving the same active execution workflow, worktree, and Frontend Engineer Agent Session.

A checkpoint, checkpoint cancellation, or explicit stop must never emit Task Completion, record a Plan Event, start
Workflow Validation, or mark execution failed. Task Completion remains the only implementation-to-validation boundary.

## Approach

Resolve collaboration style after Plan policy/status validation but before worktree creation, `execution_started`, or
Agent switching. A canonical `executionAgent: frontend-engineer` Plan gets a Pair/autonomous choice only when the
Session Host explicitly reports support for `pair_checkpoint`; the Plan's `collaborationRecommendation` supplies the
prompt's recommendation/default but does not decide the result. Incapable hosts and legacy `frontend: true` Plans
continue autonomously without ceremony. Canceling the pre-execution choice leaves the Plan Ready For Work and creates no
active execution workflow.

Store the selected and current style only in `HostedSession.activeExecutionWorkflow`, alongside checkpoint count and
transient pause/switch state. For Pair style, construct `pair_checkpoint` directly in workflow code and pass it through
the existing `runActiveAgentTurn(...customTools)` seam. Do not add it to the base Frontend Engineer Agent Definition or
make it available through static Agent tool-name resolution.

The checkpoint tool uses `requestHostedSessionInteraction()` and returns structured model-facing results. Continue and
revise keep Pair active; revise includes non-empty user feedback; switch-to-autonomous changes the active style and
makes future checkpoint calls inactive; stop marks the current turn as intentionally paused while leaving the Plan In
Progress and resumable. Adapter cancellation remains distinct from stop, and unsupported/blocked capability loss
switches safely to autonomous without fabricating approval. Both `task_completed` and the Agent Handler defensively
reject Task Completion from a turn paused by stop/cancellation.

## Files to Modify

- `src/agent-definitions/frontend-engineer.md` — replace the autonomous-only contradiction with conditional Pair
  instructions: checkpoint only when the workflow supplies the tool and Pair context, preserve browser evidence, obey
  revise/switch/stop, and retain autonomous and Task Completion discipline.
- `src/shared/workflow/workflow.js` — resolve collaboration style before execution mutation, preserve legacy autonomous
  compatibility, initialize Pair state, inject the workflow Custom Tool, and return explicit paused/canceled execution
  results without treating them as failures.
- `src/shared/workflow/workflow-prompts.js` — add the recommendation-aware Pair/autonomous choice text and include the
  selected runtime style in the Frontend Engineer execution request.
- `src/shared/workflow/decisions.js` — normalize collaboration selection and post-execution completed/paused/canceled
  outcomes so only completed execution enters validation.
- `src/shared/session/hosted-session.js` — extend `ActiveExecutionWorkflow` with current collaboration style,
  recommendation, checkpoint count, switch state, and a typed transient Pair pause reason.
- `src/shared/session/agent-handler.js` — preserve the Frontend Engineer root across checkpoints and later user turns,
  keep intentional Pair pauses non-terminal, and block same-turn completion after stop/cancellation.
- `src/shared/session/session.js` — remove tool-name-based `pair_checkpoint` construction so the tool can only arrive as
  an explicit workflow Custom Tool.
- `src/shared/session/session-runtime-interactions.js` — expose a small explicit capability check for an interaction
  type and retain `pair_checkpoint` as an adapter-neutral, non-terminal interaction.
- `src/tools/pair-checkpoint.js` — replace the partial tool with strict evidence inputs, Pair-state authorization,
  structured decisions, state transitions, cancellation/capability-loss handling, and no lifecycle or metric mutation.
- `src/tools/task-completed.js` — reject Task Completion without messages, metrics, or turn termination when the current
  Pair turn has been stopped or its checkpoint interaction was canceled.
- `src/tools/registry.js` — remove `pair_checkpoint` from protected static tool policy; workflow-provided `customTools`
  remain the only exposure path.
- `src/shared/session/tool-event-title.js` — provide a stable content-safe Pair checkpoint title and Runtime tool kind.
- Focused tests listed in Front Matter — replace stale partial assertions and cover selection, state transitions,
  workflow-scoped tool policy, same-session continuation, completion guards, and Runtime event identity.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js#resolvePlanExecutionPolicy` — use its canonical-versus-legacy `source` result so legacy
  `frontend: true` remains Frontend Engineer autonomous without a new Pair prompt.
- `src/shared/workflow/workflow.js#startActiveExecutionWorkflow` — keep it as the sole worktree and `execution_started`
  boundary after collaboration selection succeeds.
- `src/shared/session/agent-switching.js#runActiveAgentTurn` — pass the Pair tool through `customTools` while preserving
  the root Agent Session for non-terminal tool calls and later user turns.
- `src/shared/session/session-runtime-interactions.js#requestHostedSessionInteraction` — retain its cancellation,
  interaction-event, and adapter-neutral behavior.
- `src/tools/user-interview.js` — follow its structured interaction normalization patterns without reusing its product
  schema or turning checkpoints into Planner questions.
- `src/tools/task-completed.js#createTaskCompletedTool` — enforce the final implementation boundary before any semantic
  completion message, metric, or terminal result is emitted.
- `src/shared/session/tool-event-title.js#describeRuntimeTool` — extend the Runtime-owned semantic descriptor used by
  live and replay consumers rather than adding consumer-specific labels.

## Implementation Steps

- [ ] Replace the current partial Pair state with JSDoc typedefs/constants for `pair | autonomous`, checkpoint
      decisions, and transient pause reasons. Keep all executable code pure JavaScript.
- [ ] Add an adapter-neutral capability helper that returns true only when the active adapter explicitly reports support
      for `RuntimeInteractionTypes.PAIR_CHECKPOINT`; generic select/text support or adapter presence is insufficient.
- [ ] Add a recommendation-aware pre-execution select prompt for canonical Frontend Engineer Plans. Pair-capable hosts
      ask every time execution starts with fresh runtime state; incapable hosts, Engineer Plans, and legacy
      `frontend: true` Plans select autonomous without prompting.
- [ ] Treat pre-execution cancellation as a canceled execution attempt: do not create/reuse a worktree, set active
      execution state, switch Agent, emit `execution_started`, or change Plan Status.
- [ ] Initialize active execution state with `collaborationStyle`, `collaborationRecommendation`, `pairCheckpointCount`,
      and optional switch/pause fields. Never write the user's runtime choice to Plan Front Matter.
- [ ] Update the Frontend Engineer request and Agent Definition so Pair style means coherent visible increments,
      headed-browser evidence before each checkpoint, and no Task Completion until all work/final browser verification
      is complete; autonomous behavior remains unchanged when the tool is absent or style switches.
- [ ] Construct `createPairCheckpointTool({ hostedSession })` only for selected Pair Frontend Engineer execution and
      pass it directly through `runActiveAgentTurn` custom tools. Remove static registry/session construction while
      retaining the base Agent's normal `task_completed` tool.
- [ ] Define a strict checkpoint schema with required increment summary and optional route, application state, viewport,
      evidence notes, diagnostics, and next-increment framing. Do not require screenshots or carry binary browser data.
- [ ] Normalize checkpoint decisions to `continue`, `revise`, `switch_to_autonomous`, and `stop`. Require non-empty
      revision feedback for `revise`, return it in structured details, and keep the same Agent turn/session active.
- [ ] Increment the checkpoint-attempt count once per authorized Pair tool invocation. Continue/revise retain Pair;
      switch updates the current style to autonomous and records the switch in runtime state; later checkpoint calls
      return an inactive/autonomous result rather than prompting.
- [ ] Make explicit stop set a transient intentional-pause reason and return instructions not to call Task Completion.
      Leave the Plan In Progress, active workflow/worktree/root Agent intact, and clear the transient pause only when a
      later user turn deliberately resumes execution.
- [ ] Keep checkpoint cancellation distinct from stop and from capability loss. Cancellation pauses the current turn
      without approval or style mutation; unsupported/blocked interaction changes the style to autonomous and returns a
      capability-loss reason without claiming the increment was accepted.
- [ ] Reject same-turn `task_completed` after Pair stop/cancellation in both the tool boundary and Agent Handler, with
      no Task Completion message, metric, terminal tool outcome, `implementation_finished`, or validation dispatch.
- [ ] Return explicit execution dispositions for completed, intentionally paused, pre-start canceled, and ordinary
      interrupted execution. Only completed dispatches Workflow Validation; Pair pause stays with Frontend Engineer and
      uses expected collaboration messaging rather than failure messaging.
- [ ] Add a stable Pair checkpoint Runtime tool title based on a bounded summary preview and a non-mutating tool kind;
      verify interaction requested/resolved/canceled events remain ordinary non-terminal Runtime events.
- [ ] Replace stale cases in `pair-execution.test.js`, add dedicated tool/Task Completion tests, and cover at least two
      continue/revise checkpoints with one HostedSession/root Frontend Engineer session and unchanged worktree state.
- [ ] Run focused tests, then run `deno task ci` and fix all failures.

## Verification Plan

- Automated: run `deno test -A src/shared/workflow/workflow.test.js src/shared/workflow/pair-execution.test.js` and
  verify canonical Frontend Engineer selection, recommendation defaults, legacy/incompatible-host autonomous behavior,
  pre-start cancellation with zero lifecycle/worktree mutation, workflow-scoped tool injection, and
  completed-versus-paused Workflow Decisions.
- Automated: run `deno test -A src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/task-completed.test.js`
  and verify strict schema, continue/revise/switch/stop transitions, required revision feedback, checkpoint counts,
  inactive calls, unsupported/blocked fallback, cancellation distinct from stop, no metrics/lifecycle mutation, and no
  Task Completion side effects after a paused Pair turn.
- Automated: run
  `deno test -A src/shared/session/hosted-session.test.js src/shared/session/agent-handler.test.js src/shared/session/agent-switching.test.js src/shared/session/__tests__/session-tools-policy.test.js`
  and verify active-state invariants, two checkpoints in one Frontend Engineer root Agent Session, resumable stop
  behavior, custom-tool persistence, and no static Pair tool exposure.
- Automated: run `deno test -A src/shared/session/tool-event-title.test.js` and verify the Pair checkpoint descriptor is
  stable, content-safe, and shared by live/replay Runtime events.
- Automated: run `deno task ci` after implementation and fix all failures.
- Manual: in a Session Host that explicitly advertises Pair-checkpoint support, execute a canonical Frontend Engineer
  test Plan, confirm the recommendation is visible but overridable, choose Pair, accept one increment, revise a second,
  then switch to autonomous and confirm the same Agent Session/worktree continues to final Task Completion.
- Manual: stop at a checkpoint, confirm the Plan remains In Progress with no Task Completion or Workflow Validation,
  then send a later resume direction and confirm Pair execution continues in the same live context.
- Manual: cancel the pre-execution choice and confirm the Plan remains Ready For Work with no worktree or lifecycle
  mutation; simulate checkpoint capability loss and confirm execution reports the loss and continues autonomously
  without claiming user approval.
- Expected results: Pair checkpoints are implementation collaboration only; only final Task Completion can record
  implementation completion and start Workflow Validation.

## Edge Cases & Considerations

- The partial Pair implementation on main is not an established compatibility contract. Where it conflicts with this
  Plan, the Epic PRD and verified Plan 01 boundaries are authoritative; remove or replace the experimental behavior.
- Pair selection and checkpoint state are ephemeral runtime data. Lost-context recovery and re-asking style belong to
  Plan 03; do not persist style in Plan Front Matter or Session Transcript metadata in this slice.
- Legacy `frontend: true` is a compatibility path fixed to autonomous Frontend Engineer execution. Do not introduce new
  interaction ceremony or silently migrate the Plan here.
- A Pair tool may remain physically present in an already-running root Agent Session after switch-to-autonomous; its
  runtime state guard must make subsequent calls inert without rebuilding and losing Agent context.
- Checkpoint count represents attempts, not percentage complete, acceptance, quality, or validation progress.
- Revision feedback may refine visual treatment within the approved Plan. Capability, information architecture,
  security, or material scope changes still require Scope Escalation or renewed planning.
- Pair stop, adapter cancellation, model interruption, and capability loss are distinct outcomes even when each leaves
  partial implementation in the worktree.
- Do not add Pair metrics in this slice. Plan 04 owns opt-in content-safe telemetry and must never capture checkpoint
  feedback, screenshots, routes/URLs, source content, diagnostics payloads, or evidence paths.
- Host labels/layout, TUI capability advertisement, ACP/Headless Mode policy, and runtime-loss reconstruction remain
  Plan 03 scope; this Plan changes no host adapter implementation.
