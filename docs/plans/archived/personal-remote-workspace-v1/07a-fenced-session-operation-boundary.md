---
planId: "2e4629e3-68d1-4236-8c2b-f41ea200cc9c"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Generalize promptManagedSession into one Runtime-owned fenced managed-operation executor with an operation-scoped capability, a complete SessionRuntime method-classification policy, and proof-fenced activation failure transitions."
affectedPaths:
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-method-policy.ts"
    - "src/shared/session/managed-operation.ts"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session-host.js"
    - "src/shared/owner-coordination/session-activations.js"
    - "src/shared/owner-coordination/index.js"
objectiveChecks:
    - id: "OC1"
      command: "awk '/async #runManagedOperation\\(/,/^    }$/' src/shared/session/session-runtime.js | grep -q 'acquireSessionActivation'"
      rationale: "Red today: no #runManagedOperation exists, so awk yields nothing and grep exits 1. Green only when the named executor exists AND owns the lease acquisition. A stub executor that does not acquire fails."
    - id: "OC2"
      command: "! awk '/async promptManagedSession\\(/,/^    }$/' src/shared/session/session-runtime.js | grep -q 'acquireSessionActivation'"
      rationale: "Red today: promptManagedSession contains the acquisition directly (5 activation calls in its body). Green only when acquisition has actually moved out of it. Paired with OC1 this forces the acquisition into the named executor rather than any other helper, which is the refactor itself."
    - id: "OC3"
      command: "! grep -qF 'if (hostedSession.getRootSessionManager?.()) return null;' src/shared/session/session-runtime.js"
      rationale: "Red today: line 523 is the manager-presence escape that lets an unrelated public call mutate a managed Session whenever any operation has a live manager. Green only when that specific authorization hole is gone."
    - id: "OC4"
      command: "deno run -A scripts/run-tests.js -A --no-check src/shared/session/managed-operation-boundary.test.ts"
      rationale: "Red today: the file does not exist, so the runner exits 1. Green requires a test proving a public mutator is rejected while another operation holds the Session with its manager live - behavior that is impossible without real capability-based gating, since today that call is permitted."
    - id: "OC5"
      command: "deno run -A scripts/run-tests.js -A --no-check src/shared/session/session-runtime-method-policy.test.ts"
      rationale: "Red today: the file and the policy module do not exist. Green requires every function on SessionRuntime.prototype to carry an explicit classification, enumerated at runtime, plus a self-check that the completeness assertion actually detects an unclassified method."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-10T18:33:16-04:00"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 7
dependencies:
    - "06-read-only-transcript-projection-and-idle-tui-sync"
implementedAt: "2026-08-11T01:43:29.877Z"
verifiedAt: "2026-08-11T02:31:54.303Z"
userVerifiedAt: null
executionReport: "- Implemented 07a fenced managed-operation boundary: added `ManagedOperationCapability`, private `async #runManagedOperation(...)`, capability-scoped managed state, and reduced `promptManagedSession()` to the executor path.\n- Hardened managed mutation checks: removed manager-presence authorization, added `managed_operation_in_progress`, fenced HostedSession writable manager/Agent state, cleared capability on dehydration, and added stable RunWield Session ID uniqueness in `SessionHost`.\n- Hardened owner coordination: added proof-taking reconcile transition and proof-fenced `markSessionUncertain` behavior so stale proofs cannot poison newer activations.\n- Added complete `SessionRuntime` method-policy map and drift test; added focused boundary, HostedSession, SessionHost, owner-coordination, and updated source-order tests. Test coverage increased; no tests were deleted. Existing tests rewritten only where they asserted the old manager-presence behavior or the old prompt body location.\n- Verification passed: Objective Checks OC1–OC5, targeted `deno run -A scripts/run-tests.js -A --no-check src/shared/session src/shared/owner-coordination`, and full `deno task ci` (259 files passed)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "d1776b342d7d7ee2c76be699ce4ab246afd50807"
    targetBranch: "main"
    targetHeadBeforeMerge: "5a1f2eb50b442f8b2a0309f23d694ce8fe49518f"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/07a-fenced-session-operation-boundary.md"
---

# Fenced Session Operation Boundary

## Context

Slices 2, 4, and 6 built the Personal Workspace activation foundation: the owner coordination database, Session
Activation Leases with proof and fence, committed Session generations with exact transcript evidence, managed dormant
Hosted Sessions, activation-aware ordinary turns, and non-mutating transcript projection.

Slice 4 left one deliberate compatibility gate in place. `SessionRuntime.#rejectManagedPublicMutation()` in
`src/shared/session/session-runtime.js` reads:

```js
#rejectManagedPublicMutation(hostedSession, operation) {
    if (!hostedSession?.getManagedMetadata?.()) return null;
    if (hostedSession.getRootSessionManager?.()) return null;   // <- permits the mutation
    return { ok: false, error: "managed_unsupported", operation };
}
```

The second line is the defect. It rejects a managed mutator only while the Hosted Session is dormant. Once any operation
has installed a writable Pi Session Manager, an unrelated public call sees a live manager and is permitted, without
proving it belongs to the operation that acquired the lease. Manager presence is being used as authority. That is the
opposite of the invariant ADR-011 requires.

`promptManagedSession()` already performs the correct full sequence — expected-generation check, lease acquisition,
exact transcript evidence comparison, monitored heartbeat, phase transitions, hydration, turn, dehydration, file sync,
evidence capture, generation publication and release. It is the only method that does. Every other mutation family
either has no fence or can construct writable Pi state before activation.

`src/shared/owner-coordination/session-activations.js` has a second, smaller hole:
`markSessionReconcileRequired(database, session, options)` takes a Session identity, not a proof. Any process holding a
stale view can therefore mark a newer owner's activation unhealthy.

This slice is part 1 of the former slice 7, which was split after a single-change attempt failed validation. It builds
the boundary and proves it with the one caller that already exists. It converts no other mutation family and touches no
adapter — those are slices 7b, 7c, and 7.

## Objective

Make the operation, not the manager, the unit of authority:

- one private Runtime-owned executor runs every managed operation through the acquire → verify → hydrate → run → settle
  → dehydrate → sync → publish sequence, and `promptManagedSession()` becomes its first caller with unchanged observable
  behavior;
- an unexported operation-scoped capability, bound to Runtime Session ID, stable RunWield Session ID, operation ID,
  activation proof, and lifetime, is the only thing that authorizes writable managed state;
- a public managed mutator called while another operation is in flight is rejected even though that operation's manager
  is live — manager presence authorizes nothing;
- every public `SessionRuntime` method carries exactly one explicit, test-enforced classification, so a new public
  method cannot be added without an activation policy;
- `HostedSession` refuses to install or replace writable manager/Agent state without the current capability, and
  dehydration clears the capability along with manager, Agent, queue, and interaction state;
- `SessionHost` holds at most one live Hosted Session shell per stable RunWield Session ID; and
- Runtime-driven transitions from an active activation state to `uncertain` or `reconcile_required` require full current
  proof, so a stale process cannot poison a newer owner.

Converting rename, model, thinking, reload, compaction, shell, image, initialization, and workflow mutation to fenced
operations is slice 7c. Non-mutating managed read paths are slice 7b. Adapter composition is slice 7. Durable Workflow
Checkpoints remain slice 8 and Plan Workflow Leases remain slice 9.

## Approach

Extract the body of `promptManagedSession()` into a private `#runManagedOperation(sessionId, descriptor, body)` on
`SessionRuntime`. The descriptor is a closed named set — this slice defines only `prompt`; later slices add members. The
executor owns the whole sequence and the body owns only the work between `turning` and `checkpointing`.

The capability is a plain private class instance created by the executor and passed to the body. It is never exported,
never placed on an event, snapshot, adapter callback, or return value, and never reconstructible by a caller. Runtime
holds the current capability per Runtime Session ID in a private field; `#rejectManagedPublicMutation` consults that
field instead of the manager. The rejection reason for re-entry is a distinct typed error from the dormant-unsupported
reason, so slice 7's adapters can tell "busy elsewhere in this process" from "not yet converted".

This is not an injection seam. The capability is real private state on a real class, created and consumed inside the
Runtime. Do not accept it as a constructor argument, do not make it optional, and do not add a fallback branch for its
absence — `deno task seams:check` runs at a zero baseline and must stay there.

For the classification policy, add `src/shared/session/session-runtime-method-policy.ts` exporting one map from method
name to a policy literal. A test enumerates `SessionRuntime.prototype` at runtime and fails when a method is missing
from the map, so the map cannot silently drift.

In `session-activations.js`, add proof-fenced reconcile marking and keep the identity-only function only if a
non-Runtime caller genuinely needs it; Runtime paths must use the fenced form. Latch heartbeat failure into the
operation so a later phase change or publication cannot be mistaken for success.

## Files to Modify

- `src/shared/session/session-runtime.js` — add `#runManagedOperation`, the private current-capability field, and the
  `prompt` descriptor; reduce `promptManagedSession()` to a caller of the executor; remove the `getRootSessionManager()`
  escape from `#rejectManagedPublicMutation` and replace it with a capability check plus a distinct re-entry error.
- `src/shared/session/managed-operation.ts` — new. Owns the `ManagedOperationCapability` class, the named operation
  descriptor type, and the typed operation-outcome types. TypeScript, per ADR-013.
- `src/shared/session/session-runtime-method-policy.ts` — new. The complete method-name-to-policy map and its policy
  union type.
- `src/shared/session/hosted-session.js` — require the current capability to set the root Session Manager or activate
  root/sub Agent state; clear the capability and queue-source subscriptions in `dehydrateManagedSession()`.
- `src/shared/session/session-host.js` — reject a second live Hosted Session shell for one stable RunWield Session ID
  and release the mapping only after disposal completes.
- `src/shared/owner-coordination/session-activations.js` — add proof-fenced reconcile/uncertain transitions and surface
  heartbeat failure to the caller.
- `src/shared/owner-coordination/index.js` — expose the fenced transitions on the bound store surface and its
  `@property` typedef, which currently binds `markSessionReconcileRequired` to a Session identity rather than a proof.
- New focused tests beside the modules above.

## Reuse Opportunities

- `src/shared/session/session-runtime.js` `promptManagedSession()` — extract its existing proven sequence; do not write
  a second locking mechanism beside it.
- `src/shared/owner-coordination/session-activations.js` `acquireSessionActivation`, `changeSessionActivationPhase`,
  `publishGenerationAndRelease`, `releaseUnchangedActivation`, `markSessionUncertain` — already proof-taking and already
  correct. Reuse them unchanged; only `markSessionReconcileRequired` needs a fenced form.
- `src/shared/session/hosted-session.js` `dehydrateManagedSession()` — extend the existing dormant-shell lifecycle
  rather than adding a parallel teardown path.
- `captureTranscriptEvidence` and `syncTranscriptFileAndParent` — already used by `promptManagedSession`; the executor
  keeps calling them at the same points.
- `src/shared/git-test-fixture.ts` `defineGitFixture` and `makeValidationProjectRoot` — fake the environment for tests
  instead of introducing a seam.

## Implementation Steps

- [ ] `src/shared/session/managed-operation.ts` exists and exports `ManagedOperationCapability` and a
      `ManagedOperationName` union whose only member in this slice is `"prompt"`. The capability class carries the
      Runtime Session ID, stable RunWield Session ID, operation ID, current activation proof, and a settled flag, and
      exposes no constructor path that a `SessionRuntime` consumer can reach.
- [ ] `SessionRuntime` declares `async #runManagedOperation(sessionId, descriptor, body)` — that exact name and that
      exact `async` form, because the Objective-Failing Checks anchor on it — and it performs, in order:
      expected-generation comparison, `acquireSessionActivation`, exact transcript evidence comparison against the
      committed generation, heartbeat start, `hydrated` phase, manager open, Agent activation, `turning` phase, the
      supplied body, `checkpointing` phase, dehydration, `syncTranscriptFileAndParent`, evidence capture,
      `publishGenerationAndRelease`, and managed metadata generation update.
- [ ] `promptManagedSession()` contains no direct call to `acquireSessionActivation`, `changeSessionActivationPhase`,
      `publishGenerationAndRelease`, or `releaseUnchangedActivation`; it obtains all of them through
      `#runManagedOperation`. Its return values for success, `refresh_required`, and `reconcile_required` are
      byte-identical in shape to the current implementation.
- [ ] `#rejectManagedPublicMutation` no longer contains the line
      `if (hostedSession.getRootSessionManager?.()) return null;`. It returns a rejection when a managed Hosted Session
      has a live operation capability that the caller does not hold, using an error distinct from `managed_unsupported`,
      and still returns `managed_unsupported` for a dormant managed Session whose family is not yet converted.
- [ ] `src/shared/session/session-runtime-method-policy.ts` maps every public `SessionRuntime` method name to exactly
      one of `read_only`, `projection_adapter_local`, `initializer_adopter`, `fenced_standalone_mutation`,
      `nested_only_mutation`, `cancellation_cleanup`, or `unmanaged_only_compatibility`.
- [ ] `src/shared/session/session-runtime-method-policy.test.ts` enumerates `SessionRuntime.prototype` at runtime and
      fails when any function-valued own property other than `constructor` is absent from the map. The test also proves
      it detects drift: it adds a temporary method to a subclass or a copied prototype descriptor list and asserts the
      completeness assertion fails for it.
- [ ] `src/shared/session/managed-operation-boundary.test.ts` proves re-entry rejection against real machinery: with a
      managed Session hydrated and a `prompt` operation in flight (its manager live), a public managed mutator called
      from outside that operation is rejected with the re-entry error and performs no Pi write. The same call succeeds
      when no operation is in flight and the family is converted, and the test fails if the rejection is driven by
      Runtime busy state rather than the capability.
- [ ] `HostedSession.setRootSessionManager()` and root/sub Agent activation throw when the Runtime has no current
      capability for that Hosted Session. `dehydrateManagedSession()` additionally clears the operation capability and
      the queue-source subscriptions, and a test asserts no writable reference survives a completed operation.
- [ ] `SessionHost` rejects registering a second Hosted Session for a stable RunWield Session ID already live in the
      same Runtime, and releases the identity mapping only after disposal finishes.
- [ ] `session-activations.js` exports a proof-taking reconcile transition; `SessionRuntime` calls only that form. A
      test proves a proof from a superseded fence cannot move a newer activation to `reconcile_required` or `uncertain`.
- [ ] Heartbeat failure is latched on the capability. A test proves that after a latched failure the operation does not
      publish a generation and reports uncertainty instead of success.
- [ ] `deno task ci` passes, including `language-policy:check` with no new production `.js` file and `seams:check` at
      the unchanged zero baseline.

## Verification Plan

- Automated: `deno run -A scripts/run-tests.js -A --no-check src/shared/session src/shared/owner-coordination` during
  development, then full `deno task ci`.
- Automated: the method-policy test enumerates the real prototype, so adding a public method without a policy fails CI.
- Automated: the boundary test races a public mutator against an in-flight operation on real Hosted Session and owner
  coordination machinery, with no injected fake for either.
- Automated: a fence test proves stale-proof reconcile/uncertain marking is refused.
- Automated: after a successful `prompt` operation the Hosted Session is dormant with no manager, Agent, handler,
  sub-Agent, queue source, interaction, or capability retained, and exactly one next generation is published with exact
  transcript evidence.
- Behavior that must still be protected: every existing `promptManagedSession` contract — `refresh_required` on
  generation mismatch, `reconcile_required` on transcript-ahead evidence, accepted `USER_MESSAGE`/`TURN_START` emission
  ordering including the pending-image deferral, pending managed turn intent for model/provider/thinking/agent, and
  release-unchanged on pre-hydration failure. The existing `session-runtime.test.js` source-order assertions that
  reference `async #runWorkflowOperation(` still describe a real method and must keep passing.
- Behavior expected to stop existing: managed public mutation permitted purely because a manager is live. Any existing
  test that asserts a managed mutator succeeds while another operation holds the Session must be rewritten to assert
  rejection, not deleted.
- Manual: none required. This slice changes no user-visible surface; adapters still see the same typed results plus one
  new rejection reason that slice 7 renders.

## Edge Cases & Considerations

- **Manager presence is not authority.** A managed manager exists transiently inside one operation. This is the whole
  point of the slice; do not reintroduce a convenience check on `getRootSessionManager()`.
- **The capability is not a seam.** `deno task seams:check` sits at an empty baseline. Build the capability as private
  class state with no constructor injection, no optional parameter, and no `fake ?? real` branch. If `seams:check`
  fails, change the design, not the baseline.
- **New source is TypeScript.** ADR-013 and `deno task language-policy:check` reject a new production `.js` file under
  `src/`. The two new modules are `.ts`. Existing `.js` modules stay `.js`; do not convert them opportunistically in
  this slice. Imports from JavaScript must use the real `.ts` extension.
- **Initial managed creation stays the one exception.** Pi must create the initial transcript header before owner
  coordination can catalog its locator. The executor does not change that; it is unreached in this slice because
  `prompt` always resumes an already-cataloged Session.
- **Hydrated no-op operations still publish.** ADR-011 requires every safely checkpointed hydrated operation to publish
  the next generation even when transcript bytes are unchanged. Only a proven pre-hydration abandonment releases
  unchanged.
- **Fencing cannot undo side effects.** A fence prevents stale coordination publication. It does not undo a model
  request or a file write already started. Heartbeat loss after such a boundary is uncertainty, never automatic replay.
- **Busy state is not authority.** `#beginBusyOperation` drives consumer spinners. The boundary test must fail if
  rejection is sourced from busy counting rather than the capability.
- **No adapter changes here.** TUI, ACP, Workspace, and commands keep their current behavior. They may surface the new
  re-entry error as an unexpected state until slice 7 handles it; that is acceptable for one intermediate slice and must
  not be worked around by weakening the boundary.
