---
planId: "d26b8dd4-b04c-4130-849a-cacd1b93db84"
classification: "FEATURE"
complexity: "HIGH"
summary: "Automatically continue an Epic with its next ordered child FEATURE Plan in a fresh core-owned Session after successful Workflow Validation."
affectedPaths:
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/epic-continuation.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/cmd/load-plan/index.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/chat-session.js"
    - "src/acp/session-map.js"
    - "src/acp/server.js"
    - "docs/workflows.md"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-22T08:32:40-04:00"
updatedAt: "2026-07-23T02:48:01.126Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-23T02:42:14.284Z"
verifiedAt: "2026-07-23T02:47:51.617Z"
executionReport: "- Implemented typed Workflow Validation results and propagated verified/paused/failed outcomes through validation, orchestrator, agent handler, Runtime, `/load-plan`, TUI, and ACP paths.\n- Added strict Epic child continuation resolver/runner with canonical ordering, terminal-sibling skipping, dependency blocking, readiness execution, fresh Session replacement event, TUI rebinding, and ACP stable-ID remapping.\n- Updated `docs/workflows.md` and `docs/usage.md` for default Epic auto-continuation and fresh Session boundary.\n- Added focused tests for Epic continuation resolution, `session_replaced` event validation, and ACP runtime-session remapping.\n- Verification passed: `deno test -A src/shared/workflow/epic-continuation.test.js src/shared/session/session-runtime-events.test.js src/acp/session-map.test.js`; `deno check ...`; `deno task ci`.\n- Manual TUI/ACP end-to-end scenarios from the plan were not run in an interactive client; automated CI passed."
workRecord:
    status: "generated"
    recordId: "bf81ff83-73b6-47a8-a3ae-4cf05bc3ca5d"
    path: "docs/work-records/2026-07-23-automatic-epic-child-session-continuation.md"
    lastAttemptAt: "2026-07-23T02:47:51.669Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Automatic Epic Child Session Continuation

## Context

After a child FEATURE Plan passes Workflow Validation, RunWield currently leaves the verified Plan in the active
Session. The Plan Lifecycle may mark the parent Epic done enough when every child is verified, but otherwise the user
must manually load the Epic and select the next child. `/load-plan` already provides canonical child ordering and a
manual next-child shortcut, while `/new` demonstrates the desired fresh Session boundary.

The requested behavior is core-owned and enabled for every Epic: after canonical verification, finish the current
post-verification work, replace the old Session with a fresh persisted Session, then immediately begin planning or
execution for the next child. TUI and ACP are SessionRuntime consumers that follow the core replacement rather than
owning Epic advancement.

## Objective

Automatically advance an active Epic through strictly ordered child FEATURE Plans without carrying the previous root
context forward. The fresh Session starts Planner for `draft` or `feedback`, promotes and executes `approved`, and
executes `ready_for_work`. The chain stops with a clear reason when the earliest remaining child has unmet dependencies,
is on hold, needs recovery, has an unsupported status, or when the parent Epic is no longer active.

## Approach

Make successful Workflow Validation return a typed semantic result only after verified metadata is canonical, merge
verification and cleanup bookkeeping have settled, and Manual QA/Work Record handoffs have run. Propagate that result to
a Runtime-owned Epic continuation coordinator rather than triggering from the low-level `validation_passed` Plan Event,
which may be staged in an execution worktree before merge-back.

Add a shared Epic continuation resolver that reloads the completed child and parent from the primary Project, sorts
sibling FEATURE Plans with `compareChildPlansByOrder`, skips terminal siblings, and examines only the earliest remaining
child. It resolves dependencies without the manual “proceed anyway” escape hatch and returns a typed
plan/execute/blocked/complete action.

At a safe post-turn boundary, SessionRuntime creates a new persisted Session using the same internal new-session
primitives as `/new`, transfers the active interaction capability, publishes a typed Session replacement event, retires
the old Session, and runs the resolved child workflow. The coordinator repeats only after another successful
verification. Adapters rebind to the replacement before child output or interactions begin; ACP preserves its stable
client-facing Session ID while remapping the internal Runtime Session.

## Files to Modify

- `src/shared/workflow/validation.js` — return explicit verified/paused/failed results and ensure only post-merge
  canonical success can request Epic continuation.
- `src/shared/workflow/epic-continuation.js` — add strict-order child resolution and the shared planning/execution
  continuation flow.
- `src/shared/workflow/orchestrator.js` — propagate validation results from Router-started FEATURE workflows into the
  Runtime boundary.
- `src/shared/session/agent-handler.js` — carry validation continuation results out of direct and resumed execution
  paths without stale final-Agent or attention behavior.
- `src/shared/session/session-runtime.js` — coordinate safe old-to-new Session replacement and run successive child
  workflows.
- `src/shared/session/session-runtime-events.js` — define and validate the adapter-neutral Session replacement event
  contract.
- `src/cmd/load-plan/index.js` — route command-started validation through the same core continuation result and suppress
  old-Session restoration after replacement.
- `src/ui/tui/runtime-adapter.js` and `src/ui/tui/chat-session.js` — follow core replacement, rebind Runtime state, and
  clear the visible transcript/panels exactly once without double-closing the old Session.
- `src/acp/session-map.js` and `src/acp/server.js` — atomically remap the stable ACP Session ID, subscriptions,
  interactions, cancellation, and cleanup to the replacement Runtime Session.
- `docs/workflows.md` and `docs/usage.md` — document default Epic auto-continuation, strict blocking behavior, and the
  fresh Session boundary.
- Corresponding tests beside the modules above — cover result propagation, selection, event ordering, adapter rebinding,
  and complete chains.

## Reuse Opportunities

- `src/plan-store.js` — reuse `findPlansByParent`, `compareChildPlansByOrder`, and `resolveSiblingChildPlanDependencies`
  for canonical ordering and dependency checks.
- `src/shared/workflow/plan-lifecycle.js` — reuse `recordPlanEvent(... readiness_passed ...)` for an approved next
  child; do not add a status transition solely for continuation.
- `src/shared/workflow/workflow.js` and `src/shared/workflow/decisions.js` — reuse planning, execution, and Workflow
  Decision handling instead of duplicating Planner/Engineer dispatch semantics.
- `src/shared/session/session-runtime.js` — reuse `createPromptReadySession`, Session snapshots, event subscriptions,
  and Session closure mechanics underlying `/new`.
- `src/cmd/new/index.js` — preserve its observable reset behavior as the TUI reference while keeping the new automation
  in core.
- `src/acp/session-map.js` — extend the existing forward/reverse ID maps rather than introducing a second ACP identity
  layer.

## Implementation Steps

- [ ] Define a JSDoc-typed Workflow Validation result and update every exit from `runValidationLoop` to distinguish
      verified, paused, and failed outcomes. Return verified only after canonical merge/in-place persistence, post-merge
      verification, and FEATURE post-verification handoffs; update validation tests for all terminal and early-return
      paths.
- [ ] Add `src/shared/workflow/epic-continuation.js` with a pure canonical resolver. Require the completed Plan to be a
      verified child FEATURE, require an active non-held PROJECT Epic, sort siblings by existing child order, skip only
      `verified` and `closed_without_verification`, inspect the first remaining child only, require every declared
      dependency to resolve as verified, and map statuses to plan, readiness-plus-execute, execute, or a blocking
      reason.
- [ ] Build the shared child continuation runner from existing Planner, Workflow Decision, Readiness Gate, Engineer, and
      validation primitives. Start Planner for `draft`/`feedback`; record `readiness_passed` then execute `approved`;
      execute `ready_for_work`; preserve explicit Plan review outcomes such as Approve for Later by stopping when
      planning returns a save decision; never auto-recover or bypass holds/dependencies.
- [ ] Propagate successful validation results through `dispatchPostTriage`, `createAgentHandler`, direct/resumed
      execution, and `/load-plan` so SessionRuntime sees the same continuation request regardless of how the child
      workflow began. Suppress final-Agent restoration and `agentStopped` attention when a replacement is pending.
- [ ] Add a Runtime-owned replacement transaction that waits for the old turn/busy operation to settle, creates a new
      persisted Session, carries over the interaction adapter long enough for uninterrupted review prompts,
      names/associates the new Session with the next child, emits a validated `session_replaced` event with old/new IDs,
      reason, Epic, child, and action, and closes the old Session without losing the replacement event. Start child work
      only after consumers can rebind, and repeat the transaction only after another verified result.
- [ ] Update the TUI Runtime adapter and chat Session owner to consume `session_replaced`, switch to the supplied
      Runtime Session without invoking `/new`, reset messages, validation state, usage, queued display, images, editor,
      telemetry, and interaction binding once, and avoid closing an already retired old Session.
- [ ] Add an atomic ACP Session-map replacement operation and update prompt handling so the ACP-facing Session ID
      remains stable while event subscriptions, interaction adapter installation, cancellation, prompt cleanup, and
      close operations always resolve the current Runtime Session ID. Keep the replacement control event internal rather
      than rendering it as assistant text.
- [ ] Add focused unit/integration coverage: canonical order and name fallback; terminal sibling skipping; strict stop
      on the first blocked/held/recovery child; planning, approved readiness, and Ready For Work execution;
      standalone/orphan/done-enough/final-child no-op; one fresh Session per verified child; no replacement before old
      turn settlement; TUI reset/rebind; ACP stable-ID remap and cancellation; and no duplicate restoration, attention,
      or output.
- [ ] Update workflow and usage documentation, then run formatting and the full repository quality gate.

## Verification Plan

- Automated: run focused tests for `src/shared/workflow/validation.test.js`, the new Epic continuation tests,
  `src/shared/session/session-runtime.test.js`, `src/shared/session/session-runtime-events.test.js`,
  `src/shared/session/agent-handler.test.js`, `src/shared/workflow/orchestrator.test.js`,
  `src/cmd/load-plan/index.test.js`, `src/ui/tui/runtime-adapter.test.js`, `src/acp/session-map.test.js`, and
  `src/acp/server.test.js`.
- Automated: run `deno task ci` and fix every failure.
- Manual: create an Epic with ordered draft and Ready For Work child FEATURE Plans; verify one child and confirm Manual
  QA/Work Record output completes in the old Session, the transcript then clears, a new Session is named for the next
  child, and Planner or Engineer starts without another command.
- Manual: place an unmet dependency, on-hold child, or recovery-state child first in the remaining order and confirm the
  chain stops with that child and reason rather than skipping to a later executable child.
- Manual: verify the final child and confirm the Epic reaches its existing terminal behavior without creating an empty
  replacement Session.
- Manual: through ACP, keep one ACP Session ID across a child replacement and confirm continued events, interactions,
  cancellation, and close target the new Runtime Session.

## Edge Cases & Considerations

- Worktree validation stages `validation_passed` before merge-back; continuation must depend on the typed final
  validation result, never merely observe that staged status.
- The final child can auto-verify the parent Epic. Reload parent state after validation and do not create another
  Session when no child remains.
- A manually done-enough, on-hold, missing, or non-PROJECT parent stops automatic continuation even if unverified
  children remain.
- `closed_without_verification` children are terminal and skipped for ordering, but they do not satisfy another child’s
  dependency because dependency readiness still requires `verified`.
- The user chose global default behavior with no opt-in setting. Consequently, an already `approved` or `ready_for_work`
  next child executes automatically after its predecessor verifies; document this clearly.
- A planning child still honors Review Loop decisions: Feedback/cancellation remains with Planner, and Approve for Later
  stops rather than silently converting that explicit decision into Approve & Run.
- Session replacement must occur after old turn settlement so disposal cannot race active Agent work, queued messages,
  final-Agent restoration, or attention notifications.
- Generic SessionRuntime consumers need a typed replacement event and new Session ID; TUI and ACP must not import
  workflow internals to infer continuation themselves.
- `CONTEXT.md` currently says users load child FEATURE Plans independently. This feature changes that product
  relationship; recommend that Init or Ideator update the domain context separately rather than modifying `CONTEXT.md`
  or an ADR in this Plan.
