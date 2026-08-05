---
planId: "7989da8c-27e5-464a-8764-3dbdba75e7b7"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Split the Plan Recovery menu coordinator into typed action modules while preserving recovery state, control-flow, and transactional behavior."
affectedPaths:
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/cmd/load-plan/plan-recovery-actions.ts"
    - "src/cmd/load-plan/plan-recovery-reset.ts"
    - "src/cmd/load-plan/plan-recovery-merge.ts"
    - "src/cmd/load-plan/plan-recovery-flow.test.ts"
    - "src/cmd/load-plan/index.integration.test.ts"
    - "src/shared/workflow/architecture-boundary.test.js"
    - "src/shared/workflow/architecture-boundary.test.ts"
objectiveChecks:
    - id: "OC1"
      command: "test \"$(wc -l < src/cmd/load-plan/plan-recovery-flow.ts)\" -lt 400 && for f in src/cmd/load-plan/plan-recovery-actions.ts src/cmd/load-plan/plan-recovery-reset.ts; do test -f \"$f\" && test \"$(wc -l < \"$f\")\" -lt 400 || exit 1; done && test -f src/cmd/load-plan/plan-recovery-merge.ts && test \"$(wc -l < src/cmd/load-plan/plan-recovery-merge.ts)\" -lt 500"
      rationale: "The current 1,266-line module cannot pass; the requested coordinator/actions/reset/merge split must exist within bounded module sizes."
    - id: "OC2"
      command: "a=src/cmd/load-plan/plan-recovery-actions.ts; r=src/cmd/load-plan/plan-recovery-reset.ts; m=src/cmd/load-plan/plan-recovery-merge.ts; c=src/cmd/load-plan/plan-recovery-flow.ts; for f in \"$a\" \"$r\" \"$m\"; do test -f \"$f\" && ! grep -Eq '^[[:space:]]*continue[[:space:]]*;' \"$f\" || exit 1; done && grep -q 'runRecoveryTransition(' \"$a\" && grep -q 'runRecoveryTransition(' \"$r\" && grep -q 'runDirectDeliveryPublicationTransition(' \"$m\" && grep -q 'mergeExecutionWorktree(' \"$m\" && grep -q 'executeReadyPlanWithRepair(' \"$a\" && grep -q 'executeReadyPlanWithRepair(' \"$r\" && grep -q 'validateCompletedExecution(' \"$a\" && ! grep -Eq 'runRecoveryTransition\\(|runDirectDeliveryPublicationTransition\\(|executeReadyPlanWithRepair\\(|validateCompletedExecution\\(|putPlanOnHold\\(|markPlanUserVerified\\(|reopenPlanForReview\\(' \"$c\""
      rationale: "The expected lifecycle, execution, validation, and publication implementations must reside in their action owners, without old branch-level loop control or substantive actions left in the coordinator."
    - id: "OC3"
      command: "test -s src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery menu outcomes re-prompt without fallthrough' src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery handled and review outcomes exit once' src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery actions preserve live context' src/cmd/load-plan/plan-recovery-flow.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts src/cmd/load-plan/index.integration.test.ts src/shared/workflow/architecture-boundary.test.ts"
      rationale: "The required outcome/live-state regressions do not exist on the baseline and must pass with real command recovery and moved architecture enforcement."
objectiveChecksBaseline:
    recordedAt: "2026-08-03T18:22:37.824Z"
    head: "a77c288eac0cab26c41fcbd5a70b7059fb84ef1d"
    results:
        - id: "OC1"
          command: "test \"$(wc -l < src/cmd/load-plan/plan-recovery-flow.ts)\" -lt 400 && for f in src/cmd/load-plan/plan-recovery-actions.ts src/cmd/load-plan/plan-recovery-reset.ts; do test -f \"$f\" && test \"$(wc -l < \"$f\")\" -lt 400 || exit 1; done && test -f src/cmd/load-plan/plan-recovery-merge.ts && test \"$(wc -l < src/cmd/load-plan/plan-recovery-merge.ts)\" -lt 500"
          rationale: "The current 1,266-line module cannot pass; the requested coordinator/actions/reset/merge split must exist within bounded module sizes."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 8
          output: "\n"
        - id: "OC2"
          command: "a=src/cmd/load-plan/plan-recovery-actions.ts; r=src/cmd/load-plan/plan-recovery-reset.ts; m=src/cmd/load-plan/plan-recovery-merge.ts; c=src/cmd/load-plan/plan-recovery-flow.ts; for f in \"$a\" \"$r\" \"$m\"; do test -f \"$f\" && ! grep -Eq '^[[:space:]]*continue[[:space:]]*;' \"$f\" || exit 1; done && grep -q 'runRecoveryTransition(' \"$a\" && grep -q 'runRecoveryTransition(' \"$r\" && grep -q 'runDirectDeliveryPublicationTransition(' \"$m\" && grep -q 'mergeExecutionWorktree(' \"$m\" && grep -q 'executeReadyPlanWithRepair(' \"$a\" && grep -q 'executeReadyPlanWithRepair(' \"$r\" && grep -q 'validateCompletedExecution(' \"$a\" && ! grep -Eq 'runRecoveryTransition\\(|runDirectDeliveryPublicationTransition\\(|executeReadyPlanWithRepair\\(|validateCompletedExecution\\(|putPlanOnHold\\(|markPlanUserVerified\\(|reopenPlanForReview\\(' \"$c\""
          rationale: "The expected lifecycle, execution, validation, and publication implementations must reside in their action owners, without old branch-level loop control or substantive actions left in the coordinator."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 3
          output: "\n"
        - id: "OC3"
          command: "test -s src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery menu outcomes re-prompt without fallthrough' src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery handled and review outcomes exit once' src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery actions preserve live context' src/cmd/load-plan/plan-recovery-flow.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts src/cmd/load-plan/index.integration.test.ts src/shared/workflow/architecture-boundary.test.ts"
          rationale: "The required outcome/live-state regressions do not exist on the baseline and must pass with real command recovery and moved architecture enforcement."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 3
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-03T13:56:14-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-03T18:42:18.664Z"
verifiedAt: "2026-08-03T21:59:09.020Z"
userVerifiedAt: null
executionReport: "- Implemented Plan Recovery split: coordinator now owns live context/menu/outcome translation; smaller actions, reset paths, and manual merge publication moved to typed action modules with transaction wrappers preserved.\n- Migrated `architecture-boundary.test.js` to TypeScript and expanded lifecycle/publication scanning across all Plan Recovery modules.\n- Added/updated tests: +3 focused Plan Recovery tests, +1 integration hold terminal test; the 4 architecture tests were rewritten from JS to TS with strengthened scan coverage (no behavior-only test coverage deleted).\n- Verified module size/objective guards: flow 393 lines, actions 397, reset 307, merge 417; no branch-level bare `continue` remains in extracted modules.\n- Verification passed: `deno task check`, `deno task language-policy:check`, `deno task seams:check`, targeted recovery/integration/architecture tests, golden load-plan workflow tests, and `deno task ci`."
workRecord:
    status: "generated"
    recordId: "0c1b6fdc-ea59-47cf-ae8c-897b0a05a34c"
    path: "docs/work-records/2026-08-03-split-plan-recovery-into-typed-action-modules.md"
    lastAttemptAt: "2026-08-03T21:59:15.265Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "867bb00e76ed6b31d0e2bae8f45863148285d6b7"
    targetBranch: "main"
    targetHeadBeforeMerge: "fd1287d16d76855fac173f6095a1fc0d81955cc6"
routingIntent: "PLANNED_CHANGE"
sessionName: "plan recovery split"
validationCiAttempts: 0
validationSemanticRounds: 0
updatedAt: "2026-08-05T14:51:45.698Z"
archivedAt: "2026-08-05T14:51:45.698Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/split-plan-recovery-flow.md"
---

# Split Plan Recovery Flow

## Context

`src/cmd/load-plan/plan-recovery-flow.ts` is 1,266 lines, and 1,062 of those lines belong to `handlePlanRecovery`. The
function is the Plan Recovery console for In-Progress, Failed, and validation-state Plans: it recomputes a live menu,
then handles lifecycle-record settlement, inspection, continuation, Workflow Validation, reset, manual Direct Delivery
publication, abandonment, review reopening, user verification, and hold actions.

This is not a verbatim file move. The current menu loop uses branch-level `continue` and `return` statements as its
control protocol while closures share mutable `worktreeContext`, `unresolvedRecords`, `plan.attrs`, and `plan.revision`.
A mechanically incorrect extraction can silently run the wrong branch, stop re-prompting, use stale worktree state, or
change a nested transaction callback. Reset and merge are especially sensitive because they perform destructive Git,
worktree-registry, Plan Lifecycle, and publication operations.

The intended outcome is a behavior-preserving structural refactor. Plan Recovery choices, labels, confirmations,
metrics, Plan Lifecycle events, workflow ownership, transaction ordering, and user-visible messages remain unchanged. No
domain language changes are required.

## Objective

Reduce `plan-recovery-flow.ts` to a focused menu coordinator and move substantive action behavior into cohesive
TypeScript modules. The coordinator must retain one authoritative live recovery context and translate every action's
explicit outcome into exactly one menu-loop decision. Reset and merge must preserve their existing transactional and
rollback semantics, and focused regression coverage must distinguish re-prompting from terminal outcomes.

## Approach

Use four production modules with one explicit internal control protocol:

- `plan-recovery-flow.ts` owns the policy gate, live recovery-context initialization, worktree refresh, recovery
  metrics, Git availability gate, menu labels/options, prompt, exhaustive action dispatch, and the single translation
  from an action outcome to `continue`, `return "handled"`, or `return "review"`.
- `plan-recovery-actions.ts` owns the smaller `settle_records`, `hold`, `user_verify`, `inspect`, `validate`,
  `continue`, `abandon`, and `review` handlers. It also owns the shared action types so reset and merge can import them
  with type-only imports and no runtime cycle.
- `plan-recovery-reset.ts` owns all three reset modes: metadata-only cleanup when Git is unavailable, baseline-tree
  restoration, and recorded-worktree deletion/recreation followed by execution restart.
- `plan-recovery-merge.ts` owns manual recovered-worktree publication, including validation-context proof, candidate
  sealing, Plan staging, publication transaction, rollback, ancestry proof, registry settlement, optional cleanup, and
  failure recording.

Define `RecoveryActionOutcome` as the discriminated union `{ kind: "menu" } | { kind: "handled" } |
{ kind: "review" }`.
Define one `RecoveryActionContext` object containing the Plan, project/session/UI surfaces, mutable `worktreeContext`
and `unresolvedRecords`, the originally loaded canonical `worktreeId`, and common `refreshRecoveryWorktree` /
`recordRecoveryResult` operations. Every handler receives that same object plus only the named capabilities it uses; no
handler receives the entire `HandlePlanRecoveryOptions` bag, and no new dependency-bag or conditional injection seam is
introduced.

The coordinator dispatches with an exhaustive `switch` and interprets the outcome in one place. Extracted handlers do
not contain branch-level bare `continue` statements. Existing nested callback control remains callback-local: reset
transaction callbacks still return updated attributes/worktree data, the merge rollback callback can still return early
after publication, and the publication callback still returns its merge result.

## Files to Modify

- `src/cmd/load-plan/plan-recovery-flow.ts` — retain the public `handlePlanRecovery` interface while shrinking the
  implementation to context construction, live menu computation, generic Git blocking, action dispatch, and outcome
  translation.
- `src/cmd/load-plan/plan-recovery-actions.ts` — new TypeScript module for the shared action contract and the eight
  smaller recovery actions.
- `src/cmd/load-plan/plan-recovery-reset.ts` — new TypeScript module for metadata-only cleanup, baseline restoration,
  worktree recreation, reset lifecycle transition, and execution restart.
- `src/cmd/load-plan/plan-recovery-merge.ts` — new TypeScript module for manual recovered-worktree Direct Delivery and
  its transaction, rollback, proof, cleanup, and failure paths.
- `src/cmd/load-plan/plan-recovery-flow.test.ts` — add focused outcome-contract and dispatch regression coverage,
  including paths that must re-open the menu versus terminate Plan Recovery.
- `src/cmd/load-plan/index.integration.test.ts` — extend real command/Plan-store coverage so a non-terminal recovery
  action is proven to re-prompt and terminal actions are proven to exit without corrupting Plan state.
- `src/shared/workflow/architecture-boundary.test.ts` — migrate the existing `.js` test while adding all Plan Recovery
  modules to lifecycle-write scanning and publication-transaction enforcement; remove the superseded `.js` path.

## Reuse Opportunities

- `src/cmd/load-plan/plan-recovery-worktree.ts` — continue using the existing worktree resolution, persistence,
  inspection, confirmation, active-workflow rehydration, and review-reopen helpers.
- `src/cmd/load-plan/plan-execution.ts` — continue using `validateCompletedExecution` and `executeReadyPlanWithRepair`;
  do not duplicate execution or Workflow Validation orchestration.
- `src/cmd/load-plan/plan-hold.ts` — continue using the authoritative hold and user-verification flows.
- `src/shared/workflow/state-transition.ts` — preserve `runRecoveryTransition` for reset/abandon and
  `runDirectDeliveryPublicationTransition` for manual publication; do not replace transactions with bare choreography.
- `src/shared/workflow/plan-lifecycle.js` — preserve lifecycle predicates, event updates, implementation finalization,
  and validation staging.
- `src/shared/git-test-fixture.ts` and `src/cmd/testing/runtime-command-fixture.ts` — use real Git repositories, Plan
  storage, worktree registry, and Runtime surfaces for destructive-path tests rather than introducing seams for
  RunWield-owned machinery.
- `src/ui/tui/golden-scenarios/load-plan-workflow.ts` — retain the existing `inspect -> reset` and `abandon -> cancel`
  scenarios as end-to-end protection for menu re-entry and live-state recomputation.

## Implementation Steps

- [ ] `plan-recovery-actions.ts` exports a typed `RecoveryActionOutcome` discriminated union and a
      `RecoveryActionContext` whose `worktreeContext` and `unresolvedRecords` fields are mutable shared state; its
      metric detail type uses a concrete value union rather than `any`, `unknown`, or `object`.
- [ ] `handlePlanRecovery` constructs exactly one live action context. `refreshRecoveryWorktree` updates both
      `plan.attrs` and `context.worktreeContext`, `recordRecoveryResult` reads current context rather than initial
      snapshots, and the originally loaded canonical `worktreeId` remains separately available to merge validation.
- [ ] `plan-recovery-flow.ts` owns policy rejection, menu option/label recomputation, selection metrics, cancellation,
      and the generic Git-unavailable guard; it dispatches every offered action through one exhaustive switch and has
      one outcome translation point where `menu` re-prompts, `handled` exits, and `review` returns to review handling.
- [ ] `plan-recovery-actions.ts` owns `settle_records`, `hold`, `user_verify`, `inspect`, `validate`, `continue`,
      `abandon`, and `review`; each handler returns an explicit outcome on every branch and none contains a branch-level
      bare `continue`.
- [ ] Lifecycle-record settlement still retries proof before requesting attestation, preserves unresolved records on
      decline, skips records without a `transitionId` without skipping later valid records, clears the shared record
      list after attestation, and always returns to a recomputed menu.
- [ ] Inspection still refreshes worktree metadata before reporting and returns to the menu; validation and continuation
      return to the menu when worktree/policy checks block them and exit only after validation or execution actually
      starts; hold and user verification retain their current terminal handling; review returns the distinct `review`
      outcome.
- [ ] Abandonment still confirms first, performs Git deletion when available, falls back only for the existing typed
      Git-required error, commits Plan/registry metadata through `runRecoveryTransition`, clears the shared worktree
      context, records the result, and returns to a menu whose labels no longer use the abandoned worktree.
- [ ] `plan-recovery-reset.ts` preserves all current reset outcomes: missing baseline, declined confirmation, missing
      recreate base, and recoverable Git errors return to the menu; metadata-only cleanup and successful baseline or
      worktree reset return `handled` after committing lifecycle state and, where applicable, restarting execution.
- [ ] Worktree recreation preserves the existing irreversible-step ordering, rollback registrations, registry
      settlement, Plan Front Matter revision precondition, refreshed `plan.revision`, and complete replacement of the
      shared worktree context before execution restarts.
- [ ] `plan-recovery-merge.ts` preserves every preflight as a `menu` outcome: merge eligibility, worktree availability,
      branch/path, originally loaded canonical worktree ID, concrete target branch, validation-context proof, worktree
      execution mode, and resolved path/branch/target completeness.
- [ ] Once manual publication is attempted, merge success, publication failure, merge conflict recording, and post-merge
      processing failure remain terminal `handled` outcomes. Candidate/metadata ancestry proof, sibling fencing, primary
      Plan snapshots, registry updates, cleanup policy, and Delivery Evidence remain inside the existing Direct Delivery
      publication transaction.
- [ ] Nested reset/merge/abandon callbacks retain their local return semantics: no callback return is converted into a
      `RecoveryActionOutcome`, rollback does not restore primary snapshots after `mergeCompleted`, and the publication
      callback still returns `{ mergeResult }`.
- [ ] The split does not add `__deps`, `__testDeps`, conditional injection, or a new capability name to an existing
      injection seam. `deno task seams:check` remains green without loosening `scripts/injection-seam-baseline.json`.
- [ ] `src/shared/workflow/architecture-boundary.test.ts` replaces the touched `.js` test with explicit TypeScript
      types, scans the coordinator and all three extracted action modules for raw lifecycle writes, and scans the full
      Plan Recovery module family so any `mergeExecutionWorktree` call is accepted only inside
      `runDirectDeliveryPublicationTransition`; the old `.js` path no longer exists.
- [ ] Focused tests named `Plan Recovery menu outcomes re-prompt without fallthrough`,
      `Plan Recovery handled and
      review outcomes exit once`, and `Plan Recovery actions preserve live context`
      assert the exact outcome contract, including proof/decline/attestation settlement, inspect refresh,
      blocked/successful validate and continue, reset preflight and success, merge preflight versus
      attempted-publication failure, abandon decline/success, and review. Tests use real Plan/Git fixtures for
      RunWield-owned transitions and do not add production-only test seams.
- [ ] Real `/load-plan` integration coverage queues `inspect` followed by `cancel`, observes two Plan Recovery prompts,
      and proves cancellation preserves the failed Plan; a separate `hold` selection proves a terminal recovery action
      produces `on_hold` and exits without a second recovery prompt. Existing golden `inspect -> reset` and
      `abandon -> cancel` behavior remains covered rather than being deleted when implementation moves.
- [ ] `plan-recovery-flow.ts` and `plan-recovery-actions.ts` are each under 400 lines, `plan-recovery-reset.ts` is under
      400 lines, and `plan-recovery-merge.ts` is under 500 lines; all substantive action behavior resides in those
      modules rather than aliases, wrappers, or placeholders.

## Verification Plan

- Automated: `deno task check`
- Automated: `deno task language-policy:check`
- Automated: `deno task seams:check`
- Automated:
  `deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts src/cmd/load-plan/index.integration.test.ts src/shared/workflow/architecture-boundary.test.ts`
- Automated: `deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/load-plan-workflow.test.ts`
- Automated: `deno task ci`
- Manual/code-review guard: compare the moved reset, merge, and abandon transaction bodies against the baseline and
  confirm only their outer branch-level control changed to `RecoveryActionOutcome`; callback-local returns and effect
  ordering are unchanged.
- Expected preserved behavior:
  - Menu labels and available actions are recomputed after inspect, lifecycle-record settlement, and abandonment using
    current worktree, Git probe, Plan Status, and unresolved-record state.
  - Cancellation and terminal hold/user-verification/validation/continuation/reset/merge paths exit recovery exactly as
    before; review returns control to the review flow.
  - All recoverable preflight/confirmation failures re-open Plan Recovery instead of falling through into another action
    or exiting silently.
  - Reset, abandonment, and Direct Delivery publication continue using authoritative transition wrappers and preserve
    failure/rollback evidence.
- Expected stopped behavior: none. No Plan Recovery action, menu option, Plan Lifecycle event, metric, confirmation,
  message, or transaction path is intentionally removed.
- Existing tests that cover the reshaped flow must be preserved or strengthened, not deleted because imports or local
  implementation names changed. The existing `inspect -> reset` and `abandon -> cancel` golden scenarios remain
  behavioral protections after extraction.

### Objective-Failing Checks

- `OC1` —
  `test "$(wc -l < src/cmd/load-plan/plan-recovery-flow.ts)" -lt 400 && for f in src/cmd/load-plan/plan-recovery-actions.ts src/cmd/load-plan/plan-recovery-reset.ts; do test -f "$f" && test "$(wc -l < "$f")" -lt 400 || exit 1; done && test -f src/cmd/load-plan/plan-recovery-merge.ts && test "$(wc -l < src/cmd/load-plan/plan-recovery-merge.ts)" -lt 500`
  — the current 1,266-line module cannot pass; the requested coordinator/actions/reset/merge split must exist within
  bounded module sizes.
- `OC2` —
  `a=src/cmd/load-plan/plan-recovery-actions.ts; r=src/cmd/load-plan/plan-recovery-reset.ts; m=src/cmd/load-plan/plan-recovery-merge.ts; c=src/cmd/load-plan/plan-recovery-flow.ts; for f in "$a" "$r" "$m"; do test -f "$f" && ! grep -Eq '^[[:space:]]*continue[[:space:]]*;' "$f" || exit 1; done && grep -q 'runRecoveryTransition(' "$a" && grep -q 'runRecoveryTransition(' "$r" && grep -q 'runDirectDeliveryPublicationTransition(' "$m" && grep -q 'mergeExecutionWorktree(' "$m" && grep -q 'executeReadyPlanWithRepair(' "$a" && grep -q 'executeReadyPlanWithRepair(' "$r" && grep -q 'validateCompletedExecution(' "$a" && ! grep -Eq 'runRecoveryTransition\(|runDirectDeliveryPublicationTransition\(|executeReadyPlanWithRepair\(|validateCompletedExecution\(|putPlanOnHold\(|markPlanUserVerified\(|reopenPlanForReview\(' "$c"`
  — the expected lifecycle, execution, validation, and publication implementations must reside in their action owners,
  extracted modules cannot retain branch-level loop control, and the coordinator cannot retain substantive actions.
- `OC3` —
  `test -s src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery menu outcomes re-prompt without fallthrough' src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery handled and review outcomes exit once' src/cmd/load-plan/plan-recovery-flow.test.ts && grep -q 'Plan Recovery actions preserve live context' src/cmd/load-plan/plan-recovery-flow.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts src/cmd/load-plan/index.integration.test.ts src/shared/workflow/architecture-boundary.test.ts`
  — the required outcome/live-state regressions do not exist on the baseline and must pass together with real command
  recovery and architecture enforcement after the split.

## Execution Policy

Engineer-owned autonomous execution is recommended. This is an internal TypeScript refactor with no browser-rendered UI
or live visual judgment requirement.

## Edge Cases & Considerations

- Shared-state freshness: copying `worktreeContext` or `unresolvedRecords` into per-action values would recreate the
  closure bug in another form. All actions must mutate the one context read by the next menu pass.
- Canonical identity: merge eligibility must continue using the `worktreeId` from the originally loaded Plan, not an ID
  inferred and persisted during branch-name recovery.
- Callback control: source-wide replacement of `continue`/`return` is unsafe. Convert only branch-level loop control;
  preserve loop-local and transaction-callback semantics deliberately.
- Transaction authority: Plan Front Matter, registry state, Git worktree state, and target-ref movement remain owned by
  current typed transition/worktree modules. Extracted action modules orchestrate those owners but do not create
  projection state or bypass them.
- Metrics: `recordRecoveryResult` must calculate `hasWorktree`, manual-merge eligibility, and Plan Status at call time
  so post-reset/abandon results do not report stale state.
- TypeScript policy: new modules use named interfaces and concrete value unions. Do not introduce `any`, `unknown`,
  `object`, inline complex object types, new production JavaScript, or extensionless imports; migrate the touched
  architecture test from `.js` to `.ts` in the same change.
- Architecture-test coverage: the current lifecycle/publication architecture test is already blind to
  `plan-recovery-flow.ts`; this change closes that gap for the whole split family rather than carrying the blind spot
  into new files.
- Working-tree isolation: unrelated existing modifications must remain untouched; this Plan changes only the listed
  recovery and test files.
