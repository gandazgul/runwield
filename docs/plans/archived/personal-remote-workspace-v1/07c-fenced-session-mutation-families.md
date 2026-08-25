---
planId: "d619386b-3fec-42db-a344-08557975370f"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Convert every deferred managed mutation family — rename, model, thinking, reload, compaction, local shell, image persistence, initialization, and workflow operations — into named fenced operations on the slice 7a executor."
affectedPaths:
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/managed-operation.ts"
    - "src/shared/session/session-runtime-method-policy.ts"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/agent-switching.js"
    - "src/shared/session/active-agent-session.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/session/workflow-messages.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/workflow/"
    - "src/tools/pair-checkpoint.ts"
objectiveChecks:
    - id: "OC1"
      command: "awk '/^export type ManagedOperationName/,/;$/' src/shared/session/managed-operation.ts | grep -q '\"local_shell\"'"
      rationale: "Red today: the union is exactly `\"prompt\"`, so the literal is absent. Pins the operation-name vocabulary that OC2 and OC5 depend on, so a family cannot be converted under an unrelated ad-hoc name that the sweep never sees."
    - id: "OC2"
      command: "awk '/^    async runLocalShellCommand\\(/,/^    }$/' src/shared/session/session-runtime.js | grep -q '#runManagedOperation'"
      rationale: "Red today: the 118-line body spawns the foreground shell directly with no executor reference and no managed rejection at all. Green requires the arbitrary shell spawn to route through the slice 7a executor. Deleting the method empties the awk range and still fails."
    - id: "OC3"
      command: "grep -q 'async persistSessionImage(' src/shared/session/session-runtime.js && ! awk '/^    async persistSessionImage\\(/,/^    }$/' src/shared/session/session-runtime.js | grep -q 'persistImageAttachment'"
      rationale: "Red today: the body calls persistImageAttachment directly, which is the pre-activation disk write that orphans a file when the submission loses the race. Green requires the write to leave this standalone entry point. The first clause blocks the cheap fake of deleting the method, and OC6 catches moving the write into another unfenced helper."
    - id: "OC4"
      command: "awk '/#rejectManagedPublicMutation\\(hostedSession, operation, capability = null\\) \\{/,/^    }$/' src/shared/session/session-runtime.js | grep -q 'managed_operation_in_progress' && ! awk '/#rejectManagedPublicMutation\\(hostedSession, operation, capability = null\\) \\{/,/^    }$/' src/shared/session/session-runtime.js | grep -q 'managed_unsupported'"
      rationale: "Red today on the second clause: the helper's fallback return is `managed_unsupported`, the slice 4 compatibility gate this slice removes. The first clause keeps the awk range anchored so a renamed signature cannot pass by yielding an empty range. Returning null instead would open unfenced mutation, which OC5 catches."
    - id: "OC5"
      command: "test -f src/shared/session/fenced-mutation-families.test.ts && grep -q 'SESSION_RUNTIME_METHOD_POLICY' src/shared/session/fenced-mutation-families.test.ts && grep -q 'fenced_standalone_mutation' src/shared/session/fenced-mutation-families.test.ts && deno run -A scripts/run-tests.js -A --no-check src/shared/session/fenced-mutation-families.test.ts"
      rationale: "Red today: the file does not exist, so the guard fails before the runner. This is the primary gate. Requiring the sweep to enumerate the policy map at run time and drive every fenced_standalone_mutation entry means a family left unconverted fails the test instead of being silently skipped, which is what a partial conversion would otherwise look like."
    - id: "OC6"
      command: "test -f src/shared/session/fenced-shell-and-image.test.ts && grep -q 'Deno.Command' src/shared/session/fenced-shell-and-image.test.ts && deno run -A scripts/run-tests.js -A --no-check src/shared/session/fenced-shell-and-image.test.ts"
      rationale: "Red today: the file does not exist. The Deno.Command clause forces process-creation instrumentation at the real primitive used by spawnForegroundShell rather than output inspection, so a blocked shell that still spawns is caught. It is also the behavioral backstop for OC2 and OC3: relocating the spawn or the image write into a private unfenced helper still fails here."
    - id: "OC7"
      command: "test -f src/shared/session/close-awaits-operation.test.ts && deno run -A scripts/run-tests.js -A --no-check src/shared/session/close-awaits-operation.test.ts"
      rationale: "Red today: the file does not exist. closeSessionWhenIdle currently awaits only the inner turn settlement, so a Session past TURN_END but before publication reports idle. Green requires close to await the outer operation through dehydration, sync, and publication, which no structural grep can prove."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-10T18:33:16-04:00"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 7
dependencies:
    - "07b-non-mutating-managed-read-paths"
implementedAt: "2026-08-11T17:28:19.074Z"
verifiedAt: "2026-08-12T01:25:22.013Z"
userVerifiedAt: null
executionReport: "- Failed to complete the planned feature. The conversion is only partial.\n- Implemented partial descriptor support: expanded `ManagedOperationName`, generalized `#runManagedOperation`, and routed some rename/model/thinking/reload/compaction/shell/image/workflow paths through it.\n- Updated capability propagation in one isolated-agent path and exported the compaction settings helper needed by Runtime.\n- Verification passed: `deno task check`.\n- Verification failed: `deno run -A scripts/run-tests.js -A --no-check src/shared/session/session-runtime.test.js` has 6 failing legacy managed-session tests. Failures are from dormant managed mutations now requiring the activation protocol marker and from managed prompt/workflow expectations that no longer pass.\n- Verification failed: full `deno task ci` was attempted before type repairs and did not pass. It was not re-run after `deno task check` passed because targeted session tests still fail.\n- Not completed: required new focused tests (`fenced-mutation-families`, `fenced-shell-and-image`, `close-awaits-operation`) were not added, and several plan steps remain unimplemented."
humanReviewMode: "always"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-12T01:25:20.273Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "95ce29ca31373fbfcd2bd49246212f1136263496"
    targetBranch: "main"
    targetHeadBeforeMerge: "cb429151569e04325750dc60b43496ceab075505"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/07c-fenced-session-mutation-families.md"
---

# Fenced Session Mutation Families

## Context

Slice 7a built the fenced managed-operation executor and proved it with the one caller that already existed,
`promptManagedSession()`. Slice 7b made the read paths genuinely non-mutating. Every other mutation family still sits
behind the slice 4 compatibility gate, returning `managed_unsupported` while dormant.

This slice converts those families. Each becomes a named descriptor on the executor: it acquires activation before any
writable Pi state exists, holds it through settlement, and publishes exactly one generation, or it fails before mutating
the Session.

Two families need judgment beyond mechanical conversion.

**Local shell execution.** `runLocalShellCommand` accepts arbitrary command text. The `persist` option controls whether
the exchange is recorded in the transcript; it says nothing about whether the command changes files. A `persist: false`
command can still rewrite the working tree. So every arbitrary shell spawn is fenced before the process starts, not just
the recording. A future unfenced diagnostic path would need a closed, mechanically read-only command set, which this
slice does not build.

**Image persistence.** Today a pasted image can be written to disk before the submission wins activation, leaving an
orphaned file when the race is lost. Persistence moves inside the accepted submission operation.

This is part 3 of the former slice 7. Adapter composition is slice 7. Durable Workflow Checkpoints remain slice 8 and
Plan Workflow Leases remain slice 9 — this slice may hold activation while a live Runtime waits on an in-memory
interaction, but it does not make that interaction restart-safe.

## Objective

- rename, Agent switch, model and provider change, thinking-level change, reload and rebuild, manual compaction,
  resume-before-compaction estimation, local shell execution, image-backed submission, initialization, and named Runtime
  workflow operations each complete through one fenced generation checkpoint or fail before Session or transcript
  mutation;
- steering, queue changes, Agent handoffs, auto-compaction, workflow sub-operations, and in-memory structured
  interactions run only under the current operation capability and are fully settled before publication;
- every arbitrary local shell command acquires activation before the subprocess spawns, including `persist: false`;
- a pasted image is persisted only inside the operation that wins activation, exactly once, and a lost race leaves no
  file on disk;
- a Session configuration preference persisted in settings is a distinct effect from a committed managed Session state
  change, and the second is announced only after its fenced operation commits;
- managed Epic child continuation is a two-operation handoff: the source Session publishes and releases before the
  destination is created, cataloged, and activated under a distinct capability; and
- cancellation targets the current operation and lets it settle and checkpoint, and close, replacement, and shutdown
  await the complete outer operation rather than disposing after the inner turn ends.

## Approach

Extend the `ManagedOperationName` union from slice 7a one family at a time, in the order given in the steps. Each family
is a descriptor plus a body; the executor already owns acquisition, evidence, heartbeat, phases, dehydration, sync, and
publication. Resist adding per-family locking — if a family seems to need it, the executor is missing a phase and the
executor should grow it.

The union grows to these operation names. Use exactly these spellings, because the tests and the completeness sweep key
on them:

`prompt` (existing), `rename`, `switch_agent`, `set_model`, `set_thinking_level`, `reload`, `compact`, `local_shell`,
`submit_user_turn`, `initialize`, `workflow_operation`.

Nested helpers in `session.js`, `agent-handler.ts`, `agent-switching.js`, `active-agent-session.js`,
`workflow-context-session.js`, and `workflow-messages.js` receive the capability-bound internal facade and lose their
raw managed-state access. They cannot manufacture authority; if a helper has no capability, it fails rather than
proceeding unfenced.

`src/shared/workflow/` was rebuilt since the original slice 7 draft. `validation.ts` is now a small composition root
over a session-independent engine, with Pi and Session coupling confined to `validation-session-adapter.ts` behind the
engine-owned `ValidationSessionPort`. Thread operation authority through that adapter, which is the correct and only
seam. Do not push Session operation authority into the engine modules — they are deliberately Session-free, and
`seams:check` sits at a zero baseline.

Cancellation and close are reworked last, because they are the settlement contract every other family depends on.
`closeSessionWhenIdle()` currently waits for the inner Agent turn; it must wait for the outer operation promise that
dehydrates, synchronizes, and publishes.

## Files to Modify

- `src/shared/session/session-runtime.js` — add a fenced implementation per family, replacing the `managed_unsupported`
  rejection for each; rework `cancelSession`, `closeSession`, `closeSessionWhenIdle`, `closeAllSessionsWhenIdle`, and
  Session replacement around the outer operation promise.
- `src/shared/session/managed-operation.ts` — extend `ManagedOperationName` with the converted families and add the
  capability-bound internal facade type the nested helpers receive.
- `src/shared/session/session-runtime-method-policy.ts` — the mutation entries already declare their target policy
  (`fenced_standalone_mutation` or `nested_only_mutation`); this slice makes the implementation match the declaration.
  Only `promptSession` stays `unmanaged_only_compatibility`. Touch this file only when a method's policy genuinely
  changes or a new public method appears, not once per family.
- `src/shared/session/session-runtime-interactions.js` — require the current capability for managed in-memory
  interaction requests and for cancellation, preserving current adapter semantics.
- `src/shared/session/session.js`, `agent-handler.ts`, `agent-switching.js`, `active-agent-session.js`,
  `workflow-context-session.js`, `workflow-messages.js` — route nested manager, Agent, and transcript mutation through
  the capability-bound facade and remove raw managed-state bypasses.
- `src/shared/session/hosted-session.js` — extend the slice 7a authority assertions to the state the new families touch.
- `src/shared/workflow/validation-session-adapter.ts` and the workflow entry points that create Runtime operations —
  carry operation authority through the existing `ValidationSessionPort` without adding a seam or touching the
  session-free engine modules.
- `src/tools/pair-checkpoint.ts` — propagate scoped Session operation authority through the current in-memory
  interaction path.
- New and updated focused tests beside every module above.

## Reuse Opportunities

- `SessionRuntime.#runManagedOperation` from slice 7a — every family is a descriptor and a body on this executor. No
  family gets its own lock.
- The slice 7b writable-API instrumentation helper — reuse it to prove each family's pre-acquisition path stays
  non-mutating and its rejection path spawns no process and writes no file.
- `src/shared/session/hosted-session.js` `dehydrateManagedSession()` — already clears the capability after 7a; extend
  the same teardown for new state rather than adding a parallel path.
- `src/shared/workflow/validation-session-adapter.ts` `ValidationSessionPort` — the established and only boundary
  between the session-free validation engine and real Hosted Session machinery.
- `src/shared/owner-coordination/session-activations.js` `createOrGetOperationReceipt` and `updateOperationReceipt` —
  the existing receipt machinery Workspace already relies on; reuse for idempotent operation identity.
- `src/shared/foreground-process.ts` — the existing foreground process-tree cancellation primitive already used for
  local shell and Objective-Failing Checks. Reuse it for fenced shell cancellation rather than a second teardown path.

## Implementation Steps

- [ ] Session rename, Agent switch, model and provider change, and thinking-level change are named descriptors on
      `#runManagedOperation`. Each acquires before any writable Pi state exists, publishes exactly one generation, and
      returns a typed blocked result when activation is lost. None emits a durable Session-state change event before its
      checkpoint succeeds.
- [ ] Reload and rebuild is a named descriptor with the same contract, and restores the previous usable state when
      activation loses a race.
- [ ] Project-wide auto-compaction preference is persisted without hydrating a managed Session, and is applied to a live
      Agent only inside the current operation or on its next activation. A test proves the settings write happens with
      no generation published.
- [ ] Manual compaction and resume-before-compaction estimation run as one named descriptor. Activation is acquired
      before any writable inspection or hydration and held through compaction settlement and transcript rewrite, and
      exactly one generation is published. Abort or failure after a possible rewrite reports uncertainty; no path
      silently resumes uncompacted or retries.
- [ ] `runLocalShellCommand` acquires activation before the subprocess spawns, for every value of `persist`. A test
      proves that a blocked activation returns before any process is created, using process-creation instrumentation
      rather than output inspection.
- [ ] A successful or canceled shell command holds activation through completion, cancellation settlement, optional
      transcript exchange recording, and publication. With `persist: false` no transcript exchange is recorded, the
      operation is still fenced, and no active interaction survives the return.
- [ ] `persistSessionImage` and `preflightSessionImages` perform no disk write outside an operation. Image bytes are
      persisted inside the accepted submission operation, exactly once, and are included in that operation's checkpoint.
      A test that loses the activation race asserts no file exists on disk afterwards.
- [ ] Initialization, `/sleep`, `plans pull`, and the Runtime workflow operations run as named descriptors, preflighting
      before any memory, remote, Plan, or transcript effect, and holding Session activation through current in-memory
      interactions and nested execution or validation work. No Durable Workflow Checkpoint and no Plan Workflow Lease
      check is added.
- [ ] Operation authority reaches workflow code only through `ValidationSessionPort` in
      `src/shared/workflow/validation-session-adapter.ts`. The session-free engine modules gain no import of
      `../session` and no new port, proven by the existing assertion
      `session/Pi coupling in workflow validation stays at the adapter boundary` in
      `src/shared/session/architecture-boundary.test.js`. That test's `validationAdapterWhitelist` must not grow.
- [ ] Every nested helper in `session.js`, `agent-handler.ts`, `agent-switching.js`, `active-agent-session.js`,
      `workflow-context-session.js`, and `workflow-messages.js` obtains managed manager, Agent, or transcript access
      only through the capability-bound facade, and throws when called without a capability.
- [ ] Managed Epic child continuation publishes and releases the source Session's generation before the destination
      Session is created, cataloged, or activated, and the destination runs under a distinct capability. A test
      injecting failure between the two operations asserts no false replacement and no reuse of source authority.
- [ ] `cancelSession` signals only the current operation, which then settles Agent, compaction, shell, interactions, and
      queues before the owner publishes or marks uncertainty.
- [ ] `closeSession`, `closeSessionWhenIdle`, `closeAllSessionsWhenIdle`, and Session replacement await the outer
      managed-operation promise through dehydration, sync, and publication. A test proves a Session with an operation
      past `TURN_END` but before publication is never reported idle.
- [ ] `src/shared/session/fenced-mutation-families.test.ts` enumerates `SESSION_RUNTIME_METHOD_POLICY` at run time and
      drives every `fenced_standalone_mutation` entry against a managed Session. For each entry it proves the call
      publishes exactly one generation on success, returns a typed blocked result when a concurrent operation holds the
      capability, and leaves the Hosted Session dormant and manager-free afterwards. A `fenced_standalone_mutation`
      entry the sweep cannot drive fails the test rather than being skipped, so a family cannot be quietly left
      unconverted.
- [ ] `src/shared/session/fenced-shell-and-image.test.ts` counts real process creation at the `Deno.Command` boundary
      and counts files under the Session image directory. It proves a blocked `runLocalShellCommand` creates zero
      processes for `persist: true` and `persist: false` alike, and that a submission that loses the activation race
      leaves zero image files on disk.
- [ ] `src/shared/session/close-awaits-operation.test.ts` proves a managed Session whose operation is past `TURN_END`
      but before publication is never reported idle, and that `closeSessionWhenIdle` returns only after that operation
      dehydrates, synchronizes, and publishes.
- [ ] `deno task ci` passes with `language-policy:check` clean and `seams:check` at the unchanged zero baseline.

## Verification Plan

- Automated: `deno run -A scripts/run-tests.js -A --no-check src/shared/session src/shared/workflow src/tools` during
  development, then full `deno task ci`.
- Automated: race independent stores and processes across each converted family. Exactly one same-Session operation
  wins, public re-entry while the winner's manager is live is rejected, and unrelated Sessions and Projects stay
  concurrent.
- Automated: inject failure before and after acquisition, evidence validation, hydration, Agent activation, command
  spawn, image write, interaction wait, cancellation, compaction rewrite, settlement, dehydration, sync, evidence
  capture, and publication. A pre-hydration unchanged failure releases only after re-proving evidence; a possible
  committed or external effect becomes uncertain; nothing is replayed automatically.
- Automated: expire or invalidate heartbeat and fence during each active phase. Cancellable work is signaled,
  publication fails closed, and a stale process cannot mark a later owner uncertain or reconcile-required.
- Automated: after every successful operation, exactly one next generation, exact transcript evidence, a dormant
  manager-free Hosted Session, and no retained Agent, handler, sub-Agent, queue, interaction, subprocess, or capability.
- Automated: the slice 7b instrumentation helper still reports zero writable Pi calls for every `read_only` policy entry
  after this slice lands.
- Behavior that must still be protected: unmanaged Sessions keep current behavior for every converted family. Escape
  cancellation still reaches foreground process trees for local shell, local CI, and Objective-Failing Checks, and a
  canceled Objective-Failing Check remains a resumable pause rather than a validation failure. Validation's CI and
  Objective-Check repair gating with its three-round limit, semantic discovery and verify rounds with ledger
  convergence, human review modes, and the publication transaction with merge repair all keep their current behavior.
- Behavior expected to stop existing: `managed_unsupported` as the answer for every converted family; image persistence
  before activation; unfenced shell spawn; and close reporting idle before publication. Tests asserting those must be
  rewritten to the new contract, not deleted.
- Manual mutation journey: on a managed Session perform rename, model and thinking change, an image-backed User Request,
  a persistent `!` shell command, manual compaction, and a Plan-loading workflow. After each safe idle point the
  generation advances by exactly one, another surface reflects committed state, and no writable Runtime stays hydrated.
- Manual cancellation and shutdown: cancel a long Agent turn, a shell command, and a compaction, then close the owning
  surface during settlement. Close waits for safe publication or reports blocked recovery, and never shows a false idle
  state or duplicates an effect.

## Edge Cases & Considerations

- **`persist` is not a safety property.** It controls transcript exchange recording, not whether a command changes
  files. Every arbitrary shell spawn is fenced. Do not add an unfenced carve-out short of a closed, mechanically
  read-only command set.
- **Fencing cannot undo side effects.** A fence stops stale coordination publication, not a shell command, tool call,
  model request, compaction rewrite, image write, or Plan effect already started. Heartbeat loss after such a boundary
  is uncertainty, never automatic replay or takeover.
- **Preferences versus committed state.** Persisting a settings value and changing a managed Session's committed model,
  Agent, or thinking state are different effects. The local preference may be saved independently; the Session state
  change is announced only after its fenced operation commits.
- **Image bytes are large but drafts are safer.** Keeping pasted bytes as a bounded in-memory attachment until the
  submission wins beats creating an orphaned Session file before activation.
- **Close is not cancellation.** Disconnection alone does not cancel. Explicit cancellation signals the owner; resource
  disposal waits for the outer operation or leaves durable uncertainty.
- **In-memory interactions are not durable.** This slice may hold activation while a live Runtime waits, and may cancel
  and settle that wait. It does not make the interaction restart-safe or exactly-once across process loss — slice 8.
- **Session activation is not Plan ownership.** Holding activation serializes one Session's transcript and active work.
  It does not stop another Session from driving the same Plan — slice 9.
- **The validation engine stays Session-free.** Operation authority goes through `ValidationSessionPort` only. Adding a
  port or a `../session` import to the engine modules would undo the 2026-08-05 extraction and break its own checks.
- **New source is TypeScript.** ADR-013 and `language-policy:check` reject a new production `.js` under `src/`. Existing
  `.js` modules stay `.js`; do not convert them opportunistically here.
- **Convert families one at a time.** The former single-slice attempt failed partly on size. Each family is
  independently testable against the executor; land them in the step order given rather than in one sweep.
